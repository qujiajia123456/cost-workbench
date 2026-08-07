const pages = await fetch("http://localhost:9222/json/list").then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("yanjianpm.glodon.com"));
if (!page) throw new Error("未找到 9222 中的大PM标签");
await fetch(`http://localhost:9222/json/activate/${page.id}`).catch(() => {});
console.log(JSON.stringify({ id: page.id, title: page.title, url: page.url }, null, 2));
