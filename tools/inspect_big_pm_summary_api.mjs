const pages = await fetch("http://localhost:9333/json/list").then((response) => response.json());
const candidates = pages.filter((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
const page = candidates.find((item) => item.url.includes("CBZHQKZPage")) || candidates[0];
if (!page) throw new Error("No big PM page found.");

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
  const win = globalThis;
  const grid = win.Ext?.getCmp?.("gridView");
  const methods = {};
  for (const key of Object.keys(win._this || {})) {
    if (typeof win._this[key] === "function") methods[key] = String(win._this[key]).slice(0, 300);
  }
  const globals = Object.keys(win)
    .filter((key) => /open|tab|page|xmsj|cbzh|detail|new/i.test(key))
    .slice(0, 200);
  const gridListeners = grid?.events ? Object.keys(grid.events) : [];
  const scriptText = Array.from(document.scripts).map((item) => item.textContent || "").join("\\n");
  const html = document.body.innerHTML.slice(0, 3000);
  return {
    title: document.title,
    url: location.href,
    hasThis: !!win._this,
    methods,
    globals,
    gridId: grid?.id,
    gridListeners,
    gridCellClick: String(grid?.events?.cellclick?.listeners?.[0]?.fn || grid?.events?.cellclick || "").slice(0, 1200),
    chartClickFunction: String(win.__chartClick || "").slice(0, 2000),
    chartMouseFunction: String(win.__chartMouseMove || "").slice(0, 1000),
    chartImage: (() => {
      const image = document.getElementById("Web_ChartResultView");
      if (!image) return null;
      const rect = image.getBoundingClientRect();
      return {
        id: image.id,
        src: image.getAttribute("src"),
        onclick: image.getAttribute("onclick"),
        width: rect.width,
        height: rect.height,
      };
    })(),
    xmsjMatches: (scriptText.match(/.{0,80}XMSJLB.{0,160}/g) || []).slice(0, 20),
    chartClickMatches: (scriptText.match(/.{0,80}__chartClick.{0,240}/g) || []).slice(0, 20),
    bodyText: clean(document.body.innerText).slice(0, 1000),
    html,
  };
})()`;
const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
ws.close();
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
console.log(JSON.stringify(result.result?.result?.value || result.result?.value, null, 2));
