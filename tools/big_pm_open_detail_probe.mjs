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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await send("Runtime.enable");

async function evalPage(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value ?? result.result?.value;
}

const opened = await evalPage(`(() => {
  const frame = Array.from(document.querySelectorAll("iframe"))
    .reverse()
    .find((item) => item.src.includes("XMSJLBPage"));
  const win = frame?.contentWindow;
  const grid = win?.Ext?.getCmp("GridResultView");
  const rec = grid?.getStore?.().getRange?.()[0];
  if (!win || !rec) return { ok: false, message: "list row not found" };
  const data = rec.data;
  if (win.$G?.Page?.act_View_Handler) {
    win.$G.Page.act_View_Handler(String(data.DEPTID), String(data.HSDX), String(data.HSDXID));
  } else if (win.act_View_Handler) {
    win.act_View_Handler(String(data.DEPTID), String(data.HSDX), String(data.HSDXID));
  } else {
    return { ok: false, message: "act_View_Handler not found", data };
  }
  return { ok: true, data };
})()`);
await sleep(5000);
const detail = await evalPage(`(() => {
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
  const frame = Array.from(document.querySelectorAll("iframe"))
    .reverse()
    .find((item) => item.src.includes("XMCBDBFXBPage") || item.src.includes("CBDB"));
  if (!frame) {
    return { ok: false, frames: Array.from(document.querySelectorAll("iframe")).map((f) => ({ id: f.id, src: f.src, title: (() => { try { return f.contentDocument?.title || ""; } catch (e) { return ""; } })() })) };
  }
  const win = frame.contentWindow;
  const doc = win.document;
  const Ext = win.Ext;
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
          hidden: !!col.hidden
        }));
      } catch (e) {}
      if (store || columns.length || rows.length || /grid/i.test(cmp.getXType?.() || "")) {
        components.push({ id: cmp.id, xtype: cmp.getXType ? cmp.getXType() : cmp.xtype, total, fields, columns, rows });
      }
    });
  }
  return {
    ok: true,
    frameUrl: frame.src,
    title: doc.title,
    text: clean(doc.body?.innerText || "").slice(0, 5000),
    components,
    cells: Array.from(doc.querySelectorAll("td,th")).map((el) => ({
      text: clean(el.innerText || el.textContent),
      cls: el.className,
      html: el.innerHTML.slice(0, 500)
    })).filter((item) => item.text).slice(0, 300)
  };
})()`);
console.log(JSON.stringify({ opened, detail }, null, 2));
ws.close();
