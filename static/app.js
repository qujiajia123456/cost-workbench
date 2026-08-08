const PM_WARNING_CHART_DATA_URL = "/api/pm-warning-data";
const APP_VERSION = "v202608071015";

const PM_WARNING_REPORT_KEYS = [
  "reportCompany",
  "monthStatus",
  "reportContract",
  "reportBudget",
  "reportActual",
  "reportReduction",
  "reportDutyRate",
  "reportActualRate",
  "reportProject",
  "reportMajor",
  "reportManager",
  "reportCostCheck",
];

const PM_WARNING_SETTLEMENT_COMPANY_ORDER = [
  "三公司",
  "四公司",
  "五公司",
  "六公司",
  "七公司",
  "十公司",
  "青岛公司",
  "济南公司",
  "上海公司",
  "格瑞特公司",
  "市政路桥公司",
  "装饰幕墙公司",
  "设备安装公司",
  "国际公司",
  "马来公司",
];

const PM_WARNING_COMPANY_ORDER = new Map(
  PM_WARNING_SETTLEMENT_COMPANY_ORDER.map((company, index) => [company, index]),
);

const RISK_LEVEL_COMPANY_ORDER = [
  "三公司",
  "四公司",
  "五公司",
  "六公司",
  "七公司",
  "十公司",
  "市政路桥公司",
  "格瑞特公司",
  "青岛公司",
  "济南公司",
  "设备安装公司",
  "国际公司",
];

const RISK_LEVEL_COMPANY_ORDER_MAP = new Map(
  RISK_LEVEL_COMPANY_ORDER.map((company, index) => [company, index]),
);

function riskLevelCompanySortIndex(company) {
  const name = String(company || "").trim();
  const aliases = {
    市政路桥: "市政路桥公司",
    格瑞特: "格瑞特公司",
    青岛: "青岛公司",
    济南: "济南公司",
    设备安装: "设备安装公司",
    国际: "国际公司",
  };
  const normalized = aliases[name] || name;
  return RISK_LEVEL_COMPANY_ORDER_MAP.has(normalized) ? RISK_LEVEL_COMPANY_ORDER_MAP.get(normalized) : 999;
}

const PM_WARNING_COMPANY_NAME_MAP = {
  三: "三公司",
  四: "四公司",
  五: "五公司",
  六: "六公司",
  七: "七公司",
  十: "十公司",
  青岛: "青岛公司",
  济南: "济南公司",
  机电安装: "七公司",
  机电安装公司: "七公司",
  装饰幕墙: "装饰幕墙公司",
  格瑞特: "格瑞特公司",
  市政路桥: "市政路桥公司",
  园林: "园林公司",
  上海分: "上海公司",
  特种: "特种公司",
  烟建国际: "国际公司",
  设备安装: "设备安装公司",
};

function pmWarningCompanyName(name) {
  return PM_WARNING_COMPANY_NAME_MAP[name] || name || "未识别单位";
}

const state = {
  reportTypes: [],
  uploads: [],
  summary: null,
  issues: [],
  missing: { expected: [], uploaded: [], missing: [] },
  materialTasks: [],
  workbenchProgress: null,
  materialCompanies: [],
  materialTrend: { labels: [], series: [] },
  priceLibrary: { rows: [], summary: { spreadRows: [] } },
  editingPriceLibraryId: "",
  selectedPriceLibraryIds: new Set(),
  priceLibraryEditListOpen: false,
  priceLibraryAnalysisTargets: [],
  pmWarningCompanies: [],
  pmWarningSources: [],
  pmProjectSources: [],
  pmWarningSourceInfo: null,
  pmWarningDetailHealth: null,
  pmWarningCaptureCompleteness: null,
  pmWarningReasonConsistency: null,
  pmWarningTotals: { inProgress: 0, normal: 0, blue: 0, red: 0 },
  pmWarningReportPeriods: [],
  pmWarningPlatform: "all",
  pmWarningCapturePlatform: "old-pm",
  pmWarningCaptureJob: null,
  pmWarningCaptureTimer: null,
  pmWarningCaptureRunning: false,
  materialTaskPollingTimer: null,
  materialTaskPollingAnnounce: false,
  materialTaskPollingIds: new Set(),
  blacklistResult: { query: "", total: 0, highRisk: 0, related: 0, rows: [], mindmap: { nodes: [], links: [] } },
  blacklistJobs: [],
};

