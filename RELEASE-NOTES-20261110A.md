# 20261110A · 权限保存报错修复

## 一、你看到的报错

```
保存失败: new row for relation "zone_permissions"
violates check constraint "zone_permissions_zone_check"
```

这不是代码写错，是**数据库把「允许有哪些专区」写死了**。

`zone_permissions` 这类表的 `zone` 列上有一条 CHECK 约束，清单只包含早期那几个专区
（视觉 / 趋势 / 招品 / BESTSELLER / 趋势动向…）。后来新增的「上新节奏」（key = `rhythm`）
不在清单里，管理员一保存权限，数据库直接拒绝。

以前加「趋势动向」时踩过同一个坑，当时的解法就是删掉这类硬编码约束；
这次重新部署 `setup.sql` 之后约束又被建了回来，所以又报。

## 二、修法

### 1) 跑一次 SQL（关键）

`sql/patch_20261110A_zone_constraint.sql`

- 动态从 `pg_constraint` 里找出「带 zone 列的表」上的 zone 相关 CHECK 约束并删除
- **不写死约束名**，约束改过名字也能命中
- 只删 CHECK；主键、唯一键、外键、非空、RLS 全部保留；不删列、不动数据
- **幂等**，可重复执行；末尾附自检 SQL（应返回 0 行）

跑完再保存权限即可成功。

> 每新增一个专区都要回来改约束是设计问题，这次把校验交给应用层，以后加专区不用再碰数据库。

### 2) 代码修正

`js/admin-perm.js` 里保存类目授权时，会往一批专区写权限。原来的清单里有已下线的
`channel`（渠道雷达），缺了 `rhythm`（上新节奏）：

```
改前：["visual", "trend", "recruit", "bestseller", "movement", "channel"]
改后：["visual", "trend", "recruit", "bestseller", "movement", "rhythm"]
```

不改会怎样：每次保存都往一个已经不存在的专区写行，白白触发一次失败（也可能直接
把整个保存流程打断）。

## 三、控制台那 65 条 400

同一屏里 DevTools 有大量 `Failed to load resource: 400`。那是**另一个原因**：

`rank_items` 表少了 `channel` 列（`sql/patch_20261109A_rank_channel.sql` 还没执行）。
凡是带 `channel` 的取数都会被数据库拒掉，页面每次刷新/切换都会刷一批 400。

补上这条即可：

```sql
alter table rank_items add column if not exists channel text not null default '';
create index if not exists idx_rank_items_channel
  on rank_items (period_type, period_label, category, channel);
```

**两条 SQL 都跑**，一次解决两类报错。

## 四、部署清单

| 文件 | 动作 |
|---|---|
| `sql/patch_20261110A_zone_constraint.sql` | 新增，**在数据库执行** |
| `sql/patch_20261109A_rank_channel.sql` | 若未执行，**一并执行** |
| `js/admin-perm.js` | 覆盖 |
| `admin.html` 及各页版本号 | 覆盖（统一 `20261110A`） |
| `tests/t_zone_constraint.mjs` | 新增测试 |

覆盖后 **Ctrl+F5 强制刷新**。

## 五、验证

- 新增 `tests/t_zone_constraint.mjs` 17 项：SQL 幂等/只删 CHECK/不碰数据、专区清单无 channel 有 rhythm、权限可勾选专区含「上新节奏」、版本号已升级、失败提示不被吞
- `t_rhythm_channel.mjs` 版本号断言同步到 `20261110A`，65 项全过
- 全部 14 个套件回归，失败 0
