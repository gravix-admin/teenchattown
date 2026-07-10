const state = {
  token: localStorage.getItem("tct_token") || "",
  me: null,
  rooms: [],
  users: [],
  messages: [],
  rankBadges: {},
  notifications: [],
  friendRequests: [],
  friends: [],
  blocks: [],
  currentRoomId: null,
  replyToId: null,
  selectedUserId: null,
  activePmUserId: null,
  uploadFile: null,
  pmUploadFile: null,
  lastTapMessageId: null,
  lastTapAt: 0,
  userTab: "all",
  unreadPm: 0,
  unreadNews: localStorage.getItem("tct_news_unread") === "1",
  leaderboardTab: "xp",
  compactLayout: null,
  pmExpanded: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const staffRanks = new Set(["moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"]);
const rankOrder = ["user", "vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "inspector", "manager", "chief", "developer"];
const slashCommands = [
  ["/clear", "Staff: clear the current room"],
  ["@wb username", "Send a welcome back message"],
  ["/gif", "Search a GIF"],
  ["/sticker", "Send a sticker"],
  ["/poll Question | Yes | No", "Create a poll"],
  ["/me", "Roleplay action text"],
  ["/help", "Show command ideas"],
];
const giftCatalog = [
  ["rose", "Rose", 50],
  ["star", "Star", 100],
  ["crown", "Crown", 250],
  ["diamond", "Diamond", 500],
];
const emojiChoices = ["😀", "😂", "😊", "😍", "🥰", "😎", "😭", "😡", "👍", "👎", "👏", "🙏", "💀", "🔥", "✨", "❤️", "💙", "💎", "👑", "🎉", "🌙", "⭐", "😴", "🤝"];
const themeChoices = [
  ["dark", "Dark", "#0b1020"],
  ["light", "Light", "#f8fafc"],
  ["blue", "Blue", "#0f3a5d"],
  ["neon", "Neon", "#111827"],
  ["glass", "Glass", "#223044"],
];

function roomLocked(room) {
  return Boolean(room?.locked || room?.password_hash);
}

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...options, headers }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function toast(message) {
  let area = $("#toastArea");
  if (!area) {
    area = document.createElement("div");
    area.id = "toastArea";
    area.className = "toast-area";
    document.body.append(area);
  }
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  area.append(item);
  setTimeout(() => item.remove(), 3600);
}

function rankBadge(rank, labelOverride = "") {
  const badge = state.rankBadges[rank] || { label: rank, color: "#8b5cf6" };
  const image = badge.imageUrl ? `<img src="${html(badge.imageUrl)}" alt="" />` : "";
  const label = String(labelOverride || badge.label || rank || "user").slice(0, 18);
  return `<span class="rank-pill rank-${html(String(rank || "user").replaceAll(" ", "-"))}" style="--rank-color:${html(badge.color)}">${image}${html(label)}</span>`;
}

function userRankBadge(user) {
  return rankBadge(user?.rank || user?.rank_name, user?.profileTitle || user?.profile_title || "");
}

function permissionLabel(tool) {
  return {
    sendPm: "Can send PMs",
    sendFiles: "Can send files",
    deleteMessage: "Delete messages",
    deleteAccount: "Delete accounts",
    changeRank: "Change ranks",
    editProfile: "Edit profiles",
    customTitle: "Custom titles",
    invisibleStatus: "Invisible status",
    createRoom: "Create rooms",
    editRoom: "Edit rooms",
    seeIp: "See IP",
    postNews: "Post news",
  }[tool] || tool;
}

function displayName(user) {
  return user?.displayName || user?.display_name || user?.username || "User";
}

function avatar(user) {
  return user?.avatarUrl || user?.avatar_url || `/assets/avatar-${user?.gender || "other"}.svg`;
}

function userById(id) {
  return state.users.find((user) => Number(user.id) === Number(id));
}

function rankAtLeast(rank, minimum) {
  const current = rankOrder.indexOf(rank === "super visor" ? "supervisor" : rank);
  const required = rankOrder.indexOf(minimum);
  return current >= required && required >= 0;
}

function canDeletePrivateChats() {
  return state.me?.rank === "developer" || rankAtLeast(state.me?.rank, "admin");
}

function setDrawerChrome({ title = "", account = false, user = false, pm = false } = {}) {
  const drawer = $("#drawer");
  if (!drawer) return;
  drawer.classList.toggle("account-drawer", account);
  drawer.classList.toggle("user-drawer", user);
  drawer.classList.toggle("pm-drawer", pm);
  drawer.classList.toggle("pm-expanded", pm && state.pmExpanded);
  $("#drawerTitle").textContent = title;
  const actions = $("#drawerActions");
  if (actions) actions.innerHTML = "";
}

function showDrawer() {
  const drawer = $("#drawer");
  drawer.classList.remove("hidden");
  if (state.compactLayout && drawer.classList.contains("user-drawer")) {
    $("#app")?.classList.add("right-closed");
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat([], { year: "numeric", month: "short", day: "2-digit" }).format(new Date(value));
}

function isOnline(user) {
  if (!user || user.bannedUntil || user.kickedUntil) return false;
  if (user.profileStatus === "Invisible") return false;
  if (state.me && Number(user.id) === Number(state.me.id)) return true;
  if (user.online) return true;
  if (!user.lastSeen) return false;
  return Date.now() - new Date(user.lastSeen).getTime() < 30 * 60 * 1000;
}

function visibleInUserList(user) {
  return user && user.profileStatus !== "Invisible";
}

function levelInfo(xp = 0) {
  let level = 0;
  let needed = 10;
  let remaining = Number(xp || 0);
  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed += 10;
  }
  return { level, current: remaining, next: needed };
}

function setView(view) {
  $$(".view").forEach((node) => node.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  $$(".side-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "rooms") renderRoomGrid();
  if (view === "news") {
    clearNewsUnread();
    renderNews().catch((error) => toast(error.message));
  }
  if (view === "leaderboard") renderLeaderboard().catch((error) => toast(error.message));
}

function setBadges() {
  setBadge($("#friendBadge"), state.friendRequests.length);
  setBadge($("#notificationBadge"), state.notifications.filter((item) => !item.is_read).length);
  setBadge($("#pmBadge"), state.unreadPm || 0);
  setNewsDot(state.unreadNews);
}

function setBadge(node, count) {
  if (!node) return;
  node.textContent = count > 0 ? String(count) : "";
  node.classList.toggle("hidden", count <= 0);
}

function setNewsDot(active) {
  $("#newsBadge")?.classList.toggle("hidden", !active);
  $("#newsTitleDot")?.classList.toggle("hidden", !active);
}

function markNewsUnread() {
  state.unreadNews = true;
  localStorage.setItem("tct_news_unread", "1");
  setBadges();
}

function clearNewsUnread() {
  state.unreadNews = false;
  localStorage.removeItem("tct_news_unread");
  setBadges();
}

function applyTheme(theme = "dark") {
  document.body.dataset.theme = theme;
  localStorage.setItem("tct_theme", theme);
}

function setTypingIdle() {
  const typing = $("#typingText");
  if (typing) typing.textContent = "No one is typing";
}

function syncResponsiveLayout() {
  const app = $("#app");
  if (!app) return;
  const compact = window.matchMedia("(max-width: 1180px)").matches;
  if (state.compactLayout === compact) return;
  state.compactLayout = compact;
  if (compact) {
    app.classList.add("right-closed");
    app.classList.remove("nav-open");
    return;
  }
  app.classList.remove("right-closed");
  app.classList.remove("nav-open");
}

async function refreshReportBadge() {
  if (!state.me || !staffRanks.has(state.me.rank)) return setBadge($("#reportBadge"), 0);
  const reports = await api("/api/admin/reports").catch(() => []);
  setBadge($("#reportBadge"), reports.filter((report) => report.status === "open").length);
}

function openEmojiPicker(inputSelector, anchor) {
  $(".emoji-picker")?.remove();
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = emojiChoices.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join("");
  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(12, rect.left - 6)}px`;
  picker.style.top = `${Math.max(12, rect.top - 238)}px`;
  picker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-emoji]");
    if (!button) return;
    const input = $(inputSelector);
    input.value += button.dataset.emoji;
    input.focus();
    picker.remove();
  });
}

async function bootstrap() {
  const data = await api("/api/auth/me");
  state.me = data.me;
  state.rooms = data.rooms;
  state.users = data.users;
  state.notifications = data.notifications || [];
  state.friendRequests = data.friendRequests || [];
  state.rankBadges = data.rankBadges || {};
  state.unreadPm = Number(data.unreadPm || 0);
  state.currentRoomId = state.currentRoomId || state.rooms[0]?.id;
  $("#authScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  syncResponsiveLayout();
  $("#topName").textContent = displayName(state.me);
  $("#topAvatar").src = avatar(state.me);
  $("#reportFlagIcon").classList.toggle("hidden", !staffRanks.has(state.me.rank));
  setBadges();
  refreshReportBadge().catch(() => {});
  renderRooms();
  renderUsers();
  renderProfiles();
  renderVip();
  await loadFriends();
  renderUsers();
  await loadMessages();
  connectEvents();
}

function renderRooms() {
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  if (room) {
    $("#roomTitle").textContent = room.name;
    $("#roomDescription").textContent = room.description;
    document.body.style.setProperty("--room-image", `url('${room.image_url || "/assets/room-main.svg"}')`);
  }
  renderRoomGrid();
}

function renderRoomGrid() {
  const grid = $("#roomGrid");
  if (!grid) return;
  grid.innerHTML = state.rooms.map((room) => `
    <button class="room-card ${Number(room.id) === Number(state.currentRoomId) ? "active" : ""}" data-room-card="${room.id}" type="button">
      <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
      <span>${roomLocked(room) ? "Locked" : "Open"}</span>
      <strong>${html(room.name)}</strong>
      <small>${html(room.description)}</small>
    </button>
  `).join("");
  $$("[data-room-card]").forEach((button) => button.addEventListener("click", async () => switchRoom(button.dataset.roomCard)));
}

function openRoomSwitcher() {
  setDrawerChrome({ title: "Change room" });
  $("#drawerBody").innerHTML = `
    <div class="room-switch-list">
      ${state.rooms.map((room) => `
        <button class="room-choice ${Number(room.id) === Number(state.currentRoomId) ? "active" : ""}" data-switch-room="${room.id}" type="button">
          <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
          <span><strong>${html(room.name)}</strong><small>${html(room.description)}</small></span>
          <em>${roomLocked(room) ? "Locked" : "Open"}</em>
        </button>
      `).join("")}
    </div>
  `;
  showDrawer();
  $$("[data-switch-room]").forEach((button) => button.addEventListener("click", async () => {
    await switchRoom(button.dataset.switchRoom);
  }));
}

async function switchRoom(roomId) {
  const room = state.rooms.find((item) => Number(item.id) === Number(roomId));
  if (!room) return;
  if (roomLocked(room) && !staffRanks.has(state.me.rank) && Number(room.created_by) !== Number(state.me.id)) {
    return openRoomPasswordModal(room);
  }
  state.currentRoomId = roomId;
  $("#drawer").classList.add("hidden");
  setView("chat");
  await loadMessages();
  renderRooms();
}

function openRoomPasswordModal(room) {
  $("#userActionBody").innerHTML = `
    <form class="room-password-card" id="roomPasswordForm">
      <div class="menu-profile">
        <img class="avatar" src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
        <div><h2>${html(room.name)}</h2><p class="muted">This room is password protected.</p></div>
      </div>
      <input name="password" type="password" placeholder="Room password" required />
      <button class="primary" type="submit">Enter room</button>
    </form>
  `;
  $("#roomPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api(`/api/chat/rooms/${room.id}/join`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    $("#userActionModal").close();
    state.currentRoomId = room.id;
    $("#drawer").classList.add("hidden");
    setView("chat");
    await loadMessages();
    renderRooms();
  });
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

async function loadMessages() {
  if (!state.currentRoomId) return;
  try {
    state.messages = await api(`/api/chat/rooms/${state.currentRoomId}/messages`);
    setTypingIdle();
    renderMessages();
  } catch (error) {
    const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
    if (error.message.includes("password") && room) return openRoomPasswordModal(room);
    toast(error.message);
  }
}

function parseReactions(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (!raw) return [];
  try {
    return JSON.parse(raw).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function renderMessages() {
  $("#messages").innerHTML = state.messages.map((message) => {
    const user = {
      id: message.user_id,
      username: message.username,
      rank: message.rank_name,
      avatarUrl: message.avatar_url,
      usernameColor: message.username_color,
      textColor: message.text_color,
      bubbleStyle: message.bubble_style,
      profileTitle: message.profile_title,
    };
    const reply = message.reply_to_id ? state.messages.find((item) => Number(item.id) === Number(message.reply_to_id)) : null;
    const isOwn = Number(message.user_id) === Number(state.me.id);
    const canModify = isOwn || staffRanks.has(state.me.rank);
    const reactions = parseReactions(message.reactions);
    const bubbleClass = ["vip", "premium"].includes(user.bubbleStyle) ? ` bubble-${user.bubbleStyle}` : "";
    return `
      <article class="message ${isOwn ? "own" : ""}${bubbleClass}" data-message-id="${message.id}">
        <button class="message-avatar-button" data-message-profile="${message.user_id}" type="button" title="View profile">
          <img class="avatar" src="${html(avatar(user))}" alt="" />
        </button>
        <div class="message-card" style="--message-color:${html(user.textColor || "#fbf7ff")}">
          <div class="message-topline">
            <div class="message-meta"><button class="message-author" data-tag-user="${html(user.username)}" type="button" style="${user.usernameColor ? `color:${html(user.usernameColor)}` : ""}">${html(user.username)}</button>${userRankBadge(user)}<time>${formatTime(message.created_at)}</time>${message.is_pinned ? '<span class="rank-pill">PIN</span>' : ""}</div>
            <div class="message-menu-wrap">
              <button class="message-menu-button" data-message-menu="${message.id}" type="button" title="Message options"><svg viewBox="0 0 24 24"><path d="M6 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/></svg></button>
              <div class="message-menu hidden" data-menu-for="${message.id}">
                <button data-reply="${message.id}" type="button">Reply</button>
                ${!isOwn ? `<button data-report-message="${message.id}" data-report-user="${message.user_id}" type="button">Report</button>` : ""}
                ${canModify ? `<button data-delete="${message.id}" type="button">Delete</button>` : ""}
              </div>
            </div>
          </div>
          ${reply ? `<div class="reply-preview"><strong>@${html(reply.username)}</strong><span>${html(String(reply.body || "").slice(0, 90))}</span></div>` : ""}
          <p>${renderMessageBody(message.body || "")}</p>
          ${message.attachment_url ? `<img class="attachment" src="${html(message.attachment_url)}" alt="attachment" />` : ""}
          <div class="badge-grid">${reactions.map((reaction) => `<span class="rank-pill">${html(reaction.emoji)} ${reaction.count}</span>`).join("")}</div>
        </div>
      </article>
    `;
  }).join("");
  bindMessageActions();
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function renderMessageBody(body) {
  if (/^@wb\s+/i.test(body)) {
    const username = body.replace(/^@wb\s+/i, "").trim();
    return `<div class="welcome-card"><span>Welcome back</span><strong>@${html(username)}</strong><small>The town saved your seat.</small></div>`;
  }
  if (body.startsWith("/poll ")) {
    const parts = body.slice(6).split("|").map((part) => part.trim()).filter(Boolean);
    const question = parts.shift() || "Poll";
    const options = parts.length ? parts : ["Yes", "No"];
    return `<div class="poll-card"><strong>${html(question)}</strong>${options.map((option) => `<button type="button">${html(option)}</button>`).join("")}</div>`;
  }
  return html(body)
    .replace(/@([a-zA-Z0-9_]+)/g, (_match, username) => {
      const taggedMe = state.me?.username && username.toLowerCase() === state.me.username.toLowerCase();
      return `<strong class="mention${taggedMe ? " mention-self" : ""}">@${html(username)}</strong>`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function closeMessageMenus() {
  $$(".message-menu").forEach((menu) => menu.classList.add("hidden"));
}

function renderSlashSuggestions() {
  const value = $("#messageInput").value.trimStart();
  const box = $("#slashSuggestions");
  if (!value.startsWith("/")) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const matches = slashCommands.filter(([command]) => command.toLowerCase().startsWith(value.toLowerCase()) || value === "/").slice(0, 5);
  box.innerHTML = matches.map(([command, help]) => `<button data-command="${html(command)}" type="button"><strong>${html(command)}</strong><span>${html(help)}</span></button>`).join("");
  box.classList.toggle("hidden", !matches.length);
  $$("[data-command]", box).forEach((button) => button.addEventListener("click", () => {
    $("#messageInput").value = `${button.dataset.command} `;
    $("#messageInput").focus();
    box.classList.add("hidden");
  }));
}

function bindMessageActions() {
  $$("[data-message-menu]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $(`[data-menu-for="${button.dataset.messageMenu}"]`);
    const wasHidden = menu.classList.contains("hidden");
    closeMessageMenus();
    menu.classList.toggle("hidden", !wasHidden);
  }));
  $$(".message-menu").forEach((menu) => menu.addEventListener("click", () => closeMessageMenus()));
  $$(".message-card", $("#messages")).forEach((card) => {
    const article = card.closest("[data-message-id]");
    const messageId = article?.dataset.messageId;
    if (!messageId) return;
    card.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      quoteMessage(messageId);
    });
    card.addEventListener("touchend", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      const now = Date.now();
      if (state.lastTapMessageId === messageId && now - state.lastTapAt < 360) {
        event.preventDefault();
        quoteMessage(messageId);
        state.lastTapMessageId = null;
        state.lastTapAt = 0;
        return;
      }
      state.lastTapMessageId = messageId;
      state.lastTapAt = now;
    }, { passive: false });
  });
  $$("[data-message-profile]", $("#messages")).forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    openProfile(Number(button.dataset.messageProfile)).catch((error) => toast(error.message));
  }));
  $$("[data-tag-user]", $("#messages")).forEach((button) => button.addEventListener("click", () => {
    const username = button.dataset.tagUser;
    if (!username || username === state.me?.username) return;
    const input = $("#messageInput");
    const tag = `@${username}`;
    if (!input.value.toLowerCase().includes(tag.toLowerCase())) {
      input.value = `${tag} ${input.value}`.trimEnd();
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }));
  $$("[data-reply]").forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    state.replyToId = button.dataset.reply;
    const message = state.messages.find((item) => Number(item.id) === Number(state.replyToId));
    const tag = message?.username ? `@${message.username}` : `#${state.replyToId}`;
    $("#replyBox span").textContent = `Replying to ${tag}: ${String(message?.body || "").slice(0, 80)}`;
    $("#replyBox").classList.remove("hidden");
    if (message?.username && !$("#messageInput").value.includes(tag)) $("#messageInput").value = `${tag} ${$("#messageInput").value}`;
    $("#messageInput").focus();
  }));
  $$("[data-quote]").forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    quoteMessage(button.dataset.quote);
  }));
  $$("[data-react]").forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    await api(`/api/chat/messages/${button.dataset.react}/reactions`, { method: "POST", body: JSON.stringify({ emoji: button.dataset.emoji }) });
    await loadMessages();
  }));
  $$("[data-edit]").forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    const message = state.messages.find((item) => Number(item.id) === Number(button.dataset.edit));
    const body = prompt("Edit message", message?.body || "");
    if (body !== null) {
      await api(`/api/chat/messages/${button.dataset.edit}`, { method: "PATCH", body: JSON.stringify({ body }) });
      await loadMessages();
    }
  }));
  $$("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    if (confirm("Delete this message?")) {
      await api(`/api/chat/messages/${button.dataset.delete}`, { method: "DELETE" });
      await loadMessages();
    }
  }));
  $$("[data-pin]").forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    await api(`/api/chat/messages/${button.dataset.pin}/pin`, { method: "POST" });
    await loadMessages();
  }));
  $$("[data-report-message]").forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    openReportModal({
    targetType: "message",
    messageId: button.dataset.reportMessage,
    targetUserId: button.dataset.reportUser,
    roomId: state.currentRoomId,
    label: `message #${button.dataset.reportMessage}`,
  });
  }));
}

