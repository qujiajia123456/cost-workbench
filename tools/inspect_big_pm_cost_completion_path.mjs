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
    const simplify = (value) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.slice(0, 10).map(simplify);
      const out = {};
      for (const key of Object.keys(value).slice(0, 80)) {
        const item = value[key];
        if (typeof item !== "function") out[key] = item;
      }
      return out;
    };
    const inspectWindow = (win) => {
      const components = [];
      try {
        if (win.Ext?.ComponentMgr?.all?.each) {
          win.Ext.ComponentMgr.all.each((cmp) => {
            const store = cmp.getStore?.() || cmp.store;
            const cm = cmp.getColumnModel?.() || cmp.colModel;
            const columns = (cm?.config || cmp.columns || []).map((col) => ({
              header: clean(col.header || col.text),
              dataIndex: col.dataIndex,
              id: col.id,
              hidden: !!col.hidden,
            }));
            const rows = store?.getRange?.().slice(0, 8).map((record) => simplify(record.data)) || [];
            const fields = store?.fields?.items?.map((field) => field.name) || [];
            const total = Number(store?.getTotalCount?.() ?? store?.getCount?.() ?? rows.length);
            if (store || rows.length || columns.length) {
              components.push({
                id: cmp.id,
                xtype: cmp.getXType?.() || cmp.xtype,
                title: clean(cmp.title),
                storeId: store?.storeId,
                total,
                fields,
                columns,
                rows,
              });
            }
          });
        }
      } catch (error) {
        components.push({ error: error?.message || String(error) });
      }
      return components;
    };
    const frames = [];
    const collectFrames = (win, depth, prefix) => {
      if (depth > 2) return;
      let list = [];
      try { list = Array.from(win.document.querySelectorAll("iframe")); } catch (_err) { return; }
      list.forEach((frame, index) => {
        const path = prefix ? \`\${prefix}.\${index}\` : String(index);
        let info = {
          path,
          id: frame.id,
          name: frame.name,
          titleAttr: frame.title,
          src: frame.src,
        };
        try {
          const child = frame.contentWindow;
          info = {
            ...info,
            url: child.location.href,
            documentTitle: child.document.title,
            bodyText: clean(child.document.body?.innerText || "").slice(0, 1200),
            components: inspectWindow(child),
          };
          frames.push(info);
          collectFrames(child, depth + 1, path);
        } catch (error) {
          frames.push({ ...info, inaccessible: true, error: error?.message || String(error) });
        }
      });
    };
    collectFrames(globalThis, 0, "");

    const pageUrlCandidates = [
      "YJJT.CBFXGL.XMCBWCQKSPBPage",
      "YJJT.CBFXGL.XMCBWCQKSPBListPage",
      "YJJT.CBGL.XMCBWCQKSPBPage",
      "YJJT.CBGL.XMCBWCQKSPBListPage",
      "YJJT.CBFXGL.XMCBWCQKSPBModule",
      "YJJT.CBGL.XMCBWCQKSPBModule",
      "YJJT.CBGL.CBZHQKZPage",
    ];
    const pageUrls = {};
    for (const key of pageUrlCandidates) {
      try { pageUrls[key] = globalThis.$G?.getPageURLByFullName?.(key) || null; }
      catch (error) { pageUrls[key] = "ERROR: " + (error?.message || String(error)); }
    }

    const tabs = Array.from(document.querySelectorAll("li,span,a,div"))
      .map((node) => clean(node.innerText || node.textContent || ""))
      .filter((text) => text.includes("项目成本完成情况审批表") || text.includes("成本综合情况分析"))
      .slice(0, 30);

    return {
      target: { title: document.title, url: location.href },
      tabs: [...new Set(tabs)],
      pageUrls,
      frames: frames.filter((item) =>
        clean(item.url || item.src || item.documentTitle || item.bodyText).includes("XMCBWC") ||
        clean(item.url || item.src || item.documentTitle || item.bodyText).includes("项目成本完成情况") ||
        clean(item.url || item.src || item.documentTitle || item.bodyText).includes("成本综合情况") ||
        (item.components || []).length
      ),
    };
  })()`,
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
