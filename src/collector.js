/**
 * 数据采集工具
 */


// 配置（Node.js环境 不兼容 Workers 环境）
function getEnv(key, defaultValue) {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
}

const CONFIG = {
  // Cloudflare Worker API 地址（本地开发默认 localhost:8787）
  PROXY_URL: getEnv("PROXY_URL", "http://localhost:8080"), // 可选的 HTTP 代理 URL
  PROXY_API_KEY: getEnv("PROXY_API_KEY", "proxy_secret-key-2024"), // 代理 API 密钥

  // WebSocket 地址
  WS_URLS: {
    US: "wss://collaboration-ws.leetcode.com/problems/two-sum",
    CN: "wss://collaboration-ws.leetcode.cn/problems/two-sum",
  },

  // 请求头配置（绕过反爬虫）
  WS_HEADERS: {
    US: {
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Host: "collaboration-ws.leetcode.com",
      Pragma: "no-cache",
      Origin: "https://leetcom.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
    },
    CN: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      Origin: "https://leetcode.cn",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Host: "collaboration-ws.leetcode.cn",
    },
  },

  // 超时时间（毫秒）
  TIMEOUT: 30000,
};

/**
 * 解析 WebSocket 消息获取在线人数
 */
function parseOnlineCount(message) {
  const count = parseInt(message, 10);
  return !isNaN(count) && count >= 0 ? count : null;
}

/**
 * 从原生 WebSocket 获取在线人数
 */
function getOnlineCountFromNative(region, timeout = 5000) {
  return new Promise((resolve) => {
    const url = CONFIG.WS_URLS[region];
    const headers = CONFIG.WS_HEADERS[region] || {};

    console.log(`[${region}] 连接中...`);

    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      console.log("连接超时");
      resolve(null);
    }, timeout);

    ws.onopen = () => {
      console.log(`[${region}] WebSocket 连接成功`);
      // 连接成功后等待第一条消息
    };

    ws.onmessage = (event) => {
      clearTimeout(timer);
      try {
        // LeetCode WebSocket 通常直接返回数字字符串表示人数
        const count = parseInt(event.data.toString());
        ws.close();
        console.log(`[${region}] 采集成功: ${count}`);
        resolve(count);
      } catch (e) {
        ws.close();
        console.error(`[${region}] 解析数据失败: ${e.message}`);
        resolve(null);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timer);
      console.error(`[${region}] WebSocket 连接失败: ${error}`);
      resolve(null);
    };

    ws.onclose = () => {
      console.log(`[${region}] WebSocket 连接关闭`);
    };
  });
}


/**
 * 获取在线人数（支持传入 Workers env）
 * @param {string} region - 地区代码 (US/CN)
 * @param {object} envConfig - Workers 环境变量（可选）
 * @returns {Promise<number|null>}
 */
function getOnlineCount(region, env) {
  if (region === "CN") {
    return getOnlineCountFromNative(region);
  } else {
    return getOnlineCountFromProxy(region, env);
  }
}

/**
 * 从代理 WebSocket 获取在线人数
 * @param {string} region - 地区代码
 * @param {object} env - Workers 环境变量（可选）
 */
async function getOnlineCountFromProxy(region, env = null) {
  const url = CONFIG.WS_URLS[region];
  const headers = CONFIG.WS_HEADERS[region] || {};

  console.log(`[${region}] 通过代理连接中...`);

  try {
    const result = await sendWSProxyRequest(url, headers, {
      maxMessages: 1,
      timeout: Math.floor(CONFIG.TIMEOUT / 1000),
    }, env);

    if (
      result &&
      result.success &&
      result.messages &&
      result.messages.length > 0
    ) {
      const message = result.messages[0].data;
      const count = parseOnlineCount(message);
      if (count !== null) {
        console.log(`[${region}] 在线人数: ${count}`);
        return count;
      }
    }

    console.warn(`[${region}] 无法从代理响应解析人数`);
    return null;
  } catch (error) {
    console.error(`[${region}] 代理请求失败:`, error.message);
    return null;
  }
}

/**
 * 通过代理发送 HTTP 请求
 * @param {string} targetUrl - 目标 URL
 * @param {object} targetHeaders - 目标请求头
 * @param {object} options - 其他选项
 * @param {object} envConfig - Workers 环境变量（可选）
 * @returns {Promise<object>} - 代理返回的响应
 */
async function sendWSProxyRequest(targetUrl, targetHeaders, options = {}, env = null) {
  const { maxMessages = 1, timeout = 30 } = options;

  // 优先使用传入的 Workers env，否则使用 CONFIG
  const proxyUrl = env?.PROXY_URL || CONFIG.PROXY_URL;
  const proxyKey = env?.PROXY_API_KEY || CONFIG.PROXY_API_KEY;

  console.log("使用代理:", proxyUrl + "/wsproxy", "KEY:", proxyKey?.substring(0, 8) + "...");

  try {
    const response = await fetch(proxyUrl + "/wsproxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Secret": proxyKey,
      },
      body: JSON.stringify({
        url: targetUrl,
        headers: targetHeaders,
        max_messages: String(maxMessages),
        timeout: String(timeout),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Proxy HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const result = await response.json();
    console.log("代理请求成功:" + targetUrl);
    return result;
  } catch (error) {
    console.error("代理请求失败:", error.message);
    throw error;
  }
}

export default getOnlineCount;