function quoteMessage(messageId) {
  closeMessageMenus();
  const message = state.messages.find((item) => Number(item.id) === Number(messageId));
  if (!message) return;
  const body = String(message.body || "").trim();
  const quote = body ? `> ${message.username || "User"}: ${body}\n` : `> ${message.username || "User"} shared an attachment\n`;
  const input = $("#messageInput");
  input.value = `${quote}${input.value}`.trimEnd();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function renderUsers() {
  const source = (state.userTab === "friends"
    ? state.friends.map((friend) => userById(friend.id) || {
      id: friend.id,
      username: friend.username,
      avatarUrl: friend.avatar_url,
      rank: friend.rank_name,
      mood: friend.mood,
      lastSeen: friend.last_seen,
    })
    : state.userTab === "staff"
      ? state.users.filter((user) => staffRanks.has(user.rank))
      : state.users).filter(visibleInUserList);
  const online = source.filter((user) => isOnline(user));
  const offline = source.filter((user) => !isOnline(user));
  $("#userList").innerHTML = `
    <section class="right-user-section">
      <h3>${state.userTab === "staff" ? "Staff online" : "Online"}</h3>
      ${renderUserRows(online, false)}
    </section>
    <section class="right-user-section">
      <h3>${state.userTab === "staff" ? "Staff offline" : "Offline"}</h3>
      ${renderUserRows(offline, true)}
    </section>
  `;
  $$("[data-user-id]").forEach((button) => button.addEventListener("click", () => openUserActions(Number(button.dataset.userId))));
}

function renderUserRows(list, offline = false) {
  return list.map((user) => `
    <button class="user-row" data-user-id="${user.id}" type="button">
      <span class="status ${offline ? "offline" : ""}"></span>
      <img class="avatar" src="${html(avatar(user))}" alt="" />
      <span><strong>${html(user.username)}</strong><small>${userRankBadge(user)}</small></span>
    </button>
  `).join("") || '<p class="muted compact-empty">No users here.</p>';
}

function renderProfiles() {
  $("#profileGrid").innerHTML = state.users.map((user) => `
    <article class="profile-card">
      <img src="${html(avatar(user))}" alt="" />
      <h3>${html(user.username)}</h3>
      ${userRankBadge(user)}
      <p class="muted">Level ${levelInfo(user.xp).level} | ${user.profileLikes || 0} likes</p>
      <button class="icon-action" data-view-profile="${user.id}" type="button">View profile</button>
    </article>
  `).join("");
  $$("[data-view-profile]").forEach((button) => button.addEventListener("click", () => openProfile(Number(button.dataset.viewProfile))));
}

function renderVip() {
  const plans = [
    ["7d", "7 Days", "50 diamonds", "1,000 gold"],
    ["1m", "1 Month", "100 diamonds", "5,000 gold"],
    ["3m", "3 Months", "200 diamonds", "10,000 gold"],
    ["lifetime", "Lifetime", "1,000 diamonds", "25,000 gold"],
  ];
  $("#vipGrid").innerHTML = plans.map(([code, title, diamonds, gold]) => `
    <article class="vip-card svip-plan-card">
      <span class="svip-shine">S-VIP</span>
      <h3>${title}</h3>
      <p>Unlock gradient style, profile music, GIF banner access, and S-VIP presence.</p>
      <div class="plan-price"><strong>${diamonds}</strong><span>${gold}</span></div>
      <button class="primary" data-buy-svip="${code}" type="button">Buy ${title}</button>
    </article>
  `).join("");
  $$("[data-buy-svip]").forEach((button) => button.addEventListener("click", async () => {
    await api("/api/social/memberships/svip", { method: "POST", body: JSON.stringify({ plan: button.dataset.buySvip }) });
    toast("S-VIP activated.");
    await bootstrap();
    setView("vip");
  }));
}

async function renderNews() {
  if ($("#newsView").classList.contains("active")) clearNewsUnread();
  const posts = await api("/api/social/news");
  $("#newsList").innerHTML = posts.map((post) => `
    <article class="news-card">
      ${post.image_url ? `<img src="${html(post.image_url)}" alt="" />` : `<div class="news-art"><span>TCT</span></div>`}
      <div>
        <span class="eyebrow">Town update</span>
        <h3>${html(post.title)}</h3>
        <p>${html(post.body)}</p>
        <small>By ${html(post.username)} | ${formatDate(post.created_at)} ${formatTime(post.created_at)}</small>
        <section class="news-comments">
          <strong>Comments</strong>
          <div class="news-comment-list">
            ${(post.comments || []).map((comment) => `
              <div class="news-comment">
                <img class="avatar" src="${html(comment.avatar_url || "/assets/avatar-other.svg")}" alt="" />
                <span><b>${html(comment.username)}</b><small>${formatTime(comment.created_at)}</small><p>${html(comment.body)}</p></span>
              </div>
            `).join("") || '<p class="muted">No comments yet.</p>'}
          </div>
          <form class="news-comment-form" data-news-comment="${post.id}">
            <input name="body" maxlength="500" placeholder="Write a comment..." />
            <button type="submit">Post</button>
          </form>
        </section>
      </div>
    </article>
  `).join("") || '<p class="muted">No news has been posted yet.</p>';
  $$("[data-news-comment]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get("body");
    if (!String(body || "").trim()) return;
    await api(`/api/social/news/${form.dataset.newsComment}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    await renderNews();
  }));
}

async function renderLeaderboard() {
  const data = await api("/api/social/leaderboards");
  const labels = { xp: "Top XP", gold: "Top Gold", diamonds: "Top Diamonds" };
  const rows = data[state.leaderboardTab] || [];
  $("#leaderboard").innerHTML = `
    <div class="leaderboard-tabs">
      ${Object.entries(labels).map(([key, label]) => `<button class="${state.leaderboardTab === key ? "active" : ""}" data-board-tab="${key}" type="button">${label}</button>`).join("")}
    </div>
    <div class="leaderboard-list">
      ${rows.map((user, index) => {
        const value = state.leaderboardTab === "gold" ? user.gold : state.leaderboardTab === "diamonds" ? user.diamonds : user.xp;
        return `
          <article class="leaderboard-row">
            <span class="leaderboard-rank">#${index + 1}</span>
            <img class="avatar" src="${html(user.avatar_url || "/assets/avatar-other.svg")}" alt="" />
            <div><strong>${html(user.display_name || user.username)}</strong><small>${rankBadge(user.rank_name, user.profile_title)}</small></div>
            <b>${compactNumber(value)}</b>
          </article>
        `;
      }).join("") || '<p class="muted">No leaderboard data yet.</p>'}
    </div>
  `;
  $$("[data-board-tab]").forEach((button) => button.addEventListener("click", () => {
    state.leaderboardTab = button.dataset.boardTab;
    renderLeaderboard().catch((error) => toast(error.message));
  }));
}

async function loadFriends() {
  const data = await api("/api/social/friends");
  state.friends = data.friends || [];
  state.friendRequests = data.requests || state.friendRequests;
  state.blocks = data.blocks || [];
  renderFriends();
  setBadges();
}

async function refreshPmUnread() {
  const data = await api("/api/chat/private-unread-count");
  state.unreadPm = Number(data.count || 0);
  setBadges();
  return state.unreadPm;
}

function renderFriends() {
  $("#friendRequests").innerHTML = state.friendRequests.map((request) => `
    <div class="request-row"><img class="avatar" src="${html(request.avatar_url || "/assets/avatar-other.svg")}" alt="" /><span><strong>${html(request.username)}</strong><small>${html(request.rank_name)}</small></span><span><button data-accept="${request.id}">Accept</button><button data-decline="${request.id}">Decline</button></span></div>
  `).join("") || '<p class="muted">No pending friend requests.</p>';
  $("#friendsList").innerHTML = state.friends.map((friend) => `<div class="request-row"><img class="avatar" src="${html(friend.avatar_url || "/assets/avatar-other.svg")}" alt="" /><span><strong>${html(friend.username)}</strong><small>${html(friend.rank_name)}</small></span><button data-remove-friend="${friend.id}">Remove</button></div>`).join("") || '<p class="muted">No friends yet.</p>';
  $("#blockList").innerHTML = state.blocks.map((block) => `<div class="request-row"><span>${html(block.username)}</span><button data-unblock="${block.blocked_id}">Unblock</button></div>`).join("") || '<p class="muted">Block list is empty.</p>';
  $$("[data-accept]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.accept}/accept`, { method: "POST" }); await loadFriends(); }));
  $$("[data-decline]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.decline}/decline`, { method: "POST" }); await loadFriends(); }));
  $$("[data-remove-friend]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friends/${button.dataset.removeFriend}`, { method: "DELETE" }); await loadFriends(); }));
  $$("[data-unblock]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/blocks/${button.dataset.unblock}`, { method: "DELETE" }); await loadFriends(); }));
}

function openFriendRequestDrawer() {
  setDrawerChrome({ title: "Friend requests" });
  $("#drawerBody").innerHTML = state.friendRequests.map((request) => `
    <div class="friend-request-card">
      <img class="avatar" src="${html(request.avatar_url || "/assets/avatar-other.svg")}" alt="" />
      <span><strong>${html(request.username)}</strong><small>${rankBadge(request.rank_name)}</small></span>
      <div><button data-accept="${request.id}" type="button">Accept</button><button data-decline="${request.id}" type="button">Decline</button></div>
    </div>
  `).join("") || '<p class="muted">No friend requests.</p>';
  showDrawer();
  $$("[data-accept]", $("#drawer")).forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.accept}/accept`, { method: "POST" }); await loadFriends(); openFriendRequestDrawer(); }));
  $$("[data-decline]", $("#drawer")).forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.decline}/decline`, { method: "POST" }); await loadFriends(); openFriendRequestDrawer(); }));
}

