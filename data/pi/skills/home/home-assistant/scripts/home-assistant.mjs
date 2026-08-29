#!/usr/bin/env node
// Home Assistant CLI for Core. Reads and controls the home automation over HA's REST API.
// No third-party deps (Node built-in fetch).
//
// The token lives in a file and is never printed, so it stays out of the model's context.
//
// Usage:
//   node home-assistant.mjs list [domain]                       # one line per entity
//   node home-assistant.mjs get <entity_id>                     # full state + attributes
//   node home-assistant.mjs call <domain> <service> <entity_id> [json]
//
// Examples:
//   node home-assistant.mjs list light
//   node home-assistant.mjs get light.desk_lamp
//   node home-assistant.mjs call light turn_on light.desk_lamp
//   node home-assistant.mjs call light turn_on light.desk_lamp '{"brightness_pct":40}'

import { readFileSync } from "node:fs";

// host.docker.internal, because Home Assistant runs with host networking while Core sits on the
// compose bridge network — so there is no container name to reach it by.
const BASE = (process.env.HA_URL || "http://host.docker.internal:8123").replace(/\/+$/, "");
const TOKEN_FILE = process.env.HA_TOKEN_FILE || "/app/secrets/ha_token";

function die(msg) {
  console.error(`home-assistant: ${msg}`);
  process.exit(1);
}

function token() {
  try {
    const t = readFileSync(TOKEN_FILE, "utf8").trim();
    if (!t) {
      die(`${TOKEN_FILE} is empty — create a long-lived access token in Home Assistant (profile → Security) and save it there`);
    }
    return t;
  }
  catch {
    die(`no token at ${TOKEN_FILE} — create a long-lived access token in Home Assistant (profile → Security) and save it there`);
  }
}

async function api(path, options = {}) {
  const url = `${BASE}/api${path}`;
  let res;

  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  }
  catch (e) {
    die(`cannot reach Home Assistant at ${BASE} (${e.message}) — is it running, and is HA_URL right?`);
  }

  if (res.status === 401) {
    die("Home Assistant rejected the token (401) — it may be revoked or wrong");
  }
  if (res.status === 404) {
    die(`not found: ${path}`);
  }
  if (!res.ok) {
    die(`request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// A friendly name is nice for the model to match the user's words against, but it is often just
// the entity_id prettified. Drop it when it adds nothing.
function nameOf(e) {
  const friendly = e.attributes?.friendly_name;
  if (!friendly) {
    return "";
  }

  const slug = e.entity_id.split(".")[1].replace(/_/g, " ").toLowerCase();
  return friendly.toLowerCase() === slug ? "" : friendly;
}

async function list(domain) {
  const states = await api("/states");
  const wanted = domain ? states.filter((e) => e.entity_id.startsWith(`${domain}.`)) : states;

  if (wanted.length === 0) {
    const domains = [...new Set(states.map((e) => e.entity_id.split(".")[0]))].sort();
    die(`no entities${domain ? ` in domain "${domain}"` : ""}. Domains present: ${domains.join(", ")}`);
  }

  // One line per entity, not the raw state JSON — a whole house of attributes would swamp the
  // context window on every request.
  for (const e of wanted.sort((a, b) => a.entity_id.localeCompare(b.entity_id))) {
    const name = nameOf(e);
    console.log(`${e.entity_id}\t${e.state}${name ? `\t${name}` : ""}`);
  }

  console.log(`\n${wanted.length} entities${domain ? ` in ${domain}` : ""}`);
}

async function get(entityId) {
  const e = await api(`/states/${encodeURIComponent(entityId)}`);
  console.log(JSON.stringify(e, null, 2));
}

async function call(domain, service, entityId, dataJson) {
  let data = {};

  if (dataJson) {
    try {
      data = JSON.parse(dataJson);
    }
    catch (err) {
      die(`the extra argument must be JSON: ${err.message}`);
    }
  }

  const changed = await api(`/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId, ...data }),
  });

  // HA answers with the states it changed. An empty array means the service ran but nothing
  // moved — usually the entity was already in that state, or the entity_id is wrong.
  const target = changed.find((e) => e.entity_id === entityId);

  if (target) {
    console.log(`ok: ${entityId} is now ${target.state}`);
  }
  else {
    console.log(`ran ${domain}.${service} on ${entityId}, but its state did not change — it may already be in that state, or the entity_id may be wrong`);
  }
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "list":
    await list(args[0]);
    break;

  case "get":
    if (!args[0]) {
      die("usage: get <entity_id>");
    }
    await get(args[0]);
    break;

  case "call":
    if (args.length < 3) {
      die("usage: call <domain> <service> <entity_id> [json]");
    }
    await call(args[0], args[1], args[2], args[3]);
    break;

  default:
    die("usage: list [domain] | get <entity_id> | call <domain> <service> <entity_id> [json]");
}
