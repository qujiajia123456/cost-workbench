const port = process.env.BIG_PM_CDP_PORT || "9333";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) =>
  item.type === "page" &&
  item.url.includes("Portal/Frame/LayoutC/Default.aspx")
) || pages.find((item) =>
  item.type === "page" &&
  item.url.includes("yanjianpm.glodon.com")
);

if (!page) throw new Error(`No Big PM portal page found on ${port}`);

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
    const frame = Array.from(document.querySelectorAll("iframe"))
      .find((item) => item.src.includes("XMCBWCQKSPBListPage"));
    const win = frame?.contentWindow;
    if (!win) return { ok: false, message: "approval list frame not found" };
    const actions = [];
    try {
      win.Ext?.ComponentMgr?.all?.each?.((cmp) => {
        const text = clean(cmp.text || cmp.title || cmp.tooltip || cmp.id);
        const handler = cmp.handler ? String(cmp.handler).slice(0, 2500) : "";
        if (text.includes("查看") || text.includes("编辑") || text.includes("新建") || text.includes("刷新") || handler.includes("XMCBWCQKSPB")) {
          actions.push({
            id: cmp.id,
            xtype: cmp.getXType?.() || cmp.xtype,
            text,
            disabled: !!cmp.disabled,
            handler,
          });
        }
      });
    } catch (error) {
      actions.push({ error: error?.message || String(error) });
    }
    const globals = Object.keys(win)
      .filter((key) => /view|open|edit|bill|form|xmc bwc|xmc/i.test(key))
      .slice(0, 80)
      .map((key) => ({ key, value: typeof win[key] === "function" ? String(win[key]).slice(0, 1200) : clean(win[key]).slice(0, 300) }));
    const handlers = {};
    for (const key of ["actView_Handler", "actEdit_Handler", "BillView_DblClick", "billView_DblClick"]) {
      if (typeof win[key] === "function") handlers[key] = String(win[key]).slice(0, 5000);
    }
    const actionDetails = {};
    for (const key of ["actView", "actEdit", "billView_view"]) {
      const action = win[key];
      if (!action) continue;
      actionDetails[key] = {
        keys: Object.keys(action).slice(0, 80),
        handlerName: action.handlerName,
        actionName: action.actionName,
        id: action.id,
        action: action.action,
        url: action.url,
        pageFullName: action.pageFullName,
        getActionHandler: action.getActionHandler ? String(action.getActionHandler).slice(0, 3000) : "",
        handler: action.handler ? String(action.handler).slice(0, 3000) : "",
        raw: Object.fromEntries(Object.keys(action).slice(0, 40).map((item) => {
          const value = action[item];
          return [item, typeof value === "function" ? String(value).slice(0, 500) : clean(value).slice(0, 500)];
        })),
      };
    }
    const selected = (() => {
      const grid = win.Ext?.getCmp?.("billView");
      const selection = grid?.getSelectionModel?.()?.getSelected?.();
      return selection?.data || null;
    })();
    const storeInfo = (() => {
      const grid = win.Ext?.getCmp?.("billView");
      const store = grid?.getStore?.();
      if (!store) return null;
      const plain = (value) => {
        if (!value || typeof value !== "object") return value ?? null;
        const out = {};
        for (const key of Object.keys(value).slice(0, 60)) {
          const item = value[key];
          if (item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") out[key] = item;
        }
        return out;
      };
      return {
        storeId: store.storeId,
        total: store.getTotalCount?.() ?? store.totalLength ?? store.getCount?.(),
        count: store.getCount?.(),
        pageSize: store.pageSize || store.baseParams?.limit || store.lastOptions?.params?.limit,
        url: store.proxy?.url || store.proxy?.conn?.url || store.url,
        baseParams: plain(store.baseParams),
        lastOptionsParams: plain(store.lastOptions?.params),
        readerMeta: plain(store.reader?.meta),
        jsonDataKeys: store.reader?.jsonData ? Object.keys(store.reader.jsonData).slice(0, 30) : [],
      };
    })();
    return {
      ok: true,
      frameUrl: frame.src,
      bodyText: clean(win.document.body?.innerText || "").slice(0, 1000),
      selected,
      storeInfo,
      actions,
      globals,
      handlers,
      actionDetails,
    };
  })()`,
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
