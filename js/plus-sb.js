/* ============================================================================
 * plus-sb.js —— 大码专区数据层（20261026P）
 * 只做大码自己的表：rank_plus_batches / rank_plus_items / rank_plus_matches。
 * 标码侧沿用现有 rank_items，由 rank.js / supabase.js 提供，本文件不碰。
 * 复用 SB 已登录的那个客户端（SB._client()），不新建第二个客户端。
 * ==========================================================================*/
const SBP = (() => {
  function cli() {
    if (!window.SB || typeof window.SB._client !== "function") throw new Error("数据层未就绪");
    return window.SB._client();
  }
  /* 表不存在（还没执行补丁脚本）要给人话，不要让页面白屏 */
  function patched(e) {
    const t = String((e && (e.message || e.details || e.hint)) || "");
    return /Could not find the table|does not exist|42P01|schema cache/i.test(t);
  }
  function fail(e, what) {
    if (patched(e)) throw new Error("大码专区还没启用：请先在数据库执行一次 tools/patch_20261026P.sql");
    throw new Error((e && e.message) || (what + "失败"));
  }

  const PAGE = 1000, MAX = 20000;

  return {
    /* 大码自己的类目 / 期次清单（类目集合以此为准） */
    async facets() {
      try {
        const { data, error } = await cli().rpc("rank_plus_facets");
        if (error) throw error;
        const o = data || {};
        return { periods: o.periods || [], categories: o.categories || [] };
      } catch (e) {
        /* 函数还没建（补丁未跑）：退回直接聚合，读不到就返回空，不影响其它页面 */
        try {
          const { data } = await cli().from("rank_plus_items").select("period_label,category").limit(5000);
          const periods = {}, cats = {};
          (data || []).forEach(r => {
            if (r.period_label) periods[r.period_label] = 1;
            if (r.category) cats[r.category] = 1;
          });
          return { periods: Object.keys(periods).sort(), categories: Object.keys(cats).sort() };
        } catch (e2) { return { periods: [], categories: [] }; }
      }
    },

    /* ---------- 批次 ---------- */
    async createBatch(b) {
      const payload = {
        period_type: (b && b.periodType) || "week",
        period_label: (b && b.periodLabel) || "",
        note: (b && b.note) || "",
      };
      const { data, error } = await cli().from("rank_plus_batches").insert(payload).select("id").single();
      if (error) fail(error, "创建上传批次");
      return data && data.id;
    },
    async updateBatch(id, patch) {
      const { error } = await cli().from("rank_plus_batches").update(patch || {}).eq("id", id);
      if (error) fail(error, "更新批次");
    },
    async listBatches() {
      const { data, error } = await cli().from("rank_plus_batches")
        .select("id, period_type, period_label, rows, skipped, note, created_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) { if (patched(error)) return []; fail(error, "读取上传记录"); }
      return data || [];
    },
    /* 删批次：条目按外键级联删除 */
    async deleteBatch(id) {
      const { error } = await cli().from("rank_plus_batches").delete().eq("id", id);
      if (error) fail(error, "删除批次");
    },

    /* ---------- 条目 ---------- */
    /* 分批写入：每批 300 条。单次请求体太大时网关会整批拒掉，
       分批的另一个好处是能给出真实进度。 */
    async insertItems(rows, onProgress) {
      const list = (rows || []).filter(Boolean);
      let inserted = 0;
      for (let i = 0; i < list.length; i += 300) {
        const chunk = list.slice(i, i + 300);
        const { data, error } = await cli().from("rank_plus_items").insert(chunk).select("id");
        if (error) fail(error, "写入大码数据");
        inserted += (data || []).length;
        if (onProgress) onProgress(inserted, list.length);
      }
      return inserted;
    },
    async listItems(f) {
      const o = f || {};
      const build = (from, to) => {
        let q = cli().from("rank_plus_items").select("*");
        if (o.periodLabel) q = q.eq("period_label", o.periodLabel);
        if (o.category) q = q.eq("category", o.category);
        else if (o.categories && o.categories.length) q = q.in("category", o.categories);
        if (o.site !== undefined && o.site !== null && o.site !== "") q = q.eq("site", o.site);
        return q.order("id", { ascending: true }).range(from, to);
      };
      const out = [];
      for (let from = 0; from < MAX; from += PAGE) {
        const { data, error } = await build(from, Math.min(from + PAGE, MAX) - 1);
        if (error) { if (patched(error)) return []; fail(error, "读取大码数据"); }
        const rows = data || [];
        rows.forEach(r => out.push(r));
        if (rows.length < PAGE) break;
        if (o.limit && out.length >= o.limit) break;
      }
      return o.limit ? out.slice(0, o.limit) : out;
    },
    /* 覆盖导入前清空「本期次 · 这些类目」的旧数据 */
    async clearSlot(o) {
      const periodLabel = (o && o.periodLabel) || "";
      const cats = ((o && o.categories) || []).filter(Boolean);
      let items = 0;
      for (let round = 0; round < 200; round++) {
        let q = cli().from("rank_plus_items").select("id").eq("period_label", periodLabel);
        if (cats.length) q = q.in("category", cats);
        const { data, error } = await q.limit(500);
        if (error) { if (patched(error)) return 0; fail(error, "清理旧大码数据"); }
        const rows = data || [];
        if (!rows.length) break;
        for (let i = 0; i < rows.length; i += 200) {
          const { error: e2 } = await cli().from("rank_plus_items").delete().in("id", rows.slice(i, i + 200).map(r => r.id));
          if (e2) fail(e2, "清理旧大码数据");
        }
        items += rows.length;
        if (rows.length < 500) break;
      }
      return items;
    },
    /* 追加导入用：该期次（+类目）下已有的图片网址 */
    async listSlotUrls(o) {
      const periodLabel = (o && o.periodLabel) || "";
      const cats = ((o && o.categories) || []).filter(Boolean);
      const urls = [];
      for (let page = 0; page < 100; page++) {
        let q = cli().from("rank_plus_items").select("image_url").eq("period_label", periodLabel)
          .order("id", { ascending: true }).range(page * 1000, page * 1000 + 999);
        if (cats.length) q = q.in("category", cats);
        const { data, error } = await q;
        if (error) { if (patched(error)) return []; fail(error, "读取已有大码图"); }
        const rows = data || [];
        rows.forEach(r => { if (r.image_url) urls.push(r.image_url); });
        if (rows.length < 1000) break;
      }
      return urls;
    },
    /* 按槽位精确计数（交给数据库数，不把全表拉回来自己数） */
    async countSlot(o) {
      const periodLabel = (o && o.periodLabel) || "";
      const cat = (o && o.category) || "";
      try {
        let q = cli().from("rank_plus_items").select("id", { count: "exact", head: true }).eq("period_label", periodLabel);
        if (cat) q = q.eq("category", cat);
        const res = await q;
        if (res && res.error) return null;
        return (res && typeof res.count === "number") ? res.count : null;
      } catch (e) { return null; }
    },

    /* ---------- 匹配结论 ---------- */
    async listMatches(o) {
      const periodLabel = (o && o.periodLabel) || "";
      const cat = (o && o.category) || "";
      const out = [];
      for (let from = 0; from < MAX; from += PAGE) {
        let q = cli().from("rank_plus_matches")
          .select("id, period_label, category, site, std_image_url, plus_image_url, score, score_img, score_txt, score_sem, method, decision")
          .eq("period_label", periodLabel);
        if (cat) q = q.eq("category", cat);
        const { data, error } = await q.order("id", { ascending: true }).range(from, Math.min(from + PAGE, MAX) - 1);
        if (error) { if (patched(error)) return []; fail(error, "读取匹配结论"); }
        const rows = data || [];
        rows.forEach(r => out.push(r));
        if (rows.length < PAGE) break;
      }
      return out;
    },
    /* 批量写结论。onConflict 覆盖同一「期次+类目+站点+标码图」的上一条。
       注意：算法重算时，调用方必须先把人工结论剔掉（见 plus-match.js 的 mergeManual）。 */
    async upsertMatches(rows) {
      const list = (rows || []).filter(r => r && r.std_image_url);
      if (!list.length) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i += 300) {
        const { data, error } = await cli().from("rank_plus_matches")
          .upsert(list.slice(i, i + 300), { onConflict: "period_label,category,site,std_image_url" })
          .select("id");
        if (error) fail(error, "保存匹配结论");
        n += (data || []).length;
      }
      return n;
    },
    /* 人工判定一条（method 固定 manual，重算不会被覆盖） */
    async setDecision(o) {
      const payload = {
        period_label: o.periodLabel || "",
        category: o.category || "",
        site: o.site || "",
        std_image_url: o.stdImageUrl || "",
        plus_image_url: o.plusImageUrl || "",
        score: (o.score == null ? null : o.score),
        method: "manual",
        decision: o.decision || "review",
        updated_at: new Date().toISOString(),
      };
      const { error } = await cli().from("rank_plus_matches")
        .upsert([payload], { onConflict: "period_label,category,site,std_image_url" });
      if (error) fail(error, "保存判定");
      return true;
    },
    async clearMatches(o) {
      const periodLabel = (o && o.periodLabel) || "";
      const cat = (o && o.category) || "";
      let q = cli().from("rank_plus_matches").delete().eq("period_label", periodLabel);
      if (cat) q = q.eq("category", cat);
      const { error } = await q;
      if (error) fail(error, "清理匹配结论");
      return true;
    },
  };
})();

try { window.SBP = SBP; } catch (e) {}