async function openReportQueueDrawer() {
  setDrawerChrome({ title: "Reports" });
  $("#drawerBody").innerHTML = '<p class="muted">Loading reports...</p>';
  showDrawer();
  const reports = await api("/api/admin/reports");
  $("#drawerBody").innerHTML = reports.map((report) => `
    <article class="report-queue-card ${report.status !== "open" ? "handled" : ""}">
      <div>
        <strong>${html(report.target_type || "content")} report</strong>
        <small>By ${html(report.reporter_name || `#${report.reporter_id}`)}${report.target_name ? ` about ${html(report.target_name)}` : ""}</small>
      </div>
      <p>${html(report.reason)}</p>
      <small>${report.message_id ? `Chat message #${report.message_id}` : ""}${report.private_message_id ? `Private message #${report.private_message_id}` : ""}${report.wall_post_id ? `Wall post #${report.wall_post_id}` : ""}${!report.message_id && !report.private_message_id && !report.wall_post_id ? "User/profile report" : ""}</small>
      <div class="report-queue-actions">
        <span>${html(report.status)}</span>
        ${report.status === "open" ? `<button data-report-ignore="${report.id}" type="button">Ignore</button><button class="danger-action" data-report-delete="${report.id}" type="button">Delete content</button>` : ""}
      </div>
    </article>
  `).join("") || '<p class="muted">No reports yet.</p>';
  $$("[data-report-ignore]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/admin/reports/${button.dataset.reportIgnore}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
    toast("Report ignored.");
    await openReportQueueDrawer();
    refreshReportBadge().catch(() => {});
  }));
  $$("[data-report-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete the reported content?")) return;
    await api(`/api/admin/reports/${button.dataset.reportDelete}/action`, { method: "POST", body: JSON.stringify({ action: "delete" }) });
    toast("Reported content deleted.");
    await openReportQueueDrawer();
    await loadMessages();
    refreshReportBadge().catch(() => {});
  }));
}

async function openProfile(userId) {
  $("#drawer")?.classList.add("hidden");
  if (state.compactLayout) {
    $("#app")?.classList.add("right-closed");
    $("#app")?.classList.remove("nav-open");
  }
  const data = await api(`/api/social/profiles/${userId}`);
  const user = data.user;
  const self = Number(user.id) === Number(state.me.id);
  const info = levelInfo(user.xp);
  const badgeCount = data.badges.length + (data.gifts || []).length;
  const accent = user.profileAccent || "#ef4444";
  $("#profileModal").style.setProperty("--profile-accent", accent);
  $("#profileCover").style.setProperty("--profile-banner", `url('${user.bannerUrl || "/assets/profile-banner.svg"}')`);
  $("#profileAvatar").src = user.avatarUrl || `/assets/avatar-${user.gender || "other"}.svg`;
  $("#profileStatusDot").classList.toggle("offline", !user.online);
  $("#profileName").textContent = displayName(user);
  $("#profileHandle").textContent = `@${user.username.toLowerCase()}`;
  $("#profileRankLine").innerHTML = `${rankBadge(user.rank, user.profileTitle)} <span class="profile-title-dot">-</span> <span class="profile-level">Level ${info.level}</span>`;
  $("#profileQuote").textContent = user.bio || "New to the town. Profile story coming soon.";
  $("#profileCounters").innerHTML = `
    <span class="profile-metric"><b>★</b><strong>Level ${info.level}</strong></span>
    ${self
      ? `<span class="profile-metric"><b>👍</b><strong>${compactNumber(data.likeCount || user.profileLikes || 0)} Likes</strong></span>`
      : `<button class="profile-metric like-toggle ${data.likedByMe ? "active" : ""}" data-toggle-profile-like="${user.id}" type="button"><b>👍</b><strong>${compactNumber(data.likeCount || user.profileLikes || 0)} ${data.likedByMe ? "Liked" : "Likes"}</strong></button>`}
  `;
  $("#profileCornerActions").innerHTML = self
    ? `<button data-own-action="edit" title="Edit profile" type="button"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18.7 7.7l-3.2-3.2L4 16Zm16-10.5a1.5 1.5 0 0 0 0-2.1l-.4-.4a1.5 1.5 0 0 0-2.1 0l-.8.8L19.2 6l.8-.5Z"/></svg></button><button data-close-profile title="Cancel" type="button"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg></button>`
    : `<button data-open-profile-actions="${user.id}" title="More" type="button"><svg viewBox="0 0 24 24"><path d="M6 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/></svg></button><button data-close-profile title="Cancel" type="button"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg></button>`;
  $("#profileMainActions").innerHTML = self
    ? `<button class="primary" data-own-action="edit" type="button">Edit Profile</button>`
    : `<button class="primary" data-pm-user="${user.id}" type="button">Message</button>${state.friends.some((item) => Number(item.id || item.friend_id) === Number(user.id)) ? `<button data-remove-friend-action="${user.id}" type="button">Remove Friend</button>` : `<button data-add-friend="${user.id}" type="button">Add Friend</button>`}`;
  $("#profileInfo").innerHTML = `
    <div class="profile-overview-card">
      <h3>Overview</h3>
      <p>${html(user.aboutMe || user.bio || "This profile is still being decorated.")}</p>
      <div class="profile-stat-grid">
        <article><span>Messages</span><strong>${compactNumber(user.messageCount || 0)}</strong></article>
        <article><span>Level</span><strong>${info.level}</strong></article>
        <article><span>Likes</span><strong>${compactNumber(data.likeCount || user.profileLikes || 0)}</strong></article>
        <article><span>Badges</span><strong>${badgeCount}</strong></article>
      </div>
    </div>
    ${user.profileMusicUrl ? `<div class="profile-music"><span>Profile music</span><audio controls src="${html(user.profileMusicUrl)}"></audio></div>` : ""}
  `;
  $("#profileMore").innerHTML = profileMorePanel(user);
  $("#profileFriends").innerHTML = "";
  $("#profileBadges").innerHTML = "";
  $("#profileActivity").innerHTML = "";
  $$(".profile-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.profileTab === "info"));
  $$(".profile-tab").forEach((panel) => panel.classList.remove("active"));
  $("#profileInfo").classList.add("active");
  $$("[data-open-profile-actions]").forEach((button) => button.addEventListener("click", () => openProfileActionsDrawer(Number(button.dataset.openProfileActions))));
  $$("[data-close-profile]").forEach((button) => button.addEventListener("click", () => $("#profileModal").close()));
  $$("[data-toggle-profile-like]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/social/profiles/${button.dataset.toggleProfileLike}/like`, { method: "POST" });
    toast(result.liked ? "Profile liked." : "Profile unliked.");
    await openProfile(user.id);
  }));
  $$("[data-switch-room]", $("#profileModal")).forEach((button) => button.addEventListener("click", async () => {
    $("#profileModal").close();
    await switchRoom(button.dataset.switchRoom);
  }));
  bindProfileSocialActions(user.id);
  bindUserActionButtons(user.id);
  if (!$("#profileModal").open) $("#profileModal").showModal();
}

