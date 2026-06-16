---
name: overpass
description: Find places/amenities/POIs near a location from OpenStreetMap — "pharmacies near X", "is there an ATM around here", "supermarkets close to <address>", "playgrounds nearby", opening hours of nearby shops. Free Overpass API, no key. For directions/ETA between two points use a maps skill; this is "what's around a point".
metadata:
  { "core": { "requires": { "bins": ["node"] } } }
---

# Overpass (what's nearby, from OpenStreetMap)

Finds amenities/POIs around a place using the free **Overpass API** (no key). The helper geocodes
the place (Nominatim) and builds a small, bounded query for you — **you do not write Overpass
QL**; just pass a plain amenity word and a place.

```bash
O="node /app/.pi/skills/overpass/overpass.mjs"

$O near "pharmacy" "Bonn Hauptbahnhof"              # POIs around a place name
$O near "atm" "Friedensplatz, Bonn" --radius 500    # tighter radius (metres)
$O near "supermarket" --lat 50.737 --lon 7.098      # around explicit coordinates
$O near "amenity=cafe" "Köln Dom" --limit 8         # raw OSM key=value also works
$O presets                                           # list the amenity words it knows
```

## Usage notes
- **`near "<amenity>" "<place>"`** is the main command. `<place>` is geocoded automatically;
  or give `--lat`/`--lon` directly (e.g. reuse the user's known city/location).
- **`<amenity>`** is a plain word — `pharmacy, atm, bank, supermarket, bakery, restaurant, cafe,
  fuel, hospital, doctor, parking, toilets, playground, park, hotel, post, …` (German aliases
  like `apotheke`, `tankstelle`, `supermarkt`, `spielplatz` work too; run `presets` for the
  list). For anything not in the list, pass a raw OSM filter like `"shop=butcher"` or
  `"amenity=cafe"`.
- **`--radius`** metres (default 1500, max 10000) · **`--limit`** results (default 15, max 50).
  Keep the radius modest — it's faster and kinder to the public API.
- Output is JSON: the resolved `center`, a **`mapAll`** link, then `results` sorted **nearest
  first**, each with `name`, `kind`, `distanceMeters`, `address`, `opening_hours`, `phone`,
  `website`, coords, a per-pin **`map`** link, and the `osm` id.
- **Always give the user the single `mapAll` link** — it opens Google Maps showing *all* the
  nearby matches as pins on one map (that's usually what they want). Then summarize the top few in
  text (name, distance, hours). Add an individual result's `map` link only if they ask about one
  specific place. Paste the links **verbatim** (they're plain, no query string — don't reformat
  or wrap them).

## Good to know
- Data is community OpenStreetMap — usually good in cities, but `opening_hours`/`phone` may be
  missing or stale; say so rather than implying it's authoritative.
- Some POIs have no `name` (it'll be `null`) — describe them by `kind`/address.
- If it reports **429/504**, the public Overpass instance is busy — wait a moment, or try a
  smaller radius, then retry. A bad place name returns a clear "couldn't find a place" error.
