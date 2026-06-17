#!/usr/bin/env node
// Web search CLI for Core. Queries the self-hosted SearXNG instance (private
// metasearch — no API key, queries not tied to the user) and returns a clean ranked
// list of results. No third-party deps (Node built-in fetch).
//
// Usage:
//   node websearch.mjs "<query>" [maxResults] [--category general|news|science|it]
//
// Returns candidate {title, url, snippet} — to read a page's actual content, pass a
// url to the web-read skill (search engines only give snippets).
const BASE = process.env.SEARXNG_URL ?? "http://searxng:8080";

function die(msg) {
  console.error(`websearch: ${msg}`);
  process.exit(1);
}

function parse(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category") out.category = args[++i] ?? "general";
    else out._.push(args[i]);
  }
  return out;
}

const f = parse(process.argv.slice(2));
const query = f._[0];
if (!query) die('usage: websearch.mjs "<query>" [maxResults] [--category general|news|science|it]');
const max = Math.min(parseInt(f._[1] ?? "8", 10) || 8, 15);

const params = new URLSearchParams({ q: query, format: "json", safesearch: "1" });
if (f.category) params.set("categories", f.category);

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
