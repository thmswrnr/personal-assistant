// Shared Google OAuth token minting for the Google skills (gmail, drive, calendar,
// sheets, docs, tasks, youtube). Reads the stored refresh token from
// $GOOGLE_OAUTH_FILE (default /app/secrets/google_oauth.json), exchanges it for a
// short-lived access token, and returns it. The token never appears in the agent's
// context.
//
// This is a plain helper, not a skill — it has no SKILL.md, so pi does not load it.
// Each skill keeps its own `die()` / `api()`; this throws Error on failure and lets
// the caller format the message (e.g. `accessToken().catch((e) => die(e.message))`).
import { readFileSync } from "node:fs";

const OAUTH_FILE = process.env.GOOGLE_OAUTH_FILE ?? "/app/secrets/google_oauth.json";

export async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(readFileSync(OAUTH_FILE, "utf8"));
  }
  catch {
    throw new Error(`could not read credentials at ${OAUTH_FILE} — run scripts/google-oauth.mjs first`);
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
  });
  const res = await fetch(creds.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("token refresh returned no access_token");
  return j.access_token;
}
