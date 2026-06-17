#!/usr/bin/env node
// Google Calendar CLI for Core. Uses the official Calendar v3 API with the shared Google
// OAuth refresh token. No third-party deps (Node built-in fetch).
//
// Read:
//   node calendar.mjs list                       # the user's calendars
//   node calendar.mjs agenda [days]              # upcoming events, next N days (default 7)
//   node calendar.mjs today                      # events for the rest of today
//   node calendar.mjs search "<query>" [days]    # matching events in the next N days
// Write (confirm with the user first):
//   node calendar.mjs add "<title>" --start <when> [--end <when>] [--location ..] [--desc ..] [--tz <zone>]
//   node calendar.mjs edit <eventId> [--title ..] [--start ..] [--end ..] [--location ..] [--desc ..]
//   node calendar.mjs rm <eventId>
//
// <when> = "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:MM" (timed; default tz Europe/Berlin).
// list/agenda/today/search return each event's `id` (use it for edit/rm).
// All commands use the "primary" calendar unless --calendar <id> is given.
import { readFileSync } from "node:fs";

const OAUTH_FILE = process.env.GOOGLE_OAUTH_FILE ?? "/app/secrets/google_oauth.json";
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

async function apiSend(url, token, method, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {}; // DELETE
  const j = await res.json().catch(() => ({}));
  if (!res.ok) die(`API failed: ${res.status} ${JSON.stringify(j)}`);
  return j;
}

const TZ = "Europe/Berlin";
// "YYYY-MM-DD" → all-day; "YYYY-MM-DDTHH:MM[:SS]" → timed in tz. The counterpart field is
// explicitly nulled so a PATCH that switches timed↔all-day clears the old value (Calendar
// PATCH merges nested fields, so a leftover date+dateTime is rejected as "Invalid start time").
function eventTime(s, tz) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, dateTime: null, timeZone: null };
  let dt = s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) dt += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dt)) die(`bad time "${s}" — use YYYY-MM-DD or YYYY-MM-DDTHH:MM`);
  return { dateTime: dt, timeZone: tz, date: null };
}
const addDay = (d) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) out[args[i].slice(2)] = args[++i] ?? "";
    else out._.push(args[i]);
  }
  return out;
}

const simplifyEvent = (e) => ({
  id: e.id,
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
    fields: "items(id,summary,location,start,end,htmlLink,status)",
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

async function cmdAdd(token, calendarId, f) {
  const summary = f._[1];
  if (!summary) die('usage: calendar.mjs add "<title>" --start <when> [--end <when>] [--location ..] [--desc ..] [--tz <zone>]');
  if (!f.start) die("add requires --start (YYYY-MM-DD for all-day, or YYYY-MM-DDTHH:MM)");
  const tz = f.tz || TZ;
  const start = eventTime(f.start, tz);
  let end;
  if (f.end) end = eventTime(f.end, tz);
  else if (start.date) end = { date: addDay(start.date) }; // all-day → 1 day
  else {
    const base = new Date(`${start.dateTime}Z`); // arithmetic only; tz reattached below
    base.setUTCHours(base.getUTCHours() + 1);
    end = { dateTime: base.toISOString().slice(0, 19), timeZone: tz }; // default +1h
  }
  const body = { summary, start, end };
  if (f.location) body.location = f.location;
  if (f.desc) body.description = f.desc;
  const e = await apiSend(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, token, "POST", body);
  return { created: simplifyEvent(e) };
}

async function cmdEdit(token, calendarId, f) {
  const id = f._[1];
  if (!id) die("usage: calendar.mjs edit <eventId> [--title ..] [--start ..] [--end ..] [--location ..] [--desc ..]");
  const tz = f.tz || TZ;
  const body = {};
  if (f.title) body.summary = f.title;
  if (f.start) {
    body.start = eventTime(f.start, tz);
    // switching to all-day without a new end → give it a matching 1-day all-day end,
    // else Google 400s on a date-start + dateTime-end mismatch.
    if (body.start.date && !f.end) body.end = eventTime(addDay(body.start.date), tz);
  }
  if (f.end) body.end = eventTime(f.end, tz);
  if (f.location) body.location = f.location;
  if (f.desc) body.description = f.desc;
  if (Object.keys(body).length === 0) die("edit needs at least one field to change (--title/--start/--end/--location/--desc)");
  const e = await apiSend(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, token, "PATCH", body);
  return { updated: simplifyEvent(e) };
}

async function cmdDelete(token, calendarId, f) {
  const id = f._[1];
  if (!id) die("usage: calendar.mjs rm <eventId>");
  await apiSend(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, token, "DELETE");
  return { deleted: id };
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
  case "add":
    result = await cmdAdd(token, calendarId, f);
    break;
  case "edit":
    result = await cmdEdit(token, calendarId, f);
    break;
  case "rm":
    result = await cmdDelete(token, calendarId, f);
    break;
  default:
    die('unknown command. use: list | agenda [days] | today | search "<query>" [days] | add | edit | rm  (optional --calendar <id>)');
}
console.log(JSON.stringify(result, null, 2));
