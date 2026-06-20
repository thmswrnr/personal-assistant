#!/usr/bin/env node
// Read-only Gmail CLI for Core. Uses the official Gmail REST API with a stored
// OAuth refresh token. No third-party deps (Node built-in fetch), no send/modify.
//
// Commands:
//   node gmail.mjs labels
//   node gmail.mjs search "<gmail query>" [maxResults]
//   node gmail.mjs read <messageId>
//   node gmail.mjs watch                 (scheduler poller — see cmdWatch)
//
// Auth: reads the refresh token from $GOOGLE_OAUTH_FILE (default
// /app/secrets/google_oauth.json), mints a short-lived access token, and calls
// the API. The token never appears in the agent's context.
import { accessToken } from "../../_shared/google-auth.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Cursor-based watch state lives on the writable storage volume (survives restarts).
const STATE_DIR = process.env.GMAIL_STATE_DIR ?? "/app/storage/state";
const WATCH_FILE = `${STATE_DIR}/gmail-watch.json`;
const PENDING_FILE = `${STATE_DIR}/gmail-pending.json`;
// This account doesn't use Gmail's category tabs, so `category:primary` matches nothing.
// Plain unread-inbox is the right "new mail" signal here.
const WATCH_QUERY = "is:unread in:inbox";

function die(msg) {
  console.error(`gmail: ${msg}`);
  process.exit(1);
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
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    // A flag with no following value (end of args, or another --flag next) is a boolean.
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    }
    else {
      out[key] = next;
      i++;
    }
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

// Dispatch an EXISTING draft by id (created via `draft`). Requires the gmail.send scope.
// This is the ONLY send path: the model can't send free-form text in one shot — the user
// reviews the draft first and explicitly approves it, then we send THAT draft id.
async function cmdSend(token, draftId) {
  const res = await fetch(`${API}/drafts/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) die(`send failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { sent: draftId, messageId: j.id, threadId: j.threadId };
}

// Change a message's labels — mark read/unread, archive, star, or raw label ids. Requires
// the gmail.modify scope. Run ONLY when the user explicitly asks (the watcher never does).
async function cmdModify(token, id, f) {
  const add = [];
  const remove = [];
  if (f.read) remove.push("UNREAD");
  if (f.unread) add.push("UNREAD");
  if (f.archive) remove.push("INBOX");
  if (f.star) add.push("STARRED");
  if (f.unstar) remove.push("STARRED");
  if (f.add) add.push(f.add);
  if (f.remove) remove.push(f.remove);
  if (add.length === 0 && remove.length === 0) {
    die("modify: nothing to do — use --read/--unread/--archive/--star/--unstar/--add <LABEL>/--remove <LABEL>");
  }
  const res = await fetch(`${API}/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
  if (!res.ok) die(`modify failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { modified: id, labelIds: j.labelIds ?? [], added: add, removed: remove };
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

// Non-interactive poller for the scheduler's `watch` gate (NOT for chat use). Read-only
// against Gmail, cursor-based, edge-triggered. The scheduler runs this as a plain shell
// command and cares only about the exit code:
//   exit 0  → new unread-Primary mail appeared; the new messages are staged to
//             PENDING_FILE and the scheduler fires the Core run that summarizes them.
//   exit 1  → nothing new (or first-run priming, or an error) → no Core run.
// Cursor = the set of unread-Primary ids already announced. Read messages drop out of the
// query on their own, so the set stays bounded and self-pruning.
async function cmdWatch(token) {
  mkdirSync(STATE_DIR, { recursive: true });

  const list = await api(`/messages?q=${encodeURIComponent(WATCH_QUERY)}&maxResults=25`, token);
  const currentIds = (list.messages ?? []).map((m) => m.id);

  let seenIds;
  try {
    seenIds = JSON.parse(readFileSync(WATCH_FILE, "utf8")).seenIds ?? [];
  }
  catch {
    // First run ever (no cursor file): prime silently so we don't announce the whole
    // existing unread backlog. Record what's there now and don't fire.
    writeFileSync(WATCH_FILE, JSON.stringify({ seenIds: currentIds }, null, 2));
    process.exit(1);
  }

  const seen = new Set(seenIds);
  const newIds = currentIds.filter((id) => !seen.has(id));

  // Advance the cursor to the current unread set every run, regardless of outcome.
  writeFileSync(WATCH_FILE, JSON.stringify({ seenIds: currentIds }, null, 2));

  if (newIds.length === 0) process.exit(1);

  // Fetch lightweight metadata for the new messages only and stage them for the prompt.
  const messages = await Promise.all(
    newIds.map(async (id) => {
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
  writeFileSync(PENDING_FILE, JSON.stringify(messages, null, 2));
  process.exit(0);
}

const [cmd, ...rest] = process.argv.slice(2);
const token = await accessToken().catch((e) => die(e.message));
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
  case "send": {
    const draftId = rest[0];
    if (!draftId || draftId.startsWith("--")) die("usage: gmail.mjs send <draftId>  (only after the user has reviewed and approved that draft)");
    result = await cmdSend(token, draftId);
    break;
  }
  case "modify": {
    const id = rest[0];
    if (!id || id.startsWith("--")) die("usage: gmail.mjs modify <messageId> [--read|--unread|--archive|--star|--unstar|--add <LABEL>|--remove <LABEL>]");
    result = await cmdModify(token, id, parseFlags(rest.slice(1)));
    break;
  }
  case "watch":
    // Exits with its own code (0 = fire, 1 = don't); never reaches the JSON print below.
    await cmdWatch(token);
    break;
  default:
    die('unknown command. use: labels | search "<query>" [n] | read <id> | draft --to <a> --subject <s> --body <t> | send <draftId> | modify <id> [--read|--archive|…] | watch');
}
console.log(JSON.stringify(result, null, 2));
