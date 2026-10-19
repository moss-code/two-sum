const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ROOT, FIXED_NOW, HOUR, createD1, createHarness } = require('./helpers.cjs');

const CURRENT_HOUR = Date.parse('2026-10-19T12:00:00Z');
const CURRENT_DAY = Date.parse('2026-10-19T00:00:00Z');
const CURRENT_MONTH = Date.parse('2026-10-01T00:00:00Z');

function byRegion(rows, region) { return rows.filter(row => row.region === region); }
function assertNoRawReads(db) {
  assert.equal(db.reads.some(({ sql }) => /\b(?:FROM|JOIN)\s+records\b/i.test(sql)), false,
    'public aggregate/statistics reads must not scan raw records');
}

test('rollup migration preserves all history and merges maxima, sums and sample counts without averaging averages', t => {
  const db = createD1();
  t.after(() => db.sqlite.close());
  // This is the existing production schema, including its region/timestamp index.
  db.sqlite.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  const insert = db.sqlite.prepare('INSERT INTO records (region, count, timestamp) VALUES (?, ?, ?)');
  const samples = [
    ['US', 0, Date.parse('2026-09-30T23:58:00Z')],
    ['US', 10, Date.parse('2026-10-01T00:02:00Z')],
    ['US', 20, Date.parse('2026-10-01T00:04:00Z')],
    ['US', 90, Date.parse('2026-10-01T01:02:00Z')],
    ['US', 40, Date.parse('2026-10-02T00:02:00Z')],
    ['CN', 300, Date.parse('2026-10-01T00:02:00Z')],
  ];
  for (const sample of samples) insert.run(...sample);

  db.sqlite.exec(fs.readFileSync(path.join(ROOT, 'migrations', '0001_rollups.sql'), 'utf8'));

  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM records').get().n, samples.length);
  const rows = db.sqlite.prepare("SELECT * FROM aggregates WHERE region='US' ORDER BY granularity,bucket").all();
  const day = rows.find(row => row.granularity === 'day' && row.bucket === Date.parse('2026-10-01T00:00:00Z'));
  assert.deepEqual([day.min_count, day.max_count, day.sum_count, day.sample_count], [10, 90, 120, 3]);
  const month = rows.find(row => row.granularity === 'month' && row.bucket === CURRENT_MONTH);
  assert.deepEqual([month.min_count, month.max_count, month.sum_count, month.sample_count], [10, 90, 160, 4]);
  assert.equal(month.sum_count / month.sample_count, 40);
  assert.ok(rows.some(row => row.granularity === 'month' && row.bucket === Date.parse('2026-09-01T00:00:00Z')));
});

test('aggregated API reads bounded rollups, returns MAX and gives each region its own limit', async t => {
  const h = await createHarness(t);
  for (const region of ['US', 'CN']) {
    h.aggregate('hour', region, CURRENT_HOUR - HOUR, { min: 0, max: 90, sum: 120, samples: 3 });
    h.aggregate('hour', region, CURRENT_HOUR, { min: 20, max: 80, sum: 100, samples: 2 });
    h.aggregate('hour', region, CURRENT_HOUR - 2 * HOUR);
    h.raw(region, 9999, FIXED_NOW - 400 * 24 * HOUR);
  }

  const response = await h.fetch('/api/aggregated?granularity=hour&limit=2');
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 4);
  for (const region of ['US', 'CN']) {
    const values = byRegion(rows, region);
    assert.deepEqual(values.map(row => row.timestamp), [CURRENT_HOUR - HOUR, CURRENT_HOUR]);
    assert.deepEqual(values.map(row => row.max_count), [90, 80]);
    assert.equal(values[0].avg_count, 40);
    assert.equal(values[0].min_count, 0);
    assert.equal(values[0].sample_count, 3);
    assert.equal(values[0].time, '2026-10-19 11:00');
  }
  assertNoRawReads(h.db);
});

test('a gap in CN data never shifts the requested window or consumes the US point budget', async t => {
  const h = await createHarness(t);
  h.aggregate('hour', 'US', CURRENT_HOUR);
  h.aggregate('hour', 'US', CURRENT_HOUR - HOUR);
  h.aggregate('hour', 'CN', CURRENT_HOUR - HOUR);
  h.aggregate('hour', 'CN', CURRENT_HOUR - 6 * HOUR);
  h.raw('US', 111, CURRENT_HOUR);
  h.raw('CN', 222, CURRENT_HOUR - 6 * HOUR);

  const rows = await (await h.fetch('/api/aggregated?limit=2')).json();
  assert.equal(byRegion(rows, 'US').length, 2);
  assert.deepEqual(byRegion(rows, 'CN').map(row => row.timestamp), [CURRENT_HOUR - HOUR]);
});

