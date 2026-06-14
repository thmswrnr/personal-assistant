#!/usr/bin/env node
// Weather CLI for Core. Uses Open-Meteo (free, no API key, no tracking).
// Geocodes a place name, then fetches current conditions + a short daily forecast.
// Metric units (°C, km/h). No third-party deps (Node built-in fetch).
//
// Usage:
//   node weather.mjs "<place>" [days]      # e.g. "Bonn", "Berlin, DE", "Paris" (days 1-7, default 3)

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

function die(msg) {
  console.error(`weather: ${msg}`);
  process.exit(1);
}

// WMO weather codes -> short text (https://open-meteo.com/en/docs).
const WMO = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog",
  51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
  56: "light freezing drizzle", 57: "dense freezing drizzle",
  61: "slight rain", 63: "moderate rain", 65: "heavy rain",
  66: "light freezing rain", 67: "heavy freezing rain",
  71: "slight snow", 73: "moderate snow", 75: "heavy snow", 77: "snow grains",
  80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
  85: "slight snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
};
const desc = (code) => WMO[code] ?? `code ${code}`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) die(`request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function geocode(place) {
  const g = await getJson(`${GEO}?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
  const r = g.results?.[0];
  if (!r) die(`could not find a place named "${place}"`);
  return r;
}

const place = process.argv[2];
const days = Math.min(Math.max(parseInt(process.argv[3] ?? "3", 10) || 3, 1), 7);
if (!place) die('usage: weather.mjs "<place>" [days]');

const loc = await geocode(place);
const params = new URLSearchParams({
  latitude: String(loc.latitude),
  longitude: String(loc.longitude),
  current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation",
  daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  timezone: "auto",
  forecast_days: String(days),
});
const w = await getJson(`${FORECAST}?${params}`);

const c = w.current;
const out = {
  location: [loc.name, loc.admin1, loc.country].filter(Boolean).join(", "),
  timezone: w.timezone,
  current: {
    temperature_c: c.temperature_2m,
    feels_like_c: c.apparent_temperature,
    conditions: desc(c.weather_code),
    humidity_pct: c.relative_humidity_2m,
    wind_kmh: c.wind_speed_10m,
    precipitation_mm: c.precipitation,
  },
  forecast: w.daily.time.map((date, i) => ({
    date,
    conditions: desc(w.daily.weather_code[i]),
    high_c: w.daily.temperature_2m_max[i],
    low_c: w.daily.temperature_2m_min[i],
    precip_chance_pct: w.daily.precipitation_probability_max[i],
  })),
};
console.log(JSON.stringify(out, null, 2));
