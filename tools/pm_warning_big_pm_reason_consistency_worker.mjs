import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = process.env.PM_WARNING_RESULT_PATH || path.join(root, "data", "pm_warning_results", "latest_big-pm.json");
const outputPath = process.env.PM_WARNING_REASON_OUTPUT_PATH || resultPath;
const port = process.env.BIG_PM_CDP_PORT || "9333";
const defaultPeriod = process.env.PM_WARNING_PERIOD || "";
const limit = Math.max(0, Number(process.env.PM_WARNING_REASON_CHECK_LIMIT || 0) || 0);
const debug = process.env.PM_WARNING_REASON_DEBUG === "1";

const detailPageBase = "http://yanjianpm.glodon.com/YJJT/CBFXGL/XMCBDBFXBPage/XMCBDBFXBPage.aspx";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => {
  if (debug) console.error("[big-pm-reason-check]", ...args);
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round2 = (value) => (value == null ? null : Math.round((Number(value) + Number.EPSILON) * 100) / 100);
const wan = (value) => {
  const n = finiteNumber(value);
  return n == null ? null : round2(n / 10000);
};
const hasValue = (value) => value !== null && value !== undefined && value !== "";
const normalizeText = (value) => clean(value)
  .toLowerCase()
  .replace(/[，。！？；：、“”‘’（）()\[\]【】{}《》<>\s,.;:!?'"`~\-_/\\|]+/g, "");
const textIncludesEither = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  const minLength = Math.min(a.length, b.length);
  return minLength >= 10 && (a.includes(b.slice(0, Math.min(b.length, 80))) || b.includes(a.slice(0, Math.min(a.length, 80))));
};
const keywordList = [
  "未开工", "未施工", "无施工", "停工", "缓建", "建设单位", "甲方", "审计", "签证", "变更",
  "铜价", "材料", "人工", "机械", "管理费", "规费", "税金", "水电费", "分包", "劳务",
  "专业分包", "结算", "报耗", "暂估", "图纸", "设计", "工期", "维保", "产值", "付款节点",
  "清单", "成本", "预算", "实际", "降低率", "亏损", "盈利", "目标", "责任书", "未完成",
  "施工条件", "手续", "许可", "策划", "采购", "东泰物流", "损耗", "量差", "价差",
];
const extractKeywords = (text) => keywordList.filter((keyword) => clean(text).includes(keyword));
const overlap = (left, right) => {
  const a = new Set(left);
  const b = new Set(right);
  return [...a].filter((item) => b.has(item));
};

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function connectPortal() {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = pages.find((item) =>
    item.type === "page" && item.url.includes("Portal/Frame/LayoutC/Default.aspx")
  ) || pages.find((item) =>
    item.type === "page" && item.url.includes("yanjianpm.glodon.com") && !item.url.toLowerCase().includes("login")
  );
  if (!target?.webSocketDebuggerUrl) throw new Error(`未找到已登录的大PM页面，端口 ${port}`);

  let nextId = 1;
  const pending = new Map();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await send("Runtime.enable");
  return { ws, send };
}

async function evaluate(send, expression, timeout = 60000) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const exception = detail.exception?.description || detail.exception?.value || "";
    const line = detail.lineNumber != null ? ` line ${detail.lineNumber}` : "";
    throw new Error([detail.text, exception, line].filter(Boolean).join(": ") || "Runtime.evaluate failed");
  }
  return result.result?.result?.value ?? result.result?.value;
}

function parsePeriod(project) {
  const period = clean(project.reportPeriod || project.queryPeriod || defaultPeriod || "");
  const match = period.match(/^(\d{4})-(\d{1,2})$/);
  if (match) return { period: `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`, year: Number(match[1]), month: Number(match[2]) };
  const now = new Date();
  return { period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, year: now.getFullYear(), month: now.getMonth() + 1 };
}

