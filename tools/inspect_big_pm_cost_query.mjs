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
    const simpleValue = (value) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.slice(0, 12).map(simpleValue);
      const out = {};
      for (const key of Object.keys(value).slice(0, 50)) {
        const item = value[key];
        if (typeof item !== "function" && key !== "items" && key !== "events") out[key] = simpleValue(item);
      }
      return out;
    };

    const controls = [];
    const stores = [];
    if (globalThis.Ext?.ComponentMgr?.all?.each) {
      Ext.ComponentMgr.all.each((cmp) => {
        const xtype = cmp.getXType?.() || cmp.xtype || "";
        let value = "";
        let rawValue = "";
        try { value = simpleValue(cmp.getValue?.()); } catch {}
        try { rawValue = simpleValue(cmp.getRawValue?.()); } catch {}
        const text = clean(
          cmp.text || cmp.boxLabel || cmp.fieldLabel || cmp.label || cmp.title ||
          cmp.getEl?.()?.dom?.innerText || cmp.getEl?.()?.dom?.textContent || ""
        );
        const haystack = JSON.stringify({
          id: cmp.id, itemId: cmp.itemId, name: cmp.name || cmp.hiddenName,
          xtype, text, value, rawValue
        });
        if (/query|search|date|month|year|nf|yf|start|end|查询|月份|年度|年月|combo|datefield|button/i.test(haystack)) {
          controls.push({
            id: cmp.id,
            itemId: cmp.itemId || "",
            name: cmp.name || cmp.hiddenName || "",
            xtype,
            text,
            value,
            rawValue,
            hidden: !!cmp.hidden,
            disabled: !!cmp.disabled,
            handler: cmp.handler ? String(cmp.handler).slice(0, 800) : "",
            listeners: Object.keys(cmp.events || {}).filter((key) => cmp.events[key]?.listeners?.length)
          });
        }

        const store = cmp.getStore?.() || cmp.store;
        if (store) {
          const rows = store.getRange?.().slice(0, 3).map((record) => simpleValue(record.data)) || [];
          stores.push({
            cmpId: cmp.id,
            xtype,
            storeId: store.storeId,
            total: Number(store.getTotalCount?.() ?? store.getCount?.() ?? rows.length),
            baseParams: simpleValue(store.baseParams),
            lastOptions: simpleValue(store.lastOptions),
            proxyUrl: store.proxy?.url || store.url || "",
            fields: store.fields?.items?.map((field) => field.name).slice(0, 60) || [],
            rows
          });
        }
      });
    }

    const actions = [];
    const actionBag = globalThis.Gtp?.net?.Global?.Actions;
    const actionIds = ["actQueryData", "actSysQueryFormByPagingSQL_Handler", "actSysQueryFormByPagingSQL_Handler_YYFX"];
    for (const id of actionIds) {
      let action = null;
      try { action = actionBag?.getAction?.(id) || actionBag?.get?.(id) || actionBag?.items?.[id]; } catch {}
      if (action) {
        actions.push({
          id,
          actionId: action.id || action.action || "",
          handlerName: action.handlerName || "",
          execFailedMsg: action.execFailedMsg || "",
          params: simpleValue(action.params || action.args || action.config),
          target: simpleValue(action.target),
          ajaxListeners: simpleValue(action.ajaxListeners),
          handler: action.handler ? String(action.handler).slice(0, 1600) : "",
          getActionHandler: action.getActionHandler ? String(action.getActionHandler).slice(0, 2500) : "",
          methodKeys: Object.keys(action).filter((key) => typeof action[key] === "function").slice(0, 50),
          keys: Object.keys(action).filter((key) => typeof action[key] !== "function").slice(0, 80)
        });
      } else {
        actions.push({ id, missing: true });
      }
    }

    const sourceSnippets = [];
    const tokens = ["DateFieldStart", "DateFieldEnd", "field_startDate", "field_endDate", "actQueryData", "btnSearch"];
    for (const script of Array.from(document.scripts)) {
      const text = script.textContent || "";
      for (const token of tokens) {
        const index = text.indexOf(token);
        if (index >= 0) {
          sourceSnippets.push({
            token,
            src: script.src || "",
            snippet: text.slice(Math.max(0, index - 700), index + 1200)
          });
        }
      }
    }

    const globals = Object.keys(globalThis)
      .filter((key) => /query|search|date|month|year|nf|yf|load/i.test(key))
      .slice(0, 120);

    const functions = {};
    for (const key of ["actQueryData", "actQueryData_Handler", "actSysQueryFormByPagingSQL_Handler", "actSysQueryFormByPagingSQL_Handler_YYFX", "btnSearch"]) {
      try {
        const value = globalThis[key] || Ext.getCmp?.(key);
        functions[key] = {
          type: typeof value,
          text: typeof value === "function" ? String(value).slice(0, 2500) : String(value?.handler || value || "").slice(0, 2500)
        };
      } catch (error) {
        functions[key] = { error: String(error) };
      }
    }

    return {
      page: { title: document.title, url: location.href },
      body: clean(document.body?.innerText || "").slice(0, 1800),
      controls,
      stores,
      actions,
      sourceSnippets,
      functions,
      globals
    };
  })()`
});

const value = result.result?.value || result;
const section = process.env.BIG_PM_SECTION;
console.log(JSON.stringify(section ? value?.[section] : value, null, 2));
ws.close();
