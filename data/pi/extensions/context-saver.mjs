// Context-saver extension for Core — keeps the model's context lean three ways:
//
//  1. SPILL (free, deterministic): large *list-like* JSON tool output is written to a
//     file and replaced in-context with a compact preview + path. The model queries it
//     with `jq` instead of carrying the whole blob.
//  2. DISTILL (#3, uses the small util model): large *prose* output — raw text, or JSON
//     dominated by one big text field (web pages, transcripts, email bodies) — is
//     condensed to what's relevant to the user's request. The full text is kept on disk
//     as a fallback.
//  3. FAST COMPACTION (#5, uses the util model): when pi compacts the conversation, the
//     summary is produced by the small/fast model instead of the main 12B.
//
// The util model is reached directly over its OpenAI-compatible endpoint (no pi-ai
// imports, which don't resolve from an -e extension path). If it's unavailable, distill
// and custom-compaction degrade gracefully (prose left inline / default compaction).
//
// It also registers the long-term MEMORY injector (see memory.mjs) — both are "context"
// concerns and this is the one extension guaranteed loaded on every entry point.
import { writeFileSync, mkdirSync } from "node:fs";
import { registerMemory } from "./memory.mjs";

const SPILL_DIR = "/tmp/pi-spill";
const MIN = 4000; // chars; below this, never touch the output
const PROSE_MIN = 6000; // chars; only spend a distill call above this
const PREVIEW_ARRAY = 3;
const PREVIEW_STR = 240;
const UTIL_URL = process.env.UTIL_MODEL_URL ?? "http://llm-util:8080/v1/chat/completions";

const textOf = (parts) => (parts ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

function spill(id, body, ext) {
  mkdirSync(SPILL_DIR, { recursive: true });
  const path = `${SPILL_DIR}/${id}.${ext}`;
  writeFileSync(path, body);
  return path;
}

// Compact preview for list-like JSON: keep scalars, show first few of each array, cap strings.
function shrink(v) {
  if (Array.isArray(v)) {
    const head = v.slice(0, PREVIEW_ARRAY).map(shrink);
    if (v.length > PREVIEW_ARRAY) head.push(`…(${v.length} items total — full list in the file)`);
    return head;
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = shrink(v[k]);
    return o;
  }
  if (typeof v === "string" && v.length > PREVIEW_STR) return v.slice(0, PREVIEW_STR) + "…";
  return v;
}

// The longest top-level string field (web-read's .text, transcript's .transcript, etc.).
function dominantField(obj) {
  let best = null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (!best || v.length > best.len)) best = { key: k, len: v.length };
  }
  return best;
}

function lastUserText(ctx) {
  try {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === "message" && e.message?.role === "user") {
        const c = e.message.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((p) => p.type === "text").map((p) => p.text).join(" ");
      }
    }
  } catch { /* ignore */ }
  return "";
}

async function utilComplete(messages, maxTokens, signal) {
  try {
    const res = await fetch(UTIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "util-model", messages, max_tokens: maxTokens, temperature: 0.2, stream: false }),
      signal: signal ?? AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

const DISTILL_SYS =
  "You extract the relevant parts of CONTENT for another AI assistant to use. Keep what is " +
  "relevant to the user's request; preserve specific facts, numbers, names, dates, quotes, and " +
  "URLs verbatim; drop navigation, menus, ads, cookie/legal notices, and boilerplate. Be " +
  "faithful — never invent. " +
  "Output ONLY the extracted content itself: no preamble, no meta-commentary, no 'Here is a " +
  "summary', and do not address the user — begin directly with the content. If nothing is " +
  "relevant, output exactly: (no relevant content).";

async function distill(content, ctx, signal) {
  const task = lastUserText(ctx);
  return utilComplete(
    [
      { role: "system", content: DISTILL_SYS },
      { role: "user", content: `${task ? `User's request: ${task}\n\n` : ""}CONTENT:\n${content}` },
    ],
    1024,
    signal,
  );
}

export default function (pi) {
  // ---- long-term memory: inject the index into every run's system prompt ----
  registerMemory(pi);

  // ---- tool_result: spill list JSON, distill prose ----
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.isError) return;
    const text = textOf(event.content);
    if (text.length <= MIN) return;

    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      parsed = undefined;
    }

    // --- JSON ---
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const dom = dominantField(parsed);
      // Prose-dominated JSON (e.g. {url,title,text}) → distill the big field, keep metadata.
      if (dom && dom.len > PROSE_MIN && dom.len / text.length > 0.5) {
        const distilled = await distill(parsed[dom.key], ctx, ctx.signal);
        if (!distilled) return; // util down → leave inline (still summarizable)
        const path = spill(event.toolCallId, text, "json");
        const marker = `[Condensed extract of '${dom.key}' (${dom.len} chars), faithful to the source — to read the verbatim full text run: jq -r '.${dom.key}' ${path}]`;
        const slim = { ...parsed, [dom.key]: `${marker}\n\n${distilled}` };
        return { content: [{ type: "text", text: JSON.stringify(slim, null, 2) }] };
      }
      // Otherwise list-like/structured → spill + jq.
      const path = spill(event.toolCallId, text, "json");
      const preview = JSON.stringify(shrink(parsed), null, 2);
      const note =
        `\n\n[Large output (${text.length} chars); full JSON saved to ${path}. Preview shows the ` +
        `first ${PREVIEW_ARRAY} item(s) of each list — for more/specific fields, query the file with ` +
        `jq (e.g. \`jq '.results[].url' ${path}\`) instead of re-printing it.]`;
      return { content: [{ type: "text", text: preview + note }] };
    }

    // --- raw prose (non-JSON) ---
    if (text.length > PROSE_MIN) {
      const distilled = await distill(text, ctx, ctx.signal);
      if (!distilled) return;
      const path = spill(event.toolCallId, text, "txt");
      const marker = `[Condensed extract of the tool output (${text.length} chars), faithful to the source — full text at ${path} if you need exact details.]`;
      return { content: [{ type: "text", text: `${marker}\n\n${distilled}` }] };
    }
  });

  // ---- fast compaction: summarize with the small util model instead of the 12B ----
  pi.on("session_before_compact", async (event) => {
    const prep = event.preparation;
    if (!prep) return;
    const all = [...(prep.messagesToSummarize ?? []), ...(prep.turnPrefixMessages ?? [])];
    if (!all.length) return;

    const convo = all
      .map((m) => {
        const c = m.content;
        let body = "";
        if (typeof c === "string") body = c;
        else if (Array.isArray(c))
          body = c
            .map((p) => (p.type === "text" ? p.text : p.type === "toolCall" ? `[tool ${p.name} ${JSON.stringify(p.arguments)}]` : ""))
            .filter(Boolean)
            .join("\n");
        return body ? `## ${m.role}\n${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");

    const prev = prep.previousSummary ? `\n\nEarlier summary for context:\n${prep.previousSummary}` : "";
    const summary = await utilComplete(
      [
        {
          role: "system",
          content:
            "You summarize an AI assistant conversation so work can continue after older turns are " +
            "dropped. Capture: the user's goals, key decisions and facts, important results from tools/" +
            "skills, the current state of any work, and open questions or next steps. Thorough but " +
            "compact. Output structured markdown.",
        },
        { role: "user", content: `Summarize this conversation.${prev}\n\n<conversation>\n${convo}\n</conversation>` },
      ],
      2048,
      event.signal,
    );
    if (!summary) return; // fall back to pi's default compaction
    return { compaction: { summary, firstKeptEntryId: prep.firstKeptEntryId, tokensBefore: prep.tokensBefore } };
  });
}