async function collectCostComparison(send, project) {
  const { year, month, period } = parsePeriod(project);
  const url = buildUrl(detailPageBase, {
    DEPTID: project.deptId,
    HSDX: project.hsdx || project.major,
    HSDXID: project.hsdxId,
    state: "STATE_VIEW",
    modulecode: "YJJT.CBFXGL.XMCBDBFXBQueryModule",
    _dc: Date.now(),
  });
  const frameId = "codexBigPmCostCompareFrame";
  const helpers = `
    const targetUrl = ${JSON.stringify(url)};
    const frameId = ${JSON.stringify(frameId)};
    const frameHref = (frame) => {
      try { return String(frame?.contentWindow?.location?.href || ""); } catch (_err) { return ""; }
    };
    const isTarget = (frame) => {
      const href = frameHref(frame);
      return href.includes("XMCBDBFXBPage")
        && href.includes("DEPTID=${encodeURIComponent(project.deptId ?? "")}")
        && href.includes("HSDXID=${encodeURIComponent(project.hsdxId ?? "")}");
    };
    const getFrame = () => {
      let frame = [...document.querySelectorAll("iframe")].find(isTarget) || document.getElementById(frameId);
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = frameId;
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1600px;height:950px;border:0;visibility:hidden;";
        document.body.appendChild(frame);
      }
      if (!isTarget(frame)) frame.src = targetUrl;
      return frame;
    };
    const getWin = (frame) => isTarget(frame) ? frame.contentWindow : null;
  `;
  const ensureExpression = `(() => {
    ${helpers}
    const frame = getFrame();
    const win = getWin(frame);
    const ok = !!(win?.Ext?.getCmp?.("treeGrid") && win?.Ext?.getCmp?.("DateFieldStart") && win?.Ext?.getCmp?.("DateFieldEnd") && win?.Ext?.getCmp?.("btnSearch"));
    return { ok, url: frameHref(frame), hasExt: !!win?.Ext };
  })()`;
  let ready = null;
  for (let attempt = 0; attempt < 35; attempt += 1) {
    ready = await evaluate(send, ensureExpression, 15000);
    if (ready?.ok) break;
    await sleep(1000);
  }
  if (!ready?.ok) return { ok: false, period, url: ready?.url || url, message: "成本对比分析页控件未加载" };

  const queryExpression = `(() => {
    ${helpers}
    const frame = getFrame();
    const win = getWin(frame);
    const Ext = win?.Ext;
    const start = Ext?.getCmp?.("DateFieldStart");
    const end = Ext?.getCmp?.("DateFieldEnd");
    const search = Ext?.getCmp?.("btnSearch");
    const targetMonth = new Date(${year}, ${month - 1}, 1);
    try {
      start.clearValue?.();
      start.setValue(null);
      start.setRawValue?.("");
      start.fireEvent?.("change", start, null);
      end.setValue(targetMonth);
      end.setRawValue?.(${JSON.stringify(period)});
      end.fireEvent?.("select", end, targetMonth);
      end.fireEvent?.("change", end, targetMonth);
      if (search?.handler) search.handler.call(search, search);
      else search?.fireEvent?.("click", search);
      return { ok: true, url: frameHref(frame) };
    } catch (error) {
      return { ok: false, url: frameHref(frame), message: error?.message || String(error) };
    }
  })()`;
  const query = await evaluate(send, queryExpression, 15000);
  if (!query?.ok) return { ok: false, period, url: query?.url || url, message: query?.message || "成本对比分析页查询失败" };
  const readExpression = `(() => {
    ${helpers}
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const simplify = (value, seen = new WeakSet()) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (typeof value === "function") return undefined;
      if (Array.isArray(value)) return value.map((item) => simplify(item, seen));
      if (typeof value === "object") {
        if (seen.has(value)) return undefined;
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value)) {
          const simplified = simplify(value[key], seen);
          if (simplified !== undefined) out[key] = simplified;
        }
        return out;
      }
      return String(value);
    };
    const frame = getFrame();
    const win = getWin(frame);
    const Ext = win?.Ext;
    const tree = Ext?.getCmp?.("treeGrid");
    const store = tree?.getStore?.();
    const rows = store?.getRange?.() || [];
    const rowName = (record) => clean(record?.get?.("NAME") || record?.data?.NAME);
    const noTaxRecord = rows.find((record) => rowName(record).includes("合计行") && rowName(record).includes("不含税"))
      || rows.find((record) => clean(record.get?.("CBKMZDBM") || record.data?.CBKMZDBM) === "BHSGDH")
      || rows.find((record) => clean(record.get?.("CODE") || record.data?.CODE) === "BHSGDH")
      || null;
    const rateRecord = rows.find((record) => rowName(record).includes("目标责任成本降低公式")) || noTaxRecord;
    const reasonGrid = Ext?.getCmp?.("gridView_YYFX");
    const reasonRowsAll = reasonGrid?.getStore?.().getRange?.().map((record) => simplify(record.data)) || [];
    const targetYear = ${year};
    const targetMonth = ${month};
    const monthValue = (value) => {
      if (typeof value === "number") return value;
      const text = clean(value?.alias?.zh_CN || value?.name || value);
      const match = text.match(/M?(\\d{1,2})/);
      return match ? Number(match[1]) : null;
    };
    const reasonRows = reasonRowsAll.filter((row) => Number(row.NF) === targetYear && monthValue(row.YF) === targetMonth);
    const start = Ext?.getCmp?.("DateFieldStart");
    const end = Ext?.getCmp?.("DateFieldEnd");
    return {
      ok: true,
      url: frameHref(frame),
      rawValues: {
        start: start?.getRawValue?.() || "",
        end: end?.getRawValue?.() || "",
      },
      rowCount: rows.length,
      costRows: rows.map((record) => simplify(record.data)),
      noTax: simplify(noTaxRecord?.data || null),
      rateRaw: simplify(rateRecord?.data || null),
      noTaxName: rowName(noTaxRecord),
      rateName: rowName(rateRecord),
      reasonRows,
      reasonRowCount: reasonRows.length,
      allReasonRowCount: reasonRowsAll.length,
    };
  })()`;
  let result = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    result = await evaluate(send, readExpression, 30000);
    if (result?.noTax || result?.rowCount > 0) break;
    await sleep(1000);
  }

  const monthlyQueryExpression = `(() => {
    ${helpers}
    const frame = getFrame();
    const win = getWin(frame);
    const Ext = win?.Ext;
    const start = Ext?.getCmp?.("DateFieldStart");
    const end = Ext?.getCmp?.("DateFieldEnd");
    const search = Ext?.getCmp?.("btnSearch");
    const targetMonth = new Date(${year}, ${month - 1}, 1);
    try {
      start.setValue(targetMonth);
      start.setRawValue?.(${JSON.stringify(period)});
      start.fireEvent?.("select", start, targetMonth);
      start.fireEvent?.("change", start, targetMonth);
      end.setValue(targetMonth);
      end.setRawValue?.(${JSON.stringify(period)});
      end.fireEvent?.("select", end, targetMonth);
      end.fireEvent?.("change", end, targetMonth);
      if (search?.handler) search.handler.call(search, search);
      else search?.fireEvent?.("click", search);
      return { ok: true, url: frameHref(frame) };
    } catch (error) {
      return { ok: false, url: frameHref(frame), message: error?.message || String(error) };
    }
  })()`;
  let monthlyResult = null;
  const monthlyQuery = await evaluate(send, monthlyQueryExpression, 15000);
  if (monthlyQuery?.ok) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      monthlyResult = await evaluate(send, readExpression, 30000);
      if (monthlyResult?.noTax || monthlyResult?.rowCount > 0) break;
      await sleep(1000);
    }
  } else {
    monthlyResult = { ok: false, period, message: monthlyQuery?.message || "当月成本对比分析页查询失败" };
  }
  return { ...result, period, monthly: { ...monthlyResult, period } };
}

