const port = process.env.BIG_PM_CDP_PORT || "9333";
const needle = process.env.BIG_PM_MENU_NEEDLE || "总成本计划编制";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) =>
  item.type === "page"
  && item.url.includes("Portal/Frame/LayoutC/Default.aspx")
) || pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));

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
  expression: `(() => {
    const needle = ${JSON.stringify(needle)};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const body = clean(document.body?.innerText || "");
    const components = [];
    if (globalThis.Ext?.ComponentMgr?.all?.each) {
      Ext.ComponentMgr.all.each((cmp) => {
        const text = clean(cmp.text || cmp.title || cmp.fieldLabel || cmp.boxLabel || cmp.getEl?.()?.dom?.innerText || "");
        const html = clean(cmp.getEl?.()?.dom?.outerHTML || "");
        const data = {};
        const source = cmp.data || cmp.initialConfig || {};
        for (const key of Object.keys(source).slice(0, 80)) {
          const value = source[key];
          if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            data[key] = value;
          }
        }
        const json = clean(JSON.stringify({
          id: cmp.id,
          itemId: cmp.itemId,
          xtype: cmp.getXType?.() || cmp.xtype,
          text,
          data,
        }));
        if (text.includes(needle) || html.includes(needle) || json.includes(needle)) {
          components.push({
            id: cmp.id,
            itemId: cmp.itemId || "",
            xtype: cmp.getXType?.() || cmp.xtype || "",
            text,
            data,
            html: html.slice(0, 1200),
          });
        }
      });
    }
    const globals = Object.keys(globalThis).filter((key) => /page|menu|open|url|full/i.test(key)).slice(0, 200);
    const funcs = {};
    for (const key of ["$G", "Gtp", "openTab", "addTab", "OpenMenu", "openUrl", "openPage"]) {
      try {
        const value = globalThis[key];
        funcs[key] = typeof value === "function" ? String(value).slice(0, 1200) : Object.keys(value || {}).slice(0, 120);
      } catch (error) {
        funcs[key] = String(error);
      }
    }
    const lookups = [];
    for (const name of [needle, "成本计划.总成本计划编制", "成本管理.成本计划.总成本计划编制", "YJJT.成本管理.成本计划.总成本计划编制"]) {
      for (const fn of [globalThis.getPageURLByFullName, globalThis.$G?.getPageURLByFullName, globalThis.Gtp?.net?.Global?.getPageURLByFullName]) {
        if (typeof fn !== "function") continue;
        try {
          lookups.push({ name, value: fn(name) });
        } catch (error) {
          lookups.push({ name, error: String(error?.message || error) });
        }
      }
    }
    const menuMatches = [];
    const seen = new Set();
    const visit = (value, path = "") => {
      if (!value || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);
      const summary = {};
      let hit = false;
      for (const key of Object.keys(value).slice(0, 120)) {
        const item = value[key];
        if (item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          summary[key] = item;
          if (String(item).includes(needle)) hit = true;
        }
      }
      if (hit) menuMatches.push({ path, summary });
      for (const key of Object.keys(value).slice(0, 120)) {
        const item = value[key];
        if (item && typeof item === "object") visit(item, path ? path + "." + key : key);
      }
    };
    try { visit(globalThis.menu, "menu"); } catch {}
    try { visit(globalThis.menubar, "menubar"); } catch {}
    return {
      url: location.href,
      title: document.title,
      hasNeedleInBody: body.includes(needle),
      bodySnippet: body.includes(needle) ? body.slice(Math.max(0, body.indexOf(needle) - 500), body.indexOf(needle) + 700) : body.slice(0, 1000),
      components,
      globals,
      funcs,
      lookups,
      menuMatches: menuMatches.slice(0, 40),
    };
  })()`,
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
