# Two Sum：Liquid Glass 界面与低读取量峰值统计

## 目标与已确认要求

用户于 2026-10-19 确认使用 MAX 和已预览的 Liquid Glass 界面；本文件记录此前讨论并获确认的实现范围，不重复请求批准。

- 沿用三张统计卡、一个双 Y 轴图表；US/CN 始终同时显示。
- 只保留小时、天、月。主图显示各时间桶的最高采样人数，顶部卡片显示最新原始采样。
- 缺失区间仅在视觉上连线；原始缺失值和“无数据”提示保留，不补零。
- 磨砂模糊 21px，透光卡片、高光边缘、滑动玻璃选中态；支持移动端、深色模式及减少动效/透明度偏好。
- 解决每次聚合访问扫描全部历史的问题：采集时维护聚合表，查询时按索引读取并缓存 120 秒。

## 技术栈与命令

保留原生 JavaScript、Cloudflare Workers/D1/Pages、ECharts 5.4.3。测试使用 Node.js 22.13+ 的 `node:test`、内存 SQLite 和 VM ESM 加载器，无新增运行时框架。

```sh
npm install
npm test
npm run db:init
npm run db:migrate
npm run dev
npm run pages:dev
npx wrangler deploy --dry-run --outdir dist/worker
```

生产上线顺序：先备份，再 `npm run db:migrate:remote`，再部署 Worker，最后部署 Pages。迁移创建聚合表并保留原始数据；本次实现只运行本地迁移与验证，不修改线上数据库或发布线上版本。

## 文件结构与风格

- `src/index.js`：请求校验、缓存、查询、Cron。
- `src/storage.js`：UTC 时间桶、原子写入与有界聚合重建。
- `src/collector.js`：保留 CN 直连、US 代理的采集方式。
- `migrations/0001_rollups.sql`：无损创建并回填 `aggregates`。
- `public/index.html`、`public/styles.css`、`public/app.js`：真实数据页面与已确认的视觉设计。
- `public/data.js`：图表数据对齐、峰值和 UTC 桶显示等可测试函数。
- `tests/`：API/迁移/采集幂等性及图表数据回归测试。

使用两空格缩进、清晰的函数与变量名、参数绑定 SQL，继续保持轻量 ES modules：

```js
const peak = Number.isFinite(record.max_count) ? record.max_count : null;
```

## 数据与查询设计

`aggregates(granularity, region, bucket, min_count, max_count, sum_count, sample_count)` 以 `(granularity, region, bucket)` 为主键。小时桶从原始记录构建；日桶从小时桶构建；月桶从日桶构建。AVG 用总和除以样本数，不能对平均值直接再求平均。

迁移仅扫描原始历史一次生成小时表，再逐级回填日/月。Cron 使用 `scheduledTime` 作为稳定采样时间，在一次 D1 batch 内避免重复原始记录并重建当前及前一小时、相关日/月；跨小时部署或任务重试可以恢复最近桶。采集重建只读取有索引的窄时间窗口，不扫描全部历史。

`GET /api/aggregated?granularity=hour|day|month&limit=N` 的 limit 是每地区点数，默认 168/90/24，最高 336/180/48。返回 `timestamp` 毫秒桶起点及兼容的 UTC `time`、`max_count`、`min_count`、`avg_count`、`sample_count`。各区分别限量，按桶时间递增返回。

小时/日/月桶均按 UTC 定义；时区切换只在前端改变时刻显示，日/月保留 UTC 桶日期并明确标注。`/api/latest` 按地区独立查最新原始记录。`/api/stats` 合并月聚合，不扫描原始表。`/api/data` 限定真实时间范围（最多 168 小时），仅供有界原始数据查询。

缓存先于数据库查询；使用已校验的路径和参数构造规范键，忽略追踪参数，错误响应不缓存。记录 `meta.rows_read`、`meta.rows_written` 和响应缓存命中标记，便于上线后验证额度变化。

前端每两分钟刷新；隐藏标签页暂停，恢复时按数据年龄更新。切换时区直接重绘，切换粒度优先使用仍新鲜的前端缓存；取消过期请求，失败时保留已有数据，成功刷新不重置图表缩放。

## 验证策略

2026-10-19 补充：小时/日刻度与悬浮提示显示周几，周六/周日用淡紫底色标记；小时按所选时区，日按 UTC 统计日，月不标单一周几。周视图逐日标记，放大后恢复小时刻度；标记完全在前端计算，不增加 API 或 D1 查询。

- 真实 SQLite 集成验证迁移无损、MAX/加权 AVG、各地区独立最新数据、有界查询、Cron 重试幂等、零值与无效值。
- Cache API stub 验证缓存命中不再访问 D1、规范参数以及非法输入的状态码。
- 图表数据测试验证同一时间轴、独立空缺、MAX 优先和日/月日期不因负时区偏移错位。
- 本地 Wrangler dry run 和本地实际 D1 迁移验证运行时兼容性。
- 浏览器验证真实页面、粒度/时区/刷新、响应式与错误/空数据状态；本地夹具验证不依赖线上额度。
- 用查询计划和大规模本地样本比较原始扫描与聚合索引读取；上线后以真实 D1 metadata 为最终计量。

## 边界与完成条件

始终：保护历史与凭据；使用增量迁移；验证后交付；明确尚未上线的状态。

需单独明确授权：线上数据库迁移、公开部署、清理/删除原始历史、引入新的付费存储服务。

禁止：清空现有表、提交密钥、以示意数据冒充线上数据、为了通过测试移除回归检查。

实施顺序：复现并固定后端问题 → 无损迁移/聚合维护与查询缓存 → 接入真实数据的界面 → 本地验证与操作文档。此前确定的视觉与统计口径作为验收依据。
