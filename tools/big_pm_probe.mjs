const port = process.env.BIG_PM_CDP_PORT || "9333";
const pages = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!page) throw new Error(`未找到 ${port} 中的大PM页面`);

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
const evalExpr = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value ?? result.result?.value;
};

const info = await evalExpr(`(() => {
  function frameInfo(win, depth = 0) {
    const doc = win.document;
    const frames = Array.from(doc.querySelectorAll("iframe,frame")).map((f, i) => {
      let child = null;
      try { child = frameInfo(f.contentWindow, depth + 1); } catch (e) {}
      return { i, tag: f.tagName, id: f.id, name: f.name, title: f.title, src: f.src, child };
    });
    return {
      title: doc.title,
      url: win.location.href,
      text: (doc.body?.innerText || "").slice(0, 1200),
      frames,
      clickableTexts: Array.from(doc.querySelectorAll("a,button,span,div,td"))
        .map((e) => (e.innerText || e.textContent || "").trim())
        .filter((text) => text && text.length <= 30)
        .slice(0, 300)
    };
  }
  return frameInfo(window);
})()`);
console.log(JSON.stringify(info, null, 2));
ws.close();
