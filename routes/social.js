const express = require("express");
const pool = require("../database");
const { requireAuth, isStaff } = require("../middleware/auth");
const { notifyUser, broadcast } = require("../services/events");
const { publicUser } = require("../services/userService");
const { imageUpload, fileToDataUrl } = require("../services/upload");

const router = express.Router();
const galleryUpload = imageUpload("gallery");
const giftCatalog = {
  rose: { title: "Rose", costGold: 50 },
  star: { title: "Star", costGold: 100 },
  crown: { title: "Crown", costGold: 250 },
  diamond: { title: "Diamond", costGold: 500 },
};
const svipPlans = {
  "7d": { label: "7 days", days: 7, diamonds: 50, gold: 1000 },
  "1m": { label: "1 month", days: 30, diamonds: 100, gold: 5000 },
  "3m": { label: "3 months", days: 90, diamonds: 200, gold: 10000 },
  lifetime: { label: "Lifetime", days: 36500, diamonds: 1000, gold: 25000 },
};
const rankPower = ["user", "vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "inspector", "manager", "chief", "developer"];

async function notification(userId, type, title, body = "") {
  const [result] = await pool.query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
    [userId, type, title, body]
  );
  notifyUser(userId, "notification", { id: result.insertId, type, title, body });
}

router.get("/friends", requireAuth, async (req, res) => {
  const [friends] = await pool.query(
    `SELECT u.id, u.username, u.avatar_url, u.rank_name, u.mood
     FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? ORDER BY u.username`,
    [req.user.id]
  );
  const [requests] = await pool.query(
    `SELECT fr.*, u.username, u.avatar_url, u.rank_name
     FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
    [req.user.id]
  );
  const [blocks] = await pool.query(
    `SELECT b.*, u.username, u.avatar_url FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`,
    [req.user.id]
  );
  res.json({ friends, requests, blocks });
});

router.post("/friend-requests", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  if (toUserId === req.user.id) return res.status(400).json({ error: "You cannot friend yourself." });
  const [[blocked]] = await pool.query("SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)", [toUserId, req.user.id, req.user.id, toUserId]);
  if (blocked.count) return res.status(403).json({ error: "Friend request blocked." });
  await pool.query(
    "INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = 'pending', updated_at = NOW()",
    [req.user.id, toUserId]
  );
  await notification(toUserId, "friend-request", "New friend request", `${req.user.username} sent you a friend request.`);
  res.status(201).json({ ok: true });
});

router.post("/friend-requests/:id/accept", requireAuth, async (req, res) => {
  const [[request]] = await pool.query("SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'", [req.params.id, req.user.id]);
  if (!request) return res.status(404).json({ error: "Request not found." });
  await pool.query("UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = ?", [request.id]);
  await pool.query("INSERT IGNORE INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)", [request.from_user_id, request.to_user_id, request.to_user_id, request.from_user_id]);
  await notification(request.from_user_id, "friend-accepted", "Friend request accepted", `${req.user.username} accepted your friend request.`);
  res.json({ ok: true });
});

router.post("/friend-requests/:id/decline", requireAuth, async (req, res) => {
  await pool.query("UPDATE friend_requests SET status = 'declined', updated_at = NOW() WHERE id = ? AND to_user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.delete("/friends/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [req.user.id, req.params.id, req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post("/blocks", requireAuth, async (req, res) => {
  const blockedId = Number(req.body.userId);
  if (blockedId === req.user.id) return res.status(400).json({ error: "You cannot block yourself." });
  await pool.query("INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)", [req.user.id, blockedId]);
  await pool.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [req.user.id, blockedId, blockedId, req.user.id]);
  res.status(201).json({ ok: true });
});

router.delete("/blocks/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

router.post("/follows", requireAuth, async (req, res) => {
  const followingId = Number(req.body.userId);
  await pool.query("INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, followingId]);
  await notification(followingId, "follow", "New follower", `${req.user.username} followed you.`);
  res.status(201).json({ ok: true });
});

router.delete("/follows/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

router.post("/profiles/:id/like", requireAuth, async (req, res) => {
  const profileUserId = Number(req.params.id);
  if (!profileUserId) return res.status(400).json({ error: "Invalid profile." });
  if (profileUserId === Number(req.user.id)) return res.status(400).json({ error: "You cannot like your own profile." });
  const [[target]] = await pool.query("SELECT id FROM users WHERE id = ?", [profileUserId]);
  if (!target) return res.status(404).json({ error: "Profile not found." });
  const [[existing]] = await pool.query("SELECT id FROM profile_likes WHERE profile_user_id = ? AND liker_id = ?", [profileUserId, req.user.id]);
  let liked = false;
  if (existing) {
    await pool.query("DELETE FROM profile_likes WHERE id = ?", [existing.id]);
  } else {
    await pool.query("INSERT INTO profile_likes (profile_user_id, liker_id) VALUES (?, ?)", [profileUserId, req.user.id]);
    liked = true;
    await notification(profileUserId, "profile-like", "Profile liked", `${req.user.username} liked your profile.`);
  }
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM profile_likes WHERE profile_user_id = ?", [profileUserId]);
  await pool.query("UPDATE users SET profile_likes = ? WHERE id = ?", [count.total, profileUserId]);
  broadcast("users-changed", { userId: profileUserId });
  res.json({ ok: true, liked, count: count.total });
});

router.get("/profiles/:id", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET visitor_count = visitor_count + 1 WHERE id = ?", [req.params.id]);
  const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  const [badges] = await pool.query(
    `SELECT a.* FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ? ORDER BY ua.created_at DESC`,
    [req.params.id]
  );
  const [gallery] = await pool.query("SELECT * FROM profile_gallery WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", [req.params.id]);
  const [wall] = await pool.query(
    `SELECT wp.*, u.username, u.avatar_url FROM wall_posts wp JOIN users u ON u.id = wp.author_id WHERE wp.profile_user_id = ? ORDER BY wp.created_at DESC LIMIT 20`,
    [req.params.id]
  );
  const [gifts] = await pool.query(
    `SELECT g.*, u.username AS from_username, u.avatar_url AS from_avatar_url
     FROM gifts g JOIN users u ON u.id = g.from_user_id
     WHERE g.to_user_id = ? ORDER BY g.created_at DESC LIMIT 12`,
    [req.params.id]
  );
  const [[likes]] = await pool.query("SELECT COUNT(*) AS total FROM profile_likes WHERE profile_user_id = ?", [req.params.id]);
  const [[liked]] = await pool.query("SELECT id FROM profile_likes WHERE profile_user_id = ? AND liker_id = ?", [req.params.id, req.user.id]);
  user.profile_likes = likes.total;
  res.json({ user: publicUser(user, req.user), badges, gallery, wall, gifts, likedByMe: Boolean(liked), likeCount: likes.total });
});

router.post("/profiles/:id/wall", requireAuth, async (req, res) => {
  const profileUserId = Number(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: "Wall post cannot be empty." });
  const [[blocked]] = await pool.query(
    "SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
    [profileUserId, req.user.id, req.user.id, profileUserId]
  );
  if (blocked.count) return res.status(403).json({ error: "Wall posting is blocked." });
  const [result] = await pool.query(
    "INSERT INTO wall_posts (profile_user_id, author_id, body) VALUES (?, ?, ?)",
    [profileUserId, req.user.id, body]
  );
  if (profileUserId !== req.user.id) await notification(profileUserId, "wall-post", "New wall post", `${req.user.username} posted on your wall.`);
  const [[row]] = await pool.query(
    `SELECT wp.*, u.username, u.avatar_url
     FROM wall_posts wp JOIN users u ON u.id = wp.author_id WHERE wp.id = ?`,
    [result.insertId]
  );
  broadcast("profile-wall", { profileUserId, post: row });
  res.status(201).json(row);
});

router.delete("/wall-posts/:id", requireAuth, async (req, res) => {
  const [[post]] = await pool.query("SELECT * FROM wall_posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Wall post not found." });
  if (post.author_id !== req.user.id && post.profile_user_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: "Cannot delete this wall post." });
  await pool.query("DELETE FROM wall_posts WHERE id = ?", [post.id]);
  res.json({ ok: true });
});

router.post("/profiles/me/gallery", requireAuth, galleryUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image." });
  const imageUrl = fileToDataUrl(req.file);
  const [result] = await pool.query(
    "INSERT INTO profile_gallery (user_id, image_url, caption) VALUES (?, ?, ?)",
    [req.user.id, imageUrl, String(req.body.caption || "").slice(0, 180)]
  );
  res.status(201).json({ id: result.insertId, imageUrl });
});

router.delete("/gallery/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM profile_gallery WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post("/gifts", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const giftCode = String(req.body.giftCode || "star");
  const gift = giftCatalog[giftCode];
  if (!gift) return res.status(400).json({ error: "Unknown gift." });
  if (!toUserId || toUserId === req.user.id) return res.status(400).json({ error: "Choose another user." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sender]] = await connection.query("SELECT gold FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    const [[target]] = await connection.query("SELECT id FROM users WHERE id = ?", [toUserId]);
    if (!target) throw new Error("User not found.");
    if (!sender || Number(sender.gold) < gift.costGold) throw new Error("Not enough gold for this gift.");
    await connection.query("UPDATE users SET gold = gold - ? WHERE id = ?", [gift.costGold, req.user.id]);
    const [result] = await connection.query(
      "INSERT INTO gifts (from_user_id, to_user_id, gift_code, title, cost_gold) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, toUserId, giftCode, gift.title, gift.costGold]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [toUserId, "gift", "Gift received", `${req.user.username} sent you ${gift.title}.`]
    );
    await connection.commit();
    notifyUser(toUserId, "notification", { type: "gift", title: "Gift received", body: `${req.user.username} sent you ${gift.title}.` });
    res.status(201).json({ id: result.insertId, gift, balanceChange: -gift.costGold });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not send gift." });
  } finally {
    connection.release();
  }
});

router.post("/wallet-transfers", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const currency = req.body.currency === "diamonds" ? "diamonds" : "gold";
  const amount = Math.floor(Number(req.body.amount || 0));
  const note = String(req.body.note || "").slice(0, 160);
  if (!toUserId || toUserId === req.user.id) return res.status(400).json({ error: "Choose another user." });
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return res.status(400).json({ error: "Enter a valid amount." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sender]] = await connection.query(`SELECT ${currency} AS balance FROM users WHERE id = ? FOR UPDATE`, [req.user.id]);
    const [[target]] = await connection.query("SELECT id FROM users WHERE id = ?", [toUserId]);
    if (!target) throw new Error("User not found.");
    if (!sender || Number(sender.balance) < amount) throw new Error(`Not enough ${currency}.`);
    await connection.query(`UPDATE users SET ${currency} = ${currency} - ? WHERE id = ?`, [amount, req.user.id]);
    await connection.query(`UPDATE users SET ${currency} = ${currency} + ? WHERE id = ?`, [amount, toUserId]);
    const [result] = await connection.query(
      "INSERT INTO wallet_transfers (from_user_id, to_user_id, currency, amount, note) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, toUserId, currency, amount, note]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [toUserId, "wallet", "Wallet shared", `${req.user.username} sent you ${amount} ${currency}.${note ? ` ${note}` : ""}`]
    );
    await connection.commit();
    notifyUser(toUserId, "notification", { type: "wallet", title: "Wallet shared", body: `${req.user.username} sent you ${amount} ${currency}.` });
    res.status(201).json({ id: result.insertId, currency, amount });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not share wallet." });
  } finally {
    connection.release();
  }
});

router.post("/reports", requireAuth, async (req, res) => {
  let targetUserId = req.body.targetUserId ? Number(req.body.targetUserId) : null;
  if (targetUserId && targetUserId === Number(req.user.id)) return res.status(400).json({ error: "You cannot report yourself." });
  if (req.body.messageId) {
    const [[message]] = await pool.query("SELECT user_id FROM messages WHERE id = ?", [req.body.messageId]);
    if (!message) return res.status(404).json({ error: "Message not found." });
    if (Number(message.user_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own message." });
    targetUserId = Number(message.user_id);
  }
  if (req.body.privateMessageId) {
    const [[message]] = await pool.query("SELECT sender_id, receiver_id FROM private_messages WHERE id = ?", [req.body.privateMessageId]);
    if (!message || (Number(message.sender_id) !== Number(req.user.id) && Number(message.receiver_id) !== Number(req.user.id))) return res.status(404).json({ error: "Private message not found." });
    if (Number(message.sender_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own message." });
    targetUserId = Number(message.sender_id);
  }
  if (req.body.wallPostId) {
    const [[post]] = await pool.query("SELECT author_id FROM wall_posts WHERE id = ?", [req.body.wallPostId]);
    if (!post) return res.status(404).json({ error: "Wall post not found." });
    if (Number(post.author_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own post." });
    targetUserId = Number(post.author_id);
  }
  await pool.query(
    "INSERT INTO reports (reporter_id, target_type, target_user_id, message_id, room_id, private_message_id, wall_post_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      req.user.id,
      String(req.body.targetType || "user").slice(0, 40),
      targetUserId || null,
      req.body.messageId || null,
      req.body.roomId || null,
      req.body.privateMessageId || null,
      req.body.wallPostId || null,
      String(req.body.reason || "Reported").slice(0, 255),
    ]
  );
  broadcast("report-created", { targetUserId });
  res.status(201).json({ ok: true });
});

router.get("/news", requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT np.*, u.username, u.avatar_url, u.rank_name
     FROM news_posts np
     JOIN users u ON u.id = np.author_id
     ORDER BY np.created_at DESC
     LIMIT 30`
  );
  const ids = rows.map((row) => row.id);
  let comments = [];
  if (ids.length) {
    const [commentRows] = await pool.query(
      `SELECT nc.*, u.username, u.avatar_url, u.rank_name, u.profile_title
       FROM news_comments nc
       JOIN users u ON u.id = nc.user_id
       WHERE nc.news_id IN (?)
       ORDER BY nc.created_at ASC`,
      [ids]
    );
    comments = commentRows;
  }
  res.json(rows.map((row) => ({ ...row, comments: comments.filter((comment) => Number(comment.news_id) === Number(row.id)) })));
});

