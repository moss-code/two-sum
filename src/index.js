/**
 * LeetCode Two-Sum 在线人数监控 Worker
 * 功能：
 * 1. 定时采集 US 和 CN 区的在线人数（Cron）
 * 2. 提供 API 给前端查询历史数据（Fetch）
 */
import getOnlineCount from "./collector";

export default {
  /**
   * HTTP 请求处理器
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 头设置
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    // 处理 OPTIONS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API 路由
      if (url.pathname === "/api/data") {
        return await handleDataAPI(env, url, corsHeaders);
      }

      // 新增：按粒度聚合数据 API
      if (url.pathname === "/api/aggregated") {
        return await handleAggregatedAPI(env, url, corsHeaders);
      }

      if (url.pathname === "/api/latest") {
        return await handleLatestAPI(env, corsHeaders);
      }

      if (url.pathname === "/api/stats") {
        return await handleStatsAPI(env, corsHeaders);
      }

      // 接收采集器推送的数据
      if (url.pathname === "/api/push" && request.method === "POST") {
        return await handlePushAPI(request, env, corsHeaders);
      }

      // 默认响应
      return jsonResponse({
        name: "LeetCode Two-Sum Monitor API",
        version: "1.0.0",
        endpoints: {
          "/api/data": "获取历史数据（支持 ?hours=24 参数）",
          "/api/latest": "获取最新数据",
          "/api/stats": "获取统计信息",
          "/api/aggregated": "获取按粒度聚合的数据（支持 ?granularity=fivemin|halfhour|hour|day|month 参数）",
        }
      }, corsHeaders);

    } catch (error) {
      console.error("Error handling request:", error);
      return jsonResponse({
        error: "Internal Server Error",
        message: error.message
      }, corsHeaders, 500);
    }
  },

  /**
   * 定时任务处理器
   * 注意：由于 Workers 不支持 WebSocket 客户端，定时任务已移至外部采集脚本
   */
  async scheduled(event, env, ctx) {
    console.log("Cron triggered at:", new Date(event.scheduledTime).toISOString());
    console.log("Note: Data collection is now handled by external collector script");
    // 可以在这里添加其他定时任务，如数据清理等
    ctx.waitUntil(collectDataCron(env));
  }
};


/**
 * 获取历史数据 API
 */
async function handleDataAPI(env, url, corsHeaders) {
  const hours = parseInt(url.searchParams.get('hours')) || 24;
  const limit = Math.min(hours * 60 * 2, 10000); // 限制最多 10000 条

  const { results } = await env.DB.prepare(
    `SELECT region, count, timestamp
     FROM records
     ORDER BY timestamp DESC
     LIMIT ?`
  ).bind(limit).all();

  return jsonResponse(results.reverse(), corsHeaders);
}

/**
 * 按粒度聚合数据 API
 * 支持按 5 分钟、半小时、小时、天、月聚合
 */
