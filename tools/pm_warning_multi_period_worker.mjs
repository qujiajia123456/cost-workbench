import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!jobPath) throw new Error("missing PM warning job path");

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function updateJob(patch) {
  const job = readJson(jobPath, {});
  writeJson(jobPath, { ...job, ...patch, updatedAt: nowText() });
}

function periodWindow(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
  return [-2, -1, 0].map((offset) => {
    const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function statusFromProject(project) {
  const status = String(project.displayStatus || project.warningStatus || project.status || "").trim();
  if (status === "红色" || project.type === "red" || project.t === "ks") return "红色";
  if (status === "蓝色" || project.type === "blue" || project.t === "wwc") return "蓝色";
  return status;
}

function statusRank(status) {
  if (status === "红色") return 2;
  if (status === "蓝色") return 1;
  return 0;
}

function groupKey(project) {
  const projectName = project.name || project.projectName || project.pid || project.projectId || "";
  const hsdx = project.hsdx || project.hsdxName || project.major || project.hsdxid || project.hsdxId || "";
  return [
    clean(project.sourcePlatform || project.platform),
    clean(project.company || project.companyName),
    clean(projectName).toLowerCase(),
    clean(hsdx).toLowerCase(),
  ].join("|");
}

function summarizeUnion(projects, periods, latestTotals = {}) {
  const groups = new Map();
  for (const project of projects) {
    const key = groupKey(project);
    if (!groups.has(key)) groups.set(key, { company: project.company || project.companyName || "", rank: 0 });
    const group = groups.get(key);
    const statuses = project.monthlyStatuses || {};
    for (const period of periods) group.rank = Math.max(group.rank, statusRank(statuses[period]));
    group.rank = Math.max(group.rank, statusRank(statusFromProject(project)));
  }
  let red = 0;
  let blue = 0;
  for (const group of groups.values()) {
    if (group.rank >= 2) red += 1;
    else if (group.rank === 1) blue += 1;
  }
  const inProgress = Number(latestTotals.inProgress) || Number(latestTotals.total) || 0;
  return {
    ...latestTotals,
    red,
    blue,
    normal: inProgress ? Math.max(0, inProgress - red - blue) : Number(latestTotals.normal) || 0,
    detailProjects: groups.size,
  };
}

function summarizeListCompleteness(checks) {
  const rows = (checks || []).filter((check) => Number(check?.expected) > 0);
  const expected = rows.reduce((sum, check) => sum + (Number(check.expected) || 0), 0);
  const actual = rows.reduce((sum, check) => sum + (Number(check.actual) || 0), 0);
  const incompleteChecks = rows
    .filter((check) => (Number(check.expected) || 0) > (Number(check.actual) || 0))
    .map((check) => ({
      reportPeriod: check.reportPeriod || "",
      company: check.company || "",
      type: check.type || "",
      status: check.status || "",
      expected: Number(check.expected) || 0,
      actual: Number(check.actual) || 0,
      missing: Math.max(0, (Number(check.expected) || 0) - (Number(check.actual) || 0)),
      attempts: Number(check.attempts) || 1,
      message: check.message || "",
      sourcePlatform: check.sourcePlatform || platform,
    }));
  const missing = incompleteChecks.reduce((sum, check) => sum + check.missing, 0);
  return {
    ok: missing === 0,
    expected,
    actual,
    missing,
    checked: rows.length,
    incompleteCount: incompleteChecks.length,
    incompleteChecks: incompleteChecks.slice(0, 200),
  };
}

function runBigPmReasonConsistency(finalResultPath, period) {
  if (platform !== "big-pm" || process.env.PM_WARNING_BIG_PM_REASON_CHECK === "0") {
    return { ran: false, ok: true };
  }
  const scriptPath = path.join(root, "tools", "pm_warning_big_pm_reason_consistency_worker.mjs");
  if (!fs.existsSync(scriptPath)) {
    return { ran: false, ok: false, message: "大PM成本对比一致性校验脚本不存在" };
  }
  updateJob({
    status: "校验成本对比",
    message: "大PM抓数已完成，正在核对 项目成本完成情况审批表 与 成本对比分析 的金额、红蓝状态、原因分析及整改措施。",
  });
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      PM_WARNING_RESULT_PATH: finalResultPath,
      PM_WARNING_REASON_OUTPUT_PATH: finalResultPath,
      PM_WARNING_PERIOD: period || "",
    },
    encoding: "utf8",
    timeout: 3600000,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status === 0) {
    const checkedData = readJson(finalResultPath, {});
    return { ran: true, ok: true, summary: checkedData.reasonConsistency || null };
  }
  const message = child.stderr || child.stdout || `exit ${child.status}`;
  const checkedData = readJson(finalResultPath, {});
  checkedData.reasonConsistency = {
    sourcePlatform: "big-pm",
    checkedAt: new Date().toISOString(),
    ok: false,
    error: message,
    checks: [],
    checked: 0,
    conflicts: 0,
    reviews: 0,
    skippedMissingPath: 0,
  };
  writeJson(finalResultPath, checkedData);
  return { ran: true, ok: false, message };
}

const parentJob = readJson(jobPath, {});
const platform = parentJob.platform || "old-pm";
const periods = Array.isArray(parentJob.periods) && parentJob.periods.length
  ? parentJob.periods
  : String(process.env.PM_WARNING_PERIODS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const reportPeriods = periods.length ? periods : periodWindow(parentJob.period);
const baseWorker = process.env.PM_WARNING_BASE_WORKER_SCRIPT
  || path.join(root, "tools", platform === "big-pm" ? "pm_warning_big_pm_summary_worker.mjs" : "pm_warning_old_pm_worker.mjs");
const finalResultPath = parentJob.resultPath || path.join(root, "data", "pm_warning_results", `latest_${platform}.json`);
const scratchDir = path.join(root, "data", "pm_warning_results", "period_runs");
const allProjects = [];
const allListChecks = [];
let latestData = null;
let latestPeriod = "";

try {
  for (const period of reportPeriods) {
    const childId = `${parentJob.id || "pm-warning"}_${period.replace("-", "")}`;
    const childResultPath = path.join(scratchDir, `${childId}_${platform}.json`);
    const childJobPath = path.join(scratchDir, `${childId}.json`);
    const childJob = {
      ...parentJob,
      id: childId,
      parentId: parentJob.id || "",
      period,
      periods: [period],
      resultPath: childResultPath,
      summaryPath: path.join(scratchDir, `${childId}_summary.csv`),
      detailPath: path.join(scratchDir, `${childId}_projects.csv`),
    };
    writeJson(childJobPath, childJob);
    updateJob({
      status: "抓取中",
      message: `${period} 红蓝预警抓取中（${reportPeriods.indexOf(period) + 1}/${reportPeriods.length}）`,
    });
    const child = spawnSync(process.execPath, [baseWorker, childJobPath], {
      cwd: root,
      env: {
        ...process.env,
        PM_WARNING_PERIOD: period,
        PM_WARNING_PERIODS: period,
      },
      encoding: "utf8",
      timeout: 3600000,
    });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.status !== 0) {
      throw new Error(`${period} 抓取失败：${child.stderr || child.stdout || `exit ${child.status}`}`);
    }
    const data = readJson(childResultPath, {});
    latestData = data;
    latestPeriod = period;
    for (const project of data.projects || []) {
      const status = statusFromProject(project);
      allProjects.push({
        ...project,
        reportPeriod: period,
        monthlyStatuses: {
          ...(project.monthlyStatuses || {}),
          [period]: status,
        },
      });
    }
    for (const check of data.listChecks || []) {
      allListChecks.push({ ...check, reportPeriod: period });
    }
  }

  const captureCompleteness = summarizeListCompleteness(allListChecks);
  const finalTotals = {
    ...summarizeUnion(allProjects, reportPeriods, (latestData || {}).totals || {}),
    missingListRows: captureCompleteness.missing,
  };
  const finalData = {
    ...(latestData || {}),
    source: {
      ...((latestData || {}).source || {}),
      reportPeriod: parentJob.period || latestPeriod,
      reportPeriods,
      displaySource: `${platform === "big-pm" ? "大PM平台" : "四版平台"}三个月红蓝预警合并`,
    },
    reportPeriod: parentJob.period || latestPeriod,
    reportPeriods,
    listChecks: allListChecks,
    projects: allProjects.map((project, index) => ({ ...project, sequence: index + 1 })),
    totals: finalTotals,
    detailHealth: {
      ...((latestData || {}).detailHealth || {}),
      expectedWarningDetails: captureCompleteness.expected,
      capturedWarningDetails: captureCompleteness.actual,
      missingListRows: captureCompleteness.missing,
      incompleteListChecks: captureCompleteness.incompleteCount,
    },
    captureCompleteness: {
      sourcePlatform: platform,
      reportPeriod: parentJob.period || latestPeriod,
      reportPeriods,
      ...captureCompleteness,
    },
    capture: {
      ...((latestData || {}).capture || {}),
      platform,
      status: "completed",
      completenessOk: captureCompleteness.ok,
      missingListRows: captureCompleteness.missing,
      period: parentJob.period || latestPeriod,
      periods: reportPeriods,
      capturedAt: new Date().toISOString(),
    },
  };
  writeJson(finalResultPath, finalData);
  const reasonCheck = runBigPmReasonConsistency(finalResultPath, parentJob.period || latestPeriod);
  const completedData = readJson(finalResultPath, finalData);
  const reasonSummary = completedData.reasonConsistency || reasonCheck.summary || null;
  const completionMessage = `${platform === "big-pm" ? "大PM平台" : "四版平台"}三个月红蓝预警抓取完成：${reportPeriods.join("、")}`
    + (platform === "big-pm" && reasonSummary?.checked != null
      ? `；源头校验 ${reasonSummary.checked} 项，冲突 ${reasonSummary.conflicts || 0} 项，待复核 ${reasonSummary.reviews || 0} 项，缺路径 ${reasonSummary.skippedMissingPath || 0} 项。`
      : "")
    + (platform === "big-pm" && reasonCheck.ran && !reasonCheck.ok
      ? `；源头校验失败：${reasonCheck.message || "未知错误"}`
      : "");
  updateJob({
    status: "已完成",
    message: completionMessage,
    resultPath: finalResultPath,
    totals: completedData.totals || finalData.totals,
    detailHealth: completedData.detailHealth || finalData.detailHealth,
    captureCompleteness: completedData.captureCompleteness || finalData.captureCompleteness,
    reasonConsistency: reasonSummary,
    completedAt: nowText(),
  });
} catch (error) {
  updateJob({
    status: "失败",
    message: error?.message || String(error),
    failedAt: nowText(),
  });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
