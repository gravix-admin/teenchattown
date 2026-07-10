const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../database");
const { requireAuth } = require("../middleware/auth");
const { imageUpload, fileToDataUrl } = require("../services/upload");
const { calculateAge, publicUser, rankBadges } = require("../services/userService");
const { broadcast } = require("../services/events");
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
const avatarUpload = imageUpload("avatars");
const bannerUpload = imageUpload("banners");

function sign(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

async function hasProfileTool(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  return Boolean(row?.allowed);
}

router.post("/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const email = normalizeEmail(req.body.email);
  const { password, dob, gender = "other" } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const age = calculateAge(dob);
  if (!dob || !Number.isFinite(age) || age < 13) return res.status(400).json({ error: "You must be at least 13 to register." });
  const conflict = await findUserIdentityConflict(pool, { username, email });
  if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
  if (conflict.email) return res.status(409).json({ error: "This email is already taken." });
  const passwordHash = await bcrypt.hash(password, 10);
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const country = req.headers["cf-ipcountry"] || "Auto detected on live host";
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (username, email, password_hash, dob, age, gender, ip_address, country, avatar_url, banner_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, dob, age, gender, ip, country, `/assets/avatar-${gender}.svg`, "/assets/profile-banner.svg"]
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
    throw error;
  }
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
  res.status(201).json({ token: sign(rows[0]) });
});

router.post("/login", async (req, res) => {
  const identity = String(req.body.identity || "").toLowerCase().trim();
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? OR email = ?", [identity, identity]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
    return res.status(401).json({ error: "Invalid login details." });
  }
  if (user.banned_until && new Date(user.banned_until) > new Date()) return res.status(403).json({ error: "This account is banned." });
  if (user.kicked_until && new Date(user.kicked_until) > new Date()) return res.status(403).json({ error: "You were temporarily kicked. Please try again later." });
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [user.id]);
  res.json({ token: sign(user) });
});

router.post("/logout", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  if (req.user.rank_name === "s-vip" && req.user.svip_until && new Date(req.user.svip_until) < new Date()) {
    await pool.query("UPDATE users SET rank_name = 'user', svip_until = NULL WHERE id = ?", [req.user.id]);
    const [[fresh]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    req.user = fresh;
  }
  if (!req.user.last_online_reward_at || (Date.now() - new Date(req.user.last_online_reward_at).getTime()) >= 10 * 60 * 1000) {
    await pool.query("UPDATE users SET diamonds = diamonds + 3, last_online_reward_at = NOW(), last_seen = NOW() WHERE id = ?", [req.user.id]);
    const [[fresh]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    req.user = fresh;
  } else {
    await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]);
  }
  const [rooms] = await pool.query(
    "SELECT id, name, description, image_url, is_pinned, created_by, created_at, IF(password_hash IS NULL OR password_hash = '', 0, 1) AS locked FROM rooms ORDER BY CASE WHEN name = 'Main Room' THEN 0 ELSE 1 END, is_pinned DESC, name"
  );
  const [users] = await pool.query("SELECT * FROM users ORDER BY FIELD(rank_name,'developer','chief','manager','inspector','supervisor','super visor','superadmin','visor','admin','moderator','premium','queen','king','s-vip','vip','user'), username");
  const [notifications] = await pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [req.user.id]);
  const [[privateUnread]] = await pool.query(
    "SELECT COUNT(*) AS count FROM private_messages WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL",
    [req.user.id]
  );
  const [friendRequests] = await pool.query(
    `SELECT fr.*, u.username, u.avatar_url, u.rank_name FROM friend_requests fr
     JOIN users u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [req.user.id]
  );
  res.json({
    me: publicUser(req.user, req.user),
    rooms,
    users: users.map((user) => publicUser(user, req.user)),
    notifications,
    friendRequests,
    unreadPm: Number(privateUnread.count || 0),
    rankBadges: await rankBadges(),
  });
});

router.patch("/me", requireAuth, async (req, res) => {
  const allowed = ["displayName", "bio", "aboutMe", "mood", "theme", "bubbleStyle", "usernameColor", "textColor", "frame", "profileMusicUrl", "animatedBannerUrl", "profileTitle", "profileStatus", "profileAccent", "showOnlineStatus"];
  const data = {};
  const limits = { displayName: 40, bio: 120, profileTitle: 80, profileStatus: 40, profileAccent: 24, aboutMe: 1500 };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === "profileTitle" && String(req.body[key] || "").trim() && !(await hasProfileTool(req.user, "customTitle"))) {
        return res.status(403).json({ error: "Your rank cannot set a custom title yet." });
      }
      if (key === "profileStatus") {
        const status = String(req.body[key]);
        if (!["Online", "Invisible"].includes(status)) return res.status(400).json({ error: "Choose Online or Invisible." });
        if (status === "Invisible" && !(await hasProfileTool(req.user, "invisibleStatus"))) {
          return res.status(403).json({ error: "Your rank cannot use invisible status yet." });
        }
      }
      data[key] = key === "showOnlineStatus"
        ? (req.body[key] ? 1 : 0)
        : String(req.body[key]).slice(0, limits[key] || 255);
    }
  }
  const columns = {
    displayName: "display_name",
    aboutMe: "about_me",
    bubbleStyle: "bubble_style",
    usernameColor: "username_color",
    textColor: "text_color",
    profileMusicUrl: "profile_music_url",
    animatedBannerUrl: "animated_banner_url",
    profileTitle: "profile_title",
    profileStatus: "profile_status",
    profileAccent: "profile_accent",
    showOnlineStatus: "show_online_status",
  };
  if (req.body.username !== undefined) {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    if (username.toLowerCase() !== String(req.user.username || "").toLowerCase()) {
      if (!["vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"].includes(req.user.rank_name)) {
        return res.status(403).json({ error: "Username change requires VIP or higher." });
      }
      const conflict = await findUserIdentityConflict(pool, { username, excludeId: req.user.id });
      if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
      data.username = username;
    }
  }
  const entries = Object.entries(data);
  if (entries.length) {
    try {
      await pool.query(
        `UPDATE users SET ${entries.map(([key]) => `${columns[key] || key} = ?`).join(", ")} WHERE id = ?`,
        [...entries.map(([, value]) => value), req.user.id]
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
      throw error;
    }
  }
  await pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'profile_ready'", [req.user.id]);
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
  broadcast("users", { changed: publicUser(rows[0], req.user) });
  res.json({ me: publicUser(rows[0], rows[0]) });
});

router.post("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.password_hash))) return res.status(401).json({ error: "Current password is wrong." });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(newPassword, 10), req.user.id]);
  res.json({ ok: true });
});

router.post("/me/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an avatar image." });
  const url = fileToDataUrl(req.file);
  await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [url, req.user.id]);
  res.json({ avatarUrl: url });
});

router.post("/me/banner", requireAuth, bannerUpload.single("banner"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a banner image." });
  const url = fileToDataUrl(req.file);
  await pool.query("UPDATE users SET banner_url = ? WHERE id = ?", [url, req.user.id]);
  res.json({ bannerUrl: url });
});

router.post("/me/delete-request", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NOW() WHERE id = ?", [req.user.id]);
  res.json({ message: "Your account is scheduled for deletion in 7 days. You can cancel anytime before then." });
});

router.post("/me/cancel-delete", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NULL WHERE id = ?", [req.user.id]);
  res.json({ message: "Account deletion cancelled." });
});

module.exports = router;
