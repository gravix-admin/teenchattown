const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database");
const { requireAuth, canControl, isStaff, rankPower } = require("../middleware/auth");
const { adminStats } = require("../services/userService");
const { ranks, staffTools } = require("../services/schema");
const { broadcast, notifyUser } = require("../services/events");
const {
  normalizeUsername,
  normalizeEmail,
  isValidUsername,
  isValidEmail,
  isDuplicateKeyError,
  duplicateKeyMessage,
  findUserIdentityConflict,
} = require("../services/identity");

const router = express.Router();

function hasPanel(user) {
  return ["admin", "chief", "developer"].includes(user.rank_name);
}

async function permission(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  return Boolean(row?.allowed);
}

async function canDeletePrivateChats(user) {
  return isStaff(user) && rankPower(user.rank_name) >= rankPower("admin") && (await permission(user, "deleteMessage"));
}

async function log(actorId, action, targetType, targetId, details = "") {
  await pool.query("INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)", [actorId, action, targetType, targetId, details]);
}

router.use(requireAuth);

router.get("/dashboard", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const [users] = await pool.query("SELECT id, username, email, rank_name, avatar_url, ip_address, xp, gold, diamonds, muted_until, kicked_until, banned_until, last_seen, created_at FROM users ORDER BY created_at DESC LIMIT 100");
  const [permissions] = await pool.query("SELECT * FROM role_permissions");
  const [logs] = await pool.query(
    `SELECT al.*, u.username AS actor_name FROM admin_logs al JOIN users u ON u.id = al.actor_id ORDER BY al.created_at DESC LIMIT 50`
  );
  const [reports] = await pool.query(
    `SELECT r.*, reporter.username AS reporter_name, target.username AS target_name
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users target ON target.id = r.target_user_id
     ORDER BY r.created_at DESC LIMIT 50`
  );
  const [privateConversations] = await pool.query(
    `SELECT c.user_one_id, u1.username AS user_one_name, u1.avatar_url AS user_one_avatar,
            c.user_two_id, u2.username AS user_two_name, u2.avatar_url AS user_two_avatar,
            c.message_count, latest.created_at AS last_message_at,
            COALESCE(NULLIF(latest.body, ''), 'Image') AS last_body
     FROM (
       SELECT LEAST(sender_id, receiver_id) AS user_one_id,
              GREATEST(sender_id, receiver_id) AS user_two_id,
              MAX(id) AS last_message_id,
              COUNT(*) AS message_count
       FROM private_messages
       WHERE deleted_at IS NULL
       GROUP BY user_one_id, user_two_id
     ) c
     JOIN private_messages latest ON latest.id = c.last_message_id
     JOIN users u1 ON u1.id = c.user_one_id
     JOIN users u2 ON u2.id = c.user_two_id
     ORDER BY latest.created_at DESC
     LIMIT 50`
  );
  res.json({
    stats: await adminStats(),
    users,
    permissions,
    logs,
    reports,
    privateConversations,
    ranks,
    staffTools,
  });
});

