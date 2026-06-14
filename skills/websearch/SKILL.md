---
name: websearch
description: Search the web for current information via a private self-hosted SearXNG instance (no API key, no tracking). Use when the user asks something that needs up-to-date or external facts — "search the web for…", "what's the latest on…", "find…", or any question your own knowledge can't answer reliably. Returns result links + snippets; pair with the web-read skill to read a page in full.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"] } }
  }
---

# Web search

Search the web through Core's private SearXNG instance (a metasearch engine that
aggregates other engines without tracking you). Returns ranked candidates — titles,
URLs, and snippets.

## Command (run via bash)

```bash
node /app/.pi/skills/websearch/search.mjs "<query>" [maxResults] [--category news]
# e.g.
node /app/.pi/skills/websearch/search.mjs "best local LLM june 2026" 8
node /app/.pi/skills/websearch/search.mjs "ECB interest rate decision" 5 --category news
```

It prints JSON: `{query, returned, answers, results:[{title, url, snippet, engine}]}`.

## How to use it

1. **Search → then read.** Snippets are previews, not full content. To actually answer
   from a page, take the best `url` and read it with the **web-read** skill, then
   summarize. Use 1–3 reads for a well-grounded answer; don't read all results.
2. Prefer recent/authoritative sources. Use `--category news` for current events.
3. **Cite your sources** — mention the site/URL you based the answer on, so the user
   can verify. Don't present a snippet as a confirmed fact without reading it.
4. If the search errors (e.g. the SearXNG container is down), say so plainly rather
   than answering from memory and implying it was a live search.
