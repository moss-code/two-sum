export const REGIONS = ['US', 'CN'];
export const PROFILES = { hour: { limit: 168, maximum: 336 }, day: { limit: 90, maximum: 180 }, month: { limit: 24, maximum: 48 } };

export function bucketStart(timestamp, granularity) {
  if (granularity === 'month') {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  const step = granularity === 'day' ? 86400000 : 3600000;
  return Math.floor(timestamp / step) * step;
}

export function shiftBucket(timestamp, granularity, amount) {
  if (granularity === 'month') {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1);
  }
  return timestamp + amount * (granularity === 'day' ? 86400000 : 3600000);
}

const UPSERT = `ON CONFLICT (granularity, region, bucket) DO UPDATE SET
  min_count = excluded.min_count, max_count = excluded.max_count,
  sum_count = excluded.sum_count, sample_count = excluded.sample_count`;

export async function saveSamples(db, samples, timestamp) {
  const statements = samples.map(({ region, count, timestamp }) => db.prepare(`
    INSERT INTO records (region, count, timestamp) SELECT ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM records WHERE region = ? AND timestamp = ?)`)
    .bind(region, count, timestamp, region, timestamp));
  const hour = bucketStart(timestamp, 'hour');
  const hours = [hour - 3600000, hour];
  const days = [...new Set(hours.map(value => bucketStart(value, 'day')))];
  const months = [...new Set(days.map(value => bucketStart(value, 'month')))];

  for (const region of REGIONS) {
    // Rebuild only two recent hours: repair interrupted rollouts and make retries idempotent.
    for (const start of hours) statements.push(db.prepare(`
      INSERT INTO aggregates (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
      SELECT 'hour', ?, ?, MIN(count), MAX(count), SUM(count), COUNT(*) FROM records
      WHERE region = ? AND timestamp >= ? AND timestamp < ? HAVING COUNT(*) > 0 ${UPSERT}`)
      .bind(region, start, region, start, start + 3600000));
    for (const [grain, source, buckets] of [['day', 'hour', days], ['month', 'day', months]]) {
      for (const start of buckets) statements.push(db.prepare(`
        INSERT INTO aggregates (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
        SELECT ?, ?, ?, MIN(min_count), MAX(max_count), SUM(sum_count), SUM(sample_count) FROM aggregates
        WHERE granularity = ? AND region = ? AND bucket >= ? AND bucket < ?
        HAVING COUNT(*) > 0 ${UPSERT}`)
        .bind(grain, region, start, source, region, start, shiftBucket(start, grain, 1)));
    }
  }
  // D1 batch commits raw samples and all rollups together, or rolls back everything.
  return db.batch(statements);
}
