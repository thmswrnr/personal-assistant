// Spill: keep the model's context lean, deterministically and for free (no model call).
//
// Large JSON tool output (bash) is written to a file and replaced in-context with a compact
// preview + the path. The model queries the file with `jq` instead of carrying the whole blob.
// Non-JSON prose is left inline — pi's native compaction keeps the conversation bounded.
//
// One dedicated concern, loaded via its own `-e` on every Core entry point (interactive
// core.sh, the Telegram bot, the scheduler, and one-off runs). See also [[loop-guard]],
// [[memory]], [[compaction]].
import { writeFileSync, mkdirSync } from "node:fs";

const SPILL_DIR = "/tmp/pi-spill";
const MIN = 4000; // chars; below this, never touch the output
const PREVIEW_ARRAY = 3;
const PREVIEW_STR = 240;

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

export default function register(pi) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash" || event.isError) return;
    const text = textOf(event.content);
    if (text.length <= MIN) return;

    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      parsed = undefined;
    }

    // Large JSON (object or array) → spill to a file, leave a compact preview + jq hint.
    if (parsed && typeof parsed === "object") {
      const path = spill(event.toolCallId, text, "json");
      const preview = JSON.stringify(shrink(parsed), null, 2);
      const note =
        `\n\n[Large output (${text.length} chars); full JSON saved to ${path}. Preview shows the ` +
        `first ${PREVIEW_ARRAY} item(s) of each list — for more/specific fields, query the file with ` +
        `jq (e.g. \`jq '.results[].url' ${path}\`) instead of re-printing it.]`;
      return { content: [{ type: "text", text: preview + note }] };
    }
  });
}
