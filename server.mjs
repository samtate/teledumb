import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { TelegramClient } from "@mtcute/node";

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "/data";
const APP_DIR = join(DATA_DIR, "app");
const TG_DIR = join(DATA_DIR, "telegram");
const MEDIA_DIR = join(DATA_DIR, "media");
const PUBLIC_DIR = new URL("./public/", import.meta.url).pathname;
const messageCache = new Map();
const typing = new Map();
const mediaDownloads = new Map();
let dialogsCache = { at: 0, values: [] };
let reactionCache = { at: 0, values: [] };
let auth = { stage: "phone", phone: "", phoneCodeHash: "", hint: "" };
let me = null;
let appState = { favorites: [], mindfulUsage: {}, settings: { sendReadReceipts: true, sendTypingIndicators: true, linkPreviews: true, defaultExpiration: 0 } };

if (!process.env.WIDGET_TOKEN || Buffer.byteLength(process.env.WIDGET_TOKEN) < 43) throw new Error("WIDGET_TOKEN must be a 256-bit random token");
if (!process.env.PUBLIC_ORIGIN?.startsWith("https://")) throw new Error("PUBLIC_ORIGIN must be the public https:// origin");
if (!/^\d+$/.test(process.env.TELEGRAM_API_ID || "") || !process.env.TELEGRAM_API_HASH) throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (create them at my.telegram.org)");

await mkdir(APP_DIR, { recursive: true });
await mkdir(TG_DIR, { recursive: true });
await mkdir(MEDIA_DIR, { recursive: true });
try { appState = { ...appState, ...JSON.parse(await readFile(join(APP_DIR, "state.json"), "utf8")) }; } catch {}

const tg = new TelegramClient({
  apiId: Number(process.env.TELEGRAM_API_ID),
  apiHash: process.env.TELEGRAM_API_HASH,
  storage: join(TG_DIR, "session.sqlite"),
});

