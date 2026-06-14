// Context-saver extension for Core.
//
// Keeps the model's context lean by intercepting LARGE, STRUCTURED (JSON) tool
// outputs: the full result is written to a file and replaced in-context with a
// compact preview + the file path. The model can then pull exactly what it needs
// with `jq` instead of carrying the whole blob through the rest of the conversation.
//
// Deterministic and free (no extra LLM call). Only touches JSON output above a size
// threshold; non-JSON prose (web pages, transcripts) is left untouched here — that's
// the distiller's job. Errors fall back to leaving the original output unchanged.
import { writeFileSync, mkdirSync } from "node:fs";

const THRESHOLD = 4000; // chars; smaller outputs stay inline
const SPILL_DIR = "/tmp/pi-spill";
const PREVIEW_ARRAY = 3; // items shown per list in the preview
const PREVIEW_STR = 240; // cap long strings in the preview

// Build a compact, representative preview: keep scalar fields, show the first few
// items of each array, and cap long strings — so the model sees the shape + a sample.
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

export default function (pi) {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || event.isError) return;
    const parts = event.content ?? [];
    const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (text.length <= THRESHOLD) return;

    // Only handle structured JSON here. Non-JSON output is left for the distiller.
    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;

    try {
      mkdirSync(SPILL_DIR, { recursive: true });
      const path = `${SPILL_DIR}/${event.toolCallId}.json`;
      writeFileSync(path, text);
      const preview = JSON.stringify(shrink(parsed), null, 2);
      const note =
        `\n\n[This output was large (${text.length} chars); the full JSON is saved to ${path}. ` +
        `The preview above shows the first ${PREVIEW_ARRAY} item(s) of each list. For more, or for ` +
        `specific fields, query the file with jq instead of re-printing it — ` +
        `e.g. \`jq '.results[].url' ${path}\` or \`jq '.videos[] | select(.channel=="X")' ${path}\`.]`;
      return { content: [{ type: "text", text: preview + note }] };
    } catch {
      return; // never let the extension break a tool result
    }
  });
}
