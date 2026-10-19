const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function collector(fetch) {
  const context = vm.createContext({ fetch, setTimeout, clearTimeout, AbortController,
    console: { log() {}, warn() {}, error() {} } });
  const module = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../src/collector.js'), 'utf8'), { context });
  await module.link(() => {});
  await module.evaluate();
  return module.namespace.default;
}

test('CN uses the Workers WebSocket upgrade API and closes the accepted socket after a sample', async () => {
  const socket = new EventTarget();
  let accepted = false, closed = false;
  socket.accept = () => { accepted = true; setTimeout(() => {
    const event = new Event('message'); event.data = '0'; socket.dispatchEvent(event);
  }, 1); };
  socket.close = () => { closed = true; };
  const getCount = await collector(async (url, options) => {
    assert.equal(url, 'https://collaboration-ws.leetcode.cn/problems/two-sum');
    assert.equal(options.headers.Upgrade, 'websocket');
    return { status: 101, webSocket: socket };
  });
  assert.equal(await getCount('CN', {}), 0);
  assert.ok(accepted && closed);
});

test('proxy counts reject partial, negative, fractional and unsafe values', async () => {
  let message = '123junk';
  const getCount = await collector(async () => ({ ok: true,
    async json() { return { success: true, messages: [{ data: message }] }; } }));
  for (const invalid of ['123junk', '-1', '1.5', 'Infinity', '9007199254740992', '']) {
    message = invalid;
    assert.equal(await getCount('US', { PROXY_URL: 'https://proxy.test', PROXY_API_KEY: 'test' }), null, invalid);
  }
  message = '123';
  assert.equal(await getCount('US', { PROXY_URL: 'https://proxy.test', PROXY_API_KEY: 'test' }), 123);
});
