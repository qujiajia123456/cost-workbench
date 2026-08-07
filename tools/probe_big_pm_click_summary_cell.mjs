const port = process.env.BIG_PM_CDP_PORT || "9333";
const targetCompany = process.env.BIG_PM_COMPANY || "格瑞特";
const targetTitle = process.env.BIG_PM_TITLE || "亏损";

const pages = await fetch(`http://localhost:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("CBZHQKZPage"));
if (!page) throw new Error(`No big PM summary page found on ${port}.`);

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
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value ?? result.result?.value;
}
await send("Runtime.enable");

const clickResult = await evaluate(`(() => {
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const grid = globalThis.Ext?.getCmp?.("gridView");
  if (!grid) return { ok: false, message: "gridView not found" };
  const store = grid.getStore();
  const rows = store.getRange().map((record) => record.data);
  const rowIndex = rows.findIndex((row) => clean(row.BT || row.LX) === ${JSON.stringify(targetTitle)});
  const columns = grid.getColumnModel().config || [];
  const colIndex = columns.findIndex((col) => clean(col.header).includes(${JSON.stringify(targetCompany)}));
  if (rowIndex < 0 || colIndex < 0) return { ok: false, rowIndex, colIndex, titles: rows.map((row) => clean(row.BT || row.LX)), columns: columns.map((col) => clean(col.header)) };
  const view = grid.getView();
  const cell = view.getCell(rowIndex, colIndex);
  if (!cell) return { ok: false, message: "cell not found", rowIndex, colIndex };
  const rect = cell.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  for (const type of ["mouseover", "mousemove", "mousedown", "mouseup", "click"]) {
    cell.dispatchEvent(new MouseEvent(type, eventInit));
  }
  grid.fireEvent?.("cellclick", grid, rowIndex, colIndex, { target: cell, getTarget: () => cell, browserEvent: new MouseEvent("click", eventInit) });
  return { ok: true, rowIndex, colIndex, value: clean(cell.innerText || cell.textContent), html: cell.innerHTML.slice(0, 500), rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
})()`);

await new Promise((resolve) => setTimeout(resolve, 2500));
const afterPages = await fetch(`http://localhost:${port}/json/list`).then((response) => response.json());
const after = await evaluate(`(() => {
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  return {
    frames: Array.from(document.querySelectorAll("iframe")).map((frame) => ({
      id: frame.id,
      name: frame.name,
      src: frame.src,
      title: (() => { try { return frame.contentDocument?.title || ""; } catch { return ""; } })(),
      text: (() => { try { return clean(frame.contentDocument?.body?.innerText || "").slice(0, 500); } catch { return ""; } })(),
    })),
    bodyText: clean(document.body.innerText).slice(0, 1000),
  };
})()`);
ws.close();
console.log(JSON.stringify({ clickResult, afterPages, after }, null, 2));
