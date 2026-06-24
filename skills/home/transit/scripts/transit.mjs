#!/usr/bin/env node
// Deutsche Bahn / public-transit CLI for Core. Uses the free transport.rest DB API
// (v6.db.transport.rest) — no API key, no auth. Covers DB long-distance + regional + local
// transit across Germany. No third-party deps (Node built-in fetch).
// Times are Europe/Berlin local; delays are reported in minutes.
//
// Usage:
//   node transit.mjs find "<query>"                                      # resolve station -> id(s)
//   node transit.mjs journeys "<from>" "<to>" [--when "2026-06-16T08:00"] [--results N]
//   node transit.mjs departures "<station>" [--duration MIN] [--results N]

const BASE = "https://v6.db.transport.rest";
const UA = "core-personal-assistant (local, non-commercial)";

function die(msg) {
  console.error(`transit: ${msg}`);
  process.exit(1);
}

function flag(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function getJson(path, params) {
  const url = `${BASE}${path}?` + new URLSearchParams(params);
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  }
  catch (e) {
    die(`network error reaching the transit service: ${e.message}`);
  }
  if (res.status === 503)
    die("the DB transit service (transport.rest) is temporarily unavailable (503) — try again in a bit.");
  if (!res.ok) die(`request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    })
    : null;
const mins = (sec) => (sec == null ? null : Math.round(sec / 60));

async function resolveStop(query) {
  const list = await getJson("/locations", { query, results: "5" });
  const stop = list.find((x) => x.type === "stop" || x.type === "station") ?? list[0];
  if (!stop || !stop.id) die(`no station found for "${query}"`);
  return stop;
}

const cmd = process.argv[2];

if (cmd === "find") {
  const q = process.argv[3];
  if (!q) die('usage: transit.mjs find "<query>"');
  const list = await getJson("/locations", { query: q, results: "6" });
  console.log(
    JSON.stringify(list.map((s) => ({ id: s.id, name: s.name, type: s.type })), null, 2),
  );
}
else if (cmd === "journeys") {
  const fromQ = process.argv[3];
  const toQ = process.argv[4];
  if (!fromQ || !toQ)
    die('usage: transit.mjs journeys "<from>" "<to>" [--when ISO] [--results N]');
  const from = await resolveStop(fromQ);
  const to = await resolveStop(toQ);
  const params = { from: from.id, to: to.id, results: flag("results", "4"), stopovers: "false" };
  const when = flag("when");
  if (when) params.departure = when;
  const data = await getJson("/journeys", params);
  const out = {
    from: from.name,
    to: to.name,
    journeys: (data.journeys || []).map((j) => {
      const legs = j.legs || [];
      const ride = legs.filter((l) => !l.walking);
      const first = legs[0] ?? {};
      const last = legs[legs.length - 1] ?? {};
      return {
        departure: fmtTime(first.departure || first.plannedDeparture),
        departureDelayMin: mins(first.departureDelay),
        departurePlatform: first.departurePlatform ?? first.plannedDeparturePlatform ?? null,
        arrival: fmtTime(last.arrival || last.plannedArrival),
        arrivalDelayMin: mins(last.arrivalDelay),
        changes: Math.max(ride.length - 1, 0),
        lines: ride.map((l) => l.line?.name).filter(Boolean),
        legs: legs.map((l) =>
          l.walking
            ? { walk: true, from: l.origin?.name, to: l.destination?.name }
            : {
              line: l.line?.name,
              from: l.origin?.name,
              dep: fmtTime(l.departure || l.plannedDeparture),
              to: l.destination?.name,
              arr: fmtTime(l.arrival || l.plannedArrival),
            },
        ),
      };
    }),
  };
  console.log(JSON.stringify(out, null, 2));
}
else if (cmd === "departures") {
  const q = process.argv[3];
  if (!q) die('usage: transit.mjs departures "<station>" [--duration MIN] [--results N]');
  const stop = await resolveStop(q);
  const data = await getJson(`/stops/${encodeURIComponent(stop.id)}/departures`, {
    duration: flag("duration", "60"),
    results: flag("results", "8"),
  });
  const arr = Array.isArray(data) ? data : data.departures || [];
  const out = {
    station: stop.name,
    departures: arr.map((d) => ({
      line: d.line?.name,
      direction: d.direction,
      when: fmtTime(d.when || d.plannedWhen),
      delayMin: mins(d.delay),
      platform: d.platform ?? d.plannedPlatform ?? null,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}
else {
  die(
    'commands: find "<q>" | journeys "<from>" "<to>" [--when ISO] [--results N] | departures "<station>" [--duration MIN] [--results N]',
  );
}
