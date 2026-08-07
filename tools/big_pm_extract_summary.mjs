const port = process.env.BIG_PM_CDP_PORT || "9333";
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
  const frame = Array.from(document.querySelectorAll("iframe"))
    .find((f) => f.src.includes("CBZHQKZPage"));
  if (!frame) return { ok: false, message: "CBZHQKZPage iframe not found" };
  const doc = frame.contentDocument || frame.contentWindow.document;
  const rows = Array.from(doc.querySelectorAll("tr")).map((tr, ri) => {
    const cells = Array.from(tr.querySelectorAll("td,th")).map((td, ci) => ({
      ci,
      text: (td.innerText || td.textContent || "").trim(),
      html: td.innerHTML.slice(0, 1000),
      links: Array.from(td.querySelectorAll("a")).map((a) => ({
        text: (a.innerText || a.textContent || "").trim(),
        href: a.href,
        onclick: a.getAttribute("onclick")
      }))
    }));
    return { ri, cells };
  }).filter((r) => r.cells.some((c) => c.text));
  const fields = [];
  if (frame.contentWindow.Ext) {
    try {
      const cmps = [];
      frame.contentWindow.Ext.ComponentMgr.all.each((c) => cmps.push({
        id: c.id,
        xtype: c.getXType ? c.getXType() : "",
        title: c.title || "",
        itemId: c.itemId || "",
        storeCount: c.getStore ? c.getStore()?.getCount?.() : undefined,
        storeTotal: c.getStore ? c.getStore()?.getTotalCount?.() : undefined
      }));
      fields.push(...cmps);
    } catch (e) {}
  }
  return { ok: true, url: frame.src, text: doc.body.innerText.slice(0, 2500), rows, components: fields.slice(0, 80) };
})()`;
const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(result.result?.result?.value || result.result?.value || result, null, 2));
ws.close();
