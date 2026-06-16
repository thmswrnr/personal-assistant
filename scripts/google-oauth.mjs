#!/usr/bin/env node
// One-time Google OAuth consent → stores a single refresh token shared by all the
// Google skills (Gmail, Drive, Calendar, Tasks, Sheets, Docs, YouTube). Re-run this whenever
// you add a skill that needs a new scope (the token must be re-consented to cover it).
//
// Prereqs:
//   - data/secrets/google_client_secret.json:
//     the "Web application" OAuth client JSON from Google Cloud Console. Its authorized
//     redirect URIs must include http://localhost:4100/oauth2callback, and the project must
//     have these APIs enabled: Gmail, Drive, Calendar, YouTube Data, Tasks, Sheets, Docs.
//     (Google silently DROPS any requested scope whose API isn't enabled — this script warns
//     when that happens.)
//
// Usage (on the host):  node scripts/google-oauth.mjs
//
// Opens a local listener, prints a consent URL. You approve it in the browser once;
// Google redirects back here with a code, which we exchange for a refresh token written
// to data/secrets/google_oauth.json. After this, all Google skills run non-interactively.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS = join(ROOT, "data", "secrets");
const CLIENT_FILE = join(SECRETS, "google_client_secret.json");
const OUT_FILE = join(SECRETS, "google_oauth.json");

const PORT = 4100;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
// Scopes for the Google skills. Read-only except: gmail.compose (drafts only — never sends),
// calendar.events / tasks / spreadsheets / documents (read-write — the calendar/tasks/sheets/
// docs skills gate every write behind a confirm-with-the-user rule). Add a scope here and
// re-run this script when a new skill needs it (the consent must cover it).
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose", // create drafts only (never sends)
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.events", // read + create/edit/delete calendar events
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/tasks", // Google Tasks read/write — the general to-do list
  "https://www.googleapis.com/auth/spreadsheets", // Google Sheets read/write
  "https://www.googleapis.com/auth/documents", // Google Docs read/create/edit
];
const AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function loadClient() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
  } catch {
    console.error(`ERROR: could not read ${CLIENT_FILE}`);
    console.error("Download the Web-application OAuth client JSON from Google Cloud Console and save it there.");
    process.exit(1);
  }
  const c = raw.web ?? raw.installed ?? raw;
  if (!c.client_id || !c.client_secret) {
    console.error(`ERROR: ${CLIENT_FILE} missing client_id/client_secret`);
    process.exit(1);
  }
  return { client_id: c.client_id, client_secret: c.client_secret };
}

async function exchangeCode(client, code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const client = loadClient();
const codeVerifier = b64url(randomBytes(48));
const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
const state = b64url(randomBytes(16));

const authUrl = `${AUTH_URI}?${new URLSearchParams({
  response_type: "code",
  client_id: client.client_id,
  redirect_uri: REDIRECT_URI,
  scope: SCOPES.join(" "),
  access_type: "offline", // request a refresh token
  prompt: "consent", // force refresh_token even on re-consent
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  state,
})}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end("not found");
    return;
  }
  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400).end(`OAuth error: ${err}`);
    console.error(`OAuth error: ${err}`);
    server.close();
    process.exit(1);
  }
  if (gotState !== state) {
    res.writeHead(400).end("state mismatch");
    console.error("ERROR: state mismatch");
    server.close();
    process.exit(1);
  }
  try {
    const tokens = await exchangeCode(client, code, codeVerifier);
    if (!tokens.refresh_token) {
      throw new Error("no refresh_token returned (revoke prior grant or ensure prompt=consent)");
    }
    // Record what Google ACTUALLY granted (not just what we requested) — Google
    // silently drops scopes whose API isn't enabled or that weren't approved.
    const granted = (tokens.scope ?? "").split(" ").filter(Boolean);
    writeFileSync(
      OUT_FILE,
      JSON.stringify(
        {
          token_uri: TOKEN_URI,
          client_id: client.client_id,
          client_secret: client.client_secret,
          refresh_token: tokens.refresh_token,
          scopes: granted,
        },
        null,
        2,
      ) + "\n",
    );
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>",
    );
    console.log(`\n✓ Refresh token saved to ${OUT_FILE}`);
    console.log("  (data/secrets is git-ignored; keep it private.)");
    const missing = SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) {
      console.warn("\n⚠  WARNING — these requested scopes were NOT granted:");
      missing.forEach((s) => console.warn(`     - ${s}`));
      console.warn("   Fix: enable the matching API in Google Cloud, add the scope on the OAuth");
      console.warn("   consent screen, and tick its checkbox on the permission page. Then re-run.");
    } else {
      console.log("  All requested scopes granted ✓");
    }
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500).end(String(e));
    console.error(String(e));
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in your browser to authorize (one time):\n");
  console.log(authUrl + "\n");
  console.log("Waiting for the redirect back to " + REDIRECT_URI + " …");
});
