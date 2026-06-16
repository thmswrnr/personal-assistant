---
name: google-maps
description: Turn coordinates or a place into a Google Maps link or a map image with pins. Use to SHOW the user where something is — a single place ("show it on a map", "where is X"), or several places at once on one map (e.g. visualizing results from the `overpass` skill), optionally highlighting a referenced place like the user's home in a different colour.
metadata:
  { "core": { "requires": { "bins": ["node"] } } }
---

# Google Maps

Builds Google Maps links/images so the user can *see* a location. It doesn't find places — pair
it with a skill that returns coordinates (e.g. `overpass` for "what's nearby"), then pass those
coordinates here. A location is either `"lat,lon"` or a place/address string.

```bash
M="node /app/.pi/skills/google-maps/maps.mjs"

# One place → a plain Google Maps link (no API key needed)
$M link "50.7320,7.0968"
$M link "Bonn Hauptbahnhof"

# Several places on ONE map image, with a referenced place highlighted (needs the Maps key)
$M staticmap "50.7508,7.0762" "50.7363,7.0974" "50.7466,7.0997" --highlight "Londoner Straße 4, Bonn"
```

## When to use what
- **One location / "the closest X"** → `link` — a Google Maps pin at that exact spot. No key
  needed. Give the user the link.
- **Several locations to compare / "what's around"** → `staticmap` — one Google map **image**
  showing all the points as red pins, with `--highlight` drawing the referenced place (the user's
  home, the station they asked from, …) as a **blue** pin. Give the user this link (it opens/embeds
  as the map image). Combine with the overview list from whatever skill produced the points.
- **Don't make a map for non-spatial answers** — "how far", "how many", "which is closest" are
  better as a sentence. Only visualize when *seeing the location* helps.

## Notes
- `staticmap` needs a **Google Maps Platform** API key (this is *not* the Workspace OAuth token —
  Static Maps uses its own key). Put it in `/app/secrets/google_maps_api_key`. If it's missing,
  `staticmap` says so — fall back to `link` (per place) and the text list. `link` always works.
- Pass coordinates straight from `overpass` results (`lat`/`lon`); `staticmap` caps at 15 pins.
- Paste the resulting URL to the user **verbatim** — don't reformat, wrap, or shorten it.