for (const [granularity, bucket, previous, time] of [
  ['day', CURRENT_DAY, CURRENT_DAY - 24 * HOUR, '2026-10-19'],
  ['month', CURRENT_MONTH, Date.parse('2026-09-01T00:00:00Z'), '2026-10'],
]) {
  test(`${granularity} API uses UTC bucket timestamps and excludes buckets outside the requested range`, async t => {
    const h = await createHarness(t);
    h.aggregate(granularity, 'US', bucket);
    h.aggregate(granularity, 'CN', bucket);
    h.aggregate(granularity, 'US', previous);
    const rows = await (await h.fetch(`/api/aggregated?granularity=${granularity}&limit=1`)).json();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.timestamp === bucket && row.time === time));
    assertNoRawReads(h.db);
  });
}

test('removed granularities and malformed or excessive limits return 400 before database access', async t => {
  const h = await createHarness(t);
  for (const query of [
    'granularity=fivemin', 'granularity=halfhour', 'granularity=year', 'granularity=constructor',
    'limit=0', 'limit=-1', 'limit=1.5', 'limit=2junk', 'limit=NaN', 'limit=',
    'granularity=hour&limit=337', 'granularity=day&limit=181', 'granularity=month&limit=49',
  ]) {
    const response = await h.fetch(`/api/aggregated?${query}`);
    assert.equal(response.status, 400, query);
  }
  assert.equal(h.db.reads.length, 0);
});

for (const [granularity, defaults, maximum, bucketAt] of [
  ['hour', 168, 336, offset => CURRENT_HOUR - offset * HOUR],
  ['day', 90, 180, offset => CURRENT_DAY - offset * 24 * HOUR],
  ['month', 24, 48, offset => Date.UTC(2026, 9 - offset, 1)],
]) {
  test(`${granularity} defaults to ${defaults} buckets per region and accepts its ${maximum}-bucket maximum`, async t => {
    const h = await createHarness(t);
    for (const region of ['US', 'CN']) {
      h.aggregate(granularity, region, bucketAt(0));
      h.aggregate(granularity, region, bucketAt(defaults - 1));
      h.aggregate(granularity, region, bucketAt(defaults));
      h.aggregate(granularity, region, bucketAt(maximum - 1));
      h.aggregate(granularity, region, bucketAt(maximum));
    }
    const defaultRows = await (await h.fetch(`/api/aggregated?granularity=${granularity}`)).json();
    assert.equal(defaultRows.length, 4);
    assert.ok(defaultRows.every(row => row.timestamp >= bucketAt(defaults - 1)));
    const response = await h.fetch(`/api/aggregated?granularity=${granularity}&limit=${maximum}`);
    assert.equal(response.status, 200);
    const maxRows = await response.json();
    assert.equal(maxRows.length, 8);
    assert.ok(maxRows.every(row => row.timestamp >= bucketAt(maximum - 1)));
  });
}

test('latest API gets each region independently and keeps latest sample rather than historical peak', async t => {
  const h = await createHarness(t);
  h.raw('CN', 800, FIXED_NOW - 10 * HOUR);
  h.raw('US', 100, FIXED_NOW - 5000);
  h.raw('US', 7, FIXED_NOW - 1000);
  h.aggregate('hour', 'US', CURRENT_HOUR, { max: 100 });
  const response = await h.fetch('/api/latest');
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.US.count, 7);
  assert.equal(result.CN.count, 800);
  assert.equal(result.CN.timestamp, FIXED_NOW - 10 * HOUR);
});

test('raw history filters by actual hours and excludes both older and future samples', async t => {
  const h = await createHarness(t);
  h.raw('US', 1, FIXED_NOW - 2 * HOUR - 1);
  h.raw('CN', 2, FIXED_NOW - 2 * HOUR);
  h.raw('US', 3, FIXED_NOW - HOUR);
  h.raw('CN', 4, FIXED_NOW);
  h.raw('US', 5, FIXED_NOW + 1);
  const rows = await (await h.fetch('/api/data?hours=2')).json();
  assert.deepEqual(rows.map(row => row.count), [2, 3, 4]);
});

