const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database");
const { requireAuth, isStaff, rankPower } = require("../middleware/auth");
const { imageUpload, fileToDataUrl } = require("../services/upload");
const { addClient, removeClient, broadcast, notifyUser } = require("../services/events");
const { publicUser } = require("../services/userService");

const router = express.Router();
const upload = imageUpload("gallery");
const voiceUpload = imageUpload("voice");
const roomUpload = imageUpload("rooms");

function muted(user) {
  return user.muted_until && new Date(user.muted_until) > new Date();
}

async function roomById(roomId) {
  const [[room]] = await pool.query("SELECT * FROM rooms WHERE id = ?", [roomId]);
  return room || null;
}

async function canEnterRoom(user, room) {
  if (!room) return false;
  if (!room.password_hash) return true;
  if (isStaff(user) || Number(room.created_by) === Number(user.id)) return true;
  const [[access]] = await pool.query("SELECT id FROM room_access WHERE room_id = ? AND user_id = ?", [room.id, user.id]);
  return Boolean(access);
}

async function requireRoomAccess(req, res, next) {
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (!(await canEnterRoom(req.user, room))) return res.status(403).json({ error: "Room password required.", code: "ROOM_LOCKED" });
  req.room = room;
  next();
}

async function hasTool(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  if (!row && tool === "sendPm") return true;
  if (!row && tool === "sendFiles") return user.rank_name !== "vip";
  return Boolean(row?.allowed);
}

async function canDeletePrivateChats(user) {
  return isStaff(user) && rankPower(user.rank_name) >= rankPower("admin") && (await hasTool(user, "deleteMessage"));
}

router.get("/events", requireAuth, async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]);
  addClient(req.user.id, res);
  broadcast("users-changed", { userId: req.user.id });
  req.on("close", async () => {
    removeClient(res);
    await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]).catch(() => {});
    broadcast("users-changed", { userId: req.user.id });
  });
});

router.get("/rooms/:roomId/messages", requireAuth, requireRoomAccess, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT recent.* FROM (
       SELECT m.*, u.username, u.rank_name, u.profile_title, u.avatar_url, u.username_color, u.text_color, u.bubble_style,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('emoji', emoji, 'count', count)) FROM (
          SELECT emoji, COUNT(*) AS count FROM message_reactions WHERE message_id = m.id GROUP BY emoji
        ) r) AS reactions
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT 150
     ) recent
     ORDER BY recent.is_pinned DESC, recent.created_at ASC`,
    [req.params.roomId]
  );
  res.json(rows);
});

router.post("/rooms/:roomId/messages", requireAuth, requireRoomAccess, upload.single("attachment"), async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot chat or send PMs." });
  if (req.file && !(await hasTool(req.user, "sendFiles"))) return res.status(403).json({ error: "Your rank cannot send files." });
  let body = String(req.body.body || "").trim().slice(0, 1200);
  if (!body && !req.file) return res.status(400).json({ error: "Message or attachment required." });
  const welcomeMatch = body.match(/^@wb\s+(.+)$/i);
  if (welcomeMatch) {
    const requestedName = welcomeMatch[1].trim().replace(/^@/, "").slice(0, 32);
    const [[target]] = await pool.query("SELECT username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1", [requestedName]);
    if (!target) return res.status(404).json({ error: "No user found." });
    body = `@wb ${target.username}`;
  }
  const attachmentUrl = req.file ? fileToDataUrl(req.file) : null;
  const [result] = await pool.query(
    "INSERT INTO messages (room_id, user_id, body, attachment_url, attachment_type, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)",
    [req.params.roomId, req.user.id, body, attachmentUrl, req.file?.mimetype || null, req.body.replyToId || null]
  );
  await pool.query("UPDATE users SET message_count = message_count + 1, xp = xp + IF((message_count + 1) % 2 = 0, 1, 0), gold = gold + IF((message_count + 1) % 10 = 0, 100, 0) WHERE id = ?", [req.user.id]);
  await pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'first_message'", [req.user.id]);
  await pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'ten_messages' AND (SELECT message_count FROM users WHERE id = ?) >= 10", [req.user.id, req.user.id]);
  const [rows] = await pool.query(
    `SELECT m.*, u.username, u.rank_name, u.profile_title, u.avatar_url, u.username_color, u.text_color, u.bubble_style
     FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    [result.insertId]
  );
  broadcast("message", rows[0]);
  broadcast("users-changed", { userId: req.user.id });
  res.status(201).json(rows[0]);
});

