const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const FIXED_NOW = Date.parse('2026-10-19T12:34:00Z');
const HOUR = 60 * 60 * 1000;

// Real SQLite executes the Worker SQL; only the D1 transport is adapted.
function createD1() {
  const sqlite = new DatabaseSync(':memory:');
  const queries = [];
  let batches = 0;

  function statement(sql, parameters = []) {
    function execute(mode) {
      queries.push({ sql, parameters: [...parameters], mode });
      const prepared = sqlite.prepare(sql);
      const returnsRows = prepared.columns().length > 0;
      let results = [];
      let changes = 0;
      if (mode === 'all' || returnsRows) {
        results = prepared.all(...parameters).map(row => ({ ...row }));
      } else {
        changes = Number(prepared.run(...parameters).changes);
      }
      return {
        success: true,
        results,
        meta: { changes, rows_read: results.length, rows_written: changes, duration: 0 },
      };
    }
    return {
      bind(...values) { return statement(sql, values); },
      async all() { return execute('all'); },
      async run() { return execute('run'); },
      async first(column) {
        const row = execute('all').results[0] || null;
        return column && row ? row[column] : row;
      },
      _execute() { return execute('batch'); },
    };
  }

  return {
    sqlite,
    queries,
    get batches() { return batches; },
    get reads() { return queries.filter(query => /^\s*(SELECT|WITH)\b/i.test(query.sql)); },
    prepare: statement,
    async batch(statements) {
      batches++;
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(item => item._execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

function createCache(clock) {
  const entries = new Map();
  const keyOf = request => typeof request === 'string' ? request : request.url;
  return {
    entries,
    async match(request) {
      const entry = entries.get(keyOf(request));
      if (!entry || entry.expires <= clock.now) return undefined;
      return entry.response.clone();
    },
    async put(request, response) {
      const ttl = Number(/(?:s-maxage|max-age)=(\d+)/.exec(response.headers.get('Cache-Control') || '')?.[1] || 120);
      entries.set(keyOf(request), { response: response.clone(), expires: clock.now + ttl * 1000 });
    },
    async delete(request) { return entries.delete(keyOf(request)); },
  };
}

async function createHarness(t, options = {}) {
  const db = createD1();
  db.sqlite.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  // API/cron tests use a fixture schema so a missing migration cannot mask their bugs.
  if (!db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aggregates'").get()) {
    db.sqlite.exec(`CREATE TABLE aggregates (
      granularity TEXT NOT NULL,
      region TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      min_count INTEGER NOT NULL,
      max_count INTEGER NOT NULL,
      sum_count INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      PRIMARY KEY (granularity, region, bucket)
    )`);
  }

  const clock = { now: options.now ?? FIXED_NOW };
  const cache = createCache(clock);
  const collector = { values: { US: 10, CN: 20, ...options.counts }, calls: [] };
  const timers = new Set();
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    URL, URLSearchParams, Request, Response, Headers,
    Date: ControlledDate,
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback, milliseconds, ...args) {
      const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, Math.min(milliseconds, 20));
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    caches: { default: cache, async open() { return cache; } },
    TextEncoder, TextDecoder, AbortController, AbortSignal,
  });
  const modules = new Map();
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    if (path.basename(filename).replace(/\.js$/, '') === 'collector') {
      const module = new vm.SyntheticModule(['default'], function () {
        this.setExport('default', async region => {
          collector.calls.push(region);
          const value = collector.values[region];
          if (value instanceof Error) throw value;
          return typeof value === 'function' ? value() : value;
        });
      }, { context, identifier: filename });
      modules.set(filename, module);
      return module;
    }
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    await module.link(async (specifier, reference) => {
      if (!specifier.startsWith('.')) throw new Error(`Unsupported test import: ${specifier}`);
      let resolved = path.resolve(path.dirname(reference.identifier), specifier);
      if (!path.extname(resolved) && fs.existsSync(`${resolved}.js`)) resolved += '.js';
      return load(resolved);
    });
    return module;
  }
  const module = await load(path.join(ROOT, 'src', 'index.js'));
  await module.evaluate();
  const worker = module.namespace.default;
  const env = { DB: db, CACHE: cache };
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
  async function flush() {
    while (pending.length) await Promise.all(pending.splice(0));
  }
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    db.sqlite.close();
  });
  return {
    db, clock, cache, collector, env, worker, ctx, flush,
    async fetch(route, init) {
      const response = await worker.fetch(new Request(`https://two-sum.test${route}`, init), env, ctx);
      await flush();
      return response;
    },
    async cron(scheduledTime = clock.now) {
      await worker.scheduled({ scheduledTime }, env, ctx);
      await flush();
    },
    raw(region, count, timestamp) {
      db.sqlite.prepare('INSERT INTO records (region, count, timestamp) VALUES (?, ?, ?)').run(region, count, timestamp);
    },
    aggregate(granularity, region, bucket, values = {}) {
      const { min = 10, max = 20, sum = 30, samples = 2 } = values;
      db.sqlite.prepare(`INSERT INTO aggregates
        (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(granularity, region, bucket, min, max, sum, samples);
    },
  };
}

module.exports = { ROOT, FIXED_NOW, HOUR, createD1, createHarness };
