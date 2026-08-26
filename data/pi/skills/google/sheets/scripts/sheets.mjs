#!/usr/bin/env node
// Google Sheets CLI for Core. Read/append/update spreadsheet values + create new sheets, via
// the Sheets v4 API on the shared Google OAuth token. Finds existing sheets by name through
// the Drive API (read-only). No third-party deps (Node built-in fetch).
//
// Commands:
//   node sheets.mjs create "<title>"                       # new spreadsheet → prints id + url
//   node sheets.mjs find ["<name filter>"]                 # list spreadsheets (id, name)
//   node sheets.mjs tabs <id>                               # list tab/sheet titles in a file
//   node sheets.mjs read <id> "<range>"                     # e.g. "Sheet1!A1:D20" or "A:D"
//   node sheets.mjs append <id> "<range>" <cell> [cell ...] # append one row (cells = positional)
//   node sheets.mjs append <id> "<range>" --json '[["a","b"],["c","d"]]'   # append rows
//   node sheets.mjs update <id> "<range>" <cell> [cell ...] | --json '<2D array>'  # overwrite
//
// Values use USER_ENTERED input (numbers/dates/formulas are parsed like typing in the UI).
// Note: cannot DELETE a spreadsheet (that needs Drive write scope) — do that in the Drive UI.
import { accessToken } from "../../_shared/google-auth.mjs";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

function die(msg) {
  console.error(`sheets: ${msg}`);
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

// Build a 2D values array from either --json '<2D>' or positional cells (one row).
function rowsFrom(f, cellsStart) {
  if (f.json && f.json !== true) {
    let v;
    try {
      v = JSON.parse(f.json);
    }
    catch {
      die("--json must be a JSON 2D array, e.g. '[[\"a\",\"b\"]]'");
    }
    if (!Array.isArray(v) || !Array.isArray(v[0])) die("--json must be a 2D array (array of rows)");
    return v;
  }
  const cells = f._.slice(cellsStart);
  if (!cells.length) die("provide cells as positional args or --json '<2D array>'");
  return [cells];
}

const f = parseFlags(process.argv.slice(2));
const cmd = f._[0];
const token = await accessToken().catch((e) => die(e.message));

if (cmd === "create") {
  const title = f._[1];
  if (!title) die('usage: sheets.mjs create "<title>"');
  const j = await api(SHEETS, token, { method: "POST", body: { properties: { title } } });
  console.log(JSON.stringify({ created: j.properties?.title, id: j.spreadsheetId, url: j.spreadsheetUrl }, null, 2));
}
else if (cmd === "find") {
  const filter = f._[1];
  let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  if (filter) q += ` and name contains '${filter.replace(/'/g, "\\'")}'`;
  const url = `${DRIVE}?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime)`;
  const j = await api(url, token);
  console.log(JSON.stringify((j.files ?? []).map((x) => ({ id: x.id, name: x.name, modified: x.modifiedTime })), null, 2));
}
else if (cmd === "tabs") {
  const id = f._[1];
  if (!id) die("usage: sheets.mjs tabs <id>");
  const j = await api(`${SHEETS}/${encodeURIComponent(id)}?fields=properties.title,sheets.properties(title,gridProperties)`, token);
  console.log(JSON.stringify({ title: j.properties?.title, tabs: (j.sheets ?? []).map((s) => s.properties?.title) }, null, 2));
}
else if (cmd === "read") {
  const id = f._[1];
  const range = f._[2];
  if (!id || !range) die('usage: sheets.mjs read <id> "<range>"');
  const j = await api(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, token);
  console.log(JSON.stringify({ range: j.range, values: j.values ?? [] }, null, 2));
}
else if (cmd === "append") {
  const id = f._[1];
  const range = f._[2];
  if (!id || !range) die('usage: sheets.mjs append <id> "<range>" <cell ...> | --json \'<2D array>\'');
  const values = rowsFrom(f, 3);
  const url = `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const j = await api(url, token, { method: "POST", body: { values } });
  console.log(JSON.stringify({ appended: values.length, updatedRange: j.updates?.updatedRange }, null, 2));
}
else if (cmd === "update") {
  const id = f._[1];
  const range = f._[2];
  if (!id || !range) die('usage: sheets.mjs update <id> "<range>" <cell ...> | --json \'<2D array>\'');
  const values = rowsFrom(f, 3);
  const url = `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const j = await api(url, token, { method: "PUT", body: { values } });
  console.log(JSON.stringify({ updatedRange: j.updatedRange, updatedCells: j.updatedCells }, null, 2));
}
else {
  die('commands: create "<title>" | find [name] | tabs <id> | read <id> "<range>" | append <id> "<range>" <cells> | update <id> "<range>" <cells>');
}
