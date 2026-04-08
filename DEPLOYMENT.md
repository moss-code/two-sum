# 部署文档

完整的本地调试和线上部署指南。

## 📋 目录

- [环境准备](#环境准备)
- [本地开发](#本地开发)
- [测试验证](#测试验证)
- [生产部署](#生产部署)
- [自动采集设置](#自动采集设置)
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
cd /Users/lhp/Project/two-sum
npm install
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
npx wrangler d1 execute two-sum-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```

应该看到 `records` 表。

### Step 4: 启动 Worker 开发服务器

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

### Step 5: 启动前端页面

在另一个新终端运行：

```bash
npm run pages:dev
```

访问 `http://localhost:3000` 查看前端页面。

> **注意**：前端会自动使用 `http://localhost:8787` 作为 API 地址（在 localhost 环境下）。

### Step 6: 测试数据采集

在第三个新终端运行：

```bash
npm run collect
```

**预期输出：**
```
========== LeetCode 数据采集 ==========
时间: 2026-02-10T15:30:00.000Z
[US] 连接中...
[CN] 连接中...
[CN] 已连接
[CN] 收到消息: 550
[CN] ✅ 在线人数: 550

准备推送数据: [ { region: 'CN', count: 550, timestamp: 1770737400000 } ]
✅ 数据推送成功: { success: true, saved: 1, message: 'Successfully saved 1 records' }

✅ 采集完成！
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

# 4. 按分钟聚合
curl "http://localhost:8787/api/aggregated?granularity=minute&limit=20"

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

- ✅ **粒度切换**：点击"按分钟"/"按半小时"/"按小时"/"按天"/"按月"按钮
- ✅ **统计卡片**：查看最新的在线人数
- ✅ **趋势图表**：查看数据趋势线
- ✅ **交互缩放**：拖拽图表下方的滑块
- ✅ **Tooltip**：鼠标悬停查看详细数据
- ✅ **自动刷新**：等待 60 秒观察自动更新

### 持续采集测试数据

为了让图表更好看，可以连续采集一些数据：

```bash
# 连续采集 20 次，间隔 3 秒
for i in {1..20}; do
  echo "=== 第 $i 次采集 ==="
  npm run collect
  sleep 3
done
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

### Step 4: 设置 API 密钥（生产环境）

**方式 1: 使用 Secrets（推荐）**
```bash
# 设置生产环境的 API 密钥
npx wrangler secret put API_KEY
# 输入密钥，例如：prod-secret-key-2024-abc123
```

**方式 2: 使用环境变量（仅本地）**

`wrangler.toml` 中已配置了本地开发用的 API_KEY：
```toml
[vars]
API_KEY = "dev-secret-key-2024"
```

### Step 5: 部署 Worker

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

### Step 6: 测试生产 Worker

```bash
# 替换为你的实际 URL
WORKER_URL="https://two-sum.YOUR-SUBDOMAIN.workers.dev"

# 测试 API
curl $WORKER_URL
curl $WORKER_URL/api/latest
curl "$WORKER_URL/api/stats"
```

### Step 7: 配置采集脚本

创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# Worker API 地址（替换为实际 URL）
WORKER_API=https://two-sum.YOUR-SUBDOMAIN.workers.dev/api/push

# API 密钥（与 Worker Secrets 中设置的一致）
API_KEY=secret-020214xafs921w
```

### Step 8: 测试生产环境采集

```bash
npm run collect
```

应该能看到数据成功推送到生产环境。

**验证：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "SELECT * FROM records ORDER BY timestamp DESC LIMIT 5"
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

## 自动采集设置

数据采集需要每分钟运行一次 `collector.js`。以下是多种自动化方案：

### 方案 1: GitHub Actions（推荐，免费且可靠）

创建 `.github/workflows/collect.yml`：

```yaml
name: LeetCode Data Collector

on:
  schedule:
    # 每分钟运行一次
    - cron: '* * * * *'
  workflow_dispatch:  # 支持手动触发

jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 2

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run collector
        run: node collector.js
        env:
          WORKER_API: ${{ secrets.WORKER_API }}
          API_KEY: ${{ secrets.API_KEY }}
```

**设置 GitHub Secrets：**

1. 访问你的 GitHub 仓库
2. Settings → Secrets and variables → Actions
3. 添加以下 secrets：
   - `WORKER_API`: `https://two-sum.YOUR-SUBDOMAIN.workers.dev/api/push`
   - `API_KEY`: `prod-secret-key-2024-abc123`

**优点：**
- ✅ 完全免费
- ✅ 自动运行，无需服务器
- ✅ 有日志记录
- ✅ 可查看运行历史

**缺点：**
- ⚠️ 最小间隔是 5 分钟（GitHub Actions 限制）

**注意**：GitHub Actions 的 cron 最短间隔是 5 分钟，不是 1 分钟。如果需要每分钟采集，使用下面的其他方案。

### 方案 2: cron（Linux/macOS 服务器）

适合有自己的服务器或 VPS。

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每分钟运行）
* * * * * cd /path/to/two-sum && /usr/local/bin/node collector.js >> /var/log/leetcode-collector.log 2>&1
```

**查看日志：**
```bash
tail -f /var/log/leetcode-collector.log
```

**优点：**
- ✅ 精确到每分钟
- ✅ 简单可靠
- ✅ 完全控制

**缺点：**
- ❌ 需要一台持续运行的服务器

### 方案 3: PM2（推荐用于服务器）

PM2 是一个强大的 Node.js 进程管理器。

```bash
# 安装 PM2
npm install -g pm2

# 启动采集器（每分钟运行）
pm2 start collector.js --cron "* * * * *" --no-autorestart --name leetcode-collector

# 查看日志
pm2 logs leetcode-collector

# 查看状态
pm2 status

# 设置开机自启
pm2 startup
pm2 save

# 停止采集
pm2 stop leetcode-collector

# 删除任务
pm2 delete leetcode-collector
```

**优点：**
- ✅ 精确到每分钟
- ✅ 自动重启
- ✅ 日志管理
- ✅ 监控面板

**缺点：**
- ❌ 需要服务器

### 方案 4: Cloudflare Workers Cron（已废弃）

**注意**：原计划使用 Worker Cron，但由于 Workers 不支持作为 WebSocket 客户端，已改用外部采集脚本。

`wrangler.toml` 中的 cron 配置已保留但不再使用：

```toml
[triggers]
crons = ["* * * * *"]  # 已废弃，不执行采集
```

### 方案 5: watch 命令（临时测试）

适合短期测试，不推荐生产使用。

```bash
# 安装 watch (macOS)
brew install watch

# 每 60 秒运行一次
watch -n 60 'cd /path/to/two-sum && node collector.js'
```

**优点：**
- ✅ 简单快速
- ✅ 适合测试

**缺点：**
- ❌ 终端必须保持打开
- ❌ 不适合生产环境

### 推荐方案总结

| 场景 | 推荐方案 | 间隔精度 |
|------|----------|----------|
| **无服务器** | GitHub Actions | 5 分钟 |
| **有服务器** | PM2 | 1 分钟 |
| **简单 VPS** | cron | 1 分钟 |
| **本地测试** | watch | 自定义 |

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
- API 请求日志
- 数据采集推送日志
- 错误信息（如果有）

### 数据清理

**删除 7 天前的数据：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "
DELETE FROM records
WHERE timestamp < (strftime('%s', 'now', '-7 days') * 1000)
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

### 设置告警（可选）

使用 Cloudflare Notifications 或第三方服务（如 Better Stack）设置告警：

- Worker 错误率 > 5%
- D1 查询失败
- API 响应时间 > 1s

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

**原因：** LeetCode 国际站有反爬虫机制。

**解决方案：**

**方案 A: 专注 CN 区（推荐）**

目前 CN 区采集稳定，可以先专注于 CN 区数据。前端会自动处理 US 区为 null 的情况。

**方案 B: 使用代理**

修改 `collector.js`，通过代理访问：

```javascript
// 需要安装：npm install https-proxy-agent
const { HttpsProxyAgent } = require('https-proxy-agent');

const ws = new WebSocket(url, {
  headers: headers,
  agent: new HttpsProxyAgent('http://your-proxy:port')
});
```

**方案 C: 降低频率**

仅采集 CN 区，或者 US 区改为每 5 分钟采集一次。

**方案 D: 添加更多请求头**

在 `collector.js` 中尝试添加 Cookie、Referer 等（需要手动从浏览器复制）。

### 问题 3: 前端无法加载数据

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

   如果为 0，说明还没有采集数据。

### 问题 4: 采集脚本推送失败 401

**错误信息：**
```
❌ 推送失败: HTTP 401: Unauthorized
```

**原因：** API Key 不匹配。

**解决方案：**

1. **检查 Worker Secrets：**
   ```bash
   # 重新设置密钥
   npx wrangler secret put API_KEY
   ```

2. **检查 .env 文件：**
   ```env
   API_KEY=prod-secret-key-2024-abc123  # 必须与 Worker Secret 一致
   ```

3. **重新部署 Worker：**
   ```bash
   npm run deploy
   ```

### 问题 5: GitHub Actions 无法运行

**原因：** GitHub Actions 的 cron 最短间隔是 **5 分钟**，不是 1 分钟。

**解决方案：**

修改 `.github/workflows/collect.yml` 中的 cron 表达式：

```yaml
schedule:
  # 每 5 分钟运行一次
  - cron: '*/5 * * * *'
```

或者使用其他方案（cron/PM2）实现每分钟采集。

### 问题 6: 前端粒度切换无响应

**检查：**

1. **浏览器控制台是否有错误**

   打开开发者工具 → Console，查看错误信息。

2. **API 端点是否正常**

   ```bash
   curl "https://two-sum.YOUR-SUBDOMAIN.workers.dev/api/aggregated?granularity=minute&limit=10"
   ```

3. **数据是否足够**

   某些粒度需要足够的数据才能显示（如按天、按月）。

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
- `granularity` (必需)：时间粒度
  - `minute` - 按分钟
  - `halfhour` - 按半小时
  - `hour` - 按小时
  - `day` - 按天
  - `month` - 按月
- `limit` (可选)：返回的数据点数量

**请求示例：**
```bash
# 按分钟（最近 180 分钟）
curl "http://localhost:8787/api/aggregated?granularity=minute&limit=180"

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
    "time": "2026-02-10 15:30",
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

### POST /api/push

接收采集器推送的数据（需要 API Key 验证）。

**请求头：**
- `Content-Type`: `application/json`
- `X-API-Key`: API 密钥

**请求体：**
```json
{
  "records": [
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
}
```

**响应示例：**
```json
{
  "success": true,
  "saved": 2,
  "message": "Successfully saved 2 records"
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
- 按分钟：180 点（3 小时）
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

建议保留最近 30-90 天的数据，定期清理旧数据：

```bash
# 每周运行一次（保留 90 天）
npx wrangler d1 execute two-sum-db --remote --command "
DELETE FROM records
WHERE timestamp < (strftime('%s', 'now', '-90 days') * 1000)
"
```

---

## 常见问题 FAQ

### Q1: 为什么 Worker 不能直接采集数据？

A: Cloudflare Workers **不支持作为 WebSocket 客户端**连接外部服务器。因此需要使用独立的 Node.js 脚本（`collector.js`）进行采集，然后通过 HTTP API 推送到 Worker。

### Q2: 免费额度够用吗？

A: 完全够用！Cloudflare 免费额度：

- **Workers**: 100,000 请求/天
- **D1**: 100,000 行读取/天，1 GB 存储
- **Pages**: 无限请求

按每分钟采集 2 次（US + CN），每天约 2,880 次写入，远低于限制。

### Q3: 如何添加更多题目监控？

A: 修改 `collector.js`：

```javascript
const CONFIG = {
  WS_URLS: {
    US_TWO_SUM: 'wss://collaboration-ws.leetcode.com/problems/two-sum',
    US_THREE_SUM: 'wss://collaboration-ws.leetcode.com/problems/3sum',
    CN_TWO_SUM: 'wss://collaboration-ws.leetcode.cn/problems/two-sum',
    // 添加更多...
  }
};
```

然后修改数据库表结构，添加 `problem` 字段。

### Q4: 数据会丢失吗？

A: Cloudflare D1 是持久化存储，数据不会丢失。建议定期备份（导出 JSON）。

### Q5: 如何更换 API 密钥？

A:

```bash
# 1. 更新 Worker Secret
npx wrangler secret put API_KEY
# 输入新密钥

# 2. 更新 .env 文件
echo "API_KEY=new-secret-key" > .env

# 3. 重新部署 Worker
npm run deploy

# 4. 重启采集脚本
```

---

## 下一步

### ✅ 已完成
- [x] Worker API 部署
- [x] D1 数据库创建
- [x] 数据采集脚本
- [x] 前端可视化（5 种粒度）
- [x] CN 区数据采集成功
- [x] 解决 US 区 403 问题

### 🔄 待优化
- [ ] 设置自动采集（GitHub Actions/cron）
- [ ] 绑定自定义域名
- [ ] 添加数据导出功能
- [ ] 添加更多题目监控

---

## 联系与支持

- **GitHub Issues**: 报告 bug 或提出建议
- **文档**: README.md 查看项目概览
- **Cloudflare Docs**: https://developers.cloudflare.com

---

**部署愉快！** 🚀

如有问题，请参考本文档的故障排查章节，或查看 Worker 日志。