function compactNumber(value) {
  return new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function profileMorePanel(user) {
  const details = [
    ["Gender", user.gender || "Not set"],
    ["Age", user.age ? `${user.age} years` : "Hidden"],
    ["Last online", formatDate(user.lastSeen)],
    ["Member since", formatDate(user.createdAt)],
    ["Current room", state.rooms.find((room) => Number(room.id) === Number(state.currentRoomId))?.name || "Main Room"],
  ];
  return `
    <div class="profile-detail-bubbles">
      ${details.map(([label, value]) => `<article><span>${html(label)}</span><strong>${html(value)}</strong></article>`).join("")}
    </div>
  `;
}

function profileRoomsPanel(user) {
  return `
    <section class="profile-section flush">
      <h3>Rooms</h3>
      <div class="profile-room-grid">
        ${state.rooms.map((room) => `
          <button data-switch-room="${room.id}" type="button">
            <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
            <span><strong>${html(room.name)}</strong><small>${html(room.description)}</small></span>
          </button>
        `).join("")}
      </div>
      <div class="profile-info-list">
        <div><span>Member</span><strong>${formatDate(user.createdAt)}</strong></div>
        <div><span>Current mood</span><strong>${html(user.mood || "Online")}</strong></div>
      </div>
    </section>
  `;
}

function profileBadgesPanel(data) {
  return `
    <section class="profile-section flush">
      <h3>Badges and gifts</h3>
      <div class="profile-badge-grid">
        ${data.badges.map((badge) => `<span style="--rank-color:${html(badge.badge_color)}">${html(badge.title)}</span>`).join("") || '<p class="muted">No badges yet.</p>'}
      </div>
      <div class="gift-strip">${(data.gifts || []).map((gift) => `<span class="gift-token" title="From ${html(gift.from_username)}">${html(gift.title)}</span>`).join("") || '<span class="muted">No gifts yet.</span>'}</div>
    </section>
  `;
}

function profileSocialPanel(user, data) {
  const self = Number(user.id) === Number(state.me.id);
  const wall = data.wall || [];
  const gallery = data.gallery || [];
  return `
    <section class="profile-section">
      <h3>Friend wall</h3>
      <form class="wall-form" data-wall-form="${user.id}">
        <input name="body" maxlength="500" placeholder="Write on ${html(user.username)}'s wall" />
        <button class="primary" type="submit">Post</button>
      </form>
      <div class="wall-list">
        ${wall.map((post) => `
          <article class="wall-post">
            <img class="avatar" src="${html(post.avatar_url || "/assets/avatar-other.svg")}" alt="" />
            <div>
              <strong>${html(post.username)}</strong>
              <p>${html(post.body)}</p>
              <small>${formatDate(post.created_at)} ${formatTime(post.created_at)}</small>
              <div class="mini-actions">
                ${Number(post.author_id) !== Number(state.me.id) ? `<button data-report-wall="${post.id}" data-wall-user="${post.author_id}" type="button">Report</button>` : ""}
                ${(Number(post.author_id) === Number(state.me.id) || Number(user.id) === Number(state.me.id) || staffRanks.has(state.me.rank)) ? `<button data-delete-wall="${post.id}" type="button">Delete</button>` : ""}
              </div>
            </div>
          </article>
        `).join("") || '<p class="muted">No wall posts yet.</p>'}
      </div>
    </section>
    <section class="profile-section">
      <h3>Gallery</h3>
      ${self ? `<form class="gallery-form" id="galleryForm"><input id="galleryUpload" type="file" accept="image/*" /><input name="caption" placeholder="Caption" /><button class="primary" type="submit">Upload</button></form>` : ""}
      <div class="gallery-grid">
        ${gallery.map((item) => `<figure><img src="${html(item.image_url)}" alt="" /><figcaption>${html(item.caption || "")}</figcaption>${self ? `<button data-delete-gallery="${item.id}" type="button">Delete</button>` : ""}</figure>`).join("") || '<p class="muted">No gallery images yet.</p>'}
      </div>
    </section>
  `;
}

function bindProfileSocialActions(userId) {
  $("[data-wall-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get("body");
    if (!String(body || "").trim()) return toast("Write something for the wall.");
    await api(`/api/social/profiles/${userId}/wall`, { method: "POST", body: JSON.stringify({ body }) });
    toast("Wall post saved.");
    await openProfile(userId);
  });
  $("#galleryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("#galleryUpload").files[0];
    if (!file) return toast("Choose a gallery image.");
    const form = new FormData(event.currentTarget);
    form.set("image", file);
    await api("/api/social/profiles/me/gallery", { method: "POST", body: form });
    toast("Gallery image uploaded.");
    await openProfile(userId);
  });
  $$("[data-report-wall]").forEach((button) => button.addEventListener("click", () => openReportModal({
    targetType: "wall",
    targetUserId: button.dataset.wallUser,
    wallPostId: button.dataset.reportWall,
    label: `wall post #${button.dataset.reportWall}`,
  })));
  $$("[data-delete-wall]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this wall post?")) return;
    await api(`/api/social/wall-posts/${button.dataset.deleteWall}`, { method: "DELETE" });
    await openProfile(userId);
  }));
  $$("[data-delete-gallery]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this gallery image?")) return;
    await api(`/api/social/gallery/${button.dataset.deleteGallery}`, { method: "DELETE" });
    await openProfile(userId);
  }));
}

function actionButtons(userId, rank) {
  const self = Number(userId) === Number(state.me.id);
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  if (self) {
    return `
      <div class="action-list profile-options">
        <button data-own-action="level">Level info</button>
        <button data-own-action="wallet">Wallet</button>
        <button data-own-action="edit">Edit profile</button>
        <button data-own-action="username">Edit username</button>
        <button data-own-action="about">Edit about me</button>
        <button data-own-action="mood">Edit mood</button>
        <button data-own-action="colors">Username and text color</button>
        <button data-own-action="theme">Theme settings</button>
        <button data-own-action="friends">Manage friends</button>
        <button data-own-action="privacy">Privacy and ignores</button>
        <button data-own-action="password">Change password</button>
        <button data-own-action="delete">Delete account</button>
        <button data-own-action="logout">Logout</button>
      </div>
    `;
  }
  return `
    <div class="action-list">
      <button data-view-profile="${userId}">View profile</button>
      <button data-pm-user="${userId}">Private</button>
      ${friend ? `<button data-remove-friend-action="${userId}">Remove friend</button>` : `<button data-add-friend="${userId}">Add friend</button>`}
      <button data-follow="${userId}">Follow</button>
      <button data-like-profile="${userId}">Like profile</button>
      <button data-gift="${userId}">Send gift</button>
      <button data-share-wallet="${userId}">Share wallet</button>
      ${blocked ? `<button data-unblock-action="${userId}">Unblock</button>` : `<button data-block="${userId}">Block</button>`}
      <button data-report-user="${userId}">Report</button>
      ${staffRanks.has(state.me.rank) ? `<button data-staff-action="${userId}" data-rank="${rank}">Staff action</button>` : ""}
    </div>
  `;
}

function openProfileActionsDrawer(userId) {
  const user = userById(userId);
  if (!user) return;
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  const staff = staffRanks.has(state.me.rank);
  setDrawerChrome({ user: true });
  $("#drawerBody").innerHTML = `
    <div class="profile-action-drawer">
      <div class="profile-action-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <strong>${html(displayName(user))}</strong>
      </div>
      <div class="action-tabs"><button class="active" type="button">Global</button><button type="button">Main</button>${staff ? '<button type="button">Room</button>' : ""}</div>
      <div class="profile-action-list">
        <button data-pm-user="${user.id}" type="button"><span>Private</span></button>
        ${friend ? `<button data-remove-friend-action="${user.id}" type="button"><span>Remove friend</span></button>` : `<button data-add-friend="${user.id}" type="button"><span>Add friend</span></button>`}
        <button data-gift="${user.id}" type="button"><span>Send gift</span></button>
        <button data-share-wallet="${user.id}" type="button"><span>Share wallet</span></button>
        ${blocked ? `<button data-unblock-action="${user.id}" type="button"><span>Unblock</span></button>` : `<button data-block="${user.id}" type="button"><span>Block</span></button>`}
        <button data-report-user="${user.id}" type="button"><span>Report</span></button>
      </div>
      ${staff ? `
        <div class="staff-quick-tools">
          <h3>Moderation</h3>
          <textarea id="staffReason" placeholder="Reason or note"></textarea>
          <button data-user-action-panel="${user.id}" type="button">Change rank / edit</button>
          <button data-mod="warn" type="button">Warn</button>
          <button data-mod="mute" data-minutes="10" type="button">Mute 10m</button>
          <button data-mod="mute" data-minutes="60" type="button">Chat mute 1h</button>
          <button data-mod="mute" data-minutes="60" type="button">Private mute 1h</button>
          <button data-mod="mute" data-minutes="60" type="button">Ghost 1h</button>
          <button data-mod="kick" data-minutes="10" type="button">Kick 10m</button>
          <button data-mod="ban" class="danger-action" type="button">Ban</button>
          <button data-mod="delete" class="danger-action" type="button">Delete account</button>
        </div>
      ` : ""}
    </div>
  `;
  showDrawer();
  bindUserActionButtons(user.id);
  $("[data-user-action-panel]")?.addEventListener("click", () => openUserActionPanel(user.id));
  $$("[data-mod]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.mod;
    if (action === "delete" && !confirm("Delete this account permanently?")) return;
    if (action === "ban" && !confirm("Permanently ban this account?")) return;
    moderate(user.id, action, { minutes: Number(button.dataset.minutes || 0), reason: $("#staffReason")?.value.trim() || "" });
  }));
}

function openUserActions(userId) {
  const user = userById(userId);
  if (!user) return;
  const self = Number(user.id) === Number(state.me.id);
  setDrawerChrome({ title: "Profile", user: true });
  $("#drawerBody").innerHTML = `
    <div class="user-slide-card">
      <div class="user-slide-cover" style="background-image:linear-gradient(180deg,rgba(12,5,36,.08),rgba(43,16,99,.92)),url('${html(user.bannerUrl || "/assets/profile-banner.svg")}')">
        <span class="user-slide-score">${compactNumber(user.gold || 0)}</span>
        <img src="${html(avatar(user))}" alt="" />
        <h2>${html(displayName(user))}</h2>
        <p>${user.age ? `${user.age} years` : "Town member"} ${user.gender ? `- ${html(user.gender)}` : ""}</p>
      </div>
      <div class="user-slide-actions">
        <button data-view-profile="${user.id}" type="button"><span>View profile</span></button>
        ${self
          ? `<button data-own-action="edit" type="button"><span>Edit profile</span></button>`
          : `<button data-pm-user="${user.id}" type="button"><span>Private</span></button>
             <button data-user-action-panel="${user.id}" type="button"><span>Action</span></button>
             <button data-like-profile="${user.id}" type="button"><span>User Rating</span></button>`}
      </div>
    </div>
  `;
  bindUserActionButtons(user.id);
  $("[data-user-action-panel]")?.addEventListener("click", () => openUserActionPanel(user.id));
  showDrawer();
}

function openUserActionPanel(userId) {
  const user = userById(userId);
  if (!user) return;
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  setDrawerChrome({ title: "Action", user: true });
  $("#drawerBody").innerHTML = `
    <div class="action-panel-card">
      <div class="action-panel-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>${html(displayName(user))}</h2>${userRankBadge(user)}</div>
      </div>
      <section class="action-panel-section">
        <h3>Social</h3>
        ${friend ? `<button data-remove-friend-action="${user.id}" type="button">Remove friend</button>` : `<button data-add-friend="${user.id}" type="button">Add friend</button>`}
        ${blocked ? `<button data-unblock-action="${user.id}" type="button">Unblock</button>` : `<button data-block="${user.id}" type="button">Block</button>`}
        <button data-report-user="${user.id}" type="button">Report</button>
      </section>
      ${staffRanks.has(state.me.rank) ? `
        <section class="action-panel-section">
          <h3>Moderation tools</h3>
          <textarea id="staffReason" placeholder="Reason or note"></textarea>
          <button data-mod="warn" type="button">Warn</button>
          <div class="compact-row"><button data-mod="mute" data-minutes="2" type="button">Mute 2m</button><button data-mod="mute" data-minutes="10" type="button">Mute 10m</button><button data-mod="mute" data-minutes="60" type="button">Mute 1h</button></div>
          <div class="compact-row"><button data-mod="kick" data-minutes="2" type="button">Kick 2m</button><button data-mod="kick" data-minutes="10" type="button">Kick 10m</button><button data-mod="kick" data-minutes="2880" type="button">Kick 2d</button></div>
          <button data-mod="ban" class="danger-action" type="button">Ban</button>
        </section>
        <section class="action-panel-section">
          <h3>Edit user</h3>
          <input id="staffEditName" value="${html(user.username)}" placeholder="Username" />
          <input id="staffEditMood" value="${html(user.mood || "")}" placeholder="Mood" />
          <input id="staffEditAvatar" value="${html(user.avatarUrl || "")}" placeholder="Avatar URL" />
          <input id="staffEditBanner" value="${html(user.bannerUrl || "")}" placeholder="Banner URL" />
          <select id="staffEditRank">${rankOrder.map((rank) => `<option value="${rank}" ${rank === user.rank ? "selected" : ""}>${rank}</option>`).join("")}</select>
          <button id="staffSaveUser" type="button">Save user edits</button>
          <button data-mod="delete" class="danger-action" type="button">Delete account</button>
        </section>
      ` : ""}
    </div>
  `;
  bindUserActionButtons(user.id);
  $$("[data-mod]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.mod;
    if (action === "delete" && !confirm("Delete this account permanently?")) return;
    if (action === "ban" && !confirm("Permanently ban this account?")) return;
    moderate(user.id, action, { minutes: Number(button.dataset.minutes || 0), reason: $("#staffReason")?.value.trim() || "" });
  }));
  $("#staffSaveUser")?.addEventListener("click", async () => {
    await api(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        username: $("#staffEditName").value.trim(),
        mood: $("#staffEditMood").value.trim(),
        avatarUrl: $("#staffEditAvatar").value.trim(),
        bannerUrl: $("#staffEditBanner").value.trim(),
        rank: $("#staffEditRank").value,
      }),
    });
    toast("User updated.");
    $("#drawer").classList.add("hidden");
    await bootstrap();
  });
  showDrawer();
}

