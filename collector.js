/**
 * 数据采集脚本（Node.js）
 * 用于采集 LeetCode Two-Sum 的在线人数，并推送到 Cloudflare Worker
 *
 * 运行方式：
 * 1. 本地运行：node collector.js
 * 2. 服务器 cron：crontab -e，添加：* * * * * node /path/to/collector.js
 * 3. GitHub Actions：每分钟自动运行
 */

const WebSocket = require('ws');
const { chromium } = require("playwright");

// 配置
const CONFIG = {
  // Cloudflare Worker API 地址（本地开发默认 localhost:8787）
  WORKER_API: process.env.WORKER_API || 'http://localhost:8787/api/push',

  // API 密钥（用于验证）
  API_KEY: process.env.API_KEY || 'dev-secret-key-2024',

  // WebSocket 地址
  WS_URLS: {
    US: 'wss://collaboration-ws.leetcode.com/problems/two-sum',
    CN: 'wss://collaboration-ws.leetcode.cn/problems/two-sum'
  },

  // 请求头配置（绕过反爬虫）
  WS_HEADERS: {
    US: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Origin': 'https://leetcode.com',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    CN: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Origin': 'https://leetcode.cn',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  },

  // 超时时间（毫秒）
  TIMEOUT: 10000
};

/**
 * 从 WebSocket 获取在线人数
 */
async function getOnlineCount(region) {
  console.log(`\n[${region}] --- 开始任务 ---`);

  const browser = await chromium.launch({
    headless: true, // 改为 true 挑战无头模式，若失败请改回 false
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-web-security",
    ],
    executablePath: CONFIG.executablePath || undefined,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    // 1. 注入 Stealth 脚本：抹除机器人痕迹
    await context.addInitScript(() => {
      // 抹除 webdriver
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // 伪造 WebGL 渲染信息
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return "Intel Inc.";
        if (parameter === 37446) return "Intel(R) Iris(R) Xe Graphics";
        return getParameter.apply(this, arguments);
      };
      // 伪造 Chrome 运行环境
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // 2. 转发浏览器内部日志到 Node.js 终端
    page.on("console", (msg) => {
      if (msg.text().includes("[WS]")) {
        console.log(`  └─ [浏览器内部] ${msg.text()}`);
      }
    });

    // 3. 环境预热：US 站必须先访问页面
    console.log(`[${region}] 正在通过 https 访问主页以建立上下文...`);
    const response = await page.goto(
      region === "US"
        ? "https://leetcode.com/problems/two-sum"
        : "https://leetcode.cn/problems/two-sum",
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );

    console.log(
      `[${region}] 页面加载完成，状态码: ${response.status()}，标题: "${await page.title()}"`,
    );

    // 4. 建立 WebSocket 连接
    console.log(`[${region}] 正在浏览器内建立 WebSocket...`);
    const result = await page.evaluate((wsUrl) => {
      return new Promise((resolve) => {
        console.log(`[WS] 尝试连接: ${wsUrl}`);
        const socket = new WebSocket(wsUrl);

        const timer = setTimeout(() => {
          console.log("[WS] 握手超时");
          socket.close();
          resolve({ error: "TIMEOUT" });
        }, 15000);

        socket.onopen = () => {
          console.log("[WS] 已开启 (OPEN)");
          // 部分环境可能需要发个包激活，这里尝试发个空包
          setTimeout(() => {
            if (socket.readyState === 1) socket.send("");
          }, 2000);
        };

        socket.onmessage = (e) => {
          console.log(`[WS] 收到消息包: ${e.data}`);
          const count = parseInt(e.data, 10);
          if (!isNaN(count)) {
            clearTimeout(timer);
            socket.close();
            resolve({ count: count });
          }
        };

        socket.onerror = () => {
          console.log("[WS] 报错");
          resolve({ error: "ERROR" });
        };
      });
    }, CONFIG.WS_URLS[region]);

    if (result.count !== undefined) {
      console.log(`[${region}] ✅ 采集成功: ${result.count}`);
      return result.count;
    } else {
      console.error(`[${region}] ❌ 采集失败: ${result.error || "未知原因"}`);
      return null;
    }
  } catch (err) {
    console.error(`[${region}] 捕获到程序异常: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * 推送数据到 Cloudflare Worker
 */
async function pushToWorker(data) {
  try {
    const response = await fetch(CONFIG.WORKER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CONFIG.API_KEY
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    console.log('✅ 数据推送成功:', result);
    return true;
  } catch (error) {
    console.error('❌ 推送失败:', error.message);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('\n========== LeetCode 数据采集 ==========');
  console.log('时间:', new Date().toISOString());

  // 并行采集
  const [usCount, cnCount] = await Promise.all([
    getOnlineCount('US'),
    getOnlineCount('CN')
  ]);

  const timestamp = Date.now();
  const records = [];

  if (usCount !== null) {
    records.push({ region: 'US', count: usCount, timestamp });
  }

  if (cnCount !== null) {
    records.push({ region: 'CN', count: cnCount, timestamp });
  }

  if (records.length === 0) {
    console.error('❌ 没有采集到任何数据');
    process.exit(1);
  }

  console.log('\n准备推送数据:', records);

  // 推送到 Worker
  const success = await pushToWorker({ records });

  if (success) {
    console.log('\n✅ 采集完成！');
    process.exit(0);
  } else {
    console.error('\n❌ 采集失败');
    process.exit(1);
  }
}

// 运行
main().catch((error) => {
  console.error('❌ 意外错误:', error);
  process.exit(1);
});
