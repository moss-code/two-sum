-- 创建记录表
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,           -- 区域：'CN' 或 'US'
    count INTEGER NOT NULL,         -- 在线人数
    timestamp INTEGER NOT NULL,     -- Unix 时间戳（毫秒）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_region_timestamp ON records(region, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_timestamp ON records(timestamp DESC);

-- 创建统计视图（可选，用于快速查询最新数据）
CREATE VIEW IF NOT EXISTS latest_stats AS
SELECT
    region,
    count,
    timestamp,
    datetime(timestamp/1000, 'unixepoch') as readable_time
FROM records
ORDER BY timestamp DESC
LIMIT 100;