function compareMoney(label, approvalValue, costYuan, issues, amountComparison) {
  const approval = finiteNumber(approvalValue);
  const cost = wan(costYuan);
  amountComparison[label] = { approval, cost };
  if (approval == null || cost == null) return;
  const diff = Math.abs(approval - cost);
  const tolerance = Math.max(0.05, Math.abs(approval) * 0.001);
  amountComparison[label].diff = round2(diff);
  if (diff > tolerance) {
    issues.push({
      type: "amount-mismatch",
      severity: "conflict",
      field: label,
      message: `${label}审批表为${approval}万元，成本对比分析为${cost}万元，差异${round2(diff)}万元`,
    });
  }
}

function compareRate(label, approvalValue, costValue, issues, amountComparison) {
  const approval = finiteNumber(approvalValue);
  const cost = finiteNumber(costValue);
  amountComparison[label] = { approval, cost };
  if (approval == null || cost == null) return;
  const diff = Math.abs(approval - cost);
  amountComparison[label].diff = round2(diff);
  if (diff > 0.05) {
    issues.push({
      type: "rate-mismatch",
      severity: "review",
      field: label,
      message: `${label}审批表累计口径为${approval}%，成本对比分析页字段为${cost}%，差异${round2(diff)}个百分点；审批表降低率为自开工以来累计降低率，此项按口径/字段维护差异待复核，不作为金额冲突`,
    });
  }
}

