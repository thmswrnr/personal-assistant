---
name: home-assistant
description: Read and control the user's home automation through Home Assistant — lights, switches, sensors, climate, media players, locks, covers. Use when the user says "turn on/off <thing>", "dim the <light>", "is the <door> open", "what's the temperature in <room>", "set the heating to N", or asks what a device is doing. Local network only; needs a long-lived access token.
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/ha_token"] } }
  }
---

# Home Assistant

Control the house over Home Assistant's REST API with the CLI below. The token lives in
`/app/secrets/ha_token` and is read by the script — **never** print it or read it into your
context.

If the script says there is no token, tell the user plainly to create one in Home Assistant
(profile → Security → Long-lived access tokens) and save it to `data/secrets/ha_token`. Don't
pretend you changed anything.

## Commands (run via bash)

```bash
HA="node /app/.pi/skills/home/home-assistant/scripts/home-assistant.mjs"

$HA list light                    # one line per entity: entity_id, state, friendly name
$HA list                          # every entity — only when you truly don't know the domain
$HA get light.desk_lamp           # full state + attributes, as JSON
$HA call light turn_on light.desk_lamp
$HA call light turn_on light.desk_lamp '{"brightness_pct":40}'
$HA call light turn_off light.desk_lamp
```

## How to use it

1. **Always narrow `list` to a domain.** A whole house is hundreds of entities. Pick the domain
   from what the user said: `light`, `switch`, `sensor`, `binary_sensor`, `climate`,
   `media_player`, `cover`, `lock`, `fan`, `vacuum`, `person`.
2. **Match the user's words to an `entity_id` from the list output** — don't guess an id.
   If several entities could match ("the lamp" with three lamps), ask which one.
   If none match, say so and show what the domain does contain.
3. **Call the service.** The service name is the action: `turn_on`, `turn_off`, `toggle`,
   `set_temperature`, `open_cover`, `lock`, `media_play`. The extra JSON argument carries the
   options — `{"brightness_pct":40}`, `{"temperature":21}`, `{"color_name":"warm white"}`.
4. **Report the result in one line**, using the user's words for the device. The script prints
   the new state; if nothing changed, it says so — pass that on rather than claiming success.

## Gotchas

- `get` prints the full attribute blob for one entity. Use it for a single device, never in a
  loop over many — that is what `list` is for.
- A `sensor` state is a bare number; the unit is in the attributes. Use `get` when the unit
  matters.
- Some domains take no `entity_id` options at all, and some services take extra required fields
  (`climate.set_temperature` needs `temperature`). If a call errors, read the message — it names
  the missing field.
- **Confirm before anything with physical consequences**: unlocking a door, opening a garage,
  disarming an alarm. Turning a lamp on is not that.
