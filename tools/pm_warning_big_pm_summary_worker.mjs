import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const defaultResultPath = path.join(root, "data", "pm_warning_results", "latest_big-pm.json");
const port = process.env.BIG_PM_CDP_PORT || "9333";
const allowPageNavigation = process.env.PM_WARNING_ALLOW_PAGE_NAVIGATION === "1";
const allowDetailPatch = process.env.PM_WARNING_BIG_PM_PATCH_DETAILS === "1";
const summaryPageUrl = "http://yanjianpm.glodon.com/YJJT/CBGL/CBZHQKZPage/CBZHQKZPage.aspx?menuitemid=1007958&frame=400001&modulecode=YJJT.CBGL.CBZHQKZQueryModule&layout=C";

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

const jobInfo = jobPath ? readJson(jobPath, {}) : {};
const resultPath = jobInfo.resultPath || defaultResultPath;
const reportPeriod = process.env.PM_WARNING_PERIOD || jobInfo.period || "";

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function updateJob(patch) {
  if (!jobPath) return;
  const job = readJson(jobPath, {});
  writeJson(jobPath, { ...job, ...patch, updatedAt: nowText() });
}

async function connectPage() {
  const listPages = () => fetch(`http://localhost:${port}/json/list`).then((response) => response.json());
  const candidatePages = (pages) => pages.filter((item) =>
    item.type === "page"
    && item.url.includes("yanjianpm.glodon.com")
    && !item.url.toLowerCase().includes("login")
  );

  let pages = await listPages();
  let candidates = candidatePages(pages);
  let page = candidates.find((item) => item.url.includes("CBZHQKZPage"));
  page = page
    || candidates.find((item) => item.url.includes("/Portal/Frame/LayoutC/Default.aspx"))
    || candidates[0];
  if (!page) throw new Error(`未在 ${port} 调试端口找到已登录的大PM页面`);

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
  return { ws, send };
}

async function evaluate(send, expression, options = {}) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...options,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
  }
  return result.result?.result?.value ?? result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function navigateToSummaryPage(send) {
  await send("Page.enable");
  await send("Page.navigate", { url: summaryPageUrl });
}

async function ensureSummaryPage(send) {
  let result = await evaluate(send, ensureSummaryExpression).catch((error) => ({
    ok: false,
    message: error?.message || String(error),
  }));
  if (result?.ok || !allowPageNavigation) return result;

  updateJob({
    status: "抓取大PM汇总",
    message: "门户内未定位到成本综合情况分析页，正在复用当前 9333 标签直接进入...",
  });
  await navigateToSummaryPage(send);
  await sleep(4000);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    result = await evaluate(send, ensureSummaryExpression).catch((error) => ({
      ok: false,
      message: error?.message || String(error),
    }));
    if (result?.ok) return { ...result, navigated: true };
    await sleep(2000);
  }
  return result;
}

const ensureSummaryExpression = `(() => new Promise(async (resolve) => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const directGrid = () => globalThis.Ext?.getCmp?.("gridView");
  if (directGrid()) {
    return resolve({ ok: true, opened: false, method: "direct" });
  }
  const frame = () => Array.from(document.querySelectorAll("iframe"))
    .find((item) => item.src.includes("CBZHQKZPage"));
  if (frame()) return resolve({ ok: true, opened: false, method: "exists" });
  if (!${allowPageNavigation ? "true" : "false"}) {
    return resolve({
      ok: false,
      message: "为避免影响当前工作，程序不会自动打开或切换大PM网页；请先在专用Chrome调试窗口打开 成本管理 > 成本综合情况分析 页面后再点开始生成。"
    });
  }

  let opened = false;
  try {
    const base = window.$G?.getPageURLByFullName?.("YJJT.CBGL.CBZHQKZPage");
    if (base && window.$G?.open) {
      window.$G.open({
        url: base + "?menuitemid=1007958&frame=400001&modulecode=YJJT.CBGL.CBZHQKZQueryModule&layout=C",
        title: "成本综合情况总",
        target: "_tab"
      });
      opened = true;
    }
  } catch (e) {}

  const clickText = (text, preferredId = "") => {
    const nodes = Array.from(document.querySelectorAll("a,button,span,div,td,li"));
    const byId = preferredId ? document.getElementById(preferredId) : null;
    const node = byId
      || nodes.find((item) => (item.innerText || item.textContent || "").trim() === text)
      || nodes.find((item) => (item.innerText || item.textContent || "").trim().includes(text));
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + Math.min(10, Math.max(1, rect.width / 2));
    const y = rect.top + Math.min(10, Math.max(1, rect.height / 2));
    for (const type of ["mouseover", "mouseenter", "mousemove", "mousedown"]) {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    node.click();
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    return true;
  };
  if (!opened) {
    clickText("成本管理", "hoverMenu_1003614");
    await sleep(1200);
    opened = clickText("成本综合情况分析", "hoverA_1007958");
  }

  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (directGrid()) return resolve({ ok: true, opened, method: opened ? "direct-open" : "direct-wait" });
    const target = frame();
    if (target) return resolve({ ok: true, opened, method: opened ? "open" : "wait" });
    await sleep(500);
  }
  resolve({ ok: false, message: "未能自动打开大PM 成本管理 > 成本综合情况分析 页面" });
}))()`;

