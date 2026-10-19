const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ROOT, FIXED_NOW, createHarness } = require('./helpers.cjs');

test('180 days of history still use indexed rollups for a 7-day chart; backfill is repeatable', async t => {
  const h = await createHarness(t);
  const db = h.db.sqlite;
  const insert = db.prepare('INSERT INTO records(region,count,timestamp) VALUES(?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 180 * 24 * 30; i++) {
    insert.run('US', 1000 + i % 100, FIXED_NOW - i * 120000);
    insert.run('CN', 200 + i % 50, FIXED_NOW - i * 120000);
  }
  db.exec('COMMIT');
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/0001_rollups.sql'), 'utf8');
  db.exec(migration);
  db.exec(migration);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 259200);
  assert.equal(db.prepare("SELECT SUM(sample_count) AS n FROM aggregates WHERE granularity='month'").get().n, 259200);
  const rows = await (await h.fetch('/api/aggregated')).json();
  assert.equal(rows.length, 336);
  for (const { sql, parameters } of h.db.reads) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters);
    assert.ok(plan.some(row => /SEARCH aggregates USING INDEX/.test(row.detail)), JSON.stringify(plan));
    assert.ok(plan.every(row => !/SCAN records/.test(row.detail)));
  }
});