function openOwnMenu() {
  const info = levelInfo(state.me.xp);
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  setDrawerChrome({ account: true });
  $("#drawerBody").innerHTML = `
    <div class="account-menu-card">
      <div class="account-menu-head">
        <img class="avatar avatar-lg ${html(state.me.frame || "clean")}" src="${html(avatar(state.me))}" alt="" />
        <div>
          ${userRankBadge(state.me)}
          <h2>${html(displayName(state.me))}</h2>
          <button data-own-action="edit" type="button">Edit profile</button>
        </div>
        <span class="account-check">OK</span>
      </div>
      <div class="account-menu-list">
        <button data-own-action="chat-options" type="button"><span class="menu-icon">C</span><strong>Chat options</strong><em>&gt;</em></button>
        <button data-own-action="level" type="button"><span class="menu-icon">L</span><strong>Level info</strong></button>
        <button data-own-action="wallet" type="button"><span class="menu-icon">W</span><strong>Wallet</strong></button>
        <hr />
        <button data-own-action="room-options" type="button"><span class="menu-icon">R</span><strong>Room options</strong><small>${html(room?.name || "Current room")}</small><em>&gt;</em></button>
        ${["admin", "chief", "developer"].includes(state.me.rank) ? `<button data-open-admin-panel type="button"><span class="menu-icon">A</span><strong>Admin panel</strong></button>` : ""}
        <button data-own-action="logout" type="button"><span class="menu-icon">O</span><strong>Logout</strong></button>
      </div>
    </div>
  `;
  showDrawer();
  bindUserActionButtons(state.me.id);
  $("[data-open-admin-panel]")?.addEventListener("click", async () => {
    $("#drawer").classList.add("hidden");
    setView("admin");
    await renderAdmin();
  });
}

function openRoomOptionsPanel() {
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId)) || {};
  setDrawerChrome({ title: "Room options" });
  $("#drawerBody").innerHTML = `
    <div class="room-options-card">
      <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
      <label>Room name<input value="${html(room.name || "")}" readonly /></label>
      <label>Description<textarea readonly>${html(room.description || "")}</textarea></label>
      <button class="primary" type="button">Room editing UI ready</button>
      <p class="muted">Name, description, and image editing can be connected to staff permissions next.</p>
    </div>
  `;
  showDrawer();
}

function openWalletPanel() {
  setDrawerChrome({ title: "Wallet" });
  $("#drawerBody").innerHTML = `
    <div class="wallet-grid">
      <article class="wallet-card gold"><span>Gold</span><strong>${state.me.gold || 0}</strong><small>Earn 100 gold every 10 texts.</small></article>
      <article class="wallet-card diamond"><span>Diamonds</span><strong>${state.me.diamonds || 0}</strong><small>Earn 3 diamonds every 10 minutes online.</small></article>
      <article class="wallet-card xp"><span>XP</span><strong>${state.me.xp || 0}</strong><small>Every 2 texts gives 1 XP.</small></article>
    </div>
  `;
  showDrawer();
}

function openLevelPanel() {
  const info = levelInfo(state.me.xp);
  const percent = Math.round((info.current / info.next) * 100);
  setDrawerChrome({ title: "Level info" });
  $("#drawerBody").innerHTML = `
    <div class="level-card">
      <div><strong>Level ${info.level}</strong><span>${info.current} / ${info.next} XP</span></div>
      <div class="level-bar"><span style="width:${percent}%"></span></div>
      <div class="request-row"><span>Next level needs</span><strong>${info.next - info.current} XP</strong></div>
      <div class="request-row"><span>Total XP</span><strong>${state.me.xp || 0}</strong></div>
      <div class="request-row"><span>Texts sent</span><strong>${state.me.messageCount || 0}</strong></div>
    </div>
  `;
  showDrawer();
}

function openChatOptionsPanel() {
  const current = localStorage.getItem("tct_theme") || document.body.dataset.theme || "dark";
  setDrawerChrome({ title: "Chat options" });
  $("#drawerBody").innerHTML = `
    <div class="theme-panel">
      <h3>Theme</h3>
      <p class="muted">Choose how the chat feels on your screen.</p>
      <div class="theme-choice-grid">
        ${themeChoices.map(([id, label, color]) => `
          <button class="${id === current ? "active" : ""}" data-theme-choice="${id}" type="button">
            <span style="background:${html(color)}"></span>
            <strong>${html(label)}</strong>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  showDrawer();
  $$("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    $$("[data-theme-choice]").forEach((node) => node.classList.toggle("active", node === button));
    toast(`${button.textContent.trim()} theme applied.`);
  }));
}

function openProfileEditor(section = "edit") {
  const form = $("#editProfileForm");
  if (form && state.me) {
    form.displayName.value = state.me.displayName || state.me.username || "";
    form.username.value = state.me.username || "";
    form.bio.value = state.me.bio || "";
    form.aboutMe.value = state.me.aboutMe || "";
    form.mood.value = state.me.mood || "";
    form.profileMusicUrl.value = state.me.profileMusicUrl || "";
    form.profileTitle.value = state.me.profileTitle || "";
    form.level.value = levelInfo(state.me.xp).level;
    form.profileStatus.value = state.me.profileStatus || "Online";
    form.profileAccent.value = state.me.profileAccent || "#ef4444";
    form.showOnlineStatus.checked = state.me.showOnlineStatus !== false;
    form.usernameColor.value = state.me.usernameColor || "";
    form.textColor.value = state.me.textColor || "";
    form.theme.value = state.me.theme || "dark";
    form.bubbleStyle.value = state.me.bubbleStyle || "default";
    $("#editBannerPreview").style.setProperty("--edit-banner", `url('${state.me.bannerUrl || "/assets/profile-banner.svg"}')`);
    $("#editAvatarPreview").src = avatar(state.me);
    $("#bioCount").textContent = `${form.bio.value.length}/120`;
    $$("[data-accent]").forEach((button) => button.classList.toggle("active", button.dataset.accent === form.profileAccent.value));
  }
  $("#editProfileModal").showModal();
  const field = {
    username: "input[name='username']",
    about: "textarea[name='aboutMe']",
    mood: "input[name='mood']",
    colors: "input[name='usernameColor']",
    theme: "select[name='theme']",
  }[section];
  if (field) setTimeout(() => $(field)?.focus(), 80);
}

function openReportModal({ targetType = "user", targetUserId = null, messageId = null, roomId = null, privateMessageId = null, wallPostId = null, label = "user" }) {
  if (targetUserId && Number(targetUserId) === Number(state.me.id)) {
    toast("You cannot report yourself.");
    return;
  }
  $("#userActionBody").innerHTML = `
    <div class="report-card">
      <h2>Report ${html(label)}</h2>
      <p class="muted">Send this to staff with a clear reason. False reports can be ignored by staff.</p>
      <textarea id="reportReason" placeholder="What happened?"></textarea>
      <div class="modal-actions">
        <button class="primary" id="sendReportButton" type="button">Send report</button>
        <button data-close-modal type="button">Cancel</button>
      </div>
    </div>
  `;
  $("#sendReportButton").onclick = async () => {
    const reason = $("#reportReason").value.trim();
    if (!reason) return toast("Please add a report reason.");
    await api("/api/social/reports", {
      method: "POST",
      body: JSON.stringify({ targetType, targetUserId, messageId, roomId, privateMessageId, wallPostId, reason }),
    });
    $("#userActionModal").close();
    toast("Report sent to staff.");
  };
  $$("[data-close-modal]", $("#userActionModal")).forEach((button) => button.addEventListener("click", () => $("#userActionModal").close()));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openGiftModal(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}` };
  $("#userActionBody").innerHTML = `
    <div class="gift-card">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>Send gift</h2><p class="muted">To ${html(user.username)} | You have ${state.me.gold || 0} gold</p></div>
      </div>
      <div class="gift-grid">
        ${giftCatalog.map(([code, title, cost]) => `
          <button data-send-gift="${code}" type="button">
            <span class="gift-icon">${code === "rose" ? "R" : code === "crown" ? "C" : code === "diamond" ? "D" : "S"}</span>
            <strong>${title}</strong>
            <small>${cost} gold</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  $$("[data-send-gift]").forEach((button) => button.addEventListener("click", async () => {
    await api("/api/social/gifts", { method: "POST", body: JSON.stringify({ toUserId: userId, giftCode: button.dataset.sendGift }) });
    toast("Gift sent.");
    $("#userActionModal").close();
    await bootstrap();
  }));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openShareWalletModal(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}` };
  $("#userActionBody").innerHTML = `
    <form class="transfer-card" id="walletTransferForm">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>Share wallet</h2><p class="muted">Send gold or diamonds to ${html(user.username)}</p></div>
      </div>
      <div class="wallet-mini">
        <span>${state.me.gold || 0} gold</span>
        <span>${state.me.diamonds || 0} diamonds</span>
      </div>
      <select name="currency"><option value="gold">Gold</option><option value="diamonds">Diamonds</option></select>
      <input name="amount" type="number" min="1" max="100000" placeholder="Amount" required />
      <input name="note" maxlength="160" placeholder="Optional note" />
      <button class="primary" type="submit">Send wallet</button>
    </form>
  `;
  $("#walletTransferForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/social/wallet-transfers", {
      method: "POST",
      body: JSON.stringify({ toUserId: userId, ...Object.fromEntries(new FormData(event.currentTarget)) }),
    });
    toast("Wallet shared.");
    $("#userActionModal").close();
    await bootstrap();
  });
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

async function handleOwnAction(action) {
  if ($("#userActionModal").open) $("#userActionModal").close();
  if (action === "chat-options") return openChatOptionsPanel();
  if (action === "room-options") return openRoomOptionsPanel();
  if (action === "level") return openLevelPanel();
  if (action === "wallet") return openWalletPanel();
  if (["edit", "username", "about", "mood", "colors", "theme"].includes(action)) return openProfileEditor(action);
  if (action === "friends" || action === "privacy") {
    state.userTab = "friends";
    $$("[data-user-tab]").forEach((button) => button.classList.toggle("active", button.dataset.userTab === "friends"));
    renderUsers();
    return;
  }
  if (action === "password") return $("#changePasswordButton").click();
  if (action === "delete") return toast((await api("/api/auth/me/delete-request", { method: "POST" })).message);
  if (action === "logout") return logout();
}

function bindUserActionButtons(userId) {
  $$("[data-own-action]").forEach((button) => button.addEventListener("click", () => handleOwnAction(button.dataset.ownAction)));
  $$("[data-view-profile]").forEach((button) => button.addEventListener("click", () => {
    if ($("#userActionModal").open) $("#userActionModal").close();
    $("#drawer").classList.add("hidden");
    openProfile(Number(button.dataset.viewProfile));
  }));
  $$("[data-pm-user]").forEach((button) => button.addEventListener("click", () => {
    if ($("#profileModal").open) $("#profileModal").close();
    openPm(button.dataset.pmUser);
  }));
  $$("[data-add-friend]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/friend-requests", { method: "POST", body: JSON.stringify({ toUserId: button.dataset.addFriend }) }); toast("Friend request sent."); }));
  $$("[data-remove-friend-action]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friends/${button.dataset.removeFriendAction}`, { method: "DELETE" }); await loadFriends(); toast("Friend removed."); if ($("#userActionModal").open) $("#userActionModal").close(); }));
  $$("[data-follow]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/follows", { method: "POST", body: JSON.stringify({ userId: button.dataset.follow }) }); toast("Followed."); }));
  $$("[data-like-profile]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/social/profiles/${button.dataset.likeProfile}/like`, { method: "POST" });
    toast(result.liked ? "Profile liked." : "Profile unliked.");
  }));
  $$("[data-gift]").forEach((button) => button.addEventListener("click", () => openGiftModal(button.dataset.gift)));
  $$("[data-share-wallet]").forEach((button) => button.addEventListener("click", () => openShareWalletModal(button.dataset.shareWallet)));
  $$("[data-block]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/blocks", { method: "POST", body: JSON.stringify({ userId: button.dataset.block }) }); await loadFriends(); toast("User blocked."); }));
  $$("[data-unblock-action]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/blocks/${button.dataset.unblockAction}`, { method: "DELETE" }); await loadFriends(); toast("User unblocked."); if ($("#userActionModal").open) $("#userActionModal").close(); }));
  $$("[data-report-user]").forEach((button) => button.addEventListener("click", () => {
    if (Number(button.dataset.reportUser) === Number(state.me.id)) return toast("You cannot report yourself.");
    openReportModal({ targetType: "user", targetUserId: button.dataset.reportUser, label: `user #${button.dataset.reportUser}` });
  }));
  $$("[data-staff-action]").forEach((button) => button.addEventListener("click", () => openStaffActions(button.dataset.staffAction)));
}

