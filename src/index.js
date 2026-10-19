import getOnlineCount from './collector.js';
import { REGIONS, PROFILES, bucketStart, shiftBucket, saveSamples } from './storage.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const ROUTES = new Set(['/api/data', '/api/aggregated', '/api/latest', '/api/stats']);
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
});

function integerParam(params, key, fallback, maximum) {
  if (!params.has(key)) return fallback;
  const value = params.get(key);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw new RangeError(`${key} must be an integer between 1 and ${maximum}`);
  }
  return Number(value);
}

function parameters(url) {
  if (url.pathname === '/api/aggregated') {
    const granularity = url.searchParams.get('granularity') ?? 'hour';
    const profile = Object.hasOwn(PROFILES, granularity) && PROFILES[granularity];
    if (!profile) throw new RangeError('granularity must be hour, day or month');
    return { granularity, limit: integerParam(url.searchParams, 'limit', profile.limit, profile.maximum) };
  }
  if (url.pathname === '/api/data') return { hours: integerParam(url.searchParams, 'hours', 24, 168) };
  return {};
}

function logUsage(route, results) {
  console.log(JSON.stringify({ route, rows_read: results.reduce((n, r) => n + (r.meta?.rows_read || 0), 0),
    rows_written: results.reduce((n, r) => n + (r.meta?.rows_written || 0), 0) }));
}

async function readData(db, route, params) {
  const now = Date.now();
  if (route === '/api/aggregated') {
    const { granularity, limit } = params;
    const end = bucketStart(now, granularity);
    const start = shiftBucket(end, granularity, 1 - limit);
    const results = await db.batch(REGIONS.map(region => db.prepare(`
      SELECT region, bucket AS timestamp, min_count, max_count,
        1.0 * sum_count / sample_count AS avg_count, sample_count
      FROM aggregates WHERE granularity = ? AND region = ? AND bucket >= ? AND bucket <= ?
      ORDER BY bucket DESC LIMIT ?`).bind(granularity, region, start, end, limit)));
    logUsage(route, results);
    return results.flatMap(r => r.results).sort((a, b) => a.timestamp - b.timestamp || a.region.localeCompare(b.region))
      .map(row => ({ ...row, time: new Date(row.timestamp).toISOString().slice(0,
        granularity === 'hour' ? 16 : granularity === 'day' ? 10 : 7).replace('T', ' ') }));
  }
  if (route === '/api/latest') {
    const results = await db.batch(REGIONS.map(region => db.prepare(`
      SELECT region, count, timestamp FROM records WHERE region = ? ORDER BY timestamp DESC LIMIT 1`).bind(region)));
    logUsage(route, results);
    return { US: results[0].results[0] || null, CN: results[1].results[0] || null, updated_at: new Date(now).toISOString() };
  }
  if (route === '/api/data') {
    const result = await db.prepare(`SELECT region, count, timestamp FROM records
      WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT 10000`)
      .bind(now - params.hours * 3600000, now).all();
    logUsage(route, [result]);
    return result.results;
  }
  const result = await db.prepare(`SELECT region, SUM(sample_count) AS count,
    MIN(min_count) AS min, MAX(max_count) AS max, 1.0 * SUM(sum_count) / SUM(sample_count) AS avg
    FROM aggregates WHERE granularity = 'month' GROUP BY region`).all();
  logUsage(route, [result]);
  return { total_records: result.results.reduce((n, r) => n + r.count, 0), by_region: result.results };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!ROUTES.has(url.pathname)) {
      return url.pathname === '/' && request.method === 'GET'
        ? json({ name: 'LeetCode Two-Sum Monitor API', version: '2.0.0', granularities: ['hour', 'day', 'month'] })
        : json({ error: 'Not found' }, 404);
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
    try {
      const params = parameters(url);
      const cacheURL = new URL(url.pathname, url.origin);
      cacheURL.search = new URLSearchParams({ v: 'rollup-max-1', ...params }).toString();
      const cacheKey = new Request(cacheURL.toString());
      const cache = globalThis.caches?.default;
      try {
        const hit = await cache?.match(cacheKey);
        if (hit) {
          const headers = new Headers(hit.headers);
          headers.set('X-Cache', 'HIT');
          return new Response(hit.body, { status: hit.status, headers });
        }
      } catch (error) { console.warn('Cache read failed:', error.message); }
      const response = json(await readData(env.DB, url.pathname, params), 200,
        { 'Cache-Control': 'public, max-age=120', 'X-Cache': 'MISS' });
      try { await cache?.put(cacheKey, response.clone()); }
      catch (error) { console.warn('Cache write failed:', error.message); }
      return response;
    } catch (error) {
      if (error instanceof RangeError) return json({ error: error.message }, 400);
      console.error('API failed:', error.message);
      return json({ error: '数据暂时不可用，请稍后重试' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const timestamp = Number.isFinite(event.scheduledTime) ? event.scheduledTime : Date.now();
    ctx.waitUntil(collect(env, timestamp));
  },
};

async function collect(env, timestamp) {
  async function collectRegion(region) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let timer;
      try {
        const count = await Promise.race([getOnlineCount(region, env), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Collection timed out')), 30000);
        })]);
        if (Number.isSafeInteger(count) && count >= 0) return { region, count, timestamp };
      } catch (error) { console.warn(`[${region}] collection failed:`, error.message); }
      finally { clearTimeout(timer); }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.warn(`[${region}] no valid sample`);
    return null;
  }
  const samples = (await Promise.all(REGIONS.map(collectRegion))).filter(Boolean);
  const results = await saveSamples(env.DB, samples, timestamp);
  logUsage('cron', results);
}
