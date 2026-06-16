#!/usr/bin/env node
// OpenStreetMap "what's nearby" CLI for Core. Geocodes a place via Nominatim, then queries the
// free Overpass API (no key, no auth) for POIs/amenities around that point. No third-party deps.
//
// The model should NOT write Overpass QL — it passes a plain amenity word (or a raw key=value)
// and a place; this builds a small, bounded `around` query for it.
//
// Usage:
//   node overpass.mjs near "<amenity>" "<place>" [--radius M] [--limit N]
//   node overpass.mjs near "<amenity>" --lat <lat> --lon <lon> [--radius M] [--limit N]
//   node overpass.mjs presets                      # list the known amenity words
//
//   <amenity>: a preset word ("pharmacy", "atm", "supermarket", "playground", …),
//              or a raw OSM filter "key=value" (e.g. "amenity=cafe", "shop=bakery").

const OVERPASS = "https://overpass-api.de/api/interpreter";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "core-personal-assistant (local, non-commercial)";

function die(msg) {
  console.error(`overpass: ${msg}`);
  process.exit(1);
}
function flag(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

// Friendly word -> one or more OSM "key=value" tag filters (the query unions them).
const PRESETS = {
  pharmacy: ["amenity=pharmacy"],
  atm: ["amenity=atm"],
  bank: ["amenity=bank"],
  supermarket: ["shop=supermarket"],
  bakery: ["shop=bakery"],
  butcher: ["shop=butcher"],
  kiosk: ["shop=kiosk"],
  drugstore: ["shop=chemist"], // dm / Rossmann in DE
  hairdresser: ["shop=hairdresser"],
  restaurant: ["amenity=restaurant"],
  cafe: ["amenity=cafe"],
  fast_food: ["amenity=fast_food"],
  bar: ["amenity=bar"],
  pub: ["amenity=pub"],
  hospital: ["amenity=hospital"],
  doctor: ["amenity=doctors"],
  dentist: ["amenity=dentist"],
  fuel: ["amenity=fuel"],
  charging: ["amenity=charging_station"],
  parking: ["amenity=parking"],
  toilets: ["amenity=toilets"],
  post: ["amenity=post_office"],
  police: ["amenity=police"],
  library: ["amenity=library"],
  school: ["amenity=school"],
  kindergarten: ["amenity=kindergarten"],
  cinema: ["amenity=cinema"],
  playground: ["leisure=playground"],
  park: ["leisure=park"],
  gym: ["leisure=fitness_centre", "leisure=sports_centre"],
  hotel: ["tourism=hotel"],
  museum: ["tourism=museum"],
  bus_stop: ["highway=bus_stop"],
};
// A few aliases mapped to a preset key.
const ALIAS = {
  gas: "fuel", gas_station: "fuel", petrol: "fuel", tankstelle: "fuel",
  apotheke: "pharmacy", bakery_shop: "bakery", baeckerei: "bakery", bäckerei: "bakery",
  cash: "atm", geldautomat: "atm", doctors: "doctor", arzt: "doctor",
  cafes: "cafe", coffee: "cafe", supermarkt: "supermarket", spielplatz: "playground",
  parkplatz: "parking", krankenhaus: "hospital", restaurants: "restaurant",
  fitness: "gym", chemist: "drugstore", toilet: "toilets", wc: "toilets",
};

function filtersFor(word) {
  if (word.includes("=")) return [word]; // raw key=value passthrough
  let w = word.toLowerCase().trim().replace(/\s+/g, "_");
  if (ALIAS[w]) w = ALIAS[w];
  if (PRESETS[w]) return PRESETS[w];
  if (w.endsWith("s") && PRESETS[w.slice(0, -1)]) return PRESETS[w.slice(0, -1)];
  // Unknown: try the common keys so something sensible still comes back.
  return [`amenity=${w}`, `shop=${w}`, `leisure=${w}`, `tourism=${w}`];
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

async function fetchJson(url, opts, what) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 35000);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { "User-Agent": UA, ...(opts?.headers || {}) } });
  } catch (e) {
    die(e.name === "AbortError" ? `${what} timed out` : `network error reaching ${what}: ${e.message}`);
  } finally {
    clearTimeout(t);
  }
  if (res.status === 429) die(`${what} is rate-limiting (429) — wait a moment and retry.`);
  if (res.status === 504) die(`${what} is overloaded (504) — try a smaller radius or retry.`);
  if (!res.ok) die(`${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function geocode(place) {
  const url = `${NOMINATIM}?` + new URLSearchParams({ q: place, format: "jsonv2", limit: "1" });
  const list = await fetchJson(url, { headers: { Accept: "application/json" } }, "the geocoder (Nominatim)");
  if (!Array.isArray(list) || !list.length) die(`couldn't find a place named "${place}".`);
  return { lat: +list[0].lat, lon: +list[0].lon, name: list[0].display_name };
}

