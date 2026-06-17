#!/usr/bin/env node
// Core's long-term memory store. Each fact is one markdown file under storage/memory/ with
// frontmatter (name, description, type); MEMORY.md is the always-loaded INDEX, regenerated
// from the fact files on every change so it can never drift or get corrupted.
//
// Usage:
//   remember.mjs save --slug <kebab> --type <user|preference|project|reference> \
//                      --desc "<one-line, for recall>" --body "<the fact>"
//   remember.mjs forget --slug <kebab>
//   remember.mjs list
//
// The memory dir is /app/storage/memory (override with CORE_MEMORY_DIR for tests).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";

const DIR = process.env.CORE_MEMORY_DIR ?? "/app/storage/memory";
const INDEX = `${DIR}/MEMORY.md`;
const TYPES = ["user", "preference", "project", "reference"];

const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[++i] ?? "";
  }
  return o;
}

// Read the frontmatter (name, description, type) of a fact file. Tolerant, single-line values.
function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

// Regenerate MEMORY.md from all fact files. Grouped by type for a little structure.
function reindex() {
  const files = existsSync(DIR)
    ? readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort()
    : [];
  const facts = files.map((f) => {
    const fm = frontmatter(readFileSync(`${DIR}/${f}`, "utf8"));
    return { file: f, name: fm.name || f.replace(/\.md$/, ""), desc: fm.description || "", type: TYPES.includes(fm.type) ? fm.type : "reference" };
  });
  const HEAD = {
    user: "## About the user",
    preference: "## Preferences",
    project: "## Ongoing work / projects",
    reference: "## References",
  };
  let out =
    "# Core — Long-term memory (index)\n" +
    "<!-- Auto-generated from the fact files in this folder by the `remember` skill. Don't edit by hand. -->\n";
  for (const t of TYPES) {
    const group = facts.filter((x) => x.type === t);
    if (!group.length) continue;
    out += `\n${HEAD[t]}\n`;
    for (const x of group) out += `- [${x.name}](${x.file})${x.desc ? ` — ${x.desc}` : ""}\n`;
  }
  if (!facts.length) out += "\n_(empty)_\n";
  writeFileSync(INDEX, out);
  return facts.length;
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (cmd === "save") {
  const slug = (args.slug || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die("--slug must be kebab-case (e.g. user-city)");
  const type = (args.type || "").trim();
  if (!TYPES.includes(type)) die(`--type must be one of: ${TYPES.join(", ")}`);
  const desc = (args.desc || "").trim();
  if (!desc) die("--desc is required (a one-line description used for recall)");
  const body = (args.body || "").trim();
  if (!body) die("--body is required (the fact itself)");

  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/${slug}.md`;
  const existed = existsSync(file);
  const content = `---\nname: ${slug}\ndescription: ${desc}\ntype: ${type}\n---\n\n${body}\n`;
  writeFileSync(file, content);
  const total = reindex();
  console.log(JSON.stringify({ saved: slug, action: existed ? "updated" : "created", type, totalFacts: total }));
}
else if (cmd === "forget") {
  const slug = (args.slug || "").trim();
  const file = `${DIR}/${slug}.md`;
  if (!existsSync(file)) die(`no such memory: ${slug}`);
  rmSync(file, { force: true });
  const total = reindex();
  console.log(JSON.stringify({ forgot: slug, totalFacts: total }));
}
else if (cmd === "list") {
  reindex();
  process.stdout.write(existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "(no memory yet)\n");
}
else {
  die("usage: save | forget | list  (see the skill doc)");
}
