import fs from "node:fs";
import path from "node:path";

const jobPath = process.argv[2];
if (!jobPath) throw new Error("缺少红蓝预警抓数任务文件路径。");

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

function updateJob(patch) {
  const job = readJson(jobPath, {});
  writeJson(jobPath, { ...job, ...patch, updatedAt: nowText() });
}

const job = readJson(jobPath, {});
const cdpUrl = job.cdpListUrl || process.env.PM_WARNING_CDP_LIST_URL || "http://localhost:9222/json/list";
const baseUrl = "http://218.56.43.116:2020/yjpm2012/";
const outPath = job.resultPath || path.join(path.dirname(jobPath), "latest_old_pm.json");
const summaryPath = job.summaryPath || path.join(path.dirname(outPath), "red_blue_company_summary.csv");
const detailPath = job.detailPath || path.join(path.dirname(outPath), "red_blue_projects.csv");
const reportPeriod = process.env.PM_WARNING_PERIOD || job.period || "";

let nextId = 1;

async function connectPage() {
  let response;
  try {
    response = await fetch(cdpUrl);
  } catch (error) {
    throw new Error(
      `未连接到四版 PM 浏览器调试端口 9222（${cdpUrl}）。请先用带 --remote-debugging-port=9222 的已登录 Edge/Chrome 打开四版 PM 页面，再点击“四版平台”。`
    );
  }
  if (!response.ok) {
    throw new Error(`四版 PM 浏览器调试端口返回异常：HTTP ${response.status}。请确认已登录的浏览器是用 9222 调试端口打开的。`);
  }
  let pages;
  try {
    pages = await response.json();
  } catch {
    throw new Error("四版 PM 浏览器调试端口返回内容无法解析，请重启带 9222 调试端口的已登录浏览器后重试。");
  }
  const page = pages.find((item) =>
    item.type === "page" &&
    (
      item.url.includes("/yjpm2012/MainNew.aspx")
      || item.url.includes("/yjpm2012/DefaultMainNew.aspx")
      || item.title.includes("烟建综合项目管理系统")
      || item.title.includes("烟建PM平台")
    )
  );
  if (!page) {
    const openPages = pages
      .filter((item) => item.type === "page")
      .slice(0, 5)
      .map((item) => `${item.title || "无标题"} ${item.url || ""}`.trim())
      .join("；");
    throw new Error(
      `已连接到浏览器调试端口，但没有找到已登录的四版 PM 主页面。请在该浏览器中打开并登录四版 PM 后重试。当前页面：${openPages || "无"}`
    );
  }

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

  return {
    async eval(expression) {
      const result = await Promise.race([
        send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("四版 PM 页面抓数超过 5 分钟未返回，请刷新 PM 页面后重试。")), 300000)),
      ]);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.value;
    },
    async getCookieHeader() {
      const result = await send("Network.getCookies", {
        urls: [baseUrl + "MainNew.aspx", baseUrl + "DefaultMainNew.aspx"],
      });
      return (result.cookies || []).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    },
    close() {
      ws.close();
    },
  };
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(path, rows, headers) {
  const csv = "\ufeff" + [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(path, csv, "utf-8");
}

function cleanHtmlText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function parseHtmlRows(html) {
  return [...String(html || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => ({
    html: match[0],
    text: cleanHtmlText(match[0]),
  }));
}

function parseHtmlTableRows(html) {
  return [...String(html || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((rowMatch) => (
    [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cellMatch) => cleanHtmlText(cellMatch[1]))
  )).filter((cells) => cells.length);
}

function parseAmountText(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toWanAmount(yuan) {
  return yuan && yuan > 0 ? Math.round((yuan / 10000) * 100) / 100 : null;
}

function roundAmount(value) {
  return Math.round(value * 100) / 100;
}

function isPositiveAmount(value) {
  const number = numberOrNull(value);
  return number != null && number > 0;
}

function normalizeFieldName(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[()（）]/g, "").trim().toLowerCase();
}

function getRowValueByAliases(row, aliases) {
  if (!row || typeof row !== "object") return null;
  const direct = aliases.find((name) => row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "");
  if (direct) return row[direct];
  const normalizedAliases = new Set(aliases.map(normalizeFieldName));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeFieldName(key)) && value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function amountFromWanOrYuan(value) {
  const amount = parseAmountText(value);
  if (amount == null || amount <= 0) return null;
  return amount > 100000 ? toWanAmount(amount) : roundAmount(amount);
}

function firstPositiveAmount(values) {
  for (const value of values || []) {
    const amount = parseAmountText(value);
    if (amount != null && amount > 0) return amount;
  }
  return null;
}

function getListContractAmount(row) {
  return amountFromWanOrYuan(getRowValueByAliases(row, [
    "合同造价",
    "合同造价(万元)",
    "合同造价（万元）",
    "合同额",
    "合同额(万元)",
    "合同额（万元）",
    "htzj",
    "HTZJ",
    "htje",
    "HTJE",
    "contract",
    "contractAmount",
    "contract_amount",
  ]));
}

function isBlankValue(value) {
  return value == null || String(value).trim() === "";
}

function numberOrNull(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function isZero(value) {
  const number = numberOrNull(value);
  return number != null && Math.abs(number) <= 0.000001;
}

function amountsMatch(left, right) {
  const a = numberOrNull(left);
  const b = numberOrNull(right);
  return a != null && b != null && Math.abs(a - b) <= 0.01;
}

function applyProjectBusinessRules(project) {
  const targetPending = isBlankValue(project.reduceDuty);
  const target = numberOrNull(project.reduceDuty);
  const budget = numberOrNull(project.budget);
  const actual = numberOrNull(project.actual);
  const actualRate = numberOrNull(project.reduceActual ?? project.profitRate);
  const budgetEqualsActual = amountsMatch(project.budget, project.actual);
  const profitRateZero = (actualRate != null && Math.abs(actualRate) <= 0.000001) || budgetEqualsActual;

  project.responsibilityTargetDisplay = targetPending ? "待签" : project.reduceDuty;
  if (targetPending) {
    project.targetSignStatus = "待签";
  }

  if (target != null && Math.abs(target) <= 0.000001 && budgetEqualsActual && profitRateZero) {
    project.displayStatus = "完成责任目标";
    project.warningDecision = "no-warning-completed-target";
    project.warningRule = "目标责任率为0，预算=实际成本，平进平出，完成责任目标，不需预警。";
  } else if (budget == null && actual != null && profitRateZero) {
    project.warningDecision = "warning-no-budget-profit-zero";
    project.warningRule = "只有实际成本、没有月预算，项目利润率为0，纳入预警。";
  } else if (target != null && Math.abs(target) > 0.000001 && budgetEqualsActual && profitRateZero) {
    project.warningDecision = "warning-target-not-met-profit-zero";
    project.warningRule = "预算=实际成本，责任目标不为0，利润率为0，未完成目标。";
  } else if (targetPending) {
    project.warningDecision = "warning-target-pending-sign";
    project.warningRule = project.warningRule || "未签责任目标，目标降低率显示待签。";
  }

  return project;
}

function applyPmWarningBusinessRules(data) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const health = {
    total: projects.length,
    targetPending: 0,
    noWarningCompletedTarget: 0,
    noBudgetProfitZero: 0,
    targetNotMetProfitZero: 0,
  };
  for (const project of projects) {
    applyProjectBusinessRules(project);
    if (project.targetSignStatus === "待签") health.targetPending += 1;
    if (project.warningDecision === "no-warning-completed-target") health.noWarningCompletedTarget += 1;
    if (project.warningDecision === "warning-no-budget-profit-zero") health.noBudgetProfitZero += 1;
    if (project.warningDecision === "warning-target-not-met-profit-zero") health.targetNotMetProfitZero += 1;
  }
  data.businessHealth = health;
  if (data.detailHealth) {
    data.detailHealth.targetPending = health.targetPending;
    data.detailHealth.noWarningCompletedTarget = health.noWarningCompletedTarget;
    data.detailHealth.noBudgetProfitZero = health.noBudgetProfitZero;
    data.detailHealth.targetNotMetProfitZero = health.targetNotMetProfitZero;
  }
  return data;
}

function sameMajorName(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function fetchPmHtml(url, cookieHeader, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(url, baseUrl), {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const buffer = await response.arrayBuffer();
    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponsibilityEntries(html, scope) {
  const entries = [];
  for (const row of parseHtmlRows(html)) {
    const match = row.html.match(/querylnkA\('autoid=([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*([0-9]+)\)/);
    if (!match) continue;
    const parts = row.text.split(/\s+/).filter(Boolean);
    entries.push({
      scope,
      autoid: match[3],
      table: match[2],
      type: parts[1] || "",
      major: parts[2] || "",
      manager: parts[3] || "",
    });
  }
  return entries;
}

async function findResponsibilityEntriesNode(project, cookieHeader, scope) {
  if (!project?.pid) return [];
  const condition = scope === "object" && project.hsdxid
    ? `(xmid=[QUOTES]${project.pid}[QUOTES]) and hsdxid=[QUOTES]${project.hsdxid}[QUOTES]`
    : `(xmid=[QUOTES]${project.pid}[QUOTES])`;
  const url = "Systemasp/AppSys/ExecApp/Query/appquerylist_pre.aspx?SqlID=9e5ad5d6-1ab4-4f68-95bd-d98b1d22597c&SqlQueryCondition="
    + encodeURIComponent(condition);
  const html = await fetchPmHtml(url, cookieHeader);
  return parseResponsibilityEntries(html, scope);
}

function parseResponsibilityTarget(html) {
  const text = cleanHtmlText(html);
  const methodKey = "\u5229\u6da6\u76ee\u6807\u964d\u4f4e\u65b9\u5f0f";
  const targetKey = "\u964d\u4f4e\u989d\u5ea6";
  const methodIndex = text.indexOf(methodKey);
  if (methodIndex < 0) return null;
  const rest = text.slice(methodIndex + methodKey.length).trim();
  const targetIndex = rest.indexOf(targetKey);
  if (targetIndex < 0) return null;
  const method = rest.slice(0, targetIndex).trim().split(/\s+/)[0] || "";
  const targetText = rest.slice(targetIndex + targetKey.length);
  const numbers = targetText.match(/-?\d+(?:\.\d+)?/g) || [];
  if (!numbers.length) return null;
  return {
    method,
    target: Number(numbers[0]),
  };
}

async function readResponsibilityTargetNode(entry, cookieHeader) {
  if (!entry?.autoid || !entry?.table) return null;
  const url = "Systemasp/AppSys/ExecApp/Query/AppDefaultDetail.aspx?hidsql=autoid="
    + encodeURIComponent(entry.autoid)
    + "&TblName=" + encodeURIComponent(entry.table)
    + "&maintbl=" + encodeURIComponent(entry.table)
    + "&mainid=" + encodeURIComponent(entry.autoid);
  const html = await fetchPmHtml(url, cookieHeader);
  const parsed = parseResponsibilityTarget(html);
  if (!parsed) return null;
  return {
    ...parsed,
    source: entry.scope,
    autoid: entry.autoid,
    table: entry.table,
  };
}

async function getContractAmountNode(project, cookieHeader) {
  if (!project?.pid || !project?.hsdxid) return null;
  const params = new URLSearchParams({
    treeno: "12345",
    FormState: "OnlyView",
    OnlyShowPassed: "",
    pid: project.pid,
    pname: "集团公司",
    hsdxmc: project.hsdx || "",
    hsdxid: project.hsdxid,
    OldZYType: "",
    gChildrenNum: "0",
  });
  const html = await fetchPmHtml("WorkAsp/CostManage/costplan/CostPlanMain_MainPlan.aspx?" + params, cookieHeader);
  for (const cells of parseHtmlTableRows(html)) {
    if (cells[0] === "合计" && cells.length >= 5) {
      return toWanAmount(parseAmountText(cells[4]));
    }
  }
  return null;
}

async function getCostAnalysisNode(project, cookieHeader) {
  if (!project?.href) return { contract: null, budget: null, actual: null };
  const html = await fetchPmHtml(project.href, cookieHeader, 20000);
  const rows = parseHtmlTableRows(html);
  let inBSection = false;
  let contractYuan = null;
  let budgetYuan = null;
  let actualYuan = 0;

  for (const texts of rows) {
    if (texts[0] === "A" && texts[1] === "价税合计" && contractYuan == null) {
      contractYuan = firstPositiveAmount(texts.slice(3));
      continue;
    }
    if (texts[0] === "B" && texts[1] === "税前造价" && texts[2] === "小计") {
      inBSection = true;
      const budgetIdx = texts.length >= 15 ? 8 : 7;
      budgetYuan = parseAmountText(texts[budgetIdx]);
      continue;
    }
    if (inBSection && texts[0] === "AT") break;
    if (!inBSection) continue;

    const isSubtotal = texts.includes("小计");
    if (isSubtotal) continue;

    let actualIdx = null;
    if (texts.length >= 15) actualIdx = 11;
    else if (texts.length >= 14) actualIdx = 10;
    else if (texts.length >= 13) actualIdx = 9;
    if (actualIdx == null) continue;
    actualYuan += parseAmountText(texts[actualIdx]) || 0;
  }

  return {
    contract: toWanAmount(contractYuan),
    budget: toWanAmount(budgetYuan),
    actual: toWanAmount(actualYuan),
  };
}

function fillProjectDerivedAmounts(project) {
  if ((project.reduceActual === "" || project.reduceActual == null) && project.profitRate !== "" && project.profitRate != null) {
    project.reduceActual = project.profitRate;
  }
  const rateValue = project.reduceActual !== "" && project.reduceActual != null ? project.reduceActual : project.profitRate;
  const rate = Number(rateValue);
  const hasActualRate = rateValue !== "" && rateValue != null && Number.isFinite(rate);
  if (hasActualRate && (project.budget == null || project.actual == null || (Math.abs(Number(project.budget) || 0) <= 0.000001 && Math.abs(Number(project.actual) || 0) <= 0.000001))) {
    project.amountLogicIssue = "actual-rate-without-budget-actual";
  } else {
    delete project.amountLogicIssue;
  }
}

async function enrichProjectAmounts(data, cookieHeader) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const health = {
    total: projects.length,
    contract: 0,
    budget: 0,
    actual: 0,
    reduction: 0,
    complete: 0,
    missing: 0,
    contractErrors: 0,
    costErrors: 0,
  };

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    project.sequence = index + 1;
    if (isPositiveAmount(project.contract)) {
      project.contract = roundAmount(numberOrNull(project.contract));
      project.contractSource = project.contractSource || "list-contract-amount";
    } else {
      project.contract = await getContractAmountNode(project, cookieHeader).catch((error) => {
        project.contractError = error.message;
        return null;
      });
      if (isPositiveAmount(project.contract)) {
        project.contractSource = "total-cost-plan-bid-cost";
      }
    }
    const cost = await getCostAnalysisNode(project, cookieHeader).catch((error) => {
      project.costError = error.message;
      return { contract: null, budget: null, actual: null };
    });
    if (!isPositiveAmount(project.contract) && isPositiveAmount(cost.contract)) {
      project.contract = cost.contract;
      project.contractSource = "cost-analysis-total-budget";
    }
    project.budget = cost.budget;
    project.actual = cost.actual;
    fillProjectDerivedAmounts(project);

    const hasContract = project.contract !== null && project.contract !== undefined && project.contract !== "";
    const hasBudget = project.budget !== null && project.budget !== undefined && project.budget !== "";
    const hasActual = project.actual !== null && project.actual !== undefined && project.actual !== "";
    const hasReduction = project.reduction !== null && project.reduction !== undefined && project.reduction !== "";
    if (hasContract) health.contract += 1;
    if (hasBudget) health.budget += 1;
    if (hasActual) health.actual += 1;
    if (hasReduction) health.reduction += 1;
    if (hasContract && hasBudget && hasActual && hasReduction) health.complete += 1;
    else health.missing += 1;
    if (project.contractError) health.contractErrors += 1;
    if (project.costError) health.costErrors += 1;
  }
  return health;
}

async function enrichResponsibilityTargets(data, cookieHeader) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const health = { total: projects.length, existing: 0, filled: 0, missing: 0, errors: 0 };
  for (const project of projects) {
    if (project.reduceDuty !== "" && project.reduceDuty != null) {
      health.existing += 1;
      continue;
    }
    try {
      const objectEntries = await findResponsibilityEntriesNode(project, cookieHeader, "object");
      let target = await readResponsibilityTargetNode(objectEntries[0], cookieHeader);
      if (!target) {
        const projectEntries = await findResponsibilityEntriesNode(project, cookieHeader, "project");
        const matched = projectEntries.find((entry) => sameMajorName(entry.major, project.major))
          || projectEntries.find((entry) => sameMajorName(entry.major, project.hsdx))
          || (projectEntries.length === 1 ? projectEntries[0] : null);
        target = await readResponsibilityTargetNode(matched, cookieHeader);
      }
      if (target?.target != null && Number.isFinite(target.target)) {
        project.reduceDuty = target.target;
        project.reduceMethod = project.reduceMethod || target.method || "";
        project.responsibilitySource = target.source;
        project.responsibilityAutoid = target.autoid;
        project.responsibilityTable = target.table;
        health.filled += 1;
      } else {
        health.missing += 1;
      }
    } catch (error) {
      project.responsibilityError = error.message;
      health.errors += 1;
    }
  }
  return health;
}

const browserExpression = String.raw`
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const parseAmount = (value) => {
    const cleaned = String(value ?? "").replace(/,/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === "--") return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  };
  const toWan = (yuan) => yuan && yuan > 0 ? Math.round((yuan / 10000) * 100) / 100 : null;
  const roundAmount = (value) => Math.round(value * 100) / 100;
  const firstPositiveAmount = (values) => {
    for (const value of values || []) {
      const amount = parseAmount(value);
      if (amount != null && amount > 0) return amount;
    }
    return null;
  };
  const normalizeFieldName = (value) => String(value ?? "").replace(/\s+/g, "").replace(/[()（）]/g, "").trim().toLowerCase();
  const getRowValueByAliases = (row, aliases) => {
    if (!row || typeof row !== "object") return null;
    const direct = aliases.find((name) => row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "");
    if (direct) return row[direct];
    const normalizedAliases = new Set(aliases.map(normalizeFieldName));
    for (const [key, value] of Object.entries(row)) {
      if (normalizedAliases.has(normalizeFieldName(key)) && value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return null;
  };
  const amountFromWanOrYuan = (value) => {
    const amount = parseAmount(value);
    if (amount == null || amount <= 0) return null;
    return amount > 100000 ? toWan(amount) : roundAmount(amount);
  };
  const getListContractAmount = (row) => amountFromWanOrYuan(getRowValueByAliases(row, [
    "\u5408\u540c\u9020\u4ef7",
    "\u5408\u540c\u9020\u4ef7(\u4e07\u5143)",
    "\u5408\u540c\u9020\u4ef7\uff08\u4e07\u5143\uff09",
    "\u5408\u540c\u989d",
    "\u5408\u540c\u989d(\u4e07\u5143)",
    "\u5408\u540c\u989d\uff08\u4e07\u5143\uff09",
    "htzj",
    "HTZJ",
    "htje",
    "HTJE",
    "contract",
    "contractAmount",
    "contract_amount",
  ]));
  const absoluteUrl = (url) => new URL(url, location.origin + "/yjpm2012/").href;
  const loadFrameText = async (url) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1200px;height:900px;";
    document.body.appendChild(frame);
    try {
      frame.src = absoluteUrl(url);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("详情页 iframe 加载超时 " + url)), 20000);
        frame.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      await sleep(500);
      const doc = frame.contentDocument;
      if (!doc?.documentElement) throw new Error("详情页 iframe 无法读取 " + url);
      return doc.documentElement.outerHTML;
    } finally {
      frame.remove();
    }
  };

  const fetchText = async (url) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(absoluteUrl(url), { credentials: "include", signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error("detail page HTTP " + response.status + ": " + absoluteUrl(url));
      return response.text();
    } catch {
      const html = await loadFrameText(url);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const title = cleanText(doc.title || "");
      const text = cleanText(doc.body?.innerText || doc.documentElement?.textContent || "");
      if (title.includes("运行时错误") || title.includes("无法找到资源") || text.includes("运行时错误") || text.includes("无法找到资源")) {
        throw new Error("detail page failed: " + title + " " + absoluteUrl(url));
      }
      return html;
    }
  };
  const parseDoc = (html) => new DOMParser().parseFromString(html, "text/html");

  const fetchQuickText = async (url, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(absoluteUrl(url), {
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) return "";
      return response.text();
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  };

  const openChartByMenu = async () => {
    if (window.Ext && window.TabPanel2 && window.showInfo) {
      window.showInfo(
        window.TabPanel2,
        "Systemasp/AppSys/ExecApp/OutPage/OutListbusinessAreaSelect.aspx?treeno=0105026",
        "2",
        "成本综合情况(总)",
        "0105026"
      );
      await sleep(2500);
      const iframe = document.getElementById("0105026_IFrame");
      if (iframe?.contentDocument) return iframe;
    }

    const frame = document.createElement("iframe");
    frame.id = "codex_pm_warning_chart_frame";
    frame.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1400px;height:900px;";
    document.body.appendChild(frame);
    frame.src = absoluteUrl("WorkAsp/zhcx/cbzhxx.aspx?treeno=0105026");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("成本综合情况(总) 页面加载超时")), 30000);
      frame.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    await sleep(1500);
    if (!frame.contentDocument?.documentElement) throw new Error("成本综合情况(总) 页面无法读取");
    return frame;
  };

  const iframe = await openChartByMenu();
  const chartWindow = iframe.contentWindow;
  const chartDoc = iframe.contentDocument;
  const projectStatus = chartWindow.Ext?.getCmp("combo_xmzt")?.getRawValue?.()
    || chartWindow.Ext?.getCmp("combo_xmzt")?.getValue?.()
    || "";
  const statusRaw = chartWindow.Ext?.getCmp("combo_xmzt")?.lastSelection?.[0]?.raw || null;
  const html = chartDoc.documentElement.outerHTML;
  const match = html.match(/fields:\s*\[([^\]]+)\][\s\S]*?data:\s*(\[[\s\S]*?\])\s*\}\)/);
  if (!match) throw new Error("未在柱状图页面找到 Store_Funds 数据");

  const fields = Function("return [" + match[1] + "]")();
  const rows = Function("return " + match[2])();
  const companies = rows.map((row) => {
    const item = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
    const normal = Number(item["完成责任目标"]) || 0;
    const blue = Number(item["不亏损但未完成责任目标"]) || 0;
    const red = Number(item["亏损"]) || 0;
    return {
      company: item.C_BizRangeName,
      fgsid: item.C_BizRangeID,
      normal,
      blue,
      red,
      total: normal + blue + red,
    };
  });

  const extractList = async (company, type, t, expectedCount) => {
    if (!expectedCount) return [];
    const url = "WorkAsp/zhcx/cbzhxx_zrsList.aspx?fgsid="
      + encodeURIComponent(company.fgsid)
      + "&t=" + encodeURIComponent(t)
      + "&xmzt=2";
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1200px;height:800px;";
    document.body.appendChild(frame);
    try {
      frame.src = absoluteUrl(url);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("列表页加载超时: " + url)), 20000);
        frame.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      const win = frame.contentWindow;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const store = win.Store1 || win.Ext?.getCmp?.("Store1");
        if (store && typeof store.getRange === "function") {
          const total = Number(store.getTotalCount?.() ?? store.getCount?.() ?? 0);
          const count = Number(store.getCount?.() ?? 0);
          if (count >= Math.min(total || expectedCount, expectedCount)) {
            const rows = store.getRange().map((record) => record.data || {});
            return rows.map((row) => {
              const listContract = getListContractAmount(row);
              const href = new URL(
                "../CostManage/costplan/CostAnalysisOnWBS1.aspx?treeno=12345"
                  + "&FormState=OnlyView&OnlyShowPassed=&pid=" + encodeURIComponent(row.xmid || "")
                  + "&pname=&hsdxmc=&hsdxid=" + encodeURIComponent(row.hsdxid || "")
                  + "&gChildrenNum=0&OldZYType=&vmonth=&isAllMonth=1&linkFrom=ldcx",
                win.location.href
              ).href;
              return {
                company: company.company,
                fgsid: company.fgsid,
                type,
                t,
                status: type === "red" ? "红色" : "蓝色",
                name: row.xmmc || "",
                hsdx: row.hsdx || "",
                major: row.zylx || "",
                manager: row.xmjl || "",
                reduceMethod: row.jdfs ?? "",
                reduceDuty: row.jded ?? "",
                reduceActual: row.gsblv ?? "",
                profitRate: row.xmlrl ?? "",
                contract: listContract,
                contractSource: listContract ? "list-contract-amount" : "",
                href,
                pid: row.xmid || "",
                hsdxid: row.hsdxid || "",
              };
            });
          }
        }
        await sleep(300);
      }
      throw new Error("列表页 Store1 未完成加载: " + url);
    } finally {
      frame.remove();
    }
  };

  const getContractAmount = async (project) => {
    if (!project.pid || !project.hsdxid) return null;
    const params = new URLSearchParams({
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
    const doc = parseDoc(await fetchText("WorkAsp/CostManage/costplan/CostPlanMain_MainPlan.aspx?" + params));
    for (const tr of doc.querySelectorAll("table tr")) {
      const cells = Array.from(tr.querySelectorAll("td,th")).map((td) => cleanText(td.innerText || td.textContent));
      if (cells[0] === "合计" && cells.length >= 5) {
        const amount = parseAmount(cells[4]);
        return toWan(amount);
      }
    }
    return null;
  };

  const findResponsibilityEntries = async (project, scope) => {
    if (!project.pid) return [];
    const condition = scope === "object" && project.hsdxid
      ? "(xmid=[QUOTES]" + project.pid + "[QUOTES]) and hsdxid=[QUOTES]" + project.hsdxid + "[QUOTES]"
      : "(xmid=[QUOTES]" + project.pid + "[QUOTES])";
    const url = "Systemasp/AppSys/ExecApp/Query/appquerylist_pre.aspx?SqlID=9e5ad5d6-1ab4-4f68-95bd-d98b1d22597c&SqlQueryCondition="
      + encodeURIComponent(condition);
    const html = await fetchQuickText(url);
    if (!html) return [];
    const doc = parseDoc(html);
    const entries = [];
    for (const row of doc.querySelectorAll("tr")) {
      const cells = Array.from(row.querySelectorAll("td,th")).map((cell) => cleanText(cell.innerText || cell.textContent));
      const rowHtml = row.innerHTML || "";
      const match = rowHtml.match(/querylnkA\('autoid=([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*([0-9]+)\)/);
      if (!match) continue;
      entries.push({
        scope,
        autoid: match[3],
        table: match[2],
        type: cells[1] || "",
        major: cells[2] || "",
        manager: cells[3] || "",
      });
    }
    return entries;
  };

  const readResponsibilityTarget = async (entry) => {
    if (!entry?.autoid || !entry?.table) return null;
    const url = "Systemasp/AppSys/ExecApp/Query/AppDefaultDetail.aspx?hidsql=autoid="
      + encodeURIComponent(entry.autoid)
      + "&TblName=" + encodeURIComponent(entry.table)
      + "&maintbl=" + encodeURIComponent(entry.table)
      + "&mainid=" + encodeURIComponent(entry.autoid);
    const html = await fetchQuickText(url);
    if (!html) return null;
    const doc = parseDoc(html);
    const rows = Array.from(doc.querySelectorAll("tr"))
      .map((row) => Array.from(row.querySelectorAll("td,th")).map((cell) => cleanText(cell.innerText || cell.textContent)));
    for (const row of rows) {
      const methodIndex = row.findIndex((value) => value.includes("利润目标降低方式"));
      const targetIndex = row.findIndex((value) => value.includes("降低额度"));
      if (targetIndex < 0) continue;
      const target = parseAmount(row[targetIndex + 1]);
      if (target == null) continue;
      return {
        method: methodIndex >= 0 ? row[methodIndex + 1] || "" : "",
        target,
        source: entry.scope,
        autoid: entry.autoid,
        table: entry.table,
      };
    }
    return null;
  };

  const sameMajor = (left, right) => {
    const a = cleanText(left);
    const b = cleanText(right);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  };

  const getResponsibilityTarget = async (project) => {
    if (!project.pid) return null;
    const objectEntries = await findResponsibilityEntries(project, "object");
    const objectTarget = await readResponsibilityTarget(objectEntries[0]);
    if (objectTarget) return objectTarget;

    const projectEntries = await findResponsibilityEntries(project, "project");
    const matched = projectEntries.find((entry) => sameMajor(entry.major, project.major))
      || projectEntries.find((entry) => sameMajor(entry.major, project.hsdx))
      || (projectEntries.length === 1 ? projectEntries[0] : null);
    return readResponsibilityTarget(matched);
  };

  const getCostAnalysis = async (project) => {
    if (!project.href) return { contract: null, budget: null, actual: null };
    const doc = parseDoc(await fetchText(project.href));
    const rows = Array.from(doc.querySelectorAll("table tr"));
    let inBSection = false;
    let contractYuan = null;
    let budgetYuan = null;
    let actualYuan = 0;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      const texts = cells.map((cell) => cleanText(cell.innerText || cell.textContent));
      if (texts[0] === "A" && texts[1] === "价税合计" && contractYuan == null) {
        contractYuan = firstPositiveAmount(texts.slice(3));
        continue;
      }
      if (texts[0] === "B" && texts[1] === "税前造价" && texts[2] === "小计") {
        inBSection = true;
        const budgetIdx = cells.length >= 15 ? 8 : 7;
        budgetYuan = parseAmount(texts[budgetIdx]);
        continue;
      }
      if (inBSection && texts[0] === "AT") break;
      if (!inBSection) continue;

      const isSubtotal = texts.includes("小计");
      if (isSubtotal) continue;

      let actualIdx = null;
      if (cells.length >= 15) actualIdx = 11;
      else if (cells.length >= 14) actualIdx = 10;
      else if (cells.length >= 13) actualIdx = 9;
      if (actualIdx == null) continue;
      actualYuan += parseAmount(texts[actualIdx]) || 0;
    }

    return {
      contract: toWan(contractYuan),
      budget: toWan(budgetYuan),
      actual: toWan(actualYuan),
    };
  };

  const projects = [];
  const listChecks = [];
  for (const company of companies) {
    const blueRows = await extractList(company, "blue", "wwc", company.blue);
    const redRows = await extractList(company, "red", "ks", company.red);
    listChecks.push({
      company: company.company,
      blueExpected: company.blue,
      blueActual: blueRows.length,
      redExpected: company.red,
      redActual: redRows.length,
    });
    projects.push(...blueRows, ...redRows);
  }

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    if ((project.reduceActual === "" || project.reduceActual == null) && project.profitRate !== "" && project.profitRate != null) {
      project.reduceActual = project.profitRate;
    }
    project.sequence = index + 1;
  }

  const detailHealth = {
    total: projects.length,
    complete: 0,
    missing: projects.length,
    contract: 0,
    budget: 0,
    actual: 0,
    reduction: 0,
    contractErrors: 0,
    costErrors: 0,
  };

  return {
    source: {
      menuPath: "领导查询 > 成本综合情况(总)",
      page: chartWindow.location.href,
      projectStatus,
      statusRaw,
      collectedAt: new Date().toISOString(),
    },
    companies,
    listChecks,
    projects,
    detailHealth,
    totals: {
      companies: companies.length,
      inProgress: companies.reduce((sum, row) => sum + row.total, 0),
      normal: companies.reduce((sum, row) => sum + row.normal, 0),
      blue: companies.reduce((sum, row) => sum + row.blue, 0),
      red: companies.reduce((sum, row) => sum + row.red, 0),
      detailProjects: projects.length,
      amountComplete: detailHealth.complete,
      amountMissing: detailHealth.missing,
    },
  };
})()
`;

function buildAmountBrowserExpression(projects) {
  const payload = JSON.stringify(projects || []).replace(/</g, "\\u003c");
  return `
(async () => {
  const projects = ${payload};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const parseAmount = (value) => {
    const cleaned = String(value ?? "").replace(/,/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === "--") return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  };
  const toWan = (yuan) => yuan && yuan > 0 ? Math.round((yuan / 10000) * 100) / 100 : null;
  const roundAmount = (value) => Math.round(value * 100) / 100;
  const isPositiveAmount = (value) => {
    const amount = parseAmount(value);
    return amount != null && amount > 0;
  };
  const firstPositiveAmount = (values) => {
    for (const value of values || []) {
      const amount = parseAmount(value);
      if (amount != null && amount > 0) return amount;
    }
    return null;
  };
  const absoluteUrl = (url) => new URL(url, location.origin + "/yjpm2012/").href;

  const withFrame = async (url, reader, waitText = "") => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-20000px;top:-20000px;width:1400px;height:900px;";
    document.body.appendChild(frame);
    try {
      frame.src = absoluteUrl(url);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("金额详情页加载超时 " + url)), 30000);
        frame.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const doc = frame.contentDocument;
        const text = cleanText(doc?.body?.innerText || doc?.documentElement?.textContent || "");
        if (!waitText || text.includes(waitText)) break;
        await sleep(400);
      }
      await sleep(500);
      const doc = frame.contentDocument;
      if (!doc?.documentElement) throw new Error("金额详情页无法读取 " + url);
      return reader(doc);
    } finally {
      frame.remove();
    }
  };

  const getContractAmount = async (project) => {
    if (!project.pid || !project.hsdxid) return null;
    const params = new URLSearchParams({
      treeno: "12345",
      FormState: "OnlyView",
      OnlyShowPassed: "",
      pid: project.pid,
      pname: "集团公司",
      hsdxmc: project.hsdx || "",
      hsdxid: project.hsdxid,
      OldZYType: "",
      gChildrenNum: "0",
    });
    return withFrame("WorkAsp/CostManage/costplan/CostPlanMain_MainPlan.aspx?" + params, (doc) => {
      for (const tr of doc.querySelectorAll("table tr")) {
        const cells = Array.from(tr.querySelectorAll("td,th")).map((td) => cleanText(td.innerText || td.textContent));
        if (cells[0] === "合计" && cells.length >= 5) return toWan(parseAmount(cells[4]));
      }
      return null;
    }, "合计");
  };

  const getCostAnalysis = async (project) => {
    if (!project.href) return { contract: null, budget: null, actual: null };
    return withFrame(project.href, (doc) => {
      const rows = Array.from(doc.querySelectorAll("table tr"));
      let inBSection = false;
      let contractYuan = null;
      let budgetYuan = null;
      let actualYuan = 0;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        const texts = cells.map((cell) => cleanText(cell.innerText || cell.textContent));
        if (texts[0] === "A" && texts[1] === "价税合计" && contractYuan == null) {
          contractYuan = firstPositiveAmount(texts.slice(3));
          continue;
        }
        if (texts[0] === "B" && texts[1] === "税前造价" && texts[2] === "小计") {
          inBSection = true;
          const budgetIdx = cells.length >= 15 ? 8 : 7;
          budgetYuan = parseAmount(texts[budgetIdx]);
          continue;
        }
        if (inBSection && texts[0] === "AT") break;
        if (!inBSection) continue;

        const isSubtotal = texts.includes("小计");
        if (isSubtotal) continue;

        let actualIdx = null;
        if (cells.length >= 15) actualIdx = 11;
        else if (cells.length >= 14) actualIdx = 10;
        else if (cells.length >= 13) actualIdx = 9;
        if (actualIdx == null) continue;
        actualYuan += parseAmount(texts[actualIdx]) || 0;
      }

      return {
        contract: toWan(contractYuan),
        budget: toWan(budgetYuan),
        actual: toWan(actualYuan),
      };
    }, "税前造价");
  };

  const fillProjectDerivedAmounts = (project) => {
    if ((project.reduceActual === "" || project.reduceActual == null) && project.profitRate !== "" && project.profitRate != null) {
      project.reduceActual = project.profitRate;
    }
    const rateValue = project.reduceActual !== "" && project.reduceActual != null ? project.reduceActual : project.profitRate;
    const rate = Number(String(rateValue ?? "").replace(/,/g, "").replace(/%/g, "").trim());
    const hasActualRate = rateValue !== "" && rateValue != null && Number.isFinite(rate);
    if (hasActualRate && (project.budget == null || project.actual == null || (Math.abs(Number(project.budget) || 0) <= 0.000001 && Math.abs(Number(project.actual) || 0) <= 0.000001))) {
      project.amountLogicIssue = "actual-rate-without-budget-actual";
    } else {
      delete project.amountLogicIssue;
    }
  };

  const detailHealth = {
    total: projects.length,
    contract: 0,
    budget: 0,
    actual: 0,
    reduction: 0,
    complete: 0,
    missing: 0,
    contractErrors: 0,
    costErrors: 0,
  };

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    project.sequence = index + 1;
    if (isPositiveAmount(project.contract)) {
      project.contract = roundAmount(parseAmount(project.contract));
      project.contractSource = project.contractSource || "list-contract-amount";
    } else {
      project.contract = await getContractAmount(project).catch((error) => {
        project.contractError = error.message;
        return null;
      });
      if (isPositiveAmount(project.contract)) {
        project.contractSource = "total-cost-plan-bid-cost";
      }
    }
    const cost = await getCostAnalysis(project).catch((error) => {
      project.costError = error.message;
      return { contract: null, budget: null, actual: null };
    });
    if (!isPositiveAmount(project.contract) && isPositiveAmount(cost.contract)) {
      project.contract = cost.contract;
      project.contractSource = "cost-analysis-total-budget";
    }
    project.budget = cost.budget;
    project.actual = cost.actual;
    fillProjectDerivedAmounts(project);

    const hasContract = project.contract !== null && project.contract !== undefined && project.contract !== "";
    const hasBudget = project.budget !== null && project.budget !== undefined && project.budget !== "";
    const hasActual = project.actual !== null && project.actual !== undefined && project.actual !== "";
    const hasReduction = project.reduction !== null && project.reduction !== undefined && project.reduction !== "";
    const actualRate = Number(String(project.reduceActual ?? project.profitRate ?? "").replace(/,/g, "").replace(/%/g, "").trim());
    const validNoBudgetProfitZero = !hasBudget && hasActual && Number.isFinite(actualRate) && Math.abs(actualRate) <= 0.000001;
    const hasFullAmount = hasContract && hasBudget && hasActual && hasReduction;
    if (hasContract) detailHealth.contract += 1;
    if (hasBudget) detailHealth.budget += 1;
    if (hasActual) detailHealth.actual += 1;
    if (hasReduction) detailHealth.reduction += 1;
    if (validNoBudgetProfitZero) detailHealth.noBudgetProfitZero = (detailHealth.noBudgetProfitZero || 0) + 1;
    if (hasFullAmount) detailHealth.complete += 1;
    else detailHealth.missing += 1;
    if (project.contractError) detailHealth.contractErrors += 1;
    if (project.costError) detailHealth.costErrors += 1;
  }

  return { projects, detailHealth };
})()
`;
}

let page = null;
try {
  updateJob({ status: "连接四版平台", message: `正在连接已登录四版 PM 页面：${cdpUrl}` });
  page = await connectPage();
  updateJob({ status: "抓取中", message: "已连接四版 PM，正在正向打开成本综合情况(总)并抓取红蓝预警。" });
  const data = await page.eval(browserExpression);
  data.reportPeriod = reportPeriod;
  data.source = { ...(data.source || {}), reportPeriod };
  for (const project of data.projects || []) {
    project.reportPeriod = reportPeriod;
  }
  const cookieHeader = await page.getCookieHeader();
  updateJob({ status: "补金额明细", message: "红蓝明细已抓取，正在补合同额、预算、实际、降低额。" });
  const amountData = await page.eval(buildAmountBrowserExpression(data.projects));
  data.projects = amountData.projects || data.projects;
  data.detailHealth = amountData.detailHealth || data.detailHealth;
  if (data.totals) {
    data.totals.amountComplete = data.detailHealth.complete;
    data.totals.amountMissing = data.detailHealth.missing;
  }
  updateJob({ status: "补责任书目标", message: "金额字段已处理，正在按责任书信息补全目标降低率。" });
  data.responsibilityHealth = await enrichResponsibilityTargets(data, cookieHeader);
  if (data.detailHealth) {
    data.detailHealth.responsibilityTarget = data.responsibilityHealth.existing + data.responsibilityHealth.filled;
    data.detailHealth.responsibilityFilled = data.responsibilityHealth.filled;
    data.detailHealth.responsibilityMissing = data.responsibilityHealth.missing;
  }
  applyPmWarningBusinessRules(data);
  data.reportPeriod = reportPeriod;
  data.source = { ...(data.source || {}), reportPeriod };
  for (const project of data.projects || []) {
    project.reportPeriod = project.reportPeriod || reportPeriod;
    project.monthlyStatuses = { ...(project.monthlyStatuses || {}), [project.reportPeriod]: project.displayStatus || project.status };
  }
  data.capture = {
    platform: "old-pm",
    platformName: "四版平台",
    jobId: job.id || "",
    capturedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  writeCsv(summaryPath, data.companies.map((row) => ({
    公司: row.company,
    fgsid: row.fgsid,
    完成责任目标: row.normal,
    蓝色预警: row.blue,
    红色预警: row.red,
    在建合计: row.total,
  })), ["公司", "fgsid", "完成责任目标", "蓝色预警", "红色预警", "在建合计"]);

  writeCsv(detailPath, data.projects.map((row) => ({
    序号: row.sequence,
    公司: row.company,
    风险等级: row.displayStatus || row.status,
    项目名称: row.name,
    核算对象: row.hsdx,
    专业: row.major,
    项目经理: row.manager,
    责任降低点: row.responsibilityTargetDisplay ?? row.reduceDuty,
    实际降低点: row.reduceActual,
    利润率: row.profitRate,
    合同额万元: row.contract,
    预算成本万元: row.budget,
    实际成本万元: row.actual,
    降低额万元: row.reduction,
    pid: row.pid,
    hsdxid: row.hsdxid,
  })), [
    "序号",
    "公司",
    "风险等级",
    "项目名称",
    "核算对象",
    "专业",
    "项目经理",
    "责任降低点",
    "实际降低点",
    "利润率",
    "合同额万元",
    "预算成本万元",
    "实际成本万元",
    "降低额万元",
    "pid",
    "hsdxid",
  ]);

  const mismatches = data.listChecks.filter((row) => row.blueExpected !== row.blueActual || row.redExpected !== row.redActual);
  const detailHealth = data.detailHealth || {};
  updateJob({
    status: "已完成",
    message: `四版平台抓数完成：在建 ${data.totals.inProgress} 项，红色 ${data.totals.red} 项，蓝色 ${data.totals.blue} 项。`,
    resultPath: outPath,
    summaryPath,
    detailPath,
    totals: data.totals,
    mismatches,
    detailHealth,
    completedAt: nowText(),
  });
  const detailSummary = [
    `合同 ${detailHealth.contract || 0}/${detailHealth.total || data.projects.length}`,
    `预算 ${detailHealth.budget || 0}/${detailHealth.total || data.projects.length}`,
    `实际 ${detailHealth.actual || 0}/${detailHealth.total || data.projects.length}`,
    `降低额 ${detailHealth.reduction || 0}/${detailHealth.total || data.projects.length}`,
  ].join("，");
  updateJob({
    message: `四版平台抓数完成：在建 ${data.totals.inProgress} 项，红色 ${data.totals.red} 项，蓝色 ${data.totals.blue} 项；${detailSummary}。`,
    totals: data.totals,
    detailHealth,
  });
  console.log(JSON.stringify({
    output: outPath,
    summaryCsv: summaryPath,
    detailCsv: detailPath,
    totals: data.totals,
    mismatches,
    detailHealth,
  }, null, 2));
} catch (error) {
  updateJob({
    status: "失败",
    message: error?.message || String(error),
    error: String(error?.stack || error),
    failedAt: nowText(),
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  page?.close();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
