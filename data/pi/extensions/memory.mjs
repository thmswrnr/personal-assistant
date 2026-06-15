// Long-term memory injection for Core.
//
// Core runs are stateless (one-shot `pi` per command, scheduled job, or Telegram message),
// so durable facts must be *present* in every run rather than read on a hunch. This module
// appends the memory INDEX (one line per fact) to the system prompt on every prompt. The
// index is tiny by design; full fact files live under `storage/memory/` and the agent reads
// only the ones whose description looks relevant — same progressive disclosure as skills.
//
// Loaded by being registered from context-saver.mjs (which is already `-e`'d on every entry
// point: interactive core.sh, the Telegram bot, the scheduler, and one-off runs).
import { readFileSync } from "node:fs";

const DIR = process.env.CORE_MEMORY_DIR ?? "/app/storage/memory";
const INDEX = `${DIR}/MEMORY.md`;

export function registerMemory(pi) {
  // Fires once after the user submits a prompt, before the agent loop. We only extend the
  // system prompt (framing/context), never inject a conversational message — so memory does
  // not bloat the message history or get carried through compaction.
  pi.on("before_agent_start", async (event) => {
    let index;
    try {
      index = readFileSync(INDEX, "utf8").trim();
    } catch {
      return; // no memory yet → nothing to add
    }
    if (!index) return;
    const block =
      "\n\n# Long-term memory\n" +
      "Durable facts you've saved about the user and ongoing work. Each line links a file " +
      "under `storage/memory/`; when a line looks relevant to the request, READ that file " +
      "for the full detail before relying on it. To record a new durable fact (or correct/" +
      "remove one), use `/skill:remember` — do this when the user tells you to remember " +
      "something, or when a clearly durable fact or preference emerges. Don't save " +
      "one-off/ephemeral details.\n\n" +
      index;
    return { systemPrompt: event.systemPrompt + block };
  });
}