function addressOf(tags) {
  const parts = [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
    [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function near() {
  const amenity = process.argv[3];
  if (!amenity) die('usage: overpass.mjs near "<amenity>" "<place>" | --lat L --lon L  [--radius M] [--limit N]');
  const radius = Math.min(parseInt(flag("radius", "1500"), 10) || 1500, 10000);
  const limit = Math.min(parseInt(flag("limit", "15"), 10) || 15, 50);

  let center;
  const lat = flag("lat"), lon = flag("lon");
  if (lat != null && lon != null) {
    center = { lat: +lat, lon: +lon, name: `${lat},${lon}` };
  } else {
    const place = process.argv[4];
    if (!place || place.startsWith("--")) die('need a "<place>" (or --lat/--lon).');
    center = await geocode(place);
  }

  const filters = filtersFor(amenity);
  const around = `(around:${radius},${center.lat},${center.lon})`;
  const body =
    `[out:json][timeout:25];(` +
    filters.map((f) => {
      const [k, v] = f.split("=");
      return `nwr["${k}"="${v}"]${around};`;
    }).join("") +
    `);out center tags ${Math.min(limit * 4, 80)};`;

  const data = await fetchJson(
    OVERPASS,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(body) },
    "the Overpass API",
  );

  const elems = (data.elements || []).map((e) => {
    const p = e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center || {};
    const tags = e.tags || {};
    return {
      name: tags.name || tags.brand || null,
      kind: tags.amenity || tags.shop || tags.leisure || tags.tourism || tags.highway || null,
      distanceMeters: p.lat != null ? haversine(center.lat, center.lon, p.lat, p.lon) : null,
      address: addressOf(tags),
      opening_hours: tags.opening_hours || null,
      phone: tags.phone || tags["contact:phone"] || null,
      website: tags.website || tags["contact:website"] || null,
      lat: p.lat ?? null,
      lon: p.lon ?? null,
      map: p.lat != null ? `https://www.google.com/maps?q=${p.lat},${p.lon}` : null,
      osm: `${e.type}/${e.id}`,
    };
  });
  elems.sort((a, b) => (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12));
  const shown = elems.slice(0, limit);

  // A single map of EXACTLY these results (not a re-search). Google Maps has no URL for
  // dropping your own set of pins, so we render the precise points via geojson.io.
  const geo = {
    type: "FeatureCollection",
    features: shown
      .filter((r) => r.lat != null)
      .map((r) => ({
        type: "Feature",
        properties: { name: r.name || r.kind || "result", distance_m: r.distanceMeters, address: r.address || undefined },
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      })),
  };
  const mapAll = "https://geojson.io/#data=data:application/json," + encodeURIComponent(JSON.stringify(geo));

  console.log(JSON.stringify({
    query: { amenity, filters, radiusMeters: radius },
    center: { lat: center.lat, lon: center.lon, name: center.name },
    mapAll,
    count: elems.length,
    results: shown,
  }, null, 2));
}

const cmd = process.argv[2];
if (cmd === "near") await near();
else if (cmd === "presets")
  console.log(["Known amenity words:", ...Object.keys(PRESETS).sort(), "", "Aliases:", ...Object.keys(ALIAS).sort(), "", 'Or pass a raw filter like "amenity=cafe" / "shop=bakery".'].join("\n"));
else die('commands: near "<amenity>" "<place>" [--radius M] [--limit N]  |  presets');
