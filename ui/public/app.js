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
let pendingImage = null; // { data: base64, mimeType, dataUrl }

async function ask(q) {
  q = q.trim();
  if ((!q && !pendingImage) || streaming) return;
  streaming = true;
  $("send").disabled = true;
  $("q").value = "";

  // user bubble — show the attached image (if any) above the text
  const user = addMsg("user");
  if (pendingImage) {
    const img = document.createElement("img");
    img.className = "att";
    img.src = pendingImage.dataUrl;
    user.appendChild(img);
  }
  if (q) user.appendChild(document.createTextNode(q));
  const image = pendingImage ? { data: pendingImage.data, mimeType: pendingImage.mimeType } : null;
  clearAttachment();

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
  const onEvent = (ev, data) => {
    if (ev === "thinking") {
      thinkWrap.style.display = "";
      think.textContent += data;
      think.scrollTop = think.scrollHeight;
      log.scrollTop = log.scrollHeight;
    } else if (ev === "text") {
      if (!answerStarted) { answerStarted = true; thinkWrap.open = false; }
      text.textContent += data;
      log.scrollTop = log.scrollHeight;
    } else if (ev === "tool") {
      const t = JSON.parse(data);
      tool.textContent = t.phase === "start" ? `🔧 ${t.name}…` : "";
    } else if (ev === "error") {
      try { text.textContent += `\n[error: ${JSON.parse(data).message}]`; } catch {}
    }
  };

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, image }),
    });
    // Parse the SSE stream manually (EventSource is GET-only, can't carry an image).
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let ev = "message", payload = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) payload += line.slice(5).trim();
        }
        if (ev === "done") { buf = ""; break; }
        if (payload) onEvent(ev, ev === "thinking" || ev === "text" ? JSON.parse(payload) : payload);
      }
    }
  } catch (err) {
    text.textContent += `\n[error: ${err}]`;
  } finally {
    streaming = false; $("send").disabled = false; tool.textContent = "";
    if (!think.textContent) thinkWrap.remove();
    refresh();
  }
}

// ---- image attachment ----
function setAttachment(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    pendingImage = {
      dataUrl,
      mimeType: file.type,
      data: String(dataUrl).split(",")[1], // strip "data:...;base64,"
    };
    $("attachbar").innerHTML = "";
    const chip = document.createElement("div");
    chip.className = "chip";
    const img = document.createElement("img");
    img.src = dataUrl;
    const name = document.createElement("span");
    name.textContent = file.name || "pasted image";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "✕"; x.title = "Remove";
    x.addEventListener("click", clearAttachment);
    chip.append(img, name, x);
    $("attachbar").appendChild(chip);
  };
  reader.readAsDataURL(file);
}
function clearAttachment() {
  pendingImage = null;
  $("attachbar").innerHTML = "";
  $("file").value = "";
}

$("attach").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => setAttachment(e.target.files[0]));
$("q").addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) { setAttachment(item.getAsFile()); e.preventDefault(); }
});
const main = document.querySelector("main");
["dragover", "dragenter"].forEach((ev) =>
  main.addEventListener(ev, (e) => { e.preventDefault(); main.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  main.addEventListener(ev, (e) => { e.preventDefault(); main.classList.remove("drag"); }));
main.addEventListener("drop", (e) => setAttachment(e.dataTransfer?.files?.[0]));

$("chat").addEventListener("submit", (e) => { e.preventDefault(); ask($("q").value); });
document.querySelectorAll(".actions button").forEach((b) =>
  b.addEventListener("click", () => ask(b.dataset.cmd)));
$("reset").addEventListener("click", async () => {
  if (streaming) return;
  try { await fetch("/api/reset"); } catch {}
  log.innerHTML = "";
  refresh();
});

// ---- panels ----
async function refresh() {
  try {
    const s = await (await fetch("/api/status")).json();
    const ok = s.llm === "healthy";
    $("status").innerHTML =
      `<span class="dot ${ok ? "ok" : "bad"}"></span>${ok ? `model: ${s.model ?? "?"}` : "LLM offline"}` +
      (s.history ? ` · ${s.history} msgs` : "");
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
