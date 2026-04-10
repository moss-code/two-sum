# 部署文档

完整的本地调试和线上部署指南。

## 📋 目录

- [环境准备](#环境准备)
- [技术架构说明](#技术架构说明)
- [本地开发](#本地开发)
- [测试验证](#测试验证)
- [生产部署](#生产部署)
- [监控运维](#监控运维)
- [故障排查](#故障排查)
- [API 文档](#api-文档)

---

## 环境准备

### 1. 安装 Node.js

确保安装了 Node.js 16 或更高版本：

```bash
node --version  # 应该 >= v16.0.0
npm --version
```

如果没有安装，访问 [nodejs.org](https://nodejs.org/) 下载安装。

### 2. 注册 Cloudflare 账号

1. 访问 [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
2. 注册免费账号（无需信用卡）
3. 验证邮箱

### 3. 安装项目依赖

```bash
cd /path/to/two-sum
npm install
```

---

## 技术架构说明

### 数据采集架构

本系统采用 **Cloudflare Worker Cron** 直接采集数据：

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Cron Job   │──│  collector   │──│  D1 Database │       │
│  │  (每分钟)     │  │   模块       │  │              │       │
│  └──────────────┘  └──────┬───────┘  └──────────────┘       │
│                           │                                 │
│           ┌───────────────┼───────────────┐                 │
│           ▼               ▼               ▼                 │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│    │  CN 区     │  │  ja3 代理   │  │   US 区    │          │
│    │ 直接连接    │  │  服务      │  │ 通过代理    │          │
│    └────────────┘  └────────────┘  └────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**说明：**
- **CN 区**：Worker 直接通过 WebSocket 连接 `wss://collaboration-ws.leetcode.cn`
- **US 区**：Worker 通过 ja3 代理服务连接，绕过 TLS 指纹检测
- **定时任务**：Worker Cron 每分钟触发一次，自动采集并存储到 D1 数据库

### ja3 代理服务

LeetCode 国际站（US）有反爬虫机制，会检测 TLS 指纹。需要使用 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 代理服务来绕过检测。

**工作原理：**
```
Worker ──HTTP──▶ ja3-proxy ──WebSocket──▶ LeetCode US
       (带TLS)      (模拟浏览器指纹)
```

---

## 本地开发

### Step 1: 创建数据库

```bash
npm run db:create
```

**预期输出：**
```
✅ Successfully created DB 'two-sum-db'!

[[d1_databases]]
binding = "DB"
database_name = "two-sum-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**重要**：复制输出中的 `database_id`。

### Step 2: 更新配置文件

编辑 `wrangler.toml`，将 `database_id` 替换为上一步获得的值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "two-sum-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # 粘贴你的 ID
```

### Step 3: 初始化数据库表

```bash
npm run db:init
```

**验证表创建成功：**
```bash
npx wrangler d1 execute two-sum-db --local --command "SELECT name FROM sqlite_master WHERE type='tables'"
```

应该看到 `records` 表。

### Step 4: 配置 ja3 代理（可选，仅测试 US 区时需要）

如果你在本地开发时需要测试 US 区数据采集，需要配置 ja3 代理：

**方式 1：使用已部署的代理**

在 `wrangler.toml` 中添加：

```toml
[vars]
PROXY_URL = "https://your-ja3-proxy.onrender.com"
PROXY_API_KEY = "your-proxy-api-key"
```

**方式 2：本地启动代理**

参考 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 项目在本地启动代理服务，然后配置：

```toml
[vars]
PROXY_URL = "http://localhost:8080"
PROXY_API_KEY = "proxy_secret-key-2024"
```

### Step 5: 启动 Worker 开发服务器

在一个终端窗口运行：

```bash
npm run dev
```

**预期输出：**
```
⛅️ wrangler 3.x.x
-------------------
⎔ Starting local server...
[wrangler:inf] Ready on http://localhost:8787
```

保持此终端运行。

### Step 6: 启动前端页面

在另一个新终端运行：

```bash
npm run pages:dev
```

访问 `http://localhost:3000` 查看前端页面。

> **注意**：前端会自动使用 `http://localhost:8787` 作为 API 地址（在 localhost 环境下）。

### Step 7: 测试数据采集

Worker 会在 Cron 触发时自动采集数据。在本地开发环境，你可以：

1. **等待 Cron 触发**（如果配置了每分钟触发）
2. **手动触发**（通过代码调用）

查看采集日志：

```bash
# 在另一个终端运行
npx wrangler tail
```

**验证数据写入：**
```bash
npx wrangler d1 execute two-sum-db --local --command "SELECT * FROM records ORDER BY timestamp DESC LIMIT 5"
```

---

## 测试验证

### 测试 API 端点

```bash
# 1. 查看 API 信息
curl http://localhost:8787

# 2. 获取最新数据
curl http://localhost:8787/api/latest

# 3. 获取历史数据（原始）
curl "http://localhost:8787/api/data?hours=1"

# 4. 按 5 分钟聚合
curl "http://localhost:8787/api/aggregated?granularity=fivemin&limit=20"

# 5. 按半小时聚合
curl "http://localhost:8787/api/aggregated?granularity=halfhour&limit=10"

# 6. 按小时聚合
curl "http://localhost:8787/api/aggregated?granularity=hour&limit=24"

# 7. 按天聚合
curl "http://localhost:8787/api/aggregated?granularity=day&limit=30"

# 8. 按月聚合
curl "http://localhost:8787/api/aggregated?granularity=month&limit=12"

# 9. 查看统计信息
curl http://localhost:8787/api/stats
```

### 测试前端功能

访问 `http://localhost:3000`，测试以下功能：

- ✅ **粒度切换**：点击"按 5 分钟"/"按半小时"/"按小时"/"按天"/"按月"按钮
- ✅ **统计卡片**：查看最新的在线人数
- ✅ **趋势图表**：查看数据趋势线
- ✅ **交互缩放**：拖拽图表下方的滑块
- ✅ **Tooltip**：鼠标悬停查看详细数据
- ✅ **自动刷新**：等待 60 秒观察自动更新

### 采集测试数据

为了让图表更好看，可以连续触发几次采集：

```bash
# 在 wrangler tail 窗口查看日志的同时
# 重启 Worker 会触发 Cron 立即执行
```

或者手动插入测试数据：

```bash
npx wrangler d1 execute two-sum-db --local --command "
INSERT INTO records (region, count, timestamp) VALUES
('CN', 500, $(($(date +%s) * 1000))),
('US', 1200, $(($(date +%s) * 1000)))
"
```

---

## 生产部署

### Step 1: 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开授权页面，点击 "Allow" 完成登录。

### Step 2: 创建生产数据库（如果还没创建）

如果你之前只在本地创建了数据库，需要确认 `wrangler.toml` 中的 `database_id` 已正确配置。

**验证数据库：**
```bash
npx wrangler d1 list
```

应该能看到 `two-sum-db`。

### Step 3: 初始化生产数据库

```bash
npm run db:init:remote
```

**验证：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### Step 4: 部署 ja3 代理服务

**使用 Render 部署（推荐，免费）**

1. 访问 [render.com](https://render.com) 注册账号
2. 创建新的 Web Service
3. 连接 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 仓库
4. 配置：
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python app.py`
   - **Instance Type**: Free
5. 记下分配的 URL，如 `https://your-ja3-proxy.onrender.com`

**部署完成后测试：**

```bash
curl https://your-ja3-proxy.onrender.com/health
```

应该返回 `{"status": "ok"}`。

### Step 5: 配置生产环境 Secrets

设置 ja3 代理的配置：

```bash
# 设置代理 URL
npx wrangler secret put PROXY_URL
# 输入你的 ja3 代理地址，如：https://your-ja3-proxy.onrender.com

# 设置代理 API 密钥
npx wrangler secret put PROXY_API_KEY
# 输入你的代理 API 密钥
```

**验证 Secrets：**

```bash
npx wrangler secret list
```

应该看到 `PROXY_URL` 和 `PROXY_API_KEY`。

### Step 6: 部署 Worker

```bash
npm run deploy
```

**预期输出：**
```
✨ Compiled Worker successfully
🌍 Uploading...
✨ Success! Deployed to https://two-sum.YOUR-SUBDOMAIN.workers.dev
```

**重要**：记下这个 URL！

### Step 7: 测试生产 Worker

```bash
# 替换为你的实际 URL
WORKER_URL="https://two-sum.YOUR-SUBDOMAIN.workers.dev"

# 测试 API
curl $WORKER_URL
curl $WORKER_URL/api/latest
curl "$WORKER_URL/api/stats"
```

### Step 8: 验证数据采集

等待 1-2 分钟后，检查数据是否写入：

```bash
npx wrangler d1 execute two-sum-db --remote --command "SELECT * FROM records ORDER BY timestamp DESC LIMIT 5"
```

查看 Worker 日志确认采集情况：

```bash
npx wrangler tail
```

### Step 9: 部署前端

**更新 API URL**

编辑 `public/index.html`，找到这一行：

```javascript
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : 'https://two-sum.YOUR-SUBDOMAIN.workers.dev';  // 替换为实际 URL
```

将 `YOUR-SUBDOMAIN` 替换为你的实际子域名。

**部署到 Pages**

```bash
npm run pages:deploy
```

**预期输出：**
```
✨ Success! Deployed to https://two-sum-web.pages.dev
```

访问这个 URL，你应该能看到完整的可视化页面！

### Step 10: 绑定自定义域名（可选）

#### Worker 自定义域名

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → two-sum → Settings → Triggers
3. Custom Domains → Add Custom Domain
4. 输入你的域名（如 `api.example.com`）

#### Pages 自定义域名

1. Pages → two-sum-web → Custom domains
2. Set up a custom domain
3. 输入你的域名（如 `leetcode.example.com`）

---

## 监控运维

### 查看数据库统计

**本地环境：**
```bash
# 总记录数
npx wrangler d1 execute two-sum-db --local --command "
SELECT COUNT(*) as total FROM records
"

# 按区域统计
npx wrangler d1 execute two-sum-db --local --command "
SELECT
  region,
  COUNT(*) as count,
  MIN(count) as min,
  MAX(count) as max,
  AVG(count) as avg
FROM records
GROUP BY region
"

# 最近 10 条记录
npx wrangler d1 execute two-sum-db --local --command "
SELECT * FROM records ORDER BY timestamp DESC LIMIT 10
"
```

**生产环境：** 将 `--local` 改为 `--remote`。

### 实时查看 Worker 日志

```bash
npx wrangler tail
```

你会看到：
- Cron 任务触发日志
- 数据采集结果（US 和 CN 区的在线人数）
- 数据写入日志
- 错误信息（如果有）

### 数据清理

**删除 90 天前的数据：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "
DELETE FROM records
WHERE timestamp < (strftime('%s', 'now', '-90 days') * 1000)
"
```

**删除所有数据（慎用）：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "DELETE FROM records"
```

### 数据库备份

**导出数据：**
```bash
# 导出为 JSON
npx wrangler d1 execute two-sum-db --remote --command "
SELECT * FROM records
" --json > backup-$(date +%Y%m%d).json

# 查看备份
cat backup-*.json | jq '.[0].results | length'
```

### Worker 性能监控

在 Cloudflare Dashboard 查看：

1. **Workers Analytics**：
   - Workers & Pages → two-sum → Metrics
   - 查看请求数、执行时间、错误率

2. **D1 Analytics**：
   - Storage & Databases → D1 → two-sum-db → Metrics
   - 查看查询次数、行数读取

---

## 故障排查

### 问题 1: 数据库连接失败

**错误信息：**
```
Error: D1_ERROR: no such table: records
```

**解决方案：**
```bash
# 重新初始化数据库
npm run db:init:remote

# 验证表是否存在
npx wrangler d1 execute two-sum-db --remote --command "
SELECT name FROM sqlite_master WHERE type='table'
"
```

### 问题 2: US 区 WebSocket 403 错误

**错误信息：**
```
[US] ❌ 错误: Unexpected server response: 403
```

**原因：** LeetCode 国际站有 TLS 指纹检测机制。

**解决方案：**

1. **检查 ja3 代理服务状态：**
   ```bash
   curl https://your-ja3-proxy.onrender.com/health
   ```

2. **检查 Secrets 配置：**
   ```bash
   npx wrangler secret list
   
   # 重新设置
   npx wrangler secret put PROXY_URL
   npx wrangler secret put PROXY_API_KEY
   ```

3. **重新部署 Worker：**
   ```bash
   npm run deploy
   ```

### 问题 3: CN 区连接失败

**错误信息：**
```
[CN] ❌ 错误: WebSocket 连接失败
```

CN 区通常连接稳定。如果失败：

1. 检查网络连接
2. 查看 Worker 日志确认重试情况
3. Worker 会自动重试 3 次

### 问题 4: 前端无法加载数据

**检查清单：**

1. **API URL 配置错误**

   检查 `public/index.html` 中的 `API_URL` 是否正确：
   ```javascript
   const API_URL = 'https://two-sum.YOUR-SUBDOMAIN.workers.dev';
   ```

2. **CORS 问题**

   打开浏览器开发者工具 → Network，查看是否有 CORS 错误。
   Worker 代码已包含 CORS 头，应该不会有问题。

3. **Worker 未运行**

   ```bash
   curl https://two-sum.YOUR-SUBDOMAIN.workers.dev
   ```

   应该返回 API 信息。

4. **数据库为空**

   ```bash
   npx wrangler d1 execute two-sum-db --remote --command "
   SELECT COUNT(*) FROM records
   "
   ```

   如果为 0，说明 Cron 还未触发或采集失败。查看日志：
   ```bash
   npx wrangler tail
   ```

### 问题 5: 定时任务没有执行

**检查 Cron 配置：**

```bash
npx wrangler trigger list
```

应该看到 `* * * * *`（每分钟）。

**查看日志：**

```bash
npx wrangler tail
```

观察是否有 Cron 触发日志：
```
Cron triggered at: 2026-04-10T12:34:56.789Z
```

### 问题 6: ja3 代理服务返回 500 错误

**解决方案：**

1. 检查代理服务是否正常运行
2. 检查代理服务的日志
3. 确保代理服务的 API 密钥正确
4. 重启代理服务

---

## API 文档

### 基础信息

- **Base URL (本地)**: `http://localhost:8787`
- **Base URL (生产)**: `https://two-sum.YOUR-SUBDOMAIN.workers.dev`

所有 API 支持 CORS，无需额外配置。

### GET /

获取 API 信息。

**响应示例：**
```json
{
  "name": "LeetCode Two-Sum Monitor API",
  "version": "1.0.0",
  "endpoints": {
    "/api/data": "获取历史数据",
    "/api/latest": "获取最新数据",
    "/api/stats": "获取统计信息",
    "/api/aggregated": "按粒度聚合数据"
  }
}
```

### GET /api/latest

获取最新的在线人数。

**响应示例：**
```json
{
  "US": {
    "region": "US",
    "count": 1234,
    "timestamp": 1707580800000
  },
  "CN": {
    "region": "CN",
    "count": 567,
    "timestamp": 1707580800000
  },
  "updated_at": "2024-02-10T12:00:00.000Z"
}
```

### GET /api/data

获取原始历史数据。

**查询参数：**
- `hours` (可选)：返回最近 N 小时的数据，默认 24

**请求示例：**
```bash
curl "http://localhost:8787/api/data?hours=6"
```

**响应示例：**
```json
[
  {
    "region": "US",
    "count": 1234,
    "timestamp": 1707580800000
  },
  {
    "region": "CN",
    "count": 567,
    "timestamp": 1707580800000
  }
]
```

### GET /api/aggregated

按时间粒度聚合数据（核心 API）。

**查询参数：**
- `granularity` (可选)：时间粒度，可选值：
  - `fivemin` - 按 5 分钟
  - `halfhour` - 按半小时
  - `hour`（默认）- 按小时
  - `day` - 按天
  - `month` - 按月
- `limit` (可选)：返回的数据点数量，默认 168

**请求示例：**
```bash
# 按 5 分钟（最近 24 小时）
curl "http://localhost:8787/api/aggregated?granularity=fivemin&limit=288"

# 按半小时（最近 7 天）
curl "http://localhost:8787/api/aggregated?granularity=halfhour&limit=336"

# 按小时（最近 7 天）
curl "http://localhost:8787/api/aggregated?granularity=hour&limit=168"

# 按天（最近 90 天）
curl "http://localhost:8787/api/aggregated?granularity=day&limit=90"

# 按月（最近 24 个月）
curl "http://localhost:8787/api/aggregated?granularity=month&limit=24"
```

**响应示例：**
```json
[
  {
    "region": "CN",
    "time": "2026-02-10 15:00",
    "avg_count": 547.82,
    "min_count": 546,
    "max_count": 550,
    "sample_count": 11
  }
]
```

**字段说明：**
- `time`: 时间标签（格式根据粒度变化）
- `avg_count`: 该时间段的平均在线人数
- `min_count`: 该时间段的最小在线人数
- `max_count`: 该时间段的最大在线人数
- `sample_count`: 该时间段的采样数量

### GET /api/stats

获取统计信息。

**响应示例：**
```json
{
  "total_records": 2880,
  "by_region": [
    {
      "region": "US",
      "count": 1440,
      "min": 800,
      "max": 2000,
      "avg": 1234.5
    },
    {
      "region": "CN",
      "count": 1440,
      "min": 300,
      "max": 800,
      "avg": 567.8
    }
  ]
}
```

---

## 性能优化建议

### 1. 数据聚合

对于长时间范围（30 天+），建议使用聚合 API 而不是原始数据 API：

- ✅ **好**：`/api/aggregated?granularity=day&limit=90`
- ❌ **不好**：`/api/data?hours=2160`（90 天 = 129,600 条原始记录）

### 2. 限制数据点数量

前端已自动设置合理的 limit：
- 按 5 分钟：288 点（24 小时）
- 按半小时：336 点（7 天）
- 按小时：168 点（7 天）
- 按天：90 点（90 天）
- 按月：24 点（24 个月）

### 3. 数据库索引

`schema.sql` 已创建索引：
```sql
CREATE INDEX idx_region_timestamp ON records(region, timestamp DESC);
CREATE INDEX idx_timestamp ON records(timestamp DESC);
```

### 4. 定期清理历史数据

建议保留最近 90 天的数据，定期清理旧数据：

```bash
# 每周运行一次（保留 90 天）
npx wrangler d1 execute two-sum-db --remote --command "
DELETE FROM records
WHERE timestamp < (strftime('%s', 'now', '-90 days') * 1000)
"
```

---

## 常见问题 FAQ

### Q1: 为什么需要 ja3 代理？

A: LeetCode 国际站（US）有 TLS 指纹检测机制，会阻止来自 Cloudflare Workers 的直接连接。通过 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 代理服务可以模拟浏览器指纹，绕过检测。

中国区（CN）没有这种限制，Worker 可以直接连接。

### Q2: 免费额度够用吗？

A: 完全够用！Cloudflare 免费额度：

- **Workers**: 100,000 请求/天 + Cron 触发
- **D1**: 100,000 行读取/天，1 GB 存储
- **Pages**: 无限请求

按每分钟采集 2 次（US + CN），每天约 2,880 次写入，远低于限制。

### Q3: 如何部署自己的 ja3 代理？

A: 参考 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 项目：

1. 克隆仓库
2. 部署到 Render、Heroku 或自己的服务器
3. 配置 `PROXY_URL` 和 `PROXY_API_KEY`

### Q4: 数据会丢失吗？

A: Cloudflare D1 是持久化存储，数据不会丢失。建议定期备份（导出 JSON）。

### Q5: 如何更换 ja3 代理地址？

A:

```bash
# 1. 更新 Worker Secret
npx wrangler secret put PROXY_URL
# 输入新的代理地址

# 2. 重新部署 Worker
npm run deploy
```

### Q6: 可以只监控 CN 区吗？

A: 可以。如果不配置 `PROXY_URL`，US 区采集会失败，但 CN 区仍会正常工作。前端会显示 US 区为 "暂无"。

---

## 下一步

### ✅ 已完成
- [x] Worker API 部署
- [x] D1 数据库创建
- [x] Worker 直接采集数据（Cron）
- [x] CN 区直接 WebSocket 采集
- [x] US 区通过 ja3 代理采集
- [x] 前端可视化（5 种粒度）

### 🔄 待优化
- [ ] 绑定自定义域名
- [ ] 添加数据导出功能
- [ ] 添加更多题目监控
- [ ] 设置告警通知

---

## 联系与支持

- **GitHub Issues**: 报告 bug 或提出建议
- **文档**: README.md 查看项目概览
- **Cloudflare Docs**: https://developers.cloudflare.com
- **ja3-proxy**: https://github.com/moss-code/ja3-proxy-python

---

**部署愉快！** 🚀

如有问题，请参考本文档的故障排查章节，或查看 Worker 日志。