function checkWarningStatus(project, comparison, issues) {
  if (!comparison?.noTax) return;
  const status = clean(project.status || project.warningStatus || project.displayStatus);
  const reduction = wan(comparison.noTax.YSCBYSJCB_JDE);
  const actualRate = finiteNumber(project.reduceActual);
  const targetRate = finiteNumber(project.reduceDuty);
  if (status.includes("红") && reduction != null && reduction >= 0.05) {
    issues.push({
      type: "status-cost-conflict",
      severity: "conflict",
      message: `审批表为红色预警，但成本对比分析税前降低额为${reduction}万元，未显示亏损`,
    });
  }
  if (status.includes("蓝") && reduction != null && reduction < -0.05) {
    issues.push({
      type: "status-cost-conflict",
      severity: "conflict",
      message: `审批表为蓝色预警，但成本对比分析税前降低额为${reduction}万元，显示亏损`,
    });
  }
  if (status.includes("蓝") && actualRate != null && targetRate != null && actualRate >= targetRate - 0.05) {
    issues.push({
      type: "status-cost-conflict",
      severity: "conflict",
      message: `审批表为蓝色预警，但审批表累计实际降低率${actualRate}%已达到责任书目标${targetRate}%`,
    });
  }
}

function costRowName(row) {
  return clean(row?.NAME || row?.name || row?.CBKMMC || row?.CBKM || row?.CODE || row?.CBKMZDBM);
}

function costTopicTokens(name) {
  const text = clean(name);
  const tokens = [];
  [
    "人工费", "材料费", "机械费", "管理费", "规费", "税金", "水电费",
    "金属管", "塑料管", "阀门", "散热器", "通风管道", "通风管道部件",
    "甲供材", "辅助材料", "辅助材料（1）", "海运费", "其他主材",
  ].forEach((token) => {
    if (text.includes(token)) tokens.push(token);
  });
  if (!tokens.length) {
    ["人工", "材料", "机械", "管理", "规费", "税", "水电", "甲供", "辅助", "塑料", "金属", "阀门", "通风", "海运"].forEach((token) => {
      if (text.includes(token)) tokens.push(token);
    });
  }
  return [...new Set(tokens)];
}

