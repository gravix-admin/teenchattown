const jwt = require("jsonwebtoken");
const pool = require("../database");

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (req.query.token) return String(req.query.token);
  return "";
}

async function attachUser(req, _res, next) {
  const token = tokenFromRequest(req);
  req.user = null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [payload.id]);
    req.user = rows[0] || null;
  } catch (_error) {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Login required." });
  if (req.user.banned_until && new Date(req.user.banned_until) > new Date()) {
    return res.status(403).json({ error: "This account is banned." });
  }
  if (req.user.kicked_until && new Date(req.user.kicked_until) > new Date()) {
    return res.status(403).json({ error: "You were temporarily kicked. Please try again later." });
  }
  next();
}

function rankPower(rank) {
  const normalized = rank === "super visor" ? "supervisor" : rank;
  const order = ["user", "vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "inspector", "manager", "chief", "developer"];
  return order.indexOf(normalized);
}

function canControl(actorRank, targetRank) {
  if (actorRank === "developer") return targetRank !== "developer";
  if (actorRank === "chief") return rankPower(targetRank) < rankPower("chief");
  if (actorRank === "manager") return rankPower(targetRank) < rankPower("manager");
  if (actorRank === "inspector") return rankPower(targetRank) < rankPower("inspector");
  if (actorRank === "supervisor" || actorRank === "super visor") return rankPower(targetRank) < rankPower("supervisor");
  if (actorRank === "superadmin") return rankPower(targetRank) < rankPower("superadmin");
  if (actorRank === "visor") return rankPower(targetRank) < rankPower("visor");
  if (actorRank === "admin") return rankPower(targetRank) < rankPower("admin");
  if (actorRank === "moderator") return rankPower(targetRank) < rankPower("moderator");
  return false;
}

function isStaff(user) {
  return ["moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"].includes(user?.rank_name);
}

module.exports = { attachUser, requireAuth, canControl, isStaff, rankPower };
