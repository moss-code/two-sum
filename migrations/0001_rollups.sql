-- Non-destructive, one-time historical backfill. Run with D1 migrations apply.
CREATE TABLE IF NOT EXISTS aggregates (
    granularity TEXT NOT NULL,
    region TEXT NOT NULL,
    bucket INTEGER NOT NULL,
    min_count INTEGER NOT NULL,
    max_count INTEGER NOT NULL,
    sum_count INTEGER NOT NULL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (granularity, region, bucket)
);

INSERT INTO aggregates (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
SELECT 'hour', region, CAST(timestamp / 3600000 AS INTEGER) * 3600000,
       MIN(count), MAX(count), SUM(count), COUNT(*)
FROM records GROUP BY region, CAST(timestamp / 3600000 AS INTEGER)
ON CONFLICT (granularity, region, bucket) DO UPDATE SET
    min_count=excluded.min_count, max_count=excluded.max_count,
    sum_count=excluded.sum_count, sample_count=excluded.sample_count;

INSERT INTO aggregates (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
SELECT 'day', region, CAST(bucket / 86400000 AS INTEGER) * 86400000,
       MIN(min_count), MAX(max_count), SUM(sum_count), SUM(sample_count)
FROM aggregates WHERE granularity='hour' GROUP BY region, CAST(bucket / 86400000 AS INTEGER)
ON CONFLICT (granularity, region, bucket) DO UPDATE SET
    min_count=excluded.min_count, max_count=excluded.max_count,
    sum_count=excluded.sum_count, sample_count=excluded.sample_count;

INSERT INTO aggregates (granularity, region, bucket, min_count, max_count, sum_count, sample_count)
SELECT 'month', region, CAST(strftime('%s', bucket / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000,
       MIN(min_count), MAX(max_count), SUM(sum_count), SUM(sample_count)
FROM aggregates WHERE granularity='day'
GROUP BY region, strftime('%Y-%m', bucket / 1000, 'unixepoch')
ON CONFLICT (granularity, region, bucket) DO UPDATE SET
    min_count=excluded.min_count, max_count=excluded.max_count,
    sum_count=excluded.sum_count, sample_count=excluded.sample_count;
