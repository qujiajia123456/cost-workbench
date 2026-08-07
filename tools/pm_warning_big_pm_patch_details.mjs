import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = process.env.PM_WARNING_RESULT_PATH || path.join(root, "data", "pm_warning_results", "latest_big-pm.json");
const port = process.env.BIG_PM_CDP_PORT || "9333";
const period = process.env.PM_WARNING_PERIOD || new Date().toISOString().slice(0, 7);
const companyFilter = (process.env.PM_WARNING_BIG_PM_COMPANY_FILTER || "").trim();
const periodMatch = String(period).match(/^(\d{4})-(\d{1,2})$/);
const periodYear = periodMatch ? Number(periodMatch[1]) : new Date().getFullYear();
const periodMonth = periodMatch ? Number(periodMatch[2]) : new Date().getMonth() + 1;
const listCaptureAttempts = Math.max(1, Number(process.env.PM_WARNING_BIG_PM_LIST_ATTEMPTS || 3) || 3);
const approvalOnly = process.env.PM_WARNING_BIG_PM_APPROVAL_ONLY === "1";
const approvalContractFallback = process.env.PM_WARNING_BIG_PM_APPROVAL_CONTRACT_FALLBACK === "1";

const listPageBase = "http://yanjianpm.glodon.com/YJJT/CBFXGL/XMSJLBPage/XMSJLBPage.aspx";
const detailPageBase = "http://yanjianpm.glodon.com/YJJT/CBFXGL/XMCBDBFXBPage/XMCBDBFXBPage.aspx";
const approvalListPageBase = "http://yanjianpm.glodon.com/YJJT/CBZHFX/XMCBWCQKSPBListPage/XMCBWCQKSPBListPage.aspx";
const approvalEditPageBase = "http://yanjianpm.glodon.com/YJJT/CBZHFX/XMCBWCQKSPBEditPage/XMCBWCQKSPBEditPage.aspx";
const totalPlanPageBase = "http://yanjianpm.glodon.com/YJJT/ZCBJHBZMK/ZCBJHBZListPage/ZCBJHBZListPage.aspx";
const projectBasicPageBase = "http://yanjianpm.glodon.com/GEPS/Project/XMJBXXListPage/XMJBXXListPage.aspx";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debugLog = (...args) => {
  if (process.env.PM_WARNING_BIG_PM_DEBUG === "1") console.error("[big-pm-approval]", ...args);
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round2 = (value) => (value == null ? null : Math.round((Number(value) + Number.EPSILON) * 100) / 100);
const roundDigits = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const wan = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const converted = Number(value) / 10000;
  const digits = converted !== 0 && Math.abs(converted) < 0.01 ? 4 : 2;
  return roundDigits(converted, digits);
};
const hasValue = (value) => value != null && value !== "";
const enumText = (value) => {
  if (value == null) return "";
  if (typeof value === "object") {
    return clean(value.alias?.zh_CN || value.value || value.text || value.name || value.key || "");
  }
  return clean(value);
};
const enumKey = (value) => {
  if (value == null) return "";
  if (typeof value === "object") return clean(value.key || value.value || value.name || "");
  return clean(value);
};
const warningStatusFromType = (value) => {
  const key = enumKey(value).toLowerCase();
  const text = enumText(value);
  if (key === "ks" || text.includes("亏损")) return "红色";
  if (key === "bks" || text.includes("不亏损") || text.includes("未完成目标")) return "蓝色";
  return "";
};
const warningStatusFromColor = (value) => {
  const key = enumKey(value).toLowerCase();
  const text = enumText(value);
  if (key === "red" || text.includes("红")) return "红色";
  if (key === "blue" || text.includes("蓝")) return "蓝色";
  return "";
};
const warningRank = (status) => (status === "红色" ? 2 : status === "蓝色" ? 1 : 0);
const warningTypeFromStatus = (status) => (status === "红色"
  ? { type: "red", t: "ks" }
  : { type: "blue", t: "wwc" });
const periodAddMonths = (year, month, offset) => {
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const isZero = (value) => {
  const n = finiteNumber(value);
  return n != null && Math.abs(n) < 0.000001;
};
const normalizeName = (value) => clean(value)
  .replace(/[（(].*?[）)]/g, "")
  .replace(/[【】\[\]\s,，、]/g, "")
  .toLowerCase();
const matchVariants = (value) => {
  const text = clean(value);
  const candidates = [
    text,
    text.replace(/^[（(][^）)]+[）)]/, ""),
    text.replace(/[（(].*?[）)]/g, ""),
    text.replace(/[-－—].*$/, ""),
  ].map(normalizeName).filter((item) => item.length >= 4);
  return [...new Set(candidates)];
};
const namesOverlap = (left, right) => {
  const leftVariants = matchVariants(left);
  const rightVariants = matchVariants(right);
  return leftVariants.some((leftItem) =>
    rightVariants.some((rightItem) => leftItem.includes(rightItem) || rightItem.includes(leftItem))
  );
};
const companyPrefix = (value) => {
  const text = clean(value).replace(/\s+/g, "");
  const match = text.match(/^(.{2,}?(?:集团有限公司|股份有限公司|有限责任公司|有限公司|集团|公司))/);
  return match ? normalizeName(match[1]) : "";
};
const commonPrefixLength = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};
const hasNameConflict = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  const pairs = [
    ["北地块", "南地块"],
    ["东地块", "西地块"],
    ["一期", "二期"],
    ["一期", "三期"],
    ["二期", "三期"],
    ["一标段", "二标段"],
    ["一标段", "三标段"],
    ["二标段", "三标段"],
  ];
  return pairs.some(([x, y]) => {
    const aHasX = a.includes(x);
    const aHasY = a.includes(y);
    const bHasX = b.includes(x);
    const bHasY = b.includes(y);
    return (aHasX && !aHasY && bHasY && !bHasX) || (aHasY && !aHasX && bHasX && !bHasY);
  });
};
const planNameMatches = (projectName, rowName) => {
  if (namesOverlap(projectName, rowName)) return true;
  if (hasNameConflict(projectName, rowName)) return false;
  const projectPrefix = companyPrefix(projectName);
  const rowPrefix = companyPrefix(rowName);
  if (projectPrefix && rowPrefix && projectPrefix === rowPrefix && projectPrefix.length >= 6) return true;
  return commonPrefixLength(projectName, rowName) >= 10;
};

let sharedTarget = null;
let sharedConnection = null;
let sharedPortalConnection = null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

async function openTarget(url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`open target failed: ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error(`new target has no debugger url: ${url}`);
  return target;
}

async function closeTarget(target) {
  if (!target?.id) return;
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`);
  } catch (_err) {}
}

async function connectTarget(target) {
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
  try { await send("Page.enable"); } catch (_err) {}
  return { ws, send };
}

async function evaluate(send, expression, timeout = 60000) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.result?.value ?? result.result?.value;
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error?.message || error))) {
        throw error;
      }
      await sleep(1200);
    }
  }
  throw lastError || new Error("Runtime.evaluate failed");
}

async function withTarget(url, callback) {
  if (!sharedTarget || !sharedConnection) {
    sharedTarget = await openTarget("about:blank");
    sharedConnection = await connectTarget(sharedTarget);
  }
  const { send } = sharedConnection;
  try { await send("Page.navigate", { url }); } catch (_err) {}
  await sleep(1200);
  return callback(send, sharedTarget);
}

async function closeSharedTarget() {
  try {
    if (sharedPortalConnection?.send) {
      await evaluate(sharedPortalConnection.send, `(() => {
        for (const id of ["codexBigPmApprovalListFrame", "codexBigPmApprovalDetailFrame"]) {
          const frame = document.getElementById(id);
          frame?.parentNode?.removeChild(frame);
        }
        return true;
      })()`, 5000);
    }
  } catch (_err) {}
  try { sharedConnection?.ws?.close(); } catch (_err) {}
  try { sharedPortalConnection?.ws?.close(); } catch (_err) {}
  await closeTarget(sharedTarget);
  sharedTarget = null;
  sharedConnection = null;
  sharedPortalConnection = null;
}

