#!/usr/bin/env node
// Google Maps link/map builder for Core. Turns coordinates or place names into:
//   - a plain Google Maps link (one location) — no key needed
//   - a Google Static Maps image URL with pins (one or many, plus an optional highlighted
//     place in a different colour) — needs a Maps Platform API key
// No third-party deps. A location is "lat,lon" or an address/place string (Static Maps geocodes).
//
// Usage:
//   node maps.mjs link "<lat,lon>" | "<place>"
//   node maps.mjs staticmap "<loc>" ["<loc>" ...] [--highlight "<loc>"] [--size 640x480]

import { readFileSync } from "node:fs";

function die(m) { console.error(`maps: ${m}`); process.exit(1); }
function flag(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

// Maps Platform key (separate from the Workspace OAuth token — Static Maps doesn't use OAuth).
function mapsKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY.trim();
  try { return readFileSync("/app/secrets/google_maps_api_key", "utf8").trim() || null; } catch { return null; }
}
const loc = (s) => encodeURIComponent(s.trim().replace(/\s*,\s*/g, ",")); // normalize "lat , lon"

const cmd = process.argv[2];

if (cmd === "link") {
  const where = process.argv[3];
  if (!where) die('usage: maps.mjs link "<lat,lon>" | "<place>"');
  // ?q= takes coordinates ("50.74,7.08" → exact pin) or a place/address ("Bonn Hbf").
  console.log(`https://www.google.com/maps?q=${loc(where)}`);
} else if (cmd === "staticmap") {
  const key = mapsKey();
  if (!key)
    die("no Google Maps key — add it to /app/secrets/google_maps_api_key (enable 'Maps Static API' in your Google Cloud project, create an API key restricted to it).");
  const points = [];
  let highlight = null;
  for (let i = 3; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--highlight") { highlight = process.argv[++i]; continue; }
    if (a === "--size") { i++; continue; } // consumed via flag()
    if (a.startsWith("--")) continue;
    points.push(a);
  }
  if (!points.length && !highlight) die('usage: maps.mjs staticmap "<loc>" ["<loc>" ...] [--highlight "<loc>"]');

  const params = [`size=${flag("size", "640x480")}`, "scale=2"];
  if (highlight) params.push(`markers=color:blue%7C${loc(highlight)}`); // the referenced place, distinct colour
  if (points.length) params.push(`markers=color:red%7C${points.slice(0, 15).map(loc).join("%7C")}`);
  params.push(`key=${key}`);
  console.log("https://maps.googleapis.com/maps/api/staticmap?" + params.join("&"));
} else {
  die('commands: link "<lat,lon>|<place>"  |  staticmap "<loc>" [...] [--highlight "<loc>"] [--size WxH]');
}
