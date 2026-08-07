const port = process.env.BIG_PM_CDP_PORT || "9333";
const topText = process.env.BIG_PM_TOP_MENU || "成本管理";
const needle = process.env.BIG_PM_MENU_NEEDLE || "总成本计划编制";

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
    const topText = ${JSON.stringify(topText)};
    const needle = ${JSON.stringify(needle)};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const matches = (text) => clean(text) === topText || clean(text).includes(topText);
    const elements = Array.from(document.querySelectorAll("a,span,div,td,li"))
      .filter((element) => matches(element.innerText || element.textContent || ""))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, left: rect.left, top: rect.top, width: rect.width, height: rect.height, text: clean(element.innerText || element.textContent || "") };
      })
      .filter((item) => item.width > 0 && item.height > 0)
      .sort((a, b) => {
        const aExact = clean(a.text) === topText ? 0 : 1;
        const bExact = clean(b.text) === topText ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aArea = a.width * a.height;
        const bArea = b.width * b.height;
        return aArea - bArea || a.top - b.top || a.left - b.left;
      });
    const target = elements[0]?.element;
    if (target) {
      for (const type of ["mouseover", "mouseenter", "mousemove", "mousedown", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
    }
    await sleep(1500);
    const body = clean(document.body?.innerText || "");
    const componentMatches = [];
    if (globalThis.Ext?.ComponentMgr?.all?.each) {
      Ext.ComponentMgr.all.each((cmp) => {
        const text = clean(cmp.text || cmp.title || cmp.getEl?.()?.dom?.innerText || "");
        const html = clean(cmp.getEl?.()?.dom?.outerHTML || "");
        if (text.includes(needle) || html.includes(needle)) {
          componentMatches.push({
            id: cmp.id,
            xtype: cmp.getXType?.() || cmp.xtype || "",
            text,
            html: html.slice(0, 1000),
          });
        }
      });
    }
    const htmlMatches = Array.from(document.querySelectorAll("a,span,div,td,li"))
      .map((element) => ({ text: clean(element.innerText || element.textContent || ""), html: clean(element.outerHTML || "").slice(0, 1000) }))
      .filter((item) => item.text.includes(needle) || item.html.includes(needle))
      .slice(0, 20);
    resolve({
      clickedCandidates: elements.slice(0, 10).map(({ text, left, top, width, height }) => ({ text, left, top, width, height })),
      hasNeedle: body.includes(needle),
      snippet: body.includes(needle) ? body.slice(Math.max(0, body.indexOf(needle) - 500), body.indexOf(needle) + 800) : body.slice(0, 1600),
      componentMatches,
      htmlMatches,
    });
  }))()`,
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
