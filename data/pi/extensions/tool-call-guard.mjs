// Tool-call guard: recover when the model leaks a malformed tool-call token as plain text.
//
// Alan/vLLM parses gemma's tool calls server-side and hands pi structured `tool_calls`. When
// the model occasionally drifts off-format, that server parser misses and the raw tool-call
// syntax (e.g. `<|tool_call>call:Agent{…}`) falls through into the assistant message as TEXT —
// so pi executes nothing and the run stalls/dies. We can't fix the parse (it's upstream at
// Alan); we can only catch the leak downstream: on a leaked assistant message, inject a
// corrective user message so the model re-issues a REAL tool call. Capped — after a few tries a
// model that keeps leaking is told to stop and report, so we never loop. State is per-process,
// so it resets every run.
//
// One dedicated concern, loaded via its own `-e` on every Core entry point. See also
// [[loop-guard]], [[spill]], [[memory]].

const MAX_NUDGES = 2; // corrective retries before we tell the model to give up cleanly

// Distinctive leaked-token marker — covers `<|tool_call>` and `<|tool_call|>`. Normal prose
// never contains this, so a match means a tool call failed to parse and spilled into text.
const LEAK = /<\|tool_call/i;

const textOf = (parts) => (parts ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

export default function register(pi) {
  // Injection lives on the registration object, not the event ctx. Guard against API drift so a
  // missing method can never crash the very run we're trying to rescue.
  if (typeof pi.sendUserMessage !== "function") {
    return;
  }

  let nudges = 0;
  let gaveUp = false;

  pi.on("message_end", async (event) => {
    const msg = event.message;
    if (!msg || msg.role !== "assistant") {
      return;
    }

    if (!LEAK.test(textOf(msg.content))) {
      return;
    }

    if (gaveUp) {
      // Already told it to stop — stay quiet so we don't loop on repeated leaks.
      return;
    }

    if (nudges >= MAX_NUDGES) {
      gaveUp = true;
      pi.sendUserMessage(
        "⚠️ TOOL-CALL GUARD: your tool calls keep coming back as unparsed text (a " +
          "`<|tool_call|>` token leaked into your reply) and retries aren't helping. STOP trying " +
          "that tool. Either complete the task another way, or tell the user plainly that the " +
          "tool layer is failing right now and what you were trying to do.",
        { deliverAs: "followUp" },
      );
      return;
    }

    nudges++;
    pi.sendUserMessage(
      "⚠️ TOOL-CALL GUARD: your previous reply printed a raw `<|tool_call|>` token instead of " +
        "making an actual tool call, so nothing ran. Do NOT write tool-call syntax as text. " +
        "Re-issue it as a real tool call now and the harness will execute it — if you meant to " +
        "delegate, call the Agent tool properly; otherwise call the tool you intended.",
      { deliverAs: "followUp" },
    );
  });
}