async function withPortal(callback) {
  if (!sharedPortalConnection) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const target = pages.find((item) =>
      item.type === "page"
      && item.url.includes("Portal/Frame/LayoutC/Default.aspx")
    ) || pages.find((item) =>
      item.type === "page"
      && item.url.includes("yanjianpm.glodon.com")
      && !item.url.toLowerCase().includes("login")
    );
    if (!target) throw new Error(`no logged-in Big PM portal page found on ${port}`);
    sharedPortalConnection = await connectTarget(target);
  }
  return callback(sharedPortalConnection.send);
}

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function summarizeListCompleteness(checks) {
  const rows = (checks || []).filter((check) => Number(check?.expected) > 0);
  const expected = rows.reduce((sum, check) => sum + (Number(check.expected) || 0), 0);
  const actual = rows.reduce((sum, check) => sum + (Number(check.actual) || 0), 0);
  const incompleteChecks = rows
    .filter((check) => (Number(check.expected) || 0) > (Number(check.actual) || 0))
    .map((check) => ({
      reportPeriod: check.reportPeriod || period,
      company: check.company || "",
      type: check.type || "",
      status: check.status || "",
      expected: Number(check.expected) || 0,
      actual: Number(check.actual) || 0,
      missing: Math.max(0, (Number(check.expected) || 0) - (Number(check.actual) || 0)),
      attempts: Number(check.attempts) || 1,
      message: check.message || "",
    }));
  const missing = incompleteChecks.reduce((sum, check) => sum + check.missing, 0);
  return {
    ok: missing === 0,
    expected,
    actual,
    missing,
    checked: rows.length,
    incompleteCount: incompleteChecks.length,
    incompleteChecks: incompleteChecks.slice(0, 100),
  };
}

async function collectListRowsOnce(company, typeDef, attempt = 1) {
  const expected = Number(company[typeDef.type]) || 0;
  if (!expected || !company.gsid) return { rows: [], check: null };
  const url = buildUrl(listPageBase, {
    autoLoad: "true",
    modulecode: "YJJT.CBFXGL.XMSJLBQueryModule",
    GSID: company.gsid,
    LX: typeDef.code,
    XMZT: "ZS",
    _dc: `${Date.now()}_${attempt}`,
  });
  const value = await withTarget(url, async (send) => evaluate(send, `(() => new Promise(async (resolve) => {
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const simplify = (value) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.map(simplify);
      const out = {};
      for (const key of Object.keys(value)) {
        if (typeof value[key] !== "function") out[key] = simplify(value[key]);
      }
      return out;
    };
    const storeTotal = (store) => Number(
      store?.getTotalCount?.()
      ?? store?.totalLength
      ?? store?.getTotalLength?.()
      ?? store?.reader?.jsonData?.totalCount
      ?? store?.reader?.jsonData?.total
      ?? store?.getCount?.()
      ?? 0
    );
    const findPager = (store) => {
      let matched = null;
      try {
        Ext?.ComponentMgr?.all?.each?.((cmp) => {
          if (matched) return;
          const cmpStore = cmp.getStore?.() || cmp.store;
          if (cmpStore === store && typeof cmp.doLoad === "function") matched = cmp;
        });
      } catch {}
      return matched || Ext?.getCmp?.("billView_pagingbar") || Ext?.getCmp?.("pagingbar");
    };
    const expected = ${expected};
    const begin = Date.now();
    let last = { rows: [], total: 0 };
    let grid = null;
    let store = null;
    let reloadTriggered = 0;
    while (Date.now() - begin < 60000) {
      grid = globalThis.Ext?.getCmp?.("GridResultView");
      store = grid?.getStore?.();
      if (store) {
        const rows = store.getRange?.().map((record) => simplify(record.data)) || [];
        const total = storeTotal(store) || rows.length;
        last = { rows, total };
        if (rows.length > 0 || (expected <= 0 && total === 0)) break;
        if (expected > 0 && reloadTriggered < 3 && Date.now() - begin > 2500 * (reloadTriggered + 1)) {
          reloadTriggered += 1;
          try {
            const params = {
              ...(store.baseParams || {}),
              ...((store.lastOptions && store.lastOptions.params) || {}),
              start: 0,
              limit: Math.max(25, expected),
            };
            store.load?.({ params });
          } catch (e) {}
        }
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    if (!store) return resolve({ ok: false, ...last, url: location.href, message: "list grid timeout" });
    const rows = [];
    const seen = new Set();
    const addRows = () => {
      const current = store.getRange?.().map((record) => simplify(record.data)) || [];
      for (const row of current) {
        const key = row.ID || row.RID || row.DEPTID + "|" + row.HSDXID + "|" + row.XMMC + "|" + row.HSDX;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    };
    const waitLoad = async (loader) => {
      await new Promise((done) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          done();
        };
        try { store.on?.("load", finish, null, { single: true }); } catch {}
        try { store.on?.("datachanged", finish, null, { single: true }); } catch {}
        try { loader(); } catch { finish(); }
        setTimeout(finish, 5000);
      });
      await new Promise((done) => setTimeout(done, 500));
    };
    addRows();
    const total = storeTotal(store) || last.total || rows.length;
    const pageSize = Number(store.pageSize || store.getPageSize?.() || store.getRange?.().length || 25) || 25;
    const pager = findPager(store);
    for (let start = pageSize; start < total && rows.length < total; start += pageSize) {
      await waitLoad(() => {
        if (pager?.doLoad) pager.doLoad(start);
        else if (store.loadPage) store.loadPage(Math.floor(start / pageSize) + 1);
        else store.load({ params: { start, limit: pageSize } });
      });
      addRows();
    }
    const ok = rows.length === expected || (rows.length >= total && total > 0) || (expected > 0 && rows.length >= expected);
    resolve({
      ok,
      rows,
      total,
      pageSize,
      url: location.href,
      reloadTriggered,
      message: rows.length >= expected ? "" : "list grid incomplete",
    });
  }))()`, 75000));

  const rows = value?.rows || [];
  return {
    rows,
    check: {
      company: company.company,
      type: typeDef.type,
      status: typeDef.status,
      expected,
      actual: rows.length,
      total: value?.total ?? rows.length,
      pageSize: value?.pageSize ?? rows.length,
      ok: rows.length >= expected,
      attempt,
      attempts: attempt,
      sourcePlatform: "big-pm",
      message: value?.message || (rows.length < expected ? "detail list shorter than summary" : ""),
    },
  };
}

