const port = process.env.BIG_PM_CDP_PORT || "9333";
const urlNeedle = process.env.BIG_PM_URL_NEEDLE || "XMCBDBFXBPage";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes(urlNeedle));
if (!page) throw new Error(`No page found on ${port} for ${urlNeedle}`);

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
  expression: `(() => {
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const components = [];
    if (globalThis.Ext?.ComponentMgr?.all?.each) {
      Ext.ComponentMgr.all.each((cmp) => {
        let value = "";
        let rawValue = "";
        try { value = cmp.getValue?.(); } catch {}
        try { rawValue = cmp.getRawValue?.(); } catch {}
        const el = cmp.getEl?.()?.dom;
        const text = clean(el?.innerText || el?.textContent || "");
        const visible = !cmp.hidden && (!el || !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        components.push({
          id: cmp.id,
          itemId: cmp.itemId || "",
          name: cmp.name || cmp.hiddenName || "",
          xtype: cmp.getXType?.() || cmp.xtype || "",
          fieldLabel: clean(cmp.fieldLabel || cmp.label || ""),
          title: clean(cmp.title || ""),
          value,
          rawValue,
          text: text.slice(0, 300),
          visible,
          disabled: !!cmp.disabled,
          handler: cmp.handler ? String(cmp.handler).slice(0, 1000) : "",
          listeners: Object.keys(cmp.events || {}).filter((key) => cmp.events[key]?.listeners?.length)
        });
      });
    }
    const inputs = Array.from(document.querySelectorAll("input,button,a,select,textarea"))
      .map((el) => ({
        tag: el.tagName,
        id: el.id || "",
        name: el.name || "",
        type: el.type || "",
        value: el.value || "",
        text: clean(el.innerText || el.textContent || ""),
        title: el.title || "",
        cls: el.className || ""
      }))
      .filter((item) => item.id || item.name || item.value || item.text)
      .slice(0, 300);
    return {
      page: { title: document.title, url: location.href },
      bodyText: clean(document.body?.innerText || "").slice(0, 1200),
      components: components.filter((item) =>
        item.visible ||
        /year|month|nf|yf|date|query|search|月|年|查询|button|combo|field/i.test(JSON.stringify(item))
      ),
      inputs
    };
  })()`
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
