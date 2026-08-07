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
const expression = `(() => ({
  hasPromise: !!window.__codexBigPmCapturePromise,
  hasResult: !!window.__codexBigPmCaptureResult,
  progress: window.__codexBigPmCaptureProgress || null,
  listSrc: document.getElementById("codexBigPmListFrame")?.src || "",
  detailSrc: document.getElementById("codexBigPmDetailFrame")?.src || "",
  frames: Array.from(document.querySelectorAll("iframe"))
    .filter((frame) => frame.id && frame.id.includes("codex"))
    .map((frame) => ({
      id: frame.id,
      src: frame.src,
      text: (() => {
        try { return (frame.contentDocument.body.innerText || "").slice(0, 300); }
        catch (e) { return ""; }
      })()
    }))
}))()`;
const result = await send("Runtime.evaluate", { expression, returnByValue: true });
console.log(JSON.stringify(result.result?.result?.value || result.result?.value || result, null, 2));
ws.close();