async function collectListRows(company, typeDef) {
  const expected = Number(company[typeDef.type]) || 0;
  if (!expected || !company.gsid) return { rows: [], check: null };
  let best = null;
  let usedAttempts = 0;
  const errors = [];
  for (let attempt = 1; attempt <= listCaptureAttempts; attempt += 1) {
    usedAttempts = attempt;
    try {
      const result = await collectListRowsOnce(company, typeDef, attempt);
      if (!best || (result.rows || []).length > (best.rows || []).length) best = result;
      if ((result.rows || []).length >= expected) break;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
    await sleep(1200 + attempt * 300);
  }
  const rows = best?.rows || [];
  const check = {
    ...(best?.check || {}),
    company: company.company,
    type: typeDef.type,
    status: typeDef.status,
    expected,
    actual: rows.length,
    total: best?.check?.total ?? rows.length,
    ok: rows.length >= expected,
    attempts: usedAttempts || listCaptureAttempts,
    sourcePlatform: "big-pm",
  };
  if (rows.length < expected) {
    check.message = [
      `summary/detail mismatch: expected ${expected}, captured ${rows.length}`,
      best?.check?.message,
      errors.length ? `errors: ${errors.join("; ")}` : "",
    ].filter(Boolean).join("; ");
  }
  return { rows, check };
}

const approvalListStoreExpression = `(() => {
  const simplify = (value) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(simplify);
    const out = {};
    for (const key of Object.keys(value)) {
      if (typeof value[key] !== "function") out[key] = simplify(value[key]);
    }
    return out;
  };
  const storeTotal = (store) => Number(
    store?.getTotalCount?.()
    || store?.totalLength
    || store?.getTotalLength?.()
    || store?.reader?.jsonData?.totalCount
    || store?.reader?.jsonData?.total
    || store?.getCount?.()
    || 0
  );
  const grid = globalThis.Ext?.getCmp?.("billView");
  const store = grid?.getStore?.();
  if (!store) return { ok: false, message: "approval billView store not found", url: location.href };
  const rows = store.getRange?.().map((record) => simplify(record.data)) || [];
  return {
    ok: true,
    url: location.href,
    total: Math.max(storeTotal(store), rows.length),
    pageSize: Number(store.pageSize || store.baseParams?.limit || store.lastOptions?.params?.limit || rows.length || 25),
    rows,
  };
})()`;

function approvalListLoadExpression(start, limit) {
  return `(() => new Promise((resolve) => {
    const grid = globalThis.Ext?.getCmp?.("billView");
    const store = grid?.getStore?.();
    const pager = globalThis.Ext?.getCmp?.("billView_pagingbar")
      || globalThis.Ext?.getCmp?.("pagingbar");
    if (!store) return resolve({ ok: false, message: "approval billView store not found" });
    let done = false;
    const finish = (message = "") => {
      if (done) return;
      done = true;
      resolve({ ok: true, start: ${start}, message });
    };
    try { store.on?.("load", () => finish("load"), null, { single: true }); } catch {}
    try { store.on?.("datachanged", () => finish("datachanged"), null, { single: true }); } catch {}
    try {
      if (pager?.doLoad) pager.doLoad(${start});
      else store.load({ params: { ...(store.baseParams || {}), start: ${start}, limit: ${limit} }, callback: () => finish("callback") });
    } catch (error) {
      finish(error?.message || String(error));
    }
    setTimeout(() => finish("timeout"), 5000);
  }))()`;
}

async function collectApprovalBills() {
  const url = buildUrl(approvalListPageBase, {
    autoLoad: "true",
    menuitemid: 1011831,
    frame: 400001,
    modulecode: "YJJT.CBZHFX.XMCBWCQKSPBModule",
    layout: "C",
    _dc: Date.now(),
  });
  const frameHelpers = `
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
    const storeTotal = (store) => Number(
      store?.getTotalCount?.()
      || store?.totalLength
      || store?.getTotalLength?.()
      || store?.reader?.jsonData?.totalCount
      || store?.reader?.jsonData?.total
      || store?.getCount?.()
      || 0
    );
    const frameHref = (frame) => {
      try { return String(frame?.contentWindow?.location?.href || ""); } catch (_err) { return ""; }
    };
    const findExistingFrame = () => [...document.querySelectorAll("iframe")]
      .find((frame) => frameHref(frame).includes("XMCBWCQKSPBListPage"));
    const getFrame = (targetUrl) => {
      let frame = findExistingFrame() || document.getElementById("codexBigPmApprovalListFrame");
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "codexBigPmApprovalListFrame";
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1500px;height:900px;border:0;visibility:hidden;";
        document.body.appendChild(frame);
      }
      if (!frameHref(frame).includes("XMCBWCQKSPBListPage")) frame.src = targetUrl;
      return frame;
    };
    const getStoreInfo = (frame) => {
      const win = frame?.contentWindow;
      const grid = win?.Ext?.getCmp?.("billView");
      const store = grid?.getStore?.();
      return { win, grid, store };
    };
  `;
  const ensureFrameExpression = `(() => {
    const targetUrl = ${JSON.stringify(url)};
    ${frameHelpers}
    const frame = getFrame(targetUrl);
    const { store } = getStoreInfo(frame);
    return { ok: true, hasStore: !!store, url: frameHref(frame) || targetUrl };
  })()`;
  const readPageExpression = `(() => {
    const targetUrl = ${JSON.stringify(url)};
    ${frameHelpers}
    const frame = getFrame(targetUrl);
    const { store } = getStoreInfo(frame);
    if (!store) return { ok: false, message: "approval billView store not found", url: frameHref(frame) || targetUrl };
    const fields = store.fields?.items?.map((field) => field.name) || [];
    const rows = store.getRange?.().map((record) => simplify(record.data)) || [];
    return {
      ok: true,
      url: frameHref(frame),
      total: Math.max(storeTotal(store), rows.length),
      pageSize: Number(store.pageSize || store.baseParams?.limit || store.lastOptions?.params?.limit || rows.length || 25),
      fields,
      rows,
    };
  })()`;
  const loadPageExpression = (start, limit) => `(() => {
    const targetUrl = ${JSON.stringify(url)};
    const start = ${Number(start) || 0};
    const limit = ${Number(limit) || 25};
    ${frameHelpers}
    const frame = getFrame(targetUrl);
    const { win, store } = getStoreInfo(frame);
    if (!store) return { ok: false, message: "approval billView store not found", url: frameHref(frame) || targetUrl };
    try {
      const pager = win?.Ext?.getCmp?.("billView_pagingbar") || win?.Ext?.getCmp?.("pagingbar");
      if (pager?.doLoad) {
        pager.doLoad(start);
      } else {
        store.load({ params: { ...(store.baseParams || {}), start, limit } });
      }
      return { ok: true, start, url: frameHref(frame) };
    } catch (error) {
      return { ok: false, start, message: error?.message || String(error), url: frameHref(frame) };
    }
  })()`;
  return withPortal(async (send) => {
    debugLog("approval list: opening hidden/current frame", url);
    let ready = null;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      ready = await evaluate(send, ensureFrameExpression, 15000);
      if (ready?.hasStore) break;
      await sleep(1000);
    }
    if (!ready?.hasStore) return { rows: [], total: 0, error: "approval list frame did not load billView store" };
    await evaluate(send, loadPageExpression(0, 25), 15000);
    await sleep(2500);
    let first = await evaluate(send, readPageExpression, 30000);
    if (!first?.ok) return { rows: [], total: 0, error: first?.message || "approval list read failed" };
    debugLog("approval list: first page", { total: first.total, pageSize: first.pageSize, rows: first.rows?.length || 0, url: first.url });
    const rows = [];
    const seen = new Set();
    const addRows = (items) => {
      for (const row of items || []) {
        const key = row.ID || row.RID || row.Code || `${row.DeptName}|${row.TJNF}|${enumText(row.TJYF)}|${row.HSDXIds}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    };
    const testLimit = Math.max(0, Number(process.env.PM_WARNING_BIG_PM_APPROVAL_LIMIT || 0) || 0);
    const enoughForProbe = () => testLimit > 0 && rows.filter((bill) => {
      const year = Number(bill.TJNF);
      const month = billMonth(bill);
      const companyText = clean(bill.EP_JCDW || bill.SSGS || bill.DeptName);
      return year === periodYear
        && month === periodMonth
        && (!companyFilter || companyText.includes(companyFilter))
        && billIsUsable(bill);
    }).length >= testLimit;
    addRows(first.rows);
    const total = Number(first.total) || rows.length;
    const pageSize = Number(first.pageSize) || 25;
    if (enoughForProbe()) return { rows, total, pageSize, url: first.url };
    for (let start = pageSize; start < total; start += pageSize) {
      debugLog("approval list: page", start);
      await evaluate(send, loadPageExpression(start, pageSize), 15000);
      await sleep(2500);
      const page = await evaluate(send, readPageExpression, 30000);
      addRows(page?.rows || []);
      if (enoughForProbe()) break;
      if (rows.length >= total) break;
    }
    return { rows, total, pageSize, url: first.url };
  });
}

function billMonth(row) {
  const key = enumKey(row?.TJYF);
  const keyMatch = key.match(/^M(\d{1,2})$/i);
  if (keyMatch) return Number(keyMatch[1]);
  const textMatch = enumText(row?.TJYF).match(/(\d{1,2})月/);
  return textMatch ? Number(textMatch[1]) : null;
}

function billIsUsable(row) {
  if (row?.Deleted) return false;
  if (row?.Effective === true) return true;
  const state = enumText(row?.State);
  return state.includes("已提交") || state.includes("审批中") || state.includes("审批通过");
}

const approvalDetailStoreExpression = `(() => new Promise(async (resolve) => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const simplify = (value) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(simplify);
    const out = {};
    for (const key of Object.keys(value)) {
      if (typeof value[key] !== "function") out[key] = simplify(value[key]);
    }
    return out;
  };
  const begin = Date.now();
  let grid = null;
  while (Date.now() - begin < 20000) {
    grid = globalThis.Ext?.getCmp?.("gvXMMX");
    if (grid?.getStore?.()) break;
    await sleep(500);
  }
  const store = grid?.getStore?.();
  if (!store) return resolve({ ok: false, message: "approval detail gvXMMX store not found", url: location.href });
  const rows = store.getRange?.().map((record) => simplify(record.data)) || [];
  const fields = store.fields?.items?.map((field) => field.name) || [];
  const columns = (grid.getColumnModel?.().config || grid.columns || []).map((col) => ({
    header: String(col.header || col.text || "").replace(/\\s+/g, " ").trim(),
    dataIndex: col.dataIndex,
    hidden: !!col.hidden,
  }));
  resolve({ ok: true, url: location.href, rows, fields, columns });
}))()`;

async function collectApprovalDetailRows(bill) {
  const url = buildUrl(approvalEditPageBase, {
    modulecode: "YJJT.CBZHFX.XMCBWCQKSPBModule",
    THEMEBGBLUESTYLE: "false",
    HIDETHOUSAND: "false",
    IsAIHidden: "false",
    ModuleType: "DJ",
    BasePage_InjectJSFiles: "[object Object],[object Object]",
    IsEffectiveBillCanUploadFile: "false",
    IsJYLK: "true",
    Library_CWJCSSZ: "[object Object]",
    XCWDZIsEnabled: "[object Object]",
    PZFiledInfo: "false",
    DJFiledInfo: "false",
    XCWJKDZ: "true",
    XCWDJJKDZ1: "true",
    XCWDJJKDZ2: "true",
    id: bill.ID || bill.RID,
    ticks: 1,
    state: "STATE_VIEW",
    isDeleteBtnDisable: "true",
    title: "项目成本完成情况审批表",
    target: "_tab",
    tabID: `AppFrameV2Tab_YJJT_CBZHFX_XMCBWCQKSPBModule_${bill.ID || bill.RID}`,
    layout: "C",
    _dc: Date.now(),
  });
  const detailFrameHelpers = `
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
    const storeTotal = (store) => Number(
      store?.getTotalCount?.()
      || store?.totalLength
      || store?.getTotalLength?.()
      || store?.reader?.jsonData?.totalCount
      || store?.reader?.jsonData?.total
      || store?.getCount?.()
      || 0
    );
    const frameHref = (frame) => {
      try { return String(frame?.contentWindow?.location?.href || ""); } catch (_err) { return ""; }
    };
    const targetId = (() => {
      try { return new URL(targetUrl).searchParams.get("id") || ""; } catch (_err) { return ""; }
    })();
    const isTargetDetailFrame = (frame) => {
      const href = frameHref(frame);
      if (!href.includes("XMCBWCQKSPBEditPage")) return false;
      if (!targetId) return true;
      try { return new URL(href).searchParams.get("id") === targetId; } catch (_err) { return href.includes("id=" + targetId); }
    };
    const getFrame = () => {
      let frame = [...document.querySelectorAll("iframe")].find(isTargetDetailFrame)
        || document.getElementById("codexBigPmApprovalDetailFrame");
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "codexBigPmApprovalDetailFrame";
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1500px;height:950px;border:0;visibility:hidden;";
        document.body.appendChild(frame);
      }
      if (!isTargetDetailFrame(frame)) frame.src = targetUrl;
      return frame;
    };
    const getStoreInfo = (frame) => {
      const current = isTargetDetailFrame(frame);
      const win = current ? frame?.contentWindow : null;
      const grid = win?.Ext?.getCmp?.("gvXMMX");
      const store = grid?.getStore?.();
      return { current, win, grid, store };
    };
  `;
  const ensureDetailFrameExpression = `(() => {
    const targetUrl = ${JSON.stringify(url)};
    ${detailFrameHelpers}
    const frame = getFrame();
    const { current, store } = getStoreInfo(frame);
    return {
      ok: true,
      current,
      hasStore: current && !!store,
      rowCount: current && store?.getRange ? store.getRange().length : 0,
      url: frameHref(frame) || targetUrl,
    };
  })()`;
  const readDetailExpression = `(() => {
    const targetUrl = ${JSON.stringify(url)};
    ${detailFrameHelpers}
    const frame = getFrame();
    const { current, grid, store } = getStoreInfo(frame);
    if (!current || !store) {
      return { ok: false, message: "approval detail gvXMMX store not found", url: frameHref(frame) || targetUrl };
    }
    const rows = store.getRange?.() || [];
    const fields = store.fields?.items?.map((field) => field.name) || [];
    const columns = (grid.getColumnModel?.().config || grid.columns || []).map((col) => ({
      header: String(col.header || col.text || "").replace(/\\s+/g, " ").trim(),
      dataIndex: col.dataIndex,
      hidden: !!col.hidden,
    }));
    return {
      ok: true,
      url: frameHref(frame),
      rows: rows.map((record) => simplify(record.data)),
      fields,
      columns,
      total: Math.max(storeTotal(store), rows.length),
    };
  })()`;
  const loadDetailExpression = `(() => {
    const targetUrl = ${JSON.stringify(url)};
    ${detailFrameHelpers}
    const frame = getFrame();
    const { current, store } = getStoreInfo(frame);
    if (!current || !store) return { ok: false, message: "approval detail store not ready", url: frameHref(frame) || targetUrl };
    try {
      store.load?.();
      return { ok: true, url: frameHref(frame) };
    } catch (error) {
      return { ok: false, message: error?.message || String(error), url: frameHref(frame) };
    }
  })()`;
  return withPortal(async (send) => {
    debugLog("approval detail: opening", { billId: bill.ID || bill.RID, billCode: bill.Code });
    let ready = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      ready = await evaluate(send, ensureDetailFrameExpression, 15000);
      if (ready?.hasStore && (ready.rowCount > 0 || attempt >= 6)) break;
      await sleep(1000);
    }
    if (!ready?.hasStore) {
      const result = { ok: false, message: "approval detail gvXMMX store not found", url: ready?.url || url };
      debugLog("approval detail: result", { billId: bill.ID || bill.RID, ok: result.ok, rows: 0, message: result.message });
      return { ...result, billId: bill.ID || bill.RID, billCode: bill.Code };
    }
    let result = await evaluate(send, readDetailExpression, 30000);
    if (result?.ok && !result.rows?.length) {
      await evaluate(send, loadDetailExpression, 15000);
      await sleep(2500);
      result = await evaluate(send, readDetailExpression, 30000);
    }
    debugLog("approval detail: result", { billId: bill.ID || bill.RID, ok: result?.ok, rows: result?.rows?.length || 0, message: result?.message || "" });
    return { ...result, billId: bill.ID || bill.RID, billCode: bill.Code };
  });
}

function projectFromApprovalRow(row, bill, sequence) {
  const monthStatuses = {};
  for (const [offset, field] of [[-2, "SLGY"], [-1, "SYGY"], [0, "BYZDZ"]]) {
    const status = warningStatusFromColor(row[field]);
    if (status) monthStatuses[periodAddMonths(periodYear, periodMonth, offset)] = status;
  }
  const currentStatus = warningStatusFromColor(row.BYZDZ) || warningStatusFromType(row.XMLX);
  if (currentStatus) monthStatuses[period] = currentStatus;
  const maxStatus = Object.values(monthStatuses).sort((a, b) => warningRank(b) - warningRank(a))[0] || currentStatus;
  const status = currentStatus || maxStatus || "";
  const typeInfo = warningTypeFromStatus(status || maxStatus);
  const budget = finiteNumber(row.LJSQYSCBWY);
  const actual = finiteNumber(row.LJSQSJCBWY);
  const actualRate = finiteNumber(row.DYJDL);
  const hasActualRate = hasValue(row.DYJDL) && actualRate != null;
  const amountLogicIssue = hasActualRate
    && (!hasValue(row.LJSQYSCBWY) || !hasValue(row.LJSQSJCBWY) || (isZero(budget) && isZero(actual)))
    ? "platform-rate-without-budget-actual"
    : "";
  return {
    name: clean(row.XMMC),
    company: clean(bill.EP_JCDW || bill.SSGS || bill.DeptName),
    major: enumText(row.ZY) || clean(row.HSDX),
    hsdx: clean(row.HSDX),
    manager: clean(row.XMJL),
    status,
    displayStatus: status,
    warningStatus: status,
    type: typeInfo.type,
    t: typeInfo.t,
    monthlyStatuses: monthStatuses,
    projectStatus: enumText(row.EP_XMZT) || "在建",
    reduceDuty: row.MBZRSJDL ?? null,
    responsibilityTargetDisplay: row.MBZRSJDL ?? "待签",
    targetSignStatus: row.MBZRSJDL == null ? "待签" : "已取数",
    reduceActual: row.DYJDL ?? null,
    profitRate: row.SSCBJDL ?? row.YJCBJDL ?? row.BSCBJDL ?? null,
    budget: Number.isFinite(budget) ? round2(budget) : null,
    actual: Number.isFinite(actual) ? round2(actual) : null,
    reduction: Number.isFinite(finiteNumber(row.SQJDEWY)) ? round2(finiteNumber(row.SQJDEWY)) : null,
    amountLogicIssue,
    contract: Number.isFinite(finiteNumber(row.HTEWY)) ? round2(finiteNumber(row.HTEWY)) : null,
    reason: clean(row.YYFX),
    rectification: clean(row.ZGCS),
    deptId: row.DeptId || bill.DeptId,
    hsdxId: row.HSDXID || bill.HSDXIds,
    pid: row.MXID || row.ID || row.HSDXID || "",
    sequence,
    sourcePlatform: "big-pm",
    reportPeriod: period,
    queryPeriod: period,
    detailUrl: "",
    sourceRaw: {
      sourcePath: "cost-completion-approval",
      billId: bill.ID || bill.RID,
      billCode: bill.Code,
      billState: enumText(bill.State),
      billEffective: bill.Effective,
      billCompany: bill.EP_JCDW || bill.SSGS || "",
      billDeptName: bill.DeptName || "",
      billMonth: enumText(bill.TJYF),
      detailRowId: row.ID,
      xmlx: row.XMLX,
      monthColors: {
        previousTwo: row.SLGY,
        previousOne: row.SYGY,
        current: row.BYZDZ,
      },
      approvalRaw: row,
      contractSource: row.HTEWY != null ? "cost-completion-approval-contract" : "",
    },
  };
}

function dedupeApprovalProjects(projects) {
  const selected = new Map();
  for (const project of projects) {
    const key = [
      normalizeName(project.company),
      normalizeName(project.name),
      normalizeName(project.hsdx || project.major),
      project.reportPeriod,
    ].join("|");
    const current = selected.get(key);
    const currentBill = Number(current?.sourceRaw?.billId) || 0;
    const nextBill = Number(project?.sourceRaw?.billId) || 0;
    if (!current || nextBill >= currentBill) selected.set(key, project);
  }
  return [...selected.values()].map((project, index) => ({ ...project, sequence: index + 1 }));
}

function approvalListChecksFromProjects(projects) {
  const counts = new Map();
  for (const project of projects) {
    if (!warningRank(project.status)) continue;
    const key = `${project.company}|${project.type}|${project.status}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [company, type, status] = key.split("|");
    return {
      reportPeriod: period,
      company,
      type,
      status,
      expected: count,
      actual: count,
      total: count,
      ok: true,
      attempts: 1,
      sourcePlatform: "big-pm",
      sourcePath: "cost-completion-approval",
      message: "",
    };
  });
}

