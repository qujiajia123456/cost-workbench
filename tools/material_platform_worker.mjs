import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const JOB_DIR = path.join(DATA_DIR, "codex_material_jobs");
const CAPTURE_DIR = path.join(DATA_DIR, "material_captures");
const SOURCE_ROOT = path.join(DATA_DIR, "bid_price_sources");
const CDP_URL = process.env.MATERIAL_PLATFORM_CDP || "http://127.0.0.1:9222";
const PM_URL = "http://yanjianpm.glodon.com/Portal/Frame/LayoutC/Default.aspx";
const JICAI_URL = "http://yanjianjicai.gyuncai.com/";
const JICAI_MAIN_URL = "http://yanjianjicai.gyuncai.com/base/main";
const MATERIAL_BID_INFO_URL = "http://yanjianpm.glodon.com/GEPS/Material/PricePlatForm/WZCGJGDBPage/WZCGJGDBPage.aspx";
const MATERIAL_SOURCE_JSON = path.join(DATA_DIR, "material_price_source.json");

const REPORTS = [
  {
    key: "comparison",
    name: "中标价格对比分析",
    platform: "集采平台",
    baseUrl: JICAI_URL,
    menu: ["数据中心", "项目定制报表", "中标价格对比分析"],
    directUrl: "http://yanjianjicai.gyuncai.com/report/sourcing/v?_m=yjjt_price_comparison",
    dateLabel: "招标结果发布时间",
  },
  {
    key: "query",
    name: "中标价格查询",
    platform: "集采平台",
    baseUrl: JICAI_URL,
    menu: ["数据中心", "项目定制报表", "中标价格查询"],
    directUrl: "http://yanjianjicai.gyuncai.com/report/sourcing/v?_m=yjjt_winning_bid_price",
    dateLabel: "中标日期",
  },
  {
    key: "ledger",
    name: "招标结果台帐",
    platform: "集采平台",
    baseUrl: JICAI_URL,
    menu: ["数据中心", "交易报表", "招标结果台帐"],
    directUrl: "http://yanjianjicai.gyuncai.com/report/sourcing/simple/v?_m=tender/proc_tender_finish_result",
    dateLabel: "结果发布日期",
  },
];

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function safeName(text) {
  return String(text || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

function resolveJobPath(jobIdOrPath) {
  if (!jobIdOrPath) throw new Error("缺少任务ID或任务文件路径。");
  if (fs.existsSync(jobIdOrPath)) return path.resolve(jobIdOrPath);
  const direct = path.join(JOB_DIR, `${jobIdOrPath}.json`);
  if (fs.existsSync(direct)) return direct;
  const matches = fs.existsSync(JOB_DIR)
    ? fs.readdirSync(JOB_DIR).filter((name) => name.startsWith(jobIdOrPath) && name.endsWith(".json"))
    : [];
  if (matches.length) return path.join(JOB_DIR, matches[0]);
  throw new Error(`未找到任务: ${jobIdOrPath}`);
}

function updateJob(jobPath, patch) {
  const job = readJson(jobPath, {});
  Object.assign(job, patch, { updatedAt: nowText() });
  writeJson(jobPath, job);
  return job;
}

function updateDbTask(taskId, patch) {
  const db = readJson(DB_PATH, {});
  let changed = false;
  for (const task of db.materialPriceTasks || []) {
    if (task.id === taskId) {
      Object.assign(task, patch);
      changed = true;
    }
  }
  if (changed) writeJson(DB_PATH, db);
}

function setStatus(jobPath, status, message, extra = {}) {
  const job = updateJob(jobPath, {
    status,
    workerMessage: message,
    workerUpdatedAt: nowText(),
    ...extra,
  });
  if (job.id) {
    updateDbTask(job.id, {
      status,
      message,
      materialWorkerUpdatedAt: nowText(),
      materialWorkerLog: extra.capturePath || extra.sourceDir || extra.error || "",
      ...(extra.sourceDir ? { sourceDir: extra.sourceDir } : {}),
      ...(extra.sourcePaths ? { sourcePaths: extra.sourcePaths } : {}),
    });
  }
  console.log(`${status}: ${message}`);
  return job;
}

function launchDebugBrowser() {
  const userDataDir = path.join(DATA_DIR, "edge-material-worker-profile");
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = ["--remote-debugging-port=9222", `--user-data-dir=${userDataDir}`, JICAI_MAIN_URL];
  try {
    const child = process.platform === "win32"
      ? spawn("cmd.exe", ["/c", "start", "", "msedge", ...args], { detached: true, stdio: "ignore", windowsHide: false })
      : spawn("google-chrome", args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function connectBrowser(jobPath) {
  setStatus(jobPath, "连接平台中", `正在连接已登录浏览器 ${CDP_URL}`);
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch (error) {
    const launched = launchDebugBrowser();
    setStatus(
      jobPath,
      launched ? "等待平台登录" : "等待已登录浏览器",
      launched
        ? "未检测到 9222 调试端口，已自动打开平台浏览器。请完成登录后重新发布或刷新采集。"
        : "未检测到 9222 调试端口。请先用带远程调试端口的浏览器登录集采平台。",
      { error: String(error?.message || error) },
    );
    return null;
  }
}

async function browserSnapshot(browser, job, capturePath) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const snapshot = {
    jobId: job.id,
    capturedAt: nowText(),
    pages: await Promise.all(pages.map(async (page) => ({
      title: await page.title().catch(() => ""),
      url: page.url(),
      frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
    }))),
    filters: job.filters || {},
    requiredReports: REPORTS.map((item) => item.name),
  };
  writeJson(capturePath, snapshot);
}

async function clickTextInFrame(frame, text, timeout = 1200) {
  const locators = [
    frame.getByText(text, { exact: true }),
    frame.getByText(text, { exact: false }),
    frame.locator(`text=${text}`),
  ];
  for (const locator of locators) {
    try {
      const first = locator.first();
      await first.waitFor({ state: "visible", timeout });
      await first.click({ timeout });
      return true;
    } catch {}
  }
  return false;
}

async function clickText(page, text, timeout = 1200) {
  for (const frame of page.frames()) {
    if (await clickTextInFrame(frame, text, timeout)) return true;
  }
  return false;
}

async function openReportPage(context, report) {
  const page = await context.newPage();
  await page.goto(report.directUrl || report.baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  if (!report.directUrl) {
    for (const item of report.menu) {
      await clickText(page, item, 1800);
      await page.waitForTimeout(900);
    }
  }
  const foundByText = await clickText(page, report.name, 2500);
  await page.waitForTimeout(2000);
  let hasName = false;
  for (const frame of page.frames()) {
    try {
      if ((await frame.getByText(report.name, { exact: false }).count()) > 0) {
        hasName = true;
        break;
      }
    } catch {}
  }
  return { page, found: foundByText || hasName };
}

async function setDateInputs(page, filters, report) {
  const startDate = filters.startDate || "";
  const endDate = filters.endDate || "";
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(({ startDate, endDate, reportKey }) => {
        const setValue = (el, value) => {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
        };
        const setMini = (id, value) => {
          const widget = window.mini && mini.get(id);
          if (widget && value) {
            widget.setValue(value);
            if (widget.setText) widget.setText(value);
            if (widget.doValueChanged) widget.doValueChanged();
            return true;
          }
          const text = document.getElementById(`${id}$text`);
          const hidden = document.getElementById(`${id}$value`);
          if (text && value) setValue(text, value);
          if (hidden && value) setValue(hidden, value);
          return Boolean(text || hidden);
        };
        const pairs = {
          comparison: ["resultstartdate", "resultenddate"],
          query: ["resultstartdate", "resultenddate"],
          ledger: ["resultstartdate", "resultenddate"],
        };
        const [startId, endId] = pairs[reportKey] || pairs.comparison;
        const hasStart = setMini(startId, startDate);
        const hasEnd = setMini(endId, endDate);
        if (hasStart || hasEnd) return;
        const inputs = Array.from(document.querySelectorAll("input")).filter((el) => {
          const type = (el.getAttribute("type") || "").toLowerCase();
          const text = `${el.id || ""} ${el.name || ""} ${el.placeholder || ""} ${el.className || ""}`.toLowerCase();
          return type !== "hidden" && (type === "date" || /date|time|begin|start|end|日期|时间/.test(text));
        });
        if (inputs[0]) setValue(inputs[0], startDate);
        if (inputs[1]) setValue(inputs[1], endDate);
        if (window.Ext && Ext.ComponentQuery) {
          const fields = Ext.ComponentQuery.query("datefield, textfield");
          const candidates = fields.filter((field) => {
            const text = `${field.id || ""} ${field.name || ""} ${field.fieldLabel || ""}`.toLowerCase();
            return /date|time|begin|start|end|日期|时间/.test(text);
          });
          const toDate = (value) => {
            const parts = String(value || "").replace(/\//g, "-").split("-").map(Number);
            return new Date(parts[0], parts[1] - 1, parts[2]);
          };
          if (candidates[0] && startDate) candidates[0].setValue(toDate(startDate));
          if (candidates[1] && endDate) candidates[1].setValue(toDate(endDate));
        }
      }, { startDate, endDate, reportKey: report.key });
    } catch {}
  }
}

async function clickQuery(page) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(() => {
        if (typeof window.do_gridSearch === "function") {
          window.do_gridSearch();
          return true;
        }
        const buttons = Array.from(document.querySelectorAll(".mini-button, button, a"));
        const target = buttons.find((el) => {
          const text = String(el.innerText || el.textContent || "").replace(/\s+/g, "").trim();
          return text === "搜索" || text === "查询" || text === "检索";
        });
        if (!target) return false;
        target.click();
        return true;
      });
      if (clicked) {
        await page.waitForTimeout(3000);
        return true;
      }
    } catch {}
  }
  const labels = ["查询", "搜索", "检索"];
  for (const label of labels) {
    if (await clickText(page, label, 800)) {
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

async function clickExportAndSave(page, targetPath) {
  const labels = ["导出", "导出Excel", "Excel", "下载", "全部页"];
  for (const label of labels) {
    const downloadPromise = page.waitForEvent("download", { timeout: 18000 }).catch(() => null);
    const clicked = await clickText(page, label, 1200);
    if (!clicked) continue;
    const download = await downloadPromise;
    if (download) {
      await download.saveAs(targetPath);
      return true;
    }
    await page.waitForTimeout(1200);
  }
  return false;
}

async function postJicaiPagedJson(page, url, basePayload, pageSize = 500) {
  return await page.evaluate(async ({ url, basePayload, pageSize }) => {
    const rows = [];
    let total = null;
    let pageIndex = 0;
    while (total === null || pageIndex * pageSize < total) {
      const params = new URLSearchParams({
        ...basePayload,
        pageIndex: String(pageIndex),
        pageSize: String(pageSize),
      });
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01",
        },
        body: params.toString(),
      });
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      const obj = await response.json();
      total = Number(obj.total || 0);
      const chunk = Array.isArray(obj.data) ? obj.data : [];
      rows.push(...chunk);
      if (!chunk.length) break;
      pageIndex += 1;
    }
    return { total: total || 0, pageSize, pageCount: pageIndex, rows };
  }, { url, basePayload, pageSize });
}

async function captureWinningBidPriceJson(page, targetPath, filters) {
  const startDate = filters.startDate || "";
  const endDate = filters.endDate || "";
  const payload = await postJicaiPagedJson(page, "http://yanjianjicai.gyuncai.com/report/yjjt/winningBidPriceController/findPageByDs", {
    "bvo.p.enterpriseid": "4b510f3dbb004b12b1afae5f82bbad92",
    "bvo.p.resultstartdate": `${startDate} 00:00:01`,
    "bvo.p.resultenddate": `${endDate} 23:59:59`,
    "sortOrder": "desc",
  }, 500);
  payload.source = "集采平台-中标价格查询原始数据";
  writeJson(targetPath, payload);
  return payload.rows.length > 0;
}

async function captureTenderLedgerJson(page, targetPath, filters) {
  const startDate = filters.startDate || "";
  const endDate = filters.endDate || "";
  const payload = await postJicaiPagedJson(page, "http://yanjianjicai.gyuncai.com/report/sourcing/tenderfinish/findProcResultPage", {
    "bvo.p.resultpubstartdate": `${startDate} 00:00:00`,
    "bvo.p.resultpubenddate": `${endDate} 23:59:59`,
    "bvo.p.dataAccess": "true",
    "sortField": "resultpublishdate",
    "sortOrder": "desc",
  }, 500);
  payload.source = "集采平台-招标结果台账原始数据";
  writeJson(targetPath, payload);
  return payload.rows.length > 0;
}

async function captureReport(jobPath, browser, job, report, sourceDir) {
  const targetPath = path.join(sourceDir, `${report.key}_${safeName(report.name)}${["query", "ledger"].includes(report.key) ? ".json" : ".xlsx"}`);
  setStatus(jobPath, "集采源采集中", `正在导出${report.platform}：${report.name}`, { sourceDir });
  const context = browser.contexts()[0];
  if (!context) {
    return { ok: false, key: report.key, name: report.name, reason: "未找到可复用的已登录浏览器上下文。" };
  }
  let page;
  let found = false;
  try {
    const opened = await openReportPage(context, report);
    page = opened.page;
    found = opened.found;
    if (report.key === "query") {
      await page.waitForFunction(() => {
        const grid = window.mini && mini.get("_grid_grid");
        return grid && ((grid.getData && grid.getData().length > 0) || Number(grid.totalCount || 0) > 0);
      }, null, { timeout: 45000 });
    }
    await setDateInputs(page, job.filters || {}, report);
    await clickQuery(page);
    if (report.key === "query") {
      const ok = await captureWinningBidPriceJson(page, targetPath, job.filters || {});
      if (ok && fs.existsSync(targetPath)) {
        return { ok: true, key: report.key, name: report.name, path: targetPath };
      }
      return {
        ok: false,
        key: report.key,
        name: report.name,
        reason: "已打开中标价格查询，但未能从集采grid抓取到明细JSON。",
      };
    }
    if (report.key === "ledger") {
      const ok = await captureTenderLedgerJson(page, targetPath, job.filters || {});
      if (ok && fs.existsSync(targetPath)) {
        return { ok: true, key: report.key, name: report.name, path: targetPath };
      }
      return { ok: false, key: report.key, name: report.name, reason: "已打开招标结果台账，但未能从接口抓取到JSON。" };
    }
    const ok = await clickExportAndSave(page, targetPath);
    if (ok && fs.existsSync(targetPath)) {
      return { ok: true, key: report.key, name: report.name, path: targetPath };
    }
    const screenshot = path.join(CAPTURE_DIR, `${job.id}_${report.key}_export_failed.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return {
      ok: false,
      key: report.key,
      name: report.name,
      reason: found ? "已打开报表但未捕获到Excel下载，请适配该页导出按钮。" : "未能自动定位报表入口。",
      screenshot,
    };
  } catch (error) {
    const screenshot = path.join(CAPTURE_DIR, `${job.id}_${report.key}_exception.png`);
    if (page) await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return {
      ok: false,
      key: report.key,
      name: report.name,
      reason: `自动导出异常：${String(error?.message || error)}`,
      screenshot: fs.existsSync(screenshot) ? screenshot : "",
    };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({
        ok: false,
        key: label.key,
        name: label.name,
        reason: `自动导出超过${Math.round(ms / 1000)}秒未完成，请适配该页菜单/查询/导出按钮。`,
      }), ms);
    }),
  ]);
}

async function runFourSourceCapture(jobPath, job, browser) {
  const sourceDir = path.join(SOURCE_ROOT, job.id || safeName(path.basename(jobPath, ".json")));
  fs.mkdirSync(sourceDir, { recursive: true });
  const capturePath = path.join(CAPTURE_DIR, `${job.id || path.basename(jobPath, ".json")}_four_source_snapshot.json`);
  await browserSnapshot(browser, job, capturePath);

  const results = [];
  for (const report of REPORTS) {
    results.push(await withTimeout(captureReport(jobPath, browser, job, report, sourceDir), 120000, report));
  }
  const sourcePaths = results.filter((item) => item.ok).map((item) => item.path);
  const missing = results.filter((item) => !item.ok).map((item) => `${item.name}：${item.reason}`);
  const summaryPath = path.join(sourceDir, "capture_summary.json");
  writeJson(summaryPath, { capturedAt: nowText(), filters: job.filters || {}, results });

  if (sourcePaths.length === REPORTS.length) {
    setStatus(jobPath, "已导出源数据", "集采平台技能源表已自动导出，工作台将自动按技能生成表格。", { sourceDir, sourcePaths, capturePath });
    updateJob(jobPath, { sourceDir, sourcePaths, captureSummary: summaryPath });
  } else {
    setStatus(
      jobPath,
      "等待集采导出适配",
      `已导出${sourcePaths.length}/${REPORTS.length}个集采源表；缺少 ${missing.join("；")}。`,
      { sourceDir, sourcePaths, capturePath },
    );
    updateJob(jobPath, { sourceDir, sourcePaths, captureSummary: summaryPath, missingReports: missing });
  }
}

async function queryMaterialBidInfo(page, filters) {
  await page.evaluate(({ startDate, endDate }) => {
    const toDate = (value) => {
      const parts = String(value || "").replace(/\//g, "-").split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    };
    const setById = (id, value) => {
      const cmp = window.Ext && Ext.getCmp(id);
      if (cmp && value) cmp.setValue(toDate(value));
    };
    setById("QueryFormView_category1_comp_begin", startDate);
    setById("QueryFormView_category1_comp_end", endDate);
    const queryButton = window.Ext && Ext.getCmp("But_CX");
    if (queryButton && queryButton.handler) queryButton.handler.call(queryButton);
    else if (queryButton) queryButton.fireEvent("click", queryButton);
  }, filters);
  await page.waitForFunction(() => {
    const grid = window.Ext && Ext.getCmp("GridResultView");
    if (!grid) return false;
    const store = grid.getStore();
    return store && store.getTotalCount() >= 0 && store.getCount() >= 0;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function loadAllMaterialBidRows(page) {
  const total = await page.evaluate(() => Ext.getCmp("GridResultView").getStore().getTotalCount());
  if (!total) return { total: 0, count: 0 };
  await page.evaluate(({ total }) => {
    const toolbar = Ext.getCmp("GridResultView_toolbar");
    toolbar.pageSize = total;
    toolbar.doLoad(0);
  }, { total });
  await page.waitForFunction(({ total }) => {
    const grid = window.Ext && Ext.getCmp("GridResultView");
    const store = grid && grid.getStore();
    return store && store.getCount() >= total;
  }, { total }, { timeout: 120000 });
  await page.waitForTimeout(800);
  return await page.evaluate(() => {
    const store = Ext.getCmp("GridResultView").getStore();
    return { total: store.getTotalCount(), count: store.getCount() };
  });
}

async function extractMaterialBidRows(page, job) {
  return await page.evaluate(({ filters }) => {
    const clean = (value) => String(value ?? "").trim();
    const grid = Ext.getCmp("GridResultView");
    const store = grid.getStore();
    const fields = store.fields.items.map((field) => field.name);
    const dynamicFields = fields.filter((field) => /^Ex_JGMX_/.test(field));
    const headerByField = {};
    for (const field of dynamicFields) {
      const el = grid.el.dom.querySelector(`.x-grid3-hd-${field}`);
      const text = el ? clean(el.innerText || el.textContent).replace(/\s+/g, " ") : "";
      headerByField[field] = text.replace(/含税合同价|无税合同价/g, "").trim();
    }
    const rows = [];
    for (const record of store.getRange()) {
      const materialCode = clean(record.get("CLBM"));
      const material = clean(record.get("CLMC"));
      const spec = clean(record.get("CLGGXH"));
      const unit = clean(record.get("CLJLDW"));
      for (const field of dynamicFields) {
        const raw = record.get(field);
        const price = Number(String(raw ?? "").replace(/,/g, ""));
        if (!Number.isFinite(price) || price <= 0) continue;
        const unitName = headerByField[field] || field;
        rows.push({
          materialCode,
          listNo: materialCode || `${material}|${spec}|${unit}`,
          material,
          spec,
          unit,
          price,
          quantity: 1,
          amount: price,
          purchaseDate: filters.endDate || filters.startDate || "",
          project: unitName,
          supplier: "",
          company: unitName || filters.company || "",
          platformOrder: field,
          priceField: field,
          source: "平台-材料中标信息",
        });
      }
    }
    return rows;
  }, { filters: job.filters || {} });
}

async function captureAllMaterialBidInfo(jobPath, job, browser) {
  const context = browser.contexts()[0];
  const sourceDir = path.join(SOURCE_ROOT, job.id || safeName(path.basename(jobPath, ".json")));
  fs.mkdirSync(sourceDir, { recursive: true });
  const page = await context.newPage();
  try {
    setStatus(jobPath, "材料中标信息采集中", "正在打开材料中标信息页面并按时间段查询。", { sourceDir });
    await page.goto(MATERIAL_BID_INFO_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.Ext && Ext.getCmp("GridResultView") && Ext.getCmp("But_CX"), null, { timeout: 45000 });
    await queryMaterialBidInfo(page, job.filters || {});
    setStatus(jobPath, "材料中标信息采集中", "正在加载时间段内所有材料中标信息。", { sourceDir });
    const bulk = await loadAllMaterialBidRows(page);
    const rows = await extractMaterialBidRows(page, job);
    const sourceJson = path.join(sourceDir, "material_bid_info_source.json");
    const payload = {
      source: "平台-材料中标信息",
      capturedAt: nowText(),
      filters: job.filters || {},
      totalMaterialRows: bulk.total,
      totalPriceRows: rows.length,
      rows,
    };
    writeJson(sourceJson, payload);
    writeJson(MATERIAL_SOURCE_JSON, payload);
    setStatus(jobPath, "已采集", `已下载/采集时间段内材料中标信息：${bulk.total} 条材料、${rows.length} 条价格记录，可自动建表。`, {
      sourceDir,
      sourcePaths: [sourceJson],
    });
    updateJob(jobPath, { sourceDir, sourcePaths: [sourceJson], preferredOutput: sourceJson });
  } catch (error) {
    const screenshot = path.join(CAPTURE_DIR, `${job.id}_material_bid_info_failed.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    setStatus(jobPath, "等待材料中标信息导出适配", `材料中标信息采集失败：${String(error?.message || error)}`, {
      sourceDir,
      capturePath: screenshot,
      error: String(error?.stack || error),
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const jobPath = resolveJobPath(process.argv[2]);
  const job = readJson(jobPath, {});
  if (!job.id) throw new Error(`任务文件无效: ${jobPath}`);
  const browser = await connectBrowser(jobPath);
  if (!browser) return;
  try {
    await runFourSourceCapture(jobPath, job, browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  try {
    const jobPath = resolveJobPath(process.argv[2]);
    setStatus(jobPath, "等待集采导出适配", `集采自动采集异常：${String(error?.message || error)}`, { error: String(error?.stack || error) });
  } catch {}
  console.error(error);
  process.exitCode = 1;
});
