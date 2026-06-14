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
import { readFileSync } from "node:fs";

const OAUTH_FILE = process.env.GMAIL_OAUTH_FILE ?? "/app/secrets/gmail_oauth.json";
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

function decodeBody(payload) {
  // Walk MIME parts for the first text/plain (fallback text/html), base64url-decoded.
  const pick = (part) => {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) return b64(part.body.data);
    if (part.parts) {
      for (const p of part.parts) {
        const t = pick(p);
        if (t) return t;
      }
    }
    if (part.mimeType === "text/html" && part.body?.data) {
      return b64(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return "";
  };
  return pick(payload);
}
const b64 = (data) => Buffer.from(data, "base64url").toString("utf8");

async function cmdLabels(token) {
  const j = await api("/labels", token);
  return (j.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

async function cmdSearch(token, query, max) {
  const list = await api(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, token);
  const ids = (list.messages ?? []).map((m) => m.id);
  const messages = [];
  for (const id of ids) {
    const m = await api(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      token,
    );
    messages.push({
      id,
      from: header(m.payload?.headers, "From"),
      subject: header(m.payload?.headers, "Subject"),
      date: header(m.payload?.headers, "Date"),
      snippet: m.snippet ?? "",
    });
  }
  // resultSizeEstimate is Gmail's approximate total match count — lets callers see
  // "N total" even though we only return (and fetch) up to `max` of them.
  return {
    query,
    estimatedTotal: list.resultSizeEstimate ?? messages.length,
    returned: messages.length,
    messages,
  };
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
    body: decodeBody(m.payload).slice(0, 8000),
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
  default:
    die('unknown command. use: labels | search "<query>" [n] | read <messageId>');
}
console.log(JSON.stringify(result, null, 2));
