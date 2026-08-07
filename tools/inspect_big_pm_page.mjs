const pages = await fetch("http://localhost:9222/json/list").then((r) => r.json());
const bigPages = pages.filter((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!bigPages.length) throw new Error("未找到大PM页面");

let nextId = 1;
const pending = new Map();
async function inspect(page) {
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
const result = await send("Runtime.evaluate", {
  expression: `(() => ({
    title: document.title,
    url: location.href,
    text: document.body ? document.body.innerText.slice(0, 1500) : "",
    iframes: Array.from(document.querySelectorAll("iframe")).map((f, i) => ({
      i, id: f.id, name: f.name, title: f.title, src: f.src
    }))
  }))()`,
  returnByValue: true,
});
console.log(JSON.stringify({ pageTitle: page.title, pageUrl: page.url, inspected: result.result?.result?.value || result.result?.value || result }, null, 2));
ws.close();
}

for (const page of bigPages) {
  await inspect(page);
}
