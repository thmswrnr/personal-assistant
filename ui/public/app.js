const $ = (id) => document.getElementById(id);
const log = $("log");

function addMsg(cls) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

let streaming = false;

function ask(q) {
  if (!q.trim() || streaming) return;
  streaming = true;
  $("send").disabled = true;
  $("q").value = "";
  addMsg("user").textContent = q;

  const bot = addMsg("bot");
  const tool = document.createElement("div");
  tool.className = "tool";
  bot.appendChild(tool);
  const text = document.createElement("span");
  bot.appendChild(text);

  const es = new EventSource(`/api/chat?q=${encodeURIComponent(q)}`);
  es.addEventListener("text", (e) => {
    text.textContent += JSON.parse(e.data);
    log.scrollTop = log.scrollHeight;
  });
  es.addEventListener("tool", (e) => {
    const t = JSON.parse(e.data);
    tool.textContent = t.phase === "start" ? `🔧 ${t.name}…` : "";
  });
  es.addEventListener("error", (e) => {
    try { text.textContent += `\n[error: ${JSON.parse(e.data).message}]`; } catch {}
  });
  const finish = () => { es.close(); streaming = false; $("send").disabled = false; tool.textContent = ""; refresh(); };
  es.addEventListener("done", finish);
  es.onerror = () => { if (streaming) finish(); };
}

$("chat").addEventListener("submit", (e) => { e.preventDefault(); ask($("q").value); });
document.querySelectorAll(".actions button").forEach((b) =>
  b.addEventListener("click", () => ask(b.dataset.cmd)));

// ---- panels ----
async function refresh() {
  try {
    const s = await (await fetch("/api/status")).json();
    const ok = s.llm === "healthy";
    $("status").innerHTML =
      `<span class="dot ${ok ? "ok" : "bad"}"></span>${ok ? `model: ${s.model ?? "?"}` : "LLM offline"}`;
  } catch { $("status").innerHTML = `<span class="dot bad"></span>offline`; }

  try {
    const { count } = await (await fetch("/api/inbox")).json();
    $("inbox").textContent = count === 0 ? "No files waiting." : `${count} file(s) waiting to process.`;
  } catch {}

  try {
    const { text } = await (await fetch("/api/todos")).json();
    $("todos").textContent = text.trim() || "—";
  } catch {}

  try {
    const { notes } = await (await fetch("/api/notes")).json();
    $("notes").innerHTML = notes.length
      ? notes.map((n) => `<div class="note"><b>${n.file}</b><br>${n.preview.replace(/</g, "&lt;")}</div>`).join("")
      : '<span class="muted">No notes yet.</span>';
  } catch {}
}

refresh();
setInterval(refresh, 30000);
