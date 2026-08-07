const pages = await fetch("http://localhost:9333/json/list").then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("CBZHQKZPage"));
if (!page) throw new Error("No big PM summary page found on 9333.");

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
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const number = (value) => {
    const n = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const grid = globalThis.Ext?.getCmp("gridView");
  if (!grid) return { ok: false, message: "gridView not found" };
  const rows = grid.getStore().getRange().map((record) => record.data);
  const columns = (grid.getColumnModel?.().config || [])
    .filter((col) => /^GS\\d+$/.test(col.dataIndex || "") && clean(col.header));
  return {
    ok: true,
    rows: rows.map((row) => ({
      title: clean(row.BT || row.LX),
      HJ: number(row.HJ),
      sum: columns.reduce((sum, col) => sum + number(row[col.dataIndex]), 0),
      companies: columns.map((col) => ({
        company: clean(col.header),
        value: number(row[col.dataIndex]),
      })),
    })),
  };
})()`;
const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
ws.close();
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
console.log(JSON.stringify(result.result?.result?.value || result.result?.value, null, 2));
