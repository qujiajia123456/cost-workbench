const port = process.env.BIG_PM_CDP_PORT || "9333";
const urlNeedle = process.env.BIG_PM_URL_NEEDLE || "XMSJLBPage";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) =>
  item.type === "page" &&
  item.url.includes(urlNeedle)
) || pages.find((item) =>
  item.type === "page" &&
  item.url.includes("yanjianpm.glodon.com")
);

if (!page) throw new Error(`No page found on ${port} for ${urlNeedle}`);

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
  else callback.resolve(message.result);
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
await send("Runtime.enable");

const result = await send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(() => {
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const components = [];
    const simplify = (value) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.slice(0, 10).map(simplify);
      const out = {};
      for (const key of Object.keys(value).slice(0, 80)) {
        const item = value[key];
        if (typeof item !== "function") out[key] = item;
      }
      return out;
    };
    if (globalThis.Ext?.ComponentMgr?.all?.each) {
      Ext.ComponentMgr.all.each((cmp) => {
        const store = cmp.getStore?.() || cmp.store;
        const cm = cmp.getColumnModel?.() || cmp.colModel;
        const columns = (cm?.config || cmp.columns || []).map((col) => ({
          header: clean(col.header || col.text),
          dataIndex: col.dataIndex,
          id: col.id,
          hidden: !!col.hidden,
          renderer: col.renderer ? String(col.renderer).slice(0, 700) : ""
        }));
        const rows = store?.getRange?.().map((record) => simplify(record.data)) || [];
        const fields = store?.fields?.items?.map((field) => field.name) || [];
        const total = Number(store?.getTotalCount?.() ?? store?.getCount?.() ?? rows.length);
        if (store || rows.length || columns.length) {
          components.push({
            id: cmp.id,
            xtype: cmp.getXType?.() || cmp.xtype,
            title: clean(cmp.title),
            storeId: store?.storeId,
            total,
            fields,
            columns,
            rows
          });
        }
      });
    }
    return {
      page: { title: document.title, url: location.href },
      bodyText: clean(document.body?.innerText || "").slice(0, 2000),
      components
    };
  })()`
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