async function collectApprovalProjects() {
  debugLog("approval projects: start", { period, companyFilter });
  const bills = await collectApprovalBills();
  if (bills.error) return { projects: [], listChecks: [], bills: [], error: bills.error };
  const matching = (bills.rows || []).filter((bill) => {
    const year = Number(bill.TJNF);
    const month = billMonth(bill);
    const companyText = clean(bill.EP_JCDW || bill.SSGS || bill.DeptName);
    return year === periodYear
      && month === periodMonth
      && (!companyFilter || companyText.includes(companyFilter))
      && billIsUsable(bill);
  });
  debugLog("approval projects: bills", { totalRows: bills.rows?.length || 0, totalBills: bills.total || 0, matchedBills: matching.length });
  const limit = Math.max(0, Number(process.env.PM_WARNING_BIG_PM_APPROVAL_LIMIT || 0) || 0);
  const targetBills = limit ? matching.slice(0, limit) : matching;
  const projects = [];
  const errors = [];
  let sequence = 1;
  for (const bill of targetBills) {
    try {
      const detail = await collectApprovalDetailRows(bill);
      if (!detail?.ok) {
        errors.push({ billCode: bill.Code, message: detail?.message || "approval detail failed" });
        continue;
      }
      for (const row of detail.rows || []) {
        const project = projectFromApprovalRow(row, bill, sequence++);
        if (!warningRank(project.status) && !Object.values(project.monthlyStatuses || {}).some(warningRank)) continue;
        project.detailUrl = detail.url || "";
        projects.push(project);
      }
    } catch (error) {
      errors.push({ billCode: bill.Code, message: error?.message || String(error) });
    }
  }
  const deduped = dedupeApprovalProjects(projects);
  return {
    projects: deduped,
    listChecks: approvalListChecksFromProjects(deduped),
    bills: targetBills,
    totalBills: bills.total,
    matchedBills: matching.length,
    errors,
  };
}

