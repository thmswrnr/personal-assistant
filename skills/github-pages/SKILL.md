---
name: github-pages
description: Publish a website to GitHub Pages — create a repo, push HTML/site files, enable Pages, and return the live URL. Use when the user says "put this online", "publish a page/site", "make a GitHub Pages site", "host this", or wants a quick public web page. Read-write to the user's GitHub account (creates repos).
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["gh", "git"], "files": ["/app/secrets/github_token"] } }
  }
---

# GitHub Pages

Publish a static site (HTML/CSS/JS) to GitHub Pages using the `gh` CLI. Authenticates with a
Personal Access Token the user created — the token lives in `/app/secrets/github_token` and is
**never** printed or put in your context (always read it inline with `$(cat …)`).

## Auth (run first, every session)

```bash
export GH_TOKEN="$(cat /app/secrets/github_token)"
gh api user -q .login   # prints the username; if this errors, the token is missing/invalid — tell the user
```

If `/app/secrets/github_token` doesn't exist, tell the user plainly to create a GitHub PAT
(scope `repo`) and save it there. Don't pretend you published anything.

## Publish a site

1. **Prepare the content** in a working directory (e.g. `/tmp/site`). At minimum an
   `index.html`. Create/write the files the user asked for there.
   ```bash
   mkdir -p /tmp/site && cd /tmp/site
   # write index.html (and any assets) here
   ```
2. **Create the repo and push** in one step (public; Pages needs a public repo on free plans):
   ```bash
   cd /tmp/site
   git init -q && git add -A && git -c user.email=core@local -c user.name=Core commit -qm "Initial site"
   gh repo create "<repo-name>" --public --source=. --remote=origin --push
   ```
3. **Enable Pages** from the default branch root:
   ```bash
   owner="$(gh api user -q .login)"
   gh api -X POST "repos/$owner/<repo-name>/pages" -f "source[branch]=main" -f "source[path]=/"
   ```
   (If it returns 409 "already enabled", that's fine.)
4. **Give the user the URL** — it's `https://<owner>.github.io/<repo-name>/`. Note Pages can take
   a minute to go live on first publish.

## Updating an existing site
`cd` into its dir, edit files, then `git add -A && git commit -m … && git push`. Pages redeploys
automatically.

## Notes
- Keep `GH_TOKEN` inline (`$(cat …)`) — never echo the token or hard-code it.
- Repo name: derive a clean slug from the user's request unless they specify one; confirm it
  back. If a repo by that name exists, pick another or ask.
- Static sites only (HTML/CSS/JS). No build step unless the user sets one up.
