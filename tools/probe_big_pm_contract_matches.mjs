import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.BIG_PM_CDP_PORT || "9333";
const resultPath = path.join(root, "data", "pm_warning_results", "latest_big-pm.json");
const url = "http://yanjianpm.glodon.com/YJJT/ZCBJHBZMK/ZCBJHBZListPage/ZCBJHBZListPage.aspx?menuitemid=1005639&frame=4000401285&modulecode=YJJT.ZCBJHBZMK.ZCBJHBZModule";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).replace(/[()\[\]（）【】\s]/g, "").toLowerCase();
const companyPrefix = (value) => {
  const text = clean(value).replace(/\s+/g, "");
  const match = text.match(/^(.{2,}?(?:集团有限公司|股份有限公司|有限责任公司|有限公司|集团|公司))/);
  return match ? norm(match[1]) : "";
};
const commonPrefixLength = (left, right) => {
  const a = norm(left);
  const b = norm(right);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};
const hasNameConflict = (left, right) => {
  const a = norm(left);
  const b = norm(right);
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
const planNameMatches = (left, right) => {
  const leftNorm = norm(left);
  const rightNorm = norm(right);
  if (leftNorm && rightNorm && (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm))) return true;
  if (hasNameConflict(left, right)) return false;
  const leftPrefix = companyPrefix(left);
  const rightPrefix = companyPrefix(right);
  if (leftPrefix && rightPrefix && leftPrefix === rightPrefix && leftPrefix.length >= 6) return true;
  return commonPrefixLength(left, right) >= 10;
};

async function openTarget(targetUrl) {
  if (process.env.BIG_PM_REUSE_EXISTING === "1") {
    const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!listResponse.ok) throw new Error(`list targets failed ${listResponse.status}`);
    const targets = await listResponse.json();
    const target = targets.find((item) =>
      item.type === "page"
      && item.webSocketDebuggerUrl
      && (String(item.url || "").includes("ZCBJHBZListPage") || String(item.title || "").includes("总成本计划"))
    );
    if (!target) throw new Error("existing total cost plan page not found");
    return { ...target, reused: true };
  }
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`open target failed ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error("target has no debugger url");
  return target;
}

async function closeTarget(target) {
  if (!target?.id) return;
  if (target.reused) return;
  try { await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`); } catch {}
}

async function connect(target) {
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
  try { await send("Page.enable"); } catch {}
  return { ws, send };
}