function reasonMentionsCostRow(reasonText, row) {
  const reason = normalizeText(reasonText);
  if (!reason) return false;
  const name = costRowName(row).replace(/（.*?）|\(.*?\)/g, "");
  const normalizedName = normalizeText(name);
  if (normalizedName.length >= 2 && reason.includes(normalizedName)) return true;
  return costTopicTokens(name).some((token) => reason.includes(normalizeText(token)));
}

function compactCostRow(row) {
  return {
    name: costRowName(row),
    budget: wan(row?.YSCB_JE),
    actual: wan(row?.SJCB_JE),
    reduction: wan(row?.YSCBYSJCB_JDE),
    actualRate: finiteNumber(row?.YSCBYSJCB_JDL),
    targetRate: finiteNumber(row?.MBCBYSJCB_JDL),
  };
}

function isCostSubjectRow(row) {
  const name = costRowName(row);
  if (!name) return false;
  if (/合计行|固定行|目标责任成本降低公式|项目平均利润率/.test(name)) return false;
  return true;
}

function buildMonthlyCostLogic(project, comparison, reasonText, issues) {
  const monthly = comparison.monthly || {};
  const rows = (monthly.costRows || []).filter(isCostSubjectRow);
  const lossRows = rows
    .map((row) => ({ raw: row, ...compactCostRow(row) }))
    .filter((row) => row.reduction != null && row.reduction < -0.05)
    .sort((left, right) => Math.abs(right.reduction) - Math.abs(left.reduction));
  const gainRows = rows
    .map((row) => ({ raw: row, ...compactCostRow(row) }))
    .filter((row) => row.reduction != null && row.reduction > 0.05)
    .sort((left, right) => Math.abs(right.reduction) - Math.abs(left.reduction));
  const unexplainedLossRows = lossRows
    .filter((row) => !reasonMentionsCostRow(reasonText, row.raw))
    .slice(0, 8)
    .map(({ raw: _raw, ...row }) => row);
  const noWorkText = /无产值|无施工|未施工|软停工|停工/.test(clean(reasonText));
  const monthlyNoTax = compactCostRow(monthly.noTax || {});
  const hasMonthlyAmount = [monthlyNoTax.budget, monthlyNoTax.actual, monthlyNoTax.reduction]
    .some((value) => value != null && Math.abs(value) > 0.05);

  if (lossRows.length && !clean(reasonText)) {
    issues.push({
      type: "monthly-cost-reason-missing",
      severity: "review",
      message: `当月成本对比分析存在${lossRows.length}个亏损科目，但未读取到当月原因分析`,
    });
  }
  unexplainedLossRows.forEach((row) => {
    issues.push({
      type: "monthly-cost-reason-uncovered",
      severity: "review",
      field: row.name,
      message: `当月${row.name}降低额${row.reduction}万元，原因分析未明显覆盖该亏损科目`,
    });
  });
  if (noWorkText && hasMonthlyAmount && lossRows.length) {
    issues.push({
      type: "monthly-no-work-cost-review",
      severity: "review",
      message: `当月原因提到无产值/未施工，但当月成本对比仍有亏损科目，需确认管理费、规费或历史调整等成本是否已说明`,
    });
  }

  return {
    period: monthly.period || comparison.period || "",
    rawValues: monthly.rawValues || {},
    rowCount: monthly.rowCount ?? null,
    reasonRowCount: monthly.reasonRowCount ?? null,
    noTax: monthlyNoTax,
    lossRows: lossRows.slice(0, 12).map(({ raw: _raw, ...row }) => row),
    gainRows: gainRows.slice(0, 8).map(({ raw: _raw, ...row }) => row),
    unexplainedLossRows,
  };
}

