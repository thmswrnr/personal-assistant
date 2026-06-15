---
name: sonos
description: Control the user's Sonos speaker/soundbar — play, pause, skip, set volume, mute, and play music (Spotify or Sonos favorites). Use when the user says "play music/<song/artist>", "pause", "stop", "next/previous track", "turn it up/down", "set volume to N", "mute", or "what's playing". Local network only.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["sonos"], "env": ["SONOS_HOST"] } }
  }
---

# Sonos

Control the Sonos speaker over the local network with the `sonos` CLI. No login needed — it
uses the music services already linked in the user's Sonos app (e.g. Spotify).

**Always target the speaker by IP** with `--ip "$SONOS_HOST"` (the env var holds the speaker's
address). Name-based discovery uses multicast, which doesn't work from inside the container — so
never rely on `--name`. If `$SONOS_HOST` is empty, tell the user to set `SONOS_HOST` in `.env`
(their speaker's IP) and don't guess.

## Common commands (run via bash)

```bash
S="sonos --ip $SONOS_HOST --timeout 10s"

$S status                 # what's playing (track, state, volume)
$S play                   # resume
$S pause
$S stop
$S next                   # skip
$S prev
$S volume get
$S volume set 25          # 0–100
$S volume set +5          # relative up/down also work (e.g. -5)
$S mute set true          # or: false
```

## Playing music

**Favorites are the primary, service-agnostic way** — they play whatever the user saved in the
Sonos app (YouTube Music, Spotify, radio, …) with no extra auth. The user uses **YouTube Music**,
so favorites are the main path here.
```bash
$S favorites list                 # show saved favorites (title + index)
$S favorites open "__izzy__"      # play one by title …
$S favorites open 1               # … or by index
```

**Spotify only** has direct search/play (the CLI is Spotify-built):
```bash
$S open spotify:track:6NmXV4o6bmp704aPGyTVVG          # play a Spotify URI
$S search --service Spotify --category tracks "…"     # find Spotify URIs, then `open` one
```

**YouTube Music / other services:** direct `search` does NOT work without a one-time
`sonos auth smapi` link, so don't try to search YT Music — use a **favorite** instead. If the
user asks for something not in favorites, tell them to save it as a Sonos Favorite in the app
(or ask whether a Spotify version is fine).

## How to use it
1. Map the request to the right command. "Turn it up" → `volume set +5` (or a sensible step);
   "play some jazz" → a favorite if one fits, else search Spotify and `open` the top hit.
2. After an action, confirm briefly in plain language ("▶️ Playing — volume 25"). Use `status`
   to answer "what's playing?".
3. Volumes: don't jump to extremes. If unspecified, nudge by ±5–10 rather than guessing absolute.
4. If a command errors with a network/timeout, the speaker may be off or the IP changed — say so
   plainly; don't pretend it played.
