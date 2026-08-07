const pages = await fetch("http://localhost:9333/json/list").then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("CBZHQKZPage"));
if (!page) throw new Error("No big PM summary page found.");
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
  const ctl = aspxGetControlCollection().Get("Web_ChartResultView");
  const own = {};
  for (const key in ctl) {
    let value = ctl[key];
    if (typeof value === "function" || /callback|click|hit|object|series|point|map|url|argument|value/i.test(key)) {
      if (typeof value === "function") own[key] = String(value).slice(0, 500);
      else if (value == null || ["string", "number", "boolean"].includes(typeof value)) own[key] = value;
      else own[key] = Object.prototype.toString.call(value);
    }
  }
  const elements = Array.from(document.querySelectorAll("input,area,map"))
    .map((el) => ({ tag: el.tagName, id: el.id, name: el.name, value: el.value, href: el.href, coords: el.coords, shape: el.shape }))
    .slice(0, 200);
  return { own, elements, controlString: String(ctl).slice(0, 1000) };
})()`;
const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
ws.close();
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
console.log(JSON.stringify(result.result?.result?.value || result.result?.value, null, 2));
