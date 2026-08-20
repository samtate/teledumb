const app = document.querySelector("#app");
const soft = [document.querySelector("#soft-left"), document.querySelector("#soft-center"), document.querySelector("#soft-right")];
let state = { view: "loading", conversations: [], selected: null, messages: [], settings: {} };
let refreshTimer;
let typingTimer;
let typingActive = false;
let activeRecording = null;
const MINDFUL_KEY = "teledumb-mindful-usage-v1";
const MINDFUL_LAUNCH_GAP = 90_000;
const MINDFUL_BURST_WINDOW = 45 * 60_000;
const MINDFUL_TIME_THRESHOLDS = [15, 25];
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const EMOJI_GROUPS = {
  Faces: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕",
  Hands: "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪",
  Animals: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪲 🐞 🦋 🐌 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🦬 🐄 🐎 🐖 🐏 🦙 🐐 🦌 🐕 🐈 🪶",
  Food: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🥡 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍯 ☕️ 🫖 🥤 🧋 🍺 🍷",
};

function setSoftkeys(left = "", center = "", right = "") { [left, center, right].forEach((value, index) => soft[index].textContent = value); }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return payload;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function focusFirst() { requestAnimationFrame(() => document.querySelector(".focusable")?.focus()); }
function initials(name) { return String(name || "?").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }
function receiptTime(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return date.toLocaleString([], sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function stopRefresh() { clearInterval(refreshTimer); }
function usageDay() { return new Date().toLocaleDateString("en-CA"); }
function loadMindfulUsage() {
  try {
    const saved = JSON.parse(localStorage.getItem(MINDFUL_KEY) || "{}");
    if (saved.day === usageDay()) return { day: saved.day, checks: Number(saved.checks) || 0, activeMs: Number(saved.activeMs) || 0, launches: Array.isArray(saved.launches) ? saved.launches : [], nudges: saved.nudges || {}, lastLaunch: Number(saved.lastLaunch) || 0 };
  } catch {}
  return { day: usageDay(), checks: 0, activeMs: 0, launches: [], nudges: {}, lastLaunch: 0 };
}
function saveMindfulUsage() { if (state.mindful) localStorage.setItem(MINDFUL_KEY, JSON.stringify(state.mindful)); }
function usageLabel() { const usage = state.mindful; if (!usage) return ""; return `${usage.checks} check${usage.checks === 1 ? "" : "s"} · ${Math.floor(usage.activeMs / 60_000)}m`; }
function usageBadge() { return state.mindful ? `<span class="usage-tally" aria-label="Today's usage">${escapeHtml(usageLabel())}</span>` : ""; }
function refreshUsageBadge() { document.querySelectorAll(".usage-tally").forEach(node => { node.textContent = usageLabel(); }); }
function startMindfulSession() {
  if (state.mindfulStarted) return;
  state.mindfulStarted = true; state.mindful = loadMindfulUsage();
  const now = Date.now();
  if (!state.mindful.lastLaunch || now - state.mindful.lastLaunch >= MINDFUL_LAUNCH_GAP) { state.mindful.checks++; state.mindful.launches.push(now); state.mindful.openedNow = true; }
  state.mindful.lastLaunch = now; state.mindful.launches = state.mindful.launches.filter(time => now - time < 24 * 60 * 60_000); state.mindful.lastTick = now; state.mindfulVisible = !document.hidden;
  saveMindfulUsage(); clearInterval(state.mindfulTimer); state.mindfulTimer = setInterval(updateMindfulTime, 15_000);
}
function updateMindfulTime() {
  const usage = state.mindful; if (!usage) return;
  const now = Date.now(); const elapsed = Math.max(0, now - (usage.lastTick || now)); usage.lastTick = now;
  if (state.mindfulVisible !== false && !state.mindfulPause) usage.activeMs += elapsed;
  saveMindfulUsage(); refreshUsageBadge(); maybeMindfulPause();
}
function mindfulReason() {
  const usage = state.mindful; if (!usage || !usage.openedNow) return "";
  usage.openedNow = false;
  const now = Date.now(); const recent = usage.launches.filter(time => now - time <= MINDFUL_BURST_WINDOW).length;
  if (recent >= 2 && (!usage.nudges.lastBurst || now - usage.nudges.lastBurst >= MINDFUL_BURST_WINDOW)) { usage.nudges.lastBurst = now; return "This is your second check in 45 minutes."; }
  if ([4, 6, 9].includes(usage.checks) && !usage.nudges[`checks-${usage.checks}`]) { usage.nudges[`checks-${usage.checks}`] = true; return `This is check ${usage.checks} today.`; }
  return "";
}
function maybeMindfulPause() {
  if (!state.mindful || state.mindfulPause) return;
  let reason = mindfulReason();
  for (const minutes of MINDFUL_TIME_THRESHOLDS) {
    const key = `minutes-${minutes}`;
    if (!reason && state.mindful.activeMs >= minutes * 60_000 && !state.mindful.nudges[key]) { state.mindful.nudges[key] = true; reason = `You've spent ${minutes} minutes here today.`; }
  }
  saveMindfulUsage(); if (reason) showMindfulPause(reason);
}
function pauseMindfulRefresh() { if (refreshTimer) { stopRefresh(); state.mindfulRefreshPaused = true; } }
function resumeMindfulRefresh() {
  if (!state.mindfulRefreshPaused) return;
  state.mindfulRefreshPaused = false;
  if (state.view === "conversations") refreshTimer = setInterval(() => state.view === "conversations" && conversations(document.activeElement?.dataset.id, state.showingArchived).catch(() => {}), 3000);
  if (state.view === "room") refreshTimer = setInterval(() => state.view === "room" && refreshRoom(), 5000);
}
function showMindfulPause(reason) {
  pauseMindfulRefresh(); state.mindfulPause = true; state.mindfulReturnFocus = document.activeElement;
  app.insertAdjacentHTML("beforeend", `<section class="mindful-pause" role="dialog" aria-modal="true"><div><span class="mindful-icon">◷</span><h2>A quick pause</h2><p>${escapeHtml(reason)}</p><p class="hint">Open with intention, then carry on.</p><button id="mindful-continue" class="action primary focusable">Continue</button></div></section>`);
  setSoftkeys("", "Continue", "Exit"); const continueButton = document.querySelector("#mindful-continue"); continueButton.addEventListener("click", dismissMindfulPause); requestAnimationFrame(() => continueButton.focus());
}
function dismissMindfulPause() { state.mindfulPause = false; document.querySelector(".mindful-pause")?.remove(); state.mindfulReturnFocus?.focus?.({ preventScroll: true }); state.mindfulReturnFocus = null; resumeMindfulRefresh(); }
function screen(title, content, className = "") { const heading = title === "TeleDumb" ? `<span class="brand-title"><img src="/teledumb.png" alt="">TeleDumb</span>` : escapeHtml(title); app.innerHTML = `<section class="screen ${className}"><header>${heading}${usageBadge()}</header>${content}</section>`; app.scrollTop = 0; }
function actionError(error) { const target = document.querySelector("#action-error"); if (target) target.textContent = error.message; }

function login(message = "") {
  state.view = "login"; stopRefresh();
  app.innerHTML = `<section class="center login-screen"><img class="brand-logo" src="/teledumb.png" alt=""><h1>TeleDumb</h1><p class="hint">Telegram for CloudPhone</p><form id="login-form"><input class="field focusable" name="password" type="password" autocomplete="current-password" placeholder="Instance password" required><p class="error">${escapeHtml(message)}</p></form></section>`;
  setSoftkeys("Sign in", "", "Exit");
  document.querySelector("#login-form").addEventListener("submit", async event => { event.preventDefault(); try { await request("/api/login", { method: "POST", body: JSON.stringify({ password: event.currentTarget.password.value }) }); await boot(); } catch (error) { login(error.message); } });
  focusFirst();
}

async function boot() {
  state.view = "loading"; app.innerHTML = `<section class="center"><img class="brand-logo" src="/teledumb.png" alt=""><p>Starting TeleDumb…</p></section>`; setSoftkeys();
  try {
    const status = await request("/api/status"); state.settings = status.settings || {}; state.capabilities = status.capabilities || {};
    if (!status.linked) return telegramLogin(status.authStage, status.passwordHint);
    startMindfulSession(); await conversations(); maybeMindfulPause();
  } catch (error) {
    if (error.status === 401) return login();
    app.innerHTML = `<section class="center"><p class="error">${escapeHtml(error.message)}</p><button id="retry" class="action focusable">Retry</button></section>`;
    document.querySelector("#retry").addEventListener("click", () => location.reload()); focusFirst();
  }
}

function telegramLogin(stage = "phone", hint = "", message = "") {
  state.view = "telegram-login";
  const config = stage === "password"
    ? { title: "Two-step verification", name: "password", type: "password", placeholder: hint ? `Password — hint: ${hint}` : "Telegram password", text: "Enter your Telegram two-step verification password." }
    : stage === "code"
      ? { title: "Enter code", name: "code", type: "text", placeholder: "Login code", text: "Telegram sent a code to one of your logged-in devices." }
      : { title: "Connect Telegram", name: "phone", type: "tel", placeholder: "+44…", text: "Enter your Telegram phone number in international format." };
  screen(config.title, `<div class="center auth-stage"><img class="brand-logo" src="/teledumb.png" alt=""><p>${escapeHtml(config.text)}</p><form id="telegram-auth"><input class="field focusable" name="${config.name}" type="${config.type}" placeholder="${escapeHtml(config.placeholder)}" autocomplete="off" required><p id="action-error" class="error">${escapeHtml(message)}</p></form></div>`);
  setSoftkeys("Continue", "", "Exit");
  document.querySelector("#telegram-auth").addEventListener("submit", async event => {
    event.preventDefault();
    try { const value = event.currentTarget.elements[config.name].value; const result = await request(`/api/telegram/auth/${stage}`, { method: "POST", body: JSON.stringify({ [config.name]: value }) }); if (result.stage === "authorized") await boot(); else telegramLogin(result.stage, result.passwordHint); }
    catch (error) { telegramLogin(stage, hint, error.message); }
  });
  focusFirst();
}

function receiptMarkup(message, compact = false, group = state.selected?.kind === "group") {
  if (!message || message.direction !== "out") return "";
  const status = message.status || "sent";
  const label = status === "viewed" ? "Viewed" : status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent";
  const ticks = status === "sent" ? "✓" : "✓✓";
  const receiptValues = Object.values(message.receipts || {});
  const read = receiptValues.filter(item => ["read", "viewed"].includes(item.status)).length;
  const delivered = receiptValues.filter(item => item.status === "delivered").length;
  const groupDetail = group && receiptValues.length ? ` ${read ? `${read} read` : ""}${read && delivered ? " · " : ""}${delivered ? `${delivered} delivered` : ""}` : "";
  return `<span class="receipt ${status}" title="${label}"><span class="receipt-icon"><span>${ticks}</span></span>${compact ? groupDetail : ` <span>${label}${groupDetail}</span>`}</span>`;
}
function mediaLabel(message) {
  const types = (message?.attachments || []).map(item => item.contentType || "");
  if (types.some(type => type.startsWith("image/"))) return "Photo";
  if (types.some(type => type.startsWith("video/"))) return "Video";
  return types.length ? "Attachment" : "";
}
function mentionLabel(mention) {
  const recipient = mention?.recipient && typeof mention.recipient === "object" ? mention.recipient : {};
  return [mention?.name, mention?.profileName, recipient.name, recipient.profileName, mention?.number, recipient.number, mention?.uuid, recipient.uuid, recipient.aci].find(value => typeof value === "string" && value.trim()) || "Someone";
}
function plainMentionText(value, mentions = []) {
  let text = String(value || "");
  for (const mention of [...mentions].sort((a, b) => Number(b.start || 0) - Number(a.start || 0))) { const start = Number(mention.start || 0); const length = Number(mention.length || 1); text = `${text.slice(0, start)}@${mentionLabel(mention)}${text.slice(start + length)}`; }
  return text.replaceAll("\uFFFC", "@Someone");
}
function previewMarkup(item) {
  if (item.typing?.length) return `<span class="typing">${escapeHtml(item.typing.join(", "))} typing…</span>`;
  if (!item.last) return "No messages yet";
  const sender = item.last.direction === "out" ? "You" : item.kind === "group" ? (item.last.sender || "Someone") : item.name;
  const content = plainMentionText(item.last.text, item.last.mentions) || mediaLabel(item.last) || "Message";
  return `<b>${escapeHtml(sender)}:</b> ${escapeHtml(content)} ${receiptMarkup(item.last, true, item.kind === "group")}`;
}
function avatarMarkup(item) { return item.noteToSelf ? `<span class="avatar note-avatar" aria-label="Saved Messages">🔖</span>` : `<span class="avatar"><span>${escapeHtml(initials(item.name))}</span>${item.avatar ? `<img src="${escapeHtml(item.avatar)}" alt="">` : ""}</span>`; }

async function conversations(restoreId, showArchived = state.showingArchived || false) {
  const payload = await request(`/api/conversations${showArchived ? "?archived=1" : ""}`);
  state.view = "conversations"; state.conversations = payload.conversations; state.showingArchived = payload.showingArchived; state.archivedCount = payload.archivedCount;
  const rows = payload.conversations.map(item => `<button class="row conversation-row focusable" data-id="${escapeHtml(item.id)}">${avatarMarkup(item)}<span class="row-body"><strong>${item.favorite ? "★ " : ""}${item.identityChanged ? "⚠ " : ""}${escapeHtml(item.name)}${item.unread ? ` <span class="unread">${item.unread}</span>` : ""}</strong><span class="preview">${previewMarkup(item)}</span></span></button>`).join("");
  screen(payload.showingArchived ? "Archived" : "TeleDumb", rows || `<p class="empty">${payload.showingArchived ? "No archived conversations" : "No conversations yet"}</p>`);
  setSoftkeys("Menu", "Open", payload.showingArchived ? "Back" : "Exit");
  document.querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", () => openConversation(button.dataset.id)));
  document.querySelectorAll(".avatar img").forEach(image => image.addEventListener("error", () => image.remove()));
  const target = restoreId && document.querySelector(`[data-id="${CSS.escape(restoreId)}"]`); (target || document.querySelector(".focusable"))?.focus();
  stopRefresh(); refreshTimer = setInterval(() => state.view === "conversations" && conversations(document.activeElement?.dataset.id, state.showingArchived).catch(() => {}), 3000);
}

async function openConversation(id) {
  const returning = !["conversations", "compose", "search"].includes(state.view);
  stopRefresh(); state.selected = state.conversations.find(item => item.id === id) || state.selected;
  if (!returning) { state.roomScroll = null; state.followBottom = true; }
  const payload = await request(`/api/messages/${encodeURIComponent(id)}`); renderRoom(payload);
  request("/api/read", { method: "POST", body: JSON.stringify({ conversationId: id }) }).catch(() => {});
  refreshTimer = setInterval(() => state.view === "room" && refreshRoom(), 5000);
}
function mediaHtml(message) {
  if (message.viewOnce) return message.viewOnceOpened ? `<span class="view-once opened">◉ View-once media opened</span>` : `<button class="view-once focusable" data-view-once="${escapeHtml(message.id)}">◉ Open view-once media</button>`;
  return (message.attachments || []).map((attachment, index) => { const src = `/api/attachment/${encodeURIComponent(message.id)}/${index}`; const dimensions = attachment.width && attachment.height ? ` width="${attachment.width}" height="${attachment.height}"` : ""; if (attachment.contentType?.startsWith("image/")) return `<img class="media" src="${src}" alt="${escapeHtml(attachment.caption || "Photo")}" loading="lazy"${dimensions}>`; if (attachment.contentType?.startsWith("video/")) return `<span class="video-thumb" data-video-src="${src}"><video class="media" src="${src}" preload="metadata" muted playsinline${dimensions}></video><span class="play-icon">▶</span></span>`; if (attachment.contentType?.startsWith("audio/")) return `<span class="voice-label">▶ Voice note</span><audio class="voice-note" src="${src}" controls preload="metadata"></audio>`; return ""; }).join("");
}
function openImageViewer(src, alt = "Photo", timestamp = null) {
  state.roomScroll = app.scrollTop;
  state.returnFocusTimestamp = timestamp;
  state.view = "image-viewer";
  app.innerHTML = `<section class="image-viewer"><img src="${src}" alt="${escapeHtml(alt)}"></section>`;
  setSoftkeys("", "", "Back");
}
function openVideoViewer(src, timestamp = null) {
  state.roomScroll = app.scrollTop;
  state.returnFocusTimestamp = timestamp;
  state.view = "video-viewer";
  app.innerHTML = `<section class="video-viewer"><video src="${escapeHtml(src)}" controls autoplay playsinline></video></section>`;
  setSoftkeys("", "Play/Pause", "Back");
  const video = document.querySelector(".video-viewer video"); video.play().catch(() => {});
}
function styledText(message) {
  const text = String(message.text || ""); const styles = [...(message.textStyles || []), ...(message.mentions || []).map(mention => ({ start: mention.start, length: mention.length, style: "mention" }))];
  if (!styles.length) return escapeHtml(text);
  const boundaries = new Set([0, text.length]); for (const style of styles) { boundaries.add(Number(style.start || 0)); boundaries.add(Number(style.start || 0) + Number(style.length || 0)); }
  const points = [...boundaries].filter(point => point >= 0 && point <= text.length).sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => { const end = points[index + 1]; const activeMention = (message.mentions || []).find(mention => start >= Number(mention.start || 0) && start < Number(mention.start || 0) + Number(mention.length || 1)); const active = styles.filter(style => start >= Number(style.start || 0) && start < Number(style.start || 0) + Number(style.length || 0)).map(style => String(style.style || style).toLowerCase().replaceAll("_", "-")); const spoiler = active.includes("spoiler"); const content = activeMention ? `@${mentionLabel(activeMention)}` : text.slice(start, end).replaceAll("\uFFFC", "@Someone"); return `<span class="${active.map(name => `text-${name}`).join(" ")}${spoiler ? " spoiler focusable" : ""}"${spoiler ? ' tabindex="0"' : ""}>${escapeHtml(content)}</span>`; }).join("");
}
function quoteHtml(quote) { return quote ? `<span class="quote"><b>${escapeHtml(quote.author || "Message")}</b>${escapeHtml(plainMentionText(quote.text || "Media", quote.mentions))}</span>` : ""; }
function linkPreviewsHtml(previews) { return (previews || []).map(preview => `<span class="link-preview"><b>${escapeHtml(preview.title || preview.url)}</b>${preview.description ? `<small>${escapeHtml(preview.description)}</small>` : ""}${preview.url ? `<small>${escapeHtml(preview.url)}</small>` : ""}</span>`).join(""); }
function reactionsHtml(reactions) {
  if (!reactions?.length) return "";
  const grouped = new Map(); for (const reaction of reactions) { const current = grouped.get(reaction.emoji) || { count: 0, own: false }; current.count++; current.own ||= Boolean(reaction.own || reaction.author === "You"); grouped.set(reaction.emoji, current); }
  return `<span class="reactions">${[...grouped].map(([emoji, value]) => `<span class="reaction-chip${value.own ? " own" : ""}">${emoji.replaceAll("️", "") === "❤" ? `<span class="reaction-heart">♥</span>` : escapeHtml(emoji)}${value.count > 1 ? `<small>${value.count}</small>` : ""}</span>`).join("")}</span>`;
}
function pollHtml(message) {
  if (!message.poll) return "";
  const total = message.poll.options.reduce((sum, option) => sum + option.votes.length, 0);
  return `<span class="poll"><b>▥ ${escapeHtml(message.poll.question)}</b>${message.poll.options.map(option => `<button class="poll-option focusable" data-poll-time="${message.timestamp}" data-option="${option.index}"><span>${escapeHtml(option.text)}</span><small>${option.votes.length}${total ? ` · ${Math.round(option.votes.length / total * 100)}%` : ""}</small></button>`).join("")}<small>${message.poll.closed ? "Poll closed" : message.poll.multiple ? "Select one or more" : "Select one"}</small></span>`;
}
function messageHtml(message) {
  if (message.system) return `<div class="system-message">${escapeHtml(message.text)}</div>`;
  const edited = message.edited ? " · edited" : "";
  const sender = message.direction === "in" ? `<b class="sender">${escapeHtml(message.sender)}</b>` : "";
  const sticker = message.sticker ? `<img class="sticker" src="/api/sticker/${encodeURIComponent(message.sticker.packId)}/${encodeURIComponent(message.sticker.stickerId)}" alt="${escapeHtml(message.sticker.emoji || "Sticker")}">` : "";
  const body = `${sender}${quoteHtml(message.quote)}${sticker}${mediaHtml(message)}${pollHtml(message)}${message.text ? `<span class="message-text">${styledText(message)}</span>` : ""}${linkPreviewsHtml(message.previews)}${reactionsHtml(message.reactions)}<time>${new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${edited}${message.pinned ? " · pinned" : ""} ${receiptMarkup(message, true)}</time>`;
  return `<div role="button" tabindex="0" class="bubble ${message.direction}${message.deleted ? " deleted" : ""} focusable" data-message-time="${message.timestamp}">${body}</div>`;
}
function timelineHtml(messages, readThrough) {
  let day = ""; let unreadShown = false;
  return messages.map(message => {
    const currentDay = new Date(message.timestamp).toDateString();
    const date = currentDay !== day ? `<div class="date-separator"><span>${escapeHtml(new Date(message.timestamp).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }))}</span></div>` : "";
    day = currentDay;
    const unread = !unreadShown && message.direction === "in" && message.timestamp > readThrough ? (unreadShown = true, `<div id="unread-marker" class="unread-marker">Unread messages</div>`) : "";
    return `${date}${unread}${messageHtml(message)}`;
  }).join("");
}
function draftKey() { return `draft:${state.selected?.id || ""}`; }
function saveDraft(value) { if (value) localStorage.setItem(draftKey(), value); else localStorage.removeItem(draftKey()); }
function typingIndicatorHtml(typing) {
  if (!typing?.length) return "";
  const label = `${typing.join(", ")} typing`;
  return `<div class="room-typing" role="status" aria-label="${escapeHtml(label)}"><span></span><span></span><span></span></div>`;
}
function renderRoom(payload) {
  state.view = "room"; state.messages = payload.messages; state.typing = payload.typing; state.hasMore = payload.hasMore; state.readThrough = payload.readThrough || 0; state.allowedReactions = payload.allowedReactions ?? state.allowedReactions ?? null;
  const reply = state.replying ? `<div class="replying"><span>Replying to ${escapeHtml(state.replying.sender || "message")}</span><button id="cancel-reply" type="button">×</button></div>` : "";
  const older = payload.hasMore ? `<button id="load-older" class="load-older focusable">Load older messages</button>` : "";
  const identityWarning = state.selected.identityChanged ? `<div class="identity-warning">⚠ Safety number changed. Verify this contact in Chat options.</div>` : "";
  screen(state.selected.name, `${identityWarning}<div class="messages">${older}${payload.messages.length ? timelineHtml(payload.messages, state.readThrough) : `<p class="empty">No messages</p>`}</div>${reply}${typingIndicatorHtml(payload.typing)}<form class="compose"><input id="message" class="focusable" maxlength="4000" autocomplete="off" placeholder="Message" value="${escapeHtml(localStorage.getItem(draftKey()) || "")}"><button class="focusable" aria-label="Send">➤</button></form>`, "room-screen");
  setSoftkeys("Options", "Type", "Back");
  document.querySelector(".compose").addEventListener("submit", sendMessage); document.querySelector("#message").addEventListener("input", event => { saveDraft(event.currentTarget.value); handleTyping(); });
  document.querySelector("#load-older")?.addEventListener("click", loadOlder);
  document.querySelector("#cancel-reply")?.addEventListener("click", () => { state.replying = null; renderRoom(payload); });
  document.querySelectorAll("[data-message-time]").forEach(button => button.addEventListener("click", () => messageActions(Number(button.dataset.messageTime))));
  document.querySelectorAll("img.media").forEach(image => image.addEventListener("click", event => { event.stopPropagation(); openImageViewer(image.src, image.alt, Number(image.closest("[data-message-time]")?.dataset.messageTime)); }));
  document.querySelectorAll(".video-thumb").forEach(wrapper => wrapper.addEventListener("click", event => { event.stopPropagation(); openVideoViewer(wrapper.dataset.videoSrc, Number(wrapper.closest("[data-message-time]")?.dataset.messageTime)); }));
  document.querySelectorAll(".voice-note").forEach(audio => { audio.addEventListener("click", event => event.stopPropagation()); audio.addEventListener("play", () => updateVoiceNote(audio)); audio.addEventListener("pause", () => updateVoiceNote(audio)); audio.addEventListener("ended", () => updateVoiceNote(audio)); });
  document.querySelectorAll(".spoiler").forEach(element => element.addEventListener("click", event => { event.stopPropagation(); element.classList.toggle("revealed"); }));
  document.querySelectorAll("[data-view-once]").forEach(button => button.addEventListener("click", event => { event.stopPropagation(); openViewOnce(button); }));
  document.querySelectorAll("[data-poll-time]").forEach(button => button.addEventListener("click", event => { event.stopPropagation(); votePoll(Number(button.dataset.pollTime), Number(button.dataset.option)); }));
  document.querySelectorAll("img.media, video.media").forEach(media => media.addEventListener("load", keepFollowingBottom));
  document.querySelectorAll("video.media").forEach(media => media.addEventListener("loadedmetadata", keepFollowingBottom));
  requestAnimationFrame(() => {
    const returnTarget = state.returnFocusTimestamp ? document.querySelector(`[data-message-time="${state.returnFocusTimestamp}"]`) : null;
    const viewportTarget = state.viewportAnchor ? document.querySelector(`[data-message-time="${state.viewportAnchor.timestamp}"]`) : null;
    if (state.viewportAnchor && viewportTarget) { const currentTop = viewportTarget.getBoundingClientRect().top - app.getBoundingClientRect().top; app.scrollTop += currentTop - state.viewportAnchor.top; state.roomScroll = null; }
    else if (state.jumpTimestamp) { document.querySelector(`[data-message-time="${state.jumpTimestamp}"]`)?.scrollIntoView({ block: "center" }); state.jumpTimestamp = null; }
    else if (state.roomScroll !== null && state.roomScroll !== undefined) { app.scrollTop = state.roomScroll; state.roomScroll = null; }
    else if (document.querySelector("#unread-marker") && !state.followBottom) document.querySelector("#unread-marker").scrollIntoView({ block: "start" });
    else if (state.followBottom !== false) app.scrollTop = app.scrollHeight;
    if (returnTarget) { returnTarget.focus({ preventScroll: true }); state.returnFocusTimestamp = null; }
    else if (state.viewportAnchor && viewportTarget) viewportTarget.focus({ preventScroll: true });
    else { const input = document.querySelector("#message"); input.focus({ preventScroll: true }); const position = state.composeSelection ?? input.value.length; input.setSelectionRange?.(position, position); state.composeSelection = null; }
    state.viewportAnchor = null;
  });
}
function keepFollowingBottom() { if (state.view === "room" && state.followBottom) requestAnimationFrame(() => { app.scrollTop = app.scrollHeight; }); }
async function votePoll(timestamp, option) {
  const poll = state.messages.find(message => message.timestamp === timestamp); if (!poll?.poll || poll.poll.closed) return;
  if (poll.poll.multiple) return multipleVoteScreen(poll, option);
  try { await submitPollVote(poll, [option]); } catch (error) { alert(error.message); }
}
function multipleVoteScreen(message, initial) {
  state.view = "poll-vote"; state.pollChoices = new Set([initial]); screen("Vote", `<div class="menu-list"><p>${escapeHtml(message.poll.question)}</p>${message.poll.options.map(option => `<button class="action menu-action poll-select focusable" data-option="${option.index}"><span class="menu-icon">${option.index === initial ? "●" : "○"}</span><span>${escapeHtml(option.text)}</span></button>`).join("")}<button id="submit-vote" class="action primary focusable">Submit vote</button><p id="action-error" class="error"></p></div>`); setSoftkeys("", "Select", "Back");
  document.querySelectorAll(".poll-select").forEach(button => button.addEventListener("click", () => { const option = Number(button.dataset.option); if (state.pollChoices.has(option)) state.pollChoices.delete(option); else state.pollChoices.add(option); button.querySelector(".menu-icon").textContent = state.pollChoices.has(option) ? "●" : "○"; })); document.querySelector("#submit-vote").addEventListener("click", () => submitPollVote(message, [...state.pollChoices]).catch(actionError)); focusFirst();
}
async function submitPollVote(poll, options) { await request("/api/poll/vote", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp: poll.timestamp, options }) }); await openConversation(state.selected.id); }
async function openViewOnce(button) {
  try { const payload = await request("/api/view-once/open", { method: "POST", body: JSON.stringify({ messageId: button.dataset.viewOnce }) }); const image = document.createElement("img"); image.className = "media"; image.src = payload.url; image.alt = "View-once media"; button.replaceWith(image); }
  catch (error) { alert(error.message); }
}
async function loadOlder() {
  const before = state.messages[0]?.timestamp; if (!before) return;
  const payload = await request(`/api/messages/${encodeURIComponent(state.selected.id)}?before=${before}`);
  state.jumpTimestamp = before; renderRoom({ ...payload, messages: [...payload.messages, ...state.messages] });
}
async function refreshRoom() {
  const payload = await request(`/api/messages/${encodeURIComponent(state.selected.id)}`);
  if (JSON.stringify(payload.messages) !== JSON.stringify(state.messages.slice(-payload.messages.length)) || JSON.stringify(payload.typing) !== JSON.stringify(state.typing)) {
    const input = document.querySelector("#message"); const composing = document.activeElement === input; const focusedMessage = document.activeElement?.closest?.("[data-message-time]");
    const distanceFromBottom = app.scrollHeight - app.scrollTop - app.clientHeight;
    if (distanceFromBottom > 16) {
      state.roomScroll = app.scrollTop;
      const appTop = app.getBoundingClientRect().top; const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom || appTop;
      const anchor = [...document.querySelectorAll("[data-message-time]")].find(element => element.getBoundingClientRect().bottom > headerBottom + 1);
      if (anchor) state.viewportAnchor = { timestamp: Number(anchor.dataset.messageTime), top: anchor.getBoundingClientRect().top - appTop };
    }
    if (focusedMessage) state.returnFocusTimestamp = Number(focusedMessage.dataset.messageTime);
    if (composing) state.composeSelection = input.selectionStart ?? input.value.length;
    const merged = new Map(state.messages.map(message => [message.id, message])); for (const message of payload.messages) merged.set(message.id, message);
    renderRoom({ ...payload, hasMore: state.hasMore || payload.hasMore, messages: [...merged.values()].sort((a, b) => a.timestamp - b.timestamp) });
  }
}
function handleTyping() { if (!typingActive) { typingActive = true; sendTypingState(false); } clearTimeout(typingTimer); typingTimer = setTimeout(() => sendTypingState(true), 2500); }
function sendTypingState(stop) { if (stop) typingActive = false; return request("/api/typing", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, stop }) }).catch(() => {}); }
async function sendMessage(event) {
  event.preventDefault(); const input = document.querySelector("#message"); const message = input.value.trim(); if (!message) return;
  clearTimeout(typingTimer); sendTypingState(true); input.disabled = true;
  try { await request("/api/send", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, message, quoteTimestamp: state.replying?.timestamp }) }); state.replying = null; saveDraft(""); state.roomScroll = null; await openConversation(state.selected.id); }
  catch (error) { input.disabled = false; input.focus(); alert(error.message); }
}

