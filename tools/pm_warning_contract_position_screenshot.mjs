import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const latestPath = path.join(root, "data", "pm_warning_results", "latest_old-pm.json");
const outputDir = path.join(root, "data", "pm_warning_captures");
const cdpBase = process.env.PM_WARNING_CDP_BASE || "http://localhost:9222";
const baseUrl = "http://218.56.43.116:2020/yjpm2012/";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function makeCostPlanUrl(project) {
  const params = new URLSearchParams({
    treeno: "12345",
    FormState: "OnlyView",
    OnlyShowPassed: "",
    pid: project.pid,
    pname: "\u96c6\u56e2\u516c\u53f8",
    hsdxmc: project.hsdx || "",
    hsdxid: project.hsdxid,
    OldZYType: "",
    gChildrenNum: "0",
  });
  return `${baseUrl}WorkAsp/CostManage/costplan/CostPlanMain_MainPlan.aspx?${params}`;
}

async function openTarget(url) {
  try {
    return await fetchJson(`${cdpBase}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch {
    const targets = await fetchJson(`${cdpBase}/json/list`);
    const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!page) throw new Error("\u672a\u627e\u5230\u53ef\u7528\u7684 PM \u6d4f\u89c8\u5668\u8c03\u8bd5\u9875\u9762\u3002");
    return page;
  }
}

function connect(wsUrl) {
  let nextId = 1;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  return {
    async ready() {
      await opened;
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitForCostPlan(client) {
  for (let i = 0; i < 60; i += 1) {
    const state = await evaluate(client, `(() => {
      const text = document.body ? document.body.innerText : "";
      return {
        ready: document.readyState,
        title: document.title,
        hasTotal: text.includes("\\u5408\\u8ba1"),
        hasLogin: text.includes("\\u767b\\u5f55") || text.includes("login")
      };
    })()`);
    if (state?.ready === "complete" && state?.hasTotal) return state;
    await sleep(500);
  }
  return null;
}

async function markContractCell(client) {
  return evaluate(client, `(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, "").trim();
    let targetRow = null;
    let targetCell = null;
    for (const tr of document.querySelectorAll("table tr")) {
      const cells = Array.from(tr.querySelectorAll("td,th"));
      if (cells.length >= 5 && clean(cells[0].innerText || cells[0].textContent).includes("\\u5408\\u8ba1")) {
        targetRow = tr;
        targetCell = cells[4];
        break;
      }
    }
    if (!targetCell) return { ok: false, message: "total row not found" };
    targetCell.scrollIntoView({ block: "center", inline: "center" });
    targetRow.style.background = "rgba(255, 59, 59, 0.08)";
    targetCell.style.outline = "5px solid #ff3b3b";
    targetCell.style.outlineOffset = "-4px";
    targetCell.style.background = "#fff2cc";
    targetCell.style.color = "#b71924";
    targetCell.style.fontWeight = "700";

    const label = document.createElement("div");
    label.textContent = "\\u5408\\u540c\\u989d\\u6293\\u53d6\\u4f4d\\u7f6e\\uff1a\\u201c\\u5408\\u8ba1\\u201d\\u884c\\u7b2c5\\u5217\\uff08\\u9875\\u9762\\u91d1\\u989d \\u00f7 10000 = \\u4e07\\u5143\\uff09";
    label.style.cssText = [
      "position:fixed",
      "left:24px",
      "top:18px",
      "z-index:2147483647",
      "padding:12px 16px",
      "border:3px solid #ff3b3b",
      "background:#fff",
      "color:#b71924",
      "font:700 18px Microsoft YaHei, sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.22)"
    ].join(";");
    document.body.appendChild(label);

    return {
      ok: true,
      columnIndex: Array.from(targetRow.children).indexOf(targetCell) + 1,
      cellText: clean(targetCell.innerText || targetCell.textContent),
      rowText: clean(targetRow.innerText || targetRow.textContent).slice(0, 200)
    };
  })()`);
}

const data = readJson(latestPath);
const project = (data.projects || []).find((item) => item.pid && item.hsdxid && item.contract != null)
  || (data.projects || []).find((item) => item.pid && item.hsdxid);
if (!project) throw new Error("\u672a\u627e\u5230\u5e26 pid/hsdxid \u7684\u7ea2\u84dd\u9884\u8b66\u9879\u76ee\u3002");

const targetUrl = makeCostPlanUrl(project);
const target = await openTarget(targetUrl);
const client = connect(target.webSocketDebuggerUrl);
await client.ready();
await client.send("Page.enable");
await client.send("Runtime.enable");
await client.send("Emulation.setDeviceMetricsOverride", {
  width: 1480,
  height: 920,
  deviceScaleFactor: 1,
  mobile: false,
});
await client.send("Page.bringToFront").catch(() => {});
await client.send("Page.navigate", { url: targetUrl });
await waitForCostPlan(client);
const mark = await markContractCell(client);
await sleep(600);
const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `pm_contract_amount_position_${nowStamp()}.png`);
fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
client.close();

console.log(JSON.stringify({
  outputPath,
  project: project.name,
  hsdx: project.hsdx,
  pid: project.pid,
  hsdxid: project.hsdxid,
  targetUrl,
  mark,
}, null, 2));
