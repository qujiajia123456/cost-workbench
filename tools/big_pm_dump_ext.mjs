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
    .find((item) => item.src.includes("CBZHQKZPage"));
  if (!frame) return { ok: false, message: "CBZHQKZPage iframe not found" };
  const win = frame.contentWindow;
  const doc = win.document;
  const Ext = win.Ext;
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const simple = (value, depth = 0, seen = new Set()) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") return "[Function]";
    if (depth >= 3) return "[Object]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => simple(item, depth + 1, seen));
    const out = {};
    for (const key of Object.keys(value).slice(0, 60)) {
      try {
        const item = value[key];
        if (typeof item === "function") continue;
        out[key] = simple(item, depth + 1, seen);
      } catch (e) {}
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
        rows = store?.getRange ? store.getRange().slice(0, 20).map((record) => simple(record.data)) : [];
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
          renderer: col.renderer ? String(col.renderer).slice(0, 500) : ""
        }));
      } catch (e) {}
      const events = {};
      try {
        for (const [name, item] of Object.entries(cmp.events || {})) {
          if (item?.listeners?.length) events[name] = item.listeners.length;
        }
      } catch (e) {}
      if (store || columns.length || rows.length || /grid|panel|store/i.test(cmp.getXType?.() || "")) {
        components.push({
          id: cmp.id,
          itemId: cmp.itemId,
          xtype: cmp.getXType ? cmp.getXType() : cmp.xtype,
          title: clean(cmp.title),
          storeId: store?.storeId,
          total,
          fields,
          columns,
          rows,
          events
        });
      }
    });
  }
  const globals = Object.keys(win)
    .filter((key) => /GSID|DEPT|HSDX|LX|Grid|Store|CBZH|Query/i.test(key))
    .slice(0, 200)
    .map((key) => {
      let value = "";
      try { value = simple(win[key]); } catch (e) { value = "[unreadable]"; }
      return { key, value };
    });
  const cells = Array.from(doc.querySelectorAll("td,th")).map((td, index) => ({
    index,
    text: clean(td.innerText || td.textContent),
    cls: td.className,
    onclick: td.getAttribute("onclick") || "",
    html: td.innerHTML.slice(0, 600)
  })).filter((cell) => cell.text || cell.onclick || /GS\\d|LX|KS|BKSD/i.test(cell.html));
  return {
    ok: true,
    pageUrl: location.href,
    frameUrl: frame.src,
    title: doc.title,
    bodyText: clean(doc.body?.innerText || "").slice(0, 4000),
    components,
    globals,
    cells
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