function openStaffActions(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}`, rank: "user", avatarUrl: "/assets/avatar-other.svg" };
  if ($("#profileModal").open) $("#profileModal").close();
  $("#userActionBody").innerHTML = `
    <div class="staff-card">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>${html(user.username)}</h2>${userRankBadge(user)}<p class="muted">Staff action center</p></div>
      </div>
      <div class="staff-tabs"><button class="active" type="button">Global</button><button type="button">Main</button></div>
      <div class="warning-box"><strong>!</strong><span>Write the staff warning or reason below. The user receives it as a notification.</span></div>
      <textarea id="staffReason" placeholder="Reason or warning message"></textarea>
      <div class="staff-section">
        <strong>Warn</strong>
        <button data-mod="warn" type="button">Send warning</button>
      </div>
      <div class="staff-section">
        <strong>Mute</strong>
        <div class="chip-row">
          <button data-mod="mute" data-minutes="2" type="button">2 min</button>
          <button data-mod="mute" data-minutes="5" type="button">5 min</button>
          <button data-mod="mute" data-minutes="10" type="button">10 min</button>
          <button data-mod="mute" data-minutes="60" type="button">1 hr</button>
        </div>
      </div>
      <div class="staff-section">
        <strong>Kick</strong>
        <div class="chip-row">
          <button data-mod="kick" data-minutes="2" type="button">2 min</button>
          <button data-mod="kick" data-minutes="5" type="button">5 min</button>
          <button data-mod="kick" data-minutes="10" type="button">10 min</button>
          <button data-mod="kick" data-minutes="60" type="button">1 hr</button>
          <button data-mod="kick" data-minutes="2880" type="button">2 days</button>
        </div>
      </div>
      <div class="staff-section danger-zone">
        <strong>Ban and account</strong>
        <button data-mod="ban" type="button">Permanent ban</button>
        <button data-mod="delete" type="button">Delete account</button>
      </div>
    </div>
  `;
  $$("[data-mod]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.mod;
    if (action === "delete" && !confirm("Delete this account permanently?")) return;
    if (action === "ban" && !confirm("Permanently ban this account?")) return;
    moderate(userId, action, { minutes: Number(button.dataset.minutes || 0), reason: $("#staffReason").value.trim() });
  }));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

async function moderate(userId, action, extra = {}) {
  await api(`/api/admin/users/${userId}/moderate`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
  toast("Staff action applied.");
  if ($("#userActionModal").open) $("#userActionModal").close();
  $("#drawer").classList.add("hidden");
  await bootstrap();
}

function renderPmDrawerActions(user) {
  const actions = $("#drawerActions");
  if (!actions) return;
  actions.innerHTML = `
    <button class="drawer-icon-button" id="pmExpandButton" type="button" title="${state.pmExpanded ? "Make private message smaller" : "Make private message bigger"}">
      ${state.pmExpanded
        ? '<svg viewBox="0 0 24 24"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'}
    </button>
    <div class="pm-settings-wrap">
      <button class="drawer-icon-button" id="pmSettingsButton" type="button" title="Private message settings">
        <svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 2.2-1.7-.9a7 7 0 0 0-.7-1.7l.6-1.8-1.1-1.1-1.8.6a7 7 0 0 0-1.7-.7L13.3 3h-2.6l-.9 2.1a7 7 0 0 0-1.7.7l-1.8-.6-1.1 1.1.6 1.8a7 7 0 0 0-.7 1.7l-1.7.9v2.6l1.7.9c.2.6.4 1.2.7 1.7l-.6 1.8 1.1 1.1 1.8-.6c.5.3 1.1.6 1.7.7l.9 2.1h2.6l.9-2.1c.6-.2 1.2-.4 1.7-.7l1.8.6 1.1-1.1-.6-1.8c.3-.5.6-1.1.7-1.7l1.7-.9v-2.6Z"/></svg>
      </button>
      <div class="pm-settings-menu hidden" id="pmSettingsMenu">
        <button data-report-chat="${user.id}" type="button"><svg viewBox="0 0 24 24"><path d="M5 21V4h10l1 2h4v10h-8l-1-2H7v7z"/></svg><span>Report chat</span></button>
        ${canDeletePrivateChats() ? `<button data-delete-pm-chat="${user.id}" class="danger-menu-action" type="button"><svg viewBox="0 0 24 24"><path d="M8 9h2v9H8V9Zm6 0h2v9h-2V9ZM4 6h16v2H4V6Zm3 2h10l-1 13H8L7 8Zm3-5h4l1 2H9l1-2Z"/></svg><span>Delete chat</span></button>` : ""}
      </div>
    </div>
  `;
  $("#pmExpandButton")?.addEventListener("click", () => {
    state.pmExpanded = !state.pmExpanded;
    $("#drawer").classList.toggle("pm-expanded", state.pmExpanded);
    renderPmDrawerActions(user);
    const thread = $("#pmThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  });
  $("#pmSettingsButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    $("#pmSettingsMenu")?.classList.toggle("hidden");
  });
  $("[data-report-chat]", actions)?.addEventListener("click", () => {
    $("#pmSettingsMenu")?.classList.add("hidden");
    openReportModal({ targetType: "private_chat", targetUserId: user.id, label: `private chat with ${displayName(user)}` });
  });
  $("[data-delete-pm-chat]", actions)?.addEventListener("click", async () => {
    $("#pmSettingsMenu")?.classList.add("hidden");
    if (!confirm(`Delete the private chat with ${displayName(user)}? This removes the conversation for both users.`)) return;
    await api(`/api/chat/private-messages/${user.id}`, { method: "DELETE" });
    toast("Private chat deleted.");
    await loadPm(user.id);
    openPmConversations().catch((error) => toast(error.message));
  });
}

function openPm(userId, fallbackUser = null) {
  const numericUserId = Number(userId);
  if (!numericUserId || numericUserId === Number(state.me.id)) return toast("Choose another user to message.");
  const user = userById(numericUserId) || fallbackUser;
  if (!user) return toast("User not found.");
  if ($("#profileModal").open) $("#profileModal").close();
  state.activePmUserId = numericUserId;
  state.pmUploadFile = null;
  setDrawerChrome({ title: "Private message", pm: true });
  renderPmDrawerActions(user);
  $("#drawerBody").innerHTML = `
    <div class="pm-card">
      <div class="pm-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <span><strong>${html(displayName(user))}</strong><small>${userRankBadge(user)}</small></span>
        <span class="pm-head-actions">
          <button class="pm-head-action" data-pm-inbox type="button" title="Back to private messages">Inbox</button>
          <button class="pm-head-action" data-view-profile="${user.id}" type="button" title="View profile">View</button>
        </span>
      </div>
      <div id="pmThread" class="pm-thread"></div>
      <div class="pm-composer-shell">
        <input id="pmAttachment" class="hidden" type="file" accept="image/*" />
        <div id="pmUploadPreview" class="upload-preview hidden"></div>
        <form id="pmForm" class="composer-input pm-composer">
          <button class="composer-icon" id="pmEmojiButton" type="button" title="Emoji"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8 9.5a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm8 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm-4 7.2c-2.2 0-4-1.2-5-3h10c-1 1.8-2.8 3-5 3Z"/></svg></button>
          <input id="pmInput" placeholder="Type here.." />
          <button class="composer-icon" id="pmUploadButton" type="button" title="Send image"><svg viewBox="0 0 24 24"><path d="M5 5h3l1.5-2h5L16 5h3a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm7 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-2.2a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z"/></svg></button>
          <button class="send icon-send" type="submit" title="Send"><svg viewBox="0 0 24 24"><path d="M2 21 23 12 2 3v7l13 2-13 2z"/></svg></button>
        </form>
      </div>
    </div>
  `;
  showDrawer();
  loadPm(numericUserId).catch((error) => {
    $("#pmThread").innerHTML = `<p class="muted">${html(error.message)}</p>`;
  });
  $("#pmEmojiButton").addEventListener("click", (event) => openEmojiPicker("#pmInput", event.currentTarget));
  $("#pmUploadButton").addEventListener("click", () => $("#pmAttachment").click());
  $("#pmAttachment").addEventListener("change", () => {
    state.pmUploadFile = $("#pmAttachment").files[0];
    if (!state.pmUploadFile) return;
    $("#pmUploadPreview").innerHTML = `<span>${html(state.pmUploadFile.name)}</span>`;
    $("#pmUploadPreview").classList.remove("hidden");
  });
  $("[data-pm-inbox]", $("#drawerBody")).addEventListener("click", () => {
    state.activePmUserId = null;
    openPmConversations().catch((error) => toast(error.message));
  });
  $("[data-view-profile]", $("#drawerBody")).addEventListener("click", () => openProfile(numericUserId));
  $("#pmForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = $("#pmInput").value.trim();
    if (!body && !state.pmUploadFile) return;
    const form = new FormData();
    form.append("receiverId", numericUserId);
    form.append("body", body);
    if (state.pmUploadFile) form.append("attachment", state.pmUploadFile);
    try {
      $("#pmInput").value = "";
      await api("/api/chat/private-messages", { method: "POST", body: form });
      state.pmUploadFile = null;
      $("#pmAttachment").value = "";
      $("#pmUploadPreview").classList.add("hidden");
      await loadPm(numericUserId);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function loadPm(userId) {
  const rows = await api(`/api/chat/private-messages/${userId}`);
  refreshPmUnread().catch(() => {});
  $("#pmThread").innerHTML = rows.map((row) => `
    <div class="pm-message ${Number(row.sender_id) === Number(state.me.id) ? "own" : ""}">
      <span><strong>${html(row.sender_username)}</strong><small>${formatTime(row.created_at)}${row.read_at ? " | seen" : ""}</small></span>
      ${row.body ? `<p>${html(row.body)}</p>` : ""}
      ${row.attachment_url ? `<img class="pm-attachment" src="${html(row.attachment_url)}" alt="Private message attachment" />` : ""}
    </div>
  `).join("") || '<p class="muted">No private messages yet.</p>';
  $("#pmThread").scrollTop = $("#pmThread").scrollHeight;
}

async function openPmConversations() {
  state.activePmUserId = null;
  setDrawerChrome({ title: "Private messages" });
  showDrawer();
  const startUsers = state.users
    .filter((user) => Number(user.id) !== Number(state.me.id) && visibleInUserList(user))
    .sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || displayName(a).localeCompare(displayName(b)));
  const userFallbacks = new Map(startUsers.map((user) => [Number(user.id), user]));

  const renderPmDirectory = (rows = [], recentUnavailable = false) => {
    const conversationIds = new Set(rows.map((item) => Number(item.id)));
    $("#drawerBody").innerHTML = `
      <div class="pm-inbox">
        <div class="pm-section-title"><span>Ongoing texts</span><small>${rows.length || "none"}</small></div>
        ${rows.map((item) => {
          const user = {
            id: item.id,
            username: item.username,
            display_name: item.display_name,
            rank_name: item.rank_name,
            profile_title: item.profile_title,
            avatar_url: item.avatar_url,
            gender: item.gender,
          };
          const unreadCount = Number(item.unread_count || 0);
          return `
            <button class="pm-conversation ${unreadCount > 0 ? "unread" : ""}" data-pm-open="${item.id}" type="button">
              <span class="status ${isOnline(userById(item.id)) ? "" : "offline"}"></span>
              <img class="avatar" src="${html(avatar(user))}" alt="" />
              <span><strong>${html(displayName(user))}</strong><small>${html(item.last_body || "Image")}</small></span>
              ${unreadCount > 0 ? `<em><i></i>${unreadCount}</em>` : ""}
            </button>
          `;
        }).join("") || `<div class="pm-empty"><strong>${recentUnavailable ? "Recent chats unavailable" : "No private chats yet"}</strong><span>Pick someone below to start texting.</span></div>`}
        <section class="pm-start-panel">
          <div class="pm-section-title"><span>Start a text</span><small>${startUsers.length || "none"}</small></div>
          <input id="pmUserSearch" class="pm-user-search" placeholder="Search people..." autocomplete="off" />
          <div class="pm-start-list" id="pmStartList"></div>
        </section>
      </div>`;
    const renderStartUsers = () => {
      const query = ($("#pmUserSearch")?.value || "").trim().toLowerCase();
      const filtered = startUsers
        .filter((user) => {
          const label = `${displayName(user)} ${user.username || ""}`.toLowerCase();
          return !query || label.includes(query);
        })
        .slice(0, 80);
      $("#pmStartList").innerHTML = filtered.map((user) => `
        <button class="pm-conversation pm-start-user ${conversationIds.has(Number(user.id)) ? "existing" : ""}" data-pm-start="${user.id}" type="button">
          <span class="status ${isOnline(user) ? "" : "offline"}"></span>
          <img class="avatar" src="${html(avatar(user))}" alt="" />
          <span><strong>${html(displayName(user))}</strong><small>${userRankBadge(user)}</small></span>
        </button>
      `).join("") || '<p class="muted">No users available to message.</p>';
      $$("[data-pm-start]", $("#drawerBody")).forEach((button) => button.addEventListener("click", () => {
        openPm(button.dataset.pmStart, userFallbacks.get(Number(button.dataset.pmStart)));
      }));
    };
    $$("[data-pm-open]", $("#drawerBody")).forEach((button) => {
      const item = rows.find((row) => Number(row.id) === Number(button.dataset.pmOpen));
      const fallback = item ? {
        id: item.id,
        username: item.username,
        display_name: item.display_name,
        rank_name: item.rank_name,
        profile_title: item.profile_title,
        avatar_url: item.avatar_url,
        gender: item.gender,
      } : null;
      button.addEventListener("click", () => openPm(button.dataset.pmOpen, fallback));
    });
    $("#pmUserSearch")?.addEventListener("input", renderStartUsers);
    renderStartUsers();
    $("#pmUserSearch")?.focus();
  };

  renderPmDirectory();
  try {
    const rows = await api("/api/chat/private-conversations");
    if (state.activePmUserId) return;
    state.unreadPm = rows.reduce((total, item) => total + Number(item.unread_count || 0), 0);
    setBadges();
    renderPmDirectory(rows);
  } catch (error) {
    if (state.activePmUserId) return;
    refreshPmUnread().catch(() => {});
    renderPmDirectory([], true);
  }
}

async function renderAdmin() {
  const data = await api("/api/admin/dashboard");
  $("#adminDashboard").innerHTML = `
    <section class="admin-hero">
      <div>
        <span class="eyebrow">Developer console</span>
        <h2>Admin panel</h2>
        <p>Moderate users, review reports, tune rank permissions, and keep Teen Chat Town clean.</p>
      </div>
      <div class="admin-hero-actions"><button class="primary" id="adminRefresh" type="button">Refresh panel</button><button id="adminClose" type="button">Close</button></div>
    </section>
    <div class="admin-stats">
      <article class="stat-card"><strong>${data.stats.totalUsers}</strong><span>Total users</span></article>
      <article class="stat-card"><strong>${data.stats.staffCount}</strong><span>Staff</span></article>
      <article class="stat-card"><strong>${data.stats.rooms}</strong><span>Rooms</span></article>
      <article class="stat-card"><strong>${data.stats.openReports}</strong><span>Open reports</span></article>
    </div>
    <section class="panel admin-panel"><h2>Post news</h2>
      <form id="adminNewsForm" class="news-form">
        <input name="title" placeholder="News title" required />
        <input name="imageUrl" placeholder="Optional image URL" />
        <textarea name="body" placeholder="Write the announcement, event, or site update" required></textarea>
        <button class="primary" type="submit">Publish news</button>
      </form>
    </section>
    <section class="panel admin-panel"><h2>Create room</h2>
      <form id="adminCreateRoom" class="room-create-form">
        <input name="name" placeholder="Room name" required />
        <input name="description" placeholder="Room description" required />
        <input name="imageUrl" placeholder="Room image URL or /assets/room-main.svg" />
        <input name="password" placeholder="Optional room password" />
        <label class="file-pill">Room image<input name="image" type="file" accept="image/*" /></label>
        <button class="primary" type="submit">Create room</button>
      </form>
    </section>
    <section class="panel admin-panel"><h2>User handling</h2><div class="admin-table">${data.users.map((user) => `
      <div class="admin-user-row">
        <img class="avatar" src="${html(avatar({ avatarUrl: user.avatar_url }))}" alt="" />
        <span><strong>${html(user.username)}</strong><small>${rankBadge(user.rank_name)} ${html(user.email)} ${user.ip_address ? `| IP ${html(user.ip_address)}` : ""}</small></span>
        <select data-admin-rank="${user.id}">${data.ranks.map((rank) => `<option value="${rank}" ${rank === user.rank_name ? "selected" : ""}>${rank}</option>`).join("")}</select>
        <button data-admin-user="${user.id}" type="button">Actions</button>
      </div>`).join("")}</div></section>
    <section class="panel admin-panel"><h2>Reports</h2><div class="admin-table">${data.reports.map((report) => `
      <div class="report-row">
        <span><strong>${html(report.target_type || "user")} report</strong><small>By ${html(report.reporter_name || `#${report.reporter_id}`)} ${report.target_name ? `about ${html(report.target_name)}` : ""} ${report.message_id ? `| chat #${report.message_id}` : ""} ${report.private_message_id ? `| PM #${report.private_message_id}` : ""} ${report.wall_post_id ? `| wall #${report.wall_post_id}` : ""}</small></span>
        <p>${html(report.reason)}</p>
        <select data-report-status="${report.id}">
          ${["open", "reviewing", "resolved", "dismissed"].map((status) => `<option value="${status}" ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>`).join("") || '<p class="muted">No reports yet.</p>'}</div></section>
    <section class="panel admin-panel"><h2>Private chats</h2><div class="admin-table">${(data.privateConversations || []).map((chat) => `
      <div class="admin-private-row">
        <span class="private-chat-pair">
          <img class="avatar" src="${html(chat.user_one_avatar || "/assets/avatar-other.svg")}" alt="" />
          <img class="avatar" src="${html(chat.user_two_avatar || "/assets/avatar-other.svg")}" alt="" />
        </span>
        <span><strong>${html(chat.user_one_name)} and ${html(chat.user_two_name)}</strong><small>${Number(chat.message_count || 0)} messages | ${html(chat.last_body || "Image")} | ${formatDate(chat.last_message_at)} ${formatTime(chat.last_message_at)}</small></span>
        <button data-admin-delete-chat="${chat.user_one_id}:${chat.user_two_id}" type="button">Delete chat</button>
      </div>`).join("") || '<p class="muted">No private chats yet.</p>'}</div></section>
    <section class="panel admin-panel"><h2>Rank permissions</h2><div class="permission-grid">${data.ranks.filter((rank) => rank !== "developer").map((rank) => `<article class="permission-card"><strong>${html(rank)}</strong>${data.staffTools.map((tool) => `<label><input type="checkbox" data-permission-rank="${html(rank)}" data-permission-tool="${html(tool)}" ${data.permissions.find((p) => p.rank_name === rank && p.tool === tool && p.allowed) ? "checked" : ""}/> ${html(permissionLabel(tool))}</label>`).join("")}</article>`).join("")}</div></section>
    <section class="panel admin-panel"><h2>Rank badges</h2><div class="badge-editor">${data.ranks.filter((rank) => rank !== "developer").map((rank) => {
      const badge = state.rankBadges[rank] || {};
      return `<article class="badge-edit-row">
        <strong>${rankBadge(rank)} ${html(rank)}</strong>
        <input data-badge-label="${html(rank)}" value="${html(badge.label || rank)}" maxlength="16" />
        <input data-badge-color="${html(rank)}" value="${html(badge.color || "#8b5cf6")}" />
        <input data-badge-image="${html(rank)}" value="${html(badge.imageUrl || "")}" placeholder="/assets/badge-${html(rank.replaceAll(" ", "-"))}.svg" />
        <button data-badge-save="${html(rank)}" type="button">Save badge</button>
      </article>`;
    }).join("")}</div></section>
    <section class="panel admin-panel"><h2>Console log</h2><div class="console-list">${data.logs.map((log) => `<p><span>${formatDate(log.created_at)} ${formatTime(log.created_at)}</span><strong>${html(log.actor_name)}</strong> ${html(log.action)} ${log.details ? `<small>${html(log.details)}</small>` : ""}</p>`).join("")}</div></section>
  `;
  $("#adminRefresh").addEventListener("click", renderAdmin);
  $("#adminClose").addEventListener("click", () => setView("chat"));
  $("#adminNewsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/news", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    toast("News posted.");
    event.currentTarget.reset();
    if ($("#newsView").classList.contains("active")) await renderNews();
  });
  $("#adminCreateRoom").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/chat/rooms", { method: "POST", body: form });
    toast("Room created.");
    await bootstrap();
    await renderAdmin();
  });
  $$("[data-admin-user]").forEach((button) => button.addEventListener("click", () => openStaffActions(button.dataset.adminUser)));
  $$("[data-admin-rank]").forEach((select) => select.addEventListener("change", async () => {
    await api(`/api/admin/users/${select.dataset.adminRank}`, { method: "PATCH", body: JSON.stringify({ rank: select.value }) });
    await renderAdmin();
  }));
  $$("[data-report-status]").forEach((select) => select.addEventListener("change", async () => {
    await api(`/api/admin/reports/${select.dataset.reportStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
    toast("Report updated.");
  }));
  $$("[data-admin-delete-chat]").forEach((button) => button.addEventListener("click", async () => {
    const [userOneId, userTwoId] = button.dataset.adminDeleteChat.split(":");
    if (!confirm("Delete this private chat for both users?")) return;
    await api(`/api/admin/private-conversations/${userOneId}/${userTwoId}`, { method: "DELETE" });
    toast("Private chat deleted.");
    await renderAdmin();
  }));
  $$("[data-permission-rank]").forEach((input) => input.addEventListener("change", async () => {
    await api("/api/admin/permissions", { method: "POST", body: JSON.stringify({ rank: input.dataset.permissionRank, tool: input.dataset.permissionTool, allowed: input.checked }) });
  }));
  $$("[data-badge-save]").forEach((button) => button.addEventListener("click", async () => {
    const rank = button.dataset.badgeSave;
    await api("/api/admin/rank-badges", {
      method: "POST",
      body: JSON.stringify({
        rank,
        label: $$("[data-badge-label]").find((input) => input.dataset.badgeLabel === rank).value,
        color: $$("[data-badge-color]").find((input) => input.dataset.badgeColor === rank).value,
        imageUrl: $$("[data-badge-image]").find((input) => input.dataset.badgeImage === rank).value,
      }),
    });
    toast("Rank badge saved.");
    await bootstrap();
    await renderAdmin();
  }));
}

