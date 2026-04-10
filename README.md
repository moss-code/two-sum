# LeetCode Two-Sum 在线人数监控

实时监控 LeetCode 平台上 Two-Sum 题目的在线刷题人数，支持国际区（US）和中国区（CN）数据对比。

## 📋 项目特性

- ⏱️ **实时采集**：每分钟自动采集一次数据
- 📊 **双 Y 轴图表**：完美展示不同数量级的数据对比
- 🔍 **多时间范围**：支持 5分钟、半小时、小时、天、月多种粒度
- 🎨 **精美可视化**：基于 ECharts 的交互式图表
- 💰 **零成本部署**：完全基于 Cloudflare 免费套餐
- ⚡ **高性能**：全球 CDN 加速，毫秒级响应

## 🏗️ 技术架构

- **后端**：Cloudflare Workers（定时任务 + REST API）
- **数据库**：Cloudflare D1（SQLite）
- **前端**：纯静态页面（ECharts）
- **部署**：Cloudflare Pages
- **数据采集**：
  - CN 区：直接 WebSocket 连接
  - US 区：通过 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 代理服务绕过 TLS 指纹检测

## 📦 项目结构

```
two-sum/
├── src/
│   ├── index.js           # Worker 主逻辑（Cron + API）
│   └── collector.js       # 数据采集模块（WebSocket + 代理）
├── public/
│   └── index.html         # 前端页面
├── schema.sql             # 数据库表结构
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 项目依赖
└── README.md              # 本文件
```

## 🚀 快速开始

### 前置要求

- Node.js 16+
- npm 或 yarn
- Cloudflare 账号（免费）
- ja3 代理服务（用于采集 US 区数据，可自行部署）

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
npm run db:create
```

复制输出的 `database_id`，并更新 `wrangler.toml` 中的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "two-sum-db"
database_id = "粘贴你的_database_id"  # 替换这里
```

### 3. 初始化数据库表

**本地环境：**
```bash
npm run db:init
```

**生产环境（稍后部署时运行）：**
```bash
npm run db:init:remote
```

### 4. 配置 ja3 代理（用于 US 区数据采集）

US 区的 LeetCode WebSocket 有 TLS 指纹检测机制，需要通过 ja3 代理服务访问。

**选项 A：自行部署 ja3 代理**