const PM_WARNING_PLATFORM_NAMES = {
  all: "两个平台汇总",
  "old-pm": "四版平台",
  "big-pm": "大PM平台",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function pmWarningPeriodWindow(period = currentPeriod()) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
  return [-2, -1, 0].map((offset) => {
    const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function pmWarningMonthStatusKey(period) {
  return `monthStatus_${String(period || "").replace("-", "_")}`;
}

function pmWarningReportPeriods() {
  const periods = state.pmWarningReportPeriods;
  if (Array.isArray(periods) && periods.length === 3) return periods;
  return pmWarningPeriodWindow($("#periodFilter")?.value || currentPeriod());
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function setAppStatus(text, tone = "ok") {
  const badge = $("#appStatusBadge");
  if (!badge) return;
  badge.textContent = text;
  badge.className = `app-status-badge ${tone}`;
}

function activateView(button) {
  if (!button) return;
  $$(".nav-item").forEach((item) => item.classList.remove("active"));
  $$(".view").forEach((view) => view.classList.remove("active"));
  button.classList.add("active");
  $(`#${button.dataset.view}`)?.classList.add("active");
  document.body.classList.toggle("home-mode", button.dataset.view === "workbench");
  document.body.classList.toggle("material-mode", button.dataset.view === "material-price");
  document.body.classList.toggle("price-library-mode", button.dataset.view === "price-library");
  document.body.classList.toggle("blacklist-mode", button.dataset.view === "blacklist-query");
  document.body.classList.toggle("pm-warning-mode", button.dataset.view === "pm-warning");
  $("#pageTitle").textContent = button.textContent;
  $("#pageSubtitle").textContent = button.dataset.view === "material-price"
    ? ""
    : button.dataset.subtitle || "选择报表类型，上传基层表，校验后生成当前期次汇总。";
  if (button.dataset.view === "pm-warning") renderPmWarnings();
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (_err) {}
    throw new Error(message);
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response.blob();
}

function optionHtml(items) {
  return items.map((item) => `<option value="${item.key}">${item.name}</option>`).join("");
}

function pmWarningCurrentPlatform() {
  return "all";
}

async function refreshPmWarningChartData(platform = pmWarningCurrentPlatform()) {
  const period = $("#periodFilter")?.value || $("#period")?.value || currentPeriod();
  const data = await api(`${PM_WARNING_CHART_DATA_URL}?platform=${encodeURIComponent(platform)}&period=${encodeURIComponent(period)}`);
  applyPmWarningChartData(data, platform);
  return data;
}

function pmWarningCheckTextKey(value) {
  return pmWarningCleanText(value)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function pmWarningReasonCheckKey(company, name, hsdx, period = "") {
  return [
    pmWarningCheckTextKey(pmWarningCompanyName(company)),
    pmWarningCheckTextKey(name),
    pmWarningCheckTextKey(hsdx),
    pmWarningCheckTextKey(period),
  ].join("|");
}

function pmWarningAccountingKey(value) {
  const text = pmWarningCleanText(value)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/工程|专业|施工/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (text.includes("土建")) return "土建";
  if (text.includes("安装")) return "安装";
  if (text.includes("装饰") || text.includes("幕墙")) return "装饰幕墙";
  return text;
}

function pmWarningStableProjectKey(item, sourcePlatform = "") {
  const company = pmWarningCompanyName(item.company || item.companyName || "");
  const projectName = item.name || item.project || item.projectName || item.pid || item.projectId || "";
  const hsdx = item.hsdx || item.hsdxName || item.major || item.hsdxId || item.hsdxid || "";
  return [
    pmWarningCheckTextKey(company),
    pmWarningCheckTextKey(projectName),
    pmWarningAccountingKey(hsdx),
  ].join("|");
}

function pmWarningBuildReasonCheckMap(summary) {
  const map = new Map();
  (summary?.checks || []).forEach((check) => {
    const company = check.company || "";
    const name = check.name || check.project || "";
    const hsdx = check.hsdx || check.major || "";
    const period = check.reportPeriod || check.costComparisonPeriod || "";
    [
      pmWarningReasonCheckKey(company, name, hsdx, period),
      pmWarningReasonCheckKey(company, name, hsdx, ""),
    ].forEach((key) => {
      if (key && !map.has(key)) map.set(key, check);
    });
  });
  return map;
}

function pmWarningSummaryCheckForItem(item, checkMap) {
  if (!checkMap?.size) return null;
  const company = item.company || "";
  const name = item.name || item.project || "";
  const period = item.reportPeriod || item.queryPeriod || "";
  const candidates = [
    item.hsdx || "",
    item.major || "",
  ].filter(Boolean);
  for (const hsdx of candidates) {
    const byPeriod = checkMap.get(pmWarningReasonCheckKey(company, name, hsdx, period));
    if (byPeriod) return byPeriod;
    const anyPeriod = checkMap.get(pmWarningReasonCheckKey(company, name, hsdx, ""));
    if (anyPeriod) return anyPeriod;
  }
  return null;
}

function pmWarningCostCheckFromSummary(check) {
  if (!check) return null;
  const issues = Array.isArray(check.issues) ? check.issues : [];
  const conflictCount = Number(check.conflictCount) || issues.filter((issue) => issue.severity === "conflict").length;
  const reviewCount = Number(check.reviewCount) || issues.filter((issue) => issue.severity === "review").length;
  return {
    verdict: check.verdict || (conflictCount ? "冲突" : reviewCount ? "待复核" : "无明显冲突"),
    conflictCount,
    reviewCount,
    issues,
    costComparisonPeriod: check.reportPeriod || check.costComparisonPeriod || "",
    sourceSummaryOnly: true,
  };
}

function applyPmWarningChartData(data, platform = pmWarningCurrentPlatform()) {
  const sourcePlatform = data.source?.platform || platform || "all";
  const reasonCheckMap = pmWarningBuildReasonCheckMap(data.reasonConsistency);
  state.pmWarningReportPeriods = Array.isArray(data.reportPeriods) && data.reportPeriods.length === 3
    ? data.reportPeriods
    : pmWarningPeriodWindow($("#periodFilter")?.value || $("#period")?.value || currentPeriod());
  const companyGroups = new Map();
  (data.companies || []).forEach((item, index) => {
    const company = pmWarningCompanyName(item.company);
    if (!companyGroups.has(company)) {
      companyGroups.set(company, {
        ...item,
        order: index,
        company,
        platformCompany: item.company,
      });
      return;
    }
    const merged = companyGroups.get(company);
    ["normal", "blue", "red", "total"].forEach((field) => {
      merged[field] = (Number(merged[field]) || 0) + (Number(item[field]) || 0);
    });
    merged.order = Math.min(merged.order, index);
    merged.platformCompany = [merged.platformCompany, item.company].filter(Boolean).join("、");
  });
  const companies = [...companyGroups.values()];
  state.pmWarningCompanies = companies;
  state.pmWarningTotals = data.totals || companies.reduce((totals, item) => ({
    inProgress: totals.inProgress + (Number(item.total) || 0),
    normal: totals.normal + (Number(item.normal) || 0),
    blue: totals.blue + (Number(item.blue) || 0),
    red: totals.red + (Number(item.red) || 0),
  }), { inProgress: 0, normal: 0, blue: 0, red: 0 });
  state.pmWarningSourceInfo = data.source || null;
  state.pmWarningDetailHealth = data.detailHealth || null;
  state.pmWarningCaptureCompleteness = data.captureCompleteness || null;
  state.pmWarningReasonConsistency = data.reasonConsistency || null;
  state.pmProjectSources = companies.flatMap((company) =>
    Array.from({ length: Number(company.total) || 0 }, (_item, index) => ({
      sourcePlatform: company.sourcePlatform || sourcePlatform,
      project: `${company.company}在建项目${index + 1}`,
      company: company.company,
      status: "在建",
    })),
  );
  state.pmWarningSources = (data.projects || []).map((item) => {
    const summaryCheck = pmWarningCostCheckFromSummary(pmWarningSummaryCheckForItem(item, reasonCheckMap));
    return {
      sourcePlatform: item.sourcePlatform || sourcePlatform,
      sourceNo: `${item.t || item.type || ""}-${item.sequence || ""}`,
      mergeKey: pmWarningStableProjectKey(item, item.sourcePlatform || sourcePlatform),
      level: item.status,
      monthlyStatuses: item.monthlyStatuses || (item.reportPeriod ? { [item.reportPeriod]: item.status } : {}),
      company: pmWarningCompanyName(item.company),
      project: item.name,
      major: item.major || item.hsdx || "",
      hsdx: item.hsdx || "",
      manager: item.manager || "",
      rule: item.t === "ks" || item.type === "red" ? "亏损" : "不亏损但未完成责任目标",
      contract: item.contract,
      budget: item.budget,
      actual: item.actual,
      reduction: item.reduction,
      reduceDuty: item.responsibilityTargetDisplay ?? (pmWarningHasValue(item.reduceDuty) ? item.reduceDuty : "待签"),
      reduceDutyRaw: item.reduceDuty,
      targetSignStatus: item.targetSignStatus || "",
      reduceActual: item.reduceActual,
      profitRate: item.profitRate,
      warningDecision: item.warningDecision || "",
      reportPeriod: item.reportPeriod || item.queryPeriod || "",
      reason: item.reason || "",
      rectification: item.rectification || "",
      costComparisonCheck: pmWarningPickCostCheck(item.costComparisonCheck || null, summaryCheck) || item.costComparisonCheck || summaryCheck || null,
      placeholder: Boolean(item.placeholder),
      remark: item.remark || "",
      status: "待处理",
    };
  });
}

async function loadInitial() {
  document.body.classList.add("home-mode");
  setAppStatus("连接中", "warn");
  state.reportTypes = await api("/api/report-types");
  setAppStatus(`服务已连接 ${APP_VERSION}`, "ok");
  try {
    state.materialCompanies = await api("/api/material-price-companies");
  } catch (_err) {
    state.materialCompanies = ["集团"];
  }
  state.pmWarningPlatform = "all";
  try {
    await refreshPmWarningChartData();
  } catch (_err) {}
  $("#reportFilter").innerHTML = optionHtml(state.reportTypes);
  updateExportButtonLabel();
  $("#period").value = currentPeriod();
  $("#periodFilter").value = currentPeriod();
  $("#pmWarningTopPlatformFilter").value = "all";
  renderPluginList();
  initMaterialTaskDefaults();
  renderMaterialCompanyOptions();
  renderPmWarnings();
  await refreshAll();
  await refreshMaterialTasks();
  try {
    await refreshMaterialTrend();
  } catch (_err) {}
  continueMaterialTaskPollingIfNeeded({ delay: 1000 });
  await refreshBlacklistJobs();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
  renderBlacklistResult();
  const targetView = new URLSearchParams(window.location.search).get("view");
  if (targetView) activateView(document.querySelector(`.nav-item[data-view="${targetView}"]`));
  startBlacklistJobPolling();
}

async function refreshAll() {
  state.uploads = await api("/api/uploads");
  await loadSummary();
  renderUploads();
  renderPmWarnings();
  try {
    await refreshPriceLibrary();
  } catch (_err) {
    state.priceLibrary = { rows: [], summary: { spreadRows: [] } };
    renderPriceLibrary();
  }
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function refreshWorkbenchProgress() {
  state.workbenchProgress = await api("/api/workbench-progress");
  renderWorkbenchProgress();
}

function renderWorkbenchProgress() {
  const data = state.workbenchProgress;
  const bars = $("#workbenchProgressBars");
  const trendPanel = $("#workbenchTrendPanel");
  if (!data || !bars || !trendPanel) return;
  bars.innerHTML = (data.modules || []).map((item) => {
    const value = Math.max(0, Math.min(100, Number(item.value) || 0));
    return `
      <button class="bar-row progress-link" type="button" data-jump-view="${escapeAttr(item.view || item.key || "")}" title="${escapeAttr(item.detail || "")}">
        <span>${escapeHtml(item.label || "")}</span>
        <div class="bar-track"><i style="--value: ${value}%"></i></div>
        <strong>${value}%</strong>
      </button>
      <p class="bar-detail">${escapeHtml(item.detail || "")}</p>
    `;
  }).join("");

  const width = 360;
  const height = 160;
  const axisLeft = 28;
  const axisBottom = 132;
  const points = data.trend || [];
  const maxIndex = Math.max(points.length - 1, 1);
  const coords = points.map((item, index) => {
    const x = 36 + (288 * index) / maxIndex;
    const y = axisBottom - (Math.max(0, Math.min(100, Number(item.value) || 0)) / 100) * 112;
    return { ...item, x, y };
  });
  const labelStep = Math.max(1, Math.ceil(coords.length / 6));
  const xLabels = coords
    .filter((_item, index) => index === 0 || index === coords.length - 1 || index % labelStep === 0)
    .map((item) => `<text x="${item.x - 10}" y="150">${escapeHtml(item.label || "")}</text>`)
    .join("");
  trendPanel.innerHTML = `
    <div class="line-title">
      <span>整体推进趋势</span>
      <strong>${Number(data.overall) || 0}%</strong>
    </div>
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="整体推进趋势">
      <line x1="${axisLeft}" y1="20" x2="${axisLeft}" y2="${axisBottom}"></line>
      <line x1="${axisLeft}" y1="${axisBottom}" x2="340" y2="${axisBottom}"></line>
      <polyline points="${coords.map((item) => `${item.x},${item.y}`).join(" ")}"></polyline>
      ${coords.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="4"><title>${escapeHtml(item.date || item.label || "")}：${Number(item.value) || 0}%</title></circle>`).join("")}
      ${xLabels}
    </svg>
    <p class="trend-note">更新时间：${escapeHtml(data.updatedAt || "")}</p>
  `;
}

async function refreshIssues() {
  const type = $("#reportFilter").value;
  const period = $("#periodFilter").value;
  state.issues = await api(`/api/issues?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`);
  state.missing = await api(`/api/missing-companies?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`);
  renderIssues();
}

async function loadSummary() {
  const type = $("#reportFilter").value;
  const period = $("#periodFilter").value;
  state.summary = await api(`/api/summary?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`);
  renderSummary();
}

function renderSummary() {
  const cards = state.summary?.cards || [];
  $("#summaryCards").innerHTML = cards.map((card) => `
    <article class="metric">
      <span>${escapeHtml(card.label)}</span>
      <strong>${formatNumber(card.value)}<small>${escapeHtml(card.unit || "")}</small></strong>
    </article>
  `).join("");

  const rows = (state.summary?.table || []).map((row) => ({ ...row, action: "delete" }));
  renderTable($("#summaryTable"), rows, {
    action: (_value, row) => `<button class="danger small" data-delete-company="${escapeAttr(row.company)}">删除</button>`,
  });
}

function renderUploads() {
  const rows = state.uploads.map((upload) => ({
    id: upload.id,
    uploadedAt: upload.uploadedAt,
    reportType: reportName(upload.reportType),
    period: upload.period,
    company: upload.company || detectedCompany(upload),
    filename: upload.filename,
    status: upload.status,
    rows: upload.rows?.length || 0,
    message: [...(upload.errors || []), ...(upload.warnings || [])].join("；"),
    action: "delete",
  }));
  renderTable($("#uploadsTable"), rows, {
    id: () => "",
    status: (value, row) => {
      const ok = !row.message || value === "校验通过";
      return `<span class="${ok ? "status" : "status bad"}">${escapeHtml(value)}</span>`;
    },
    action: (_value, row) => `<button class="danger small" data-delete-id="${escapeAttr(row.id)}">删除</button>`,
  });
}

function renderIssues() {
  const missing = state.missing?.missing || [];
  $("#missingList").innerHTML = missing.length
    ? missing.map((company) => `<button class="tag warn" data-missing-company="${escapeAttr(company)}">${escapeHtml(company)}</button>`).join("")
    : `<span class="muted-text">当前报表期次无缺报单位。</span>`;

  $("#companyOptions").innerHTML = (state.missing?.expected || [])
    .map((company) => `<option value="${escapeAttr(company)}"></option>`)
    .join("");

  const rows = state.issues.map((issue) => ({
    id: issue.id,
    createdAt: issue.createdAt,
    issueType: issue.issueType,
    company: issue.company,
    description: issue.description,
    status: issue.status,
    action: "delete",
  }));
  renderTable($("#issuesTable"), rows, {
    id: () => "",
    action: (_value, row) => `<button class="danger small" data-delete-issue="${escapeAttr(row.id)}">删除</button>`,
  });
}

function initMaterialTaskDefaults() {
  const form = $("#materialTaskForm");
  const importForm = $("#materialImportForm");
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  [form, importForm].forEach((item) => {
    if (!item) return;
    item.startDate.value = first.toISOString().slice(0, 10);
    item.endDate.value = now.toISOString().slice(0, 10);
  });
}

function renderMaterialCompanyOptions() {
  ["#materialCompany", "#materialImportCompany"].forEach((selector) => {
    const select = $(selector);
    if (!select) return;
    select.innerHTML = state.materialCompanies
      .map((company) => `<option value="${escapeAttr(company)}">${escapeHtml(company)}</option>`)
      .join("");
  });
}

function platformName(value) {
  return PM_WARNING_PLATFORM_NAMES[value] || value || "未识别平台";
}

function pmWarningCompanySort(left, right) {
  const leftIndex = PM_WARNING_COMPANY_ORDER.has(left) ? PM_WARNING_COMPANY_ORDER.get(left) : 999;
  const rightIndex = PM_WARNING_COMPANY_ORDER.has(right) ? PM_WARNING_COMPANY_ORDER.get(right) : 999;
  return leftIndex - rightIndex || left.localeCompare(right, "zh-CN");
}

function compareRiskLevel(left, right) {
  const order = { "红色": 2, "蓝色": 1 };
  return (order[left] || 0) - (order[right] || 0);
}

function compareWarningStatus(left, right) {
  const order = { "待处理": 3, "处理中": 2, "已闭环": 1 };
  return (order[left] || 0) - (order[right] || 0);
}

function pmWarningCleanText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function pmWarningMergeTextValue(left, right) {
  const values = [left, right]
    .flatMap((value) => pmWarningCleanText(value).split(/\n{2,}|；/))
    .map((value) => pmWarningCleanText(value))
    .filter(Boolean);
  const seen = new Set();
  return values.filter((value) => {
    const key = value.replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
}

function pmWarningCheckRank(check) {
  check = pmWarningNormalizeCostCheck(check);
  if (!check) return 0;
  if (Number(check.conflictCount) > 0 || String(check.verdict || "").includes("冲突")) return 3;
  if (Number(check.reviewCount) > 0 || String(check.verdict || "").includes("复核")) return 2;
  return 1;
}

function pmWarningPickCostCheck(left, right) {
  const normalizedLeft = pmWarningNormalizeCostCheck(left);
  const normalizedRight = pmWarningNormalizeCostCheck(right);
  return pmWarningCheckRank(normalizedRight) > pmWarningCheckRank(normalizedLeft) ? normalizedRight : normalizedLeft;
}

function pmWarningNormalizeCostCheck(check) {
  if (!check) return null;
  const issues = (check.issues || []).map((issue) => {
    if (issue?.type !== "rate-mismatch") return issue;
    const message = String(issue.message || "");
    return {
      ...issue,
      severity: "review",
      message: message.includes("自开工以来累计降低率")
        ? message
        : `${message}；审批表降低率为自开工以来累计降低率，此项按口径/字段维护差异待复核，不作为金额冲突`,
    };
  });
  const conflictCount = issues.filter((issue) => issue.severity === "conflict").length;
  const reviewCount = issues.filter((issue) => issue.severity === "review").length;
  return {
    ...check,
    issues,
    conflictCount,
    reviewCount,
    verdict: conflictCount ? "冲突" : reviewCount ? "待复核" : "无明显冲突",
  };
}

function pmWarningDetailItemsFromRow(row) {
  return [{
    period: row.reportPeriod || "",
    status: row.level || "",
    reason: row.reason || "",
    rectification: row.rectification || "",
    costComparisonCheck: pmWarningNormalizeCostCheck(row.costComparisonCheck),
  }];
}

function pmWarningDetailEntries(item) {
  const entries = (Array.isArray(item.detailItems) && item.detailItems.length
    ? item.detailItems
    : pmWarningDetailItemsFromRow(item)).map((entry) => ({
      ...entry,
      costComparisonCheck: pmWarningNormalizeCostCheck(entry.costComparisonCheck),
    }));
  const seen = new Set();
  return entries.filter((entry) => {
    const key = [
      entry.period || "",
      entry.status || "",
      pmWarningCleanText(entry.reason).replace(/\s+/g, ""),
      pmWarningCleanText(entry.rectification).replace(/\s+/g, ""),
      JSON.stringify(entry.costComparisonCheck || {}),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pmWarningEntryLabel(entry, index) {
  return [entry.period || `记录${index + 1}`, entry.status].filter(Boolean).join(" ");
}

function pmWarningBuildTextDetail(item, field, title) {
  const lines = [];
  pmWarningDetailEntries(item).forEach((entry, index) => {
    const text = pmWarningCleanText(entry[field]);
    if (text) lines.push(`【${pmWarningEntryLabel(entry, index)}】\n${text}`);
  });
  return lines.length ? `${title}\n\n${lines.join("\n\n")}` : "";
}

function pmWarningIssueText(issue) {
  if (!issue) return "";
  const label = pmWarningIssueLabel(issue.type);
  return `${label}${issue.field ? `（${issue.field}）` : ""}：${issue.message || ""}`;
}

function pmWarningAmountComparisonText(check) {
  const comparison = check?.amountComparison || {};
  return Object.entries(comparison).map(([name, value]) => {
    const approval = value?.approval ?? "";
    const cost = value?.cost ?? "";
    const diff = value?.diff ?? "";
    return `${name}：审批表 ${approval}，成本对比 ${cost}，差异 ${diff}`;
  }).join("\n");
}

function pmWarningMonthlyCostLogicText(check) {
  const logic = check?.monthlyCostLogic;
  if (!logic) return "";
  const lineForRow = (row) => `${row.name || "未命名科目"}：预算 ${row.budget ?? ""}，实际 ${row.actual ?? ""}，降低额 ${row.reduction ?? ""}，实际降低率 ${row.actualRate ?? ""}`;
  const lines = [
    `当月查询区间：${logic.rawValues?.start || ""} 至 ${logic.rawValues?.end || logic.period || ""}`.trim(),
    logic.rowCount != null ? `当月成本行数：${logic.rowCount}` : "",
    logic.reasonRowCount != null ? `当月原因行数：${logic.reasonRowCount}` : "",
    logic.lossRows?.length ? `当月主要亏损科目：\n${logic.lossRows.slice(0, 8).map(lineForRow).join("\n")}` : "当月未识别到明显亏损科目",
    logic.unexplainedLossRows?.length ? `原因未明显覆盖的亏损科目：\n${logic.unexplainedLossRows.map(lineForRow).join("\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function pmWarningBuildCostCheckDetail(item) {
  const blocks = [];
  pmWarningDetailEntries(item).forEach((entry, index) => {
    const check = entry.costComparisonCheck;
    const header = `【${pmWarningEntryLabel(entry, index)}】`;
    if (!check) {
      blocks.push(`${header}\n未执行成本对比分析校核。`);
      return;
    }
    const issues = (check.issues || []).map(pmWarningIssueText).filter(Boolean);
    const amountText = pmWarningAmountComparisonText(check);
    const monthlyLogicText = pmWarningMonthlyCostLogicText(check);
    const parts = [
      `${header}`,
      `校核结论：${check.verdict || "未明确"}`,
      check.sourceSummaryOnly ? "数据来源：大PM源头校验汇总" : "",
      `冲突：${formatNumber(Number(check.conflictCount) || 0)} 项，待复核：${formatNumber(Number(check.reviewCount) || 0)} 项`,
      check.costComparisonPeriod ? `累计校核月份：${check.costComparisonPeriod}` : "",
      check.costComparisonMonthlyPeriod ? `当月原因月份：${check.costComparisonMonthlyPeriod}` : "",
      check.costComparisonNoTaxName ? `不含税合计行：${check.costComparisonNoTaxName}` : "",
      check.costComparisonReasonRowCount != null ? `累计页原因行数：${check.costComparisonReasonRowCount}` : "",
      monthlyLogicText ? `当月成本逻辑：\n${monthlyLogicText}` : "",
      check.costComparisonReason ? `成本对比原因分析：\n${check.costComparisonReason}` : "",
      check.approvalReason ? `审批表原因分析：\n${check.approvalReason}` : "",
      check.approvalRectification ? `审批表整改措施：\n${check.approvalRectification}` : "",
      amountText ? `金额/降低率对比：\n${amountText}` : "",
      issues.length ? `校核问题：\n${issues.map((text, issueIndex) => `${issueIndex + 1}. ${text}`).join("\n")}` : "",
      check.costComparisonUrl ? `成本对比路径：${check.costComparisonUrl}` : "",
    ].filter(Boolean);
    blocks.push(parts.join("\n"));
  });
  return blocks.join("\n\n");
}

function pmWarningAnalysisStatusText(item) {
  const statuses = Object.entries(item.monthlyStatuses || {})
    .filter(([, status]) => status)
    .map(([period, status]) => `${period}：${status}`);
  if (statuses.length) return statuses.join("，");
  return item.level ? `当前：${item.level}` : "未识别预警状态";
}

function pmWarningAnalysisConclusion(item) {
  const entries = pmWarningDetailEntries(item);
  const checks = entries.map((entry) => entry.costComparisonCheck).filter(Boolean);
  const issues = checks.flatMap((check) => check.issues || []);
  const conflictIssues = issues.filter((issue) => issue.severity === "conflict");
  const reviewIssues = issues.filter((issue) => issue.severity === "review");
  const rateReviewIssues = reviewIssues.filter((issue) => issue.type === "rate-mismatch");
  const otherReviewIssues = reviewIssues.filter((issue) => issue.type !== "rate-mismatch");
  const hasReason = entries.some((entry) => pmWarningCleanText(entry.reason));
  const hasRectification = entries.some((entry) => pmWarningCleanText(entry.rectification));
  const redPeriods = Object.entries(item.monthlyStatuses || {}).filter(([, status]) => status === "红色").map(([period]) => period);
  const bluePeriods = Object.entries(item.monthlyStatuses || {}).filter(([, status]) => status === "蓝色").map(([period]) => period);
  const amountMissing = ["contract", "budget", "actual", "reduction"].filter((field) => !pmWarningHasValue(item[field]));
  const hasAmountIssue = Boolean(item.amountLogicIssue) || (pmWarningHasValue(item.reduceActual) && (!pmWarningHasValue(item.budget) || !pmWarningHasValue(item.actual)));

  let conclusion = "暂按台账展示，未发现明确冲突。";
  if (conflictIssues.length) {
    conclusion = "存在源头校验冲突，不建议直接作为最终口径，应优先复核成本对比分析和审批表。";
  } else if (hasAmountIssue) {
    conclusion = "存在逻辑缺口：已有降低率信息，但预算成本或实际成本不完整，应回平台补抓金额源头。";
  } else if (!checks.length) {
    conclusion = "尚未完成源头校验，当前只能作为台账展示，不能视为最终校核结论。";
  } else if (rateReviewIssues.length && !otherReviewIssues.length) {
    conclusion = "累计金额口径已完成源头校核；降低率按审批表自开工累计口径查看，成本对比页若公式或目标率字段不同，作为口径/维护差异复核。";
  } else if (reviewIssues.length) {
    conclusion = "源头校验未见硬冲突，但存在待复核差异，建议核对金额、原因表述及降低率字段口径。";
  } else if (redPeriods.length) {
    conclusion = "当前包含红色预警月份，重点关注亏损金额、实际降低率和整改闭环。";
  } else if (bluePeriods.length) {
    conclusion = "当前为蓝色提醒项目，重点关注责任目标完成情况和后续月份变化。";
  }

  const basis = [
    `月份状态：${pmWarningAnalysisStatusText(item)}`,
    `金额情况：合同额${pmWarningHasValue(item.contract) ? item.contract : "未取到"}，预算${pmWarningHasValue(item.budget) ? item.budget : "未取到"}，实际${pmWarningHasValue(item.actual) ? item.actual : "未取到"}，降低额${pmWarningHasValue(item.reduction) ? item.reduction : "未取到"}`,
    `降低率：责任目标${pmWarningHasValue(item.reduceDuty) ? item.reduceDuty : "未取到"}，实际${pmWarningHasValue(item.reduceActual) ? item.reduceActual : "未取到"}`,
    amountMissing.length ? `缺失字段：${amountMissing.map((field) => ({ contract: "合同额", budget: "预算成本", actual: "实际成本", reduction: "降低额" }[field] || field)).join("、")}` : "",
    !hasReason ? "原因分析未取到" : "",
    !hasRectification ? "整改措施未取到" : "",
    conflictIssues.length ? `冲突问题：${conflictIssues.slice(0, 3).map(pmWarningIssueText).join("；")}` : "",
    !conflictIssues.length && reviewIssues.length ? `待复核问题：${reviewIssues.slice(0, 3).map(pmWarningIssueText).join("；")}` : "",
  ].filter(Boolean);

  const suggestions = [];
  if (conflictIssues.length || hasAmountIssue || amountMissing.includes("budget") || amountMissing.includes("actual")) {
    suggestions.push("优先重新抓取或人工打开成本对比分析页，确认不含税合计行的累计预算成本、累计实际成本和税前降低额。");
  }
  if (!conflictIssues.length && rateReviewIssues.length) {
    suggestions.push("降低率按审批表自开工以来累计降低率作为台账口径；若成本对比页目标率为0或公式口径不同，按字段维护/口径差异复核。");
  }
  if (!hasReason || !hasRectification) {
    suggestions.push("补齐审批表中的原因分析和整改措施，避免台账只有颜色没有管理动作。");
  }
  if (redPeriods.length) {
    suggestions.push("红色月份应形成亏损原因、责任人、整改时限和后续跟踪结果。");
  }
  if (!suggestions.length) suggestions.push("保持月度跟踪，后续月份如颜色变化，应对比变化原因。");

  return [
    "分析结论",
    "",
    conclusion,
    "",
    "主要依据：",
    ...basis.map((text) => `- ${text}`),
    "",
    "建议动作：",
    ...suggestions.map((text) => `- ${text}`),
  ].join("\n");
}

function pmWarningBuildCombinedDetail(item) {
  const reasonDetail = pmWarningBuildTextDetail(item, "reason", "原因分析");
  const rectificationDetail = pmWarningBuildTextDetail(item, "rectification", "整改措施");
  const costCheckDetail = pmWarningBuildCostCheckDetail(item);
  return [
    pmWarningAnalysisConclusion(item),
    reasonDetail || "原因分析\n\n未取到",
    rectificationDetail || "整改措施\n\n未取到",
    costCheckDetail ? `源头校验\n\n${costCheckDetail}` : "源头校验\n\n未校核",
  ].join("\n\n------------------------------\n\n");
}

function pmWarningCostCheckSummary(item) {
  const checks = pmWarningDetailEntries(item).map((entry) => entry.costComparisonCheck).filter(Boolean);
  if (!checks.length) return { label: "未校核", tone: "muted" };
  const conflicts = checks.reduce((sum, check) => sum + (Number(check.conflictCount) || 0), 0);
  const reviews = checks.reduce((sum, check) => sum + (Number(check.reviewCount) || 0), 0);
  if (conflicts) return { label: `冲突${formatNumber(conflicts)}`, tone: "bad" };
  if (reviews) return { label: `待复核${formatNumber(reviews)}`, tone: "warn" };
  return { label: "已通过", tone: "ok" };
}

function pmWarningStatusPill(value, row = {}) {
  if (!value) return "";
  const status = String(value || "");
  const tone = row._costCheckTone || "muted";
  if (tone === "muted") {
    return `<span class="warning-pill muted" title="平台原始状态：${escapeAttr(status)}；源头尚未校核">${escapeHtml(`${status}待核验`)}</span>`;
  }
  if (tone === "warn") {
    return `<span class="warning-pill warn" title="平台原始状态：${escapeAttr(status)}；源头存在待复核差异">${escapeHtml(`${status}待复核`)}</span>`;
  }
  return `<span class="warning-pill ${status === "红色" ? "red" : "blue"}">${escapeHtml(status)}</span>`;
}

function pmWarningShouldUseRowDisplay(merged, row) {
  const mergedPeriod = String(merged.reportPeriod || "");
  const rowPeriod = String(row.reportPeriod || "");
  if (rowPeriod && rowPeriod > mergedPeriod) return true;
  if (!mergedPeriod && rowPeriod) return true;
  return false;
}

function pmWarningCopyDisplayFields(target, source) {
  [
    "reportPeriod", "project", "major", "hsdx", "manager", "contract", "budget", "actual", "reduction",
    "reduceDuty", "reduceDutyRaw", "targetSignStatus", "reduceActual", "profitRate", "warningDecision",
    "placeholder", "amountLogicIssue", "contractNoDataVerified",
  ].forEach((field) => {
    if (source[field] !== undefined) target[field] = source[field];
  });
}

function pmWarningPlatformRank(value) {
  return value === "big-pm" ? 2 : value === "old-pm" ? 1 : 0;
}

function pmWarningCreateMergedRow(row) {
  return {
    ...row,
    monthlyStatuses: { ...(row.monthlyStatuses || {}) },
    sourcePlatforms: new Set([row.sourcePlatform]),
    sourceNos: [row.sourceNo].filter(Boolean),
    sourceCount: 1,
    detailItems: pmWarningDetailItemsFromRow(row),
    _primaryPlatformRank: pmWarningPlatformRank(row.sourcePlatform),
  };
}

function mergePmWarnings(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.mergeKey || `${row.project}|${row.rule}|${row.company}`;
    if (!groups.has(key)) {
      groups.set(key, pmWarningCreateMergedRow(row));
      return;
    }
    const merged = groups.get(key);
    const mergedRank = merged._primaryPlatformRank || pmWarningPlatformRank(merged.sourcePlatform);
    const rowRank = pmWarningPlatformRank(row.sourcePlatform);
    if (rowRank > mergedRank) {
      groups.set(key, pmWarningCreateMergedRow(row));
      return;
    }
    if (rowRank < mergedRank) return;
    Object.entries(row.monthlyStatuses || {}).forEach(([period, status]) => {
      if (compareRiskLevel(status, merged.monthlyStatuses?.[period]) > 0) {
        merged.monthlyStatuses[period] = status;
      }
    });
    merged.sourcePlatforms.add(row.sourcePlatform);
    if (row.sourceNo) merged.sourceNos.push(row.sourceNo);
    merged.sourceCount += 1;
    merged.detailItems.push(...pmWarningDetailItemsFromRow(row));
    if (pmWarningShouldUseRowDisplay(merged, row)) pmWarningCopyDisplayFields(merged, row);
    merged.reason = pmWarningMergeTextValue(merged.reason, row.reason);
    merged.rectification = pmWarningMergeTextValue(merged.rectification, row.rectification);
    merged.costComparisonCheck = pmWarningPickCostCheck(merged.costComparisonCheck, row.costComparisonCheck);
    if (compareRiskLevel(row.level, merged.level) > 0) {
      merged.level = row.level;
    }
    if (compareWarningStatus(row.status, merged.status) > 0) merged.status = row.status;
    merged.dueDate = [merged.dueDate, row.dueDate].filter(Boolean).sort()[0] || "";
    merged.owner = merged.owner || row.owner;
  });
  return [...groups.values()].map((row) => ({
    ...row,
    sourcePlatforms: [...row.sourcePlatforms],
    sourcePlatform: [...row.sourcePlatforms].map(platformName).join(" + "),
    sourceNos: row.sourceNos.join("、"),
    _primaryPlatformRank: undefined,
  }));
}

function syncPmWarningCompanyOptions(platformFilter) {
  const select = $("#pmWarningCompanyFilter");
  if (!select) return "all";
  const current = select.value || "all";
  const companies = state.pmWarningCompanies
    .map((item) => item.company)
    .sort(pmWarningCompanySort);
  select.innerHTML = `<option value="all">集团</option>${companies
    .map((company) => {
      const total = state.pmWarningCompanies.find((item) => item.company === company)?.total || 0;
      return `<option value="${escapeAttr(company)}">${escapeHtml(company)}（${formatNumber(total)}项）</option>`;
    })
    .join("")}`;
  select.value = current === "all" || companies.includes(current) ? current : "all";
  return select.value;
}

function getPmWarningViewData() {
  const levelFilter = $("#pmWarningLevelFilter")?.value || "all";
  const platformFilter = "all";
  const companyFilter = syncPmWarningCompanyOptions(platformFilter);
  const companyStats = state.pmWarningCompanies.filter((item) => companyFilter === "all" || item.company === companyFilter);
  const sourceRows = state.pmWarningSources.filter((item) => {
    const platformOk = platformFilter === "all" || item.sourcePlatform === platformFilter;
    const companyOk = companyFilter === "all" || item.company === companyFilter;
    return platformOk && companyOk;
  });
  const projectRows = state.pmProjectSources.filter((item) => {
    const platformOk = platformFilter === "all" || item.sourcePlatform === platformFilter;
    const companyOk = companyFilter === "all" || item.company === companyFilter;
    return platformOk && companyOk;
  });
  const mergedRows = mergePmWarnings(sourceRows).sort((a, b) =>
    pmWarningCompanySort(a.company, b.company)
    || compareRiskLevel(b.level, a.level)
    || String(a.project || "").localeCompare(String(b.project || ""), "zh-CN")
    || String(a.major || "").localeCompare(String(b.major || ""), "zh-CN")
  );
  const filtered = mergedRows.filter((item) => {
    return levelFilter === "all" || item.level === levelFilter;
  });
  return { sourceRows, projectRows, mergedRows, filtered, companyFilter, companyStats };
}

function pmWarningHasValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

function pmWarningIsZero(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(number) && Math.abs(number) <= 0.000001;
}

function pmWarningIsNoBudgetProfitZero(item) {
  return !pmWarningHasValue(item.budget)
    && pmWarningHasValue(item.actual)
    && (item.warningDecision === "warning-no-budget-profit-zero" || pmWarningIsZero(item.reduceActual) || pmWarningIsZero(item.profitRate));
}

function pmWarningShouldShowMoneyColumns(rows) {
  return rows.some((item) =>
    item.contractNoDataVerified || [item.contract, item.budget, item.actual, item.reduction].some(pmWarningHasValue)
  );
}

function pmWarningTableRows(rows, includeMoneyColumns = true) {
  const periods = pmWarningReportPeriods();
  return rows.map((item) => {
    const combinedDetail = pmWarningBuildCombinedDetail(item);
    const costCheckSummary = pmWarningCostCheckSummary(item);
    const row = {
      reportCompany: item.company,
    };
    periods.forEach((period) => {
      row[pmWarningMonthStatusKey(period)] = item.monthlyStatuses?.[period] || "";
    });
    if (includeMoneyColumns) {
      row.reportContract = item.contract;
      row.reportBudget = item.budget;
      row.reportActual = item.actual;
      row.reportReduction = item.reduction;
      row._noBudgetProfitZero = pmWarningIsNoBudgetProfitZero(item);
      row._contractNoData = !!item.contractNoDataVerified;
      row._amountLogicIssue = item.amountLogicIssue || "";
    }
    return {
      ...row,
      _placeholder: item.placeholder,
      reportDutyRate: item.placeholder ? "汇总占位" : item.reduceDuty,
      reportActualRate: item.placeholder ? "明细待补抓" : item.reduceActual,
      _costCheckSummary: costCheckSummary.label,
      _costCheckTone: costCheckSummary.tone,
      reportProject: item.project,
      reportMajor: item.placeholder ? "汇总占位" : item.major,
      reportManager: item.placeholder ? "非项目明细" : item.manager,
      reportCostCheck: combinedDetail,
    };
  });
}

function pmWarningIssueLabel(type) {
  return {
    "status-cost-conflict": "红蓝状态冲突",
    "amount-mismatch": "金额差异",
    "rate-mismatch": "降低率差异",
    "cost-total-row-missing": "成本页未读全",
    "cost-page-unread": "成本页未读取",
    "monthly-cost-reason-missing": "当月原因缺失",
    "monthly-cost-reason-uncovered": "当月亏损未说明",
    "monthly-no-work-cost-review": "无产值表述待核",
    "reason-keyword-mismatch": "原因疑似不一致",
    "cost-reason-empty": "成本页原因缺失",
    "approval-reason-empty": "审批表原因缺失",
    "rectification-empty": "整改措施缺失",
  }[type] || "待核验";
}

function pmWarningIssueCount(checks, type, severity = "") {
  return checks.reduce((sum, check) => sum + (check.issues || []).filter((issue) =>
    issue.type === type && (!severity || issue.severity === severity)
  ).length, 0);
}

function renderPmWarningConsistency() {
  const panel = $("#pmWarningConsistency");
  if (!panel) return;
  const summary = state.pmWarningReasonConsistency || {};
  const hasData = summary.hasData || Number(summary.checked) > 0 || Number(summary.skippedMissingPath) > 0 || (summary.errors || []).length;
  if (!hasData) {
    panel.innerHTML = "";
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  const statusConflicts = pmWarningIssueCount(checks, "status-cost-conflict", "conflict");
  const amountConflicts = pmWarningIssueCount(checks, "amount-mismatch", "conflict");
  const rateConflicts = pmWarningIssueCount(checks, "rate-mismatch", "conflict");
  const rateReviews = pmWarningIssueCount(checks, "rate-mismatch", "review");
  const topChecks = checks
    .filter((check) => (check.issues || []).some((issue) => issue.severity === "conflict"))
    .slice(0, 8);
  const errorText = (summary.errors || []).map((item) => item.message || item.error || String(item)).filter(Boolean).join("；");
  panel.innerHTML = `
    <div class="warning-check-head">
      <h3>大PM源头校验</h3>
      <span>${summary.checked ? `已核验 ${formatNumber(summary.checked)} 项` : "等待校验"}</span>
    </div>
    <div class="warning-check-grid">
      <article>
        <span>缺路径未校验</span>
        <strong>${formatNumber(summary.skippedMissingPath || 0)}</strong>
      </article>
      <article class="${statusConflicts ? "bad" : ""}">
        <span>红蓝状态冲突</span>
        <strong>${formatNumber(statusConflicts)}</strong>
      </article>
      <article class="${amountConflicts ? "bad" : ""}">
        <span>金额差异</span>
        <strong>${formatNumber(amountConflicts)}</strong>
      </article>
      <article class="${rateConflicts ? "bad" : rateReviews ? "warn" : ""}">
        <span>降低率差异</span>
        <strong>${formatNumber(rateConflicts)}<small>冲突</small>${rateReviews ? `<em>${formatNumber(rateReviews)} 待复核</em>` : ""}</strong>
      </article>
    </div>
    ${errorText ? `<p class="warning-check-error">${escapeHtml(errorText)}</p>` : ""}
    ${topChecks.length ? `
      <div class="warning-check-list">
        ${topChecks.map((check) => `
          <div class="warning-check-item">
            <b>${escapeHtml([check.company, check.hsdx].filter(Boolean).join(" / "))}</b>
            <span>${escapeHtml(check.name || "")}</span>
            <small>${(check.issues || []).filter((issue) => issue.severity === "conflict").slice(0, 3).map((issue) =>
              `${pmWarningIssueLabel(issue.type)}：${issue.message || ""}`
            ).map(escapeHtml).join("；")}</small>
          </div>
        `).join("")}
      </div>
    ` : `<p class="warning-check-ok">未发现红蓝状态、金额或原因整改的明显冲突。</p>`}
  `;
}

function renderPmWarnings() {
  const summary = $("#pmWarningSummary");
  const table = $("#pmWarningTable");
  const pie = $("#pmWarningPieChart");
  if (!summary || !table) return;

  const { companyStats, mergedRows, filtered } = getPmWarningViewData();
  const red = companyStats.reduce((sum, item) => sum + (Number(item.red) || 0), 0);
  const blue = companyStats.reduce((sum, item) => sum + (Number(item.blue) || 0), 0);
  const inProgress = companyStats.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const normal = companyStats.reduce((sum, item) => sum + (Number(item.normal) || 0), 0);

  summary.innerHTML = [
    { label: "在建项目", value: inProgress, unit: "项", tone: "navy" },
    { label: "红色风险", value: red, unit: "项", tone: "red" },
    { label: "蓝色提醒", value: blue, unit: "项", tone: "blue" },
  ].map((card) => `
    <article class="warning-metric ${card.tone}">
      <span>${card.label}</span>
      <strong>${formatNumber(card.value)}<small>${card.unit}</small></strong>
    </article>
  `).join("");

  if (pie) renderPmWarningPie(pie, { red, blue, normal, total: inProgress });

  const ledgerTitle = $("#pmWarningLedgerTitle");
  if (ledgerTitle) ledgerTitle.textContent = `红蓝预警台账（${formatNumber(filtered.length)}项）`;

  const includeMoneyColumns = pmWarningShouldShowMoneyColumns(filtered);
  const detailHealth = state.pmWarningDetailHealth || {};
  const detailTotal = Number(detailHealth.total) || filtered.length;
  const detailComplete = Number(detailHealth.complete) || 0;
  const detailContract = Number(detailHealth.contract) || 0;
  const detailBudget = Number(detailHealth.budget) || 0;
  const detailActual = Number(detailHealth.actual) || 0;
  const detailReduction = Number(detailHealth.reduction) || 0;
  const missingBudget = Math.max(0, detailTotal - detailBudget);
  const amountNote = detailTotal > 0
    ? `，合同${formatNumber(detailContract)}/${formatNumber(detailTotal)}，预算${formatNumber(detailBudget)}/${formatNumber(detailTotal)}，实际${formatNumber(detailActual)}/${formatNumber(detailTotal)}，降低额${formatNumber(detailReduction)}/${formatNumber(detailTotal)}${missingBudget ? `，预算缺${formatNumber(missingBudget)}项` : ""}`
    : "";
  if (ledgerTitle) {
    ledgerTitle.textContent = `红蓝预警台账（${formatNumber(filtered.length)}项${amountNote}）`;
    ledgerTitle.title = detailTotal > 0
      ? `完整金额 ${formatNumber(detailComplete)}/${formatNumber(detailTotal)}；合同 ${formatNumber(detailContract)}/${formatNumber(detailTotal)}，预算 ${formatNumber(detailBudget)}/${formatNumber(detailTotal)}，实际 ${formatNumber(detailActual)}/${formatNumber(detailTotal)}，降低额 ${formatNumber(detailReduction)}/${formatNumber(detailTotal)}`
      : "";
  }

  const rows = pmWarningTableRows(filtered, includeMoneyColumns);
  const statusFormatters = Object.fromEntries(pmWarningReportPeriods().map((period) => [
    pmWarningMonthStatusKey(period),
    (value, row) => pmWarningStatusPill(value, row),
  ]));
  table.classList.toggle("moneyless", !includeMoneyColumns);
  renderTable(table, rows, {
    ...statusFormatters,
    reportContract: (value, row) => row._placeholder ? `<span class="missing-cell">明细待补抓</span>` : row._contractNoData ? `<span class="missing-cell">平台无数据</span>` : formatMoneyOrMissing(value),
    reportBudget: (value, row) => row._placeholder ? `<span class="missing-cell">明细待补抓</span>` : row._amountLogicIssue ? `<span class="missing-cell amount-issue">金额待复抓</span>` : row._noBudgetProfitZero ? "" : formatMoneyOrMissing(value),
    reportActual: (value, row) => row._placeholder ? `<span class="missing-cell">明细待补抓</span>` : row._amountLogicIssue ? `<span class="missing-cell amount-issue">金额待复抓</span>` : formatMoneyOrMissing(value),
    reportReduction: (value, row) => row._placeholder ? `<span class="missing-cell">明细待补抓</span>` : row._amountLogicIssue ? `<span class="missing-cell amount-issue">金额待复抓</span>` : row._noBudgetProfitZero ? "" : formatMoneyOrMissing(value),
    reportDutyRate: (value) => formatPercentValue(value),
    reportActualRate: (value) => formatPercentValue(value),
    reportCostCheck: (_value, row) => `<span class="warning-detail-chip buttonlike ${escapeAttr(row._costCheckTone || "muted")}">查看详情</span>`,
  }, { detailKeys: ["reportCostCheck"] });
}

function renderPmWarningPie(container, stats) {
  const total = Math.max(stats.total || 0, stats.red + stats.blue + stats.normal, 1);
  const redRate = (stats.red / total) * 100;
  const blueRate = (stats.blue / total) * 100;
  const normalRate = Math.max(100 - redRate - blueRate, 0);
  container.innerHTML = `
    <div class="warning-pie" style="--red:${redRate}%; --blue:${redRate + blueRate}%">
      <span>${formatNumber(stats.total || 0)}<small>在建</small></span>
    </div>
    <div class="pie-legend">
      <span><i class="red"></i>红色 ${formatNumber(stats.red)} 项</span>
      <span><i class="blue"></i>蓝色 ${formatNumber(stats.blue)} 项</span>
      <span><i class="gray"></i>无预警 ${formatNumber(stats.normal)} 项</span>
    </div>
  `;
}

function setPmWarningCaptureStatus(message, tone = "") {
  const status = $("#pmWarningCaptureStatus");
  if (!status) return;
  const normalized = pmWarningNormalizeCaptureMessage(message, tone);
  status.textContent = normalized.message || "";
  status.className = `capture-status ${normalized.tone}`.trim();
  status.title = normalized.title || "";
}

function pmWarningHasDisplayedData() {
  const totals = state.pmWarningTotals || {};
  const projects = state.pmWarningSources || [];
  return Boolean(
    projects.length
    || Number(totals.inProgress)
    || Number(totals.total)
    || Number(totals.red)
    || Number(totals.blue)
    || Number(totals.normal)
  );
}

function pmWarningNormalizeCaptureMessage(message = "", tone = "") {
  const text = String(message || "").trim();
  if (!text) return { message: "", tone: "" };
  const isDebugPortMessage = /未检测到|未连接到|调试端口|9222|9333/.test(text);
  if (!isDebugPortMessage) return { message: text, tone };
  const platform = /大PM|9333|Chrome/.test(text) ? "大PM平台" : "四版平台";
  const port = platform === "大PM平台" ? "9333" : "9222";
  const browser = platform === "大PM平台" ? "Chrome" : "Edge";
  const shortMessage = pmWarningHasDisplayedData()
    ? `当前显示已抓取数据；${platform}重新抓数前需连接 ${port} 调试窗口。`
    : `${platform}重新抓数前需先打开专用 ${browser} 调试窗口（端口 ${port}）。`;
  return {
    message: shortMessage,
    tone: "warn compact",
    title: text,
  };
}

function pmWarningPendingDetailCount(source = {}) {
  const totals = source.totals || state.pmWarningTotals || {};
  const detailHealth = source.detailHealth || state.pmWarningDetailHealth || {};
  const captureCompleteness = source.captureCompleteness || state.pmWarningCaptureCompleteness || {};
  const missing = Number(captureCompleteness.missing);
  if (Number.isFinite(missing) && missing > 0) return missing;
  const placeholder = Number(detailHealth.placeholder);
  if (Number.isFinite(placeholder) && placeholder > 0) return placeholder;
  const expected = (Number(totals.red) || 0) + (Number(totals.blue) || 0);
  const detailTotal = Number(detailHealth.total ?? totals.detailProjects) || 0;
  return Math.max(0, expected - detailTotal);
}

function pmWarningPendingDetailMessage(source = {}) {
  const pending = pmWarningPendingDetailCount(source);
  if (!pending) return "";
  const totals = source.totals || state.pmWarningTotals || {};
  const red = Number(totals.red) || 0;
  const blue = Number(totals.blue) || 0;
  return `汇总已抓取：红色 ${formatNumber(red)} 项，蓝色 ${formatNumber(blue)} 项；项目明细仍有 ${formatNumber(pending)} 项待补抓。`;
}

function setPmWarningCaptureRunning(running) {
  state.pmWarningCaptureRunning = running;
  const oldPmButton = document.querySelector('[data-pm-warning-platform="old-pm"]');
  const bigPmButton = document.querySelector('[data-pm-warning-platform="big-pm"]');
  const startButton = $("#pmWarningStartBtn");
  const clearButton = $("#pmWarningClearBtn");
  [oldPmButton, startButton, clearButton].forEach((button) => {
    if (!button) return;
    button.disabled = running;
    button.classList.toggle("loading", running);
  });
  if (bigPmButton) bigPmButton.disabled = running;
  if (oldPmButton) oldPmButton.textContent = running ? "四版平台抓取中" : "四版平台";
}

async function refreshPmWarningDataFromServer(message = "红蓝预警已刷新。") {
  const data = await refreshPmWarningChartData("all");
  renderPmWarnings();
  const pendingMessage = pmWarningPendingDetailMessage(data);
  if (pendingMessage) {
    setPmWarningCaptureStatus(pendingMessage, "warn");
  } else if (message) {
    setPmWarningCaptureStatus(message, "success");
  } else {
    setPmWarningCaptureStatus("");
  }
  if (message) toast(message);
}

function resetPmWarningState(data = {}) {
  window.clearTimeout(state.pmWarningCaptureTimer);
  state.pmWarningCaptureTimer = null;
  state.pmWarningCaptureJob = null;
  state.pmWarningCaptureRunning = false;
  applyPmWarningChartData(data, "all");
  setPmWarningCaptureRunning(false);
}

async function pollPmWarningCapture(jobId) {
  if (!jobId) return;
  window.clearTimeout(state.pmWarningCaptureTimer);
  try {
    const job = await api(`/api/pm-warning-capture-jobs?id=${encodeURIComponent(jobId)}`);
    state.pmWarningCaptureJob = job;
    const pendingMessage = pmWarningPendingDetailMessage(job);
    const jobMessage = pendingMessage && job.platform === "big-pm"
      ? `${job.platformName || "大PM平台"}：${job.status || ""}。${pendingMessage}`
      : `${job.platformName || "四版平台"}：${job.status || ""}。${job.message || ""}`;
    setPmWarningCaptureStatus(jobMessage, job.status === "失败" || job.status === "启动失败" ? "error" : pendingMessage ? "warn" : "");
    if (job.status === "已完成") {
      setPmWarningCaptureRunning(false);
      await refreshPmWarningDataFromServer(`${job.platformName || "PM平台"}抓数完成，合计台账已刷新。`);
      return;
    }
    if (["失败", "启动失败"].includes(job.status)) {
      setPmWarningCaptureRunning(false);
      toast(job.message || "四版平台抓数失败。");
      return;
    }
    state.pmWarningCaptureTimer = window.setTimeout(() => pollPmWarningCapture(jobId), 2000);
  } catch (err) {
    setPmWarningCaptureRunning(false);
    setPmWarningCaptureStatus(err.message, "error");
    toast(err.message);
  }
}

async function startPmWarningCapture(platform) {
  if (state.pmWarningCaptureRunning) return;
  if (platform === "all") {
    await refreshPmWarningDataFromServer();
    return;
  }
  await setPmWarningPlatform(platform);
  setPmWarningCaptureRunning(true);
  setPmWarningCaptureStatus(`${platformName(platform)}：正在创建抓数任务...`);
  try {
    const job = await api("/api/pm-warning-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        period: $("#periodFilter")?.value || currentPeriod(),
      }),
    });
    state.pmWarningCaptureJob = job;
    setPmWarningCaptureStatus(`${job.platformName || platformName(platform)}：${job.status || "已启动"}。${job.message || ""}`);
    toast(`${job.platformName || platformName(platform)}抓数已启动。`);
    await pollPmWarningCapture(job.id);
  } catch (err) {
    setPmWarningCaptureRunning(false);
    setPmWarningCaptureStatus(err.message, "error");
    toast(err.message);
  }
}

async function setPmWarningPlatform(value, options = {}) {
  state.pmWarningCapturePlatform = value === "big-pm" ? "big-pm" : "old-pm";
  state.pmWarningPlatform = "all";
  const select = $("#pmWarningTopPlatformFilter");
  if (select) select.value = "all";
  $$("#pmWarningPlatformButtons .platform-choice").forEach((button) => {
    button.classList.toggle("active", button.dataset.pmWarningPlatform === state.pmWarningCapturePlatform);
  });
  if (options.load !== false) await refreshPmWarningChartData("all");
  renderPmWarnings();
  const status = $("#pmWarningCaptureStatus");
  if (status && /调试窗口|调试端口|9222|9333/.test(status.textContent || "")) {
    setPmWarningCaptureStatus("");
  }
}

async function exportPmWarnings() {
  const period = $("#periodFilter")?.value || currentPeriod();
  const url = `/api/pm-warning-export?platform=all&period=${encodeURIComponent(period)}`;
  const button = $("#pmWarningExportBtn");
  if (button) button.disabled = true;
  setPmWarningCaptureStatus("正在按红蓝预警原报表格式导出...");
  try {
    const blob = await api(url);
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    link.download = `PM平台红蓝预警报表_${period || "全部"}_${stamp}.xls`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setPmWarningCaptureStatus("红蓝预警报表已导出。", "success");
    toast("红蓝预警报表已导出。");
  } catch (err) {
    setPmWarningCaptureStatus(err.message, "error");
    toast(err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function clearPmWarnings() {
  const button = $("#pmWarningClearBtn");
  if (button) button.disabled = true;
  setPmWarningCaptureStatus("正在清空红蓝预警网页数据...");
  try {
    const result = await api("/api/pm-warning-data?platform=all", { method: "DELETE" });
    resetPmWarningState(result.data || {});
    renderPmWarnings();
    setPmWarningCaptureStatus("红蓝预警网页数据已清空。", "success");
    toast("红蓝预警网页数据已清空。");
  } catch (err) {
    setPmWarningCaptureStatus(err.message, "error");
    toast(err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshMaterialTasks() {
  state.materialTasks = await api("/api/material-price-tasks");
  renderMaterialTasks();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function refreshMaterialTrend() {
  state.materialTrend = await api("/api/material-price-trend");
  renderMaterialTrend();
}

function isMaterialTaskFinished(task) {
  const status = String(task?.status || "");
  return status === "已建表" || status.includes("失败") || status.includes("校验失败");
}

function isMaterialTaskActive(task) {
  const status = String(task?.status || "");
  if (!task || isMaterialTaskFinished(task)) return false;
  if (state.materialTaskPollingIds.has(task.id)) return true;
  return /pending|待|后台|连接|平台|采集|抓取|导出|生成|建表|登录/.test(status);
}

function startMaterialTaskPolling(taskId = "", options = {}) {
  if (taskId) state.materialTaskPollingIds.add(taskId);
  state.materialTaskPollingAnnounce = state.materialTaskPollingAnnounce || Boolean(options.announce);
  window.clearTimeout(state.materialTaskPollingTimer);
  state.materialTaskPollingTimer = window.setTimeout(pollMaterialTasksUntilDone, options.delay ?? 2000);
}

function continueMaterialTaskPollingIfNeeded(options = {}) {
  const hasActiveTask = state.materialTasks.some(isMaterialTaskActive);
  if (hasActiveTask || state.materialTaskPollingIds.size) startMaterialTaskPolling("", options);
}

async function pollMaterialTasksUntilDone() {
  window.clearTimeout(state.materialTaskPollingTimer);
  try {
    await refreshMaterialTasks();
    for (const task of state.materialTasks) {
      if (state.materialTaskPollingIds.has(task.id) && isMaterialTaskFinished(task)) {
        state.materialTaskPollingIds.delete(task.id);
      }
    }
    const hasActiveTask = state.materialTasks.some(isMaterialTaskActive);
    if (hasActiveTask || state.materialTaskPollingIds.size) {
      state.materialTaskPollingTimer = window.setTimeout(pollMaterialTasksUntilDone, 3000);
      return;
    }
    await refreshMaterialTrend();
    await refreshWorkbenchProgress();
    if (state.materialTaskPollingAnnounce) toast("材料价格表已生成，页面已自动刷新。");
    state.materialTaskPollingAnnounce = false;
  } catch (err) {
    state.materialTaskPollingTimer = window.setTimeout(pollMaterialTasksUntilDone, 5000);
  }
}

function renderMaterialTasks() {
  const table = $("#materialTasksTable");
  if (!table) return;
  const rows = state.materialTasks.map((task) => ({
    id: task.id,
    createdAt: task.createdAt,
    company: task.company === "全集团" ? "集团" : task.company || task.name || "集团",
    startDate: task.startDate,
    endDate: task.endDate,
    keyword: task.keyword || "",
    status: task.status,
    rows: task.rows || 0,
    comparisonRows: task.comparisonRows || 0,
    downloadContent: task.downloadContent || (task.source === "导入数据" ? "普通材料价格横向对比表" : "小程序生成的技能四表工作簿"),
    message: task.message || "",
    action: "actions",
  }));
  renderTable(table, rows, {
    id: () => "",
    status: (value) => `<span class="${["待采集", "后台采集中", "连接平台中", "等待平台登录", "等待已登录浏览器", "等待平台页面", "等待平台采集适配", "等待后台采集", "四源采集中", "等待四源导出适配", "已导出源数据", "正在生成表格"].includes(value) ? "status warn" : "status"}">${escapeHtml(value)}</span>`,
    action: (_value, row) => `
      <span class="table-actions">
        <button class="small" data-download-material-task="${escapeAttr(row.id)}">下载</button>
        <button class="danger small" data-delete-material-task="${escapeAttr(row.id)}">删除</button>
      </span>
    `,
  });
}

async function createMaterialTask(form) {
  const payload = {
    company: form.company.value,
    startDate: form.startDate.value,
    endDate: form.endDate.value,
    keyword: form.keyword.value,
  };
  const task = await api("/api/material-price-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  toast(["待采集", "后台采集中", "连接平台中", "等待平台登录", "等待已登录浏览器", "等待平台页面", "等待平台采集适配", "等待后台采集", "四源采集中", "等待四源导出适配", "已导出源数据", "正在生成表格"].includes(task.status) ? task.message : "小程序已生成材料价格横向对比表。");
  await refreshMaterialTasks();
  startMaterialTaskPolling(task.id, { announce: true, delay: 1000 });
}

async function importMaterialTask(form) {
  const formData = new FormData(form);
  const task = await api("/api/material-price-import", {
    method: "POST",
    body: formData,
  });
  toast(task.status === "已建表" ? "已导入数据并生成横向对比表。" : task.message);
  form.reset();
  initMaterialTaskDefaults();
  renderMaterialCompanyOptions();
  await refreshMaterialTasks();
  await refreshMaterialTrend();
  if (!isMaterialTaskFinished(task)) startMaterialTaskPolling(task.id, { announce: true, delay: 1000 });
}

async function downloadMaterialTask(id) {
  const blob = await api(`/api/material-price-export?id=${encodeURIComponent(id)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  link.download = `材料采购价格横向对比表_${stamp}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteMaterialTask(id) {
  await api(`/api/material-price-tasks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  toast("已删除材料价格任务。");
  await refreshMaterialTasks();
}

async function searchBlacklist(form) {
  const query = form.query.value.trim();
  const submitBtn = form.querySelector('button[type="submit"]');
  const oldText = submitBtn?.textContent || "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "查询中";
  }
  try {
    await refreshBlacklistJobs();
    state.blacklistResult = await api(`/api/blacklist-query?q=${encodeURIComponent(query)}`);
    renderBlacklistResult();
    const pendingJob = pendingBlacklistJob(query);
    if ((state.blacklistResult.total || 0) > 0) {
      toast(`已查询到 ${state.blacklistResult.total} 条结果。`);
    } else if (pendingJob) {
      toast("已查询：当前只有天眼查穿透任务，尚未回写结果。");
    } else if (query) {
      toast("已查询：本地暂未发现关联结果，可发起天眼查穿透。");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = oldText || "查询";
    }
  }
}

async function exportBlacklist() {
  const query = $("#blacklistKeyword")?.value?.trim() || state.blacklistResult.query || "";
  const blob = await api(`/api/blacklist-export?q=${encodeURIComponent(query)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  link.download = `黑名单关联查询_${stamp}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

async function createBlacklistCodexJob() {
  const query = $("#blacklistKeyword")?.value?.trim() || state.blacklistResult.query || "";
  if (!query) throw new Error("请先输入要穿透查询的企业、法人或信用代码。");
  const job = await api("/api/blacklist-codex-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  toast(`已生成天眼查穿透任务，预计 ${job.estimatedAt || "10分钟内"} 形成结果。`);
  await refreshBlacklistJobs();
  state.blacklistResult = { ...state.blacklistResult, query };
  await searchBlacklist($("#blacklistForm"));
}

async function refreshBlacklistJobs() {
  state.blacklistJobs = await api("/api/blacklist-codex-jobs");
  renderBlacklistJobs();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function createBlacklistResultTemplate(id) {
  const result = await api("/api/blacklist-result-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  toast(`已生成回写模板：${result.status}`);
  await refreshBlacklistJobs();
}

async function judgeCompanyRelation(form) {
  const left = form.left.value.trim();
  const right = form.right.value.trim();
  if (!left || !right) throw new Error("请输入两个企业名称。");
  renderCompanyRelationResult({ status: "checking", message: "正在读取本地穿透路线并计算关联路径..." });
  const result = await api(`/api/company-relation?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
  renderCompanyRelationResult(result);
  toast(result.related ? "已发现关联路径。" : "已完成关联判断。");
}

function renderCompanyRelationResult(result) {
  const container = $("#companyRelationResult");
  if (!container) return;
  if (result.status === "checking") {
    container.innerHTML = `
      <strong class="relation-badge info">判断中</strong>
      <span>${escapeHtml(result.message || "正在判断关联关系...")}</span>
    `;
    return;
  }
  if (!result.related) {
    const missing = Array.isArray(result.missing) ? result.missing.filter(Boolean) : [];
    container.innerHTML = `
      <strong class="relation-badge warn">未发现关联</strong>
      <span>${escapeHtml(result.message || "当前数据中未发现关联路径。")}</span>
      ${missing.length ? `
        <div class="relation-actions">
          ${missing.map((name) => `<button class="small" type="button" data-relation-penetrate="${escapeAttr(name)}">穿透：${escapeHtml(truncateText(name, 12))}</button>`).join("")}
        </div>
      ` : ""}
    `;
    return;
  }
  const path = result.path || [];
  const steps = result.steps || [];
  container.innerHTML = `
    <strong class="relation-badge">发现关联</strong>
    <div class="relation-path">${path.map((name) => `<span>${escapeHtml(name)}</span>`).join("<i>→</i>")}</div>
    <div class="relation-step-list">
      ${steps.map((step, index) => `
        <p>${index + 1}. ${escapeHtml(step.source)} → ${escapeHtml(step.target)}：${escapeHtml(step.label || "关联")}<em>${escapeHtml(step.basis || "")}</em></p>
      `).join("")}
    </div>
  `;
}

async function createBlacklistJobForQuery(query) {
  const input = $("#blacklistKeyword");
  if (input) input.value = query;
  await createBlacklistCodexJob();
}

function startBlacklistJobPolling() {
  setInterval(async () => {
    if (!document.body.classList.contains("blacklist-mode")) return;
    try {
      await refreshBlacklistJobs();
    } catch (_err) {}
  }, 3000);
}

function renderBlacklistResult() {
  const result = state.blacklistResult || {};
  const queryText = result.query || $("#blacklistKeyword")?.value?.trim() || "";
  const pendingJob = pendingBlacklistJob(queryText);
  const stats = $("#blacklistStats");
  const table = $("#blacklistTable");
  if (stats) {
    stats.innerHTML = `
      <span>查询结果 <strong>${formatNumber(result.total || 0)}</strong></span>
      <span>黑名单 <strong>${formatNumber(result.highRisk || 0)}</strong></span>
      <span>关联企业 <strong>${formatNumber(result.related || 0)}</strong></span>
    `;
  }
  if (table) {
    const rows = (result.rows || []).map((row) => ({
      hitType: row.hitType,
      name: row.name,
      riskLevel: row.riskLevel,
      legalRep: row.legalRep,
      reason: row.reason,
      updatedAt: row.updatedAt,
    }));
    renderTable(table, rows, {
      hitType: (value) => `<span class="${value === "直接命中" ? "status bad" : "status warn"}">${escapeHtml(value === "直接命中" ? "直接匹配" : "关联企业")}</span>`,
      riskLevel: (value) => `<span class="${value === "黑名单" ? "status bad" : "status warn"}">${escapeHtml(value)}</span>`,
    });
    if (!rows.length && pendingJob) {
      table.innerHTML = `
        <thead><tr><th>当前状态</th><th>预计完成</th><th>结果状态</th><th>下一步</th></tr></thead>
        <tbody><tr>
          <td>${escapeHtml(pendingJob.status || "待天眼查处理")}</td>
          <td>${escapeHtml(pendingJob.estimatedAt || "约10分钟")}</td>
          <td>${escapeHtml(pendingJob.resultStatus || "未回写")}</td>
          <td>不是没反应；当前尚未回写天眼查结果。回写后重新点“查询”，即可生成关系图和 Excel。</td>
        </tr></tbody>
      `;
    } else if (!rows.length && queryText) {
      table.innerHTML = `
        <thead><tr><th>状态</th></tr></thead>
        <tbody><tr><td>本地库暂未查询到“${escapeHtml(queryText)}”的关联结果。请先点击“天眼查穿透”，或确认回写文件中已填写 entities、coverage、upwardRoutes、downwardRoutes、branchRoutes、personCrossRoutes、sameContactRoutes 等全量穿透结果。</td></tr></tbody>
      `;
    }
  }
  renderBlacklistMindmap(result.mindmap || { nodes: [], links: [] }, pendingJob, queryText);
}

function renderBlacklistJobs() {
  const table = $("#blacklistJobsTable");
  if (!table) return;
  const rows = state.blacklistJobs.map((job) => ({
    id: job.id,
    createdAt: job.createdAt,
    estimatedAt: job.estimatedAt,
    query: job.query,
    status: String(job.status || "").replace("Codex", "天眼查"),
    resultStatus: job.resultStatus || "",
    coverageStatus: job.coverageStatus || "",
    completedDepth: job.completedDepth ?? "",
    unexpandedCount: job.unexpandedCount ?? "",
    message: job.message,
    jobPath: job.jobPath,
    action: "actions",
  }));
  renderTable(table, rows, {
    id: (value) => escapeHtml(String(value).slice(0, 8)),
    status: (value) => `<span class="${value === "已回写" ? "status" : "status warn"}">${escapeHtml(value)}</span>`,
    resultStatus: (value) => `<span class="${value === "已有结果" ? "status" : "status warn"}">${escapeHtml(value || "未回写")}</span>`,
    coverageStatus: (value) => {
      const text = value === "complete" ? "已完整" : value === "partial" ? "部分完成" : value || "未标注";
      return `<span class="${value === "complete" ? "status" : "status warn"}">${escapeHtml(text)}</span>`;
    },
    jobPath: (value) => `<code>${escapeHtml(value)}</code>`,
    action: (_value, row) => `
      <span class="table-actions">
        <a class="table-link" href="https://www.tianyancha.com/search?key=${encodeURIComponent(row.query)}" target="_blank" rel="noopener">打开天眼查</a>
        <button class="small" data-blacklist-template="${escapeAttr(row.id)}">生成模板</button>
      </span>
    `,
  });
}

function pendingBlacklistJob(query) {
  const text = (query || "").trim();
  if (!text) return null;
  const normalized = normalizeUiText(text);
  return state.blacklistJobs.find((job) => {
    if (job.status === "已回写") return false;
    const jobQuery = normalizeUiText(job.query || "");
    return jobQuery === normalized || jobQuery.includes(normalized) || normalized.includes(jobQuery);
  });
}

function renderBlacklistMindmap(mindmap, pendingJob = null, queryText = "") {
  const container = $("#blacklistMindmap");
  if (!container) return;
  const nodes = mindmap.nodes || [];
  const links = mindmap.links || [];
  if (nodes.length <= 1) {
    container.innerHTML = pendingJob
      ? `<div class="empty-chart relation-empty">已找到天眼查穿透任务：${escapeHtml(pendingJob.status || "待处理")}；预计 ${escapeHtml(pendingJob.estimatedAt || "约10分钟")}；结果状态 ${escapeHtml(pendingJob.resultStatus || "未回写")}。当前没有明确关系图，是因为还没有回写股权、控股、分支、人员交叉等可解释路线。</div>`
      : `<div class="empty-chart relation-empty">${queryText ? `本地暂未形成“${escapeHtml(queryText)}”的明确关联关系图；同地区同行业、页面推荐等弱关联不会进入主图。` : "输入企业、法人、电话或账户后，生成关联关系图。"}</div>`;
    return;
  }
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const children = {};
  links.forEach((link) => {
    if (!children[link.source]) children[link.source] = [];
    children[link.source].push(link.target);
  });
  const rootChildren = [...new Set(children.root || [])];
  const width = 1320;
  const height = rootChildren.length > 48 ? 780 : rootChildren.length > 32 ? 700 : 620;
  const center = { x: width / 2, y: height / 2 + 8 };
  const positions = {};
  positions.root = center;
  const visibleRootChildren = rootChildren;
  const hiddenCount = 0;
  visibleRootChildren.forEach((id, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, visibleRootChildren.length);
    const ring = visibleRootChildren.length > 28 && index % 2 ? 1 : 0;
    const radiusX = ring ? 570 : (visibleRootChildren.length > 18 ? 482 : 410);
    const radiusY = ring ? Math.min(330, height * 0.39) : Math.min(270, height * 0.32);
    positions[id] = {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
  visibleRootChildren.forEach((parentId) => {
    const grandChildren = [...new Set(children[parentId] || [])].filter((id) => id !== "root");
    const parent = positions[parentId];
    if (!parent || !grandChildren.length) return;
    const parentAngle = Math.atan2(parent.y - center.y, parent.x - center.x);
    grandChildren.slice(0, 3).forEach((id, index) => {
      const offset = (index - (Math.min(3, grandChildren.length) - 1) / 2) * 0.18;
      positions[id] = {
        x: center.x + Math.cos(parentAngle + offset) * 590,
        y: center.y + Math.sin(parentAngle + offset) * 270,
      };
    });
  });
  nodes.forEach((node, index) => {
    if (positions[node.id]) return;
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, nodes.length);
    positions[node.id] = {
      x: center.x + Math.cos(angle) * 520,
      y: center.y + Math.sin(angle) * 250,
    };
  });
  const lineHtml = links.map((link) => {
    const start = positions[link.source];
    const end = positions[link.target];
    if (!start || !end) return "";
    const isRootLink = link.source === "root" || link.target === "root";
    const visibleLink = positions[link.source] && positions[link.target];
    if (!visibleLink) return "";
    return `
      <g class="relation-link ${isRootLink ? "primary" : ""}">
        <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"></line>
        <title>${escapeHtml(link.label || "")}</title>
      </g>
    `;
  }).join("");
  const nodeHtml = Object.entries(positions).map(([id, pos]) => {
    const node = nodeById[id] || {};
    const lines = wrapSvgLabel(node.label || "", id === "root" ? 12 : 11, id === "root" ? 3 : 2);
    const text = lines.map((line, index) => (
      `<tspan x="0" dy="${index === 0 ? -(lines.length - 1) * 7 : 15}">${escapeHtml(line)}</tspan>`
    )).join("");
    if (id === "root") {
      return `
        <g class="relation-node root" transform="translate(${pos.x},${pos.y})">
          <circle r="58"></circle>
          <text text-anchor="middle" dominant-baseline="middle">${text}</text>
        </g>
      `;
    }
    return `
      <g class="relation-node ${escapeAttr(node.type || "")}" transform="translate(${pos.x},${pos.y})">
        <rect x="-96" y="-24" width="192" height="48" rx="8"></rect>
        <line x1="-76" y1="24" x2="76" y2="24"></line>
        <text text-anchor="middle" dominant-baseline="middle">${text}</text>
      </g>
    `;
  }).join("");
  container.innerHTML = `
    <svg class="mindmap-svg relation-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="黑名单关联关系图">
      <defs>
        <radialGradient id="relationGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="#334155" stop-opacity="0.32"></stop>
          <stop offset="72%" stop-color="#111827" stop-opacity="0.12"></stop>
          <stop offset="100%" stop-color="#0b1120" stop-opacity="0"></stop>
        </radialGradient>
      </defs>
      <rect class="relation-bg" x="0" y="0" width="${width}" height="${height}" rx="18"></rect>
      <circle class="relation-glow" cx="${center.x}" cy="${center.y}" r="290"></circle>
      <text class="relation-title" x="28" y="40">关联关系图</text>
      <text class="relation-subtitle" x="28" y="66">已展示 ${rootChildren.length} 个明确关联节点${hiddenCount ? `，另有 ${hiddenCount} 个节点未在画布展开` : ""}</text>
      <g class="relation-links">${lineHtml}</g>
      ${nodeHtml}
    </svg>
  `;
}

function wrapSvgLabel(text, lineLength = 11, maxLines = 2) {
  const value = String(text || "").trim();
  if (!value) return [""];
  const lines = [];
  for (let index = 0; index < value.length && lines.length < maxLines; index += lineLength) {
    lines.push(value.slice(index, index + lineLength));
  }
  if (value.length > lineLength * maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, lineLength - 1))}…`;
  }
  return lines;
}

function truncateText(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function normalizeUiText(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function renderMaterialTrendLegacy() {
  const container = $("#materialTrendChart");
  if (!container) return;
  const labels = state.materialTrend?.labels || [];
  const series = (state.materialTrend?.series || []).filter((item) => (item.values || []).some((value) => value !== null && value !== undefined));
  if (!labels.length || !series.length) {
    container.innerHTML = `<div class="empty-chart">暂无东泰物流采购价格走势数据。</div>`;
    return;
  }
  const width = 920;
  const height = 300;
  const pad = { left: 56, right: 28, top: 28, bottom: 46 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = series.flatMap((item) => item.values.filter((value) => typeof value === "number"));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max === min ? Math.max(max, 1) : max - min;
  const x = (index) => pad.left + (labels.length === 1 ? plotWidth / 2 : (plotWidth * index) / (labels.length - 1));
  const y = (value) => pad.top + plotHeight - ((value - min) / span) * plotHeight;
  const colors = ["#b71924", "#1f6feb", "#1f8a5b", "#a36b00", "#6f42c1"];
  const lines = series.map((item, seriesIndex) => {
    const points = item.values
      .map((value, index) => typeof value === "number" ? `${x(index)},${y(value)}` : "")
      .filter(Boolean)
      .join(" ");
    return `<polyline points="${points}" style="--line:${colors[seriesIndex % colors.length]}"></polyline>`;
  }).join("");
  const dots = series.map((item, seriesIndex) => item.values.map((value, index) => {
    if (typeof value !== "number") return "";
    return `<circle cx="${x(index)}" cy="${y(value)}" r="3.5" style="--line:${colors[seriesIndex % colors.length]}"><title>${escapeHtml(item.name)} ${escapeHtml(labels[index])}: ${formatNumber(value)}</title></circle>`;
  }).join("")).join("");
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const xLabels = labels.map((label, index) => index % labelStep === 0 || index === labels.length - 1
    ? `<text x="${x(index)}" y="${height - 16}" text-anchor="middle">${escapeHtml(label.slice(2))}</text>`
    : ""
  ).join("");
  const yTicks = [0, 0.5, 1].map((rate) => {
    const value = min + span * rate;
    const ty = pad.top + plotHeight - plotHeight * rate;
    return `<line x1="${pad.left}" y1="${ty}" x2="${width - pad.right}" y2="${ty}"></line><text x="${pad.left - 10}" y="${ty + 4}" text-anchor="end">${formatNumber(value)}</text>`;
  }).join("");
  const legend = series.map((item, index) => `
    <span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.name)}</span>
  `).join("");
  container.innerHTML = `
    <svg class="material-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="东泰物流采购主要材料价格走势曲线">
      <g class="grid">${yTicks}</g>
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
      <g class="trend-lines">${lines}${dots}</g>
      <g class="x-labels">${xLabels}</g>
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
}

function renderMaterialTrend() {
  const container = $("#materialTrendChart");
  if (!container) return;
  const materials = (state.materialTrend?.materials || [])
    .filter((item) => item.companyCount >= 2 && item.totalAmount > 0 && item.spreadRate > 0)
    .slice(0, 10);
  if (!materials.length) {
    container.innerHTML = `<div class="empty-chart">暂无相同材料跨分公司价格差异数据。</div>`;
    return;
  }
  const width = 980;
  const rowHeight = 38;
  const height = Math.max(300, materials.length * rowHeight + 84);
  const pad = { left: 210, right: 230, top: 26, bottom: 42 };
  const plotWidth = width - pad.left - pad.right;
  const max = Math.max(...materials.map((item) => item.totalAmount || 0), 0.01);
  const x = (value) => pad.left + (plotWidth * value) / max;
  const bars = materials.map((item, index) => {
    const y = pad.top + index * rowHeight;
    const barWidth = Math.max(2, x(item.totalAmount || 0) - pad.left);
    const color = index < 3 ? "#b71924" : "#2563eb";
    const label = item.label || item.material || "未命名材料";
    return `
      <g class="dispersion-row">
        <text class="company-label" x="${pad.left - 12}" y="${y + 20}" text-anchor="end">${escapeHtml(truncateText(label, 16))}</text>
        <rect x="${pad.left}" y="${y + 7}" width="${barWidth}" height="18" rx="4" fill="${color}"></rect>
        <text class="bar-value" x="${Math.min(pad.left + barWidth + 8, width - pad.right - 8)}" y="${y + 21}">${formatMoney(item.totalAmount || 0)}</text>
        <text class="bar-meta" x="${width - pad.right + 18}" y="${y + 21}">${formatPercent(item.spreadRate || 0)} / ${escapeHtml(item.lowCompany)} -> ${escapeHtml(item.highCompany)}</text>
        <title>${escapeHtml(label)}：采购金额 ${formatMoney(item.totalAmount || 0)}，采购量 ${formatNumber(item.totalQuantity || 0)}，价差率 ${formatPercent(item.spreadRate || 0)}，影响金额 ${formatMoney(item.impactAmount || 0)}</title>
      </g>
    `;
  }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((rate) => {
    const value = max * rate;
    const tx = x(value);
    return `<line x1="${tx}" y1="${pad.top - 8}" x2="${tx}" y2="${height - pad.bottom}"></line><text x="${tx}" y="${height - 12}" text-anchor="middle">${formatMoney(value)}</text>`;
  }).join("");
  container.innerHTML = `
    <svg class="material-trend-svg dispersion-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="按采购金额优先的相同材料采购价格差异排行">
      <g class="grid">${ticks}</g>
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
      ${bars}
      <text class="bar-meta" x="${width - pad.right + 18}" y="${height - 12}">价差率 / 最低价 -> 最高价</text>
    </svg>
    <div class="material-spread-table">
      <table>
        <thead>
          <tr>
            <th>材料</th>
            <th>规格</th>
            <th>最低价</th>
            <th>最高价</th>
            <th>价差率</th>
            <th>采购金额</th>
            <th>影响金额</th>
            <th>采购量</th>
            <th>涉及公司</th>
          </tr>
        </thead>
        <tbody>
          ${materials.map((item) => `
            <tr>
              <td>${escapeHtml(item.material || "")}</td>
              <td>${escapeHtml(item.spec || "")}</td>
              <td>${escapeHtml(item.lowCompany || "")} ${formatMoney(item.lowPrice)}</td>
              <td>${escapeHtml(item.highCompany || "")} ${formatMoney(item.highPrice)}</td>
              <td><strong>${formatPercent(item.spreadRate || 0)}</strong></td>
              <td><strong>${formatMoney(item.totalAmount || 0)}</strong></td>
              <td>${formatMoney(item.impactAmount || 0)}</td>
              <td>${formatNumber(item.totalQuantity || 0)}</td>
              <td>${formatNumber(item.companyCount || 0)}家 / ${formatNumber(item.priceCount || 0)}条</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="chart-legend">
      <span><i style="background:#b71924"></i>采购金额 Top 3</span>
      <span><i style="background:#2563eb"></i>大宗相同材料价差排行</span>
    </div>
  `;
}

function priceLibraryQueryString() {
  const form = $("#priceLibraryFilterForm");
  if (!form) return "";
  const params = new URLSearchParams(new FormData(form));
  return params.toString();
}

async function refreshPriceLibrary() {
  const query = priceLibraryQueryString();
  state.priceLibrary = await api(`/api/price-library${query ? `?${query}` : ""}`);
  renderPriceLibrary();
}

function renderPriceLibrary() {
  const data = state.priceLibrary || { rows: [], summary: {} };
  const summary = data.summary || {};
  const summaryEl = $("#priceLibrarySummary");
  if (summaryEl) {
    summaryEl.innerHTML = [
      ["记录数", summary.total || 0],
      ["劳务分包", summary.laborSubcontract || 0],
      ["专业分包", summary.professionalSubcontract || 0],
    ].map(([label, value]) => `
      <article class="price-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `).join("");
  }
  renderTable($("#priceLibrarySpreadTable"), (summary.spreadRows || []).map((row) => ({
    category: row.category,
    item: row.item,
    unit: row.unit,
    region: row.region,
    lowPrice: row.lowPrice,
    highPrice: row.highPrice,
    spreadRate: row.spreadRate,
    supplierCompare: [row.lowSupplier, row.highSupplier].filter(Boolean).join(" / "),
    records: row.records,
  })), {
    lowPrice: (value) => formatMoney(value),
    highPrice: (value) => formatMoney(value),
    spreadRate: (value) => formatPercent(value),
  });
  const displayRows = normalizePriceLibraryProjectFields(data.rows || []);
  renderPriceLibrarySampleTable(displayRows);
  renderPriceLibraryDisplayFilters(displayRows);
  renderTable($("#priceLibraryTable"), displayRows.map((row) => ({
    id: row.id,
    category: row.category,
    company: row.company,
    major: row.major,
    discipline: row.discipline,
    trade: row.trade,
    process: row.process,
    item: row.item,
    spec: row.spec,
    unit: row.unit,
    price: row.price,
    taxRate: row.taxRate,
    quantity: row.quantity,
    amount: row.amount,
    region: row.region,
    projectType: row.projectType,
    project: row.project,
    supplier: row.supplier,
    contractNo: row.contractNo,
    priceDate: row.priceDate,
    source: row.source,
    action: row.id,
  })), {
    price: (value) => formatMoney(value),
    taxRate: (value) => value ? formatPercent(value) : "",
    quantity: (value) => formatMoney(value),
    amount: (value) => formatMoney(value),
    action: (value) => `
      <span class="table-actions">
        <button class="small" data-edit-price-row="${escapeAttr(value)}">修改</button>
        <button class="danger small" data-delete-price-row="${escapeAttr(value)}">删除</button>
      </span>
    `,
  });
  renderPriceLibraryAnalysisFilters(displayRows);
  renderPriceLibraryAnalysisCharts(displayRows);
  renderPriceLibraryEditPicker();
}

function normalizePriceLibraryProjectFields(rows) {
  const projectInfo = new Map();
  rows.forEach((row) => {
    const project = String(row.project || "").trim();
    if (!project) return;
    const info = projectInfo.get(project) || {};
    if (!info.region && row.region) info.region = row.region;
    if (!info.projectType && isValidPriceLibraryProjectType(row.projectType)) info.projectType = row.projectType;
    if (!info.company && row.company) info.company = row.company;
    projectInfo.set(project, info);
  });
  return rows.map((row) => {
    const project = String(row.project || "").trim();
    const info = project ? projectInfo.get(project) : null;
    if (!info) return row;
    return {
      ...row,
      region: row.region || info.region || "",
      projectType: isValidPriceLibraryProjectType(row.projectType) ? row.projectType : (info.projectType || ""),
      company: row.company || info.company || "",
    };
  });
}

function renderPriceLibraryDisplayFilters(rows) {
  const select = $("#priceLibraryProjectTypeDisplayFilter");
  if (!select) return;
  const current = select.value || "";
  const category = $("#priceLibraryCategoryDisplayFilter")?.value || "";
  const major = $("#priceLibraryMajorDisplayFilter")?.value || "";
  const types = [...new Set(rows
    .filter((row) => !category || row.category === category)
    .filter((row) => priceLibraryMajorMatches(row, major))
    .map((row) => row.projectType)
    .filter(isValidPriceLibraryProjectType))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
  select.innerHTML = [
    `<option value="">全部工程类型</option>`,
    ...types.map((type) => `<option value="${escapeAttr(type)}">${escapeHtml(type)}</option>`),
  ].join("");
  if (current && types.includes(current)) select.value = current;
}

function isValidPriceLibraryProjectType(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/价格库|数据库|底表|模板|增强|导入|抓取|来源|默认|未分类/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
}

function parsePriceRemarkAttrs(remark) {
  return String(remark || "").split("；").reduce((attrs, part) => {
    const index = part.indexOf("：");
    if (index > 0) attrs[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    return attrs;
  }, {});
}

function priceLibraryDisplayContext(row) {
  const attrs = parsePriceRemarkAttrs(row.remark);
  const specParts = String(row.spec || "").split("；").map((part) => part.trim()).filter(Boolean);
  let height = "";
  let position = "";
  const rest = [];
  specParts.forEach((part) => {
    if (part.startsWith("层高：")) height = part.replace("层高：", "");
    else if (part.startsWith("施工部位：")) position = part.replace("施工部位：", "");
    else rest.push(part);
  });
  return {
    paymentPeriod: attrs["付款周期"] || "",
    paymentRatio: attrs["付款比例"] || "",
    paymentMethod: attrs["付款方式"] || "",
    paymentCondition: attrs["付款条件"] || [attrs["付款周期"], attrs["付款比例"], attrs["付款方式"]].filter(Boolean).join("；"),
    riskLevel: attrs["房源风险等级"] || "",
    height,
    position,
    constructionContent: attrs["施工内容"] || row.process || row.trade || rest.join("；"),
  };
}

function renderPriceLibrarySampleTable(rows) {
  const table = $("#priceLibraryClassificationTable");
  if (!table) return;
  const category = $("#priceLibraryCategoryDisplayFilter")?.value || "";
  const major = $("#priceLibraryMajorDisplayFilter")?.value || "";
  const projectType = $("#priceLibraryProjectTypeDisplayFilter")?.value || "";
  const displayRows = rows
    .filter((row) => !category || row.category === category)
    .filter((row) => priceLibraryMajorMatches(row, major))
    .filter((row) => !row.projectType || isValidPriceLibraryProjectType(row.projectType))
    .filter((row) => !projectType || row.projectType === projectType)
    .slice(0, 300)
    .map((row, index) => {
      const context = priceLibraryDisplayContext(row);
      const workScope = [context.position, context.constructionContent].filter(Boolean).join("；");
      return {
        sampleIndex: index + 1,
        typeLibrary: row.category,
        subcontractItem: row.item,
        measureUnit: row.unit,
        actualPurchasePrice: row.price,
        region: row.region,
        engineeringType: row.projectType,
        tenderDate: row.priceDate,
        baseCompany: row.company,
        projectDept: row.project,
        workScope,
        paymentCondition: context.paymentCondition || row.remark,
      };
    });
  renderTable(table, displayRows, {
    actualPurchasePrice: (value) => formatMoney(value),
    workScope: (value) => escapeHtml(value),
    paymentCondition: (value) => escapeHtml(value),
  });
}

function priceLibraryMajorMatches(row, major) {
  if (!major) return true;
  if (major === "土建") return row.major === "土建" || row.discipline === "建筑";
  if (major === "安装") return row.major === "安装" || row.discipline === "安装";
  return row.major === major || row.discipline === major;
}

function priceLibraryRecordLabel(row) {
  return [
    row.item,
    row.spec,
    row.unit ? `${row.price || ""}/${row.unit}` : row.price,
    row.project,
    row.supplier,
    row.contractNo,
  ].filter(Boolean).join(" · ");
}

function enhancePriceLibraryFieldLabels() {
  const form = $("#priceLibraryForm");
  if (!form || form.dataset.labelsReady) return;
  const labels = {
    category: "类型",
    company: "分公司",
    major: "专业类别",
    discipline: "专业",
    trade: "工种",
    process: "工序",
    item: "分项名称/工作内容",
    spec: "规格型号/做法",
    unit: "单位",
    price: "含税单价",
    taxRate: "税率%",
    quantity: "工程量",
    amount: "金额/总价",
    region: "地区",
    projectType: "项目类型",
    project: "项目",
    supplier: "供应商/分包商",
    contractNo: "合同/结算编号",
    priceDate: "价格日期",
    source: "来源",
    remark: "付款条件",
  };
  Array.from(form.querySelectorAll(":scope > input, :scope > select")).forEach((field) => {
    const text = labels[field.name];
    if (!text) return;
    const wrapper = document.createElement("label");
    wrapper.className = "price-field";
    const name = document.createElement("span");
    name.className = "price-field-name";
    name.textContent = text;
    form.insertBefore(wrapper, field);
    wrapper.appendChild(name);
    wrapper.appendChild(field);
  });
  form.dataset.labelsReady = "1";
}

function matchedPriceLibraryMaintenanceRows() {
  const keyword = ($("#priceLibraryEditSearch")?.value || "").trim().toLowerCase();
  const listKeyword = ($("#priceLibraryListKeyword")?.value || "").trim().toLowerCase();
  const rows = normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []);
  return rows.filter((row) => {
    const text = [
      row.item, row.spec, row.unit, row.project, row.supplier, row.contractNo, row.company, row.region,
      row.trade, row.process, row.source, row.remark,
    ].join(" ").toLowerCase();
    if (keyword && !text.includes(keyword)) return false;
    if (listKeyword && !text.includes(listKeyword)) return false;
    return true;
  });
}

function setPriceLibraryEditListOpen(open) {
  state.priceLibraryEditListOpen = Boolean(open);
  const list = $("#priceLibraryEditList");
  if (list) list.hidden = !state.priceLibraryEditListOpen;
}

function togglePriceLibraryEditList() {
  setPriceLibraryEditListOpen(!state.priceLibraryEditListOpen);
  if (state.priceLibraryEditListOpen) renderPriceLibraryEditPicker();
}

function renderPriceLibraryEditPicker() {
  const list = $("#priceLibraryEditList");
  if (!list) return;
  list.hidden = !state.priceLibraryEditListOpen;
  const rows = normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []);
  const matched = matchedPriceLibraryMaintenanceRows();
  const filtered = matched.slice(0, 80);
  state.selectedPriceLibraryIds = new Set([...state.selectedPriceLibraryIds].filter((id) => {
    return rows.some((row) => row.id === id);
  }));
  updatePriceLibrarySelectionActions();
  if (!filtered.length) {
    list.innerHTML = `<div class="price-edit-empty">未找到匹配记录</div>`;
    return;
  }
  const visibleIds = new Set(filtered.map((row) => row.id));
  const selectedCount = state.selectedPriceLibraryIds.size;
  list.innerHTML = filtered.map((row) => {
    const checked = state.selectedPriceLibraryIds.has(row.id) || state.editingPriceLibraryId === row.id;
    return `
      <label class="price-edit-option${state.editingPriceLibraryId === row.id ? " active" : ""}">
        <input type="checkbox" data-price-edit-check="${escapeAttr(row.id)}" ${checked ? "checked" : ""}>
        <span>${escapeHtml(priceLibraryRecordLabel(row))}</span>
      </label>
    `;
  }).join("");
  if (selectedCount && ![...state.selectedPriceLibraryIds].some((id) => visibleIds.has(id))) {
    list.insertAdjacentHTML("afterbegin", `<div class="price-edit-empty">已选择 ${selectedCount} 条，当前搜索结果未显示</div>`);
  }
  if (matched.length > filtered.length) {
    list.insertAdjacentHTML("beforeend", `<div class="price-edit-empty">当前显示前 ${filtered.length} 条，共匹配 ${matched.length} 条；点“全选”会选中全部匹配记录。</div>`);
  }
}

function updatePriceLibrarySelectionActions() {
  const deleteButton = $("#priceLibraryDeleteSelectedBtn");
  if (!deleteButton) return;
  const count = state.selectedPriceLibraryIds.size || (state.editingPriceLibraryId ? 1 : 0);
  deleteButton.hidden = !count;
  deleteButton.textContent = count > 1 ? `删除选中 ${count} 条` : "删除选中记录";
}

function syncPriceLibrarySelectionFromCheckbox(id, checked) {
  if (checked) state.selectedPriceLibraryIds.add(id);
  else state.selectedPriceLibraryIds.delete(id);
  const ids = [...state.selectedPriceLibraryIds];
  if (ids.length === 1) {
    editPriceLibraryRow(ids[0]);
    return;
  }
  state.editingPriceLibraryId = "";
  const form = $("#priceLibraryForm");
  form?.reset();
  if (form) form.hidden = true;
  updatePriceLibrarySelectionActions();
  renderPriceLibraryEditPicker();
}

function selectVisiblePriceLibraryRows() {
  matchedPriceLibraryMaintenanceRows().forEach((row) => {
    state.selectedPriceLibraryIds.add(row.id);
  });
  hidePriceLibraryMaintenanceForm({ keepSelection: true });
  updatePriceLibrarySelectionActions();
  renderPriceLibraryEditPicker();
}

function clearPriceLibrarySelection() {
  state.selectedPriceLibraryIds.clear();
  hidePriceLibraryMaintenanceForm();
  renderPriceLibraryEditPicker();
}

function priceLibraryAnalysisBaseRows(rows) {
  const major = $("#priceLibraryMajorDisplayFilter")?.value || "";
  const projectType = $("#priceLibraryProjectTypeDisplayFilter")?.value || "";
  return (rows || []).filter((row) => {
    if (!priceLibraryMajorMatches(row, major)) return false;
    if (row.projectType && !isValidPriceLibraryProjectType(row.projectType)) return false;
    if (projectType && row.projectType !== projectType) return false;
    return Number(row.price) > 0;
  });
}

function priceLibraryAnalysisName(row) {
  return row.item || row.process || row.trade || "未命名分项";
}

function buildPriceLibraryAnalysisTargets(rows) {
  const groups = new Map();
  priceLibraryAnalysisBaseRows(rows).forEach((row) => {
    const name = priceLibraryAnalysisName(row);
    const unit = row.unit || "";
    const key = [row.category || "", row.discipline || "", row.trade || "", name, unit].join("||");
    if (!groups.has(key)) {
      groups.set(key, { key, name, unit, category: row.category || "", discipline: row.discipline || "", trade: row.trade || "", rows: [] });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()]
    .map((target) => {
      const months = new Set(target.rows.map((row) => String(row.priceDate || "").slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)));
      const companies = new Set(target.rows.map((row) => row.company).filter(Boolean));
      const prices = target.rows.map((row) => Number(row.price)).filter((price) => Number.isFinite(price) && price > 0);
      return {
        ...target,
        records: prices.length,
        months: months.size,
        companies: companies.size,
        avgPrice: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0,
      };
    })
    .filter((target) => target.records > 0)
    .sort((a, b) => (b.months - a.months) || (b.records - a.records) || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 80);
}

function renderPriceLibraryAnalysisFilters(rows) {
  const select = $("#priceLibraryAnalysisTargetFilter");
  if (!select) return;
  const current = select.value || "";
  const targets = buildPriceLibraryAnalysisTargets(rows);
  state.priceLibraryAnalysisTargets = targets;
  select.innerHTML = [
    `<option value="">自动选择主要工序</option>`,
    ...targets.map((target) => {
      const unit = target.unit ? `/${target.unit}` : "";
      const meta = `${target.records}条${target.months ? `，${target.months}个月` : ""}${target.companies ? `，${target.companies}个分公司` : ""}`;
      return `<option value="${escapeAttr(target.key)}">${escapeHtml(`${target.name}${unit}（${meta}）`)}</option>`;
    }),
  ].join("");
  if (current && targets.some((target) => target.key === current)) select.value = current;
}

function selectedPriceLibraryAnalysisTarget() {
  const selected = $("#priceLibraryAnalysisTargetFilter")?.value || "";
  if (selected) return state.priceLibraryAnalysisTargets.find((target) => target.key === selected) || null;
  return state.priceLibraryAnalysisTargets.find((target) => target.months >= 2 && target.records >= 3) || state.priceLibraryAnalysisTargets[0] || null;
}

function renderPriceLibraryAnalysisCharts(rows) {
  if (!state.priceLibraryAnalysisTargets.length) renderPriceLibraryAnalysisFilters(rows);
  const target = selectedPriceLibraryAnalysisTarget();
  if (!target) {
    renderPriceLibraryTrend([], null);
    renderPriceLibraryCompanyChart([], null);
    return;
  }
  const trendMap = new Map();
  const companyMap = new Map();
  target.rows.forEach((row) => {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const month = String(row.priceDate || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      if (!trendMap.has(month)) trendMap.set(month, []);
      trendMap.get(month).push(price);
    }
    const company = row.company || "未填分公司";
    if (!companyMap.has(company)) companyMap.set(company, []);
    companyMap.get(company).push(price);
  });
  const trendRows = [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, prices]) => ({
    month,
    avgPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    records: prices.length,
  })).slice(-24);
  const companyRows = [...companyMap.entries()].map(([company, prices]) => ({
    company,
    avgPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    records: prices.length,
  })).sort((a, b) => {
    const leftIndex = riskLevelCompanySortIndex(a.company);
    const rightIndex = riskLevelCompanySortIndex(b.company);
    return leftIndex - rightIndex || String(a.company || "").localeCompare(String(b.company || ""), "zh-Hans-CN") || b.records - a.records;
  }).slice(0, 12);
  renderPriceLibraryTrend(trendRows, target);
  renderPriceLibraryCompanyChart(companyRows, target);
}

function priceLibraryAnalysisLabel(target) {
  if (!target) return "";
  const unit = target.unit ? `/${target.unit}` : "";
  return `${target.name}${unit}，${target.records}条，${target.months}个月，${target.companies}个分公司`;
}

function renderPriceLibraryTrend(rows, target = null) {
  const container = $("#priceLibraryTrendChart");
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-chart">${target ? "当前工序暂无可形成走势的月度价格数据。" : "请选择有价格记录的主要工序。"}</div>`;
    return;
  }
  const width = 520;
  const height = 220;
  const left = 52;
  const right = 18;
  const top = 20;
  const bottom = 42;
  const values = rows.map((row) => Number(row.avgPrice) || 0);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.02, 1);
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const span = Math.max(max - min, 1);
  const points = rows.map((row, index) => {
    const x = left + ((width - left - right) * index) / Math.max(rows.length - 1, 1);
    const y = height - bottom - (((Number(row.avgPrice) || 0) - min) / span) * (height - top - bottom);
    return { ...row, x, y };
  });
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labels = points
    .filter((_point, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0)
    .map((point) => `<text x="${point.x - 18}" y="${height - 14}">${escapeHtml(point.month)}</text>`)
    .join("");
  container.innerHTML = `
    <div class="price-chart-note">${escapeHtml(priceLibraryAnalysisLabel(target))}</div>
    <svg class="price-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="价格走势">
      <line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line>
      <line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
      <text x="8" y="${top + 6}">${formatMoney(max)}</text>
      <text x="8" y="${height - bottom}">${formatMoney(min)}</text>
      <polyline points="${path}"></polyline>
      ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.month)} 均价 ${formatMoney(point.avgPrice)}，${point.records} 条</title></circle>`).join("")}
      ${labels}
    </svg>
  `;
}

function renderPriceLibraryCompanyChart(rows, target = null) {
  const container = $("#priceLibraryCompanyChart");
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-chart">${target ? "当前工序暂无可对比的分公司价格数据。" : "请选择有价格记录的主要工序。"}</div>`;
    return;
  }
  const list = rows.slice(0, 10);
  const max = Math.max(...list.map((row) => Number(row.avgPrice) || 0), 1);
  container.innerHTML = `
    <div class="price-chart-note">${escapeHtml(priceLibraryAnalysisLabel(target))}</div>
    <div class="price-company-bars">
      ${list.map((row) => {
        const width = Math.max(4, ((Number(row.avgPrice) || 0) / max) * 100);
        return `
          <div class="price-company-row">
            <span>${escapeHtml(row.company)}</span>
            <div><i style="--value:${width}%"></i></div>
            <strong title="最低 ${formatMoney(row.minPrice)}，最高 ${formatMoney(row.maxPrice)}，${row.records} 条">${formatMoney(row.avgPrice)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

async function createPriceLibraryRow(form) {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  if (payload.taxRate) payload.taxRate = Number(payload.taxRate) / 100;
  await api("/api/price-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  hidePriceLibraryMaintenanceForm();
  toast("价格记录已入库。");
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

function setPriceLibraryEditMode(id = "") {
  state.editingPriceLibraryId = id;
  const form = $("#priceLibraryForm");
  if (!form) return;
  const button = form.querySelector("button[type='submit']");
  const cancel = $("#priceLibraryCancelEditBtn");
  form.hidden = false;
  if (button) button.textContent = id ? "保存修改" : "新增入库";
  if (cancel) cancel.textContent = id ? "收起" : "取消新增";
  if (id) state.selectedPriceLibraryIds = new Set([id]);
  updatePriceLibrarySelectionActions();
  renderPriceLibraryEditPicker();
}

function hidePriceLibraryMaintenanceForm(options = {}) {
  const form = $("#priceLibraryForm");
  form?.reset();
  if (form) form.hidden = true;
  state.editingPriceLibraryId = "";
  if (!options.keepSelection) state.selectedPriceLibraryIds.clear();
  updatePriceLibrarySelectionActions();
}

function editPriceLibraryRow(id) {
  const row = (state.priceLibrary?.rows || []).find((item) => item.id === id);
  const form = $("#priceLibraryForm");
  if (!row || !form) {
    toast("未找到要修改的价格记录。");
    return;
  }
  const panel = form.closest(".price-maintenance-panel");
  if (panel) panel.open = true;
  [
    "category", "company", "major", "discipline", "trade", "process", "item", "spec", "unit", "price", "region",
    "projectType", "project", "supplier", "contractNo", "priceDate", "source", "remark",
  ].forEach((name) => {
    if (form.elements[name]) form.elements[name].value = row[name] ?? "";
  });
  if (form.elements.taxRate) form.elements.taxRate.value = row.taxRate ? Number(row.taxRate) * 100 : "";
  if (form.elements.quantity) form.elements.quantity.value = row.quantity || "";
  if (form.elements.amount) form.elements.amount.value = row.amount || "";
  setPriceLibraryEditMode(id);
}

function cancelPriceLibraryEdit() {
  hidePriceLibraryMaintenanceForm();
  renderPriceLibraryEditPicker();
}

async function updatePriceLibraryRow(form) {
  const id = state.editingPriceLibraryId;
  if (!id) return createPriceLibraryRow(form);
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  if (payload.taxRate) payload.taxRate = Number(payload.taxRate) / 100;
  await api(`/api/price-library?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  hidePriceLibraryMaintenanceForm();
  toast("价格记录已修改。");
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function importPriceLibrary(form) {
  const result = await api("/api/price-library-import", { method: "POST", body: new FormData(form) });
  form.reset();
  const sheetText = result.sheetCount ? `，识别 ${result.sheetCount} 个工作表` : "";
  toast(`已处理 ${result.imported || 0} 条价格记录，新增 ${result.inserted || 0} 条，补全 ${result.updated || 0} 条${sheetText}。`);
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function importPmLaborPriceLibrary() {
  const result = await api("/api/price-library-import-pm-labor", { method: "POST" });
  toast(`已从劳务价格抓取成果处理 ${result.imported || 0} 条，新增 ${result.inserted || 0} 条，补全 ${result.updated || 0} 条。`);
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function importPmProfessionalPriceLibrary() {
  const result = await api("/api/price-library-import-pm-professional", { method: "POST" });
  toast(`已从专业分包价格抓取成果处理 ${result.imported || 0} 条，新增 ${result.inserted || 0} 条，补全 ${result.updated || 0} 条。`);
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function autoExtractPriceLibrary() {
  const status = $("#priceLibraryAutoExtractStatus");
  const result = await api("/api/price-library-auto-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: $("#priceLibraryAutoExtractPlatform")?.value || "all",
      labor: $("#priceLibraryAutoExtractLabor")?.checked !== false,
      professional: $("#priceLibraryAutoExtractProfessional")?.checked !== false,
    }),
  });
  const platformText = (result.platforms || [])
    .map((item) => item.message || `${item.name || item.platform}：${item.imported || 0} 条`)
    .join("；");
  const message = `自动提取处理 ${result.imported || 0} 条，新增 ${result.inserted || 0} 条，补全 ${result.updated || 0} 条。${platformText ? ` ${platformText}` : ""}`;
  if (status) status.textContent = message;
  toast(message);
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function downloadPriceLibraryTemplate() {
  const blob = await api("/api/price-library-template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "分包价格库_标准导入模板.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPriceLibrary() {
  const query = priceLibraryQueryString();
  const blob = await api(`/api/price-library-export${query ? `?${query}` : ""}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  link.download = `分包价格库_${stamp}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deletePriceLibraryRow(id) {
  await api(`/api/price-library?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (state.editingPriceLibraryId === id) hidePriceLibraryMaintenanceForm();
  toast("价格记录已删除。");
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

async function deleteSelectedPriceLibraryRows() {
  const ids = [...state.selectedPriceLibraryIds];
  if (!ids.length && state.editingPriceLibraryId) ids.push(state.editingPriceLibraryId);
  if (!ids.length) {
    toast("请先勾选要删除的价格记录。");
    return;
  }
  const ok = window.confirm(ids.length > 1 ? `确定删除选中的 ${ids.length} 条价格记录吗？` : "确定删除这条价格记录吗？");
  if (!ok) return;
  for (const id of ids) {
    await api(`/api/price-library?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  hidePriceLibraryMaintenanceForm();
  toast(ids.length > 1 ? `已删除 ${ids.length} 条价格记录。` : "价格记录已删除。");
  await refreshPriceLibrary();
  try {
    await refreshWorkbenchProgress();
  } catch (_err) {}
}

function renderPluginList() {
  $("#pluginList").innerHTML = state.reportTypes.map((plugin) => `
    <article class="interface-card">
      <h3>${escapeHtml(plugin.name)}</h3>
      <p>${escapeHtml(plugin.description)}</p>
      <code>parse(file) -> validate(rows) -> aggregate(rows) -> export(result)</code>
    </article>
  `).join("");
}

function renderTable(table, rows, formatters = {}, options = {}) {
  if (!rows.length) {
    table.innerHTML = "<thead><tr><th>暂无数据</th></tr></thead><tbody></tbody>";
    return;
  }
  const detailKeys = new Set(options.detailKeys || []);
  const keys = Object.keys(rows[0]).filter((key) => key !== "id" && !key.startsWith("_"));
  table.innerHTML = `
    <thead><tr>${keys.map((key) => `<th>${columnName(key)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `
        <tr>
          ${keys.map((key) => {
            const value = row[key] ?? "";
            const html = formatters[key] ? formatters[key](value, row) : escapeHtml(formatNumber(value));
            const label = columnName(key).replace(/<br\s*\/?>/gi, " ");
            const text = formatNumber(value);
            const textAttr = escapeAttr(text);
            const canOpenDetail = detailKeys.has(key) && String(text).trim();
            const attrs = canOpenDetail
              ? ` class="cell-expand" title="${textAttr}" data-cell-detail="1" data-cell-label="${escapeAttr(label)}" data-cell-value="${textAttr}"`
              : ` title="${textAttr}"`;
            return `<td${attrs}>${html}</td>`;
          }).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
}

function columnName(key) {
  const monthStatusMatch = String(key).match(/^monthStatus_(\d{4})_(\d{2})$/);
  if (monthStatusMatch) return `${Number(monthStatusMatch[2])}月`;
  const names = {
    company: "分公司",
    projects: "项目数",
    in_progress_projects: "在建",
    completed_projects: "竣工",
    settled_projects: "已定案",
    unsettled_projects: "未定案",
    contract_amount: "合同价款",
    settled_amount: "定案造价",
    submitted_amount: "送审造价",
    A: "A级",
    B: "B级",
    C: "C级",
    D: "D级",
    uploadedAt: "上传时间",
    reportType: "报表类型",
    period: "期次",
    filename: "文件名",
    status: "状态",
    rows: "明细数",
    message: "校验信息",
    createdAt: "登记时间",
    issueType: "问题类型",
    description: "问题说明",
    name: "指令名称",
    startDate: "开始时间",
    endDate: "结束时间",
    keyword: "材料关键词",
    comparisonRows: "比对项",
    downloadContent: "下载内容",
    hitType: "结果类型",
    riskLevel: "风险等级",
    legalRep: "法人",
    updatedAt: "更新时间",
    sourcePlatform: "数据来源",
    sourceCount: "来源数",
    query: "查询对象",
    estimatedAt: "预计完成时间",
    resultStatus: "结果状态",
    coverageStatus: "穿透状态",
    completedDepth: "完成层级",
    unexpandedCount: "未展开节点",
    jobPath: "任务文件",
    reportCompany: "单位",
    monthStatus: "6月状态",
    reportContract: "合同额(万元)",
    reportBudget: "累计税前预算成本(万元)",
    reportActual: "累计税前实际成本(万元)",
    reportReduction: "税前降低额(万元)",
    reportDutyRate: "责任书目标降低率(%)",
    reportActualRate: "实际降低率(%)",
    reportCostCheck: "详情",
    reportProject: "工程名称",
    reportMajor: "专业",
    reportManager: "项目经理",
    level: "预警等级",
    project: "项目名称",
    major: "专业",
    hsdx: "核算对象",
    rule: "触发规则",
    amount: "影响金额",
    index: "序号",
    sampleIndex: "序号",
    category: "类型",
    typeLibrary: "类型库<br>（下拉选择）",
    subcontractItem: "分包项名称",
    measureUnit: "计量单位",
    actualPurchasePrice: "实际采购价",
    controlPrice: "实际采购价",
    paymentPeriod: "付款周期",
    paymentRatio: "付款比例",
    paymentMethod: "付款方式",
    riskLevel: "房源风险等级",
    engineeringType: "工程类型",
    height: "层高",
    tenderDate: "定标日期",
    baseCompany: "基层单位",
    projectDept: "项目部",
    position: "施工部位",
    workScope: "施工内容",
    constructionContent: "施工内容",
    paymentCondition: "付款条件",
    remark: "付款条件",
    item: "分项名称",
    major: "专业类别",
    discipline: "专业",
    trade: "工种",
    process: "工序",
    spec: "规格/做法",
    unit: "单位",
    price: "单价",
    taxRate: "税率",
    quantity: "工程量",
    region: "地区",
    projectType: "项目类型",
    supplier: "供应商",
    contractNo: "合同/结算编号",
    priceDate: "价格日期",
    source: "来源",
    avgPrice: "平均价",
    lowPrice: "最低价",
    highPrice: "最高价",
    minPrice: "最低价",
    maxPrice: "最高价",
    spreadRate: "价差率",
    lowSupplier: "低价供应商",
    highSupplier: "高价供应商",
    supplierCompare: "供应商",
    records: "记录数",
    score: "评分",
    contract: "合同额",
    budget: "预算成本",
    actual: "实际成本",
    reduction: "降低额",
    reduceDuty: "责任降低率",
    reduceActual: "实际降低率",
    manager: "项目经理",
    owner: "责任人",
    dueDate: "要求完成",
    action: "操作",
  };
  return names[key] || key;
}

function reportName(key) {
  return state.reportTypes.find((item) => item.key === key)?.name || key;
}

function detectedCompany(upload) {
  return upload.rows?.find((row) => row.company)?.company || "";
}

function formatNumber(value) {
  if (typeof value !== "number") return value;
  return Number.isInteger(value) ? String(value) : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${(number * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

function formatMoney(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const digits = number !== 0 && Math.abs(number) < 0.01 ? 4 : 2;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatMoneyOrMissing(value) {
  const text = formatMoney(value);
  return text || `<span class="missing-cell">未取到</span>`;
}

function formatPercentValue(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  return `${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
}

function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
}

function openCellDetail(cell) {
  const value = cell?.dataset?.cellValue || "";
  const label = cell?.dataset?.cellLabel || "完整内容";
  if (!value) return;
  const title = $("#cellDetailTitle");
  const body = $("#cellDetailBody");
  if (title) title.textContent = label;
  if (body) body.textContent = value;
  openModal("cellDetailModal");
}

async function deleteUploadById(id) {
  if (!id) return;
  await api(`/api/uploads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  toast("已删除上传记录。");
  await refreshAll();
}

async function deleteIssue(id) {
  if (!id) return;
  await api(`/api/issues?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  toast("已删除问题记录。");
  await refreshIssues();
}

async function deleteCompany(company) {
  const type = $("#reportFilter").value;
  const period = $("#periodFilter").value;
  await api(`/api/uploads?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}&company=${encodeURIComponent(company)}`, { method: "DELETE" });
  toast("已删除该单位本期上传记录。");
  await refreshAll();
}

async function clearCurrentSelection() {
  const type = $("#reportFilter").value;
  const period = $("#periodFilter").value;
  await api(`/api/uploads?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`, { method: "DELETE" });
  toast("已清空当前报表本期上传记录。");
  await refreshAll();
}

async function clearUploadHistory() {
  await api("/api/uploads?scope=all", { method: "DELETE" });
  toast("已清空全部上传记录。");
  await refreshAll();
}

async function createIssue(form) {
  const payload = {
    reportType: $("#reportFilter").value,
    period: $("#periodFilter").value,
    issueType: form.issueType.value,
    company: form.company.value,
    description: form.description.value,
  };
  await api("/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  form.reset();
  toast("问题已登记。");
  await refreshIssues();
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      activateView(button);
    });
  });

  document.addEventListener("click", async (event) => {
    const closeId = event.target?.dataset?.closeModal;
    const id = event.target?.dataset?.deleteId;
    const company = event.target?.dataset?.deleteCompany;
    const issueId = event.target?.dataset?.deleteIssue;
    const missingCompany = event.target?.dataset?.missingCompany;
    const jumpView = event.target?.closest?.("[data-jump-view]")?.dataset?.jumpView;
    const materialTaskId = event.target?.dataset?.downloadMaterialTask;
    const deleteMaterialTaskId = event.target?.dataset?.deleteMaterialTask;
    const editPriceRowId = event.target?.dataset?.editPriceRow;
    const deletePriceRowId = event.target?.dataset?.deletePriceRow;
    const blacklistTemplateId = event.target?.dataset?.blacklistTemplate;
    const relationPenetrate = event.target?.dataset?.relationPenetrate;
    const pmWarningPlatform = event.target?.dataset?.pmWarningPlatform;
    const interactive = event.target?.closest?.("button,a,input,select,textarea,label");
    const cell = interactive ? null : event.target?.closest?.("[data-cell-detail='1']");
    try {
      if (cell) {
        openCellDetail(cell);
        return;
      }
      if (jumpView) activateView(document.querySelector(`.nav-item[data-view="${jumpView}"]`));
      if (pmWarningPlatform) {
        await setPmWarningPlatform(pmWarningPlatform);
      }
      if (closeId) closeModal(closeId);
      if (id) await deleteUploadById(id);
      if (company) await deleteCompany(company);
      if (issueId) await deleteIssue(issueId);
      if (materialTaskId) await downloadMaterialTask(materialTaskId);
      if (deleteMaterialTaskId) await deleteMaterialTask(deleteMaterialTaskId);
      if (editPriceRowId) editPriceLibraryRow(editPriceRowId);
      if (deletePriceRowId) await deletePriceLibraryRow(deletePriceRowId);
      if (blacklistTemplateId) await createBlacklistResultTemplate(blacklistTemplateId);
      if (relationPenetrate) await createBlacklistJobForQuery(relationPenetrate);
      if (missingCompany) {
        $("#issueCompany").value = missingCompany;
        document.querySelector("[name='issueType']").value = "公司报表未上传";
        document.querySelector("[name='description']").value = `${missingCompany}本期报表未上传。`;
      }
    } catch (err) {
      toast(err.message);
    }
  });

  $("#reportFilter").addEventListener("change", async () => {
    updateExportButtonLabel();
    await loadSummary();
    if (!$("#issueModal").classList.contains("hidden")) await refreshIssues();
  });
  $("#periodFilter").addEventListener("change", async () => {
    $("#period").value = $("#periodFilter").value;
    if (document.body.classList.contains("pm-warning-mode")) {
      await refreshPmWarningDataFromServer("红蓝预警月份已切换。");
      return;
    }
    await loadSummary();
    if (!$("#issueModal").classList.contains("hidden")) await refreshIssues();
  });
  $("#period").addEventListener("change", () => {
    $("#periodFilter").value = $("#period").value;
  });
  $("#refreshBtn").addEventListener("click", async () => {
    if (document.body.classList.contains("pm-warning-mode")) {
      await refreshPmWarningDataFromServer("红蓝预警已从服务器重新加载。");
      return;
    }
    await refreshAll();
  });
  $("#issuesBtn").addEventListener("click", async () => {
    openModal("issueModal");
    await refreshIssues();
  });
  $("#refreshIssuesBtn").addEventListener("click", refreshIssues);
  $("#refreshMaterialTasksBtn").addEventListener("click", async () => {
    try {
      await refreshMaterialTasks();
      continueMaterialTaskPollingIfNeeded({ delay: 1000 });
    } catch (err) {
      toast(err.message);
    }
  });
  $("#refreshMaterialTrendBtn").addEventListener("click", async () => {
    try {
      await refreshMaterialTrend();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#priceLibraryFilterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await refreshPriceLibrary();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#priceLibraryResetBtn")?.addEventListener("click", async () => {
    $("#priceLibraryFilterForm")?.reset();
    try {
      await refreshPriceLibrary();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#priceLibraryRefreshBtn")?.addEventListener("click", async () => {
    try {
      await refreshPriceLibrary();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#priceLibraryExportBtn")?.addEventListener("click", async () => {
    try {
      await exportPriceLibrary();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#priceLibraryCategoryDisplayFilter")?.addEventListener("change", () => {
    const rows = normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []);
    renderPriceLibraryDisplayFilters(rows);
    renderPriceLibrarySampleTable(rows);
    renderPriceLibraryAnalysisFilters(rows);
    renderPriceLibraryAnalysisCharts(rows);
  });
  $("#priceLibraryMajorDisplayFilter")?.addEventListener("change", () => {
    const rows = normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []);
    renderPriceLibraryDisplayFilters(rows);
    renderPriceLibrarySampleTable(rows);
    renderPriceLibraryAnalysisFilters(rows);
    renderPriceLibraryAnalysisCharts(rows);
  });
  $("#priceLibraryProjectTypeDisplayFilter")?.addEventListener("change", () => {
    const rows = normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []);
    renderPriceLibrarySampleTable(rows);
    renderPriceLibraryAnalysisFilters(rows);
    renderPriceLibraryAnalysisCharts(rows);
  });
  $("#priceLibraryAnalysisTargetFilter")?.addEventListener("change", () => {
    renderPriceLibraryAnalysisCharts(normalizePriceLibraryProjectFields(state.priceLibrary?.rows || []));
  });
  $("#priceLibraryCancelEditBtn")?.addEventListener("click", cancelPriceLibraryEdit);
  $("#priceLibraryEditSearch")?.addEventListener("input", () => {
    setPriceLibraryEditListOpen(true);
    renderPriceLibraryEditPicker();
  });
  $("#priceLibraryListKeyword")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePriceLibraryEditList();
  });
  $("#priceLibraryListKeyword")?.addEventListener("input", () => {
    setPriceLibraryEditListOpen(true);
    renderPriceLibraryEditPicker();
  });
  $("#priceLibraryEditList")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  $("#priceLibraryEditList")?.addEventListener("change", (event) => {
    const check = event.target.closest("[data-price-edit-check]");
    if (!check) return;
    syncPriceLibrarySelectionFromCheckbox(check.dataset.priceEditCheck, check.checked);
  });
  document.addEventListener("click", (event) => {
    const panel = event.target.closest?.(".price-maintenance-panel");
    if (!panel) setPriceLibraryEditListOpen(false);
  });
  $("#priceLibrarySelectAllBtn")?.addEventListener("click", selectVisiblePriceLibraryRows);
  $("#priceLibraryClearSelectBtn")?.addEventListener("click", clearPriceLibrarySelection);
  $("#priceLibraryNewBtn")?.addEventListener("click", () => {
    const form = $("#priceLibraryForm");
    const panel = form?.closest(".price-maintenance-panel");
    if (panel) panel.open = true;
    form?.reset();
    state.selectedPriceLibraryIds.clear();
    setPriceLibraryEditMode("");
  });
  $("#priceLibraryDeleteSelectedBtn")?.addEventListener("click", async () => {
    try {
      await deleteSelectedPriceLibraryRows();
    } catch (err) {
      toast(err.message);
    }
  });
  ["#pmWarningTopPlatformFilter", "#pmWarningCompanyFilter", "#pmWarningLevelFilter"].forEach((selector) => {
    const select = $(selector);
    if (select) select.addEventListener("change", () => {
      if (selector === "#pmWarningTopPlatformFilter") {
        setPmWarningPlatform(select.value).catch((err) => toast(err.message));
        return;
      }
      renderPmWarnings();
    });
  });
  $("#pmWarningStartBtn")?.addEventListener("click", () => {
    startPmWarningCapture(state.pmWarningCapturePlatform || "old-pm").catch((err) => toast(err.message));
  });
  $("#pmWarningExportBtn")?.addEventListener("click", exportPmWarnings);
  $("#pmWarningClearBtn")?.addEventListener("click", clearPmWarnings);
  $("#clearBtn").addEventListener("click", async () => {
    try {
      await clearCurrentSelection();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#clearUploadsBtn").addEventListener("click", async () => {
    try {
      await clearUploadHistory();
    } catch (err) {
      toast(err.message);
    }
  });

  $("#issueForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createIssue(event.currentTarget);
    } catch (err) {
      toast(err.message);
    }
  });

  $("#materialTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "抓数并建表中";
    try {
      await createMaterialTask(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "抓取源数据并由小程序建表";
    }
  });

  $("#materialImportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "导入中";
    try {
      await importMaterialTask(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "导入并建表";
    }
  });

  $("#priceLibraryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = state.editingPriceLibraryId ? "保存中" : "入库中";
    try {
      await updatePriceLibraryRow(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = state.editingPriceLibraryId ? "保存修改" : "入库";
    }
  });

  $("#priceLibraryImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "导入中";
    try {
      await importPriceLibrary(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "批量导入";
    }
  });

  $("#priceLibraryTemplateBtn")?.addEventListener("click", async () => {
    try {
      await downloadPriceLibraryTemplate();
    } catch (err) {
      toast(err.message);
    }
  });

  $("#priceLibraryAutoExtractBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "提取中";
    try {
      await autoExtractPriceLibrary();
    } catch (err) {
      toast(err.message);
      const status = $("#priceLibraryAutoExtractStatus");
      if (status) status.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = "一键自动提取";
    }
  });

  $("#priceLibraryImportPmLaborBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "导入中";
    try {
      await importPmLaborPriceLibrary();
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "导入劳务抓取结果";
    }
  });

  $("#priceLibraryImportPmProfessionalBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "导入中";
    try {
      await importPmProfessionalPriceLibrary();
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "导入专业分包抓取结果";
    }
  });

  $("#blacklistForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "查询中";
    try {
      await searchBlacklist(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "查询";
    }
  });

  $("#companyRelationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "判断中";
    try {
      await judgeCompanyRelation(form);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "判断关联";
    }
  });

  $("#blacklistExportBtn").addEventListener("click", async () => {
    try {
      await exportBlacklist();
    } catch (err) {
      toast(err.message);
    }
  });

  $("#blacklistCodexBtn").addEventListener("click", async () => {
    const button = $("#blacklistCodexBtn");
    button.disabled = true;
    button.textContent = "生成中";
    let ok = false;
    try {
      await createBlacklistCodexJob();
      ok = true;
      $("#blacklistJobsTable")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = ok ? "等待回写" : "天眼查穿透";
      if (ok) setTimeout(() => { button.textContent = "天眼查穿透"; }, 5000);
    }
  });

  $("#refreshBlacklistJobsBtn").addEventListener("click", async () => {
    try {
      await refreshBlacklistJobs();
    } catch (err) {
      toast(err.message);
    }
  });

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("reportType", $("#reportFilter").value);
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "校验中";
    try {
      const data = await api("/api/uploads", { method: "POST", body: formData });
      const records = Array.isArray(data) ? data : [data];
      $("#periodFilter").value = records[0]?.period || $("#periodFilter").value;
      const failed = records.filter((record) => (record.errors || []).length);
      toast(failed.length ? `${failed.length} 个文件校验失败，请查看上传记录。` : `已上传 ${records.length} 个文件，并纳入汇总。`);
      form.reset();
      $("#period").value = $("#periodFilter").value || currentPeriod();
      await refreshAll();
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "上传校验";
    }
  });

  $("#exportBtn").addEventListener("click", async () => {
    const type = $("#reportFilter").value;
    const period = $("#periodFilter").value;
    try {
      const blob = await api(`/api/export?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
      link.download = type === "settlement"
        ? `${reportName(type)}_${period || "全部"}_成果包_${stamp}.zip`
        : `${reportName(type)}_${period || "全部"}_汇总_${stamp}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message);
    }
  });

}

function updateExportButtonLabel() {
  const button = $("#exportBtn");
  if (!button) return;
  button.textContent = $("#reportFilter")?.value === "settlement" ? "导出成果包" : "导出 Excel";
}

enhancePriceLibraryFieldLabels();
bindEvents();
loadInitial().catch((err) => {
  setAppStatus(`部分功能未加载：${err.message}`, "error");
  toast(err.message);
});