const collectSummaryExpression = `(() => new Promise(async (resolve) => {
  try {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const number = (value) => {
    const n = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const frame = Array.from(document.querySelectorAll("iframe")).find((item) => item.src.includes("CBZHQKZPage"));
  const win = frame?.contentWindow || globalThis;
  const grid = win.Ext?.getCmp("gridView");
  if (!grid) return resolve({ ok: false, message: "未找到大PM汇总表 gridView，请稍后重试" });
  const readRows = () => {
    const store = grid.getStore?.();
    return store?.getRange?.()?.map((record) => record.data) || [];
  };
  let rows = [];
  const start = Date.now();
  while (Date.now() - start < 20000) {
    rows = readRows();
    const totalCandidate = rows.find((row) => clean(row.BT || row.LX) === "合计");
    if (rows.length && number(totalCandidate?.HJ) > 0) break;
    await sleep(500);
  }
  const title = (row) => clean(row.BT || row.LX);
  const findTitle = (text) => rows.find((row) => title(row) === text) || {};
  const normalRow = findTitle("完成责任目标");
  const blueRow = rows.find((row) => title(row).includes("不亏损")) || {};
  const redRow = findTitle("亏损");
  const totalRow = findTitle("合计");
  const rateRow = rows.find((row) => title(row).includes("利润率")) || {};
  const companyMap = {};
  for (const item of (win.$G?.Page?.GSLB || [])) {
    if (item?.GSMC) companyMap[clean(item.GSMC)] = item.GSID;
  }
  const columns = (grid.getColumnModel?.().config || [])
    .filter((col) => /^GS\\d+$/.test(col.dataIndex || "") && clean(col.header));
  const companies = columns.map((col) => ({
    company: clean(col.header),
    gsid: companyMap[clean(col.header)] ?? null,
    normal: number(normalRow[col.dataIndex]),
    blue: number(blueRow[col.dataIndex]),
    red: number(redRow[col.dataIndex]),
    total: number(totalRow[col.dataIndex]),
    avgProfitRate: number(rateRow[col.dataIndex]),
    sourcePlatform: "big-pm"
  })).filter((item) => item.gsid != null);
  const ensureFrame = (id) => {
    let child = document.getElementById(id);
    if (!child) {
      child = document.createElement("iframe");
      child.id = id;
      child.style.position = "absolute";
      child.style.left = "-20000px";
      child.style.top = "0";
      child.style.width = "1600px";
      child.style.height = "900px";
      document.body.appendChild(child);
    }
    return child;
  };
  const loadFrame = async (child, url, test, timeoutMs = 8000) => {
    child.src = url;
    const begin = Date.now();
    while (Date.now() - begin < timeoutMs) {
      await sleep(400);
      try {
        if (child.contentWindow && child.contentDocument?.readyState !== "loading" && (!test || test(child.contentWindow))) return true;
      } catch (e) {}
    }
    return false;
  };
  const waitStoreRows = async (store, expected) => {
    const read = () => {
      try {
        return store?.getRange?.()?.map((record) => ({ ...record.data })) || [];
      } catch (e) {
        return [];
      }
    };
    const totalCount = () => {
      try {
        return Number(store?.getTotalCount?.() ?? store?.getCount?.() ?? 0);
      } catch (e) {
        return 0;
      }
    };
    const begin = Date.now();
    while (Date.now() - begin < 3000) {
      const rows = read();
      const total = totalCount() || rows.length;
      if (rows.length >= expected || (expected > 0 && total >= expected && rows.length > 0)) return rows;
      await sleep(400);
    }
    return read();
  };
  const projects = [];
  const listChecks = [];
  const listBase = null;
  if (listBase) {
    const listFrame = ensureFrame("codexBigPmWarningListFrame");
    const typeDefs = [
      { type: "red", t: "ks", code: "KS", status: "红色" },
      { type: "blue", t: "wwc", code: "BKSDWWCMBCB", status: "蓝色" }
    ];
    let sequence = 1;
    for (const company of companies) {
      for (const typeDef of typeDefs) {
        const expected = Number(company[typeDef.type]) || 0;
        if (!expected) continue;
        const url = listBase + "?autoLoad=true&modulecode=YJJT.CBFXGL.XMSJLBQueryModule"
          + "&GSID=" + encodeURIComponent(company.gsid)
          + "&LX=" + encodeURIComponent(typeDef.code)
          + "&XMZT=ZS&_dc=" + Date.now() + "&layout=C";
        const loaded = await loadFrame(listFrame, url, (childWin) => !!childWin.Ext?.getCmp("GridResultView")?.getStore?.());
        if (!loaded) {
          listChecks.push({ company: company.company, type: typeDef.type, expected, actual: 0, ok: false, sourcePlatform: "big-pm" });
          continue;
        }
        const childWin = listFrame.contentWindow;
        const store = childWin.Ext.getCmp("GridResultView").getStore?.();
        if (!store) {
          listChecks.push({ company: company.company, type: typeDef.type, expected, actual: 0, ok: false, sourcePlatform: "big-pm", message: "列表页Store未就绪" });
          continue;
        }
        const rows = await waitStoreRows(store, expected);
        listChecks.push({
          company: company.company,
          type: typeDef.type,
          status: typeDef.status,
          expected,
          actual: rows.length,
          ok: rows.length === expected,
          sourcePlatform: "big-pm"
        });
        for (const row of rows) {
          projects.push({
            name: clean(row.XMMC || row.XMName || row.PROJECTNAME),
            company: company.company,
            major: clean(row.ZYLX || row.HSDX),
            hsdx: clean(row.HSDX),
            manager: clean(row.XMJL || row.XMFZR),
            status: typeDef.status,
            type: typeDef.type,
            t: typeDef.t,
            projectStatus: clean(row.XMZT),
            reduceDuty: row.ZRSBM ?? null,
            responsibilityTargetDisplay: row.ZRSBM ?? null,
            reduceActual: row.SJJDL ?? row.XMLRL ?? null,
            profitRate: row.XMLRL ?? null,
            budget: null,
            actual: null,
            reduction: null,
            contract: null,
            deptId: row.DEPTID,
            hsdxId: row.HSDXID,
            pid: row.XMID || row.PROJECTID || "",
            sequence: sequence++,
            sourcePlatform: "big-pm",
            sourceRaw: {
              gsid: row.SSGSID || company.gsid,
              listBudgetYuan: row.LJYSCBJE,
              listActualYuan: row.LJSJCBJE
            }
          });
        }
      }
    }
  }
  const totals = {
    companies: companies.length,
    inProgress: companies.reduce((sum, item) => sum + item.total, 0),
    normal: companies.reduce((sum, item) => sum + item.normal, 0),
    blue: companies.reduce((sum, item) => sum + item.blue, 0),
    red: companies.reduce((sum, item) => sum + item.red, 0),
    detailProjects: projects.length,
    amountComplete: 0,
    amountMissing: projects.length
  };
  if (totals.inProgress <= 0) {
    return resolve({ ok: false, message: "大PM汇总表尚未加载出有效数据，本次未写入结果" });
  }
  return resolve({ ok: true, frameUrl: frame?.src || location.href, companies, projects, listChecks, totals });
  } catch (error) {
    return resolve({ ok: false, message: error?.message || String(error), stack: error?.stack || "" });
  }
}))()`;