使用 [ja3-proxy-python](https://github.com/moss-code/ja3-proxy-python/tree/main) 项目部署：

```bash
# 克隆项目
git clone https://github.com/moss-code/ja3-proxy-python.git
cd ja3-proxy-python

# 部署到 Render（免费）
# 或者使用 Docker 部署到自己的服务器
```

**选项 B：使用已有的代理服务**

如果你已经有可用的 ja3 代理服务，记录其地址和 API 密钥。

**配置代理地址：**

编辑 `wrangler.toml`，添加代理配置：

```toml
[vars]
PROXY_URL = "https://your-ja3-proxy.onrender.com"  # 你的 ja3 代理地址
PROXY_API_KEY = "your-proxy-api-key"               # 代理 API 密钥
```

### 5. 本地开发调试

启动 Worker 开发服务器：

```bash
npm run dev
```

访问 `http://localhost:8787` 查看 API 端点：

- `http://localhost:8787/api/data?hours=24` - 获取历史数据
- `http://localhost:8787/api/latest` - 获取最新数据
- `http://localhost:8787/api/stats` - 获取统计信息
- `http://localhost:8787/api/aggregated?granularity=hour` - 获取聚合数据

### 6. 测试前端页面

在另一个终端启动前端服务器：

```bash
npm run pages:dev
```

访问 `http://localhost:3000` 查看可视化页面。

⚠️ **注意**：需要先修改 `public/index.html` 中的 API_URL 配置：

```javascript
const API_URL = 'http://localhost:8787';  // 本地开发时使用
```

### 7. 验证数据采集

Worker 会自动通过 Cron 任务采集数据。在本地开发时，可以手动触发采集：

```bash
# 查看实时日志
npx wrangler tail
```

然后查询数据库验证数据是否写入：

```bash
npx wrangler d1 execute two-sum-db --local --command "SELECT * FROM records ORDER BY timestamp DESC LIMIT 10"
```

## 🌐 线上部署

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 部署 Worker（后端 + 定时任务）

```bash
npm run deploy
```

部署成功后会输出 Worker URL，例如：
```
https://two-sum.your-subdomain.workers.dev
```

**重要**：记下这个 URL！

### 3. 初始化生产数据库

```bash
npm run db:init:remote
```

### 4. 配置生产环境变量

设置 ja3 代理的配置（生产环境）：

```bash
# 设置代理 URL
npx wrangler secret put PROXY_URL
# 输入你的 ja3 代理地址，如：https://your-ja3-proxy.onrender.com

# 设置代理 API 密钥
npx wrangler secret put PROXY_API_KEY
# 输入你的代理 API 密钥
```

### 5. 测试数据采集

Cron 任务会每分钟自动执行。等待 1-2 分钟后查询数据库：

```bash
npx wrangler d1 execute two-sum-db --remote --command "SELECT COUNT(*) as count FROM records"
```

或者查看实时日志：
```bash
npx wrangler tail
```

### 6. 部署前端页面

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

### 7. 绑定自定义域名（可选）

#### Worker 自定义域名

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → two-sum → Settings → Triggers
3. Custom Domains → Add Custom Domain
4. 输入你的域名（如 `api.example.com`）

#### Pages 自定义域名

1. Pages → two-sum-web → Custom domains
2. Set up a custom domain
3. 输入你的域名（如 `leetcode.example.com`）

## 🔧 运维管理

### 查询数据库

**本地环境：**
```bash
npx wrangler d1 execute two-sum-db --local --command "SELECT * FROM records LIMIT 10"
```

**生产环境：**
```bash
npx wrangler d1 execute two-sum-db --remote --command "SELECT * FROM records LIMIT 10"
```

### 查看统计信息

```bash
npx wrangler d1 execute two-sum-db --remote --command "
SELECT
  region,
  COUNT(*) as total,
  MIN(count) as min,
  MAX(count) as max,
  AVG(count) as avg
FROM records
GROUP BY region
"
```

### 清理历史数据

保留最近 90 天的数据：
```bash
npx wrangler d1 execute two-sum-db --remote --command "
DELETE FROM records
WHERE timestamp < (strftime('%s', 'now', '-90 days') * 1000)
"
```

### 查看 Worker 日志

```bash
npx wrangler tail
```

实时查看定时任务和 API 请求的日志输出。

### 暂停/恢复定时任务

修改 `wrangler.toml`：

```toml
# 暂停：注释掉 crons 配置
# [triggers]
# crons = ["* * * * *"]

# 恢复：取消注释
[triggers]
crons = ["* * * * *"]
```

然后重新部署：
```bash
npm run deploy
```

## 🐛 常见问题

### 1. US 区 WebSocket 403 错误

**错误信息：**
```
[US] ❌ 错误: Unexpected server response: 403
```

**原因：** LeetCode 国际站有 TLS 指纹检测机制。

**解决方案：**

确保 ja3 代理服务正常运行，且 `PROXY_URL` 和 `PROXY_API_KEY` 配置正确：

```bash
# 检查 secrets 是否设置正确
npx wrangler secret list

# 重新设置
npx wrangler secret put PROXY_URL
npx wrangler secret put PROXY_API_KEY
```

### 2. CN 区连接失败

CN 区通常连接稳定，如果失败可能是网络问题。Worker 会自动重试 3 次。

### 3. 数据库写入失败

检查 `wrangler.toml` 中的 `database_id` 是否正确：

```bash
npx wrangler d1 list
```

### 4. 前端无法获取数据

检查 CORS 配置和 API URL：

1. 确保 `public/index.html` 中的 `API_URL` 指向正确的 Worker 地址
2. 在浏览器控制台查看网络请求错误

### 5. 定时任务没有执行

```bash
# 查看实时日志
npx wrangler tail

# 检查 Cron 配置
npx wrangler trigger list
```

## 📊 API 文档

### GET /api/data

获取历史数据。

**查询参数：**
- `hours` (可选)：返回最近 N 小时的数据，默认 24

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

按时间粒度聚合数据。

**查询参数：**
- `granularity` (可选)：时间粒度，可选值：`fivemin`、`halfhour`、`hour`（默认）、`day`、`month`
- `limit` (可选)：返回的数据点数量，默认 168

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

### GET /api/latest

获取最新数据。

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
    "timestamp": 1707580860000
  },
  "updated_at": "2024-02-10T12:34:56.789Z"
}
```

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

## 💡 优化建议

1. **数据聚合**：对于长时间范围（7天+），可以在 API 中按小时聚合数据
2. **缓存策略**：添加 Cloudflare Cache API 缓存历史数据
3. **告警通知**：当人数异常时发送通知（Telegram/Email）
4. **多题目支持**：扩展到监控更多热门题目

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**Made with ❤️ using Cloudflare Workers**
