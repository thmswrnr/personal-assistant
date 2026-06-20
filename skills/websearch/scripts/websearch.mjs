#!/usr/bin/env node
// Web search CLI for Core. Queries the self-hosted SearXNG instance (private
// metasearch — no API key, queries not tied to the user) and returns a clean ranked
// list of results. No third-party deps (Node built-in fetch).
//
// Usage:
//   node websearch.mjs "<query>" [maxResults] [--category general|news|science|it]
//                                              [--time day|week|month|year] [--lang de|en|…]
//
// Returns candidate {title, url, snippet} — to read a page's actual content, pass a
// url to the web-read skill (search engines only give snippets).
const BASE = process.env.SEARXNG_URL ?? "http://searxng:8080";
const TIME_RANGES = ["day", "week", "month", "year"]; // SearXNG's freshness buckets

function die(msg) {
  console.error(`websearch: ${msg}`);
  process.exit(1);
}

function parse(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++)
  {
    switch (args[i])
    {
      case "--category":
        out.category = args[++i] ?? "general";
        break;

      case "--time":
        out.time = args[++i];
        break;

      case "--lang":
        out.lang = args[++i];
        break;

      default:
        out._.push(args[i]);
    }
  }
  return out;
}

const f = parse(process.argv.slice(2));
const query = f._[0];
if (!query) die('usage: websearch.mjs "<query>" [maxResults] [--category general|news|science|it] [--time day|week|month|year] [--lang de|en|…]');
const max = Math.min(parseInt(f._[1] ?? "8", 10) || 8, 15);

if (f.time && !TIME_RANGES.includes(f.time)) die(`--time must be one of ${TIME_RANGES.join(", ")} (got "${f.time}")`);

const params = new URLSearchParams({ q: query, format: "json", safesearch: "1" });
if (f.category) params.set("categories", f.category);
if (f.time) params.set("time_range", f.time);  // narrow to recent results (freshness)
if (f.lang) params.set("language", f.lang);     // bias to a locale, e.g. "de" or "en"

let data;
try {
  const res = await fetch(`${BASE}/search?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) die(`SearXNG returned ${res.status} (is the searxng container up?)`);
  data = await res.json();
}
catch (e) {
  die(`could not reach SearXNG at ${BASE} (${e.message}). Is the container running?`);
}

const results = (data.results ?? [])
  .slice(0, max)
  .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "", engine: r.engine }));

console.log(JSON.stringify({
  query,
  returned: results.length,
  answers: data.answers ?? [], // SearXNG's instant answers, if any
  results,
}, null, 2));
