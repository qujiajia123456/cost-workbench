import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const JOB_DIR = path.join(DATA_DIR, "codex_blacklist_jobs");
const RESULT_DIR = path.join(DATA_DIR, "blacklist_results");
const CACHE_DIR = path.join(DATA_DIR, "tyc_cache");
const CDP_URL = process.env.TYC_CDP_URL || "http://127.0.0.1:9444";
const TYC_HOME = "https://www.tianyancha.com";
const SECOND_LAYER_LIMIT = Number(process.env.TYC_SECOND_LAYER_LIMIT || 24);
const SECOND_LAYER_CONCURRENCY = Number(process.env.TYC_SECOND_LAYER_CONCURRENCY || 4);
const DETAIL_SCROLLS = Number(process.env.TYC_DETAIL_SCROLLS || 6);
const CACHE_MAX_AGE_MS = Number(process.env.TYC_CACHE_HOURS || 72) * 60 * 60 * 1000;
const CACHE_VERSION = 3;
const PLAYWRIGHT_ENTRY = process.env.PLAYWRIGHT_ENTRY
  || path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", ".pnpm", "playwright@1.61.1", "node_modules", "playwright", "index.js");

const requireFromPlaywright = createRequire(PLAYWRIGHT_ENTRY);
const { chromium } = requireFromPlaywright("playwright");

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