router.delete("/rooms/:roomId/messages", requireAuth, requireRoomAccess, async (req, res) => {
  if (!isStaff(req.user) || !(await hasTool(req.user, "deleteMessage"))) return res.status(403).json({ error: "Staff only." });
  await pool.query("UPDATE messages SET deleted_at = NOW() WHERE room_id = ? AND deleted_at IS NULL", [req.params.roomId]);
  broadcast("room-cleared", { roomId: Number(req.params.roomId), by: req.user.username });
  res.json({ ok: true });
});

router.patch("/messages/:messageId", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM messages WHERE id = ?", [req.params.messageId]);
  const message = rows[0];
  if (!message) return res.status(404).json({ error: "Message not found." });
  if (message.user_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: "Cannot edit this message." });
  await pool.query("UPDATE messages SET body = ?, edited_at = NOW() WHERE id = ?", [String(req.body.body || "").slice(0, 1200), message.id]);
  broadcast("message-updated", { id: message.id, body: req.body.body });
  res.json({ ok: true });
});

router.delete("/messages/:messageId", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM messages WHERE id = ?", [req.params.messageId]);
  const message = rows[0];
  if (!message) return res.status(404).json({ error: "Message not found." });
  if (message.user_id !== req.user.id && !(isStaff(req.user) && await hasTool(req.user, "deleteMessage"))) return res.status(403).json({ error: "Cannot delete this message." });
  await pool.query("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [message.id]);
  broadcast("message-deleted", { id: message.id });
  res.json({ ok: true });
});

router.post("/messages/:messageId/reactions", requireAuth, async (req, res) => {
  const emoji = String(req.body.emoji || "like").slice(0, 20);
  await pool.query("INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)", [req.params.messageId, req.user.id, emoji]);
  broadcast("reaction", { messageId: Number(req.params.messageId), emoji });
  res.json({ ok: true });
});

router.post("/messages/:messageId/pin", requireAuth, async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff only." });
  await pool.query("UPDATE messages SET is_pinned = 1 - is_pinned WHERE id = ?", [req.params.messageId]);
  broadcast("message-pinned", { id: Number(req.params.messageId) });
  res.json({ ok: true });
});

router.post("/typing", requireAuth, (req, res) => {
  broadcast("typing", { userId: req.user.id, username: req.user.username, roomId: req.body.roomId });
  res.json({ ok: true });
});

router.post("/rooms", requireAuth, roomUpload.single("image"), async (req, res) => {
  const [[permission]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = 'createRoom'", [req.user.rank_name]);
  if (req.user.rank_name !== "developer" && !permission?.allowed) return res.status(403).json({ error: "Your rank cannot create rooms." });
  const passwordHash = req.body.password ? await bcrypt.hash(String(req.body.password), 10) : null;
  const imageUrl = req.file ? fileToDataUrl(req.file) : String(req.body.imageUrl || "").trim() || "/assets/room-main.svg";
  const [result] = await pool.query(
    "INSERT INTO rooms (name, description, image_url, password_hash, created_by) VALUES (?, ?, ?, ?, ?)",
    [String(req.body.name || "").slice(0, 80), String(req.body.description || "").slice(0, 255), imageUrl, passwordHash, req.user.id]
  );
  await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [result.insertId, req.user.id]);
  broadcast("rooms-changed", { id: result.insertId });
  res.status(201).json({ id: result.insertId });
});

router.post("/rooms/:roomId/join", requireAuth, async (req, res) => {
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (!room.password_hash || isStaff(req.user) || Number(room.created_by) === Number(req.user.id)) {
    await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [room.id, req.user.id]);
    return res.json({ ok: true });
  }
  if (!(await bcrypt.compare(String(req.body.password || ""), room.password_hash))) {
    return res.status(403).json({ error: "Wrong room password." });
  }
  await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [room.id, req.user.id]);
  res.json({ ok: true });
});

