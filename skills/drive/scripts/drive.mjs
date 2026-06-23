#!/usr/bin/env node
// Google Drive CLI for Core. Uses the official Drive v3 API with the shared Google OAuth
// refresh token. No third-party deps (Node built-in fetch).
//
// Interactive commands are READ-ONLY — list/search files and read the text of Docs, Sheets,
// and text files. The only WRITE action is the automated `inbox-watch` poller (run by the
// scheduler, never by the model): it ingests new files from a Drive __inbox__ folder into the
// local inbox and trashes the Drive originals so the folder stays clear.
//
// Commands:
//   node drive.mjs list ["<name contains>"] [maxResults]
//   node drive.mjs search "<full-text query>" [maxResults]
//   node drive.mjs read <fileId>
//   node drive.mjs inbox-list                 (debug: what's in the Drive __inbox__ folder)
//   node drive.mjs inbox-watch                (scheduler poller — see cmdInboxWatch)
//
// Auth: reads the refresh token from the shared Google token file, mints a
// short-lived access token, and calls the API. The token never enters the model's context.
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { accessToken } from "../../_shared/google-auth.mjs";
const DRIVE = "https://www.googleapis.com/drive/v3";

// Drive __inbox__ ingest: which Drive folder to watch, and where to drop downloaded files
// locally (the existing `process-inbox` skill + its scheduler watch take it from there).
const INBOX_FOLDER_NAME = process.env.DRIVE_INBOX_FOLDER ?? "__inbox__";
const LOCAL_INBOX = process.env.CORE_INBOX_DIR ?? "/app/storage/inbox";

function die(msg) {
  console.error(`drive: ${msg}`);
  process.exit(1);
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

// ---- Drive __inbox__ ingest (write; automation only) ----

// PATCH a file (used to trash an ingested original). Returns the parsed body.
async function apiPatch(url, token, body) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Resolve a folder by name → id (first match, not trashed). null if absent.
async function findFolder(token, name) {
  const params = new URLSearchParams({
    q: `mimeType = 'application/vnd.google-apps.folder' and name = '${qEsc(name)}' and trashed = false`,
    fields: "files(id,name)",
    pageSize: "10",
  });
  const j = await apiJson(`${DRIVE}/files?${params}`, token);
  return j.files?.[0]?.id ?? null;
}

// Direct (non-recursive) children of a folder, excluding subfolders and trashed items.
async function listChildren(token, folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: "100",
    orderBy: "modifiedTime",
  });
  const j = await apiJson(`${DRIVE}/files?${params}`, token);
  return j.files ?? [];
}

const EXPORT_EXT = { "text/plain": "txt", "text/csv": "csv" };
const sanitizeName = (n) => (n ?? "").replace(/[/\x00-\x1f]/g, "_").trim() || "drive-file";

// Download one Drive file's bytes into the local inbox. Google Workspace files are exported to
// text/CSV; everything else is fetched as-is. Returns { ok: <localPath> } or { skip: <reason> }.
async function downloadToInbox(token, meta) {
  const mt = meta.mimeType ?? "";
  let url;
  let name = sanitizeName(meta.name ?? meta.id);

  if (mt.startsWith("application/vnd.google-apps.")) {
    const target = EXPORT[mt];
    if (!target) {
      return { skip: "Google Workspace file with no text export" };
    }
    url = `${DRIVE}/files/${meta.id}/export?mimeType=${encodeURIComponent(target)}`;
    const ext = EXPORT_EXT[target] ?? "txt";
    if (!name.toLowerCase().endsWith("." + ext)) name += "." + ext;
  }
  else {
    url = `${DRIVE}/files/${meta.id}?alt=media`;
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return { skip: `download failed (${res.status})` };
  }
  const buf = Buffer.from(await res.arrayBuffer());

  mkdirSync(LOCAL_INBOX, { recursive: true });
  let dest = `${LOCAL_INBOX}/${name}`;
  if (existsSync(dest)) {
    dest = `${LOCAL_INBOX}/${meta.id.slice(0, 6)}_${name}`; // avoid clobbering a same-named file
  }
  writeFileSync(dest, buf);
  return { ok: dest };
}

// Scheduler poller. Pulls every new file from the Drive __inbox__ folder into the local inbox,
// then trashes the Drive original so the folder clears. PDFs are ignored for now (no PDF
// processing yet) and left in place. Always exits 1: the existing local "Inbox" scheduler entry
// does the actual processing (artefacts/todos/archive) — this only ingests + clears Drive.
async function cmdInboxWatch(token) {
  const folderId = await findFolder(token, INBOX_FOLDER_NAME);
  if (!folderId) process.exit(1); // no __inbox__ folder → nothing to do

  // Ignore PDFs until we have a way to read them — leave them sitting in the Drive folder.
  const targets = (await listChildren(token, folderId)).filter((f) => f.mimeType !== "application/pdf");
  if (targets.length === 0) process.exit(1);

  const ingested = [];
  for (const f of targets) {
    const r = await downloadToInbox(token, f);
    if (!r.ok) {
      console.error(`drive inbox-watch: skip "${f.name}" — ${r.skip}`);
      continue;
    }

    try {
      await apiPatch(`${DRIVE}/files/${f.id}`, token, { trashed: true });
      ingested.push(f.name);
    }
    catch (e) {
      // Downloaded but couldn't clear it from Drive (most likely the token still has only
      // drive.readonly — re-run scripts/google-oauth.mjs to grant the full `drive` scope).
      // Roll the local copy back so it isn't processed now and re-downloaded every tick.
      rmSync(r.ok, { force: true });
      console.error(
        `drive inbox-watch: "${f.name}" downloaded but NOT cleared from Drive (${e.message}). ` +
        `Rolled back — grant write access by re-running scripts/google-oauth.mjs, then it retries.`,
      );
    }
  }

  if (ingested.length) {
    console.error(`drive inbox-watch: ingested + cleared ${ingested.length} file(s): ${ingested.join(", ")}`);
  }
  process.exit(1);
}

const clampMax = (v, def = 20, cap = 50) => Math.min(parseInt(v ?? String(def), 10) || def, cap);

const [cmd, ...rest] = process.argv.slice(2);
const token = await accessToken().catch((e) => die(e.message));
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
  case "inbox-list": {
    const folderId = await findFolder(token, INBOX_FOLDER_NAME);
    result = folderId
      ? { folder: INBOX_FOLDER_NAME, files: (await listChildren(token, folderId)).map(simplify) }
      : { folder: INBOX_FOLDER_NAME, note: "folder not found in Drive" };
    break;
  }
  case "inbox-watch":
    await cmdInboxWatch(token); // exits the process itself (poller; never prints a result)
    break;
  default:
    die('unknown command. use: list ["<name>"] [n] | search "<query>" [n] | read <fileId> | inbox-list | inbox-watch');
}
console.log(JSON.stringify(result, null, 2));