function cachePathFor(text) {
  const key = crypto.createHash("sha1").update(String(text || "")).digest("hex");
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(text) {
  const filePath = cachePathFor(text);
  const data = readJson(filePath, null);
  if (!data?.cachedAt) return null;
  if (data.version !== CACHE_VERSION) return null;
  if (Date.now() - new Date(data.cachedAt).getTime() > CACHE_MAX_AGE_MS) return null;
  return data.value || null;
}

function writeCache(text, value) {
  writeJson(cachePathFor(text), { cachedAt: new Date().toISOString(), version: CACHE_VERSION, value });
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

function updateDbJob(jobId, patch) {
  const db = readJson(DB_PATH, {});
  let changed = false;
  for (const job of db.blacklistCodexJobs || []) {
    if (job.id === jobId) {
      Object.assign(job, patch);
      changed = true;
    }
  }
  if (changed) writeJson(DB_PATH, db);
}

function setStatus(jobPath, status, message, extra = {}) {
  const job = readJson(jobPath, {});
  Object.assign(job, { status, message, workerUpdatedAt: nowText(), ...extra });
  writeJson(jobPath, job);
  if (job.id) updateDbJob(job.id, { status, message, ...extra });
  console.log(`${status}: ${message}`);
  return job;
}

function findEdge() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return candidates.find((item) => fs.existsSync(item)) || "msedge.exe";
}

function launchDebugEdge(url) {
  const profileDir = path.join(DATA_DIR, "edge-tyc-worker-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    "--remote-debugging-port=9444",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];
  const child = spawn(findEdge(), args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

async function connectOrLaunch(jobPath, url) {
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch {
    launchDebugEdge(url);
    setStatus(jobPath, "等待天眼查登录", "已打开天眼查调试浏览器。请在新开的 Edge 窗口登录天眼查，登录后再次点击“天眼查穿透”。");
    return null;
  }
}

function cleanText(text) {
  return String(text || "").replace(/^[•·\-\s]+/, "").replace(/\s+/g, " ").trim();
}

function normalizeName(text) {
  return cleanText(text).replace(/[（）()\s]/g, "").toLowerCase();
}

function looksCompanyName(text) {
  const value = cleanText(text);
  if (value.length < 4 || value.length > 80) return false;
  if (!/(公司|集团|企业|中心|合伙|事务所|厂|院|社)/.test(value)) return false;
  if (/^(公司发展|控制企业|企业年报|企业公示|法院公告|历史法院公告|企业业务|司法解析|经营风险|经营状况|知识产权)\s*\d*$/.test(value)) return false;
  if (/(公司发展|控制企业|企业年报|企业公示|法院公告|历史法院公告)\d+$/.test(value)) return false;
  if (/企业$/.test(value) && !/(公司|集团|合伙企业|小微企业|高新技术企业|科技型企业)/.test(value)) return false;
  if (/天眼查|登录|注册|会员|风险|查看|展开|更多|APP|下载|广告|客服中心|国家中小企业|上市公司|基础版企业|专业版企业|全国企业/.test(value)) return false;
  if (/^(有限责任公司|股份有限公司|联营企业|股份合作企业|小微企业|科技型企业|高新技术企业|成员企业|仅看公司|其他有限责任公司分公司|有限责任公司分公司)$/.test(value)) return false;
  if (/共任职\d+家企业|搜过|资本运营等业务|对外援助|商务部/.test(value)) return false;
  return true;
}

async function extractVisibleRelations(page, query) {
  return await page.evaluate((queryText) => {
    const clean = (text) => String(text || "").replace(/^[•·\-\s]+/, "").replace(/\s+/g, " ").trim();
    const groupOf = (text) => {
      const value = clean(text);
      if (/同地区同行业|同行业公司|同地区公司/.test(value)) return "同地区同行业（待核验）";
      if (/分支机构|分公司/.test(value)) return "分支机构";
      if (/对外投资|投资|控股|股东|出资/.test(value)) return "向下投资及控制";
      if (/主要人员|高管|任职|董事|监事|经理|法人/.test(value)) return "主要人员交叉";
      if (/电话|地址|邮箱|网址|联系方式/.test(value)) return "同电话/同地址/同账户";
      if (/风险|失信|被执行|限制高消费|开庭|裁判|行政处罚/.test(value)) return "风险记录关联";
      return "页面可见关联";
    };
    const isCompany = (text) => {
      const value = clean(text);
      if (value.length < 4 || value.length > 80) return false;
      if (!/(公司|集团|企业|中心|合伙|事务所|厂|院|社)/.test(value)) return false;
      if (/^(公司发展|控制企业|企业年报|企业公示|法院公告|历史法院公告|企业业务|司法解析|经营风险|经营状况|知识产权)\s*\d*$/.test(value)) return false;
      if (/(公司发展|控制企业|企业年报|企业公示|法院公告|历史法院公告)\d+$/.test(value)) return false;
      if (/企业$/.test(value) && !/(公司|集团|合伙企业|小微企业|高新技术企业|科技型企业)/.test(value)) return false;
      if (/天眼查|登录|注册|会员|风险|查看|展开|更多|APP|下载|广告|客服中心|国家中小企业|上市公司|基础版企业|专业版企业|全国企业/.test(value)) return false;
      if (/^(有限责任公司|股份有限公司|联营企业|股份合作企业|小微企业|科技型企业|高新技术企业|成员企业|仅看公司|其他有限责任公司分公司|有限责任公司分公司)$/.test(value)) return false;
      if (/共任职\d+家企业|搜过|资本运营等业务|对外援助|商务部/.test(value)) return false;
      return true;
    };
    const links = Array.from(document.querySelectorAll("a"))
      .map((a) => ({
        name: clean(a.innerText || a.textContent || ""),
        href: a.href || "",
        nearby: clean(a.closest("tr, li, .card, .content, .result-list, .search-result-single")?.innerText || ""),
      }))
      .filter((item) => item.href.includes("/company/") && isCompany(item.name));
    const text = clean(document.body?.innerText || "");
    const items = [];
    const seen = new Set();
    for (const link of links) {
      if (seen.has(link.name) || link.name === queryText) continue;
      seen.add(link.name);
      items.push({
        name: link.name,
        href: link.href,
        relationGroup: groupOf(link.nearby),
        nearby: link.nearby.slice(0, 220),
      });
    }
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, 4000),
      links,
      items: items.slice(0, 160),
      names: items.map((item) => item.name).slice(0, 160),
    };
  }, query);
}

function mergeExtracted(...parts) {
  const merged = { title: "", url: "", text: "", links: [], items: [], names: [] };
  const seen = new Set();
  for (const part of parts) {
    if (!part) continue;
    merged.title ||= part.title || "";
    merged.url ||= part.url || "";
    merged.text += part.text || "";
    merged.links.push(...(part.links || []));
    for (const item of part.items || []) {
      const name = cleanText(item.name);
      const key = normalizeName(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      merged.items.push(item);
    }
  }
  merged.names = merged.items.map((item) => item.name);
  return merged;
}

async function extractDetailFromHref(page, href, rootName, rootQuery, parentItem = null) {
  if (!href) return null;
  const cacheKey = href;
  const cached = readCache(cacheKey);
  if (cached) return cached;
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const snapshots = [];
  for (let index = 0; index < DETAIL_SCROLLS; index += 1) {
    snapshots.push(await extractVisibleRelations(page, rootName));
    await page.evaluate(() => window.scrollBy(0, Math.max(520, window.innerHeight * 0.85))).catch(() => {});
    await page.waitForTimeout(650);
  }
  const detail = mergeExtracted(...snapshots);
  detail.title = await page.title().catch(() => detail.title);
  detail.url = page.url();
  if (parentItem) {
    detail.items = detail.items
      .filter((item) => normalizeName(item.name) !== normalizeName(rootQuery) && normalizeName(item.name) !== normalizeName(parentItem.name))
      .map((item) => ({
        ...item,
        parent: parentItem.name,
        depth: 2,
        path: [rootQuery, parentItem.name, item.name],
        relationGroup: item.relationGroup === "页面可见关联" ? `二层待核验：${parentItem.relationGroup || "页面可见关联"}` : item.relationGroup,
      }));
    detail.names = detail.items.map((item) => item.name);
  }
  writeCache(cacheKey, detail);
  return detail;
}

async function extractDetailRelations(page, query, searchExtracted) {
  const exact = (searchExtracted.links || []).find((item) => cleanText(item.name) === query);
  const candidate = exact || (searchExtracted.links || [])[0];
  if (!candidate?.href) return null;
  return extractDetailFromHref(page, candidate.href, query, query);
}

function prioritizeSecondLayerItems(items) {
  const unique = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = normalizeName(item.name);
    if (!item.href || !key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const score = (item) => {
    let value = 0;
    if (item.relationGroup === "向下投资及控制") value += 100;
    if (item.relationGroup === "分支机构") value += 80;
    if (/集团|安装|建设|工程|设备|路桥|青岛|济南|上海|分公司/.test(item.name)) value += 40;
    if (/页面可见关联|同地区同行业|待核验/.test(item.relationGroup || "")) value -= 10;
    return value;
  };
  return unique.sort((a, b) => score(b) - score(a)).slice(0, SECOND_LAYER_LIMIT);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index).catch(() => null);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runOne));
  return results.filter(Boolean);
}

async function expandSecondLayer(context, query, firstLayerItems, jobPath) {
  const seeds = prioritizeSecondLayerItems(firstLayerItems);
  if (!seeds.length) return null;
  setStatus(jobPath, "二层并行穿透", `正在并行穿透 ${seeds.length} 个关键关联主体（并发 ${SECOND_LAYER_CONCURRENCY}）。`);
  let done = 0;
  const parts = await mapWithConcurrency(seeds, SECOND_LAYER_CONCURRENCY, async (item) => {
    const page = await context.newPage();
    try {
      const result = await extractDetailFromHref(page, item.href, item.name, query, item);
      done += 1;
      if (done === 1 || done % 4 === 0 || done === seeds.length) {
        setStatus(jobPath, "二层并行穿透", `已完成 ${done}/${seeds.length} 个关键主体，已发现主体将持续回写。`);
      }
      return result;
    } finally {
      await page.close().catch(() => {});
    }
  });
  return mergeExtracted(...parts);
}

function buildResult(job, extracted) {
  const query = job.query || "";
  const items = (extracted.items || extracted.names.map((name) => ({ name, relationGroup: "页面可见关联" })))
    .filter((item) => cleanText(item.name) && cleanText(item.name) !== query);
  const allNames = Array.from(new Set([query, ...items.map((item) => item.name)])).filter(Boolean);
  const now = nowText();
  const entities = allNames.map((name, index) => ({
    id: index === 0 ? (job.id || "root") : `tyc-${index}`,
    name,
    creditCode: "",
    riskLevel: index === 0 ? "查询对象" : "关联关注",
    status: "需复核",
    legalRep: "",
    shareholders: [],
    contacts: [],
    bankAccounts: [],
    address: "",
    reason: index === 0 ? "天眼查查询对象" : "天眼查页面/详情页可见关联主体，需人工复核关系类型",
    source: extracted.url || "天眼查",
    updatedAt: now.slice(0, 10),
  }));
  const routes = items.map((item) => ({
    path: item.path || [query, item.name],
    relations: item.path?.length >= 3
      ? [item.parentRelation || "一层关联", item.relationGroup || "二层关联"]
      : [item.relationGroup || "天眼查页面可见关联"],
    source: query,
    target: item.name,
    label: item.relationGroup || "页面可见关联",
    sourceType: "root",
    targetType: "related",
  }));
  const unexpandedNodes = items.map((item) => ({
    name: item.name,
    reason: "已发现主体，尚未逐个打开该主体详情继续向下穿透",
    group: item.relationGroup || "页面可见关联",
  }));
  return {
    query,
    source: "天眼查/授权企业信息数据源",
    checkedAt: now,
    page: { title: extracted.title, url: extracted.url },
    entities,
    allRelatedCompanies: items.map((item, index) => ({
      name: item.name,
      relationGroup: item.relationGroup || "页面可见关联",
      depth: item.depth || 1,
      path: item.path || [query, item.name],
      expanded: false,
      stopReason: "已进入查询对象详情页提取可见主体，后续可继续逐个打开该主体详情页",
      sourceUrl: item.href || extracted.url,
      evidenceText: item.nearby || "",
      order: index + 1,
    })),
    coverage: {
      status: items.length ? "partial" : "partial",
      completedDepth: items.length ? 1 : 0,
      completedGroups: Array.from(new Set(items.map((item) => item.relationGroup || "页面可见关联"))),
      expandedNodeCount: 1 + new Set(items.filter((item) => item.parent).map((item) => item.parent)).size,
      relatedCompanyCount: items.length,
      unexpandedNodes,
      stopReasons: [`已优先并行穿透 ${Math.min(SECOND_LAYER_LIMIT, items.length)} 个关键主体，其余主体可继续后台补齐`, "若页面要求验证码/会员权限，需人工处理后再次运行"],
      summary: items.length
        ? `已从天眼查搜索页、详情页和关键主体二层穿透读取 ${items.length} 个可见关联主体，已按关系类型回写到思维导图。`
        : "已打开天眼查页面，但未读取到可用关联主体。请确认登录、搜索结果和页面权限。",
    },
    routes,
    upwardRoutes: [],
    downwardRoutes: routes.filter((route) => route.label === "向下投资及控制"),
    branchRoutes: routes.filter((route) => route.label === "分支机构"),
    personCrossRoutes: routes.filter((route) => route.label === "主要人员交叉"),
    sameContactRoutes: routes.filter((route) => route.label === "同电话/同地址/同账户"),
    naturalPersonRoutes: [],
    otherShareholderRoutes: [],
    clueMatrix: [],
    evidenceCatalog: [{
      id: "E-001",
      name: "天眼查页面可见主体提取",
      source: "天眼查",
      location: extracted.url,
      relatedClue: "",
      sensitiveHandling: "仅回写页面可见名称和关系线索，敏感信息需人工复核。",
    }],
  };
}

async function run(jobIdOrPath) {
  const jobPath = resolveJobPath(jobIdOrPath);
  let job = readJson(jobPath, {});
  const query = cleanText(job.query);
  if (!query) throw new Error("任务缺少查询对象。");
  const url = `${TYC_HOME}/search?key=${encodeURIComponent(query)}`;
  setStatus(jobPath, "连接天眼查", `正在连接天眼查调试浏览器：${CDP_URL}`);
  const browser = await connectOrLaunch(jobPath, url);
  if (!browser) return;
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages().find((item) => item.url().includes("tianyancha.com")) || await context.newPage();
    setStatus(jobPath, "打开天眼查", `正在打开天眼查搜索：${query}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    const searchExtracted = await extractVisibleRelations(page, query);
    const pageText = cleanText(searchExtracted.text);
    if (/验证码|安全验证|拖动滑块|登录\/注册|账号登录|手机登录/.test(pageText) && searchExtracted.names.length === 0) {
      setStatus(jobPath, "等待天眼查验证", "天眼查页面需要登录或验证。请在调试 Edge 中处理后，再次点击“天眼查穿透”。", {
        resultStatus: "等待验证",
      });
      return;
    }
    setStatus(jobPath, "进入企业详情", `正在进入 ${query} 详情页补充股东、投资、分支机构和人员关联。`);
    const detailExtracted = await extractDetailRelations(page, query, searchExtracted).catch(() => null);
    const firstLayerExtracted = mergeExtracted(searchExtracted, detailExtracted);
    const secondLayerExtracted = await expandSecondLayer(context, query, firstLayerExtracted.items, jobPath).catch(() => null);
    const extracted = mergeExtracted(firstLayerExtracted, secondLayerExtracted);
    const result = buildResult(job, extracted);
    const resultPath = job.preferredOutput || path.join(RESULT_DIR, `${job.id}.json`);
    writeJson(resultPath, result);
    setStatus(jobPath, extracted.names.length ? "已回写" : "已打开无结果", extracted.names.length
      ? `已回写 ${extracted.names.length} 个可见关联主体（含二层并行穿透）。`
      : "已打开天眼查，但未提取到关联主体；请检查页面是否登录或是否有结果。",
      { resultPath });
  } finally {
    await browser.close().catch(() => {});
  }
}

const args = process.argv.slice(2);
const jobArg = args.includes("--job") ? args[args.indexOf("--job") + 1] : args[0];
run(jobArg).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