function validateProject(project, comparison) {
  const issues = [];
  const amountComparison = {};
  const approvalReason = clean(project.reason);
  const approvalRectification = clean(project.rectification);
  const monthlyCostReason = (comparison.monthly?.reasonRows || [])
    .map((row) => clean(row.YYFX || row.YYFXSM || row.Reason || row.reason))
    .filter(Boolean)
    .join("\n");
  const cumulativeCostReason = (comparison.reasonRows || [])
    .map((row) => clean(row.YYFX || row.YYFXSM || row.Reason || row.reason))
    .filter(Boolean)
    .join("\n");
  const costReason = monthlyCostReason || cumulativeCostReason;
  let monthlyCostLogic = null;

  if (!comparison.ok) {
    issues.push({ type: "cost-page-unread", severity: "pending", message: comparison.message || "成本对比分析页未读取成功" });
  } else {
    if (!comparison.noTax) {
      issues.push({
        type: "cost-total-row-missing",
        severity: "review",
        message: "成本对比分析页未匹配到不含税合计行，累计预算、累计实际和降低额没有完成平台源头校验",
      });
    }
    compareMoney("累计税前预算成本", project.budget, comparison.noTax?.YSCB_JE, issues, amountComparison);
    compareMoney("累计税前实际成本", project.actual, comparison.noTax?.SJCB_JE, issues, amountComparison);
    compareMoney("税前降低额", project.reduction, comparison.noTax?.YSCBYSJCB_JDE, issues, amountComparison);
    compareRate("责任书目标降低率", project.reduceDuty, comparison.noTax?.MBCBYSJCB_JDL ?? comparison.rateRaw?.MBCBYSJCB_JDL, issues, amountComparison);
    compareRate("实际降低率", project.reduceActual, comparison.noTax?.YSCBYSJCB_JDL ?? comparison.rateRaw?.YSCBYSJCB_JDL, issues, amountComparison);
    checkWarningStatus(project, comparison, issues);
    monthlyCostLogic = buildMonthlyCostLogic(project, comparison, costReason, issues);
  }

  if (approvalReason && costReason) {
    const approvalKeywords = extractKeywords(approvalReason);
    const costKeywords = extractKeywords(costReason);
    const keywordOverlap = overlap(approvalKeywords, costKeywords);
    if (!textIncludesEither(approvalReason, costReason) && approvalKeywords.length && costKeywords.length && !keywordOverlap.length) {
      issues.push({
        type: "reason-keyword-mismatch",
        severity: "review",
        message: `审批表原因关键词（${approvalKeywords.slice(0, 8).join("、")}）与成本对比分析原因关键词（${costKeywords.slice(0, 8).join("、")}）未交叉`,
      });
    }
  } else if (approvalReason && !costReason) {
    issues.push({ type: "cost-reason-empty", severity: "review", message: "审批表有原因分析，但成本对比分析页未读到原因分析" });
  } else if (!approvalReason && costReason) {
    issues.push({ type: "approval-reason-empty", severity: "review", message: "成本对比分析有原因分析，但审批表原因分析为空" });
  } else {
    issues.push({ type: "reason-empty-both", severity: "pending", message: "审批表和成本对比分析均未读到原因分析" });
  }

  if (!approvalRectification) {
    issues.push({ type: "rectification-empty", severity: "review", message: "审批表整改措施为空" });
  }
  if (approvalRectification && /无亏损风险|已完成目标|无需整改/.test(approvalRectification) && String(project.status).includes("红")) {
    issues.push({ type: "rectification-status-conflict", severity: "conflict", message: "整改措施表述为无风险/已完成目标，但审批表当前为红色预警" });
  }
  if (approvalReason && /无成本|成本为0|无成本和产值/.test(approvalReason)) {
    const actual = finiteNumber(project.actual);
    if (actual != null && Math.abs(actual) > 0.01) {
      issues.push({ type: "reason-amount-conflict", severity: "conflict", message: `原因表述无成本，但审批表累计税前实际成本为${project.actual}万元` });
    }
  }

  const conflictCount = issues.filter((item) => item.severity === "conflict").length;
  const reviewCount = issues.filter((item) => item.severity === "review").length;
  const verdict = conflictCount ? "冲突" : reviewCount ? "待复核" : "无明显冲突";
  return {
    verdict,
    conflictCount,
    reviewCount,
    issues,
    amountComparison,
    approvalReason,
    approvalRectification,
    costComparisonReason: costReason,
    costComparisonMonthlyReason: monthlyCostReason,
    costComparisonUrl: comparison.url || "",
    costComparisonPeriod: comparison.period || "",
    costComparisonRowCount: comparison.rowCount ?? null,
    costComparisonReasonRowCount: comparison.reasonRowCount ?? null,
    costComparisonAllReasonRowCount: comparison.allReasonRowCount ?? null,
    costComparisonMonthlyPeriod: comparison.monthly?.period || "",
    costComparisonMonthlyRawValues: comparison.monthly?.rawValues || {},
    costComparisonMonthlyRowCount: comparison.monthly?.rowCount ?? null,
    costComparisonMonthlyReasonRowCount: comparison.monthly?.reasonRowCount ?? null,
    monthlyCostLogic,
    costComparisonNoTaxName: comparison.noTaxName || "",
    costComparisonRateName: comparison.rateName || "",
    costComparisonRawValues: comparison.rawValues || {},
  };
}