async function collectDetail(row) {
  const url = buildUrl(detailPageBase, {
    DEPTID: row.DEPTID,
    HSDX: row.HSDX,
    HSDXID: row.HSDXID,
    state: "STATE_VIEW",
    modulecode: "YJJT.CBFXGL.XMCBDBFXBQueryModule",
    _dc: Date.now(),
  });
  return withTarget(url, async (send) => evaluate(send, `(() => new Promise(async (resolve) => {
    const periodYear = ${periodYear};
    const periodMonth = ${periodMonth};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const targetMonth = new Date(periodYear, periodMonth - 1, 1);
    const begin = Date.now();
    while (Date.now() - begin < 30000) {
      if (globalThis.Ext?.getCmp?.("treeGrid") && Ext.getCmp("DateFieldStart") && Ext.getCmp("btnSearch")) break;
      await sleep(500);
    }
    const tree = Ext.getCmp("treeGrid");
    const start = Ext.getCmp("DateFieldStart");
    const end = Ext.getCmp("DateFieldEnd");
    const search = Ext.getCmp("btnSearch");
    if (!tree || !start || !search) {
      return resolve({ ok: false, message: "missing detail controls", url: location.href });
    }
    const initialStore = tree.getStore?.();
    const waitForRefresh = new Promise((done) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        done();
      };
      try { initialStore?.on?.("load", finish, null, { single: true }); } catch {}
      try { initialStore?.on?.("datachanged", finish, null, { single: true }); } catch {}
    });
    try {
      start.clearValue?.();
      start.setValue(null);
      start.setRawValue?.("");
      start.fireEvent?.("change", start, null);
      if (end) {
        end.setValue(targetMonth);
        end.setRawValue?.(periodYear + "-" + String(periodMonth).padStart(2, "0"));
        end.fireEvent?.("select", end, targetMonth);
        end.fireEvent?.("change", end, targetMonth);
      }
      search.handler.call(search, search);
    } catch (error) {
      return resolve({ ok: false, message: error?.message || String(error), url: location.href });
    }
    await Promise.race([waitForRefresh, sleep(25000)]);
    await sleep(1500);
    let store = null;
    let rows = [];
    const loadBegin = Date.now();
    while (Date.now() - loadBegin < 30000) {
      store = tree.getStore?.();
      rows = store?.getRange?.() || [];
      if (rows.length > 0) break;
      await sleep(600);
    }
    const fields = store?.fields?.items?.map((field) => field.name) || [];
    const recordData = (record) => {
      if (!record) return null;
      const row = {};
      const dataFields = fields.length ? fields : Object.keys(record.data || {});
      for (const field of dataFields) {
        const value = record.get?.(field);
        row[field] = value === undefined ? record.data?.[field] : value;
      }
      return row;
    };
    const rowName = (record) => clean(record.get?.("NAME") || record.data?.NAME);
    const noTaxRecord = rows.find((record) => rowName(record).includes("合计行") && rowName(record).includes("不含税"))
      || rows.find((record) => clean(record.get?.("CBKMZDBM") || record.data?.CBKMZDBM) === "BHSGDH")
      || rows.find((record) => clean(record.get?.("CODE") || record.data?.CODE) === "BHSGDH")
      || rows.find((record) => rowName(record).includes("合计行") && !rowName(record).includes("目标责任成本降低公式"))
      || null;
    const rateRecord = rows.find((record) => rowName(record).includes("目标责任成本降低公式")) || noTaxRecord;
    const noTax = recordData(noTaxRecord);
    const rateRaw = recordData(rateRecord);
    const reasonGrid = Ext.getCmp("gridView_YYFX");
    const reasonRows = reasonGrid?.getStore?.().getRange?.().map((record) => record.data) || [];
    resolve({
      ok: true,
      url: location.href,
      rawValues: {
        start: start.getRawValue?.() || "",
        end: end?.getRawValue?.() || "",
      },
      noTax,
      rateRaw,
      debug: {
        fieldCount: fields.length,
        rowCount: rows.length,
        matchedName: clean(noTaxRecord?.get?.("NAME") || noTaxRecord?.data?.NAME || ""),
        rateMatchedName: clean(rateRecord?.get?.("NAME") || rateRecord?.data?.NAME || ""),
      },
      reasonRows,
    });
  }))()`, 60000));
}

const totalPlanStoreExpression = `(() => {
  const simplify = (value) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(simplify);
    const out = {};
    for (const key of Object.keys(value)) {
      if (typeof value[key] !== "function") out[key] = simplify(value[key]);
    }
    return out;
  };
  const storeTotal = (store) => Number(
    store?.getTotalCount?.()
    || store?.totalLength
    || store?.getTotalLength?.()
    || store?.reader?.jsonData?.totalCount
    || store?.reader?.jsonData?.total
    || store?.getCount?.()
    || 0
  );
  const stores = [];
  Ext?.ComponentMgr?.all?.each?.((cmp) => {
    const store = cmp.getStore?.() || cmp.store;
    const fields = store?.fields?.items?.map((field) => field.name) || [];
    if (fields.includes("TBYSHSJE") && fields.includes("DeptName")) {
      stores.push({
        cmpId: cmp.id,
        store,
        total: storeTotal(store),
        pageSize: Number(store?.pageSize || store?.baseParams?.limit || store?.lastOptions?.params?.limit || 25),
      });
    }
  });
  stores.sort((a, b) => b.total - a.total);
  const chosen = stores[0];
  if (!chosen?.store) return { ok: false, message: "total plan store not found", url: location.href };
  const rows = chosen.store.getRange?.().map((record) => simplify(record.data)) || [];
  return {
    ok: true,
    url: location.href,
    cmpId: chosen.cmpId,
    total: Math.max(chosen.total, rows.length),
    pageSize: chosen.pageSize || rows.length || 25,
    rows,
  };
})()`;

