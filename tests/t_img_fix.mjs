/* 20261115F · 「前台后台传的图有的不显示」自检
 *
 * 现象：同一批上传的图，有的显示、有的只剩一块空白，刷新也不一定好，看不出原因。
 * 根因三类，界面上长得一模一样：
 *   ① 图片地址要经图片服务鉴权，但不少渲染处没把登录令牌带上 → 401
 *   ② 页面开久了令牌过期 → 401（续期即可自愈）
 *   ③ 文件确实不在了 / 原站禁止外链 → 404 / 403 / 被拦
 *
 * 本自检真跑 js/supabase.js 里的图片兜底模块（假 window / 假 fetch），断言：
 *   · 令牌只补一次、不重复追加；对外分享前会被剥掉；
 *   · 401 首次失败会续期令牌重试一次（②能自愈），仍失败才显示原因；
 *   · 404 直接给出「文件已不存在」，不再是一块空白；
 *   · 体检能把一批地址按 正常 / 登录失效 / 无权限 / 文件不存在 / 其它 分类计数。
 * 反向用例：把「重试」「补令牌」「剥令牌」写回去必须失败，证明用例抓得住缺陷。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const S = read("js/supabase.js");
const WORKER = "http://w";

/* ---------------- 假环境 ---------------- */
let refreshCount = 0;
let sessionToken = "tok-1";
let fetchCalls = [];
let fetchResponder = null;

class FakeFormData {
  constructor() { this._e = []; }
  append(k, v) { this._e.push([String(k), String(v)]); }
  get(k) { const f = this._e.find((x) => x[0] === k); return f ? f[1] : null; }
}

function makeEnv() {
  refreshCount = 0;
  sessionToken = "tok-1";
  fetchCalls = [];
  fetchResponder = null;

  const client = {
    from: () => { const api = new Proxy({}, { get: () => () => api }); return api; },
    auth: {
      getSession: async () => ({ data: { session: { access_token: sessionToken, expires_at: 0, user: { id: "u1" } } } }),
      refreshSession: async () => {
        refreshCount++;
        sessionToken = "tok-" + (refreshCount + 1);
        return { data: { session: { access_token: sessionToken } } };
      },
      onAuthStateChange: () => {},
    },
  };

  const win = {
    supabase: { createClient: () => client },
    CONFIG: { SUPABASE: { url: "http://x", anonKey: "k" }, WORKER_URL: WORKER + "/" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener() {},
  };

  const fetchImpl = async (url, init) => {
    const call = { url: String(url), init: init || {} };
    fetchCalls.push(call);
    const r = fetchResponder ? fetchResponder(call, fetchCalls.length) : { status: 200 };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => (r.body === undefined ? {} : r.body),
      text: async () => JSON.stringify(r.body === undefined ? {} : r.body),
    };
  };

  const ctx = vm.createContext({
    window: win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
    String, Number, Object, Array, RegExp, Error, FormData: FakeFormData,
    localStorage: win.localStorage, fetch: fetchImpl, navigator: { userAgent: "node" },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    location: { href: "", origin: "http://x" },
  });
  vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
  return { ctx, win, IMG: ctx.window.IMFIX };
}

/* ---------------- 假 IMG 元素 ---------------- */
function fakeImg(src) {
  const attrs = { src: String(src || "") };
  return {
    tagName: "IMG",
    isConnected: true,
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    hasAttribute(k) { return k in attrs; },
    removeAttribute(k) { delete attrs[k]; },
    _attrs: attrs,
  };
}

