import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "data", "pm_warning_results", "latest_big-pm.json");
const port = process.env.BIG_PM_CDP_PORT || "9333";
const pages = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!page) throw new Error(`No yanjianpm page found on CDP port ${port}`);

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
  const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const number = (value) => {
    const n = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const frame = Array.from(document.querySelectorAll("iframe")).find((item) => item.src.includes("CBZHQKZPage"));
  if (!frame) return { ok: false, message: "CBZHQKZPage iframe not found" };
  const win = frame.contentWindow;
  const grid = win.Ext?.getCmp("gridView");
  if (!grid) return { ok: false, message: "gridView not found" };
  const rows = grid.getStore().getRange().map((record) => record.data);
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
  const totals = {
    companies: companies.length,
    inProgress: companies.reduce((sum, item) => sum + item.total, 0),
    normal: companies.reduce((sum, item) => sum + item.normal, 0),
    blue: companies.reduce((sum, item) => sum + item.blue, 0),
    red: companies.reduce((sum, item) => sum + item.red, 0),
    detailProjects: 0,
    amountComplete: 0,
    amountMissing: 0
  };
  return { ok: true, frameUrl: frame.src, companies, totals };
})()`;
const result = await send("Runtime.evaluate", { expression, returnByValue: true });
ws.close();
if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(1);
}
const value = result.result?.result?.value || result.result?.value;
if (!value?.ok) {
  console.error(JSON.stringify(value, null, 2));
  process.exit(1);
}
const now = new Date().toISOString();
const data = {
  source: {
    menuPath: "成本管理 > 成本综合情况分析",
    page: value.frameUrl,
    projectStatus: "在建",
    platform: "big-pm",
    displaySource: "大PM平台实时抓数",
    collectedAt: now,
    note: "调试汇总快照；未作为正式抓数结果发布。",
    status: "draft"
  },
  companies: value.companies,
  listChecks: [],
  projects: [],
  detailHealth: { total: 0, budget: 0, actual: 0, reduction: 0, complete: 0, missing: 0, contract: 0 },
  totals: value.totals,
  capture: { platform: "big-pm", platformName: "大PM平台", status: "draft", capturedAt: now }
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, totals: data.totals }, null, 2));
