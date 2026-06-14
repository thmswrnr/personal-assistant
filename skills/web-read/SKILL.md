---
name: web-read
description: Fetch a web page (by URL) and extract its main readable text, so you can summarize it or answer questions from the actual content. Use after a web search to read a promising result, or whenever the user gives a URL/article/blog link to read or summarize. Captions/snippets aren't enough — this gets the real page text.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"] } }
  }
---

# Web read

Fetch a URL and pull out the main article text (strips scripts, styles, nav, and
boilerplate). Returns clean text ready to summarize.

## Command (run via bash)

```bash
node /app/.pi/skills/web-read/web-read.mjs "https://example.com/article"
```

It prints JSON: `{url, title, chars, truncated, text}`.

## How to use it

1. Use this to **read a page** — typically after the **websearch** skill gives you a
   promising `url`, or when the user pastes a link.
2. Then do what the user asked: usually summarize (gist + key points) or answer a
   specific question, grounded in the `text`. Mention the source title/URL.
3. If `truncated` is true (long page), say so and work from the portion you have.
4. If it errors (page blocked, not HTML/text like a PDF, or unreachable), report that
   plainly. Don't fabricate the page's contents.
5. **Don't invent** — only state what the fetched text actually says.