function messageActions(timestamp) {
  stopRefresh(); state.roomScroll = app.scrollTop; const message = state.messages.find(item => item.timestamp === timestamp); if (!message) return;
  state.returnFocusTimestamp = timestamp;
  state.actionMessage = message;
  state.view = "message-actions";
  const edit = message.direction === "out" ? `<button id="edit-message" class="action menu-action focusable"><span class="menu-icon">✎</span><span>Edit</span></button><button id="delete-message" class="action menu-action danger focusable"><span class="menu-icon">⌫</span><span>Delete for everyone</span></button>` : "";
  const receiptRows = Object.values(message.receipts || {}).sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).map(item => { const label = item.status === "viewed" ? "Viewed" : item.status === "read" ? "Read" : "Delivered"; return `<li><strong>${escapeHtml(item.name)}</strong><span>${label} at ${escapeHtml(receiptTime(item.at))}</span></li>`; }).join("");
  const reactionRows = (message.reactions || []).slice().sort((a, b) => String(a.author || a.authorId || "").localeCompare(String(b.author || b.authorId || ""))).map(item => `<li><strong>${escapeHtml(item.author || item.authorId || "Unknown")}</strong><span class="reaction-detail">Reacted ${escapeHtml(item.emoji)}</span></li>`).join("");
  const messageDetails = receiptRows || reactionRows ? `<section class="receipt-details scroll-focus focusable" tabindex="0" aria-label="Message details"><strong class="details-title">Message details</strong>${reactionRows ? `<p class="detail-label">Reactions</p><ul class="receipt-list">${reactionRows}</ul>` : ""}${receiptRows ? `<p class="detail-label">Delivery</p><ul class="receipt-list">${receiptRows}</ul>` : ""}</section>` : "";
  const permitted = emoji => !Array.isArray(state.allowedReactions) || state.allowedReactions.includes(emoji);
  const quick = QUICK_REACTIONS.filter(permitted); const favourites = favouriteReactions().filter(permitted);
  screen("Message options", `<div class="menu-list"><div class="message-info"><strong>${escapeHtml(message.direction === "out" ? "You" : message.sender)}</strong><time>${escapeHtml(new Date(message.timestamp).toLocaleString())}</time></div><button id="reply-message" class="action menu-action focusable"><span class="menu-icon">↩</span><span>Reply</span></button><button id="pin-message" class="action menu-action focusable"><span class="menu-icon">⌖</span><span>${message.pinned ? "Unpin" : "Pin"} message</span></button>${message.poll && message.direction === "out" && !message.poll.closed ? `<button id="close-poll" class="action menu-action focusable"><span class="menu-icon">■</span><span>Close poll</span></button>` : ""}${quick.length ? `<p class="section-label">Quick reaction</p><div class="emoji-row">${quick.map(emoji => `<button class="emoji focusable" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>` : ""}${favourites.length ? `<p class="section-label">Your frequent reactions</p><div class="emoji-row">${favourites.map(emoji => `<button class="emoji focusable" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>` : ""}<button id="more-reactions" class="action menu-action focusable"><span class="menu-icon">☺</span><span>More reactions…</span><span class="chevron">›</span></button>${edit}${messageDetails}<p id="action-error" class="error"></p></div>`);
  setSoftkeys("", "Select", "Back");
  document.querySelector("#reply-message").addEventListener("click", () => { state.returnFocusTimestamp = null; state.replying = message; openConversation(state.selected.id); });
  bindReactionButtons(message);
  document.querySelector("#more-reactions").addEventListener("click", () => reactionPicker(message));
  document.querySelector("#pin-message").addEventListener("click", async () => { try { await request("/api/message/pin", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp, pinned: !message.pinned }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } });
  document.querySelector("#close-poll")?.addEventListener("click", async () => { try { await request("/api/poll/close", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } });
  document.querySelector("#edit-message")?.addEventListener("click", () => editMessage(message));
  document.querySelector("#delete-message")?.addEventListener("click", async () => { try { await request("/api/message/delete", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } });
  focusFirst();
}
function reactionUsage() { try { return JSON.parse(localStorage.getItem("reaction-usage") || "{}"); } catch { return {}; } }
function favouriteReactions() { const usage = reactionUsage(); return Object.keys(usage).filter(emoji => !QUICK_REACTIONS.includes(emoji)).sort((a, b) => usage[b] - usage[a]).slice(0, 6); }
function rememberReaction(emoji) { const usage = reactionUsage(); usage[emoji] = (usage[emoji] || 0) + 1; localStorage.setItem("reaction-usage", JSON.stringify(usage)); }
async function reactToMessage(message, emoji) {
  const remove = (message.reactions || []).some(reaction => reaction.emoji === emoji && (reaction.own || reaction.author === "You"));
  await request("/api/message/reaction", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp: message.timestamp, emoji, remove }) });
  if (!remove) rememberReaction(emoji);
  await openConversation(state.selected.id);
}
function bindReactionButtons(message) { document.querySelectorAll("[data-emoji]").forEach(button => button.addEventListener("click", () => reactToMessage(message, button.dataset.emoji).catch(actionError))); }
function reactionPicker(message) {
  state.view = "reaction-picker";
  const permitted = emoji => !Array.isArray(state.allowedReactions) || state.allowedReactions.includes(emoji);
  const groups = Object.entries(EMOJI_GROUPS).map(([name, emojis]) => [name, emojis.split(" ").filter(permitted)]).filter(([, emojis]) => emojis.length).map(([name, emojis]) => `<h3>${name}</h3><div class="emoji-grid">${emojis.map(emoji => `<button class="emoji focusable" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>`).join("");
  screen("Choose reaction", `<div class="emoji-picker">${groups}<p id="action-error" class="error"></p></div>`);
  setSoftkeys("", "Select", "Back"); bindReactionButtons(message); focusFirst();
}
function editMessage(message) {
  state.view = "edit"; screen("Edit message", `<div class="center"><form id="edit-form"><textarea id="edit-text" class="field focusable" maxlength="4000" rows="5">${escapeHtml(message.text)}</textarea><button class="action focusable">Save edit</button></form><p id="action-error" class="error"></p></div>`); setSoftkeys("", "Select", "Back");
  document.querySelector("#edit-form").addEventListener("submit", async event => { event.preventDefault(); try { await request("/api/message/edit", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, timestamp: message.timestamp, message: document.querySelector("#edit-text").value }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } }); focusFirst();
}

function mainMenu() {
  stopRefresh(); state.view = "main-menu"; const focused = document.activeElement?.dataset.id; state.menuConversation = state.conversations.find(item => item.id === focused);
  screen("Menu", `<div class="menu-list"><p class="menu-heading">Start something</p><button id="menu-compose" class="action menu-action focusable"><span class="menu-icon">✎</span><span>Compose</span><span class="chevron">›</span></button><button id="menu-group" class="action menu-action focusable"><span class="menu-icon">♟</span><span>New group</span><span class="chevron">›</span></button><button id="menu-search" class="action menu-action focusable"><span class="menu-icon">⌕</span><span>Search messages</span><span class="chevron">›</span></button><p class="menu-heading">Conversations</p><button id="menu-archived" class="action menu-action focusable"><span class="menu-icon">▣</span><span>Archived chats</span><span class="menu-value">${state.archivedCount || 0}</span></button>${state.menuConversation ? `<button id="menu-favorite" class="action menu-action focusable"><span class="menu-icon">★</span><span>${state.menuConversation.favorite ? "Remove favourite" : "Favourite"} ${escapeHtml(state.menuConversation.name)}</span></button><button id="menu-archive" class="action menu-action focusable"><span class="menu-icon">${state.menuConversation.archived ? "↥" : "↧"}</span><span>${state.menuConversation.archived ? "Unarchive" : "Archive"} ${escapeHtml(state.menuConversation.name)}</span></button>` : ""}<p class="menu-heading">Application</p><button id="menu-settings" class="action menu-action focusable"><span class="menu-icon">⚙</span><span>Settings</span><span class="chevron">›</span></button><button id="menu-logout" class="action menu-action danger focusable"><span class="menu-icon">⇥</span><span>Log out</span></button><p id="action-error" class="error"></p></div>`);
  setSoftkeys("", "Select", "Back");
  document.querySelector("#menu-compose").addEventListener("click", composeScreen); document.querySelector("#menu-group").addEventListener("click", newGroupScreen); document.querySelector("#menu-search").addEventListener("click", searchScreen); document.querySelector("#menu-archived").addEventListener("click", () => conversations(null, true)); document.querySelector("#menu-settings").addEventListener("click", settingsScreen);
  document.querySelector("#menu-archive")?.addEventListener("click", async () => { try { await request("/api/conversation/archive", { method: "POST", body: JSON.stringify({ conversationId: state.menuConversation.id, archived: !state.menuConversation.archived }) }); await conversations(null, state.showingArchived); } catch (error) { actionError(error); } });
  document.querySelector("#menu-favorite")?.addEventListener("click", async () => { try { await request("/api/conversation/favorite", { method: "POST", body: JSON.stringify({ conversationId: state.menuConversation.id, favorite: !state.menuConversation.favorite }) }); await conversations(null, state.showingArchived); } catch (error) { actionError(error); } });
  document.querySelector("#menu-logout").addEventListener("click", async () => { await request("/api/logout", { method: "POST", body: "{}" }); login(); }); focusFirst();
}
function searchScreen() {
  stopRefresh(); state.view = "search";
  screen("Search messages", `<form id="search-form" class="search-form"><input id="search-query" class="field focusable" minlength="2" placeholder="Search cached messages"><button class="action primary focusable">Search</button></form><div id="search-results"></div>`); setSoftkeys("", "Select", "Back");
  document.querySelector("#search-form").addEventListener("submit", async event => { event.preventDefault(); const query = document.querySelector("#search-query").value.trim(); if (query.length < 2) return; const payload = await request(`/api/search?q=${encodeURIComponent(query)}`); const target = document.querySelector("#search-results"); target.innerHTML = payload.results.length ? payload.results.map(result => `<button class="search-result row focusable" data-conversation="${escapeHtml(result.conversationId)}" data-timestamp="${result.timestamp}"><strong>${escapeHtml(result.sender)}</strong><span class="preview">${escapeHtml(result.text)}</span><time>${escapeHtml(new Date(result.timestamp).toLocaleDateString())}</time></button>`).join("") : `<p class="empty">No matches</p>`; target.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => { state.jumpTimestamp = Number(button.dataset.timestamp); openConversation(button.dataset.conversation); })); target.querySelector(".focusable")?.focus(); }); focusFirst();
}
function composeScreen() {
  stopRefresh(); state.view = "compose"; const contacts = state.conversations.filter(item => item.kind === "direct");
  screen("Compose", `<div class="contact-filter"><input id="contact-filter" class="field focusable" placeholder="Find contact"></div><div class="menu-list">${contacts.map(item => `<button class="row focusable" data-compose-id="${escapeHtml(item.id)}" data-contact-name="${escapeHtml(item.name.toLocaleLowerCase())}">${avatarMarkup(item)}<span class="row-body"><strong>${escapeHtml(item.name)}</strong></span></button>`).join("") || `<p class="empty">No contacts</p>`}</div>`); setSoftkeys("", "Open", "Back");
  document.querySelectorAll("[data-compose-id]").forEach(button => button.addEventListener("click", () => openConversation(button.dataset.composeId))); document.querySelectorAll(".avatar img").forEach(image => image.addEventListener("error", () => image.remove())); focusFirst();
  document.querySelector("#contact-filter")?.addEventListener("input", event => { const query = event.currentTarget.value.toLocaleLowerCase(); document.querySelectorAll("[data-contact-name]").forEach(row => row.hidden = !row.dataset.contactName.includes(query)); });
}
function newGroupScreen() {
  stopRefresh(); state.view = "new-group"; state.groupMembers = new Set(); const contacts = state.conversations.filter(item => item.kind === "direct");
  screen("New group", `<form id="group-form"><input id="group-name" class="field focusable" maxlength="100" placeholder="Group name" required><div class="choice-list">${contacts.map(item => `<button type="button" class="row focusable member-choice" data-target="${escapeHtml(item.target)}"><span class="check">○</span> ${escapeHtml(item.name)}</button>`).join("")}</div><button class="action focusable">Create group</button><p id="action-error" class="error"></p></form>`); setSoftkeys("", "Select", "Back");
  document.querySelectorAll(".member-choice").forEach(button => button.addEventListener("click", () => { const chosen = state.groupMembers.has(button.dataset.target); if (chosen) state.groupMembers.delete(button.dataset.target); else state.groupMembers.add(button.dataset.target); button.querySelector(".check").textContent = chosen ? "○" : "●"; }));
  document.querySelector("#group-form").addEventListener("submit", async event => { event.preventDefault(); try { await request("/api/group/create", { method: "POST", body: JSON.stringify({ name: document.querySelector("#group-name").value, members: [...state.groupMembers] }) }); await conversations(); } catch (error) { actionError(error); } }); focusFirst();
}
function pollComposer() {
  state.view = "poll-composer"; screen("Create poll", `<form id="poll-form" class="menu-list"><input id="poll-question" class="field focusable" maxlength="200" placeholder="Question" required>${Array.from({ length: 10 }, (_, offset) => offset + 1).map(index => `<input class="field focusable poll-choice" maxlength="100" placeholder="Option ${index}" ${index < 3 ? "required" : ""}>`).join("")}<button type="button" id="poll-multiple" class="action menu-action focusable"><span class="menu-icon">○</span><span>Multiple choices</span><span class="menu-value">Off</span></button><button class="action primary focusable">Create poll</button><p id="action-error" class="error"></p></form>`); setSoftkeys("", "Select", "Back"); let multiple = false;
  document.querySelector("#poll-multiple").addEventListener("click", event => { multiple = !multiple; event.currentTarget.querySelector(".menu-value").textContent = multiple ? "On" : "Off"; });
  document.querySelector("#poll-form").addEventListener("submit", async event => { event.preventDefault(); try { await request("/api/poll/create", { method: "POST", body: JSON.stringify({ kind: state.selected.kind, target: state.selected.target, question: document.querySelector("#poll-question").value, options: [...document.querySelectorAll(".poll-choice")].map(input => input.value), multiple }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } }); focusFirst();
}
async function pinnedMessages() {
  try { const payload = await request(`/api/pins/${encodeURIComponent(state.selected.id)}`); state.pins = payload.pins; state.pinIndex = 0; renderPinned(); } catch (error) { actionError(error); }
}
async function safetyNumberScreen() {
  state.view = "safety-number"; screen("Safety number", `<div class="center"><p>Loading identity…</p></div>`); setSoftkeys("", "", "Back");
  try { const payload = await request(`/api/identity/${encodeURIComponent(state.selected.target)}`); const identity = payload.identities[0] || {}; const safety = identity.safetyNumber || identity.fingerprint || identity.identityKey || "Unavailable"; screen("Safety number", `<div class="identity-card"><p class="hint">Compare this number with ${escapeHtml(state.selected.name)} using another trusted channel.</p><code>${escapeHtml(String(safety).replace(/(.{5})/g, "$1 "))}</code><form id="verify-form"><input id="verify-number" class="field focusable" inputmode="numeric" maxlength="71" placeholder="Enter verified 60-digit number"><button class="action primary focusable">Mark verified</button></form><p id="action-error" class="error"></p></div>`); document.querySelector("#verify-form").addEventListener("submit", async event => { event.preventDefault(); try { await request("/api/identity/trust", { method: "POST", body: JSON.stringify({ recipient: state.selected.target, safetyNumber: document.querySelector("#verify-number").value }) }); await openConversation(state.selected.id); } catch (error) { actionError(error); } }); focusFirst(); } catch (error) { actionError(error); }
}
function groupSettingsScreen() {
  state.view = "group-settings"; const group = state.selected; const contacts = state.conversations.filter(item => item.kind === "direct" && !group.members?.some(member => member.id === item.target));
  screen("Group settings", `<div class="menu-list"><form id="group-details"><p class="menu-heading">Details</p><input id="group-title" class="field focusable" maxlength="100" value="${escapeHtml(group.name)}" placeholder="Group name"><textarea id="group-description" class="field focusable" maxlength="500" rows="3" placeholder="Description">${escapeHtml(group.description || "")}</textarea><button class="action primary focusable">Save details</button></form><p class="menu-heading">Members</p><div class="member-list">${(group.members || []).map(member => { const admin = group.admins?.includes(member.id); return `<div class="member-card"><span>${escapeHtml(member.name)}</span>${admin ? `<small>Admin</small>` : ""}<button class="focusable" data-toggle-admin="${escapeHtml(member.id)}" data-admin="${admin}">${admin ? "Demote" : "Admin"}</button><button class="focusable" data-remove-member="${escapeHtml(member.id)}">Remove</button></div>`; }).join("")}</div>${contacts.length ? `<label class="setting-label setting-card">Add member<select id="add-member" class="field focusable"><option value="">Choose contact</option>${contacts.map(item => `<option value="${escapeHtml(item.target)}">${escapeHtml(item.name)}</option>`).join("")}</select><button id="add-member-button" class="action focusable" type="button">Add member</button></label>` : ""}<p class="menu-heading">Permissions</p><label class="setting-label setting-card">Edit group details<select id="permission-details" class="field focusable"><option value="every-member">Everyone</option><option value="only-admins">Admins only</option></select></label><label class="setting-label setting-card">Send messages<select id="permission-send" class="field focusable"><option value="every-member">Everyone</option><option value="only-admins">Admins only</option></select></label><button id="save-permissions" class="action focusable">Save permissions</button><p class="menu-heading">Invite link</p><div class="invite-link">${escapeHtml(group.inviteLink || "Disabled")}</div><button id="enable-link" class="action menu-action focusable"><span class="menu-icon">↗</span><span>${group.inviteLink ? "Disable" : "Enable"} invite link</span></button><button id="leave-group" class="action danger focusable">Leave group</button><p id="action-error" class="error"></p></div>`); setSoftkeys("", "Select", "Back");
  document.querySelector("#group-details").addEventListener("submit", event => { event.preventDefault(); updateGroup({ name: document.querySelector("#group-title").value, description: document.querySelector("#group-description").value }); });
  document.querySelector("#add-member-button")?.addEventListener("click", () => { const member = document.querySelector("#add-member").value; if (member) updateGroup({ member: [member] }); });
  document.querySelectorAll("[data-remove-member]").forEach(button => button.addEventListener("click", () => updateGroup({ removeMember: [button.dataset.removeMember] })));
  document.querySelectorAll("[data-toggle-admin]").forEach(button => button.addEventListener("click", () => updateGroup(button.dataset.admin === "true" ? { removeAdmin: [button.dataset.toggleAdmin] } : { admin: [button.dataset.toggleAdmin] })));
  document.querySelector("#save-permissions").addEventListener("click", () => updateGroup({ setPermissionEditDetails: document.querySelector("#permission-details").value, setPermissionSendMessages: document.querySelector("#permission-send").value }));
  document.querySelector("#enable-link").addEventListener("click", () => updateGroup({ link: group.inviteLink ? "disabled" : "enabled" }));
  document.querySelector("#leave-group").addEventListener("click", async () => { try { await request("/api/group/leave", { method: "POST", body: JSON.stringify({ groupId: group.target }) }); await conversations(); } catch (error) { actionError(error); } }); focusFirst();
}
async function updateGroup(changes) { try { await request("/api/group/update", { method: "POST", body: JSON.stringify({ groupId: state.selected.target, ...changes }) }); await conversations(state.selected.id); } catch (error) { actionError(error); } }
function renderPinned() {
  state.view = "pinned-view"; const pin = state.pins[state.pinIndex];
  if (!pin) { screen("Pinned messages", `<p class="empty">No pinned messages</p>`); setSoftkeys("", "", "Back"); return; }
  screen(`Pinned ${state.pinIndex + 1} of ${state.pins.length}`, `<div class="pinned-card"><strong>${escapeHtml(pin.direction === "out" ? "You" : pin.sender)}</strong>${mediaHtml(pin)}<p>${escapeHtml(pin.text || mediaLabel(pin) || "Message")}</p><time>${escapeHtml(new Date(pin.timestamp).toLocaleString())}</time><button id="jump-pin" class="action primary focusable">Jump to message</button></div>`); setSoftkeys("", "Open", "Back");
  document.querySelector("#jump-pin").addEventListener("click", () => { state.jumpTimestamp = pin.timestamp; openConversation(state.selected.id); }); focusFirst();
}
async function voiceRecorderScreen() {
  const cloudPhone = typeof navigator.hasFeature === "function";
  const capture = cloudPhone
    ? `<label class="native-record action primary">Record with phone<input id="native-audio" class="focusable" type="file" accept="audio/*" capture="microphone"></label>`
    : `<button id="record-toggle" class="action primary focusable">Start recording</button>`;
  state.view = "voice-recorder"; screen("Voice note", `<div class="recorder"><div id="record-dot" class="record-dot">●</div><strong id="record-status">Ready to record</strong><time id="record-time">0:00</time>${capture}<div id="record-preview"></div><p id="action-error" class="error"></p></div>`); setSoftkeys("", "Select", "Back");
  document.querySelector("#record-toggle")?.addEventListener("click", toggleRecording);
  document.querySelector("#native-audio")?.addEventListener("change", event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return actionError(new Error("Voice note is too large"));
    showRecordingReady(file);
  });
  focusFirst();
}
async function toggleRecording() {
  if (activeRecording?.recorder?.state === "recording") return activeRecording.recorder.stop();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("Audio recording is not supported by this device");
    document.querySelector("#record-status").textContent = "Checking microphone…";
    if (navigator.hasFeature && !(await navigator.hasFeature("AudioCapture"))) throw new Error("This phone or CloudPhone version does not support microphone capture");
    document.querySelector("#record-status").textContent = "Opening microphone…";
    let timedOut = false;
    const capture = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (timedOut) { stream.getTracks().forEach(track => track.stop()); throw new Error("Microphone opened after the request expired"); }
      return stream;
    });
    const timeout = new Promise((resolve, reject) => setTimeout(() => { timedOut = true; reject(new Error("Microphone did not respond. CloudPhone 3.0 or newer with AudioCapture is required")); }, 12_000));
    const stream = await Promise.race([capture, timeout]);
    const monitor = document.createElement("audio"); monitor.muted = true; monitor.srcObject = stream; monitor.play().catch(() => {});
    const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => globalThis.MediaRecorder?.isTypeSupported?.(type));
    const cloudPhone = typeof navigator.hasFeature === "function";
    const recorder = new MediaRecorder(stream, !cloudPhone && preferred ? { mimeType: preferred } : undefined); const chunks = []; const started = Date.now();
    activeRecording = { recorder, stream, monitor, chunks, timer: setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); const target = document.querySelector("#record-time"); if (target) target.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`; }, 250) };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => finishRecording(recorder.mimeType || preferred || (cloudPhone ? "audio/ogg;codecs=opus" : "audio/webm")); recorder.start();
    document.querySelector("#record-status").textContent = "Recording…"; document.querySelector("#record-dot").classList.add("active"); document.querySelector("#record-toggle").textContent = "Stop recording";
  } catch (error) { actionError(error); }
}
function finishRecording(type) {
  const recording = activeRecording; if (!recording) return; clearInterval(recording.timer); recording.stream.getTracks().forEach(track => track.stop()); recording.monitor?.pause(); if (recording.monitor) recording.monitor.srcObject = null;
  const blob = new Blob(recording.chunks, { type }); activeRecording = { blob };
  showRecordingReady(blob);
}
function showRecordingReady(blob) {
  activeRecording = { blob };
  document.querySelector("#record-status").textContent = "Recording ready"; document.querySelector("#record-dot").classList.remove("active");
  document.querySelector("#record-preview").innerHTML = `<audio class="voice-note" controls></audio><button id="send-recording" class="action primary focusable">Send voice note</button><button id="discard-recording" class="action focusable">Discard</button>`;
  document.querySelector("#record-preview audio").src = URL.createObjectURL(blob); document.querySelector("#record-toggle")?.remove(); document.querySelector(".native-record")?.remove();
  document.querySelector("#send-recording").addEventListener("click", sendVoiceNote); document.querySelector("#discard-recording").addEventListener("click", voiceRecorderScreen); document.querySelector("#send-recording").focus();
}
async function sendVoiceNote() {
  const button = document.querySelector("#send-recording"); button.disabled = true;
  const name = String(activeRecording.blob.name || "").toLowerCase();
  const fallbackType = name.endsWith(".3gp") ? "audio/3gpp" : name.endsWith(".amr") ? "audio/amr" : name.endsWith(".m4a") ? "audio/mp4" : name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".ogg") ? "audio/ogg" : "audio/webm";
  try { const response = await fetch(`/api/voice?kind=${encodeURIComponent(state.selected.kind)}&target=${encodeURIComponent(state.selected.target)}`, { method: "POST", headers: { "content-type": activeRecording.blob.type || fallbackType }, body: activeRecording.blob }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Voice note failed"); activeRecording = null; state.roomScroll = null; await openConversation(state.selected.id); }
  catch (error) { button.disabled = false; actionError(error); }
}

function settingsScreen() {
  stopRefresh(); state.view = "settings";
  screen("Settings", `<form id="settings-form" class="menu-list"><p class="menu-heading">Messaging</p><button type="button" id="read-toggle" class="action menu-action focusable"><span class="menu-icon">✓</span><span>Send read status</span><span class="menu-value">${state.settings.sendReadReceipts ? "On" : "Off"}</span></button><button type="button" id="typing-toggle" class="action menu-action focusable"><span class="menu-icon">•••</span><span>Typing indicators</span><span class="menu-value">${state.settings.sendTypingIndicators ? "On" : "Off"}</span></button><button type="button" id="preview-toggle" class="action menu-action focusable"><span class="menu-icon">↗</span><span>Link previews</span><span class="menu-value">${state.settings.linkPreviews ? "On" : "Off"}</span></button><button class="action primary focusable">Save settings</button><p class="menu-heading">Telegram account</p><button type="button" id="telegram-disconnect" class="action menu-action danger focusable"><span class="menu-icon">⇥</span><span>Disconnect Telegram</span></button><p id="action-error" class="error"></p></form>`); setSoftkeys("", "Select", "Back");
  for (const [id, key] of [["read-toggle", "sendReadReceipts"], ["typing-toggle", "sendTypingIndicators"], ["preview-toggle", "linkPreviews"]]) document.querySelector(`#${id}`).addEventListener("click", event => { state.settings[key] = !state.settings[key]; event.currentTarget.querySelector(".menu-value").textContent = state.settings[key] ? "On" : "Off"; });
  document.querySelector("#settings-form").addEventListener("submit", async event => { event.preventDefault(); try { const payload = await request("/api/settings", { method: "POST", body: JSON.stringify(state.settings) }); state.settings = payload.settings; await conversations(); } catch (error) { actionError(error); } });
  document.querySelector("#telegram-disconnect").addEventListener("click", async () => { try { await request("/api/telegram/logout", { method: "POST", body: "{}" }); await boot(); } catch (error) { actionError(error); } }); focusFirst();
}

function chatOptions() {
  stopRefresh(); state.roomScroll = app.scrollTop; state.view = "chat-options"; const archived = Boolean(state.selected.archived);
  screen("Chat options", `<div class="menu-list"><p class="menu-heading">Message</p><button id="record-voice" class="action menu-action focusable"><span class="menu-icon">●</span><span>Record voice note</span><span class="chevron">›</span></button><button id="create-poll" class="action menu-action focusable"><span class="menu-icon">▥</span><span>Create poll</span><span class="chevron">›</span></button><button id="view-pins" class="action menu-action focusable"><span class="menu-icon">⌖</span><span>View pinned messages</span><span class="chevron">›</span></button><p class="menu-heading">Conversation</p><button id="archive-chat" class="action menu-action focusable"><span class="menu-icon">${archived ? "↥" : "↧"}</span><span>${archived ? "Unarchive" : "Archive"} chat</span></button><p id="action-error" class="error"></p></div>`); setSoftkeys("", "Select", "Back");
  document.querySelector("#record-voice").addEventListener("click", voiceRecorderScreen); document.querySelector("#create-poll").addEventListener("click", pollComposer); document.querySelector("#view-pins").addEventListener("click", pinnedMessages);
  document.querySelector("#archive-chat").addEventListener("click", async () => { try { await request("/api/conversation/archive", { method: "POST", body: JSON.stringify({ conversationId: state.selected.id, archived: !archived }) }); state.selected.archived = !archived; await conversations(null, state.showingArchived); } catch (error) { actionError(error); } }); focusFirst();
}

function messageViewport() {
  const appRect = app.getBoundingClientRect();
  return {
    top: document.querySelector("header")?.getBoundingClientRect().bottom || appRect.top,
    bottom: document.querySelector(".compose")?.getBoundingClientRect().top || appRect.bottom,
  };
}
function frameFocusedItem(target, direction) {
  const message = state.view === "room" ? target.closest?.("[data-message-time]") : null;
  if (!message) return target.scrollIntoView({ block: "nearest" });
  const viewport = messageViewport(); const rect = message.getBoundingClientRect(); const available = viewport.bottom - viewport.top;
  if (rect.height <= available) {
    if (rect.top < viewport.top) app.scrollBy({ top: rect.top - viewport.top });
    else if (rect.bottom > viewport.bottom) app.scrollBy({ top: rect.bottom - viewport.bottom });
  } else if (direction > 0) app.scrollBy({ top: rect.top - viewport.top });
  else app.scrollBy({ top: rect.bottom - viewport.bottom });
}
function moveFocus(direction) {
  const items = [...document.querySelectorAll(".focusable:not(:disabled)")]; if (!items.length) return;
  const index = items.indexOf(document.activeElement); const target = items[(Math.max(0, index) + direction + items.length) % items.length];
  target.focus({ preventScroll: true }); frameFocusedItem(target, direction);
}
function updateVoiceNote(audio) {
  const label = audio.closest("[data-message-time]")?.querySelector(".voice-label");
  if (label) label.textContent = audio.paused ? "▶ Voice note" : "❚❚ Playing voice note";
  if (document.activeElement?.closest?.("[data-message-time]")?.contains(audio)) setSoftkeys("Message", audio.paused ? "Play" : "Pause", "Back");
}
function toggleVoiceNote(audio) {
  document.querySelectorAll(".voice-note").forEach(other => { if (other !== audio && !other.paused) other.pause(); });
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
function scrollFocusedMessage(direction) {
  const focused = document.activeElement;
  const panel = state.view === "room" ? focused?.closest?.("[data-message-time]") : focused?.closest?.(".scroll-focus");
  if (!panel) return false;
  const rect = panel.getBoundingClientRect(); const viewport = messageViewport();
  const page = Math.max(120, viewport.bottom - viewport.top - 8);
  if (direction > 0 && rect.bottom > viewport.bottom + 1) { app.scrollBy({ top: Math.min(page, rect.bottom - viewport.bottom) }); return true; }
  if (direction < 0 && rect.top < viewport.top - 1) { app.scrollBy({ top: -Math.min(page, viewport.top - rect.top) }); return true; }
  return false;
}
function moveEmoji(horizontal, vertical) {
  const current = document.activeElement;
  const grid = current.closest(".emoji-row, .emoji-grid");
  if (!grid || !current.matches(".emoji")) return false;
  const items = [...grid.querySelectorAll(".emoji.focusable:not(:disabled)")];
  const columns = grid.classList.contains("emoji-grid") ? 6 : 3;
  const index = items.indexOf(current);
  const row = Math.floor(index / columns);
  const lastRow = Math.floor((items.length - 1) / columns);
  if (vertical < 0 && row === 0) { focusOutsideEmojiGrid(grid, -1); return true; }
  if (vertical > 0 && row === lastRow) { focusOutsideEmojiGrid(grid, 1); return true; }
  const next = index + horizontal + vertical * columns;
  if (next >= 0 && next < items.length) items[next].focus();
  (items[next] || current).scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
function focusOutsideEmojiGrid(grid, direction) {
  const focusable = [...document.querySelectorAll(".focusable:not(:disabled)")];
  const gridItems = [...grid.querySelectorAll(".emoji.focusable:not(:disabled)")];
  const edge = direction < 0 ? gridItems[0] : gridItems[gridItems.length - 1];
  const target = focusable[focusable.indexOf(edge) + direction];
  if (target) { target.focus(); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
function back() {
  if (state.view === "image-viewer") return openConversation(state.selected.id);
  if (state.view === "video-viewer") return openConversation(state.selected.id);
  if (state.view === "voice-recorder") { if (activeRecording?.recorder?.state === "recording") { activeRecording.recorder.onstop = null; activeRecording.recorder.stop(); activeRecording.stream.getTracks().forEach(track => track.stop()); clearInterval(activeRecording.timer); } activeRecording = null; return openConversation(state.selected.id); }
  if (state.view === "reaction-picker") return messageActions(state.actionMessage.timestamp);
  if (["message-actions", "edit", "chat-options", "poll-composer", "poll-vote", "pinned-view"].includes(state.view)) return openConversation(state.selected.id);
  if (["safety-number", "group-settings"].includes(state.view)) return chatOptions();
  if (state.view === "room") return conversations(state.selected.id, state.showingArchived);
  if (["main-menu", "compose", "new-group", "settings", "search"].includes(state.view)) return conversations();
  if (state.view === "conversations" && state.showingArchived) return conversations(null, false);
  if (state.view === "link") return linkScreen();
}
function exitApp() { if (history.length > 1) history.back(); else window.close(); }
function softLeft() {
  if (state.mindfulPause) return dismissMindfulPause();
  if (state.view === "login") return document.querySelector("#login-form")?.requestSubmit();
  if (state.view === "telegram-login") return document.querySelector("#telegram-auth")?.requestSubmit();
  if (state.view === "conversations") return mainMenu();
  if (state.view === "room") { const message = document.activeElement?.closest?.("[data-message-time]"); return message ? messageActions(Number(message.dataset.messageTime)) : chatOptions(); }
}
function softRight() {
  if (state.mindfulPause) return exitApp();
  if (state.view === "linking") return linkScreen();
  if (["login", "telegram-login"].includes(state.view) || (state.view === "conversations" && !state.showingArchived)) return exitApp();
  return back();
}

window.addEventListener("keydown", event => {
  if (event.repeat && ["ShiftLeft", "ShiftRight"].includes(event.code)) return;
  if (event.key === "Enter" && state.view === "video-viewer") { event.preventDefault(); const video = document.querySelector(".video-viewer video"); return video.paused ? video.play() : video.pause(); }
  if (state.view === "video-viewer" && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const video = document.querySelector(".video-viewer video"); video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + (event.key === "ArrowLeft" ? -10 : 10))); return; }
  if (event.key === "Enter" && document.activeElement?.matches("[data-message-time]")) { event.preventDefault(); const timestamp = Number(document.activeElement.dataset.messageTime); const image = document.activeElement.querySelector("img.media"); if (image) return openImageViewer(image.src, image.alt, timestamp); const video = document.activeElement.querySelector(".video-thumb"); if (video) return openVideoViewer(video.dataset.videoSrc, timestamp); const audio = document.activeElement.querySelector(".voice-note"); if (audio) return toggleVoiceNote(audio); return messageActions(timestamp); }
  if (event.key === "Enter" && document.activeElement?.matches(".spoiler")) { event.preventDefault(); document.activeElement.classList.toggle("revealed"); return; }
  if (state.view === "pinned-view" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowLeft" && state.pinIndex > 0) { state.pinIndex--; renderPinned(); }
    else if (event.key === "ArrowRight" && state.pinIndex < state.pins.length - 1) { state.pinIndex++; renderPinned(); }
    else if (event.key === "ArrowUp") app.scrollBy({ top: -55 });
    else if (event.key === "ArrowDown") app.scrollBy({ top: 55 });
    return;
  }
  if (event.key === "ArrowDown") { event.preventDefault(); if (!moveEmoji(0, 1) && !scrollFocusedMessage(1)) moveFocus(1); if (state.view === "room") requestAnimationFrame(() => { if (app.scrollHeight - app.scrollTop - app.clientHeight < 20) state.followBottom = true; }); }
  if (event.key === "ArrowUp") { event.preventDefault(); if (state.view === "room") state.followBottom = false; if (!moveEmoji(0, -1) && !scrollFocusedMessage(-1)) moveFocus(-1); }
  if (event.key === "ArrowLeft" && moveEmoji(-1, 0)) event.preventDefault();
  if (event.key === "ArrowRight" && moveEmoji(1, 0)) event.preventDefault();
  if (event.code === "ShiftLeft" || event.key === "SoftLeft" || event.key === "Escape") { event.preventDefault(); softLeft(); }
  if (event.code === "ShiftRight" || event.key === "SoftRight") { event.preventDefault(); softRight(); }
  if ((event.key === "Backspace" || event.key === "Call") && state.view === "room" && (!event.target.matches("input") || !event.target.value)) { event.preventDefault(); back(); }
});
window.addEventListener("back", event => { event.preventDefault(); softRight(); });
document.addEventListener("visibilitychange", () => { updateMindfulTime(); if (state.mindful) { state.mindfulVisible = !document.hidden; state.mindful.lastTick = Date.now(); } });
window.addEventListener("pagehide", updateMindfulTime);
app.addEventListener("wheel", () => { if (state.view === "room") state.followBottom = false; }, { passive: true });
app.addEventListener("touchstart", () => { if (state.view === "room") state.followBottom = false; }, { passive: true });
document.addEventListener("focusin", event => {
  if (state.view !== "room") return;
  const message = event.target.closest?.("[data-message-time]");
  const audio = message?.querySelector(".voice-note");
  setSoftkeys(message ? "Message" : "Options", audio ? (audio.paused ? "Play" : "Pause") : message?.querySelector("img.media, .video-thumb") ? "Open" : message ? "Select" : "Type", "Back");
});
boot();