function totalPlanLoadExpression(start, limit) {
  return `(() => new Promise((resolve) => {
    const storeTotal = (store) => Number(
      store?.getTotalCount?.()
      || store?.totalLength
      || store?.getTotalLength?.()
      || store?.reader?.jsonData?.totalCount
      || store?.reader?.jsonData?.total
      || store?.getCount?.()
      || 0
    );
    const stores = [];
    Ext?.ComponentMgr?.all?.each?.((cmp) => {
      const store = cmp.getStore?.() || cmp.store;
      const fields = store?.fields?.items?.map((field) => field.name) || [];
      if (fields.includes("TBYSHSJE") && fields.includes("DeptName")) {
        stores.push({ store, total: storeTotal(store) });
      }
    });
    stores.sort((a, b) => b.total - a.total);
    const store = stores[0]?.store;
    const pager = Ext.getCmp?.("billView_pagingbar");
    if (!store) return resolve({ ok: false, message: "total plan store not found" });
    let done = false;
    const finish = (message = "") => {
      if (done) return;
      done = true;
      resolve({ ok: true, start: ${start}, message });
    };
    try { store.on?.("load", () => finish("load"), null, { single: true }); } catch {}
    try {
      if (pager?.doLoad) pager.doLoad(${start});
      else store.load({ params: { start: ${start}, limit: ${limit} }, callback: () => finish("callback") });
    } catch (error) {
      finish(error?.message || String(error));
    }
    setTimeout(() => finish("timeout"), 2500);
  }))()`;
}

async function collectTotalPlanRows() {
  const url = buildUrl(totalPlanPageBase, {
    menuitemid: 1005639,
    frame: 4000401285,
    modulecode: "YJJT.ZCBJHBZMK.ZCBJHBZModule",
    _dc: Date.now(),
  });
  return withTarget(url, async (send) => {
    await sleep(3000);
    const first = await evaluate(send, totalPlanStoreExpression, 60000);
    if (!first?.ok) return { rows: [], total: 0, error: first?.message || "total plan read failed" };
    const rows = [];
    const seen = new Set();
    const addRows = (items) => {
      for (const row of items || []) {
        const key = row.ID || row.RID || row.Code || `${row.DeptName}|${row.HSDX}|${row.TBYSHSJE}|${row.State?.name || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    };
    addRows(first.rows);
    const total = Number(first.total) || rows.length;
    const pageSize = Number(first.pageSize) || 25;
    for (let start = pageSize; start < total; start += pageSize) {
      await evaluate(send, totalPlanLoadExpression(start, pageSize), 30000);
      const page = await evaluate(send, totalPlanStoreExpression, 30000);
      addRows(page?.rows || []);
      if (rows.length >= total) break;
    }
    return { rows, total, pageSize };
  });
}

const projectBasicStoreExpression = `(() => {
  const simplify = (value) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(simplify);
    const out = {};
    for (const key of Object.keys(value)) {
      if (typeof value[key] !== "function") out[key] = simplify(value[key]);
    }
    return out;
  };
  const storeTotal = (store) => Number(
    store?.getTotalCount?.()
    || store?.totalLength
    || store?.getTotalLength?.()
    || store?.reader?.jsonData?.totalCount
    || store?.reader?.jsonData?.total
    || store?.getCount?.()
    || 0
  );
  const stores = [];
  Ext?.ComponentMgr?.all?.each?.((cmp) => {
    const store = cmp.getStore?.() || cmp.store;
    const fields = store?.fields?.items?.map((field) => field.name) || [];
    if (fields.includes("EP_HTZJ") && fields.includes("SGXMBM_Name")) {
      stores.push({
        cmpId: cmp.id,
        store,
        total: storeTotal(store),
        pageSize: Number(store?.pageSize || store?.baseParams?.limit || store?.lastOptions?.params?.limit || 25),
      });
    }
  });
  stores.sort((a, b) => b.total - a.total);
  const chosen = stores[0];
  if (!chosen?.store) return { ok: false, message: "project basic store not found", url: location.href };
  const rows = chosen.store.getRange?.().map((record) => simplify(record.data)) || [];
  return {
    ok: true,
    url: location.href,
    cmpId: chosen.cmpId,
    total: Math.max(chosen.total, rows.length),
    pageSize: chosen.pageSize || rows.length || 25,
    rows,
  };
})()`;

function projectBasicLoadExpression(start, limit) {
  return `(() => new Promise((resolve) => {
    const storeTotal = (store) => Number(
      store?.getTotalCount?.()
      || store?.totalLength
      || store?.getTotalLength?.()
      || store?.reader?.jsonData?.totalCount
      || store?.reader?.jsonData?.total
      || store?.getCount?.()
      || 0
    );
    const stores = [];
    Ext?.ComponentMgr?.all?.each?.((cmp) => {
      const store = cmp.getStore?.() || cmp.store;
      const fields = store?.fields?.items?.map((field) => field.name) || [];
      if (fields.includes("EP_HTZJ") && fields.includes("SGXMBM_Name")) {
        stores.push({ store, total: storeTotal(store) });
      }
    });
    stores.sort((a, b) => b.total - a.total);
    const store = stores[0]?.store;
    const pager = Ext.getCmp?.("billView_pagingbar");
    if (!store) return resolve({ ok: false, message: "project basic store not found" });
    let done = false;
    const finish = (message = "") => {
      if (done) return;
      done = true;
      resolve({ ok: true, start: ${start}, message });
    };
    try { store.on?.("load", () => finish("load"), null, { single: true }); } catch {}
    try {
      if (pager?.doLoad) pager.doLoad(${start});
      else store.load({ params: { start: ${start}, limit: ${limit} }, callback: () => finish("callback") });
    } catch (error) {
      finish(error?.message || String(error));
    }
    setTimeout(() => finish("timeout"), 2500);
  }))()`;
}

async function collectProjectBasicRows() {
  const url = buildUrl(projectBasicPageBase, {
    menuitemid: 1003313,
    frame: 400043,
    modulecode: "GEPS.Project.XMJBXXModule",
    _dc: Date.now(),
  });
  return withTarget(url, async (send) => {
    await sleep(3000);
    const first = await evaluate(send, projectBasicStoreExpression, 60000);
    if (!first?.ok) return { rows: [], total: 0, error: first?.message || "project basic read failed" };
    const rows = [];
    const seen = new Set();
    const addRows = (items) => {
      for (const row of items || []) {
        const key = row.ID || row.RID || row.Code || `${row.Name}|${row.SGXMBM_Name}|${row.EP_HTZJ}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    };
    addRows(first.rows);
    const total = Number(first.total) || rows.length;
    const pageSize = Number(first.pageSize) || 25;
    for (let start = pageSize; start < total; start += pageSize) {
      await evaluate(send, projectBasicLoadExpression(start, pageSize), 30000);
      const page = await evaluate(send, projectBasicStoreExpression, 30000);
      addRows(page?.rows || []);
      if (rows.length >= total) break;
    }
    return { rows, total, pageSize };
  });
}

function applyContractAmounts(projects, totalPlanRows) {
  const planRows = totalPlanRows || [];
  for (const project of projects) {
    if (project.contract != null && project.contract !== "") continue;
    const projectMajor = normalizeName(project.hsdx || project.major);
    if (!clean(project.name)) continue;
    const projectCompany = normalizeName(project.company);
    const nameCandidates = planRows.filter((row) => {
      const nameHit = planNameMatches(project.name, row.DeptName);
      if (!nameHit) return false;
      const rowCompany = normalizeName(row.EP_JCDWYJGJ || row.SSGS || row.CompanyName);
      return !projectCompany || !rowCompany || projectCompany.includes(rowCompany) || rowCompany.includes(projectCompany);
    });
    const sameMajorCandidates = nameCandidates.filter((row) => {
      const rowMajor = normalizeName(row.HSDX);
      const majorHit = !projectMajor || !rowMajor || rowMajor.includes(projectMajor) || projectMajor.includes(rowMajor);
      return majorHit;
    });
    const sameMajorHasAmount = sameMajorCandidates.some((row) => (finiteNumber(row.TBYSHSJE) || 0) > 0);
    const candidates = sameMajorHasAmount ? sameMajorCandidates : nameCandidates;
    if (!candidates.length) {
      project.sourceRaw = { ...(project.sourceRaw || {}), contractMatch: { candidates: 0, approved: 0 } };
      continue;
    }
    const approved = candidates.filter((row) =>
      row.State?.name === "ApprovePass" || row.State?.alias?.zh_CN === "审批通过"
    );
    const approvedWithAmount = approved.filter((row) => (finiteNumber(row.TBYSHSJE) || 0) > 0);
    const candidatesWithAmount = candidates.filter((row) => (finiteNumber(row.TBYSHSJE) || 0) > 0);
    const selected = approvedWithAmount.length ? approvedWithAmount : candidatesWithAmount;
    if (!selected.length) {
      project.sourceRaw = {
        ...(project.sourceRaw || {}),
        contractMatch: {
          candidates: candidates.length,
          approved: approved.length,
          withAmount: 0,
          message: "总成本计划已匹配但投标预算含税金额为空",
        },
      };
      continue;
    }
    const amountYuan = selected.reduce((sum, row) => sum + (finiteNumber(row.TBYSHSJE) || 0), 0);
    if (amountYuan > 0) {
      project.contract = wan(amountYuan);
      delete project.contractNoData;
      project.sourceRaw = {
        ...(project.sourceRaw || {}),
        contractMatch: {
          candidates: candidates.length,
          sameMajor: sameMajorHasAmount,
          approved: approved.length,
          withAmount: candidatesWithAmount.length,
          used: selected.length,
          amountYuan,
          source: approvedWithAmount.length ? "total-plan-approved" : "total-plan-unapproved",
          rows: selected.map((row) => ({
            code: row.Code,
            deptName: row.DeptName,
            hsdx: row.HSDX,
            state: row.State?.alias?.zh_CN || row.State?.name || "",
            amountYuan: row.TBYSHSJE,
          })),
        },
      };
    }
  }
}

