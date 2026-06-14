// Core dashboard backend: embeds the pi SDK and serves a lean local web UI.
// - GET /                  → dashboard (static)
// - GET /api/chat?q=...    → SSE stream of the agent's response to a prompt
// - GET /api/status        → llm health + model id
// - GET /api/todos         → storage/todos.md (text)
// - GET /api/notes         → recent notes (filenames + previews)
// - GET /api/inbox         → count of files waiting in storage/inbox
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const PORT = 3000;
const PUBLIC = join(import.meta.dirname, "public");
const STORAGE = "/app/storage";
const LLM = "http://llm:8080";
const PROVIDER = "local";
const MODEL_ID = "local-model";
const THINKING = process.env.UI_THINKING_LEVEL ?? "low"; // off|low|medium|high

// ---- pi agent session (single, shared — this is a personal, single-user UI) ----
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const model = modelRegistry.find(PROVIDER, MODEL_ID);
if (!model) {
  console.error(`Model ${PROVIDER}/${MODEL_ID} not found — check data/memory/.pi/models.json`);
  process.exit(1);
}
const { session } = await createAgentSession({
  model,
  thinkingLevel: THINKING,
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});
let busy = false;
console.log(`[ui] agent ready: ${model.provider}/${model.id} (thinking=${THINKING})`);

// ---- helpers ----
const send = (res, code, type, body) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, "application/json", JSON.stringify(obj));

function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}
const sseSend = (res, event, data) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// ---- chat: stream one prompt's events as SSE ----
// `image` (optional) is { data: <base64>, mimeType } — passed to the multimodal
// model as a pi ImageContent attachment alongside the text prompt.
async function handleChat(q, image, res) {
  if (busy) {
    sseInit(res);
    sseSend(res, "error", { message: "Core is busy with another request." });
    res.end();
    return;
  }
  busy = true;
  sseInit(res);
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta")
          sseSend(res, "text", event.assistantMessageEvent.delta);
        else if (event.assistantMessageEvent.type === "thinking_delta")
          sseSend(res, "thinking", event.assistantMessageEvent.delta);
        break;
      case "tool_execution_start":
        sseSend(res, "tool", { name: event.toolName, phase: "start" });
        break;
      case "tool_execution_end":
        sseSend(res, "tool", { name: event.toolName, phase: "end", error: !!event.isError });
        break;
    }
  });
  try {
    const images = image?.data
      ? [{ type: "image", data: image.data, mimeType: image.mimeType ?? "image/png" }]
      : undefined;
    await session.prompt(q, images ? { images } : undefined);
    sseSend(res, "done", {});
  } catch (err) {
    sseSend(res, "error", { message: String(err?.message ?? err) });
  } finally {
    unsubscribe();
    busy = false;
    res.end();
  }
}

// Read and parse a JSON request body, capped so a pasted image can't exhaust memory.
function readJsonBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ---- panels ----
async function panelStatus() {
  const out = { llm: "down", model: null, history: 0 };
  try {
    out.history = session.agent?.state?.messages?.length ?? 0;
  } catch { /* ignore */ }
  try {
    const h = await fetch(`${LLM}/health`, { signal: AbortSignal.timeout(2000) });
    out.llm = h.ok ? "healthy" : "unhealthy";
    const m = await fetch(`${LLM}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (m.ok) out.model = (await m.json()).data?.[0]?.id ?? null;
  } catch { /* llm down */ }
  return out;
}

// Clear the conversation so the prompt stops growing (history bloat = slowdown).
function resetSession() {
  if (busy) return { ok: false, error: "busy" };
  try {
    session.agent.state.messages = [];
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
async function panelTodos() {
  try {
    return { text: await readFile(join(STORAGE, "todos.md"), "utf8") };
  } catch {
    return { text: "" };
  }
}
async function panelNotes() {
  try {
    const dir = join(STORAGE, "notes");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    const notes = [];
    for (const f of files.slice(-10).reverse()) {
      const text = await readFile(join(dir, f), "utf8");
      notes.push({ file: f, preview: text.slice(0, 240) });
    }
    return { notes };
  } catch {
    return { notes: [] };
  }
}
async function panelInbox() {
  try {
    const entries = await readdir(join(STORAGE, "inbox"));
    let count = 0;
    for (const e of entries) {
      const s = await stat(join(STORAGE, "inbox", e));
      if (s.isFile()) count++;
    }
    return { count };
  } catch {
    return { count: 0 };
  }
}

// ---- static files ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
async function serveStatic(pathname, res) {
  const file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  try {
    const body = await readFile(join(PUBLIC, file));
    send(res, 200, MIME[extname(file)] ?? "application/octet-stream", body);
  } catch {
    send(res, 404, "text/plain", "not found");
  }
}

// ---- router ----
createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p === "/api/chat") {
      // POST carries an optional image attachment in the JSON body; GET (no image)
      // is kept for simple text-only calls.
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        return await handleChat(body.q ?? "", body.image ?? null, res);
      }
      return await handleChat(url.searchParams.get("q") ?? "", null, res);
    }
    if (p === "/api/reset") return json(res, 200, resetSession());
    if (p === "/api/status") return json(res, 200, await panelStatus());
    if (p === "/api/todos") return json(res, 200, await panelTodos());
    if (p === "/api/notes") return json(res, 200, await panelNotes());
    if (p === "/api/inbox") return json(res, 200, await panelInbox());
    return await serveStatic(p, res);
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`[ui] listening on :${PORT}`));