async function evaluate(send, expression, timeout = 120000) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
      return result.result?.value;
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Cannot find context|navigated/i.test(String(error?.message || error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
  throw lastError;
}

async function collectRows() {
  const target = await openTarget(url);
  const { ws, send } = await connect(target);
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const storeInfoExpression = `(() => {
      const simplify = (value) => {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        if (Array.isArray(value)) return value.map(simplify);
        const out = {};
        for (const key of Object.keys(value)) {
          if (typeof value[key] !== "function") out[key] = simplify(value[key]);
        }
        return out;
      };
      const stores = [];
      Ext?.ComponentMgr?.all?.each?.((cmp) => {
        const s = cmp.getStore?.() || cmp.store;
        const fields = s?.fields?.items?.map((field) => field.name) || [];
        if (fields.includes("TBYSHSJE") && fields.includes("DeptName")) {
          const count = Number(
            s.getTotalCount?.()
            || s.totalLength
            || s.getTotalLength?.()
            || s.reader?.jsonData?.totalCount
            || s.reader?.jsonData?.total
            || s.getCount?.()
            || 0
          );
          stores.push({ cmpId: cmp.id, total: count, fields, pageSize: Number(s.pageSize || s.baseParams?.limit || 25) });
        }
      });
      stores.sort((a, b) => b.total - a.total);
      return stores[0] ? { ok: true, ...stores[0] } : { ok: false, message: "total cost plan store not found" };
    })()`;
    const readPageExpression = `(() => {
      const simplify = (value) => {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        if (Array.isArray(value)) return value.map(simplify);
        const out = {};
        for (const key of Object.keys(value)) {
          if (typeof value[key] !== "function") out[key] = simplify(value[key]);
        }
        return out;
      };
      const stores = [];
      Ext?.ComponentMgr?.all?.each?.((cmp) => {
        const s = cmp.getStore?.() || cmp.store;
        const fields = s?.fields?.items?.map((field) => field.name) || [];
        if (fields.includes("TBYSHSJE") && fields.includes("DeptName")) {
          stores.push({ store: s, total: Number(s.getTotalCount?.() || s.getCount?.() || 0) });
        }
      });
      stores.sort((a, b) => b.total - a.total);
      const store = stores[0]?.store;
      return store?.getRange?.().map((record) => simplify(record.data)) || [];
    })()`;
    const loadPageExpression = (start, limit) => `(() => new Promise((resolve) => {
      const stores = [];
      Ext?.ComponentMgr?.all?.each?.((cmp) => {
        const s = cmp.getStore?.() || cmp.store;
        const fields = s?.fields?.items?.map((field) => field.name) || [];
        if (fields.includes("TBYSHSJE") && fields.includes("DeptName")) {
          stores.push({ store: s, total: Number(s.getTotalCount?.() || s.getCount?.() || 0) });
        }
      });
      stores.sort((a, b) => b.total - a.total);
      const store = stores[0]?.store;
      const pager = Ext.getCmp?.("billView_pagingbar");
      if (!store) return resolve({ ok: false, message: "total cost plan store not found" });
      let finished = false;
      const finish = (message = "") => {
        if (finished) return;
        finished = true;
        resolve({ ok: true, start: ${start}, message });
      };
      try { store.rejectChanges?.(); } catch {}
      try { store.on?.("load", () => finish("load"), null, { single: true }); } catch {}
      try {
        if (pager?.doLoad) pager.doLoad(${start});
        else store.load({ params: { start: ${start}, limit: ${limit} }, callback: () => finish("callback") });
      } catch (error) {
        finish(error?.message || String(error));
      }
      setTimeout(() => finish("timeout"), 2500);
    }))()`;

    const info = await evaluate(send, storeInfoExpression, 30000);
    if (!info?.ok) return { rows: [], total: 0, error: info?.message || "total plan store not found" };
    const total = Number(info.total) || 0;
    const pageSize = Number(info.pageSize) || 25;
    const rows = [];
    const seen = new Set();
    const addRows = (items) => {
      for (const row of items || []) {
        const key = row.ID || row.RID || row.Code || JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    };
    for (let start = 0; start < Math.max(total, pageSize); start += pageSize) {
      await evaluate(send, loadPageExpression(start, pageSize), 8000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      addRows(await evaluate(send, readPageExpression, 30000));
      if (rows.length >= total && total > 0) break;
    }
    return { ok: true, total, pageSize, rows };
  } finally {
    try { ws.close(); } catch {}
    await closeTarget(target);
  }
}

const data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const projects = data.projects || [];
const rowsResult = await collectRows();
if (!rowsResult?.ok) {
  console.log(JSON.stringify(rowsResult, null, 2));
  process.exit(1);
}

const rows = rowsResult.rows || [];
const matches = projects.map((project) => {
  const pn = norm(project.name);
  const major = norm(project.hsdx || project.major);
  const keyword = pn.slice(0, Math.min(6, pn.length));
  const candidates = rows.filter((row) => {
    const rm = norm(row.HSDX);
    return planNameMatches(project.name, row.DeptName) && (!major || !rm || rm.includes(major) || major.includes(rm));
  });
  const approved = candidates.filter((row) => row.State?.name === "ApprovePass" || row.State?.alias?.zh_CN === "审批通过");
  const chosen = approved.length ? approved : candidates;
  const amount = chosen.reduce((sum, row) => sum + (Number(row.TBYSHSJE) || 0), 0);
  return {
    project: project.name,
    hsdx: project.hsdx || project.major,
    status: project.status,
    candidates: candidates.length,
    approved: approved.length,
    amountYuan: amount,
    amountWan: Math.round((amount / 10000 + Number.EPSILON) * 100) / 100,
    rows: chosen.slice(0, 8).map((row) => ({
      DeptName: row.DeptName,
      HSDX: row.HSDX,
      State: row.State?.alias?.zh_CN || row.State?.name,
      TBYSHSJE: row.TBYSHSJE,
      Code: row.Code,
      EP_JCDWYJGJ: row.EP_JCDWYJGJ,
    })),
    suggestions: candidates.length ? [] : rows
      .filter((row) => {
        const rn = norm(row.DeptName);
        return keyword && (rn.includes(keyword) || pn.includes(rn.slice(0, Math.min(6, rn.length))));
      })
      .slice(0, 8)
      .map((row) => ({
        DeptName: row.DeptName,
        HSDX: row.HSDX,
        State: row.State?.alias?.zh_CN || row.State?.name,
        TBYSHSJE: row.TBYSHSJE,
        Code: row.Code,
        EP_JCDWYJGJ: row.EP_JCDWYJGJ,
      })),
  };
});

console.log(JSON.stringify({ totalRows: rows.length, matches }, null, 2));
