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
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const frame = Array.from(document.querySelectorAll("iframe"))
    .reverse()
    .find((item) => item.src.includes("XMCBDBFXBPage"));
  if (!frame) return { ok: false, message: "detail frame not found" };
  const win = frame.contentWindow;
  const doc = win.document;
  const grid = win.Ext?.getCmp("treeGrid");
  const readNode = (node, depth = 0) => {
    if (!node || depth > 5) return null;
    const attrs = node.attributes || node.data || {};
    const childNodes = node.childNodes || [];
    return {
      id: node.id,
      text: node.text,
      leaf: node.leaf,
      attrs,
      childCount: childNodes.length,
      children: Array.from(childNodes).slice(0, 50).map((child) => readNode(child, depth + 1))
    };
  };
  const root = (() => {
    try { return readNode(grid.getRootNode?.()); } catch (e) { return { error: String(e) }; }
  })();
  const allRows = Array.from(doc.querySelectorAll(".x-grid3-row, .x-treegrid-node, tr")).map((row, ri) => ({
    ri,
    text: clean(row.innerText || row.textContent),
    html: row.innerHTML.slice(0, 1500)
  })).filter((row) => row.text);
  const globals = Object.keys(win)
    .filter((key) => /tree|CBDB|Data|Result|Load|Query|Page/i.test(key))
    .slice(0, 120)
    .map((key) => {
      let value = "";
      try {
        value = typeof win[key] === "function" ? String(win[key]).slice(0, 1200) : String(win[key]).slice(0, 300);
      } catch (e) { value = "[unreadable]"; }
      return { key, value };
    });
  return {
    ok: true,
    frameUrl: frame.src,
    gridKeys: grid ? Object.keys(grid).filter((key) => /root|store|loader|data|view|query|load/i.test(key)).slice(0, 100) : [],
    root,
    rows: allRows.slice(0, 300),
    globals
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