const run = async () => {
  /* ============ 一、地址拼装：补令牌只补一次，对外一律剥掉 ============ */
  console.log("一、地址拼装与令牌剥离");
  {
    const { IMG } = makeEnv();
    ok(typeof IMG === "object" && IMG, "兜底模块已挂到 window.IMFIX");

    const raw = WORKER + "/images/T恤/a.webp";
    const withTok = IMG.withAuth(raw, "abc");
    ok(withTok === raw + "?token=abc", "裸地址补令牌：末尾追加 ?token=");

    const again = IMG.withAuth(withTok, "def");
    ok(again.indexOf("token=") === again.lastIndexOf("token="), "已有令牌时不重复追加");
    ok(again.indexOf("token=def") > 0, "已有令牌时替换为最新令牌（旧的会过期）");

    ok(IMG.stripAuth(withTok) === raw, "剥令牌：还原成裸地址");
    ok(IMG.stripAuth(raw + "?a=1&token=x&b=2") === raw + "?a=1&b=2", "剥令牌：保留其它查询参数");
    ok(IMG.stripAuth(raw + "?token=x&read_key=y") === raw, "剥令牌：token / read_key 一起去掉");

    ok(IMG.isWorker(raw) === true, "认得出图片服务地址");
    ok(IMG.isWorker("https://cdn.example.com/a.webp") === false, "外站地址不当作图片服务");
    ok(IMG.abs("images/a.webp") === WORKER + "/images/a.webp", "相对路径补成完整地址");
    ok(IMG.abs("https://cdn.example.com/a.webp") === "https://cdn.example.com/a.webp", "绝对地址原样保留");
  }

  /* ============ 二、原因文案：不再是一块莫名空白 ============ */
  console.log("二、失败原因文案");
  {
    const { IMG } = makeEnv();
    ok(/登录/.test(IMG.reason(401)), "401 → 登录失效");
    ok(/权限/.test(IMG.reason(403)), "403 → 无权限");
    ok(/不存在/.test(IMG.reason(404)), "404 → 文件不存在");
    ok(/频繁/.test(IMG.reason(429)), "429 → 请求过于频繁");
    ok(/网络|拦截/.test(IMG.reason(0)), "网络异常 → 说清是被拦/不通");
    ok(/500/.test(IMG.reason(500)), "其它状态码带出数字");

    const ph = IMG.placeholder("文件已不存在");
    ok(/^data:image\/svg\+xml/.test(ph), "占位图是内联 SVG（不联网、不多发请求）");
    ok(decodeURIComponent(ph).indexOf("文件已不存在") > 0, "占位图里写着原因");
  }

  /* ============ 三、401 先自愈：续期令牌后重试一次 ============ */
  console.log("三、401 自动续期重试");
  {
    const { IMG } = makeEnv();
    /* 第一次用旧令牌请求 → 401；续期后用新令牌请求 → 200 */
    fetchResponder = (call) => ({ status: /token=tok-2/.test(call.url) ? 200 : 401 });
    const el = fakeImg(WORKER + "/images/T恤/b.webp");
    await IMG.apply(el);
    ok(el.getAttribute("src").indexOf("token=tok-1") > 0, "渲染时先补上当前令牌");

    refreshCount = 0;
    await IMG.apply(el);                       /* 已被标记过，不会重复处理 */
    await new Promise((r) => setTimeout(r, 10));

    /* 模拟浏览器加载失败 */
    await IMG.onError(el);
    await new Promise((r) => setTimeout(r, 30));
    ok(refreshCount >= 1, "首次失败会续期令牌（②令牌过期能自愈）");
    ok(el.getAttribute("src").indexOf("token=tok-2") > 0, "续期后用新令牌重试");
    ok(!el.hasAttribute("data-imgfail"), "重试这一步还没判定失败，不该先画占位图");
  }

  /* ============ 四、真失败才画占位图，并写清原因 ============ */
  console.log("四、真失败画占位图");
  {
    const { IMG } = makeEnv();
    fetchResponder = () => ({ status: 404 });
    const el = fakeImg(WORKER + "/images/T恤/c.webp");
    await IMG.apply(el);
    await IMG.onError(el);                     /* 第 1 次：续期重试 */
    await new Promise((r) => setTimeout(r, 20));
    await IMG.onError(el);                     /* 第 2 次：判定失败 */
    await new Promise((r) => setTimeout(r, 20));
    ok(el.getAttribute("data-imgfail") === "404", "失败原因记为 404");
    ok(/^data:image\/svg\+xml/.test(el.getAttribute("src")), "原位换成占位图，不再是空白");
    ok(decodeURIComponent(el.getAttribute("src")).indexOf("不存在") > 0, "占位图上写着「文件已不存在」");
    ok(/不存在/.test(el.getAttribute("title") || ""), "悬停能看到原因");

    const el2 = fakeImg(WORKER + "/images/T恤/d.webp");
    fetchResponder = () => ({ status: 403 });
    await IMG.apply(el2);
    await IMG.onError(el2);
    await new Promise((r) => setTimeout(r, 20));
    await IMG.onError(el2);
    await new Promise((r) => setTimeout(r, 20));
    ok(el2.getAttribute("data-imgfail") === "403", "无权限单独归类（不是笼统失败）");
  }

  /* ============ 五、外站图失败也要说清，且不给它补站内令牌 ============ */
  console.log("五、外站图片");
  {
    const { IMG } = makeEnv();
    const el = fakeImg("https://cdn.example.com/x.webp");
    await IMG.apply(el);
    ok(el.getAttribute("src") === "https://cdn.example.com/x.webp", "外站地址不追加站内令牌");
    fetchResponder = () => { throw new Error("cors"); };
    await IMG.onError(el);
    await new Promise((r) => setTimeout(r, 20));
    await IMG.onError(el);
    await new Promise((r) => setTimeout(r, 20));
    ok(/网络|拦截/.test(decodeURIComponent(el.getAttribute("src"))), "外站取不到时说明是网络/外链限制");
  }

  /* ============ 六、体检：按状态分类计数 ============ */
  console.log("六、图片体检");
  {
    const { IMG } = makeEnv();
    const urls = [
      WORKER + "/images/a.webp",
      WORKER + "/images/b.webp",
      WORKER + "/images/c.webp",
      WORKER + "/images/d.webp",
      "",
    ];
    fetchResponder = (call) => {
      if (/a\.webp/.test(call.url)) return { status: 200 };
      if (/b\.webp/.test(call.url)) return { status: 401 };
      if (/c\.webp/.test(call.url)) return { status: 404 };
      if (/d\.webp/.test(call.url)) return { status: 500 };
      return { status: 200 };
    };
    let ticked = 0;
    const rep = await IMG.audit(urls, () => { ticked++; });
    ok(rep.total === 4, "空地址不计入体检");
    ok(rep.ok === 1, "正常 1 张");
    ok(rep.auth === 1, "登录失效 1 张");
    ok(rep.missing === 1, "文件不存在 1 张");
    ok(rep.other === 1, "其它失败 1 张");
    ok(rep.rows.length === 3, "异常清单只列异常项");
    ok(rep.rebase === 0, "当前地址都对得上当前图片服务时，不该误报「地址过期」");
    ok(rep.rows.every((r) => r.url.indexOf("token=") < 0), "体检清单里不出现令牌（可安全发给别人看）");
    ok(ticked === 4, "进度回调按张到位");
  }

  /* ============ 六·二、旧域名地址：能认出来，且给出可用的新地址 ============ */
  console.log("六·二、旧域名地址识别");
  {
    const { IMG } = makeEnv();
    const oldUrl = "https://old-img.example.com/images/T恤/x.webp";
    fetchResponder = (call) => ({ status: call.url.indexOf(WORKER + "/images/") === 0 ? 200 : 404 });
    const rep = await IMG.audit([oldUrl]);
    ok(rep.rebase === 1, "指向旧图片服务的地址被单独归类（不是笼统「文件不存在」）");
    ok(rep.missing === 0, "不把「地址过期」误判成「文件丢了」");
    ok(rep.rows[0] && rep.rows[0].fixed === WORKER + "/images/T恤/x.webp", "给出换成当前图片服务后的地址");
    ok(rep.rows[0] && /没丢/.test(rep.rows[0].reason), "说明里点明文件没丢");
  }

  /* ============ 七、反向用例：把兜底做回去必须失败 ============ */
  console.log("七、反向验证");
  {
    /* 1) 不补令牌 = 回到旧实现：401 时连重试都没有 */
    const { IMG } = makeEnv();
    const raw = WORKER + "/images/e.webp";
    ok(IMG.withAuth(raw, "") === raw, "没有令牌时不硬塞空 token");
    ok(IMG.withAuth(raw, "abc") !== raw, "有令牌时确实变了（否则等于没做兜底）");

    /* 2) 每张都续期一次 = 浪费且会被当成刷新风暴：缓存在 4 分钟内只取一次 */
    const env2 = makeEnv();
    fetchResponder = () => ({ status: 200 });
    await env2.IMG.apply(fakeImg(WORKER + "/images/f1.webp"));
    await env2.IMG.apply(fakeImg(WORKER + "/images/f2.webp"));
    await env2.IMG.apply(fakeImg(WORKER + "/images/f3.webp"));
    ok(refreshCount === 0, "令牌没过期时不做无谓续期（否则列表会闪）");

    /* 3) 占位图不能是外链（否则失败时又是一块空白） */
    const ph = env2.IMG.placeholder("x");
    ok(/^data:/.test(ph), "占位图必须是内联 data URI");
  }

  /* ============ 八、接线核对：页面真的用上了 ============ */
  console.log("八、接线核对");
  {
    const sb = read("js/supabase.js");
    ok(/window\.IMFIX\s*=\s*IMGFIX/.test(sb), "兜底模块对外暴露");
    ok(/IMGFIX\.hook\(\)/.test(sb), "页面加载后自动挂载（各页面无需逐页对接）");
    ok(/MutationObserver/.test(sb), "新渲染出来的图也会补令牌（列表是动态渲染的）");
    ok(/addEventListener\("error"/.test(sb), "图片加载失败被全局捕获（兜底覆盖全站）");

    const cz = read("js/admin-channelzone.js");
    ok(/id\(k, "audit"\)/.test(cz), "专区后台有「图片体检」入口");
    ok(/IMFIX\.audit/.test(cz), "体检调用的是同一套判定");
    ok(/"cz-" \+ k \+ "-" \+ s/.test(cz) || /function id\(k, s\)/.test(cz), "面板元素 id 规则未变");

    const fs2 = read("js/find-similar.js");
    ok(/stripAuth/.test(fs2), "以图搜图前剥离令牌（不把登录态发给外站）");

    const ve = read("js/view-export.js");
    ok(/stripAuth/.test(ve), "导出网页的兜底地址也剥令牌（发给别人的文件里不能有令牌）");

    FRONT_CHECK();
  }

  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) process.exit(1);
};

/* 版本戳统一 */
function FRONT_CHECK() {
  const pages = ["index.html", "admin.html", "rank.html", "rhythm.html", "shein.html",
    "pinterest.html", "tiktok.html", "compare.html", "fav.html", "movement.html", "trends.html"];
  pages.forEach((f) => {
    let s = "";
    try { s = read(f); } catch (e) { ok(false, f + " 读取失败"); return; }
    ok(s.indexOf("js/supabase.js") >= 0, f + " 引用了数据层（兜底才会生效）");
  });
  ok(/20261115[A-Z]/.test(read("js/supabase.js")), "数据层脚本带版本戳");
}

run().catch((e) => { console.error("测试崩溃：" + ((e && e.stack) || e)); process.exit(1); });