function applyBasicInfoContractAmounts(projects, basicRows) {
  const rows = basicRows || [];
  for (const project of projects) {
    if (project.contract != null && project.contract !== "") continue;
    const candidates = rows.filter((row) => {
      const nameHit = namesOverlap(project.name, row.SGXMBM_Name)
        || namesOverlap(project.name, row.Name);
      if (!nameHit) return false;
      const projectCompany = normalizeName(project.company);
      const rowCompany = normalizeName(row.SGDWBM_Name || row.DeptName);
      return !projectCompany || !rowCompany || projectCompany.includes(rowCompany) || rowCompany.includes(projectCompany);
    });
    const withAmount = candidates
      .map((row) => ({ row, amountYuan: finiteNumber(row.EP_HTZJ) }))
      .filter((item) => item.amountYuan != null && item.amountYuan > 0);
    if (!withAmount.length) {
      project.sourceRaw = {
        ...(project.sourceRaw || {}),
        contractBasicMatch: {
          candidates: candidates.length,
          withAmount: 0,
        },
      };
      continue;
    }
    withAmount.sort((a, b) => {
      const aExact = normalizeName(a.row.SGXMBM_Name || a.row.Name) === normalizeName(project.name) ? 1 : 0;
      const bExact = normalizeName(b.row.SGXMBM_Name || b.row.Name) === normalizeName(project.name) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (Number(b.row.ID) || 0) - (Number(a.row.ID) || 0);
    });
    const selected = withAmount[0];
    project.contract = wan(selected.amountYuan);
    delete project.contractNoData;
    project.sourceRaw = {
      ...(project.sourceRaw || {}),
      contractBasicMatch: {
        candidates: candidates.length,
        withAmount: withAmount.length,
        amountYuan: selected.amountYuan,
        source: "project-basic-contract-price",
        row: {
          id: selected.row.ID,
          code: selected.row.Code,
          name: selected.row.Name,
          constructionProject: selected.row.SGXMBM_Name,
          company: selected.row.SGDWBM_Name || selected.row.DeptName,
          amountYuan: selected.row.EP_HTZJ,
        },
      },
    };
  }
}

function clearAutoContractNoData(projects) {
  for (const project of projects) {
    if (project.contract != null && project.contract !== "") {
      delete project.contractNoData;
      delete project.contractNoDataVerified;
      continue;
    }
    delete project.contractNoData;
    if (project.sourceRaw && typeof project.sourceRaw === "object") {
      delete project.sourceRaw.contractNoData;
    }
  }
}

function matchWithAmount(match) {
  if (!match || typeof match !== "object") return false;
  const amountYuan = finiteNumber(match.amountYuan);
  if (amountYuan != null && amountYuan !== 0) return true;
  return Number(match.withAmount || 0) > 0;
}

function markVerifiedContractNoData(projects) {
  for (const project of projects) {
    if (project.contract != null && project.contract !== "") {
      delete project.contractNoDataVerified;
      continue;
    }
    const raw = project.sourceRaw || {};
    const contractMatch = raw.contractMatch;
    const contractBasicMatch = raw.contractBasicMatch;
    const bothPathsChecked = contractMatch && typeof contractMatch === "object"
      && contractBasicMatch && typeof contractBasicMatch === "object";
    const hasAmount = matchWithAmount(contractMatch) || matchWithAmount(contractBasicMatch);
    if (bothPathsChecked && !hasAmount) {
      project.contractNoDataVerified = true;
    } else {
      delete project.contractNoDataVerified;
    }
  }
}

function projectFromRow(row, company, typeDef, detail, sequence) {
  const total = detail?.noTax || {};
  const rateRaw = detail?.rateRaw || {};
  const listBudgetYuan = finiteNumber(row.LJYSCBJE);
  const listActualYuan = finiteNumber(row.LJSJCBJE);
  let budgetYuan = finiteNumber(total.YSCB_JE);
  let actualYuan = finiteNumber(total.SJCB_JE);
  let reductionYuan = finiteNumber(total.YSCBYSJCB_JDE);
  const detailMatchedName = clean(detail?.debug?.matchedName);
  const detailIsRealTotal = detailMatchedName.includes("合计行") || clean(total.CBKMZDBM) === "BHSGDH" || clean(total.CODE) === "BHSGDH";
  const reduceActual = rateRaw.YSCBYSJCB_JDL ?? total.YSCBYSJCB_JDL ?? row.SJJDL ?? row.XMLRL ?? null;
  const reduceDuty = total.MBCBYSJCB_JDL ?? rateRaw.MBCBYSJCB_JDL ?? row.ZRSBM ?? null;
  const actualRate = finiteNumber(reduceActual);
  const hasActualRate = hasValue(reduceActual) && actualRate != null;
  const impossibleZeroAmounts = hasActualRate
    && isZero(budgetYuan)
    && isZero(actualYuan)
    && (hasValue(listBudgetYuan) || hasValue(listActualYuan));
  if (!detailIsRealTotal || impossibleZeroAmounts) {
    reductionYuan = null;
  }
  const needListFallback = !detailIsRealTotal
    || impossibleZeroAmounts
    || (!hasValue(budgetYuan) && hasValue(listBudgetYuan))
    || (!hasValue(actualYuan) && hasValue(listActualYuan));
  if (needListFallback) {
    if (hasValue(listBudgetYuan)) budgetYuan = listBudgetYuan;
    if (hasValue(listActualYuan)) actualYuan = listActualYuan;
  }
  const amountLogicIssue = hasActualRate
    && (!hasValue(budgetYuan) || !hasValue(actualYuan) || (isZero(budgetYuan) && isZero(actualYuan)))
    ? "actual-rate-without-budget-actual"
    : "";
  const reason = (detail?.reasonRows || [])
    .map((item) => clean(item.YYFX))
    .filter(Boolean)
    .join("\n");
  return {
    name: clean(row.XMMC || row.XMName || row.PROJECTNAME),
    company: company.company,
    major: clean(row.ZYLX || row.HSDX),
    hsdx: clean(row.HSDX),
    manager: clean(row.XMJL || row.XMFZR),
    status: typeDef.status,
    displayStatus: typeDef.status,
    type: typeDef.type,
    t: typeDef.t,
    projectStatus: clean(row.XMZT) || "在建",
    reduceDuty,
    responsibilityTargetDisplay: reduceDuty ?? "待签",
    targetSignStatus: reduceDuty == null ? "待签" : "已取数",
    reduceActual,
    profitRate: row.XMLRL ?? null,
    budget: Number.isFinite(budgetYuan) ? wan(budgetYuan) : null,
    actual: Number.isFinite(actualYuan) ? wan(actualYuan) : null,
    reduction: Number.isFinite(reductionYuan) ? wan(reductionYuan) : null,
    amountLogicIssue,
    contract: null,
    reason,
    deptId: row.DEPTID,
    hsdxId: row.HSDXID,
    pid: row.XMMCID || row.XMID || row.PROJECTID || "",
    sequence,
    sourcePlatform: "big-pm",
    reportPeriod: period,
    queryPeriod: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
    detailUrl: detail?.url || "",
    sourceRaw: {
      gsid: row.SSGSID || company.gsid,
      listBudgetYuan: row.LJYSCBJE,
      listActualYuan: row.LJSJCBJE,
      detailRaw: total,
      rateRaw,
      detailDebug: detail?.debug || null,
      usedListAmountFallback: needListFallback,
      queryRawValues: detail?.rawValues || null,
    },
  };
}

