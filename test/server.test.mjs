import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = path => readFile(new URL(path, import.meta.url), "utf8");

test("CloudPhone assets are CSP-safe and TeleDumb branded", async () => {
  const [html, app] = await Promise.all([load("../public/index.html"), load("../public/app.js")]);
  assert.doesNotMatch(html, /<script(?![^>]+src=)/i);
  assert.doesNotMatch(app, /\son(?:click|error|load)=/i);
  assert.match(html, /TeleDumb/);
  assert.match(app, /teledumb\.png/);
});

test("Compose defaults to a loopback-only port", async () => {
  const compose = await load("../compose.yaml");
  assert.match(compose, /\$\{BIND_ADDRESS:-127\.0\.0\.1\}:\$\{HOST_PORT:-8788\}:8080/);
  assert.match(compose, /TELEGRAM_API_ID/);
  assert.doesNotMatch(compose, /SIGNAL|signal-cli/);
});

test("Telegram authentication and core messaging routes are wired", async () => {
  const server = await load("../server.mjs");
  for (const route of ["/api/telegram/auth/phone", "/api/telegram/auth/code", "/api/telegram/auth/password", "/api/conversations", "/api/messages/", "/api/send", "/api/read", "/api/typing", "/api/message/reaction", "/api/message/edit", "/api/message/delete", "/api/message/pin", "/api/voice"]) assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(server, /TelegramClient/);
  assert.doesNotMatch(server, /signal-cli|7583/);
});

test("keypad navigation and staged login remain available", async () => {
  const app = await load("../public/app.js");
  for (const feature of ["telegramLogin", "voiceRecorderScreen", "pinnedMessages", "searchScreen", "draftKey", "moveEmoji"]) assert.match(app, new RegExp(feature));
  assert.match(app, /state\.view === "telegram-login"/);
  assert.match(app, /function frameFocusedItem\(target, direction\)/);
  assert.match(app, /rect\.height <= available/);
  assert.match(app, /Math\.max\(120, viewport\.bottom - viewport\.top - 8\)/);
  assert.match(app, /state\.returnFocusTimestamp = timestamp/);
  assert.match(app, /class="receipt-details scroll-focus focusable"/);
  assert.match(app, /function toggleVoiceNote\(audio\)/);
  assert.doesNotMatch(app, /class="voice-note focusable"/);
});