function log(message, extra = "") { console.log(`[teledumb] ${message}`, extra); }
function peerId(peer) { return Number(peer?.id ?? peer?.markedId ?? peer?.inputPeer?.userId ?? peer?.inputPeer?.chatId ?? peer?.inputPeer?.channelId); }
function peerName(peer) { return peer?.displayName || peer?.title || [peer?.firstName, peer?.lastName].filter(Boolean).join(" ") || peer?.username || String(peerId(peer) || "Unknown"); }
function chatKind(peer) { return ["group", "supergroup", "channel"].includes(peer?.type) ? "group" : "direct"; }
function conversationId(peer) { return `${chatKind(peer)}:${peerId(peer)}`; }
function mediaType(media) {
  if (!media) return "";
  if (media.type === "photo") return "image/jpeg";
  if (["video", "animation", "video_note"].includes(media.type)) return media.mimeType || "video/mp4";
  if (["voice", "audio"].includes(media.type)) return media.mimeType || "audio/ogg";
  if (media.type === "sticker") return media.isAnimated ? "application/x-tgsticker" : media.isVideo ? "video/webm" : "image/webp";
  return media.mimeType || "application/octet-stream";
}
function entities(message) {
  return (message.entities || []).map(entity => ({ start: entity.offset || 0, length: entity.length || 0, style: entity.type || "plain", ...(entity.user ? { name: peerName(entity.user) } : {}) }));
}
function reactions(message) {
  const result = [];
  const displayEmoji = value => String(value || "❤").replace(/^❤$/, "❤️");
  for (const reaction of message.reactions?.recentReactions || []) result.push({ emoji: displayEmoji(reaction.emoji), author: peerName(reaction.peer), own: reaction.peerId === peerId(me), timestamp: message.date?.getTime() });
  if (!result.length) for (const reaction of message.reactions?.reactions || []) for (let i = 0; i < Number(reaction.count || 0); i++) result.push({ emoji: displayEmoji(reaction.emoji), author: reaction.order !== null ? "You" : "Telegram user", own: reaction.order !== null });
  return result;
}
function serviceText(message) {
  const action = message.action;
  if (!action) return "Service message";
  return action.message || action.type?.replaceAll("_", " ") || "Chat updated";
}
function normalizeMessage(message, dialog = null) {
  const chat = message.chat || dialog?.peer;
  const cid = conversationId(chat);
  const timestamp = message.date?.getTime?.() || Date.now();
  const attachments = message.media && !["web_page", "poll"].includes(message.media.type) ? [{
    id: message.media.fileId || `${peerId(chat)}-${message.id}`,
    contentType: mediaType(message.media),
    filename: message.media.fileName || `${message.media.type || "attachment"}`,
    size: Number(message.media.fileSize || 0),
    width: Number(message.media.width || 0),
    height: Number(message.media.height || 0),
  }] : [];
  const read = message.isOutgoing && dialog && message.id <= Number(dialog.lastReadOutgoing || 0);
  const item = {
    id: `${peerId(chat)}:${message.id}`,
    telegramId: message.id,
    conversationId: cid,
    direction: message.isOutgoing || peerId(chat) === peerId(me) ? "out" : "in",
    sender: peerId(message.sender) === peerId(me) ? "You" : peerName(message.sender),
    senderId: peerId(message.sender),
    text: message.isService ? serviceText(message) : (message.text || ""),
    system: Boolean(message.isService), timestamp,
    edited: Boolean(message.editDate), pinned: Boolean(message.isPinned), deleted: false,
    status: read ? "read" : "sent", receipts: {}, attachments,
    reactions: reactions(message), textStyles: entities(message), mentions: entities(message).filter(x => x.style === "mention_name"),
    quote: message.replyToMessage ? { timestamp: 0, telegramId: message.replyToMessage.messageId, author: "Reply", text: "Quoted message" } : null,
    poll: message.media?.type === "poll" ? { question: message.media.question || "Poll", multiple: Boolean(message.media.isMultiple), closed: Boolean(message.media.isClosed), options: (message.media.answers || []).map((x, i) => ({ index: i, text: x.text, votes: Array(Number(x.voters || 0)).fill("vote"), chosen: Boolean(x.chosen) })) } : null,
  };
  Object.defineProperty(item, "_raw", { value: message, enumerable: false });
  messageCache.set(item.id, item);
  return item;
}
async function enrichQuote(item, raw) {
  if (!item.quote?.telegramId) return item;
  try {
    const [quoted] = await tg.getMessages(peerId(raw.chat), [item.quote.telegramId]);
    if (quoted) item.quote = { telegramId: quoted.id, timestamp: quoted.date?.getTime?.() || 0, author: peerId(quoted.sender) === peerId(me) ? "You" : peerName(quoted.sender), text: quoted.text || (quoted.media ? `${quoted.media.type || "Media"}` : "Message"), mentions: entities(quoted).filter(x => x.style === "mention_name") };
  } catch {}
  return item;
}
async function persistState() { const tmp = join(APP_DIR, "state.json.tmp"); await writeFile(tmp, JSON.stringify(appState), { mode: 0o600 }); await rename(tmp, join(APP_DIR, "state.json")); }
async function refreshAuthorization() {
  try { me = await tg.getMe(); auth.stage = "authorized"; return true; }
  catch { me = null; if (auth.stage === "authorized") auth.stage = "phone"; return false; }
}
await refreshAuthorization();

// Keep loaded message objects available for authenticated media URLs. Fresh
// history requests replace entries with the same chat-scoped Telegram ID.
function invalidate() {}
tg.onNewMessage.add(() => invalidate());
tg.onEditMessage.add?.(() => invalidate());
tg.onDeleteMessage.add?.(() => invalidate());
tg.onUserTyping.add?.(async event => {
  const id = Number(event.chatId); if (!id) return;
  if (event.status === "cancel") return typing.delete(id);
  const user = await tg.getPeer(event.userId).catch(() => null);
  typing.set(id, { name: peerName(user), until: Date.now() + 7000 });
});