function updateTotalsFromCapturedProjects(data, capturedProjects) {
  const currentProjects = (capturedProjects || []).filter((project) => project.reportPeriod === period || !project.reportPeriod);
  const red = currentProjects.filter((project) => warningRank(project.status) >= 2).length;
  const blue = currentProjects.filter((project) => warningRank(project.status) === 1).length;
  const inProgress = Number(data.totals?.inProgress || data.totals?.total || 0);
  data.totals = {
    ...(data.totals || {}),
    red,
    blue,
    normal: inProgress ? Math.max(0, inProgress - red - blue) : Number(data.totals?.normal || 0),
    detailProjects: capturedProjects.length,
  };
  const counts = new Map();
  for (const project of currentProjects) {
    const key = clean(project.company);
    if (!key) continue;
    const row = counts.get(key) || { red: 0, blue: 0 };
    if (warningRank(project.status) >= 2) row.red += 1;
    else if (warningRank(project.status) === 1) row.blue += 1;
    counts.set(key, row);
  }
  if (Array.isArray(data.companies)) {
    data.companies = data.companies.map((company) => {
      const count = counts.get(clean(company.company)) || { red: 0, blue: 0 };
      const total = Number(company.total || company.inProgress || 0);
      return {
        ...company,
        red: count.red,
        blue: count.blue,
        normal: total ? Math.max(0, total - count.red - count.blue) : Number(company.normal || 0),
      };
    });
  }
}

const data = readJson(resultPath);
const typeDefs = [
  { type: "red", t: "ks", code: "KS", status: "红色" },
  { type: "blue", t: "wwc", code: "BKSDWWCMBCB", status: "蓝色" },
];

const companies = (data.companies || []).filter((company) =>
  !companyFilter || clean(company.company).includes(companyFilter)
);
const projects = [];
const listChecks = [];
const errors = [];
let sequence = 1;
let usedApprovalPath = false;

try {
  const approval = await collectApprovalProjects();
  if (approval.projects.length) {
    projects.push(...approval.projects.map((project) => ({ ...project, sequence: sequence++ })));
    listChecks.push(...approval.listChecks);
    usedApprovalPath = true;
    data.approvalCapture = {
      reportPeriod: period,
      sourcePath: "成本管理 > 成本大数据提取分析 > 项目成本完成情况审批表",
      totalBills: approval.totalBills || 0,
      matchedBills: approval.matchedBills || 0,
      capturedProjects: approval.projects.length,
      errors: approval.errors || [],
    };
    for (const error of approval.errors || []) {
      errors.push({ stage: "approval-detail", ...error });
    }
  } else if (approval.error) {
    errors.push({ stage: "approval-list", message: approval.error });
  } else {
    for (const error of approval.errors || []) {
      errors.push({ stage: "approval-detail", ...error });
    }
    errors.push({
      stage: "approval-list",
      message: `cost completion approval path found no ${period} warning rows; falling back to summary detail path`,
    });
  }
} catch (error) {
  errors.push({ stage: "approval-list", message: error?.message || String(error) });
}

if (!usedApprovalPath && !approvalOnly) {
  for (const company of companies) {
    for (const typeDef of typeDefs) {
      const { rows, check } = await collectListRows(company, typeDef);
      if (check) listChecks.push(check);
      for (const row of rows) {
        try {
          const detail = await collectDetail(row);
          if (!detail?.ok) errors.push({ company: company.company, project: row.XMMC, hsdx: row.HSDX, message: detail?.message || "detail failed" });
          projects.push(projectFromRow(row, company, typeDef, detail, sequence++));
        } catch (error) {
          errors.push({ company: company.company, project: row.XMMC, hsdx: row.HSDX, message: error?.message || String(error) });
          projects.push(projectFromRow(row, company, typeDef, {}, sequence++));
        }
      }
    }
  }
}

const needsContractFallback = projects.some((project) => project.contract == null || project.contract === "");
if (needsContractFallback && usedApprovalPath && !approvalContractFallback) {
  for (const project of projects) {
    if (project.contract == null || project.contract === "") {
      project.contractLookupSkipped = true;
      project.sourceRaw = {
        ...(project.sourceRaw || {}),
        contractSource: project.sourceRaw?.contractSource || "cost-completion-approval-contract-empty",
      };
    }
  }
  errors.push({
    stage: "contract",
    message: "审批表路径已跳过合同额旧页面兜底，避免自动打开大PM旧页面影响办公；如需启用总成本计划/项目基本信息兜底，可设置 PM_WARNING_BIG_PM_APPROVAL_CONTRACT_FALLBACK=1",
  });
}
if (needsContractFallback && (!usedApprovalPath || approvalContractFallback)) {
  try {
    const totalPlan = await collectTotalPlanRows();
    applyContractAmounts(projects, totalPlan.rows || []);
    if (totalPlan.error) {
      errors.push({ stage: "contract", message: totalPlan.error });
    }
  } catch (error) {
    errors.push({ stage: "contract", message: error?.message || String(error) });
  }

  try {
    const projectBasic = await collectProjectBasicRows();
    applyBasicInfoContractAmounts(projects, projectBasic.rows || []);
    if (projectBasic.error) {
      errors.push({ stage: "contract-basic", message: projectBasic.error });
    }
  } catch (error) {
    errors.push({ stage: "contract-basic", message: error?.message || String(error) });
  }
}

clearAutoContractNoData(projects);
markVerifiedContractNoData(projects);

const untouchedProjects = companyFilter
  ? (data.projects || []).filter((project) => !clean(project.company).includes(companyFilter))
  : [];
const mergedProjects = [...untouchedProjects, ...projects].map((project, index) => ({ ...project, sequence: index + 1 }));
const amountReady = (project) =>
  project.contract != null && project.contract !== ""
  && project.actual != null && project.actual !== ""
  && project.budget != null && project.budget !== ""
  && project.reduction != null && project.reduction !== "";

data.projects = mergedProjects;
data.listChecks = companyFilter
  ? [...(data.listChecks || []).filter((check) => !clean(check.company).includes(companyFilter)), ...listChecks]
  : listChecks;
if (usedApprovalPath && !companyFilter) {
  updateTotalsFromCapturedProjects(data, mergedProjects);
}
const captureCompleteness = summarizeListCompleteness(data.listChecks);
data.detailHealth = {
  total: mergedProjects.length,
  budget: mergedProjects.filter((item) => item.budget != null && item.budget !== "").length,
  actual: mergedProjects.filter((item) => item.actual != null && item.actual !== "").length,
  reduction: mergedProjects.filter((item) => item.reduction != null && item.reduction !== "").length,
  complete: mergedProjects.filter(amountReady).length,
  missing: mergedProjects.filter((item) => !amountReady(item)).length,
  contract: mergedProjects.filter((item) => item.contract != null && item.contract !== "").length,
  expectedWarningDetails: captureCompleteness.expected,
  capturedWarningDetails: captureCompleteness.actual,
  missingListRows: captureCompleteness.missing,
  incompleteListChecks: captureCompleteness.incompleteCount,
};
data.totals = {
  ...(data.totals || {}),
  detailProjects: mergedProjects.length,
  amountComplete: data.detailHealth.complete,
  amountMissing: data.detailHealth.missing,
  missingListRows: captureCompleteness.missing,
};
data.errors = [...(data.errors || []), ...errors];
data.captureCompleteness = {
  sourcePlatform: "big-pm",
  reportPeriod: period,
  ...captureCompleteness,
};
data.capture = {
  ...(data.capture || {}),
  status: "completed",
  completenessOk: captureCompleteness.ok,
  missingListRows: captureCompleteness.missing,
};
data.source = {
  ...(data.source || {}),
  reportPeriod: period,
  detailMenuPath: usedApprovalPath
    ? "成本管理 > 成本大数据提取分析 > 项目成本完成情况审批表"
    : "成本管理 > 成本综合情况分析 > 红蓝汇总数字明细",
  note: usedApprovalPath
    ? `Big PM warning rows captured from cost completion approval bills for ${period}; colors and amounts are platform fields, not calculated.`
    : `Big PM detail rows captured using report period ${period}. Contract amount uses total cost plan first, then project basic info contract price fallback.${captureCompleteness.ok ? "" : ` Detail list is incomplete: missing ${captureCompleteness.missing} rows from summary/list comparison.`}`,
};
writeJson(resultPath, data);
await closeSharedTarget();

console.log(JSON.stringify({
  period,
  companyFilter,
  projects: projects.length,
  totalProjects: mergedProjects.length,
  detailHealth: data.detailHealth,
  captureCompleteness: data.captureCompleteness,
  listChecks: listChecks.filter((item) => !item.ok).slice(0, 20),
  errors: errors.slice(0, 20),
}, null, 2));
