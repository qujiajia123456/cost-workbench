import fs from "node:fs";
import path from "node:path";

const latestPath = path.join("data", "pm_warning_results", "latest_old-pm.json");
const data = JSON.parse(fs.readFileSync(latestPath, "utf8"));
const wantedPid = process.env.PM_WARNING_DEBUG_PID || "";
const project = data.projects?.find((item) => wantedPid && item.pid === wantedPid)
  || data.projects?.find((item) => item.contract == null || item.contract === "")
  || data.projects?.[0];
if (!project) throw new Error("latest_old-pm.json has no projects");

const pagesResponse = await fetch("http://localhost:9222/json/list");
const pages = await pagesResponse.json();
const page = pages.find((item) =>
  item.type === "page" &&
  (
    item.url.includes("/yjpm2012/MainNew.aspx")
    || item.url.includes("/yjpm2012/DefaultMainNew.aspx")
    || item.url.includes("/yjpm2012/")
  )
);
if (!page) throw new Error("No old PM page found on localhost:9222");

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
  if (!message.id || !pending.has(message.id)) return;
  const callbacks = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
  else callbacks.resolve(message.result);
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
await send("Runtime.enable");

const expression = `
(async () => {
  const project = ${JSON.stringify(project)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const absoluteUrl = (url) => new URL(url, location.origin + "/yjpm2012/").href;
  const small = (value, n = 300) => String(value ?? "").slice(0, n);

  const openChartByMenu = async () => {
    if (!window.Ext || !window.TabPanel2 || !window.showInfo) {
      return { ok: false, error: "main page lacks Ext/TabPanel2/showInfo" };
    }
    window.showInfo(
      window.TabPanel2,
      "Systemasp/AppSys/ExecApp/OutPage/OutListbusinessAreaSelect.aspx?treeno=0105026",
      "2",
      "成本综合情况(总)",
      "0105026"
    );
    await sleep(2500);
    const iframe = document.getElementById("0105026_IFrame");
    return { ok: !!iframe?.contentDocument, url: iframe?.contentWindow?.location?.href || "" };
  };

  const inspectResponse = async (url) => {
    const response = await fetch(absoluteUrl(url), { credentials: "include" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = cleanText(doc.body?.innerText || doc.documentElement?.textContent || "");
    const tableRows = Array.from(doc.querySelectorAll("table tr")).slice(0, 18).map((row) =>
      Array.from(row.querySelectorAll("td,th")).map((cell) => cleanText(cell.innerText || cell.textContent))
    );
    return {
      status: response.status,
      url: response.url,
      title: doc.title,
      tableCount: doc.querySelectorAll("table").length,
      rowCount: doc.querySelectorAll("table tr").length,
      tableRows,
      textHead: small(text, 500),
    };
  };
  const inspectResponseInWindow = async (win, url) => {
    const href = new win.URL(url, win.location.href).href;
    const response = await win.fetch(href, { credentials: "include" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = cleanText(doc.body?.innerText || doc.documentElement?.textContent || "");
    return {
      status: response.status,
      url: response.url,
      title: doc.title,
      tableCount: doc.querySelectorAll("table").length,
      rowCount: doc.querySelectorAll("table tr").length,
      hasTaxBefore: text.includes("税前造价"),
      hasTotal: text.includes("合计"),
      textHead: small(text, 500),
    };
  };
  const inspectIframeInWindow = async (win, url) => {
    const nested = win.document.createElement("iframe");
    nested.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1400px;height:1000px;";
    win.document.body.appendChild(nested);
    try {
      nested.src = new win.URL(url, win.location.href).href;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("nested detail iframe timeout")), 25000);
        nested.onload = () => { clearTimeout(timeout); resolve(); };
      });
      await sleep(1000);
      const html = nested.contentDocument?.documentElement?.outerHTML || "";
      const detailDoc = new DOMParser().parseFromString(html, "text/html");
      const text = cleanText(detailDoc.body?.innerText || detailDoc.documentElement?.textContent || "");
      return {
        url: nested.contentWindow?.location?.href || "",
        title: detailDoc.title,
        tableCount: detailDoc.querySelectorAll("table").length,
        rowCount: detailDoc.querySelectorAll("table tr").length,
        hasTaxBefore: text.includes("税前造价"),
        hasTotal: text.includes("合计"),
        textHead: small(text, 500),
      };
    } finally {
      nested.remove();
    }
  };

  const chart = await openChartByMenu();
  const listUrl = "WorkAsp/zhcx/cbzhxx_zrsList.aspx?fgsid="
    + encodeURIComponent(project.fgsid || "")
    + "&t=" + encodeURIComponent(project.t || "")
    + "&xmzt=2";
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1400px;height:1000px;";
  document.body.appendChild(frame);
  try {
    frame.src = absoluteUrl(listUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("list iframe timeout")), 25000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
    });
    const deadline = Date.now() + 20000;
    let store = null;
    while (Date.now() < deadline) {
      const win = frame.contentWindow;
      store = win.Store1 || win.Ext?.getCmp?.("Store1");
      if (store && typeof store.getRange === "function") break;
      await sleep(300);
    }
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const records = store?.getRange?.().map((record) => record.data || {}) || [];
    const row = records.find((item) => item.xmid === project.pid && item.hsdxid === project.hsdxid) || records[0] || {};
    const html = doc.documentElement.outerHTML;
    const scripts = Array.from(doc.querySelectorAll("script")).map((script) => script.textContent || "").join("\\n");
    const contexts = (html.match(/.{0,120}(CostAnalysis|CostPlan|WBS|hsdx|xmid|dblclick|rowdblclick|Renderer|renderer|showInfo|Open|open).{0,220}/g) || [])
      .slice(0, 45)
      .map((item) => item.replace(/\\s+/g, " "));
    const scriptContexts = (scripts.match(/.{0,120}(CostAnalysis|CostPlan|WBS|hsdx|xmid|dblclick|rowdblclick|Renderer|renderer|showInfo|Open|open).{0,220}/g) || [])
      .slice(0, 45)
      .map((item) => item.replace(/\\s+/g, " "));
    const functionHits = Object.keys(win)
      .filter((key) => typeof win[key] === "function")
      .map((key) => {
        let source = "";
        try { source = String(win[key]); } catch {}
        return { key, source: small(source.replace(/\\s+/g, " "), 2500) };
      })
      .filter((item) => /CostAnalysis|CostPlan|WBS|hsdx|xmid|showInfo|open|Open/i.test(item.source + item.key))
      .slice(0, 30);
    const components = [];
    try {
      const all = win.Ext?.ComponentMgr?.all;
      if (all?.each) {
        all.each((cmp) => {
          const xtype = cmp.getXType?.() || cmp.xtype || "";
          if (/grid|column|store|panel|button|menu/i.test(xtype + " " + (cmp.id || ""))) {
            const columns = (cmp.getColumnModel?.().config || cmp.columns || [])
              .map((col) => ({
                header: col.header || col.text || "",
                dataIndex: col.dataIndex || "",
                renderer: col.renderer ? small(String(col.renderer).replace(/\\s+/g, " "), 500) : "",
              }))
              .filter((col) => col.header || col.dataIndex || col.renderer);
            components.push({
              id: cmp.id || "",
              xtype,
              title: cmp.title || "",
              columns: columns.slice(0, 20),
            });
          }
        });
      }
    } catch (error) {
      components.push({ error: error.message });
    }

    const contractUrl = "WorkAsp/CostManage/costplan/CostPlanMain_MainPlan.aspx?" + new URLSearchParams({
      treeno: "12345",
      FormState: "OnlyView",
      OnlyShowPassed: "",
      pid: project.pid,
      pname: "集团公司",
      hsdxmc: project.hsdx,
      hsdxid: project.hsdxid,
      OldZYType: "",
      gChildrenNum: "0",
    });

    return {
      chart,
      project: {
        name: project.name,
        company: project.company,
        fgsid: project.fgsid,
        t: project.t,
        pid: project.pid,
        hsdxid: project.hsdxid,
        hsdx: project.hsdx,
        href: project.href,
      },
      list: {
        url: win.location.href,
        storeFound: !!store,
        total: Number(store?.getTotalCount?.() ?? store?.getCount?.() ?? records.length),
        visibleCount: records.length,
        rowKeys: Object.keys(row),
        row,
        domLinks: Array.from(doc.querySelectorAll("a,[onclick]")).slice(0, 30).map((el) => ({
          text: cleanText(el.innerText || el.textContent),
          href: el.href || "",
          onclick: el.getAttribute("onclick") || "",
        })),
        contexts,
        scriptContexts,
        functionHits,
        components,
        getmxSource: typeof win.getmx === "function" ? small(String(win.getmx).replace(/\\s+/g, " "), 4000) : "",
      },
      manualUrls: {
        cost: await inspectResponse(project.href),
        contract: await inspectResponse(contractUrl),
        costFromListFetch: await inspectResponseInWindow(win, project.href),
        contractFromListFetch: await inspectResponseInWindow(win, contractUrl),
        costFromListIframe: await inspectIframeInWindow(win, project.href),
        contractFromListIframe: await inspectIframeInWindow(win, contractUrl),
      },
    };
  } finally {
    frame.remove();
  }
})()
`;

const result = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
if (result.exceptionDetails) {
  console.log(JSON.stringify(result.exceptionDetails, null, 2));
} else {
  console.log(JSON.stringify(result.result?.value, null, 2));
}
ws.close();