router.get("/private-conversations", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT other_user.id, other_user.username, other_user.display_name, other_user.rank_name, other_user.profile_title,
      other_user.avatar_url, other_user.gender,
      latest_message.created_at AS last_message_at,
      COALESCE(NULLIF(latest_message.body, ''), 'Image') AS last_body,
      COALESCE(unread.unread_count, 0) AS unread_count
     FROM (
       SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_user_id, MAX(id) AS last_message_id
       FROM private_messages
       WHERE (sender_id = ? OR receiver_id = ?) AND deleted_at IS NULL
       GROUP BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
     ) conversations
     JOIN private_messages latest_message ON latest_message.id = conversations.last_message_id
     JOIN users other_user ON other_user.id = conversations.other_user_id
     LEFT JOIN (
       SELECT sender_id AS other_user_id, COUNT(*) AS unread_count
       FROM private_messages
       WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL
       GROUP BY sender_id
     ) unread ON unread.other_user_id = conversations.other_user_id
     ORDER BY latest_message.created_at DESC
     LIMIT 50`,
    [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

router.get("/private-unread-count", requireAuth, async (req, res) => {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS count FROM private_messages WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL",
    [req.user.id]
  );
  res.json({ count: Number(row.count || 0) });
});

router.post("/private-messages", requireAuth, upload.single("attachment"), async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot chat or send PMs." });
  if (!(await hasTool(req.user, "sendPm"))) return res.status(403).json({ error: "Your rank cannot send private messages." });
  if (req.file && !(await hasTool(req.user, "sendFiles"))) return res.status(403).json({ error: "Your rank cannot send files." });
  const form = req.body || {};
  const receiverId = Number(form.receiverId);
  if (!receiverId || receiverId === Number(req.user.id)) return res.status(400).json({ error: "Choose another user to message." });
  const [[blocked]] = await pool.query("SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)", [receiverId, req.user.id, req.user.id, receiverId]);
  if (blocked.count) return res.status(403).json({ error: "Private message blocked." });
  const body = String(form.body || "").trim().slice(0, 1200);
  const attachmentUrl = req.file ? fileToDataUrl(req.file) : null;
  if (!body && !attachmentUrl) return res.status(400).json({ error: "Message or image required." });
  const [result] = await pool.query(
    "INSERT INTO private_messages (sender_id, receiver_id, body, attachment_url, attachment_type) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, receiverId, body, attachmentUrl, req.file?.mimetype || null]
  );
  const payload = {
    id: result.insertId,
    senderId: req.user.id,
    senderUsername: req.user.username,
    receiverId,
    body,
    attachmentUrl,
    createdAt: new Date()
  };
  notifyUser(receiverId, "private-message", payload);
  res.status(201).json(payload);
});

router.get("/private-messages/:userId", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pm.*, su.username AS sender_username, ru.username AS receiver_username
     FROM private_messages pm
     JOIN users su ON su.id = pm.sender_id
     JOIN users ru ON ru.id = pm.receiver_id
     WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 100`,
    [req.user.id, req.params.userId, req.params.userId, req.user.id]
  );
  await pool.query("UPDATE private_messages SET read_at = NOW() WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL", [req.user.id, req.params.userId]);
  res.json(rows);
});

router.delete("/private-messages/:userId", requireAuth, async (req, res) => {
  if (!(await canDeletePrivateChats(req.user))) return res.status(403).json({ error: "Only higher staff can delete private chats." });
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === Number(req.user.id)) return res.status(400).json({ error: "Choose another user chat to delete." });
  const [result] = await pool.query(
    `UPDATE private_messages
     SET deleted_at = NOW()
     WHERE deleted_at IS NULL
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
    [req.user.id, otherUserId, otherUserId, req.user.id]
  );
  notifyUser(otherUserId, "private-chat-deleted", { otherUserId: req.user.id, by: req.user.id });
  res.json({ ok: true, deleted: result.affectedRows || 0 });
});

module.exports = router;
