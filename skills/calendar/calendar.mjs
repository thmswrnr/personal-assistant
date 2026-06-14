#!/usr/bin/env node
// Read-only Google Calendar CLI for Core. Uses the official Calendar v3 API with
// the shared Google OAuth refresh token. No third-party deps (Node built-in fetch).
//
// Commands:
//   node calendar.mjs list                       # the user's calendars
//   node calendar.mjs agenda [days]              # upcoming events, next N days (default 7)
//   node calendar.mjs today                      # events for the rest of today
//   node calendar.mjs search "<query>" [days]    # matching events in the next N days
//
// All commands use the "primary" calendar unless --calendar <id> is given.
// Times are returned as ISO strings in the event's own timezone.
import { readFileSync, existsSync } from "node:fs";

const OAUTH_FILE = process.env.GOOGLE_OAUTH_FILE
  ?? (existsSync("/app/secrets/google_oauth.json")
    ? "/app/secrets/google_oauth.json"
    : "/app/secrets/gmail_oauth.json");
const CAL = "https://www.googleapis.com/calendar/v3";

function die(msg) {
  console.error(`calendar: ${msg}`);
  process.exit(1);
}

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(readFileSync(OAUTH_FILE, "utf8"));
  } catch {
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

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) out[args[i].slice(2)] = args[++i] ?? "";
    else out._.push(args[i]);
  }
  return out;
}

const simplifyEvent = (e) => ({
  summary: e.summary ?? "(no title)",
  start: e.start?.dateTime ?? e.start?.date,
  end: e.end?.dateTime ?? e.end?.date,
  allDay: !!e.start?.date,
  location: e.location,
  link: e.htmlLink,
});

async function listEvents(token, calendarId, timeMin, timeMax, query) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "25",
    fields: "items(summary,location,start,end,htmlLink,status)",
  });
  if (query) params.set("q", query);
  const j = await apiJson(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, token);
  return (j.items ?? []).filter((e) => e.status !== "cancelled").map(simplifyEvent);
}

async function cmdCalendars(token) {
  const j = await apiJson(`${CAL}/users/me/calendarList?fields=items(id,summary,primary,timeZone)`, token);
  return (j.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    timeZone: c.timeZone,
  }));
}

async function cmdAgenda(token, calendarId, days) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 86400000).toISOString();
  return { window: { from: timeMin, to: timeMax, days }, events: await listEvents(token, calendarId, timeMin, timeMax) };
}

async function cmdToday(token, calendarId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  // From "now" (not midnight) so it shows what's still to come today, but no later than tonight.
  const timeMin = new Date().toISOString();
  return { window: { from: timeMin, to: end.toISOString() }, events: await listEvents(token, calendarId, timeMin, end.toISOString()) };
}

async function cmdSearch(token, calendarId, query, days) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 86400000).toISOString();
  return { query, window: { from: timeMin, to: timeMax, days }, events: await listEvents(token, calendarId, timeMin, timeMax, query) };
}

const f = parseFlags(process.argv.slice(2));
const cmd = f._[0];
const calendarId = f.calendar || "primary";
const token = await accessToken();
let result;
switch (cmd) {
  case "list":
    result = await cmdCalendars(token);
    break;
  case "agenda":
    result = await cmdAgenda(token, calendarId, Math.min(parseInt(f._[1] ?? "7", 10) || 7, 60));
    break;
  case "today":
    result = await cmdToday(token, calendarId);
    break;
  case "search": {
    if (!f._[1]) die('usage: calendar.mjs search "<query>" [days]');
    result = await cmdSearch(token, calendarId, f._[1], Math.min(parseInt(f._[2] ?? "30", 10) || 30, 60));
    break;
  }
  default:
    die('unknown command. use: list | agenda [days] | today | search "<query>" [days]  (optional --calendar <id>)');
}
console.log(JSON.stringify(result, null, 2));
