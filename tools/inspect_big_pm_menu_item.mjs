const port = process.env.BIG_PM_CDP_PORT || "9333";
const linkId = process.env.BIG_PM_MENU_LINK_ID || "link_1005639";

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("Portal/Frame/LayoutC/Default.aspx"));
if (!page) throw new Error("No Big PM portal page found");

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
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

const result = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const linkId = ${JSON.stringify(linkId)};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const info = (element) => element && ({
      id: element.id,
      tag: element.tagName,
      text: clean(element.innerText || element.textContent || ""),
      html: element.outerHTML,
      onclick: String(element.onclick),
      href: element.href || "",
      className: element.className || "",
    });
    const el = document.getElementById(linkId);
    const parent = el?.parentElement;
    const div = parent?.closest?.("div");
    const scripts = Array.from(document.scripts)
      .map((script) => script.textContent || "")
      .filter((text) => text.includes(linkId.replace("link_", "")) || text.includes("openNewTabPage") || text.includes("dowithUrl"))
      .map((text) => text.slice(0, 3000))
      .slice(0, 10);
    return {
      el: info(el),
      parent: info(parent),
      div: info(div),
      windowKeys: Object.keys(window).filter((key) => /menu|open|tab|url|1005639|1003766/i.test(key)).slice(0, 300),
      functionText: {
        openNewTabPage: String(window.openNewTabPage || "").slice(0, 2500),
        openNewTabPageCloudT: String(window.openNewTabPageCloudT || "").slice(0, 2500),
        dowithUrl: String(window.dowithUrl || "").slice(0, 2500),
        dataBind: String(window.dataBind || "").slice(0, 4000),
        afterDataBind: String(window.afterDataBind || "").slice(0, 4000),
        makeTab: String(window.makeTab || "").slice(0, 4000),
      },
      menuType: typeof window.menu,
      menuText: String(window.menu || "").slice(0, 4000),
      menuKeys: Object.keys(window.menu || {}).slice(0, 200),
      menuNode: (() => {
        try {
          const menuId = Number(linkId.replace(/^link_/, ""));
          const node = window.menu?.FindMenu?.(menuId)
            || window.menu?.GetMenuData?.(menuId)
            || window.menu?.GetMenuChildData?.(menuId)
            || window.menu?.data?.findNode?.(menuId);
          if (!node) return null;
          const out = {};
          for (const key of Object.keys(node)) {
            const value = node[key];
            if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
          }
          return out;
        } catch (error) {
          return { error: String(error?.message || error) };
        }
      })(),
      menuFunctions: {
        FindMenu: String(window.menu?.FindMenu || "").slice(0, 3000),
        GetMenuData: String(window.menu?.GetMenuData || "").slice(0, 3000),
        MakeTabOnNaigator: String(window.menu?.MakeTabOnNaigator || "").slice(0, 3000),
        NeedMakeTabOnNaigator: String(window.menu?.NeedMakeTabOnNaigator || "").slice(0, 3000),
      },
      tabsType: typeof window.tabs,
      tabsText: String(window.tabs || "").slice(0, 4000),
      tabsKeys: Object.keys(window.tabs || {}).slice(0, 200),
      scripts,
    };
  })()`,
});

console.log(JSON.stringify(result.result?.value || result, null, 2));
ws.close();