router.patch("/users/:id", async (req, res) => {
  const [[target]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot control that user." });
  const updates = {};
  if (req.body.rank && ranks.includes(req.body.rank)) {
    if (!canControl(req.user.rank_name, req.body.rank)) return res.status(403).json({ error: "You cannot assign that rank." });
    updates.rank_name = req.body.rank;
  }
  if (req.body.username && await permission(req.user, "changeRank")) {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    const conflict = await findUserIdentityConflict(pool, { username, excludeId: target.id });
    if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
    updates.username = username;
  }
  if (req.body.email && await permission(req.user, "changeRank")) {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
    const conflict = await findUserIdentityConflict(pool, { email, excludeId: target.id });
    if (conflict.email) return res.status(409).json({ error: "This email is already taken." });
    updates.email = email;
  }
  if (await permission(req.user, "editProfile")) {
    if (req.body.displayName !== undefined) updates.display_name = String(req.body.displayName).slice(0, 40);
    if (req.body.mood !== undefined) updates.mood = String(req.body.mood).slice(0, 80);
    if (req.body.avatarUrl !== undefined) updates.avatar_url = String(req.body.avatarUrl).slice(0, 500);
    if (req.body.bannerUrl !== undefined) updates.banner_url = String(req.body.bannerUrl).slice(0, 500);
  }
  if (req.body.gold !== undefined) updates.gold = Number(req.body.gold);
  if (req.body.diamonds !== undefined) updates.diamonds = Number(req.body.diamonds);
  if (req.body.xp !== undefined) updates.xp = Number(req.body.xp);
  const entries = Object.entries(updates);
  if (entries.length) {
    try {
      await pool.query(`UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), target.id]);
    } catch (error) {
      if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
      throw error;
    }
  }
  await log(req.user.id, "update_user", "user", target.id, JSON.stringify(updates));
  broadcast("users-changed", { userId: target.id });
  res.json({ ok: true });
});

router.post("/users/:id/moderate", async (req, res) => {
  const [[target]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!isStaff(req.user) || !canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot moderate that user." });
  const action = req.body.action;
  const tool = action === "delete" ? "deleteAccount" : action;
  if (!(await permission(req.user, tool))) return res.status(403).json({ error: "Your rank does not have this tool." });
  const reason = String(req.body.reason || "").slice(0, 255);
  const notify = async (title, body) => {
    const [result] = await pool.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [target.id, "moderation", title, body]
    );
    notifyUser(target.id, "notification", { id: result.insertId, type: "moderation", title, body });
    notifyUser(target.id, "moderation", { action, title, body });
  };
  if (action === "warn") {
    await notify("Staff warning", reason || "A staff member sent you a warning.");
  } else if (action === "mute") {
    const minutes = [2, 5, 10, 60].includes(Number(req.body.minutes)) ? Number(req.body.minutes) : 10;
    await pool.query("UPDATE users SET muted_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [minutes, target.id]);
    await notify("You are muted", `You cannot chat or send PMs for ${minutes} minutes.${reason ? ` Reason: ${reason}` : ""}`);
  } else if (action === "kick") {
    const minutes = [2, 5, 10, 60, 2880].includes(Number(req.body.minutes)) ? Number(req.body.minutes) : 10;
    await pool.query("UPDATE users SET kicked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [minutes, target.id]);
    await notify("You were kicked", `You cannot use the site for ${minutes === 2880 ? "2 days" : `${minutes} minutes`}.${reason ? ` Reason: ${reason}` : ""}`);
  } else if (action === "ban") {
    await pool.query("UPDATE users SET banned_until = '9999-12-31 23:59:59' WHERE id = ?", [target.id]);
    await notify("Account banned", reason || "This account has been permanently banned.");
  } else if (action === "delete") {
    await pool.query("DELETE FROM users WHERE id = ?", [target.id]);
  } else {
    return res.status(400).json({ error: "Unknown action." });
  }
  await log(req.user.id, action, "user", target.id, reason);
  broadcast("users-changed", { userId: target.id });
  res.json({ ok: true });
});

router.patch("/reports/:id", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const status = String(req.body.status || "open");
  if (!["open", "reviewing", "resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "Invalid report status." });
  await pool.query("UPDATE reports SET status = ? WHERE id = ?", [status, req.params.id]);
  await log(req.user.id, "report_status", "report", req.params.id, status);
  res.json({ ok: true });
});

router.get("/reports", async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff access required." });
  const [reports] = await pool.query(
    `SELECT r.*, reporter.username AS reporter_name, target.username AS target_name
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users target ON target.id = r.target_user_id
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 80`
  );
  res.json(reports);
});

router.post("/reports/:id/action", async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff access required." });
  const action = String(req.body.action || "ignore");
  const [[report]] = await pool.query("SELECT * FROM reports WHERE id = ?", [req.params.id]);
  if (!report) return res.status(404).json({ error: "Report not found." });
  if (action === "ignore") {
    await pool.query("UPDATE reports SET status = 'dismissed' WHERE id = ?", [report.id]);
    await log(req.user.id, "report_ignore", "report", report.id, report.reason);
    return res.json({ ok: true });
  }
  if (action !== "delete") return res.status(400).json({ error: "Unknown report action." });
  if (!(await permission(req.user, "deleteMessage"))) return res.status(403).json({ error: "Your rank cannot delete reported content." });

  let deleted = false;
  if (report.message_id) {
    await pool.query("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [report.message_id]);
    broadcast("message-deleted", { id: Number(report.message_id) });
    deleted = true;
  } else if (report.private_message_id) {
    await pool.query("UPDATE private_messages SET deleted_at = NOW() WHERE id = ?", [report.private_message_id]);
    deleted = true;
  } else if (report.wall_post_id) {
    await pool.query("DELETE FROM wall_posts WHERE id = ?", [report.wall_post_id]);
    deleted = true;
  }
  await pool.query("UPDATE reports SET status = ? WHERE id = ?", [deleted ? "resolved" : "reviewing", report.id]);
  await log(req.user.id, deleted ? "report_delete" : "report_review", "report", report.id, JSON.stringify({
    messageId: report.message_id,
    privateMessageId: report.private_message_id,
    wallPostId: report.wall_post_id,
  }));
  res.json({ ok: true, deleted });
});

router.delete("/private-conversations/:userOneId/:userTwoId", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  if (!(await canDeletePrivateChats(req.user))) return res.status(403).json({ error: "Only higher staff can delete private chats." });
  const userOneId = Number(req.params.userOneId);
  const userTwoId = Number(req.params.userTwoId);
  if (!userOneId || !userTwoId || userOneId === userTwoId) return res.status(400).json({ error: "Invalid private chat." });
  const [result] = await pool.query(
    `UPDATE private_messages
     SET deleted_at = NOW()
     WHERE deleted_at IS NULL
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
    [userOneId, userTwoId, userTwoId, userOneId]
  );
  await log(req.user.id, "delete_private_chat", "private_chat", null, `${userOneId}:${userTwoId}:${result.affectedRows || 0}`);
  notifyUser(userOneId, "private-chat-deleted", { userOneId, userTwoId, by: req.user.id });
  notifyUser(userTwoId, "private-chat-deleted", { userOneId, userTwoId, by: req.user.id });
  res.json({ ok: true, deleted: result.affectedRows || 0 });
});

router.post("/permissions", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const { rank, tool, allowed } = req.body;
  if (!ranks.includes(rank) || !staffTools.includes(tool)) return res.status(400).json({ error: "Invalid permission." });
  if (rankPower(rank) >= rankPower(req.user.rank_name)) return res.status(403).json({ error: "You cannot edit that rank." });
  await pool.query("REPLACE INTO role_permissions (rank_name, tool, allowed) VALUES (?, ?, ?)", [rank, tool, allowed ? 1 : 0]);
  await log(req.user.id, "permission", "rank", null, `${rank}:${tool}:${allowed}`);
  res.json({ ok: true });
});

router.post("/news", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  if (!(await permission(req.user, "postNews"))) return res.status(403).json({ error: "Your rank cannot post news." });
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  const imageUrl = String(req.body.imageUrl || "").trim().slice(0, 500) || null;
  if (!title || !body) return res.status(400).json({ error: "News title and body are required." });
  const [result] = await pool.query(
    "INSERT INTO news_posts (author_id, title, body, image_url) VALUES (?, ?, ?, ?)",
    [req.user.id, title, body, imageUrl]
  );
  await log(req.user.id, "post_news", "news", result.insertId, title);
  broadcast("news-posted", { id: result.insertId, title });
  res.status(201).json({ id: result.insertId });
});

router.post("/rank-badges", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const { rank, label, color, imageUrl } = req.body;
  if (!ranks.includes(rank) || rankPower(rank) >= rankPower(req.user.rank_name)) return res.status(403).json({ error: "You cannot edit that rank." });
  await pool.query("REPLACE INTO rank_badges (rank_name, label, color, image_url) VALUES (?, ?, ?, ?)", [rank, String(label || rank).slice(0, 16), String(color || "#8b5cf6").slice(0, 24), imageUrl || null]);
  await log(req.user.id, "rank_badge", "rank", null, rank);
  res.json({ ok: true });
});

module.exports = router;