test('raw history rejects invalid hours instead of silently substituting a default', async t => {
  const h = await createHarness(t);
  for (const hours of ['0', '-1', '169', '1.5', '2junk', 'NaN', '']) {
    assert.equal((await h.fetch(`/api/data?hours=${hours}`)).status, 400, hours);
  }
  assert.equal(h.db.reads.length, 0);
});

test('statistics combines monthly sums and counts with weighted averages without reading raw history', async t => {
  const h = await createHarness(t);
  h.aggregate('month', 'US', Date.parse('2026-09-01T00:00:00Z'), { min: 10, max: 90, sum: 120, samples: 3 });
  h.aggregate('month', 'US', CURRENT_MONTH, { min: 40, max: 40, sum: 40, samples: 1 });
  h.aggregate('month', 'CN', CURRENT_MONTH, { min: 300, max: 600, sum: 900, samples: 2 });
  h.raw('US', 9999, FIXED_NOW);

  const result = await (await h.fetch('/api/stats')).json();
  assert.equal(result.total_records, 6);
  assert.deepEqual(result.by_region.find(row => row.region === 'US'), { region: 'US', count: 4, min: 10, max: 90, avg: 40 });
  assert.deepEqual(result.by_region.find(row => row.region === 'CN'), { region: 'CN', count: 2, min: 300, max: 600, avg: 450 });
  assertNoRawReads(h.db);
});

test('canonical cache keys share query order and tracking variants, while invalid known parameters still fail', async t => {
  const h = await createHarness(t);
  h.aggregate('hour', 'US', CURRENT_HOUR);
  const first = await h.fetch('/api/aggregated?limit=2&granularity=hour&utm_source=one');
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const reads = h.db.reads.length;
  assert.ok(reads > 0);
  const cached = await h.fetch('/api/aggregated?utm_source=two&granularity=hour&limit=2');
  assert.equal(cached.headers.get('X-Cache'), 'HIT');
  assert.deepEqual(await cached.json(), firstBody);
  assert.equal(h.db.reads.length, reads, 'cache hit must not issue another D1 read');
  assert.equal((await h.fetch('/api/aggregated?limit=invalid&granularity=hour')).status, 400);
  assert.equal(h.db.reads.length, reads);
});

test('public GET cache lasts 120 seconds and refreshes after expiry', async t => {
  const h = await createHarness(t);
  h.raw('US', 10, FIXED_NOW - 1000);
  const first = await (await h.fetch('/api/latest')).json();
  const reads = h.db.reads.length;
  h.raw('US', 20, FIXED_NOW);
  h.clock.now += 119000;
  assert.deepEqual(await (await h.fetch('/api/latest?tracking=ignored')).json(), first);
  assert.equal(h.db.reads.length, reads);
  h.clock.now += 2000;
  assert.equal((await (await h.fetch('/api/latest')).json()).US.count, 20);
  assert.ok(h.db.reads.length > reads);
});

test('raw-history and statistics GET responses also reuse the server cache', async t => {
  const h = await createHarness(t);
  h.raw('US', 10, FIXED_NOW);
  h.aggregate('month', 'US', CURRENT_MONTH);
  for (const route of ['/api/data?hours=24', '/api/stats']) {
    const first = await h.fetch(route);
    assert.equal(first.status, 200);
    const reads = h.db.reads.length;
    assert.ok(reads > 0);
    const cached = await h.fetch(`${route}${route.includes('?') ? '&' : '?'}utm_campaign=test`);
    assert.deepEqual(await cached.json(), await first.json());
    assert.equal(h.db.reads.length, reads, route);
  }
});

test('read endpoints reject POST, unknown API paths return 404, and OPTIONS provides CORS', async t => {
  const h = await createHarness(t);
  for (const route of ['/api/data', '/api/aggregated', '/api/latest', '/api/stats']) {
    assert.equal((await h.fetch(route, { method: 'POST' })).status, 405, route);
  }
  assert.equal((await h.fetch('/api/not-a-route')).status, 404);
  const options = await h.fetch('/api/aggregated', { method: 'OPTIONS' });
  assert.ok(options.status >= 200 && options.status < 300);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(h.db.reads.length, 0);
});