try {
  updateJob({ status: "连接大PM平台", message: "正在连接已登录的大PM Chrome 调试端口..." });
  const { ws, send } = await connectPage();

  updateJob({ status: "抓取大PM汇总", message: "正在自动打开大PM成本综合情况分析页面..." });
  const ensureResult = await ensureSummaryPage(send);
  if (!ensureResult?.ok) throw new Error(ensureResult?.message || "大PM汇总页打开失败");

  updateJob({ status: "抓取大PM汇总", message: "正在读取大PM红蓝预警汇总表..." });
  const value = await evaluate(send, collectSummaryExpression);
  ws.close();
  if (!value?.ok) throw new Error((value?.message || "big pm capture failed") + (value?.stack ? "\\n" + value.stack : ""));

  const now = new Date().toISOString();
  const data = {
    source: {
      menuPath: "成本管理 > 成本综合情况分析",
      page: value.frameUrl,
      projectStatus: "在建",
      platform: "big-pm",
      displaySource: "大PM平台实时抓数",
      collectedAt: now,
      status: "completed",
      note: "大PM汇总数已正式抓取；项目明细金额后续分批补抓。"
    },
    companies: value.companies,
    listChecks: value.listChecks || [],
    projects: value.projects || [],
    detailHealth: {
      total: (value.projects || []).length,
      budget: 0,
      actual: 0,
      reduction: 0,
      complete: 0,
      missing: (value.projects || []).length,
      contract: 0
    },
    totals: value.totals,
    capture: { platform: "big-pm", platformName: "大PM平台", status: "completed", capturedAt: now }
  };
  writeJson(resultPath, data);
  if (allowDetailPatch) {
    updateJob({ status: "抓取大PM汇总", message: "大PM汇总已写入，正在补抓大PM红蓝项目明细..." });
    const detailPatch = spawnSync(process.execPath, [path.join(root, "tools", "pm_warning_big_pm_patch_details.mjs")], {
      cwd: root,
      env: { ...process.env, BIG_PM_CDP_PORT: port, PM_WARNING_PERIOD: reportPeriod, PM_WARNING_RESULT_PATH: resultPath },
      encoding: "utf8",
      timeout: 1800000,
    });
    if (detailPatch.status === 0) {
      const patched = readJson(resultPath, data);
      data.projects = patched.projects || [];
      data.listChecks = patched.listChecks || [];
      data.detailHealth = patched.detailHealth || data.detailHealth;
      data.totals = patched.totals || data.totals;
    }
  } else {
    updateJob({ status: "抓取大PM汇总", message: "大PM汇总已写入；为避免影响当前工作，未自动打开项目明细页。" });
  }
  const warningTotal = (Number(data.totals.red) || 0) + (Number(data.totals.blue) || 0);
  const detailTotal = Number(data.detailHealth?.total) || Number(data.totals.detailProjects) || 0;
  const pendingDetail = Math.max(0, warningTotal - detailTotal);
  const completionMessage = pendingDetail
    ? `大PM平台汇总抓取完成：在建 ${data.totals.inProgress} 项，红色 ${data.totals.red} 项，蓝色 ${data.totals.blue} 项；项目明细仍有 ${pendingDetail} 项待补抓。`
    : `大PM平台抓数完成：在建 ${data.totals.inProgress} 项，红色 ${data.totals.red} 项，蓝色 ${data.totals.blue} 项。`;
  updateJob({
    status: "已完成",
    message: completionMessage,
    totals: data.totals,
    detailHealth: data.detailHealth,
    completedAt: nowText(),
  });
  console.log(JSON.stringify({ resultPath, totals: data.totals }, null, 2));
} catch (error) {
  updateJob({
    status: "失败",
    message: error?.message || String(error),
    failedAt: nowText(),
  });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
