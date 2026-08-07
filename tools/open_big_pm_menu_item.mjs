const port = process.env.BIG_PM_CDP_PORT || "9333";
const linkId = process.env.BIG_PM_MENU_LINK_ID || "link_1005639";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("Portal/Frame/LayoutC/Default.aspx"));
if (!page) throw new Error("No Big PM portal page found");

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
  expression: `(() => new Promise(async (resolve) => {
    const linkId = ${JSON.stringify(linkId)};
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const el = document.getElementById(linkId);
    if (!el) return resolve({ ok: false, message: "link not found", linkId });
    for (const type of ["mouseover", "mouseenter", "mousemove", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(2500);
    resolve({ ok: true, title: document.title, url: location.href });
  }))()`,
});
console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();

await new Promise((resolve) => setTimeout(resolve, 1500));
const after = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
for (const [index, item] of after.filter((target) => target.type === "page").entries()) {
  console.log(index, item.id, item.title, item.url);
}
