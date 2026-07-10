function normalizeUsername(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,18}$/.test(username || "");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

function isDuplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" || error?.errno === 1062;
}

function duplicateKeyField(error) {
  const message = String(error?.sqlMessage || error?.message || "").toLowerCase();
  if (message.includes("username")) return "username";
  if (message.includes("email")) return "email";
  return "";
}

function duplicateKeyMessage(error) {
  const field = duplicateKeyField(error);
  if (field === "username") return "This username is already taken.";
  if (field === "email") return "This email is already taken.";
  return "This username or email is already taken.";
}

async function findUserIdentityConflict(pool, { username = "", email = "", excludeId = null } = {}) {
  const conditions = [];
  const params = [];

  if (username) {
    conditions.push("LOWER(username) = LOWER(?)");
    params.push(username);
  }
  if (email) {
    conditions.push("LOWER(email) = LOWER(?)");
    params.push(email);
  }
  if (!conditions.length) return { username: null, email: null };

  let sql = `SELECT id, username, email FROM users WHERE (${conditions.join(" OR ")})`;
  if (excludeId !== null && excludeId !== undefined) {
    sql += " AND id <> ?";
    params.push(excludeId);
  }
  sql += " LIMIT 20";

  const [rows] = await pool.query(sql, params);
  const wantedUsername = String(username || "").toLowerCase();
  const wantedEmail = String(email || "").toLowerCase();

  return {
    username: wantedUsername
      ? rows.find((row) => String(row.username || "").toLowerCase() === wantedUsername) || null
      : null,
    email: wantedEmail
      ? rows.find((row) => String(row.email || "").toLowerCase() === wantedEmail) || null
      : null,
  };
}

module.exports = {
  normalizeUsername,
  normalizeEmail,
  isValidUsername,
  isValidEmail,
  isDuplicateKeyError,
  duplicateKeyMessage,
  findUserIdentityConflict,
};