router.post("/news/:id/comments", requireAuth, async (req, res) => {
  const body = String(req.body.body || "").trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: "Comment cannot be empty." });
  const [[post]] = await pool.query("SELECT id FROM news_posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "News post not found." });
  const [result] = await pool.query("INSERT INTO news_comments (news_id, user_id, body) VALUES (?, ?, ?)", [post.id, req.user.id, body]);
  const [[comment]] = await pool.query(
    `SELECT nc.*, u.username, u.avatar_url, u.rank_name, u.profile_title
     FROM news_comments nc
     JOIN users u ON u.id = nc.user_id
     WHERE nc.id = ?`,
    [result.insertId]
  );
  broadcast("news-posted", { id: post.id, comment: true });
  res.status(201).json(comment);
});

router.get("/leaderboards", requireAuth, async (_req, res) => {
  const project = "id, username, display_name, avatar_url, rank_name, profile_title, xp, gold, diamonds, message_count";
  const [xp] = await pool.query(`SELECT ${project} FROM users ORDER BY xp DESC, username ASC LIMIT 20`);
  const [gold] = await pool.query(`SELECT ${project} FROM users ORDER BY gold DESC, username ASC LIMIT 20`);
  const [diamonds] = await pool.query(`SELECT ${project} FROM users ORDER BY diamonds DESC, username ASC LIMIT 20`);
  res.json({ xp, gold, diamonds });
});

