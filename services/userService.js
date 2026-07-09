const pool = require("../database");

function calculateAge(dob) {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function publicUser(user, viewer = null) {
  if (!user) return null;
  const canSeePrivate = viewer && ["developer", "chief", "admin"].includes(viewer.rank_name);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: canSeePrivate ? user.email : undefined,
    dob: user.dob,
    age: user.age,
    gender: user.gender,
    rank: user.rank_name,
    avatarUrl: user.avatar_url,
    bannerUrl: user.banner_url,
    animatedBannerUrl: user.animated_banner_url,
    profileMusicUrl: user.profile_music_url,
    profileTitle: user.profile_title,
    profileStatus: user.profile_status,
    profileAccent: user.profile_accent,
    showOnlineStatus: Boolean(user.show_online_status),
    bio: user.bio,
    aboutMe: user.about_me,
    mood: user.mood,
    theme: user.theme,
    bubbleStyle: user.bubble_style,
    usernameColor: user.username_color,
    textColor: user.text_color,
    frame: user.frame,
    xp: user.xp,
    gold: user.gold,
    diamonds: user.diamonds,
    messageCount: user.message_count,
    profileLikes: user.profile_likes,
    visitorCount: user.visitor_count,
    svipUntil: user.svip_until,
    ip: canSeePrivate ? user.ip_address : undefined,
    country: user.country,
    mutedUntil: user.muted_until,
    kickedUntil: user.kicked_until,
    bannedUntil: user.banned_until,
    deleteRequestedAt: user.delete_requested_at,
    lastSeen: user.last_seen,
    online: user.show_online_status === 0 || user.profile_status === "Invisible" ? false : (user.last_seen ? Date.now() - new Date(user.last_seen).getTime() < 5 * 60 * 1000 : false),
    createdAt: user.created_at,
  };
}

async function userById(id) {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] || null;
}

async function rankBadges() {
  const [rows] = await pool.query("SELECT * FROM rank_badges");
  return Object.fromEntries(rows.map((row) => [row.rank_name, {
    label: row.label,
    color: row.color,
    imageUrl: row.image_url,
  }]));
}

async function adminStats() {
  const [[users]] = await pool.query("SELECT COUNT(*) AS total FROM users");
  const [[staff]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE rank_name IN ('moderator','admin','visor','superadmin','supervisor','super visor','inspector','manager','chief','developer')");
  const [[rooms]] = await pool.query("SELECT COUNT(*) AS total FROM rooms");
  const [[reports]] = await pool.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'open'");
  return { totalUsers: users.total, staffCount: staff.total, rooms: rooms.total, openReports: reports.total };
}

module.exports = { calculateAge, publicUser, userById, rankBadges, adminStats };
