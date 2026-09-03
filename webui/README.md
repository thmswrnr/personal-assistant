# The web chat UI

Core's browser front end is [@agegr/pi-web](https://github.com/agegr/pi-web) (MIT), with two
patches of our own. This directory holds the patches and the build; the UI's own source is
never vendored here.

## Why patches rather than a fork

The npm package ships no source — only a prebuilt `.next` — so any change needs a real Next
build. Keeping the diff as patch files against a pinned upstream means the whole of our
divergence is 350 lines you can read, and bumping upstream surfaces as a patch conflict that
names exactly which change moved under us.

## What we changed

**`01-camera-capture.patch`** — a camera button next to the attach button, mobile only. Adds a
second hidden file input with `capture="environment"` rather than putting `capture` on the
existing one, because that would take the gallery away and both are wanted.

**`02-cheap-session-title.patch`** — naming a chat used to re-send the source agent's entire
provider prefix: Core's `SYSTEM.md`, its long-term memory index, its skill catalogue, every
tool's name/description/JSON schema, and the full message history — measured at 18,391 input
tokens to produce 18 output tokens. Upstream does this deliberately so a provider's prompt cache
is reused, which pays on an API that bills and caches input tokens. Ours does neither.

The naming run now gets a short purpose-built system prompt, no tools, and the user's turns
rendered as one numbered list, oldest first. Only the user's turns: the assistant's replies are
what make a transcript huge, and they restate the question rather than adding to it — a real
session here was 14 user turns totalling 542 characters against roughly 18k tokens of
transcript.

Long sessions are budgeted (400 characters a turn, 2,500 overall, then first three and last two
with the gap stated). The numbering is what makes a gap visible: unbroken numbers mean nothing
was dropped. For the same reason the system prompt says "the messages a user sent" and not
"every message" — a promise of completeness would be false exactly when the budget bites.

## Rebuilding

Needs `node`. The Pi has none, and a Next build wants more RAM than it has spare, so build here
and carry the tarball over:

```bash
./webui/build.sh                                        # -> core/vendor/pi-web.tgz
scp core/vendor/pi-web.tgz rpi@rpi:personal-assistant/core/vendor/
ssh rpi@rpi 'cd personal-assistant && docker compose build core \
  && docker compose --profile home --profile webui up -d'
```

`build.sh` clones the pin in `upstream.txt`, applies every patch, then runs `npm ci`, `npm test`
and `npm run build` before packing. Any patch that fails to apply stops the build — a silently
skipped patch would ship a tarball missing one of our changes.

The built `.next` contains no native binaries, so it is portable between architectures. npm
still installs the runtime dependencies on the Pi, for arm64.

## Bumping upstream

Change `ref=` in `upstream.txt`, run `./webui/build.sh`, and fix whatever no longer applies.
Regenerate a patch by editing inside `webui/.build/` and running
`git -C webui/.build diff -- <paths> > webui/patches/<name>.patch`.

Both `core/vendor/` and `webui/.build/` are git-ignored.
