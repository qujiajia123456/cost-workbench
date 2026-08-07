const port = process.env.BIG_PM_CDP_PORT || "9333";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const targets = pages.filter((page) => page.type === "page" && page.url.includes("XMCBDBFXBPage"));

async function inspect(page) {
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
      const cmpInfo = (id) => {
        const cmp = Ext.getCmp(id);
        const rect = cmp?.getEl?.()?.dom?.getBoundingClientRect?.();
        return {
          id,
          rawValue: cmp?.getRawValue?.() || "",
          value: cmp?.getValue?.()?.toISOString?.() || String(cmp?.getValue?.() ?? ""),
          left: rect?.left ?? null,
          right: rect?.right ?? null,
        };
      };
      const tree = Ext.getCmp("treeGrid");
      const noTax = (tree?.getStore?.().getRange?.() || [])
        .find((record) => clean(record.data?.NAME || record.get?.("NAME")).includes("不含税"))?.data || null;
      return {
        title: document.title,
        url: location.href,
        fields: [cmpInfo("DateFieldStart"), cmpInfo("DateFieldEnd")].sort((a, b) => (a.left ?? 0) - (b.left ?? 0)),
        noTax: noTax && {
          NAME: noTax.NAME,
          YSCB_JE: noTax.YSCB_JE,
          SJCB_JE: noTax.SJCB_JE,
          YSCBYSJCB_JDE: noTax.YSCBYSJCB_JDE,
          YSCBYSJCB_JDL: noTax.YSCBYSJCB_JDL,
        },
      };
    })()`,
  });
  ws.close();
  return result.result?.value || result;
}

const values = [];
for (const page of targets) {
  values.push(await inspect(page));
}
console.log(JSON.stringify(values, null, 2));