function tokenMatches(req) { const supplied = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]; if (!supplied) return false; const expected = Buffer.from(process.env.WIDGET_TOKEN); const actual = Buffer.from(supplied); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function requireSameOrigin(req) {
  const origin = req.headers.origin; if (!origin || origin === process.env.PUBLIC_ORIGIN) return true;
  const host = req.headers["x-forwarded-host"]?.split(",")[0].trim() || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"]?.split(",")[0].trim() || (req.socket.encrypted ? "https" : "http");
  return Boolean(host) && origin === `${protocol}://${host}`;
}
function json(res, status, value, headers = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(value)); }
async function body(req, limit = 1_000_000) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error("Request too large"); chunks.push(chunk); } return size ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
function inputPeer(input) { const value = Number(input.target); if (!Number.isSafeInteger(value)) throw new Error("Invalid Telegram chat"); return value; }
function findCached(input) { const cid = `${input.kind}:${input.target}`; return [...messageCache.values()].find(x => x.conversationId === cid && (x.timestamp === Number(input.timestamp) || x.telegramId === Number(input.messageId))); }
const displayReaction = value => String(value || "").replace(/^❤$/, "❤️");
async function globalReactions() {
  if (reactionCache.values.length && Date.now() - reactionCache.at < 6 * 60 * 60_000) return reactionCache.values;
  const result = await tg.call({ _: "messages.getAvailableReactions", hash: 0 });
  const values = result._ === "messages.availableReactions" ? result.reactions.filter(item => !item.inactive && (!item.premium || me?.isPremium)).map(item => displayReaction(item.reaction)) : reactionCache.values;
  reactionCache = { at: Date.now(), values }; return values;
}
async function allowedReactionsFor(target) {
  const global = await globalReactions().catch(() => ["👍", "👎", "❤️", "🔥", "🥰", "👏"]);
  try {
    const full = await tg.getFullChat(target); const available = full.availableReactions ?? full.full?.availableReactions;
    if (available?._ === "chatReactionsNone") return [];
    if (available?._ === "chatReactionsSome") return available.reactions.filter(item => item._ === "reactionEmoji").map(item => displayReaction(item.emoticon)).filter(item => global.includes(item));
  } catch {}
  return global;
}
async function serveAttachment(req, res, msg) {
  const path = join(MEDIA_DIR, Buffer.from(msg.id).toString("base64url"));
  let info = await stat(path).catch(() => null);
  if (info?.isFile() && info.size === 0) { await unlink(path).catch(() => {}); info = null; }
  if (!info?.isFile()) {
    if (!mediaDownloads.has(path)) mediaDownloads.set(path, (async () => { const temporary = `${path}.${randomBytes(5).toString("hex")}.tmp`; try { await tg.downloadToFile(temporary, msg._raw.media); const downloaded = await stat(temporary); if (!downloaded.size) throw new Error("Telegram returned an empty attachment"); await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); mediaDownloads.delete(path); } })());
    await mediaDownloads.get(path); info = await stat(path);
  }
  if (!info.size) return json(res, 404, { error: "Attachment is empty" });
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/); let start = 0; let end = info.size - 1; let status = 200;
  if (range) {
    if (!range[1] && range[2]) { const suffixLength = Number(range[2]); if (!Number.isFinite(suffixLength) || suffixLength <= 0) return json(res, 416, { error: "Invalid range" }); start = Math.max(0, info.size - suffixLength); end = info.size - 1; }
    else { start = range[1] ? Number(range[1]) : 0; end = range[2] ? Math.min(Number(range[2]), end) : end; }
    if (start > end || start >= info.size) return json(res, 416, { error: "Invalid range" }); status = 206;
  }
  const headers = { "content-type": msg.attachments[0]?.contentType || "application/octet-stream", "content-length": end - start + 1, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };
  if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  res.writeHead(status, headers); return createReadStream(path, { start, end }).pipe(res);
}

