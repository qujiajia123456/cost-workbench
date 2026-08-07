const port = process.env.BIG_PM_CDP_PORT || "9333";
const url = process.env.BIG_PM_TOTAL_PLAN_URL
  || "http://yanjianpm.glodon.com/YJJT/ZCBJHBZMK/ZCBJHBZListPage/ZCBJHBZListPage.aspx?menuitemid=1005639&frame=4000401285&modulecode=YJJT.ZCBJHBZMK.ZCBJHBZModule";

async function openTarget(targetUrl) {
  if (process.env.BIG_PM_REUSE_EXISTING === "1") {
    const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!listResponse.ok) throw new Error(`list targets failed ${listResponse.status}`);
    const targets = await listResponse.json();
    const target = targets.find((item) =>
      item.type === "page"
      && item.webSocketDebuggerUrl
      && (String(item.url || "").includes("ZCBJHBZListPage") || String(item.title || "").includes("总成本计划"))
    );
    if (!target) throw new Error("existing total cost plan page not found");
    return { ...target, reused: true };
  }
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`open target failed ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error("target has no debugger url");
  return target;
}

async function closeTarget(target) {
  if (!target?.id) return;
  if (target.reused) return;
  try { await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`); } catch {}
}

const target = await openTarget(url);
let nextId = 1;
const pending = new Map();
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
try { await send("Page.enable"); } catch {}
await new Promise((resolve) => setTimeout(resolve, 3000));

try {
  const expression = `(() => new Promise(async (resolve) => {
      const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
      const simple = (value) => {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        if (Array.isArray(value)) return value.slice(0, 10).map(simple);
        const out = {};
        for (const key of Object.keys(value).slice(0, 80)) {
          const item = value[key];
          if (typeof item !== "function") out[key] = simple(item);
        }
        return out;
      };
      const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
      const begin = Date.now();
      while (Date.now() - begin < 30000) {
        if (globalThis.Ext?.ComponentMgr?.all) break;
        await sleep(500);
      }
      await sleep(3000);
      const controls = [];
      const stores = [];
      if (globalThis.Ext?.ComponentMgr?.all?.each) {
        Ext.ComponentMgr.all.each((cmp) => {
          const xtype = cmp.getXType?.() || cmp.xtype || "";
          const text = clean(cmp.text || cmp.title || cmp.fieldLabel || cmp.boxLabel || cmp.getEl?.()?.dom?.innerText || "");
          let value = "";
          let rawValue = "";
          try { value = simple(cmp.getValue?.()); } catch {}
          try { rawValue = simple(cmp.getRawValue?.()); } catch {}
          if (/项目|核算|状态|审批|查询|搜索|合同|投标|预算|金额|combo|textfield|button|date/i.test(JSON.stringify({ id: cmp.id, name: cmp.name, xtype, text, value, rawValue }))) {
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
            });
          }
          const store = cmp.getStore?.() || cmp.store;
          if (store) {
            stores.push({
              cmpId: cmp.id,
              xtype,
              storeId: store.storeId,
              total: Number(store.getTotalCount?.() ?? store.getCount?.() ?? 0),
              proxyUrl: store.proxy?.url || store.url || "",
              baseParams: simple(store.baseParams),
              lastOptions: simple(store.lastOptions),
              fields: store.fields?.items?.map((field) => field.name).slice(0, 100) || [],
              rows: store.getRange?.().slice(0, 5).map((record) => simple(record.data)) || [],
            });
          }
        });
      }
      resolve({
        title: document.title,
        url: location.href,
        body: clean(document.body?.innerText || "").slice(0, 2500),
        controls,
        stores,
      });
    }))()`;
  let result = null;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    timeout: 60000,
    expression,
      });
      break;
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Cannot find context|navigated/i.test(String(error?.message || error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
  if (!result) throw lastError || new Error("evaluate failed");
  console.log(JSON.stringify(result.result?.value || result, null, 2));
} finally {
  try { ws.close(); } catch {}
  await closeTarget(target);
}
