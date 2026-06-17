#!/usr/bin/env node
// Read-only Google Drive CLI for Core. Uses the official Drive v3 API with the
// shared Google OAuth refresh token. No third-party deps (Node built-in fetch).
// Lists/searches files and reads the text content of Docs, Sheets, and text files.
//
// Commands:
//   node drive.mjs list ["<name contains>"] [maxResults]
//   node drive.mjs search "<full-text query>" [maxResults]
//   node drive.mjs read <fileId>
//
// Auth: reads the refresh token from the shared Google token file, mints a
// short-lived access token, and calls the API. The token never enters the model's context.
import { readFileSync } from "node:fs";

const OAUTH_FILE = process.env.GOOGLE_OAUTH_FILE ?? "/app/secrets/google_oauth.json";
const DRIVE = "https://www.googleapis.com/drive/v3";

function die(msg) {
  console.error(`drive: ${msg}`);
  process.exit(1);
}

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(readFileSync(OAUTH_FILE, "utf8"));
  }
  catch {
    die(`could not read credentials at ${OAUTH_FILE} — run scripts/google-oauth.mjs first`);
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

async function apiJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) die(`API failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function apiText(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) die(`API failed: ${res.status} ${await res.text()}`);
  return res.text();
}

// Escape single quotes for Drive query strings (q uses single-quoted literals).
const qEsc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,owners(displayName),webViewLink";
const simplify = (f) => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  modified: f.modifiedTime,
  owner: f.owners?.[0]?.displayName,
  link: f.webViewLink,
});

async function listFiles(token, query, max) {
  const params = new URLSearchParams({
    pageSize: String(max),
    orderBy: "modifiedTime desc",
    q: query,
    fields: `files(${FILE_FIELDS})`,
  });
  const j = await apiJson(`${DRIVE}/files?${params}`, token);
  return { query, returned: (j.files ?? []).length, files: (j.files ?? []).map(simplify) };
}

async function cmdList(token, max) {
  // Most-recently-modified files. To find files by name/content, use `search`.
  return listFiles(token, "trashed = false", max);
}

async function cmdSearch(token, text, max) {
  return listFiles(token, `fullText contains '${qEsc(text)}' and trashed = false`, max);
}

// Google Workspace native files have no bytes to download — they must be exported.
const EXPORT = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TEXTUAL = /^text\/|^application\/(json|xml|.*\+xml|javascript|x-yaml|x-sh|csv)/;
const CAP = 8000;

async function cmdRead(token, id) {
  const meta = await apiJson(`${DRIVE}/files/${id}?fields=id,name,mimeType,size`, token);
  const mt = meta.mimeType ?? "";
  let content;
  if (mt.startsWith("application/vnd.google-apps.")) {
    const target = EXPORT[mt];
    if (!target) {
      return { id, name: meta.name, mimeType: mt, note: "Google Workspace file with no text export (e.g. form/drawing). Open via Drive." };
    }
    content = await apiText(`${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(target)}`, token);
  }
  else if (TEXTUAL.test(mt)) {
    content = await apiText(`${DRIVE}/files/${id}?alt=media`, token);
  }
  else {
    return {
      id,
      name: meta.name,
      mimeType: mt,
      note: `Binary file (${mt}); text extraction not supported. Open it at https://drive.google.com/file/d/${id}/view`,
    };
  }
  const truncated = content.length > CAP;
  return {
    id,
    name: meta.name,
    mimeType: mt,
    content: truncated ? content.slice(0, CAP) + "\n…[truncated]" : content,
  };
}

const clampMax = (v, def = 20, cap = 50) => Math.min(parseInt(v ?? String(def), 10) || def, cap);

const [cmd, ...rest] = process.argv.slice(2);
const token = await accessToken();
let result;
switch (cmd) {
  case "list":
    result = await cmdList(token, clampMax(rest[0]));
    break;
  case "search": {
    if (!rest[0]) die('usage: drive.mjs search "<query>" [maxResults]');
    result = await cmdSearch(token, rest[0], clampMax(rest[1]));
    break;
  }
  case "read": {
    if (!rest[0]) die("usage: drive.mjs read <fileId>");
    result = await cmdRead(token, rest[0]);
    break;
  }
  default:
    die('unknown command. use: list ["<name>"] [n] | search "<query>" [n] | read <fileId>');
}
console.log(JSON.stringify(result, null, 2));
