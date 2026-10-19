# LeetCode Two-Sum 在线人数监控

Cloudflare Workers 每两分钟采集 US / CN 在线人数，D1 存储历史记录，Pages 展示两区共用时间轴的图表。

- Liquid Glass 风格，柔和彩色背景、半透明卡片和玻璃分段控件，跟随系统深浅色。
- 只保留小时、天、月；曲线显示区间采样人数的 MAX。顶部两区卡片显示各区最新采样。
- 图表缺口在视觉上连线，原始缺失值仍保留为空，提示中显示“无数据”。
- 小时/日图显示周几，并用淡紫底色标出周六、周日；周视图逐日标记，放大后显示具体小时。小时标记随显示时区变化，日图保持 UTC 统计日口径。
- 默认查看最近 7 天 / 90 天 / 24 个月，支持缩放。两区分别限量和使用各自纵轴。
- 聚合查询使用预聚合表的索引范围查询；服务端缓存 120 秒。时区切换不访问数据库，隐藏标签页暂停刷新。

## 本地运行

需要 Node.js 22.13+（推荐 24）及 npm。

~~~sh
npm install
npm run db:init
npm run db:migrate
npm run dev
~~~

打开 http://localhost:8787 即可查看完整页面和本地 API。空数据库显示暂无数据。
US 采集需要在 .dev.vars 中设置 PROXY_URL、PROXY_API_KEY；CN 使用 Workers 的 WebSocket Upgrade API 直连。不要把密钥提交到仓库。

~~~sh
npm test
npx wrangler deploy --dry-run
~~~

测试使用 Node 内置测试运行器、真实 SQLite 和模拟采集器，不访问生产数据库或外部采集服务。

## 查询方式

| 接口 | 参数 / 含义 |
| --- | --- |
| GET /api/aggregated | granularity=hour、day、month；limit 是每地区桶数，默认 168/90/24，最高 336/180/48 |
| GET /api/latest | 分别查询 US、CN 最新采样，缺失地区为 null |
| GET /api/data | hours=1..168，默认 24；真实时间范围，最多 10,000 条原始记录 |
| GET /api/stats | 从月汇总合并历史样本量、最小值、最大值、加权平均值 |

聚合结果保留 max_count、min_count、avg_count、sample_count，增加毫秒时间戳 timestamp；time 为 UTC 桶标签。前端曲线只取 max_count，零值正常显示。
日/月按 UTC 自然日/月统计；时区选择仅改变小时刻度和采样时间显示，不改变统计边界。MAX 是采样峰值，可能低于两次采样之间的实际瞬时峰值。

## 文件结构

- src/index.js：API 校验、缓存和定时采集。
- src/storage.js：有界小时重建、日/月汇总和原子写入。
- src/collector.js：CN WebSocket、US HTTP 代理及数值校验。
- migrations/0001_rollups.sql：无损历史回填。
- public/：静态界面、图表及数据处理。
- tests/：API、迁移、采集、图表与 180 天历史数据回归测试。

已有生产数据库必须先迁移，再部署 Worker 和 Pages，具体顺序见 [部署文档](DEPLOYMENT.md)。
