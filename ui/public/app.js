const $ = (id) => document.getElementById(id);
const log = $("log");
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ---- chat ----
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

  // collapsible live reasoning (hidden until thinking arrives)
  const thinkWrap = document.createElement("details");
  thinkWrap.className = "think-wrap";
  thinkWrap.open = true;
  thinkWrap.style.display = "none";
  const sum = document.createElement("summary");
  sum.textContent = "💭 reasoning";
  const think = document.createElement("div");
  think.className = "think";
  thinkWrap.append(sum, think);

  const tool = document.createElement("div");
  tool.className = "tool";
  const text = document.createElement("span");
  bot.append(thinkWrap, tool, text);

  let answerStarted = false;
  const es = new EventSource(`/api/chat?q=${encodeURIComponent(q)}`);

  es.addEventListener("thinking", (e) => {
    thinkWrap.style.display = "";
    think.textContent += JSON.parse(e.data);
    think.scrollTop = think.scrollHeight;
    log.scrollTop = log.scrollHeight;
  });
  es.addEventListener("text", (e) => {
    if (!answerStarted) { answerStarted = true; thinkWrap.open = false; }
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
  const finish = () => {
    es.close(); streaming = false; $("send").disabled = false; tool.textContent = "";
    if (!think.textContent) thinkWrap.remove();
    refresh();
  };
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
    const items = text.split("\n").map((l) => l.trim()).filter((l) => /^- \[[ xX]\]/.test(l));
    $("todos").innerHTML = items.length
      ? items.map((l) => {
          const done = /^- \[[xX]\]/.test(l);
          const label = esc(l.replace(/^- \[[ xX]\]\s*/, ""));
          return `<div class="todo ${done ? "done" : ""}">${done ? "☑" : "☐"} ${label}</div>`;
        }).join("")
      : '<span class="muted">No todos.</span>';
  } catch {}

  try {
    const { notes } = await (await fetch("/api/notes")).json();
    $("notes").innerHTML = notes.length
      ? notes.map((n) => `<div class="note"><b>${esc(n.file)}</b><br>${esc(n.preview)}</div>`).join("")
      : '<span class="muted">No notes yet.</span>';
  } catch {}
}

refresh();
setInterval(refresh, 30000);
