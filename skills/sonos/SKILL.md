---
name: sonos
description: Control the user's Sonos speaker/soundbar — play a saved favorite (playlists/stations), pause, resume, stop, skip, set volume, mute, and report what's playing. Use when the user says "play <name>/my playlist/some music", "pause", "stop", "next/previous", "turn it up/down", "set volume to N", "mute", or "what's playing". Local network only.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["sonos"], "env": ["SONOS_HOST"] } }
  }
---

# Sonos

Control the Sonos speaker over the local network with the `sonos` CLI. No login needed.

**Always target the speaker by IP** with `--ip "$SONOS_HOST"`. Name-based discovery uses
multicast, which doesn't work from inside the container, so never use `--name`. If `$SONOS_HOST`
is empty, tell the user to set `SONOS_HOST` (their speaker's IP) in `.env` — don't guess.

Define the prefix once, then use `$S` for every call:
```bash
S="sonos --ip $SONOS_HOST --timeout 10s"
```

## Playback control
```bash
$S status            # what's playing (track, state, volume) — use for "what's playing?"
$S play              # resume
$S pause
$S stop
$S next              # skip
$S prev
$S volume get
$S volume set 25     # absolute 0–100
$S volume set +5     # or relative (e.g. -5). "turn it up/down" → ±5–10; don't jump to extremes
$S mute set true     # or false
```

## Playing music — ALWAYS list favorites first, then open by exact title

Music plays from the user's **Sonos Favorites** (the playlists/stations saved in the Sonos app —
YouTube Music, radio, etc.). To play something, follow these steps **in order**:

1. **List favorites first — never guess the title:**
   ```bash
   $S favorites list
   ```
   Prints `POS  TITLE  URI`. (For example, the user's main playlist shows as the title `__izzy__`.)
2. **Match the user's words to a favorite's TITLE** — case-insensitive substring. The spoken
   name is often approximate (e.g. "izzy" or "easy" → the title `__izzy__`). If several titles
   match, ask which; if none match, tell the user it isn't a saved favorite and to add it in the
   Sonos app — do **not** substitute something else or search elsewhere.
3. **Open it by its EXACT title from the list**, quoted — **not** the position number (`open`
   matches titles, not indices):
   ```bash
   $S favorites open "__izzy__"
   ```

> **Do NOT use `search`, `smapi`, `open spotify:…`, or any service search.** The user's music is
> in YouTube Music and reached only through favorites; direct service search isn't authenticated
> and will just fail. Favorites are the only music path here: **list → match → open by title.**

## After acting
Confirm briefly in plain language ("▶️ Playing __izzy__ — volume 6", "⏸ Paused", "🔉 Volume 20").
If a command errors with a network/timeout, the speaker may be off or its IP changed — say so
plainly; never claim something played when it didn't.
