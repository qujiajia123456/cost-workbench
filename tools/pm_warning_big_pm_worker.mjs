import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data", "pm_warning_results");
const outputPath = process.env.PM_WARNING_OUTPUT || path.join(dataDir, "latest_big-pm.json");
const port = process.env.BIG_PM_CDP_PORT || "9333";

const pages = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const candidates = pages.filter((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
const page = candidates.find((item) => item.url.includes("/Portal/Frame/LayoutC/Default.aspx"))
  || candidates.find((item) => item.url.includes("CBZHQKZPage"))
  || candidates[0];
if (!page) throw new Error(`No logged-in yanjianpm Chrome page found on CDP port ${port}`);

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  callback(message);
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");

const expression = `(() => {
  window.__codexBigPmCaptureResult = null;
  window.__codexBigPmCaptureProgress = { stage: "start" };
  window.__codexBigPmCapturePromise = new Promise(async (resolve) => {
  const finish = (value) => {
    window.__codexBigPmCaptureResult = value;
    resolve(value);
  };
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const number = (value) => {
    const text = clean(value).replace(/,/g, "");
    if (!text || text === "&nbsp;" || text === "-") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };
  const round = (value) => value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
  const wan = (value) => value == null ? null : round(value / 10000);
  const summaryFrame = Array.from(document.querySelectorAll("iframe"))
    .find((item) => item.src.includes("CBZHQKZPage"));
  if (false && !summaryFrame) return finish({ ok: false, message: "未找到成本综合情况分析 iframe" });
  const summaryWin = summaryFrame?.contentWindow || globalThis;
  const Ext = summaryWin.Ext;
  const summaryGrid = Ext?.getCmp("gridView");
  if (!summaryGrid) return finish({ ok: false, message: "未找到大PM汇总表 gridView" });

  const columns = (summaryGrid.getColumnModel?.().config || []).filter((col) => /^GS\\d+$/.test(col.dataIndex || ""));
  const companyMap = {};
  for (const item of (summaryWin.$G?.Page?.GSLB || [])) {
    if (item?.GSMC) companyMap[item.GSMC] = item.GSID;
  }
  const summaryRows = summaryGrid.getStore().getRange().map((record) => record.data);
  const rowTitle = (row) => clean(row.BT || row.LX);
  const rowByTitle = (needle) => summaryRows.find((row) => rowTitle(row).includes(needle)) || {};
  const normalRow = rowByTitle("完成责任目标");
  const blueRow = rowByTitle("不亏损");
  const redRow = rowByTitle("亏损");
  const totalRow = rowByTitle("合计");
  const rateRow = rowByTitle("利润率");
  const companies = columns.map((col) => ({
    company: clean(col.header),
    gsid: companyMap[clean(col.header)] ?? null,
    normal: number(normalRow[col.dataIndex]) || 0,
    blue: number(blueRow[col.dataIndex]) || 0,
    red: number(redRow[col.dataIndex]) || 0,
    total: number(totalRow[col.dataIndex]) || 0,
    avgProfitRate: number(rateRow[col.dataIndex]),
    sourcePlatform: "big-pm"
  })).filter((item) => item.company && item.company !== "合计" && item.gsid != null);

  const ensureFrame = (id) => {
    let frame = document.getElementById(id);
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = id;
      frame.style.position = "absolute";
      frame.style.left = "-20000px";
      frame.style.top = "0";
      frame.style.width = "1600px";
      frame.style.height = "1000px";
      document.body.appendChild(frame);
    }
    return frame;
  };
  const loadFrame = async (frame, url, test, timeoutMs = 20000) => {
    frame.src = url;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(350);
      try {
        if (frame.contentWindow && frame.contentDocument?.readyState !== "loading" && (!test || test(frame.contentWindow))) {
          return true;
        }
      } catch (e) {}
    }
    return false;
  };
  const listBase = summaryWin.$G.getPageURLByFullName("YJJT.CBFXGL.XMSJLBPage");
  const detailBase = summaryWin.$G.getPageURLByFullName("YJJT.CBFXGL.XMCBDBFXBPage");
  const listFrame = ensureFrame("codexBigPmListFrame");
  const detailFrame = ensureFrame("codexBigPmDetailFrame");

  const typeDefs = [
    { type: "red", code: "KS", status: "红色", lxText: "亏损" },
    { type: "blue", code: "BKSDWWCMBCB", status: "蓝色", lxText: "不亏损但未完成目标成本" }
  ];
  const listChecks = [];
  const projects = [];
  const errors = [];

  const collectList = async (company, typeDef) => {
    const expected = company[typeDef.type] || 0;
    if (!expected || !company.gsid) return [];
    window.__codexBigPmCaptureProgress = { stage: "list", company: company.company, type: typeDef.type, expected, projects: projects.length };
    const url = listBase + "?autoLoad=true&modulecode=YJJT.CBFXGL.XMSJLBQueryModule"
      + "&GSID=" + encodeURIComponent(company.gsid)
      + "&LX=" + encodeURIComponent(typeDef.code)
      + "&XMZT=ZS&_dc=" + Date.now() + "&layout=C";
    const loaded = await loadFrame(listFrame, url, (win) => !!win.Ext?.getCmp("GridResultView")?.getStore?.(), 25000);
    if (!loaded) {
      errors.push({ company: company.company, type: typeDef.type, message: "列表页加载超时" });
      return [];
    }
    const win = listFrame.contentWindow;
    const grid = win.Ext.getCmp("GridResultView");
    const store = grid.getStore();
    await sleep(500);
    const rows = store.getRange().map((record) => ({ ...record.data }));
    listChecks.push({
      company: company.company,
      status: typeDef.status,
      type: typeDef.type,
      expected,
      actual: rows.length,
      ok: rows.length === expected,
      sourcePlatform: "big-pm"
    });
    return rows.map((row) => ({
      row,
      company: company.company,
      status: typeDef.status,
      type: typeDef.type,
      t: typeDef.type === "red" ? "ks" : "wwc"
    }));
  };

  const parseDetail = async (project) => {
    const row = project.row;
    window.__codexBigPmCaptureProgress = { stage: "detail", company: project.company, type: project.type, project: clean(row.XMMC), hsdx: clean(row.HSDX), projects: projects.length };
    const url = detailBase + "?_dc=" + Date.now()
      + "&DEPTID=" + encodeURIComponent(row.DEPTID)
      + "&HSDX=" + encodeURIComponent(row.HSDX)
      + "&HSDXID=" + encodeURIComponent(row.HSDXID)
      + "&state=STATE_VIEW&modulecode=YJJT.CBFXGL.XMCBDBFXBQueryModule&layout=C";
    const loaded = await loadFrame(detailFrame, url, (win) => {
      const text = win.document?.body?.innerText || "";
      return text.includes("合计行(不含税)") || !!win.Ext?.getCmp("treeGrid");
    }, 30000);
    if (!loaded) {
      errors.push({ project: row.XMMC, hsdx: row.HSDX, message: "成本对比分析详情加载超时" });
      return {};
    }
    await sleep(800);
    const doc = detailFrame.contentDocument;
    const rowEl = Array.from(doc.querySelectorAll(".x-grid3-row, tr"))
      .find((item) => clean(item.innerText || item.textContent).includes("合计行(不含税)"));
    if (!rowEl) {
      errors.push({ project: row.XMMC, hsdx: row.HSDX, message: "未找到合计行(不含税)" });
      return {};
    }
    const val = (field) => {
      const cell = rowEl.querySelector(".x-grid3-td-col_" + field);
      return number(cell?.innerText || cell?.textContent);
    };
    const budgetYuan = val("YSCB_JE");
    const actualYuan = val("SJCB_JE");
    const reductionYuan = val("YSCBYSJCB_JDE");
    const reduceActual = val("YSCBYSJCB_JDL");
    const targetReduceDuty = val("MBCBYSJCB_JDL");
    const reasonRows = Array.from(doc.querySelectorAll(".x-grid3-td-col_YYFX"))
      .map((cell) => clean(cell.innerText || cell.textContent))
      .filter(Boolean);
    return {
      budget: wan(budgetYuan),
      actual: wan(actualYuan),
      reduction: wan(reductionYuan),
      reduceActual,
      reduceDuty: targetReduceDuty,
      reason: reasonRows.join("\\n"),
      detailRaw: { budgetYuan, actualYuan, reductionYuan }
    };
  };

  for (const company of companies) {
    for (const typeDef of typeDefs) {
      const listRows = await collectList(company, typeDef);
      for (const item of listRows) {
        const row = item.row;
        const detail = await parseDetail(item);
        projects.push({
          project: clean(row.XMMC),
          company: item.company,
          major: clean(row.ZYLX || row.HSDX),
          accountingObject: clean(row.HSDX),
          manager: clean(row.XMJL),
          status: item.status,
          type: item.type,
          t: item.t,
          projectStatus: clean(row.XMZT),
          dutyTarget: row.ZRSBM ?? null,
          profitRate: row.XMLRL ?? null,
          reduceDuty: detail.reduceDuty ?? row.ZRSBM ?? null,
          reduceActual: detail.reduceActual ?? row.SJJDL ?? row.XMLRL ?? null,
          budget: detail.budget,
          actual: detail.actual,
          reduction: detail.reduction,
          contract: null,
          reason: detail.reason || "",
          deptId: row.DEPTID,
          hsdx: row.HSDX,
          hsdxId: row.HSDXID,
          sourcePlatform: "big-pm",
          sourceRaw: {
            gsid: row.SSGSID,
            listBudgetYuan: row.LJYSCBJE,
            listActualYuan: row.LJSJCBJE,
            detailRaw: detail.detailRaw || null
          }
        });
      }
    }
  }

  const red = companies.reduce((sum, item) => sum + item.red, 0);
  const blue = companies.reduce((sum, item) => sum + item.blue, 0);
  const normal = companies.reduce((sum, item) => sum + item.normal, 0);
  const inProgress = companies.reduce((sum, item) => sum + item.total, 0);
  const amountComplete = projects.filter((item) => item.budget != null && item.actual != null && item.reduction != null).length;
  finish({
    ok: true,
    source: {
      menuPath: "成本管理 > 成本综合情况分析",
      page: summaryFrame?.src || location.href,
      projectStatus: "在建",
      platform: "big-pm",
      displaySource: "大PM平台实时抓数",
      collectedAt: new Date().toISOString()
    },
    companies,
    listChecks,
    projects,
    detailHealth: {
      total: projects.length,
      budget: projects.filter((item) => item.budget != null).length,
      actual: projects.filter((item) => item.actual != null).length,
      reduction: projects.filter((item) => item.reduction != null).length,
      complete: amountComplete,
      missing: projects.length - amountComplete,
      contract: 0
    },
    totals: {
      companies: companies.length,
      inProgress,
      normal,
      blue,
      red,
      detailProjects: projects.length,
      amountComplete,
      amountMissing: projects.length - amountComplete
    },
    capture: {
      platform: "big-pm",
      platformName: "大PM平台",
      status: "completed",
      capturedAt: new Date().toISOString()
    },
    errors
  });
  });
  return window.__codexBigPmCapturePromise;
})()`;

const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 240000 });
ws.close();
if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(1);
}
const value = result.result?.result?.value || result.result?.value;
if (!value?.ok) {
  console.error(JSON.stringify(value || result, null, 2));
  process.exit(1);
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(value, null, 2), "utf8");
console.log(JSON.stringify({
  outputPath,
  totals: value.totals,
  detailHealth: value.detailHealth,
  listChecks: value.listChecks.filter((item) => !item.ok),
  errors: value.errors.slice(0, 10)
}, null, 2));
