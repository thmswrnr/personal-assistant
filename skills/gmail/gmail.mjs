#!/usr/bin/env node
// Read-only Gmail CLI for Core. Uses the official Gmail REST API with a stored
// OAuth refresh token. No third-party deps (Node built-in fetch), no send/modify.
//
// Commands:
//   node gmail.mjs labels
//   node gmail.mjs search "<gmail query>" [maxResults]
//   node gmail.mjs read <messageId>
//
// Auth: reads the refresh token from $GMAIL_OAUTH_FILE (default
// /app/secrets/gmail_oauth.json), mints a short-lived access token, and calls
// the API. The token never appears in the agent's context.
import { readFileSync, existsSync } from "node:fs";

// Shared Google OAuth token (Gmail + Drive + Calendar). Falls back to the legacy
// gmail-only token file so existing setups keep working until they re-consent.
const OAUTH_FILE = process.env.GMAIL_OAUTH_FILE
  ?? (existsSync("/app/secrets/google_oauth.json")
    ? "/app/secrets/google_oauth.json"
    : "/app/secrets/gmail_oauth.json");
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function die(msg) {
  console.error(`gmail: ${msg}`);
  process.exit(1);
}

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(readFileSync(OAUTH_FILE, "utf8"));
  } catch {
    die(`could not read credentials at ${OAUTH_FILE} — run scripts/gmail-oauth.mjs first`);
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
  });
  const res = await fetch(creds.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) die(`token refresh failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.access_token) die("token refresh returned no access_token");
  return j.access_token;
}

async function api(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) die(`API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const header = (headers, name) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const b64 = (data) => Buffer.from(data, "base64url").toString("utf8");

// Convert HTML email to readable text — drop style/script/head, turn blocks into
// newlines, decode common entities. (Crude tag-stripping leaves CSS/JS as "text".)
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z0-9#]+;/gi, " ");
}

// Tidy whitespace and collapse long tracking URLs so context isn't filled with junk.
function cleanText(s) {
  return s
    .replace(/https?:\/\/\S{80,}/g, "(link)")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBody(payload) {
  // Prefer a text/plain part; fall back to cleaned HTML.
  let plain = "", html = "";
  const walk = (part) => {
    if (!part) return;
    const data = part.body?.data;
    if (data && part.mimeType === "text/plain" && !plain) plain = b64(data);
    else if (data && part.mimeType === "text/html" && !html) html = b64(data);
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return cleanText(plain || (html ? htmlToText(html) : ""));
}

async function cmdLabels(token) {
  const j = await api("/labels", token);
  return (j.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

async function cmdSearch(token, query, max) {
  const list = await api(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, token);
  const ids = (list.messages ?? []).map((m) => m.id);
  // Fetch message metadata concurrently (preserves order) — much faster than serial.
  const messages = await Promise.all(
    ids.map(async (id) => {
      const m = await api(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        token,
      );
      return {
        id,
        from: header(m.payload?.headers, "From"),
        subject: header(m.payload?.headers, "Subject"),
        date: header(m.payload?.headers, "Date"),
        snippet: m.snippet ?? "",
      };
    }),
  );
  // resultSizeEstimate is Gmail's approximate total match count — lets callers see
  // "N total" even though we only return (and fetch) up to `max` of them.
  return {
    query,
    estimatedTotal: list.resultSizeEstimate ?? messages.length,
    returned: messages.length,
    messages,
  };
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) out[args[i].slice(2)] = args[++i] ?? "";
  }
  return out;
}

// Create a DRAFT (never sends). Requires the gmail.compose scope.
async function cmdDraft(token, { to, subject, body }) {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    (body ?? "").replace(/\\n/g, "\n"),
  ].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");
  const res = await fetch(`${API}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) die(`draft create failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { created: "draft", draftId: j.id, to, subject };
}

async function cmdRead(token, id) {
  const m = await api(`/messages/${id}?format=full`, token);
  const h = m.payload?.headers;
  return {
    id,
    from: header(h, "From"),
    to: header(h, "To"),
    subject: header(h, "Subject"),
    date: header(h, "Date"),
    body: (() => {
      const b = decodeBody(m.payload);
      return b.length > 6000 ? b.slice(0, 6000) + "\n…[truncated]" : b;
    })(),
  };
}

const [cmd, ...rest] = process.argv.slice(2);
const token = await accessToken();
let result;
switch (cmd) {
  case "labels":
    result = await cmdLabels(token);
    break;
  case "search": {
    const query = rest[0];
    if (!query) die('usage: gmail.mjs search "<query>" [maxResults]');
    const max = Math.min(parseInt(rest[1] ?? "10", 10) || 10, 25);
    result = await cmdSearch(token, query, max);
    break;
  }
  case "read": {
    const id = rest[0];
    if (!id) die("usage: gmail.mjs read <messageId>");
    result = await cmdRead(token, id);
    break;
  }
  case "draft": {
    const f = parseFlags(rest);
    if (!f.to || !f.subject) die('usage: gmail.mjs draft --to <addr> --subject <s> --body <text>');
    result = await cmdDraft(token, f);
    break;
  }
  default:
    die('unknown command. use: labels | search "<query>" [n] | read <messageId> | draft --to <a> --subject <s> --body <t>');
}
console.log(JSON.stringify(result, null, 2));
