---
name: weather
description: Get current weather and a short forecast for a place, via Open-Meteo (no API key). Use for "what's the weather", "will it rain", "forecast for <city>", "do I need a jacket". Metric units (°C).
metadata:
  {
    "core":
      { "requires": { "bins": ["node"] } }
  }
---

# Weather

Look up current conditions and a few-day forecast for any place, using the free
Open-Meteo API (no key, no tracking).

## Command (run via bash)

```bash
# Place name (city, optionally with country); optional number of days (1-7, default 3)
node /app/.pi/skills/home/weather/scripts/weather.mjs "Bonn"
node /app/.pi/skills/home/weather/scripts/weather.mjs "Berlin, DE" 5
```

It prints JSON: `{location, timezone, current:{temperature_c, feels_like_c, conditions,
humidity_pct, wind_kmh, precipitation_mm}, forecast:[{date, conditions, high_c, low_c,
precip_chance_pct}]}`.

## How to use it

1. Pull the place from the user's request. If they don't give one and you don't know
   their location, **ask** rather than guessing a city.
2. Answer conversationally: lead with current temp + conditions, then a one-line
   outlook (e.g. highs/lows, rain chance). Mention rain/snow if `precip_chance_pct`
   is notable. Don't dump the raw JSON.
3. If the place can't be found, say so and ask for a more specific name.
