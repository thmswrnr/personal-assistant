// Loop guard: break degenerate "same tool call over and over" loops.
//
// A model sometimes gets stuck issuing the *same* tool call repeatedly with no new outcome
// (e.g. running a bash comment "# call websearch" instead of actually invoking the skill).
// Detect a run of identical consecutive tool calls and APPEND a corrective nudge to the result
// so the model breaks out. Append (not replace) → harmless on a false positive. State is
// per-process, so it resets every run.
//
// One dedicated concern, loaded via its own `-e` on every Core entry point. See also [[spill]],
// [[memory]], [[compaction]].

const LOOP_THRESHOLD = 4; // identical consecutive calls before we intervene

const textOf = (parts) => (parts ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

export default function register(pi) {
  const recentSigs = [];

  pi.on("tool_result", async (event) => {
    const cmd = event.input?.command;
    const sig =
      event.toolName + " " + (typeof cmd === "string" ? cmd.trim() : JSON.stringify(event.input ?? {}));
    recentSigs.push(sig);
    if (recentSigs.length > 16) recentSigs.shift();

    let streak = 0;
    for (let i = recentSigs.length - 1; i >= 0 && recentSigs[i] === sig; i--) streak++;
    if (streak < LOOP_THRESHOLD) return;

    const orig = textOf(event.content);
    const warn =
      `⚠️ LOOP GUARD: you have issued this exact ${event.toolName} call ${streak} times in a row with ` +
      `no new outcome — repeating it will not help. STOP and change tack:\n` +
      `• To use a skill, invoke it directly (e.g. \`/skill:websearch <query>\`) — do NOT write a bash ` +
      `comment like "# call websearch".\n` +
      `• Otherwise try a genuinely different command/approach, or tell the user you're stuck and what ` +
      `you need.\nDo not run the same call again.`;
    return { content: [{ type: "text", text: orig ? `${orig}\n\n${warn}` : warn }] };
  });
}