function connectEvents() {
  if (state.eventSource) return;
  state.eventSource = new EventSource(`/api/chat/events?token=${encodeURIComponent(state.token)}`);
  state.eventSource.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (Number(message.room_id) === Number(state.currentRoomId)) {
      state.messages.push(message);
      renderMessages();
    }
  });
  state.eventSource.addEventListener("typing", (event) => {
    const data = JSON.parse(event.data);
    if (Number(data.roomId) === Number(state.currentRoomId) && Number(data.userId) !== Number(state.me.id)) {
      $("#typingText").textContent = `${data.username} is typing...`;
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(setTypingIdle, 1800);
    }
  });
  state.eventSource.addEventListener("notification", async () => { state.notifications = await api("/api/social/notifications"); setBadges(); refreshReportBadge().catch(() => {}); });
  state.eventSource.addEventListener("private-message", (event) => {
    const data = JSON.parse(event.data || "{}");
    if (state.activePmUserId && Number(data.senderId) === Number(state.activePmUserId) && !$("#drawer").classList.contains("hidden")) {
      loadPm(state.activePmUserId).catch(() => {});
      return;
    }
    refreshPmUnread().catch(() => {
      state.unreadPm += 1;
      setBadges();
    });
    if (!state.activePmUserId && !$("#drawer").classList.contains("hidden") && $("#drawerTitle").textContent === "Private messages") {
      openPmConversations().catch(() => {});
    }
  });
  state.eventSource.addEventListener("private-chat-deleted", (event) => {
    const data = JSON.parse(event.data || "{}");
    const affectedIds = [data.otherUserId, data.userOneId, data.userTwoId].map(Number).filter(Boolean);
    if (state.activePmUserId && affectedIds.includes(Number(state.activePmUserId)) && !$("#drawer").classList.contains("hidden")) {
      loadPm(state.activePmUserId).catch(() => {});
      toast("This private chat was deleted by staff.");
      return;
    }
    if (!state.activePmUserId && !$("#drawer").classList.contains("hidden") && $("#drawerTitle").textContent === "Private messages") {
      openPmConversations().catch(() => {});
    }
    refreshPmUnread().catch(() => {});
  });
  state.eventSource.addEventListener("moderation", (event) => {
    const data = JSON.parse(event.data);
    toast(data.body || data.title || "Staff action applied.");
    if (["kick", "ban"].includes(data.action)) {
      localStorage.removeItem("tct_token");
      setTimeout(() => location.reload(), 900);
    }
  });
  state.eventSource.addEventListener("users-changed", async () => {
    const data = await api("/api/auth/me");
    state.me = data.me;
    state.users = data.users;
    state.notifications = data.notifications || state.notifications;
    state.unreadPm = Number(data.unreadPm || state.unreadPm || 0);
    renderUsers();
    renderProfiles();
    if ($("#leaderboardView").classList.contains("active")) renderLeaderboard().catch((error) => toast(error.message));
    setBadges();
  });
  state.eventSource.addEventListener("message-updated", (event) => {
    const data = JSON.parse(event.data);
    const message = state.messages.find((item) => Number(item.id) === Number(data.id));
    if (message) message.body = data.body;
    renderMessages();
  });
  state.eventSource.addEventListener("message-deleted", (event) => {
    const data = JSON.parse(event.data);
    state.messages = state.messages.filter((item) => Number(item.id) !== Number(data.id));
    renderMessages();
  });
  state.eventSource.addEventListener("room-cleared", (event) => {
    const data = JSON.parse(event.data);
    if (Number(data.roomId) === Number(state.currentRoomId)) {
      state.messages = [];
      renderMessages();
      toast(`${data.by || "Staff"} cleared this room.`);
    }
  });
  state.eventSource.addEventListener("reaction", loadMessages);
  state.eventSource.addEventListener("message-pinned", loadMessages);
  state.eventSource.addEventListener("rooms-changed", bootstrap);
  state.eventSource.addEventListener("news-posted", (event) => {
    const data = JSON.parse(event.data || "{}");
    const newsIsOpen = $("#newsView").classList.contains("active");
    if (!data.comment && !newsIsOpen) markNewsUnread();
    if (newsIsOpen) {
      clearNewsUnread();
      renderNews().catch((error) => toast(error.message));
    }
  });
  state.eventSource.addEventListener("report-created", () => refreshReportBadge().catch(() => {}));
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("tct_token");
  location.reload();
}

