const port = process.env.BIG_PM_CDP_PORT || "9333";
const text = process.argv[2];
if (!text) throw new Error("缺少要点击的文本");
const pages = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!page) throw new Error(`未找到 ${port} 中的大PM页面`);

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  callback(message);
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
const expression = `(() => {
  const target = ${JSON.stringify(text)};
  const exact = [];
  const contains = [];
  const all = Array.from(document.querySelectorAll("a,button,span,div,td,li"));
  for (const el of all) {
    const t = (el.innerText || el.textContent || "").trim();
    if (!t) continue;
    if (t === target) exact.push(el);
    else if (t.includes(target)) contains.push(el);
  }
  const el = exact[0] || contains[0];
  if (!el) return { ok: false, message: "not found", target, sample: all.map(e => (e.innerText || e.textContent || "").trim()).filter(Boolean).slice(0, 80) };
  el.scrollIntoView({ block: "center", inline: "center" });
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  el.click();
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  return { ok: true, text: (el.innerText || el.textContent || "").trim(), tag: el.tagName, id: el.id, cls: el.className, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
})()`;
const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(result.result?.result?.value || result.result?.value || result, null, 2));
ws.close();
