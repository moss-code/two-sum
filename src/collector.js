const URLS = {
  US: 'wss://collaboration-ws.leetcode.com/problems/two-sum',
  CN: 'wss://collaboration-ws.leetcode.cn/problems/two-sum',
};
const HEADERS = {
  US: { Origin: 'https://leetcode.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Cache-Control': 'no-cache', Pragma: 'no-cache', Host: 'collaboration-ws.leetcode.com' },
  CN: { Origin: 'https://leetcode.cn', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9', 'Cache-Control': 'no-cache', Pragma: 'no-cache', Host: 'collaboration-ws.leetcode.cn' },
};

function parseCount(message) {
  if (typeof message !== 'string' && typeof message !== 'number') return null;
  const text = String(message).trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function directCount(region) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let socket;
  try {
    // Workers outbound WebSockets use fetch Upgrade, then accept the returned socket.
    const response = await fetch(URLS[region].replace('wss:', 'https:'), {
      headers: { ...HEADERS[region], Upgrade: 'websocket' }, signal: controller.signal,
    });
    socket = response.webSocket;
    if (response.status !== 101 || !socket) return null;
    return await new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onClose);
        socket.removeEventListener('close', onClose);
        controller.signal.removeEventListener('abort', onClose);
        resolve(value);
      };
      const onMessage = event => finish(parseCount(event.data));
      const onClose = () => finish(null);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onClose);
      socket.addEventListener('close', onClose);
      controller.signal.addEventListener('abort', onClose, { once: true });
      socket.accept();
      if (controller.signal.aborted) finish(null);
    });
  } finally {
    clearTimeout(timer);
    try { socket?.close(1000, 'Sample collected'); } catch { /* Already closed. */ }
  }
}

async function proxyCount(region, env) {
  const proxyURL = env.PROXY_URL;
  const proxyKey = env.PROXY_API_KEY;
  if (!proxyURL || !proxyKey) throw new Error('Missing proxy configuration');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  try {
    const response = await fetch(`${proxyURL.replace(/\/$/, '')}/wsproxy`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-API-Secret': proxyKey },
      body: JSON.stringify({ url: URLS[region], headers: HEADERS[region], max_messages: '1', timeout: '25' }),
    });
    if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
    const result = await response.json();
    return result.success ? parseCount(result.messages?.[0]?.data) : null;
  } finally { clearTimeout(timer); }
}

export default async function getOnlineCount(region, env = {}) {
  if (!URLS[region]) return null;
  try { return region === 'CN' ? await directCount(region) : await proxyCount(region, env); }
  catch (error) {
    console.warn(`[${region}] collection unavailable:`, error.message);
    return null;
  }
}