async function handleAggregatedAPI(env, url, corsHeaders) {
  const granularity = url.searchParams.get('granularity') || 'hour'; // fivemin, halfhour, hour, day, month
  const limit = parseInt(url.searchParams.get("limit")) || 336; // 默认限制

  if (limit <= 0 || limit > 336 * 2) {
    return jsonResponse({ error: 'Invalid limit. Use a value between 1 and 336' }, corsHeaders, 400);
  }

  let timeFormat, groupBy;

  switch (granularity) {
    case 'fivemin':
      // 按 5 分钟聚合：格式为 "YYYY-MM-DD HH:MM"（UTC）
      // 将分钟数归类到 00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55
      timeFormat = `strftime('%Y-%m-%d %H:', datetime(timestamp/1000, 'unixepoch')) ||
                    CASE
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 5 THEN '00'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 10 THEN '05'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 15 THEN '10'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 20 THEN '15'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 25 THEN '20'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 30 THEN '25'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 35 THEN '30'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 40 THEN '35'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 45 THEN '40'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 50 THEN '45'
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 55 THEN '50'
                      ELSE '55'
                    END`;
      groupBy = timeFormat;
      break;
    case 'halfhour':
      // 按半小时聚合：格式为 "YYYY-MM-DD HH:00" 或 "YYYY-MM-DD HH:30"（UTC）
      timeFormat = `strftime('%Y-%m-%d %H:', datetime(timestamp/1000, 'unixepoch')) ||
                    CASE
                      WHEN CAST(strftime('%M', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) < 30 THEN '00'
                      ELSE '30'
                    END`;
      groupBy = timeFormat;
      break;
    case 'hour':
      // 按小时聚合：格式为 "YYYY-MM-DD HH:00"（UTC）
      timeFormat = "strftime('%Y-%m-%d %H:00', datetime(timestamp/1000, 'unixepoch'))";
      groupBy = timeFormat;
      break;
    case 'day':
      // 按天聚合：格式为 "YYYY-MM-DD"（UTC）
      timeFormat = "strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch'))";
      groupBy = timeFormat;
      break;
    case 'month':
      // 按月聚合：格式为 "YYYY-MM"（UTC）
      timeFormat = "strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch'))";
      groupBy = timeFormat;
      break;
    default:
      return jsonResponse({ error: 'Invalid granularity. Use: fivemin, halfhour, hour, day, or month' }, corsHeaders, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT
       region,
       ${timeFormat} as time,
       AVG(count) as avg_count,
       MIN(count) as min_count,
       MAX(count) as max_count,
       COUNT(*) as sample_count
     FROM records
     GROUP BY region, ${groupBy}
     ORDER BY timestamp DESC
     LIMIT ?`
  ).bind(limit).all();

  return jsonResponse(results.reverse(), corsHeaders);
}

/**
 * 获取最新数据 API
 */
async function handleLatestAPI(env, corsHeaders) {
  const { results } = await env.DB.prepare(
    `SELECT region, count, timestamp
     FROM records
     WHERE region IN ('US', 'CN')
     ORDER BY timestamp DESC
     LIMIT 2`
  ).all();

  const latest = {
    US: results.find(r => r.region === 'US') || null,
    CN: results.find(r => r.region === 'CN') || null,
    updated_at: new Date().toISOString()
  };

  return jsonResponse(latest, corsHeaders);
}

/**
 * 获取统计信息 API
 */
async function handleStatsAPI(env, corsHeaders) {
  const { results: counts } = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM records`
  ).all();

  const { results: regions } = await env.DB.prepare(
    `SELECT region, COUNT(*) as count,
            MIN(count) as min,
            MAX(count) as max,
            AVG(count) as avg
     FROM records
     GROUP BY region`
  ).all();

  return jsonResponse({
    total_records: counts[0]?.total || 0,
    by_region: regions
  }, corsHeaders);
}


/**
 * 推送数据到数据库（带超时和重试）
 * @param {object} env - 环境变量
 * @param {Array} records - 数据记录
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<{success: boolean, saved: number, failed: number}>}
 */
async function pushToDB(env, records, timeoutMs = 5000, maxRetries = 3) {
  const RETRY_DELAY_MS = 1000;
  let saved = 0;
  let failed = 0;

  for (const record of records) {
    const { region, count, timestamp } = record;

    let inserted = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

      try {
        // 添加超时控制
        await Promise.race([
          env.DB.prepare(
            "INSERT INTO records (region, count, timestamp) VALUES (?, ?, ?)"
          )
            .bind(region, count, timestamp)
            .run(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), timeoutMs)
          ),
        ]);

        console.log(
          `[pushToDB] ✅ 保存成功: ${region} = ${count} at ${new Date(timestamp).toISOString()}`
        );
        saved++;
        inserted = true;
        break; // 成功，跳出重试循环

      } catch (error) {
        console.error(`[pushToDB] ❌ 错误: ${error.message}`);

        if (attempt < maxRetries) {
          console.log(`[pushToDB] 等待 ${RETRY_DELAY_MS}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    if (!inserted) {
      console.error(`[pushToDB] ❌ [${region}] 所有 ${maxRetries} 次尝试均失败`);
      failed++;
    }
  }

  console.log(`[pushToDB] 完成: 成功 ${saved} 条, 失败 ${failed} 条`);
  return { success: failed === 0, saved, failed };
}

/**
 * 定时任务：并发获取 US 和 CN 两个地区的在线人数（带重试和超时）
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {number} maxRetries - 每个地区最大重试次数
 * @returns {Promise<{US: number|null, CN: number|null}>}
 */
async function collectDataCron(env, timeoutMs = 30000, maxRetries = 3) {
  const RETRY_DELAY_MS = 1000;

  async function fetchWithRetry(region, env) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        console.log(`\n[${region}] --- 触发重试 ---`);
      }

      try {
        const count = await Promise.race([
          getOnlineCount(region, env),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), timeoutMs),
          ),
        ]);

        if (count !== null) {
          return count;
        }

        console.warn(`[${region}] ⚠️ 返回空数据`);
      } catch (error) {
        console.error(`[${region}] ❌ 错误: ${error.message}`);
      }

      if (attempt < maxRetries) {
        console.log(`[${region}] 等待 ${RETRY_DELAY_MS}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    console.error(`[${region}] ❌ 所有 ${maxRetries} 次尝试均失败`);
    return null;
  }

  const [usCount, cnCount] = await Promise.all([
    fetchWithRetry("US", env),
    fetchWithRetry("CN", env),
  ]);

  let records = [];
  if (usCount !== null) {
    records.push({ region: "US", count: usCount, timestamp: Date.now() });
  } else {
    console.error("[US] ❌ 未能采集到数据");
  }
  if (cnCount !== null) {
    records.push({ region: "CN", count: cnCount, timestamp: Date.now() });
  } else {
    console.error("[CN] ❌ 未能采集到数据");
  }

  await pushToDB(env, records);
  
}

/**
 * 辅助函数：返回 JSON 响应
 */
function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
