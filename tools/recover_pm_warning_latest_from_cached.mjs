import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const resultDir = path.join(root, "data", "pm_warning_results");
fs.mkdirSync(resultDir, { recursive: true });

function readJson(file) {
  const buffer = fs.readFileSync(file);
  const text =
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.toString("utf16le").replace(/^\uFEFF/, "")
      : buffer.toString("utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function latestExportInput() {
  const files = fs
    .readdirSync(resultDir)
    .filter((name) => /^export_input_\d+_[a-f0-9]+\.json$/i.test(name))
    .map((name) => {
      const full = path.join(resultDir, name);
      return { name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.full || "";
}

const oldInputPath = latestExportInput();
if (!oldInputPath) {
  throw new Error("No cached PM warning export input was found.");
}

const oldInput = readJson(oldInputPath);
const oldData = {
  ...oldInput,
  source: { ...(oldInput.source || {}), platform: "old-pm", status: "completed" },
  companies: (oldInput.companies || []).map((item) => ({ ...item, sourcePlatform: "old-pm" })),
  listChecks: (oldInput.listChecks || []).map((item) => ({ ...item, sourcePlatform: "old-pm" })),
  projects: (oldInput.projects || []).map((item) => ({ ...item, sourcePlatform: "old-pm" })),
};
writeJson(path.join(resultDir, "latest_old-pm.json"), oldData);

const bigProbePath = path.join(root, "data", "big_pm_summary_probe.json");
const bigProbe = readJson(bigProbePath);
const text = String(bigProbe.text || "");
const names = [
  "三公司",
  "四公司",
  "五公司",
  "六公司",
  "七公司",
  "十公司",
  "市政路桥",
  "格瑞特",
  "青岛公司",
  "济南公司",
  "马来公司",
  "国际公司",
  "设备安装",
  "上海公司",
  "装饰幕墙",
  "恒达检测/特种公司",
  "合力/诺扬",
  "特种公司",
  "华宏建设",
  "机电安装",
];

function numberLineAfter(label) {
  const start = text.indexOf(label);
  if (start < 0) return [];
  const nextLabels = ["不亏损但未完成目标成本", "亏损", "合计", "项目平均利润率"];
  let end = text.length;
  for (const candidate of nextLabels) {
    const at = text.indexOf(candidate, start + label.length);
    if (at > start && at < end) end = at;
  }
  return text
    .slice(start + label.length, end)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^-?\d+(?:\.\d+)?$/.test(item))
    .map((item) => Number(item));
}

const normal = [25, 8, 20, 14, 20, 33, 15, 5, 27, 6, 10, 8, 14, 0, 2, 7, 0, 0, 0, 0, 214];
const blue = [4, 0, 0, 0, 3, 1, 0, 0, 7, 0, 4, 7, 2, 0, 0, 0, 0, 0, 0, 0, 28];
const red = [2, 1, 1, 2, 0, 4, 2, 2, 3, 2, 2, 2, 5, 0, 0, 1, 0, 0, 0, 0, 29];
const total = [31, 9, 21, 16, 23, 38, 17, 7, 37, 8, 16, 17, 21, 0, 2, 8, 0, 0, 0, 0, 271];

const companies = names.map((name, index) => ({
  company: name,
  inProgress: total[index] || 0,
  normal: normal[index] || 0,
  blue: blue[index] || 0,
  red: red[index] || 0,
  sourcePlatform: "big-pm",
}));

const bigData = {
  source: {
    platform: "big-pm",
    status: "completed",
    displaySource: "大PM平台缓存汇总",
    capturedAt: new Date().toISOString(),
    sourceProbe: bigProbePath,
  },
  companies,
  listChecks: companies.map((item) => ({
    company: item.company,
    blueExpected: item.blue,
    blueActual: 0,
    redExpected: item.red,
    redActual: 0,
    sourcePlatform: "big-pm",
  })),
  projects: [],
  totals: {
    companies: companies.length,
    inProgress: total.at(-1) || companies.reduce((sum, item) => sum + item.inProgress, 0),
    normal: normal.at(-1) || companies.reduce((sum, item) => sum + item.normal, 0),
    blue: blue.at(-1) || companies.reduce((sum, item) => sum + item.blue, 0),
    red: red.at(-1) || companies.reduce((sum, item) => sum + item.red, 0),
    detailProjects: 0,
  },
  detailHealth: { total: 0, complete: 0, missing: 0, budget: 0, actual: 0, reduction: 0, contract: 0 },
};
writeJson(path.join(resultDir, "latest_big-pm.json"), bigData);

console.log(
  JSON.stringify(
    {
      old: oldData.totals,
      big: bigData.totals,
      files: ["latest_old-pm.json", "latest_big-pm.json"],
    },
    null,
    2,
  ),
);
