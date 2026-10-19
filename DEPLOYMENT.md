# 部署与升级

本次修改保持原有 Cloudflare Worker + D1 + Pages 架构，不新增服务。
本地实现和测试不会自动发布，也不会自动修改生产数据库。

## 已有数据库升级

1. 先通过 Cloudflare D1 Time Travel 或导出确认可用备份。可用以下命令导出到本地：

~~~sh
npx wrangler d1 export two-sum-db --remote --output=two-sum-backup.sql
~~~

2. 执行一次无损迁移：

~~~sh
npm run db:migrate:remote
~~~

migrations/0001_rollups.sql 保留 records 历史数据，新增 aggregates，扫描原始记录一次构建小时汇总，再从小时构建日、从日构建月。历史回填本身消耗 D1 读写额度，接近当日额度时安排到额度恢复后执行。迁移可重复运行，结果按桶替换，不重复累加。
不要在 SQL 控制台粘贴旧版本的 DROP TABLE 初始化脚本。本版本 schema.sql 已改为非破坏性初始化；已有库只需要执行迁移。

3. 确认原有 Worker 的 PROXY_URL 和 PROXY_API_KEY secrets 已配置。缺失时分别执行交互式命令，不把真实密钥写入文档或代码：

~~~sh
npx wrangler secret put PROXY_URL
npx wrangler secret put PROXY_API_KEY
~~~

4. 先手动发布 Worker，再推送 GitHub 触发前端自动部署：

~~~sh
npm run deploy
git push origin main
~~~

前端使用仓库既有的 GitHub 自动部署；不要在后端迁移、发布完成前推送依赖新 API 的界面。
Worker 保留 api.twosum.icu 的现有域名绑定；Pages 项目保持 two-sum-web 和 twosum.icu。
如果需要绕过 GitHub 做一次手动 Pages 发布，可以另用 npm run pages:deploy。
前端生产 API 地址在 public/app.js 的 API 常量中；本地自动访问 localhost:8787。
前端仍使用原项目的 ECharts 5.4.3 CDN，不需要构建步骤。

5. 部署后只做少量抽查：/api/latest、/api/aggregated?granularity=hour&limit=2，以及页面的小时/天/月、时区和刷新。不要反复直接查原始历史表验证页面。
响应 X-Cache 为 MISS/HIT，Cache-Control 为 120 秒；观察 D1 仪表盘的实际 rows_read / rows_written。Cache API 缓存在各数据中心独立，命中率取决于访问分布。

## 新库与本地开发

新库先创建数据库并在 wrangler.toml 填入对应 database_id，再初始化和迁移：

~~~sh
npm run db:create
npm run db:init:remote
npm run db:migrate:remote
~~~

本地调试使用本地数据库：

~~~sh
npm install
npm run db:init
npm run db:migrate
npm run dev
~~~

打开 http://localhost:8787。单独运行前端也可用 npm run pages:dev，但需要另外启动 Worker。
本地不会自动定时采集；需要测试 Cron 时，用 wrangler dev --assets public --test-scheduled，然后访问其 /__scheduled 测试路由。该操作会向真实采集服务发请求，纯回归测试无需它。

## 数据与额度

- Cron 每两分钟采样。以 scheduledTime 标识采样，同地区同时间重复执行不会重复插入。
- 每轮在同一个 D1 原子 batch 中写原始数据，按索引范围重建当前与前一小时，再更新受影响日/月。
- 日/月的峰值取下层 MAX，平均值通过 SUM / sample_count 加权，避免平均数的平均数。
- 图表聚合 API 不查询 records，只按 granularity、region、bucket 主键查所需窗口。
- latest 对两个地区分别取索引最新记录；stats 只读取月汇总。
- 所有有效公共 GET 响应缓存 120 秒。追踪参数忽略，已知参数先校验、再规范化缓存键；错误不缓存。
- 仍有持续采集、汇总更新和首次回填的读写成本；索引也会计入部分写入量。不能把返回行数直接当成所有 D1 计费行数。

## 验证

~~~sh
npm test
npx wrangler deploy --dry-run
~~~

覆盖迁移无损与重复执行、MAX/加权平均、跨月边界、重复采集、写入回滚、独立地区限制、缓存、非法参数、真实小时过滤、零值与缺失值。性能回归使用 180 天、259,200 条本地记录，检查图表查询走汇总索引。

官方参考：[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 索引](https://developers.cloudflare.com/d1/best-practices/use-indexes/)、[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