const data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const sourceProjects = (data.projects || [])
  .filter((project) => project.sourcePlatform === "big-pm")
  .filter((project) => !process.env.PM_WARNING_REASON_COMPANY_FILTER || clean(project.company).includes(process.env.PM_WARNING_REASON_COMPANY_FILTER));
const eligibleProjects = sourceProjects
  .filter((project) => project.deptId && project.hsdxId && clean(project.hsdx || project.major));
const missingPathProjects = sourceProjects.length - eligibleProjects.length;
const candidates = eligibleProjects.slice(0, limit || undefined);

const { ws, send } = await connectPortal();
const checks = [];
const errors = [];
try {
  let index = 0;
  for (const project of candidates) {
    index += 1;
    log(`${index}/${candidates.length}`, project.company, project.name, project.hsdx || project.major, project.reportPeriod);
    try {
      const comparison = await collectCostComparison(send, project);
      const check = validateProject(project, comparison);
      project.costComparisonCheck = check;
      checks.push({
        company: project.company,
        name: project.name,
        hsdx: project.hsdx || project.major,
        reportPeriod: project.reportPeriod || check.costComparisonPeriod,
        status: project.status,
        verdict: check.verdict,
        conflictCount: check.conflictCount,
        reviewCount: check.reviewCount,
        issues: check.issues,
      });
    } catch (error) {
      const message = error?.message || String(error);
      errors.push({ company: project.company, name: project.name, hsdx: project.hsdx || project.major, message });
      project.costComparisonCheck = {
        verdict: "待复核",
        conflictCount: 0,
        reviewCount: 1,
        issues: [{ type: "validator-error", severity: "review", message }],
      };
    }
  }
} finally {
  try {
    await evaluate(send, `(() => {
      const frame = document.getElementById("codexBigPmCostCompareFrame");
      frame?.parentNode?.removeChild(frame);
      return true;
    })()`, 5000);
  } catch (_err) {}
  try { ws.close(); } catch (_err) {}
}

const summary = {
  sourcePlatform: "big-pm",
  checkedAt: new Date().toISOString(),
  totalProjects: sourceProjects.length,
  eligibleProjects: eligibleProjects.length,
  skippedMissingPath: missingPathProjects,
  limit: limit || null,
  checked: checks.length,
  conflicts: checks.filter((item) => item.verdict === "冲突").length,
  reviews: checks.filter((item) => item.verdict === "待复核").length,
  ok: checks.filter((item) => item.verdict === "无明显冲突").length,
  errors,
  checks,
};
data.reasonConsistency = summary;
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
