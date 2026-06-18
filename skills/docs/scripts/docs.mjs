#!/usr/bin/env node
// Google Docs CLI for Core. Create a doc, read its text, or append text — via the Docs v1 API
// on the shared Google OAuth token. Finds existing docs by name through the Drive API
// (read-only). No third-party deps (Node built-in fetch).
//
// Commands:
//   node docs.mjs create "<title>" [--text "initial body"]   # new doc → prints id + url
//   node docs.mjs find ["<name filter>"]                      # list docs (id, name)
//   node docs.mjs read <id>                                    # plain text of the document
//   node docs.mjs append <id> "<text>"                         # add text at the end
//
// Note: cannot DELETE a doc (that needs Drive write scope) — do that in the Drive UI.
import { accessToken } from "../../_shared/google-auth.mjs";
const DOCS = "https://docs.googleapis.com/v1/documents";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

function die(msg) {
  console.error(`docs: ${msg}`);
  process.exit(1);
}

async function api(url, token, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) die(`API failed: ${res.status} ${JSON.stringify(j)}`);
  return j;
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else out[a.slice(2)] = args[++i];
    }
    else out._.push(a);
  }
  return out;
}

function extractText(doc) {
  let out = "";
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) {
      if (pe.textRun?.content) out += pe.textRun.content;
    }
  }
  return out;
}

async function appendText(token, id, text) {
  // Insert at the end of the body. Ensure a leading newline if the doc already has content.
  await api(`${DOCS}/${encodeURIComponent(id)}:batchUpdate`, token, {
    method: "POST",
    body: { requests: [{ insertText: { endOfSegmentLocation: {}, text } }] },
  });
}

const f = parseFlags(process.argv.slice(2));
const cmd = f._[0];
const token = await accessToken().catch((e) => die(e.message));

if (cmd === "create") {
  const title = f._[1];
  if (!title) die('usage: docs.mjs create "<title>" [--text "..."]');
  const doc = await api(DOCS, token, { method: "POST", body: { title } });
  const id = doc.documentId;
  if (f.text && f.text !== true) await appendText(token, id, f.text);
  console.log(JSON.stringify({ created: title, id, url: `https://docs.google.com/document/d/${id}/edit` }, null, 2));
}
else if (cmd === "find") {
  const filter = f._[1];
  let q = "mimeType='application/vnd.google-apps.document' and trashed=false";
  if (filter) q += ` and name contains '${filter.replace(/'/g, "\\'")}'`;
  const url = `${DRIVE}?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime)`;
  const j = await api(url, token);
  console.log(JSON.stringify((j.files ?? []).map((x) => ({ id: x.id, name: x.name, modified: x.modifiedTime })), null, 2));
}
else if (cmd === "read") {
  const id = f._[1];
  if (!id) die("usage: docs.mjs read <id>");
  const doc = await api(`${DOCS}/${encodeURIComponent(id)}`, token);
  console.log(JSON.stringify({ title: doc.title, text: extractText(doc) }, null, 2));
}
else if (cmd === "append") {
  const id = f._[1];
  const text = f._[2];
  if (!id || !text) die('usage: docs.mjs append <id> "<text>"');
  await appendText(token, id, text);
  console.log(JSON.stringify({ appended: text.length, id }, null, 2));
}
else {
  die('commands: create "<title>" [--text ..] | find [name] | read <id> | append <id> "<text>"');
}