async function cachedDialogs() {
  if (dialogsCache.values.length && Date.now() - dialogsCache.at < 15_000) return dialogsCache.values;
  const values = [];
  for await (const dialog of tg.iterDialogs({ archived: "keep", pinned: "include", limit: 500 })) {
    const peer = dialog.peer; const id = peerId(peer); if (!id) continue;
    const last = dialog.lastMessage ? normalizeMessage(dialog.lastMessage, dialog) : null;
    values.push({ id: conversationId(peer), kind: chatKind(peer), target: String(id), name: id === peerId(me) ? "Saved Messages" : peerName(peer), noteToSelf: id === peerId(me), archived: Boolean(dialog.isArchived), favorite: Boolean(dialog.isPinned || appState.favorites.includes(conversationId(peer))), unread: Number(dialog.unreadCount || 0), last, typing: typing.get(id)?.until > Date.now() ? [typing.get(id).name] : [], avatar: peer.photo ? `/api/avatar/${encodeURIComponent(id)}` : null, blocked: false, expiration: Number(dialog.ttlPeriod || 0) });
  }
  dialogsCache = { at: Date.now(), values };
  return values;
}
async function api(req, res, url) {
  if (!tokenMatches(req)) return json(res, 404, { error: "Not found" });
  if (req.method !== "GET" && !requireSameOrigin(req)) return json(res, 403, { error: "Origin rejected" });
  if (url.pathname === "/api/mindful" && req.method === "GET") return json(res, 200, { usage: appState.mindfulUsage?.[url.searchParams.get("day")] || null });
  if (url.pathname === "/api/mindful" && req.method === "POST") { const input = await body(req); if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day || "")) return json(res, 400, { error: "Invalid day" }); appState.mindfulUsage ||= {}; appState.mindfulUsage[input.day] = input.usage; await persistState(); return json(res, 200, { usage: appState.mindfulUsage[input.day] }); }
  if (url.pathname === "/api/status") { await refreshAuthorization(); return json(res, 200, { telegramReady: true, linked: auth.stage === "authorized", authStage: auth.stage, passwordHint: auth.hint, settings: appState.settings, capabilities: { polls: true, pins: true, voiceNotes: true, stickers: true, groups: true, identities: false } }); }
  if (url.pathname === "/api/telegram/auth/phone" && req.method === "POST") {
    const input = await body(req); const phone = String(input.phone || "").replace(/[^+\d]/g, ""); if (!/^\+\d{7,15}$/.test(phone)) return json(res, 400, { error: "Enter a phone number in international format" });
    const sent = await tg.sendCode({ phone }); if (sent?.type === "user") { me = sent; auth.stage = "authorized"; } else auth = { stage: "code", phone, phoneCodeHash: sent.phoneCodeHash, hint: "" };
    return json(res, 200, { stage: auth.stage });
  }
  if (url.pathname === "/api/telegram/auth/code" && req.method === "POST") {
    const input = await body(req); try { me = await tg.signIn({ phone: auth.phone, phoneCodeHash: auth.phoneCodeHash, phoneCode: String(input.code || "").trim() }); auth.stage = "authorized"; }
    catch (error) { if (error.errorMessage === "SESSION_PASSWORD_NEEDED" || error.message?.includes("SESSION_PASSWORD_NEEDED")) { auth.hint = await tg.getPasswordHint().catch(() => ""); auth.stage = "password"; } else throw error; }
    return json(res, 200, { stage: auth.stage, passwordHint: auth.hint });
  }
  if (url.pathname === "/api/telegram/auth/password" && req.method === "POST") { const input = await body(req); me = await tg.checkPassword(String(input.password || "")); auth.stage = "authorized"; return json(res, 200, { stage: auth.stage }); }
  if (url.pathname === "/api/telegram/auth/resend" && req.method === "POST") { const sent = await tg.resendCode({ phone: auth.phone, phoneCodeHash: auth.phoneCodeHash }); auth.phoneCodeHash = sent.phoneCodeHash; return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/telegram/logout" && req.method === "POST") { await tg.logOut(); me = null; auth = { stage: "phone", phone: "", phoneCodeHash: "", hint: "" }; return json(res, 200, { ok: true }); }
  if (auth.stage !== "authorized") return json(res, 409, { error: "Telegram sign-in required" });
  if (url.pathname === "/api/conversations" && req.method === "GET") { const archived = url.searchParams.get("archived") === "1"; const all = await cachedDialogs(); const conversations = all.filter(item => item.archived === archived); return json(res, 200, { conversations, showingArchived: archived, archivedCount: all.filter(item => item.archived).length }); }
  if (url.pathname.startsWith("/api/messages/") && req.method === "GET") {
    const cid = decodeURIComponent(url.pathname.slice(14)); const target = Number(cid.split(":").slice(1).join(":")); const before = Number(url.searchParams.get("before") || 0); const values = [];
    const [dialog] = await tg.getPeerDialogs([target]);
    for await (const msg of tg.iterHistory(target, { limit: 60, ...(before ? { offsetId: [...messageCache.values()].find(x => x.conversationId === cid && x.timestamp === before)?.telegramId || 0 } : {}) })) values.push(await enrichQuote(normalizeMessage(msg, dialog), msg));
    const allowedReactions = await allowedReactionsFor(target);
    values.reverse(); const readId = Number(dialog.readInboxMaxId || dialog.lastReadIncoming || 0); const readThrough = values.filter(message => message.direction === "in" && message.telegramId <= readId).at(-1)?.timestamp || 0; const active = typing.get(target); return json(res, 200, { messages: values, hasMore: values.length >= 60, readThrough, typing: active?.until > Date.now() ? [active.name] : [], allowedReactions });
  }
  if (url.pathname === "/api/send" && req.method === "POST") { const input = await body(req); const quote = findCached({ ...input, timestamp: input.quoteTimestamp }); const msg = await tg.sendText(inputPeer(input), String(input.message || "").trim(), { ...(quote ? { replyTo: quote.telegramId } : {}), disableWebPreview: !appState.settings.linkPreviews }); return json(res, 200, { message: normalizeMessage(msg) }); }
  if (url.pathname === "/api/read" && req.method === "POST") { const input = await body(req); const target = Number(String(input.conversationId).split(":").slice(1).join(":")); await tg.readHistory(target); return json(res, 200, { ok: true, read: true }); }
  if (url.pathname === "/api/typing" && req.method === "POST") { const input = await body(req); if (appState.settings.sendTypingIndicators) await tg.setTyping({ peerId: inputPeer(input), status: input.stop ? "cancel" : "typing" }); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/conversation/archive" && req.method === "POST") { const input = await body(req); const target = Number(String(input.conversationId).split(":").slice(1).join(":")); if (input.archived) await tg.archiveChats(target); else await tg.unarchiveChats(target); dialogsCache.at = 0; return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/conversation/favorite" && req.method === "POST") { const input = await body(req); appState.favorites = input.favorite ? [...new Set([...appState.favorites, input.conversationId])] : appState.favorites.filter(x => x !== input.conversationId); await persistState(); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/message/reaction" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Message not loaded" }); const selected = displayReaction(input.emoji); if (!input.remove && !(await allowedReactionsFor(inputPeer(input))).includes(selected)) return json(res, 400, { error: "That reaction is not allowed in this Telegram chat" }); try { await tg.sendReaction({ chatId: inputPeer(input), message: msg.telegramId, emoji: input.remove ? null : selected.replaceAll("\uFE0F", ""), shouldDispatch: true }); } catch (error) { if (error.errorMessage === "REACTION_INVALID" || error.message?.includes("REACTION_INVALID")) return json(res, 400, { error: "That reaction is not allowed in this Telegram chat" }); throw error; } return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/message/edit" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Message not loaded" }); const result = await tg.editMessage({ chatId: inputPeer(input), message: msg.telegramId, text: String(input.message || "").trim(), shouldDispatch: true }); return json(res, 200, { message: normalizeMessage(result) }); }
  if (url.pathname === "/api/message/delete" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Message not loaded" }); await tg.deleteMessagesById(inputPeer(input), [msg.telegramId], { revoke: true, shouldDispatch: true }); invalidate(); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/message/pin" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Message not loaded" }); if (input.pinned) await tg.pinMessage({ chatId: inputPeer(input), message: msg.telegramId }); else await tg.unpinMessage({ chatId: inputPeer(input), message: msg.telegramId }); return json(res, 200, { ok: true }); }
  if (url.pathname.startsWith("/api/pins/") && req.method === "GET") { const cid = decodeURIComponent(url.pathname.slice(10)); const target = Number(cid.split(":").slice(1).join(":")); const pins = []; for await (const msg of tg.iterHistory(target, { limit: 300 })) if (msg.isPinned) pins.push(normalizeMessage(msg)); return json(res, 200, { pins }); }
  if (url.pathname === "/api/group/create" && req.method === "POST") { const input = await body(req); const result = await tg.createGroup({ title: String(input.name || "").trim(), users: (input.members || []).map(Number) }); return json(res, 200, { id: peerId(result.chat || result) }); }
  if (url.pathname === "/api/poll/create" && req.method === "POST") { const input = await body(req); const answers = (input.options || []).map(x => String(x).trim()).filter(Boolean); if (!String(input.question || "").trim() || answers.length < 2) return json(res, 400, { error: "A poll needs a question and at least two choices" }); const msg = await tg.sendMedia(inputPeer(input), { type: "poll", question: String(input.question).trim(), answers, multiple: Boolean(input.multiple) }); return json(res, 200, { message: normalizeMessage(msg) }); }
  if (url.pathname === "/api/poll/vote" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Poll not loaded" }); await tg.sendVote({ chatId: inputPeer(input), message: msg.telegramId, options: input.options || [] }); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/poll/close" && req.method === "POST") { const input = await body(req); const msg = findCached(input); if (!msg) return json(res, 404, { error: "Poll not loaded" }); await tg.closePoll({ chatId: inputPeer(input), message: msg.telegramId, shouldDispatch: true }); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/search" && req.method === "GET") { const results = []; const found = await tg.searchGlobal({ query: url.searchParams.get("q") || "", limit: 50 }); for (const msg of found) { const item = normalizeMessage(msg); results.push({ conversationId: item.conversationId, timestamp: item.timestamp, sender: item.sender, text: item.text || item.attachments[0]?.filename || "Media" }); } return json(res, 200, { results }); }
  if (url.pathname === "/api/settings" && req.method === "POST") { appState.settings = { ...appState.settings, ...(await body(req)) }; await persistState(); return json(res, 200, { settings: appState.settings }); }
  if (url.pathname === "/api/voice" && req.method === "POST") {
    const target = Number(url.searchParams.get("target")); const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) return json(res, 413, { error: "Voice note is too large" }); chunks.push(chunk); }
    const name = join(APP_DIR, `${Date.now()}-voice.webm`); await writeFile(name, Buffer.concat(chunks), { mode: 0o600 }); const msg = await tg.sendMedia(target, { type: "voice", file: name }); return json(res, 200, { message: normalizeMessage(msg) });
  }
  if (url.pathname.startsWith("/api/attachment/") && req.method === "GET") { const key = decodeURIComponent(url.pathname.slice(16).split("/")[0]); const msg = messageCache.get(key); if (!msg?._raw?.media) return json(res, 404, { error: "Attachment unavailable" }); return serveAttachment(req, res, msg); }
  if (url.pathname.startsWith("/api/avatar/") && req.method === "GET") { const target = Number(decodeURIComponent(url.pathname.slice(12))); try { const peer = await tg.getPeer(target); const photo = peer.photo?.big || peer.photo?.small || peer.photo; if (!photo) throw new Error(); res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" }); return tg.downloadAsNodeStream(photo).pipe(res); } catch { return json(res, 404, { error: "Avatar unavailable" }); } }
  return json(res, 404, { error: "Not found" });
}

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
async function staticFile(req, res, url) { const relative = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^\/+/, ""); const path = join(PUBLIC_DIR, relative); if (!path.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" }); try { const info = await stat(path); if (!info.isFile()) throw new Error(); res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream", "content-length": info.size, "cache-control": "no-cache", "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" }); createReadStream(path).pipe(res); } catch { json(res, 404, { error: "Not found" }); } }
const server = createServer(async (req, res) => { try { const url = new URL(req.url, "http://localhost"); if (url.pathname === "/healthz") return json(res, 200, { ok: true }); if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); } if (url.pathname.startsWith("/api/")) return await api(req, res, url); return await staticFile(req, res, url); } catch (error) { log("request failed", error.stack || error.message); if (!res.headersSent) json(res, 500, { error: error.message || "Internal error" }); else res.end(); } });
server.listen(PORT, "0.0.0.0", () => log(`web UI listening on ${PORT}`));
async function shutdown() { server.close(); await tg.destroy().catch(() => {}); setTimeout(() => process.exit(0), 1000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
