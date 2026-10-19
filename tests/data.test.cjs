const assert = require('node:assert/strict');
const { test } = require('node:test');
const now = Date.parse('2026-10-19T12:34:00Z');
const hour = 3600000;
const dataModule = import('../public/data.js');

test('chart aligns both regions, displays MAX including zero, and leaves gaps null', async () => {
  const { chartData } = await dataModule;
  const start = Math.floor(now / hour) * hour;
  const result = chartData([
    { region: 'US', timestamp: start - 2 * hour, max_count: 90, avg_count: 40 },
    { region: 'US', timestamp: start, max_count: 0, avg_count: 9 },
    { region: 'CN', timestamp: start - hour, max_count: 500, avg_count: 450 },
  ], 'hour', now);
  assert.equal(result.times.length, 168);
  assert.deepEqual(result.US.slice(-3), [90, null, 0]);
  assert.deepEqual(result.CN.slice(-3), [null, 500, null]);
  assert.equal(result.points, 3);
});

test('empty chart retains the requested window without inventing samples', async () => {
  const { chartData } = await dataModule;
  const result = chartData([], 'month', now);
  assert.equal(result.times.length, 24);
  assert.equal(result.times.at(-1), Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(result.points, 0);
  assert.ok(result.US.every(point => point === null));
});

test('day/month labels preserve UTC statistical periods when display timezone is negative', async () => {
  const { formatBucket, formatSample } = await dataModule;
  const timestamp = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(formatBucket(timestamp, 'month', -480), '2026-10');
  assert.equal(formatBucket(timestamp, 'day', -480), '2026-10-01');
  assert.equal(formatBucket(timestamp, 'hour', -480), '09-30 16:00');
  assert.equal(formatSample(timestamp, 480), '10-01 08:00');
});

test('weekday annotations follow the display timezone for hours and UTC calendar days for daily peaks', async () => {
  const { calendarDay, formatAxisLabel, formatBucketLabel } = await dataModule;
  const friday = Date.parse('2026-10-16T20:00:00Z');
  assert.deepEqual(calendarDay(friday, 'hour', 480), { weekday: '周六', weekend: true });
  assert.deepEqual(calendarDay(friday, 'hour', -480), { weekday: '周五', weekend: false });
  assert.deepEqual(calendarDay(friday, 'day', 480), { weekday: '周五', weekend: false });
  assert.equal(formatAxisLabel(friday, 'hour', 480), '10-17 周六\n04:00');
  assert.equal(formatAxisLabel(friday, 'hour', 480, true), '10-17\n周六');
  assert.equal(formatAxisLabel(friday, 'day', 480), '10-16\n周五');
  assert.equal(formatBucketLabel(friday, 'hour', 480), '10-17 04:00 周六');
  assert.equal(formatBucketLabel(friday, 'day', 480), '2026-10-16 周五');
});

test('weekend bands include Saturday and Sunday, clip partial ranges and move with the display zone', async () => {
  const { weekendRanges } = await dataModule;
  const start = Date.parse('2026-10-16T00:00:00Z'); // Friday
  const times = Array.from({ length: 5 * 24 }, (_, index) => start + index * hour);
  assert.deepEqual(weekendRanges(times, 'hour', 0), [{ start: 24, end: 72 }]);
  assert.deepEqual(weekendRanges(times, 'hour', 480), [{ start: 16, end: 64 }]);
  assert.deepEqual(weekendRanges(times.slice(36, 60), 'hour', 0), [{ start: 0, end: 24 }]);
  assert.deepEqual(weekendRanges(times.slice(0, 20), 'hour', 0), []);
  const days = Array.from({ length: 5 }, (_, index) => start + index * 24 * hour);
  assert.deepEqual(weekendRanges(days, 'day', -480), [{ start: 1, end: 3 }]);
});

test('monthly peaks are not given a weekday or weekend band', async () => {
  const { calendarDay, formatAxisLabel, formatBucketLabel, weekendRanges } = await dataModule;
  const month = Date.parse('2026-11-01T00:00:00Z'); // A Sunday, but the bucket covers the whole month.
  assert.equal(calendarDay(month, 'month', 480), null);
  assert.equal(formatAxisLabel(month, 'month', 480), '2026-11');
  assert.equal(formatBucketLabel(month, 'month', 480), '2026-11');
  assert.deepEqual(weekendRanges([month], 'month', 480), []);
});

test('hour overview handles an uninitialized chart, zoomed ranges, and a reset to the whole week', async () => {
  const { isHourOverview } = await dataModule;
  assert.equal(isHourOverview('hour', 168, undefined), true);
  const zoom = { dataZoom: [{ id: 'inside', start: 25, end: 50 }] };
  assert.equal(isHourOverview('hour', 168, zoom), false);
  assert.equal(isHourOverview('hour', 168, zoom, true), true);
  assert.equal(isHourOverview('day', 90, undefined), false);
  assert.equal(isHourOverview('month', 24, undefined), false);
});