router.post("/memberships/svip", requireAuth, async (req, res) => {
  const plan = svipPlans[String(req.body.plan || "")];
  if (!plan) return res.status(400).json({ error: "Choose a valid S-VIP plan." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.query("SELECT id, rank_name, gold, diamonds, svip_until FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    if (!user) throw new Error("User not found.");
    if (Number(user.gold) < plan.gold || Number(user.diamonds) < plan.diamonds) throw new Error("Not enough gold or diamonds for this S-VIP plan.");
    const base = user.svip_until && new Date(user.svip_until) > new Date() ? "svip_until" : "NOW()";
    const shouldUpgrade = rankPower.indexOf(user.rank_name) < rankPower.indexOf("s-vip");
    await connection.query(
      `UPDATE users
       SET gold = gold - ?, diamonds = diamonds - ?, svip_until = DATE_ADD(${base}, INTERVAL ? DAY)${shouldUpgrade ? ", rank_name = 's-vip'" : ""}
       WHERE id = ?`,
      [plan.gold, plan.diamonds, plan.days, user.id]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [user.id, "membership", "S-VIP activated", `Your ${plan.label} S-VIP package is active.`]
    );
    await connection.commit();
    notifyUser(user.id, "notification", { type: "membership", title: "S-VIP activated", body: `Your ${plan.label} S-VIP package is active.` });
    broadcast("users-changed", { userId: user.id });
    const [[fresh]] = await pool.query("SELECT gold, diamonds, rank_name, svip_until FROM users WHERE id = ?", [user.id]);
    res.json({ ok: true, plan: plan.label, user: fresh });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not buy S-VIP." });
  } finally {
    connection.release();
  }
});

router.get("/notifications", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [req.user.id]);
  res.json(rows);
});

router.post("/notifications/read", requireAuth, async (req, res) => {
  await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