test('cron stores zero, uses the scheduled timestamp and remains idempotent across retries', async t => {
  const scheduled = CURRENT_HOUR + 2 * 60000;
  const h = await createHarness(t, { now: scheduled + 5 * 60000, counts: { US: 0, CN: 88 } });
  await h.cron(scheduled);
  h.collector.values.US = 999;
  h.collector.values.CN = 999;
  await h.cron(scheduled);

  const raw = h.db.sqlite.prepare('SELECT region,count,timestamp FROM records ORDER BY region').all().map(row => ({ ...row }));
  assert.deepEqual(raw, [
    { region: 'CN', count: 88, timestamp: scheduled },
    { region: 'US', count: 0, timestamp: scheduled },
  ]);
  const rows = h.db.sqlite.prepare('SELECT * FROM aggregates ORDER BY granularity,region').all();
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.sample_count === 1));
  assert.ok(rows.filter(row => row.region === 'US').every(row => row.min_count === 0 && row.max_count === 0 && row.sum_count === 0));
  assert.ok(h.db.batches >= 1, 'raw records and rollups must use D1 atomic batch');
});

test('cron rebuilds current and previous hour then merges day/month without counting a sample twice', async t => {
  const h = await createHarness(t, { counts: { US: 90, CN: 300 } });
  h.raw('US', 10, CURRENT_HOUR - HOUR + 2 * 60000);
  h.raw('US', 20, CURRENT_HOUR - HOUR + 4 * 60000);
  h.raw('US', 40, CURRENT_HOUR + 2 * 60000);
  const scheduled = CURRENT_HOUR + 4 * 60000;
  await h.cron(scheduled);
  await h.cron(scheduled);

  const us = h.db.sqlite.prepare("SELECT * FROM aggregates WHERE region='US' ORDER BY granularity,bucket").all();
  const hours = us.filter(row => row.granularity === 'hour');
  assert.equal(hours.length, 2);
  assert.deepEqual(hours.map(row => [row.max_count, row.sum_count, row.sample_count]), [[20, 30, 2], [90, 130, 2]]);
  for (const granularity of ['day', 'month']) {
    const row = us.find(item => item.granularity === granularity);
    assert.deepEqual([row.min_count, row.max_count, row.sum_count, row.sample_count], [10, 90, 160, 4]);
  }
});

test('cron repairs both sides of a UTC month boundary', async t => {
  const scheduled = Date.parse('2026-11-01T00:02:00Z');
  const h = await createHarness(t, { now: scheduled, counts: { US: 50, CN: 100 } });
  h.raw('US', 30, Date.parse('2026-10-31T23:58:00Z'));
  await h.cron(scheduled);
  const rows = h.db.sqlite.prepare("SELECT bucket,max_count FROM aggregates WHERE region='US' AND granularity='month' ORDER BY bucket").all();
  assert.deepEqual(rows.map(row => [row.bucket, row.max_count]), [[CURRENT_MONTH, 30], [Date.parse('2026-11-01T00:00:00Z'), 50]]);
});

test('cron updates raw records and all rollups atomically if an aggregate write fails', async t => {
  const h = await createHarness(t);
  h.db.sqlite.exec(`CREATE TRIGGER reject_aggregate BEFORE INSERT ON aggregates
    BEGIN SELECT RAISE(FAIL, 'simulated aggregate failure'); END`);
  try { await h.cron(); } catch { /* A rejected scheduled job is expected and may be retried. */ }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM aggregates').get().n, 0);
});

test('cron raw-history reads use index searches over recent hours instead of full scans', async t => {
  const h = await createHarness(t);
  h.raw('US', 9999, FIXED_NOW - 365 * 24 * HOUR);
  await h.cron();
  const rawQueries = h.db.queries.filter(({ sql }) => /\b(?:FROM|JOIN)\s+records\b/i.test(sql));
  assert.ok(rawQueries.length > 0);
  for (const { sql, parameters } of rawQueries) {
    const plan = h.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters);
    assert.equal(plan.some(row => /\bSCAN\s+(?:records|r)\b/i.test(row.detail)), false,
      `unbounded raw-history scan: ${JSON.stringify(plan)}`);
  }
  assert.equal(h.db.sqlite.prepare("SELECT MAX(max_count) AS n FROM aggregates WHERE region='US'").get().n, 10);
});

for (const invalid of [-1, NaN, Infinity, 1.5, '123', undefined]) {
  test(`cron rejects invalid counts (${String(invalid)}) while saving the other region`, async t => {
    const h = await createHarness(t, { counts: { US: invalid, CN: 20 } });
    await h.cron();
    const rows = h.db.sqlite.prepare('SELECT region,count FROM records').all();
    assert.deepEqual(rows.map(row => [row.region, row.count]), [['CN', 20]]);
    assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM aggregates WHERE region='US'").get().n, 0);
  });
}
