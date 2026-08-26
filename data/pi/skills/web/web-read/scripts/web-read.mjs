#!/usr/bin/env node
// Web page reader for Core. Fetches a URL and extracts the main readable text
// (drops scripts/styles/nav/boilerplate), so the model can summarize or answer from
// the actual page content — not just a search snippet. No third-party deps.
//
// Usage:
//   node read.mjs "<url>"
import { argv } from "node:process";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CAP = 20000; // ~5k tokens of article text — plenty to summarize, keeps context lean

function die(msg) {
  console.error(`web-read: ${msg}`);
  process.exit(1);
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&[a-z0-9]+;/gi, " ");
}

// Prefer the main article region if the page marks one; else fall back to <body>.
function mainRegion(html) {
  const m =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      // strip non-content elements entirely (including their text)
      .replace(/<(script|style|head|nav|header|footer|aside|form|noscript|svg|iframe|button|figure)\b[\s\S]*?<\/\1>/gi, " ")
      // block-level closers / breaks -> newlines so paragraphs survive
      .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let url = argv[2];
if (!url) die('usage: read.mjs "<url>"');
if (!/^https?:\/\//i.test(url)) url = "https://" + url;

let res;
try {
  res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
}
catch (e) {
  die(`could not fetch ${url} (${e.message})`);
}
if (!res.ok) die(`fetch failed: ${res.status} ${res.statusText} for ${url}`);

const ctype = res.headers.get("content-type") ?? "";
const raw = await res.text();

let title = "", text;
if (ctype.includes("html") || /<html/i.test(raw)) {
  title = decodeEntities((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
  text = htmlToText(mainRegion(raw));
}
else if (ctype.includes("text") || ctype.includes("json")) {
  text = raw.trim(); // already plain
}
else {
  die(`unsupported content type "${ctype}" — not an HTML/text page (e.g. a PDF or binary).`);
}

const truncated = text.length > CAP;
console.log(JSON.stringify({
  url: res.url,
  title,
  chars: text.length,
  truncated,
  text: truncated ? text.slice(0, CAP) + "\n…[truncated]" : text,
}, null, 2));