function fillSelect(select, placeholder, items) {
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>${items.map(([value, label]) => `<option value="${html(value)}">${html(label)}</option>`).join("")}`;
}

function setupDobSelects() {
  const day = $("#dobDay");
  const month = $("#dobMonth");
  const year = $("#dobYear");
  const input = $("#dobInput");
  if (!day || !month || !year || !input) return;

  const months = [
    ["01", "Jan"],
    ["02", "Feb"],
    ["03", "Mar"],
    ["04", "Apr"],
    ["05", "May"],
    ["06", "Jun"],
    ["07", "Jul"],
    ["08", "Aug"],
    ["09", "Sep"],
    ["10", "Oct"],
    ["11", "Nov"],
    ["12", "Dec"],
  ];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_item, index) => {
    const value = String(currentYear - 13 - index);
    return [value, value];
  });

  fillSelect(month, "Month", months);
  fillSelect(year, "Year", years);

  const updateDays = () => {
    const selected = day.value;
    const total = month.value && year.value ? new Date(Number(year.value), Number(month.value), 0).getDate() : 31;
    fillSelect(day, "Day", Array.from({ length: total }, (_item, index) => {
      const value = String(index + 1).padStart(2, "0");
      return [value, value];
    }));
    if (selected && Number(selected) <= total) day.value = selected;
  };

  const updateValue = () => {
    updateDays();
    input.value = day.value && month.value && year.value ? `${year.value}-${month.value}-${day.value}` : "";
  };

  updateDays();
  [day, month, year].forEach((select) => select.addEventListener("change", updateValue));
}

function bindEvents() {
  $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    $$(".auth-form").forEach((form) => form.classList.remove("active"));
    $(`#${button.dataset.authTab}Form`).classList.add("active");
  }));

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      state.token = data.token;
      localStorage.setItem("tct_token", state.token);
      await bootstrap();
    } catch (error) {
      $("#authMessage").textContent = error.message;
    }
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      if (!payload.dob) {
        $("#authMessage").textContent = "Choose your day, month, and year of birth.";
        return;
      }
      delete payload.dobDay;
      delete payload.dobMonth;
      delete payload.dobYear;
      const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      state.token = data.token;
      localStorage.setItem("tct_token", state.token);
      await bootstrap();
    } catch (error) {
      $("#authMessage").textContent = error.message;
    }
  });

  $$(".side-nav [data-view]").forEach((button) => button.addEventListener("click", async () => {
    setView(button.dataset.view);
    if (state.compactLayout) $("#app").classList.remove("nav-open");
    if (button.dataset.view === "admin") await renderAdmin();
  }));
  $$("[data-close-view]").forEach((button) => button.addEventListener("click", () => setView("chat")));
  $("#reportFlagIcon").addEventListener("click", (event) => {
    event.stopPropagation();
    openReportQueueDrawer().catch((error) => toast(error.message));
  });
  $("#menuButton").addEventListener("click", () => $("#app").classList.toggle("nav-open"));
  $("#roomSwitchButton")?.addEventListener("click", openRoomSwitcher);
  $("#rightToggleButton").addEventListener("click", () => $("#app").classList.toggle("right-closed"));
  $("#closeRightPanel").addEventListener("click", () => $("#app").classList.add("right-closed"));
  $("#refreshButton").addEventListener("click", bootstrap);
  $("#profileButton").addEventListener("click", openOwnMenu);
  $("#pmIcon").addEventListener("click", () => openPmConversations());
  $("#friendIcon").addEventListener("click", () => openFriendRequestDrawer());
  $("#notificationIcon").addEventListener("click", async () => {
    setDrawerChrome({ title: "Notifications" });
    const rows = await api("/api/social/notifications");
    $("#drawerBody").innerHTML = rows.map((n) => `<div class="request-row"><span><strong>${html(n.title)}</strong><small>${html(n.body)}</small></span></div>`).join("") || '<p class="muted">No notifications.</p>';
    showDrawer();
    await api("/api/social/notifications/read", { method: "POST" });
    state.notifications = rows.map((row) => ({ ...row, is_read: 1 }));
    setBadges();
  });
  $("#closeDrawer").addEventListener("click", () => {
    $("#drawer").classList.add("hidden");
    state.activePmUserId = null;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".message-menu-wrap")) closeMessageMenus();
    if (!event.target.closest(".emoji-picker") && !event.target.closest("#emojiButton") && !event.target.closest("#pmEmojiButton")) $(".emoji-picker")?.remove();
    const drawer = $("#drawer");
    const drawerTrigger = event.target.closest("#profileButton, #pmIcon, #friendIcon, #notificationIcon, #reportFlagIcon, #roomSwitchButton, #pmSettingsButton, #pmExpandButton, [data-user-id], [data-open-user-menu], [data-open-profile-actions], [data-user-action-panel], [data-pm-user], [data-pm-open], [data-pm-start], [data-own-action], [data-view-profile], [data-report-chat], [data-delete-pm-chat]");
    if (drawer && !drawer.classList.contains("hidden") && !event.target.closest("#drawer") && !drawerTrigger) {
      drawer.classList.add("hidden");
      state.activePmUserId = null;
    }
  });
  $$("[data-user-tab]").forEach((button) => button.addEventListener("click", () => { state.userTab = button.dataset.userTab; $$("[data-user-tab]").forEach((b) => b.classList.remove("active")); button.classList.add("active"); renderUsers(); }));

  $("#messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = $("#messageInput").value.trim();
    if (!body && !state.uploadFile) return;
    try {
      if (body.toLowerCase() === "/clear") {
        await api(`/api/chat/rooms/${state.currentRoomId}/messages`, { method: "DELETE" });
        $("#messageInput").value = "";
        $("#charCount").textContent = "0/1200";
        toast("Room cleared.");
        return;
      }
      const form = new FormData();
      form.append("body", body);
      if (state.replyToId) form.append("replyToId", state.replyToId);
      if (state.uploadFile) form.append("attachment", state.uploadFile);
      await api(`/api/chat/rooms/${state.currentRoomId}/messages`, { method: "POST", body: form });
      $("#messageInput").value = "";
      $("#charCount").textContent = "0/1200";
      state.replyToId = null;
      state.uploadFile = null;
      $("#replyBox").classList.add("hidden");
      $("#uploadPreview").classList.add("hidden");
      $("#slashSuggestions").classList.add("hidden");
      $("#messageAttachment").value = "";
    } catch (error) {
      toast(error.message);
    }
  });
  $("#messageInput").addEventListener("input", () => {
    $("#charCount").textContent = `${$("#messageInput").value.length}/1200`;
    renderSlashSuggestions();
    api("/api/chat/typing", { method: "POST", body: JSON.stringify({ roomId: state.currentRoomId }) }).catch(() => {});
  });
  $("#clearReply").addEventListener("click", () => { state.replyToId = null; $("#replyBox").classList.add("hidden"); });
  $("#emojiButton").addEventListener("click", (event) => openEmojiPicker("#messageInput", event.currentTarget));
  $("#uploadMessageButton").addEventListener("click", () => $("#messageAttachment").click());
  $("#messageAttachment").addEventListener("change", () => {
    state.uploadFile = $("#messageAttachment").files[0];
    if (state.uploadFile) {
      $("#uploadPreview").innerHTML = `<span>${html(state.uploadFile.name)}</span>`;
      $("#uploadPreview").classList.remove("hidden");
    }
  });
  $("#voiceButton").addEventListener("click", () => toast("Voice recording needs HTTPS on the live domain before microphone capture can start."));
  window.addEventListener("resize", syncResponsiveLayout);
  $("#avatarUpload").addEventListener("change", () => {
    const file = $("#avatarUpload").files[0];
    if (file) $("#editAvatarPreview").src = URL.createObjectURL(file);
  });
  $("#bannerUpload").addEventListener("change", () => {
    const file = $("#bannerUpload").files[0];
    if (file) $("#editBannerPreview").style.setProperty("--edit-banner", `url('${URL.createObjectURL(file)}')`);
  });
  $("#editProfileForm").bio.addEventListener("input", () => {
    $("#bioCount").textContent = `${$("#editProfileForm").bio.value.length}/120`;
  });
  $$("[data-accent]").forEach((button) => button.addEventListener("click", () => {
    $("#editProfileForm").profileAccent.value = button.dataset.accent;
    $$("[data-accent]").forEach((node) => node.classList.toggle("active", node === button));
  }));

  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$(".profile-tabs [data-profile-tab]").forEach((button) => button.addEventListener("click", () => {
    $$(".profile-tabs button").forEach((b) => b.classList.remove("active"));
    $$(".profile-tab").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(`#profile${button.dataset.profileTab[0].toUpperCase()}${button.dataset.profileTab.slice(1)}`).classList.add("active");
  }));

  $("#editProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.showOnlineStatus = event.currentTarget.showOnlineStatus.checked;
    delete payload.level;
    await api("/api/auth/me", { method: "PATCH", body: JSON.stringify(payload) });
    if ($("#avatarUpload").files[0]) {
      const form = new FormData();
      form.append("avatar", $("#avatarUpload").files[0]);
      await api("/api/auth/me/avatar", { method: "POST", body: form });
    }
    if ($("#bannerUpload").files[0]) {
      const form = new FormData();
      form.append("banner", $("#bannerUpload").files[0]);
      await api("/api/auth/me/banner", { method: "POST", body: form });
    }
    await bootstrap();
    $("#editProfileModal").close();
  });
  $("#changePasswordButton").addEventListener("click", async () => {
    const currentPassword = prompt("Current password");
    const newPassword = prompt("New password");
    if (currentPassword && newPassword) await api("/api/auth/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  });
  $("#deleteRequestButton").addEventListener("click", async () => alert((await api("/api/auth/me/delete-request", { method: "POST" })).message));
  $("#cancelDeleteButton").addEventListener("click", async () => alert((await api("/api/auth/me/cancel-delete", { method: "POST" })).message));
}

applyTheme(localStorage.getItem("tct_theme") || "dark");
setupDobSelects();
bindEvents();
if (state.token) bootstrap().catch(() => localStorage.removeItem("tct_token"));
