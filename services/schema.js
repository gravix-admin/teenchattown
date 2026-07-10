const bcrypt = require("bcrypt");
const pool = require("../database");

const ranks = ["user", "vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "inspector", "manager", "chief", "developer"];
const staffTools = ["mute", "kick", "ban", "warn", "deleteMessage", "deleteAccount", "changeRank", "editProfile", "customTitle", "invisibleStatus", "sendPm", "sendFiles", "createRoom", "editRoom", "seeIp", "postNews"];

async function query(sql) {
  await pool.query(sql);
}

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  if (!rows[0].count) await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureColumnDefinition(table, column, definition, dataType) {
  await ensureColumn(table, column, definition);
  const [rows] = await pool.query(
    "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  if (rows[0] && String(rows[0].DATA_TYPE || "").toLowerCase() !== dataType.toLowerCase()) {
    await query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureAutoIncrementId(table) {
  const [columns] = await pool.query(
    "SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'",
    [table]
  );
  if (!columns.length || String(columns[0].EXTRA || "").includes("auto_increment")) return;

  const [keys] = await pool.query(
    "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id' AND CONSTRAINT_NAME = 'PRIMARY'",
    [table]
  );
  if (!keys.length) {
    await query(`ALTER TABLE ${table} ADD PRIMARY KEY (id)`);
  }
  await query(`ALTER TABLE ${table} MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT`);
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return Boolean(rows[0].count);
}

async function ensureUniqueIndex(table, indexName, column) {
  const [indexes] = await pool.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
       AND NON_UNIQUE = 0
     LIMIT 1`,
    [table, column]
  );
  if (indexes.length) return;
  await query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${column}\`)`);
}

function legacyUsername(id, value) {
  const suffix = `_${id}`;
  const base = String(value || "user").trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "user";
  return `${base.slice(0, Math.max(1, 18 - suffix.length))}${suffix}`;
}

async function normalizeUserIdentityColumn(column, normalize, fallback) {
  const [rows] = await pool.query(`SELECT id, \`${column}\` AS value FROM users ORDER BY id`);
  const seen = new Set();

  for (const row of rows) {
    const current = normalize(row.value);
    let next = current;
    if (!current || seen.has(current.toLowerCase())) {
      next = fallback(row.id, current);
      let counter = 2;
      while (seen.has(next.toLowerCase())) {
        next = fallback(`${row.id}_${counter}`, current);
        counter += 1;
      }
    }

    if (next !== row.value) {
      await pool.query(`UPDATE users SET \`${column}\` = ? WHERE id = ?`, [next, row.id]);
    }
    seen.add(next.toLowerCase());
  }
}

async function ensureUserIdentitiesAreUnique() {
  await normalizeUserIdentityColumn(
    "username",
    (value) => String(value || "").trim(),
    (id, value) => legacyUsername(id, value)
  );
  await normalizeUserIdentityColumn(
    "email",
    (value) => String(value || "").trim().toLowerCase(),
    (id) => `user${id}@teens-town.local`
  );
  await ensureUniqueIndex("users", "unique_users_username", "username");
  await ensureUniqueIndex("users", "unique_users_email", "email");
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(32) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      dob DATE NOT NULL,
      age INT NOT NULL,
      gender VARCHAR(20) DEFAULT 'other',
      rank_name VARCHAR(32) DEFAULT 'user',
      display_name VARCHAR(40) DEFAULT '',
      avatar_url MEDIUMTEXT NULL,
      banner_url MEDIUMTEXT NULL,
      animated_banner_url MEDIUMTEXT NULL,
      profile_music_url TEXT NULL,
      profile_title VARCHAR(80) DEFAULT '',
      profile_status VARCHAR(40) DEFAULT 'Online',
      profile_accent VARCHAR(24) DEFAULT '#ef4444',
      show_online_status TINYINT DEFAULT 1,
      bio VARCHAR(240) DEFAULT '',
      about_me TEXT NULL,
      mood VARCHAR(80) DEFAULT '',
      theme VARCHAR(32) DEFAULT 'dark',
      bubble_style VARCHAR(32) DEFAULT 'default',
      username_color VARCHAR(24) DEFAULT '',
      text_color VARCHAR(24) DEFAULT '',
      frame VARCHAR(32) DEFAULT 'clean',
      xp INT DEFAULT 0,
      gold INT DEFAULT 100,
      diamonds INT DEFAULT 5,
      message_count INT DEFAULT 0,
      online_minutes_rewarded INT DEFAULT 0,
      profile_likes INT DEFAULT 0,
      visitor_count INT DEFAULT 0,
      svip_until DATETIME NULL,
      ip_address VARCHAR(80) DEFAULT '',
      country VARCHAR(80) DEFAULT '',
      muted_until DATETIME NULL,
      kicked_until DATETIME NULL,
      banned_until DATETIME NULL,
      delete_requested_at DATETIME NULL,
      last_seen DATETIME NULL,
      last_online_reward_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(255) NOT NULL,
      image_url MEDIUMTEXT NULL,
      password_hash VARCHAR(255) NULL,
      is_pinned TINYINT DEFAULT 0,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_access (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_id INT NOT NULL,
      user_id INT NOT NULL,
      unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_room_access (room_id, user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_id INT NOT NULL,
      user_id INT NOT NULL,
      body TEXT,
      attachment_url MEDIUMTEXT NULL,
      attachment_type VARCHAR(40) NULL,
      reply_to_id INT NULL,
      is_pinned TINYINT DEFAULT 0,
      edited_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sender_id INT NOT NULL,
      receiver_id INT NOT NULL,
      body TEXT NULL,
      attachment_url MEDIUMTEXT NULL,
      attachment_type VARCHAR(40) NULL,
      read_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      user_id INT NOT NULL,
      emoji VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_reaction (message_id, user_id, emoji)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_user_id INT NOT NULL,
      to_user_id INT NOT NULL,
      status ENUM('pending','accepted','declined') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY one_request (from_user_id, to_user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS friends (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      friend_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_friend (user_id, friend_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      blocker_id INT NOT NULL,
      blocked_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_block (blocker_id, blocked_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS follows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      follower_id INT NOT NULL,
      following_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_follow (follower_id, following_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(40) NOT NULL,
      title VARCHAR(120) NOT NULL,
      body VARCHAR(255) DEFAULT '',
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS profile_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      profile_user_id INT NOT NULL,
      liker_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_profile_like (profile_user_id, liker_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS profile_gallery (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      image_url MEDIUMTEXT NULL,
      caption VARCHAR(180) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS wall_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      profile_user_id INT NOT NULL,
      author_id INT NOT NULL,
      body VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_user_id INT NOT NULL,
      to_user_id INT NOT NULL,
      gift_code VARCHAR(40) NOT NULL,
      title VARCHAR(80) NOT NULL,
      cost_gold INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS wallet_transfers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_user_id INT NOT NULL,
      to_user_id INT NOT NULL,
      currency ENUM('gold','diamonds') DEFAULT 'gold',
      amount INT NOT NULL,
      note VARCHAR(160) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS achievements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(60) NOT NULL UNIQUE,
      title VARCHAR(100) NOT NULL,
      description VARCHAR(255) NOT NULL,
      badge_color VARCHAR(24) DEFAULT '#8b5cf6'
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      achievement_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY one_achievement (user_id, achievement_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rank_badges (
      rank_name VARCHAR(32) PRIMARY KEY,
      label VARCHAR(16) NOT NULL,
      color VARCHAR(24) NOT NULL,
      image_url MEDIUMTEXT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      rank_name VARCHAR(32) NOT NULL,
      tool VARCHAR(60) NOT NULL,
      allowed TINYINT DEFAULT 0,
      PRIMARY KEY (rank_name, tool)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT NOT NULL,
      target_type VARCHAR(40) DEFAULT 'user',
      target_user_id INT NULL,
      message_id INT NULL,
      room_id INT NULL,
      private_message_id INT NULL,
      wall_post_id INT NULL,
      reason VARCHAR(255) NOT NULL,
      status VARCHAR(40) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS news_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      author_id INT NOT NULL,
      title VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      image_url MEDIUMTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS news_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      news_id INT NOT NULL,
      user_id INT NOT NULL,
      body VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NOT NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40) DEFAULT '',
      target_id INT NULL,
      details TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await migrateExistingTables();
  await ensureUserIdentitiesAreUnique();

  await seedDefaults();
}

async function migrateExistingTables() {
  const migrations = {
    users: {
      username: "VARCHAR(32) NOT NULL DEFAULT ''",
      email: "VARCHAR(120) NOT NULL DEFAULT ''",
      password_hash: "VARCHAR(255) NOT NULL DEFAULT ''",
      dob: "DATE NULL",
      age: "INT DEFAULT 0",
      gender: "VARCHAR(20) DEFAULT 'other'",
      rank_name: "VARCHAR(32) DEFAULT 'user'",
      display_name: "VARCHAR(40) DEFAULT ''",
      avatar_url: "MEDIUMTEXT NULL",
      banner_url: "MEDIUMTEXT NULL",
      animated_banner_url: "MEDIUMTEXT NULL",
      profile_music_url: "TEXT NULL",
      profile_title: "VARCHAR(80) DEFAULT ''",
      profile_status: "VARCHAR(40) DEFAULT 'Online'",
      profile_accent: "VARCHAR(24) DEFAULT '#ef4444'",
      show_online_status: "TINYINT DEFAULT 1",
      bio: "VARCHAR(240) DEFAULT ''",
      about_me: "TEXT NULL",
      mood: "VARCHAR(80) DEFAULT ''",
      theme: "VARCHAR(32) DEFAULT 'dark'",
      bubble_style: "VARCHAR(32) DEFAULT 'default'",
      username_color: "VARCHAR(24) DEFAULT ''",
      text_color: "VARCHAR(24) DEFAULT ''",
      frame: "VARCHAR(32) DEFAULT 'clean'",
      xp: "INT DEFAULT 0",
      gold: "INT DEFAULT 100",
      diamonds: "INT DEFAULT 5",
      message_count: "INT DEFAULT 0",
      online_minutes_rewarded: "INT DEFAULT 0",
      profile_likes: "INT DEFAULT 0",
      visitor_count: "INT DEFAULT 0",
      svip_until: "DATETIME NULL",
      ip_address: "VARCHAR(80) DEFAULT ''",
      country: "VARCHAR(80) DEFAULT ''",
      muted_until: "DATETIME NULL",
      kicked_until: "DATETIME NULL",
      banned_until: "DATETIME NULL",
      delete_requested_at: "DATETIME NULL",
      last_seen: "DATETIME NULL",
      last_online_reward_at: "DATETIME NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    rooms: {
      name: "VARCHAR(80) NOT NULL DEFAULT ''",
      description: "VARCHAR(255) NOT NULL DEFAULT ''",
      image_url: "MEDIUMTEXT NULL",
      password_hash: "VARCHAR(255) NULL",
      is_pinned: "TINYINT DEFAULT 0",
      created_by: "INT NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    room_access: {
      room_id: "INT NOT NULL DEFAULT 1",
      user_id: "INT NOT NULL DEFAULT 1",
      unlocked_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    messages: {
      room_id: "INT NOT NULL DEFAULT 1",
      user_id: "INT NOT NULL DEFAULT 1",
      body: "TEXT NULL",
      attachment_url: "MEDIUMTEXT NULL",
      attachment_type: "VARCHAR(40) NULL",
      reply_to_id: "INT NULL",
      is_pinned: "TINYINT DEFAULT 0",
      edited_at: "DATETIME NULL",
      deleted_at: "DATETIME NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    private_messages: {
      sender_id: "INT NOT NULL DEFAULT 1",
      receiver_id: "INT NOT NULL DEFAULT 1",
      body: "TEXT NULL",
      attachment_url: "MEDIUMTEXT NULL",
      attachment_type: "VARCHAR(40) NULL",
      read_at: "DATETIME NULL",
      deleted_at: "DATETIME NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    message_reactions: {
      message_id: "INT NOT NULL DEFAULT 1",
      user_id: "INT NOT NULL DEFAULT 1",
      emoji: "VARCHAR(20) NOT NULL DEFAULT 'like'",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    friend_requests: {
      from_user_id: "INT NOT NULL DEFAULT 1",
      to_user_id: "INT NOT NULL DEFAULT 1",
      status: "VARCHAR(20) DEFAULT 'pending'",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL",
    },
    friends: {
      user_id: "INT NOT NULL DEFAULT 1",
      friend_id: "INT NOT NULL DEFAULT 1",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    blocks: {
      blocker_id: "INT NOT NULL DEFAULT 1",
      blocked_id: "INT NOT NULL DEFAULT 1",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    follows: {
      follower_id: "INT NOT NULL DEFAULT 1",
      following_id: "INT NOT NULL DEFAULT 1",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    notifications: {
      user_id: "INT NOT NULL DEFAULT 1",
      type: "VARCHAR(40) NOT NULL DEFAULT 'notice'",
      title: "VARCHAR(120) NOT NULL DEFAULT ''",
      body: "VARCHAR(255) DEFAULT ''",
      is_read: "TINYINT DEFAULT 0",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    profile_gallery: {
      user_id: "INT NOT NULL DEFAULT 1",
      image_url: "MEDIUMTEXT NULL",
      caption: "VARCHAR(180) DEFAULT ''",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    profile_likes: {
      profile_user_id: "INT NOT NULL DEFAULT 1",
      liker_id: "INT NOT NULL DEFAULT 1",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    wall_posts: {
      profile_user_id: "INT NOT NULL DEFAULT 1",
      author_id: "INT NOT NULL DEFAULT 1",
      body: "VARCHAR(500) NOT NULL DEFAULT ''",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    gifts: {
      from_user_id: "INT NOT NULL DEFAULT 1",
      to_user_id: "INT NOT NULL DEFAULT 1",
      gift_code: "VARCHAR(40) NOT NULL DEFAULT 'star'",
      title: "VARCHAR(80) NOT NULL DEFAULT 'Gift'",
      cost_gold: "INT DEFAULT 0",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    wallet_transfers: {
      from_user_id: "INT NOT NULL DEFAULT 1",
      to_user_id: "INT NOT NULL DEFAULT 1",
      currency: "VARCHAR(20) DEFAULT 'gold'",
      amount: "INT NOT NULL DEFAULT 0",
      note: "VARCHAR(160) DEFAULT ''",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    achievements: {
      code: "VARCHAR(60) NOT NULL DEFAULT ''",
      title: "VARCHAR(100) NOT NULL DEFAULT ''",
      description: "VARCHAR(255) NOT NULL DEFAULT ''",
      badge_color: "VARCHAR(24) DEFAULT '#8b5cf6'",
    },
    user_achievements: {
      user_id: "INT NOT NULL DEFAULT 1",
      achievement_id: "INT NOT NULL DEFAULT 1",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    rank_badges: {
      rank_name: "VARCHAR(32) NOT NULL DEFAULT ''",
      label: "VARCHAR(16) NOT NULL DEFAULT ''",
      color: "VARCHAR(24) NOT NULL DEFAULT '#8b5cf6'",
      image_url: "MEDIUMTEXT NULL",
    },
    role_permissions: {
      rank_name: "VARCHAR(32) NOT NULL DEFAULT ''",
      tool: "VARCHAR(60) NOT NULL DEFAULT ''",
      allowed: "TINYINT DEFAULT 0",
    },
    reports: {
      reporter_id: "INT NOT NULL DEFAULT 1",
      target_type: "VARCHAR(40) DEFAULT 'user'",
      target_user_id: "INT NULL",
      message_id: "INT NULL",
      room_id: "INT NULL",
      private_message_id: "INT NULL",
      wall_post_id: "INT NULL",
      reason: "VARCHAR(255) NOT NULL DEFAULT ''",
      status: "VARCHAR(40) DEFAULT 'open'",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    news_posts: {
      author_id: "INT NOT NULL DEFAULT 1",
      title: "VARCHAR(120) NOT NULL DEFAULT ''",
      body: "TEXT NULL",
      image_url: "MEDIUMTEXT NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    news_comments: {
      news_id: "INT NOT NULL DEFAULT 1",
      user_id: "INT NOT NULL DEFAULT 1",
      body: "VARCHAR(500) NOT NULL DEFAULT ''",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    admin_logs: {
      actor_id: "INT NOT NULL DEFAULT 1",
      action: "VARCHAR(80) NOT NULL DEFAULT ''",
      target_type: "VARCHAR(40) DEFAULT ''",
      target_id: "INT NULL",
      details: "TEXT NULL",
      created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
  };

  for (const [table, columns] of Object.entries(migrations)) {
    await ensureAutoIncrementId(table);
    for (const [column, definition] of Object.entries(columns)) {
      await ensureColumn(table, column, definition);
    }
  }

  const mediumTextColumns = {
    users: ["avatar_url", "banner_url", "animated_banner_url"],
    rooms: ["image_url"],
    messages: ["attachment_url"],
    private_messages: ["attachment_url"],
    profile_gallery: ["image_url"],
    rank_badges: ["image_url"],
    news_posts: ["image_url"],
  };
  for (const [table, columns] of Object.entries(mediumTextColumns)) {
    for (const column of columns) {
      await ensureColumnDefinition(table, column, "MEDIUMTEXT NULL", "mediumtext");
    }
  }

  await relaxLegacyRequiredColumns();
  await migrateLegacyUserData();
}

async function relaxLegacyRequiredColumns() {
  const [columns] = await pool.query(`
    SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      ON k.TABLE_SCHEMA = c.TABLE_SCHEMA
      AND k.TABLE_NAME = c.TABLE_NAME
      AND k.COLUMN_NAME = c.COLUMN_NAME
      AND k.CONSTRAINT_NAME = 'PRIMARY'
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND c.COLUMN_NAME <> 'id'
      AND c.IS_NULLABLE = 'NO'
      AND c.COLUMN_DEFAULT IS NULL
      AND c.EXTRA NOT LIKE '%auto_increment%'
      AND k.COLUMN_NAME IS NULL
  `);

  for (const column of columns) {
    const table = column.TABLE_NAME.replace(/`/g, "");
    const name = column.COLUMN_NAME.replace(/`/g, "");
    await query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${name}\` ${column.COLUMN_TYPE} NULL`);
  }
}

async function migrateLegacyUserData() {
  const updates = [
    ["passwordHash", "password_hash", "text"],
    ["birthday", "dob", "date"],
    ["user_rank", "rank_name", "text"],
    ["textCount", "message_count", "number"],
    ["ip", "ip_address", "text"],
    ["aboutMe", "about_me", "text"],
    ["profileMusic", "profile_music_url", "text"],
    ["textColor", "text_color", "text"],
    ["usernameColor", "username_color", "text"],
    ["deleteRequestedAt", "delete_requested_at", "date"],
    ["createdAt", "created_at", "date"],
  ];

  for (const [legacy, modern, type] of updates) {
    if (await columnExists("users", legacy)) {
      const condition = type === "text"
        ? `(\`${modern}\` IS NULL OR \`${modern}\` = '')`
        : `\`${modern}\` IS NULL`;
      await pool.query(
        `UPDATE users SET \`${modern}\` = \`${legacy}\` WHERE ${condition} AND \`${legacy}\` IS NOT NULL`
      );
    }
  }

  if (await columnExists("users", "avatar")) {
    await pool.query("UPDATE users SET avatar_url = avatar WHERE (avatar_url IS NULL OR avatar_url = '') AND avatar IS NOT NULL");
  }
  if (await columnExists("users", "banner")) {
    await pool.query("UPDATE users SET banner_url = banner WHERE (banner_url IS NULL OR banner_url = '') AND banner IS NOT NULL");
  }
  if (await columnExists("users", "mutedUntil")) {
    await pool.query("UPDATE users SET muted_until = FROM_UNIXTIME(mutedUntil / 1000) WHERE muted_until IS NULL AND mutedUntil > 0");
  }
  if (await columnExists("users", "banned")) {
    await pool.query("UPDATE users SET banned_until = DATE_ADD(NOW(), INTERVAL 365 DAY) WHERE banned_until IS NULL AND banned = 1");
  }
  await pool.query("UPDATE users SET rank_name = 'supervisor' WHERE rank_name = 'super visor'");
  await pool.query("INSERT IGNORE INTO role_permissions (rank_name, tool, allowed) SELECT 'supervisor', tool, allowed FROM role_permissions WHERE rank_name = 'super visor'");
  await pool.query("DELETE FROM role_permissions WHERE rank_name = 'super visor'");
  await pool.query("INSERT IGNORE INTO rank_badges (rank_name, label, color, image_url) SELECT 'supervisor', label, color, image_url FROM rank_badges WHERE rank_name = 'super visor'");
  await pool.query("DELETE FROM rank_badges WHERE rank_name = 'super visor'");
}

async function seedDefaults() {
  const [rooms] = await pool.query("SELECT COUNT(*) AS count FROM rooms");
  if (!rooms[0].count) {
    await pool.query(
      "INSERT INTO rooms (name, description, image_url, is_pinned) VALUES ?",
      [[
        ["Town Square", "The main Teens Town hangout for casual real-time chat.", "/assets/room-main.svg", 1],
        ["Game Arcade", "Games, squads, tournaments, and quick match talk.", "/assets/room-gaming.svg", 1],
        ["Music Park", "Songs, playlists, profile music, and voice vibes.", "/assets/room-music.svg", 0],
        ["VIP Loft", "VIP, S-VIP, and Premium style hangout.", "/assets/room-vip.svg", 0],
        ["Help Desk", "Staff help, reports, rules, and account support.", "/assets/room-support.svg", 0],
      ]]
    );
  }

  for (const rank of ranks) {
    const label = {
      developer: "DEV",
      supervisor: "SUP",
      superadmin: "S-ADM",
      inspector: "INSP",
      manager: "MGR",
      premium: "PREM",
      "s-vip": "S-VIP",
    }[rank] || rank.toUpperCase().slice(0, 6);
    const color = {
      user: "#cbd5e1",
      vip: "#f7c948",
      "s-vip": "#a855f7",
      king: "#38bdf8",
      queen: "#fb7185",
      premium: "#ec4899",
      moderator: "#22c55e",
      admin: "#ef4444",
      visor: "#818cf8",
      superadmin: "#f43f5e",
      supervisor: "#10b981",
      inspector: "#14b8a6",
      manager: "#f97316",
      chief: "#f59e0b",
      developer: "#22d3ee",
    }[rank] || "#8b5cf6";
    await pool.query(
      "INSERT IGNORE INTO rank_badges (rank_name, label, color, image_url) VALUES (?, ?, ?, ?)",
      [rank, label, color, `/assets/badge-${rank.replaceAll(" ", "-")}.svg`]
    );
  }

  for (const rank of ranks.filter((rank) => rank !== "developer")) {
    for (const tool of staffTools) {
      const defaultAllowed = ["chief", "manager", "inspector", "supervisor", "superadmin"].includes(rank)
        || (rank === "admin" && !["seeIp", "postNews", "editProfile"].includes(tool))
        || (rank === "moderator" && ["mute", "kick", "warn", "deleteMessage"].includes(tool))
        || (tool === "sendPm")
        || (tool === "sendFiles" && rank !== "vip")
        || (["premium", "king", "queen", "s-vip"].includes(rank) && ["createRoom", "customTitle", "invisibleStatus"].includes(tool))
        || (["vip"].includes(rank) && tool === "invisibleStatus");
      await pool.query(
        "INSERT IGNORE INTO role_permissions (rank_name, tool, allowed) VALUES (?, ?, ?)",
        [rank, tool, defaultAllowed ? 1 : 0]
      );
    }
  }

  const [adminRows] = await pool.query("SELECT id FROM users WHERE LOWER(username) = 'admin'");
  if (!adminRows.length) {
    const hash = await bcrypt.hash("123456", 10);
    const email = await unusedAdminEmail("test121@gmail.com");
    await pool.query(
      `INSERT INTO users
       (username, email, password_hash, dob, age, gender, rank_name, bio, about_me, xp, gold, diamonds, ip_address, country, frame, theme)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["admin", email, hash, "2007-07-08", 19, "other", "developer", "Developer account.", "Master account for Teens Town Chat.", 5000, 99999, 9999, "local", "Auto detected", "developer", "premium"]
    );
  }

  const achievements = [
    ["first_message", "First Message", "Sent your first message.", "#22d3ee"],
    ["ten_messages", "Town Talker", "Sent 10 messages.", "#f7c948"],
    ["first_friend", "First Friend", "Made your first friend.", "#22c55e"],
    ["profile_ready", "Profile Ready", "Updated your profile.", "#ec4899"],
  ];
  for (const item of achievements) {
    await pool.query(
      "INSERT IGNORE INTO achievements (code, title, description, badge_color) VALUES (?, ?, ?, ?)",
      item
    );
  }
}

async function unusedAdminEmail(preferred) {
  const candidates = [preferred, "admin@teens-town.local"];
  for (let index = 2; index < 100; index += 1) {
    candidates.push(`admin${index}@teens-town.local`);
  }

  for (const candidate of candidates) {
    const [rows] = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1", [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin${Date.now()}@teens-town.local`;
}

module.exports = { initSchema, ranks, staffTools };
