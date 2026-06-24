---
name: transit
description: Look up German public-transport / Deutsche Bahn connections — train & transit journeys between two places, next departures from a station, and live delays/platforms. Use when the user asks "next train to X", "how do I get from A to B by train/transit", "when's the next departure from <station>", "is my train delayed". Covers DB long-distance + regional + local transit across Germany.
metadata:
  { "core": { "requires": { "bins": ["node"] } } }
---

# Transit (Deutsche Bahn & public transport)

Look up connections via the free **transport.rest** DB API (no key, no auth). Times are
Europe/Berlin local; delays are in minutes (`0`/null ≈ on time).

Run the CLI with `node`:
```bash
# Connections A -> B (next few, from now)
node /app/.pi/skills/home/transit/scripts/transit.mjs journeys "Bonn Hbf" "Köln Hbf"

# ... departing at a specific time
node /app/.pi/skills/home/transit/scripts/transit.mjs journeys "Bonn" "Frankfurt(Main)Hbf" --when "2026-06-16T08:00"

# Next departures from a station (board)
node /app/.pi/skills/home/transit/scripts/transit.mjs departures "Bonn Hbf"

# Just resolve a station name to candidates (journeys/departures already do this for you)
node /app/.pi/skills/home/transit/scripts/transit.mjs find "Bonn"
```

## Reading the output (JSON)
- **`journeys[]`** — each has `departure`/`arrival` (local time), `departureDelayMin` /
  `arrivalDelayMin`, `departurePlatform`, `changes` (number of transfers), `lines`
  (e.g. `["ICE 512","RB 26"]`), and `legs` (per-segment detail, incl. `walk` transfers).
- **`departures[]`** — `line`, `direction`, `when`, `delayMin`, `platform`.

## How to answer
- Lead with what they asked: the next good connection (dep → arr, duration, changes, line,
  platform) or the specific delay — not the raw list. Summarize the best 2–3 options.
- Call out delays and platform clearly ("ICE 512, 09:14 +5 min, platform 1").
- Station names can be loose ("Bonn", "Köln Hbf", "Frankfurt Flughafen") — the CLI resolves
  them. If a name looks ambiguous or wrong, run `find` to show candidates and pick/ask.
- If the CLI says the service is temporarily unavailable (503), say so plainly and suggest
  trying again shortly — **never invent times or delays**.
