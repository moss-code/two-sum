export const PROFILES = {
  hour: { limit: 168, span: '过去 7 天', label: '小时峰值' },
  day: { limit: 90, span: '过去 90 天', label: '日峰值' },
  month: { limit: 24, span: '过去 24 个月', label: '月峰值' },
};

function bucket(timestamp, grain) {
  const date = new Date(timestamp);
  if (grain === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const step = grain === 'day' ? 86400000 : 3600000;
  return Math.floor(timestamp / step) * step;
}

export function chartData(rows, grain, now = Date.now()) {
  const end = bucket(now, grain), date = new Date(end);
  const times = Array.from({ length: PROFILES[grain].limit }, (_, index) => {
    const offset = index + 1 - PROFILES[grain].limit;
    return grain === 'month' ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
      : end + offset * (grain === 'day' ? 86400000 : 3600000);
  });
  const maps = { US: new Map(), CN: new Map() };
  for (const row of rows) {
    if (!Object.hasOwn(maps, row.region) || !Number.isSafeInteger(row.max_count) || row.max_count < 0) continue;
    const timestamp = Number(row.timestamp);
    if (Number.isFinite(timestamp)) maps[row.region].set(timestamp, row);
  }
  const result = { times, rows: maps, points: 0 };
  for (const region of ['US', 'CN']) result[region] = times.map(time => {
    const value = maps[region].get(time)?.max_count ?? null;
    if (value !== null) result.points++;
    return value;
  });
  return result;
}

export function formatSample(timestamp, offset) {
  return new Date(timestamp + offset * 60000).toISOString().slice(5, 16).replace('T', ' ');
}

export function formatBucket(timestamp, grain, offset) {
  if (grain === 'hour') return formatSample(timestamp, offset);
  // Daily/monthly buckets are UTC calendar periods; display zones cannot move them into another period.
  return new Date(timestamp).toISOString().slice(0, grain === 'day' ? 10 : 7);
}

export function calendarDay(timestamp, grain, offset) {
  if (grain === 'month') return null;
  const day = new Date(timestamp + (grain === 'hour' ? offset * 60000 : 0)).getUTCDay();
  return { weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day], weekend: day === 0 || day === 6 };
}

export function formatBucketLabel(timestamp, grain, offset) {
  const label = formatBucket(timestamp, grain, offset);
  const day = calendarDay(timestamp, grain, offset);
  return day ? `${label} ${day.weekday}` : label;
}

export function formatAxisLabel(timestamp, grain, offset, overview = false) {
  const label = formatBucket(timestamp, grain, offset);
  const day = calendarDay(timestamp, grain, offset);
  if (!day) return label;
  if (grain === 'hour') return overview ? `${label.slice(0, 5)}\n${day.weekday}` : `${label.slice(0, 5)} ${day.weekday}\n${label.slice(6)}`;
  return `${label.slice(5)}\n${day.weekday}`;
}

export function isHourOverview(grain, points, chartOptions, reset = false) {
  const zoom = chartOptions?.dataZoom?.find(item => item.id === 'inside');
  const visiblePoints = reset ? points : points * ((zoom?.end ?? 100) - (zoom?.start ?? 0)) / 100;
  return grain === 'hour' && visiblePoints > 72;
}

// Index ranges end at the first weekday bucket, or at times.length when the weekend is still in view.
export function weekendRanges(times, grain, offset) {
  if (grain === 'month') return [];
  const ranges = [];
  let start = null;
  for (let index = 0; index <= times.length; index++) {
    const weekend = index < times.length && calendarDay(times[index], grain, offset).weekend;
    if (weekend && start === null) start = index;
    if (!weekend && start !== null) { ranges.push({ start, end: index }); start = null; }
  }
  return ranges;
}
