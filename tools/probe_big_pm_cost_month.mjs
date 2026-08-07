const port = process.env.BIG_PM_CDP_PORT || "9333";
const urlNeedle = process.env.BIG_PM_URL_NEEDLE || "XMCBDBFXBPage";
const year = Number(process.env.BIG_PM_YEAR || 2026);
const month = Number(process.env.BIG_PM_MONTH || 6);
const mode = process.env.BIG_PM_MONTH_MODE || "end-only";

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
  timeout: 60000,
  expression: `(() => new Promise(async (resolve) => {
    const year = ${year};
    const month = ${month};
    const mode = ${JSON.stringify(mode)};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const dateEnd = new Date(year, month - 1, 1);
    const start = Ext.getCmp("DateFieldStart");
    const end = Ext.getCmp("DateFieldEnd");
    const search = Ext.getCmp("btnSearch");
    if (!start || !end || !search) {
      resolve({ ok: false, message: "missing DateFieldStart/DateFieldEnd/btnSearch" });
      return;
    }
    try {
      if (mode === "both") {
        start.setValue(dateEnd);
        end.setValue(dateEnd);
        start.fireEvent?.("select", start, dateEnd);
        start.fireEvent?.("change", start, dateEnd);
        end.fireEvent?.("select", end, dateEnd);
        end.fireEvent?.("change", end, dateEnd);
      } else if (mode === "start-only") {
        start.setValue(dateEnd);
        end.clearValue?.();
        end.setValue(null);
        start.fireEvent?.("select", start, dateEnd);
        start.fireEvent?.("change", start, dateEnd);
        end.fireEvent?.("change", end, null);
      } else {
        start.clearValue?.();
        start.setValue(null);
        end.setValue(dateEnd);
        start.fireEvent?.("change", start, null);
        end.fireEvent?.("select", end, dateEnd);
        end.fireEvent?.("change", end, dateEnd);
      }
      search.handler.call(search, search);
    } catch (error) {
      resolve({ ok: false, message: String(error), stack: error?.stack });
      return;
    }
    await sleep(4500);
    const tree = Ext.getCmp("treeGrid");
    const reasonGrid = Ext.getCmp("gridView_YYFX");
    const findRow = (store, nameNeedle) => {
      const rows = store?.getRange?.() || [];
      const record = rows.find((item) => clean(item.get?.("NAME") || item.data?.NAME).includes(nameNeedle));
      return record?.data || null;
    };
    const sumNoTax = findRow(tree?.getStore?.(), "不含税");
    const reasonRows = reasonGrid?.getStore?.().getRange?.().map((record) => record.data) || [];
    resolve({
      ok: true,
      url: location.href,
      rawValues: {
        start: start.getRawValue?.(),
        end: end.getRawValue?.(),
        startValue: start.getValue?.()?.toISOString?.() || String(start.getValue?.()),
        endValue: end.getValue?.()?.toISOString?.() || String(end.getValue?.())
      },
      noTax: sumNoTax,
      reasonRows,
      bodyTail: clean(document.body?.innerText || "").slice(-1000)
    });
  }))()`
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
