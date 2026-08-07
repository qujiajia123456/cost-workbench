const port = process.env.BIG_PM_CDP_PORT || "9333";
const company = process.env.BIG_PM_COMPANY || "三公司";
const type = process.env.BIG_PM_TYPE || "KS";
const status = process.env.BIG_PM_STATUS || "ZS";

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

const before = await evalPage(`(() => Array.from(document.querySelectorAll("iframe")).map((f) => f.src))()`);
const functionInfo = await evalPage(`(() => {
  const frame = Array.from(document.querySelectorAll("iframe")).find((item) => item.src.includes("CBZHQKZPage"));
  const win = frame?.contentWindow;
  if (!win) return { ok: false, message: "summary iframe not found" };
  return {
    ok: true,
    keys: Object.keys(win).filter((key) => key.includes("openNewTab") || key === "_this"),
    thisKeys: win._this ? Object.keys(win._this).filter((key) => /open|tab|page|query|url/i.test(key)) : [],
    source: win._this?.openNewTabPage ? String(win._this.openNewTabPage).slice(0, 3000) : ""
  };
})()`);

const opened = await evalPage(`(() => {
  const frame = Array.from(document.querySelectorAll("iframe")).find((item) => item.src.includes("CBZHQKZPage"));
  const win = frame?.contentWindow;
  if (!win?._this?.openNewTabPage) return { ok: false, message: "openNewTabPage not found" };
  win._this.openNewTabPage(${JSON.stringify(company)}, ${JSON.stringify(type)}, ${JSON.stringify(status)});
  return { ok: true };
})()`);
await sleep(3500);
const after = await evalPage(`(() => {
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const frames = Array.from(document.querySelectorAll("iframe")).map((f) => {
    let text = "";
    let title = "";
    try {
      title = f.contentDocument?.title || "";
      text = clean(f.contentDocument?.body?.innerText || "").slice(0, 2000);
    } catch (e) {}
    return { id: f.id, name: f.name, src: f.src, title, text };
  });
  return frames;
})()`);
console.log(JSON.stringify({ before, functionInfo, opened, after }, null, 2));
ws.close();
