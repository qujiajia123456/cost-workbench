const port = process.env.BIG_PM_CDP_PORT || "9333";

const pages = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!page) throw new Error(`No yanjianpm page found on CDP port ${port}`);

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
    .reverse()
    .find((item) => item.src.includes("XMSJLBPage"));
  if (!frame) return { ok: false, message: "XMSJLBPage iframe not found" };
  const win = frame.contentWindow;
  const doc = win.document;
  const Ext = win.Ext;
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const simple = (value) => {
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (typeof item !== "function" && typeof item !== "object") out[key] = item;
    }
    return out;
  };
  const components = [];
  if (Ext?.ComponentMgr?.all?.each) {
    Ext.ComponentMgr.all.each((cmp) => {
      const store = cmp.getStore ? cmp.getStore() : cmp.store;
      let fields = [];
      let rows = [];
      let total = undefined;
      try {
        fields = store?.fields?.items?.map((field) => field.name) || [];
        rows = store?.getRange ? store.getRange().map((record) => simple(record.data)) : [];
        total = store?.getTotalCount ? store.getTotalCount() : store?.getCount?.();
      } catch (e) {}
      let columns = [];
      try {
        const cm = cmp.getColumnModel ? cmp.getColumnModel() : cmp.colModel;
        columns = (cm?.config || cmp.columns || []).map((col) => ({
          header: clean(col.header || col.text),
          dataIndex: col.dataIndex,
          id: col.id,
          xtype: col.xtype,
          hidden: !!col.hidden,
          renderer: col.renderer ? String(col.renderer).slice(0, 1000) : ""
        }));
      } catch (e) {}
      if (store || columns.length || rows.length || /grid/i.test(cmp.getXType?.() || "")) {
        components.push({
          id: cmp.id,
          xtype: cmp.getXType ? cmp.getXType() : cmp.xtype,
          storeId: store?.storeId,
          total,
          fields,
          columns,
          rows
        });
      }
    });
  }
  const funcs = [];
  for (const key of Object.keys(win)) {
    if (/View|Handler|act_|open|CBDB|XMCB/i.test(key)) {
      try {
        if (typeof win[key] === "function") funcs.push({ key, source: String(win[key]).slice(0, 1200) });
      } catch (e) {}
    }
  }
  return {
    ok: true,
    frameUrl: frame.src,
    title: doc.title,
    text: clean(doc.body?.innerText || "").slice(0, 3000),
    components,
    funcs,
    cells: Array.from(doc.querySelectorAll("td,th,a")).map((el) => ({
      tag: el.tagName,
      text: clean(el.innerText || el.textContent),
      cls: el.className,
      onclick: el.getAttribute("onclick") || "",
      href: el.getAttribute("href") || "",
      html: el.innerHTML.slice(0, 500)
    })).filter((item) => item.text || item.onclick).slice(0, 200)
  };
})()`;

const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result?.result?.value || result.result?.value || result, null, 2));
}
ws.close();
