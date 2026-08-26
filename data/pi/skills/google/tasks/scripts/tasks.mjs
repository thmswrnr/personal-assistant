#!/usr/bin/env node
// Google Tasks CLI for Core — a generic multi-list task manager. Backed by Google Tasks, so it
// syncs with the Google Tasks app and the Gmail/Calendar side panel. Uses the Tasks v1 API with
// the shared Google OAuth refresh token. No third-party deps (Node built-in fetch). It knows
// nothing about which lists the user keeps — discover them with `lists`; create one with
// `new-list`.
//
// Commands:
//   node tasks.mjs list [--all] [--list "<name>"]            # open tasks, numbered (--all: incl. done)
//   node tasks.mjs add "<title>" [more titles…] [--due YYYY-MM-DD] [--notes "..."] [--list "<name>"]
//   node tasks.mjs done <n|id> [--list "<name>"]             # complete a task
//   node tasks.mjs rm   <n|id> [--list "<name>"]             # delete a task
//   node tasks.mjs lists                                     # show all task lists
//   node tasks.mjs new-list "<title>"                        # create a new task list
//
// <n> is the number shown by `list`. Targets the default list unless --list is given.
// `add` accepts several titles in one call (bulk import) — they keep their given order.
import { accessToken } from "../../_shared/google-auth.mjs";
const API = "https://tasks.googleapis.com/tasks/v1";

function die(msg) {
  console.error(`todos: ${msg}`);
  process.exit(1);
}

async function api(path, token, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {}; // DELETE returns no body
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
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true; // boolean flag
      else out[a.slice(2)] = args[++i];
    }
    else out._.push(a);
  }
  return out;
}

const dateOnly = (due) => (due ? due.slice(0, 10) : null);

async function resolveList(token, name) {
  if (!name || name === true) return "@default";
  const j = await api("/users/@me/lists", token);
  const want = String(name).toLowerCase();
  const hit = (j.items ?? []).find((l) => l.title.toLowerCase().includes(want));
  if (!hit) die(`no task list matching "${name}" (try: tasks.mjs lists)`);
  return hit.id;
}

async function openTasks(token, listId) {
  const j = await api(
    `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false&maxResults=100`,
    token,
  );
  return (j.items ?? []).filter((t) => t.status !== "completed");
}

async function resolveTaskId(token, listId, ref) {
  if (!/^\d+$/.test(ref)) return ref; // already a task id
  const tasks = await openTasks(token, listId);
  const idx = parseInt(ref, 10) - 1;
  if (idx < 0 || idx >= tasks.length) die(`no open task #${ref} (run: tasks.mjs list)`);
  return tasks[idx].id;
}

const f = parseFlags(process.argv.slice(2));
const cmd = f._[0] ?? "list";
const token = await accessToken().catch((e) => die(e.message));

if (cmd === "lists") {
  const j = await api("/users/@me/lists", token);
  console.log(JSON.stringify((j.items ?? []).map((l) => ({ id: l.id, title: l.title })), null, 2));
}
else if (cmd === "list") {
  const listId = await resolveList(token, f.list);
  const all = !!f.all;
  const path =
    `/lists/${encodeURIComponent(listId)}/tasks?maxResults=100` +
    (all ? "&showCompleted=true&showHidden=true" : "&showCompleted=false");
  const items = (await api(path, token)).items ?? [];
  const open = items.filter((t) => t.status !== "completed");
  const result = {
    list: f.list && f.list !== true ? f.list : "default",
    open: open.map((t, i) => ({ n: i + 1, title: t.title, due: dateOnly(t.due), notes: t.notes || undefined })),
  };
  if (all)
    result.completed = items
      .filter((t) => t.status === "completed")
      .map((t) => ({ title: t.title, completed: dateOnly(t.completed) }));
  console.log(JSON.stringify(result, null, 2));
}
else if (cmd === "add") {
  const titles = f._.slice(1);
  if (!titles.length) die('usage: tasks.mjs add "<title>" [more titles…] [--due YYYY-MM-DD] [--notes "..."] [--list "<name>"]');
  const listId = await resolveList(token, f.list);
  const base = {};
  if (f.notes && f.notes !== true) base.notes = f.notes;
  if (f.due && f.due !== true) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.due)) die("--due must be YYYY-MM-DD");
    base.due = `${f.due}T00:00:00.000Z`;
  }
  // Google inserts each new task at the TOP of the list, so add the titles in reverse to keep
  // the given order top-to-bottom (important when importing an ordered list).
  const added = [];
  for (const title of titles.slice().reverse()) {
    const t = await api(`/lists/${encodeURIComponent(listId)}/tasks`, token, { method: "POST", body: { title, ...base } });
    added.unshift({ added: t.title, due: dateOnly(t.due), id: t.id });
  }
  console.log(JSON.stringify(added.length === 1 ? added[0] : added, null, 2));
}
else if (cmd === "done") {
  const ref = f._[1];
  if (!ref) die("usage: tasks.mjs done <n|id> [--list \"<name>\"]");
  const listId = await resolveList(token, f.list);
  const id = await resolveTaskId(token, listId, ref);
  const t = await api(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: { status: "completed" },
  });
  console.log(JSON.stringify({ completed: t.title }, null, 2));
}
else if (cmd === "rm") {
  const ref = f._[1];
  if (!ref) die("usage: tasks.mjs rm <n|id> [--list \"<name>\"]");
  const listId = await resolveList(token, f.list);
  const id = await resolveTaskId(token, listId, ref);
  await api(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, token, { method: "DELETE" });
  console.log(JSON.stringify({ removed: id }, null, 2));
}
else if (cmd === "new-list") {
  const title = f._[1];
  if (!title) die('usage: tasks.mjs new-list "<title>"');
  const j = await api("/users/@me/lists", token, { method: "POST", body: { title } });
  console.log(JSON.stringify({ created: j.title, id: j.id }, null, 2));
}
else {
  die('commands: list [--all] | add "<title>" [more…] [--due YYYY-MM-DD] [--notes ..] | done <n> | rm <n> | lists | new-list "<title>"   (optional --list "<name>")');
}
