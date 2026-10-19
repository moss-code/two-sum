import { PROFILES, chartData, formatSample, calendarDay, formatAxisLabel, formatBucketLabel, weekendRanges, isHourOverview } from './data.js';

const root = document.getElementById('two-sum-liquid-glass');
const $ = selector => root.querySelector(selector);
const TTL = 120000;
const API = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  ? `http://${location.hostname}:8787` : 'https://api.twosum.icu';
const getSaved = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Private browsing. */ } };
const grains = Object.keys(PROFILES);
const savedGrain = getSaved('two-sum-grain');
const savedOffset = Number(getSaved('two-sum-offset') ?? 480);
const state = { grain: grains.includes(savedGrain) ? savedGrain : 'hour',
  offset: [-480, -300, 0, 60, 180, 480, 540, 720].includes(savedOffset) ? savedOffset : 480 };
const cache = new Map();
let latest = null, chart = null, timer, controller, revision = 0, plottedGrain = null;
const refresh = $('.lg-refresh'), select = $('select'), errorBox = $('.lg-error');
const number = value => value.toLocaleString('en-US');
const fresh = entry => entry && Date.now() - entry.received < TTL;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function controls() {
  root.querySelectorAll('[data-grain]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.grain === state.grain)));
  select.value = String(state.offset);
  const active = $('[data-grain][aria-pressed=true]');
  $('.lg-lens').style.width = `${active.offsetWidth}px`;
  $('.lg-lens').style.transform = `translateX(${active.offsetLeft}px)`;
  const profile = PROFILES[state.grain];
  $('[data-range-title]').textContent = `${profile.span} · ${profile.label}${state.grain === 'hour' ? '' : ' · UTC 统计'}`;
  $('.lg-weekend-key').hidden = state.grain === 'month';
  $('.lg-weekend-key').title = state.grain === 'day' ? '底色标记 UTC 统计日的周六、周日' : '底色按所选显示时区标记周六、周日';
}

function renderLatest() {
  for (const region of ['US', 'CN']) {
    const sample = latest?.data?.[region];
    const valid = sample && Number.isSafeInteger(sample.count) && sample.count >= 0 && Number.isFinite(sample.timestamp);
    $(`[data-${region.toLowerCase()}-count]`).textContent = valid ? number(sample.count) : '—';
    const time = $(`[data-${region.toLowerCase()}-time]`);
    const stale = valid && Date.now() - sample.timestamp > 6 * 60000;
    time.dataset.stale = String(stale);
    time.textContent = valid ? `${formatSample(sample.timestamp, state.offset)}${stale ? ' · 较早数据' : ''}` : '暂无采样';
  }
}

function color(variable) {
  const probe = document.createElement('span');
  probe.style.color = `var(${variable})`;
  root.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function renderChart(resetZoom = false) {
  if (!chart) return;
  const entry = cache.get(state.grain);
  const data = chartData(entry?.data || [], state.grain);
  const blue = color('--lg-blue'), green = color('--lg-green'), muted = color('--lg-muted');
  const grid = color('--lg-grid'), ink = color('--lg-ink'), solid = color('--lg-solid');
  const weekendColor = color('--lg-weekend'), purple = color('--lg-purple');
  const narrow = root.clientWidth < 660;
  const changed = plottedGrain !== state.grain;
  const overview = isHourOverview(state.grain, data.times.length, chart.getOption(), changed || resetZoom);
  $('[data-point-count]').textContent = entry ? number(data.points) : '—';
  $('[data-updated]').textContent = entry ? `更新于 ${formatSample(entry.received, state.offset).slice(-5)}` : '等待数据';
  $('.lg-empty').hidden = !entry || data.points !== 0;
  const option = {
    animation: !reducedMotion.matches,
    animationDuration: 350,
    textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: narrow ? 42 : 48, right: narrow ? 42 : 48, top: 26, bottom: 66 },
    tooltip: {
      trigger: 'axis', confine: true, backgroundColor: solid, borderColor: grid, borderWidth: 1,
      extraCssText: 'border-radius:16px;box-shadow:0 6px 25px rgb(15 40 80 / .12);padding:12px 14px',
      textStyle: { color: ink, fontSize: 12 }, axisPointer: { type: 'line', lineStyle: { color: muted, type: 'dashed', opacity: 0.35 } },
      formatter(params) {
        const index = params[0]?.dataIndex;
        if (index === undefined) return '';
        const heading = formatBucketLabel(data.times[index], state.grain, state.offset);
        return `<div style="opacity:.7;margin-bottom:8px">${heading}${state.grain === 'hour' ? '' : ' UTC'}</div>` +
          [['US', '国际区 US', blue], ['CN', '中国区 CN', green]].map(([region, label, shade]) => {
            const value = data[region][index];
            return `<div style="display:flex;align-items:center;gap:16px;margin-top:5px"><span style="flex:1"><i style="display:inline-block;width:12px;height:3px;border-radius:3px;margin-right:7px;background:${shade}"></i>${label}</span><strong style="font-weight:500">${value === null ? '无数据' : number(value) + ' 人'}</strong></div>`;
          }).join('');
      },
    },
    xAxis: { type: 'category', boundaryGap: false, data: data.times.map(String),
      axisLine: { lineStyle: { color: grid } }, axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10, lineHeight: 15, margin: 11, hideOverlap: true,
        // Place one label near the middle of each local day in the week overview.
        interval: overview ? (_, value) => new Date(Number(value) + state.offset * 60000).getUTCHours() === 12 : 'auto',
        rich: { weekend: { color: purple, fontWeight: 500, fontSize: 10, lineHeight: 15 } },
        formatter: value => {
          const label = formatAxisLabel(Number(value), state.grain, state.offset, overview);
          return calendarDay(Number(value), state.grain, state.offset)?.weekend ? `{weekend|${label}}` : label;
        } },
    },
    yAxis: ['US', 'CN'].map((region, index) => ({ type: 'value', min: 0, minInterval: 1,
      position: index ? 'right' : 'left', name: region, nameTextStyle: { color: index ? green : blue, fontSize: 10, padding: [0, 0, 1, 0] },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10, formatter: value => value >= 10000 ? `${+(value / 1000).toFixed(1)}k` : String(value) },
      splitLine: { show: !index, lineStyle: { color: grid, type: 'dashed' } }, splitNumber: 4,
    })),
    series: ['US', 'CN'].map((region, index) => ({ id: region, name: region, type: 'line', yAxisIndex: index,
      data: data[region], connectNulls: true, smooth: 0.22, showSymbol: data.points < 6,
      symbol: 'circle', symbolSize: 5, itemStyle: { color: index ? green : blue },
      lineStyle: { width: 2.3, color: index ? green : blue, cap: 'round' },
      emphasis: { focus: 'none', scale: false },
      // One shared background layer for both regions; no extra API reads or synthetic data points.
      markArea: { silent: true, itemStyle: { color: weekendColor },
        label: { show: state.grain === 'hour', position: 'insideTop', color: purple, fontSize: 10, padding: 6 },
        data: index ? [] : weekendRanges(data.times, state.grain, state.offset).map(range => [
          { name: '周末', xAxis: String(data.times[range.start]) },
          { xAxis: range.end === data.times.length ? 'max' : String(data.times[range.end]) },
        ]),
      },
    })),
  };
  if (changed || resetZoom) option.dataZoom = [
    { id: 'inside', type: 'inside', start: 0, end: 100, zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, preventDefaultMouseMove: false },
    { id: 'slider', type: 'slider', height: 15, bottom: 3, start: 0, end: 100, showDetail: false,
      borderColor: grid, backgroundColor: 'transparent', fillerColor: grid, dataBackground: { lineStyle: { color: muted, opacity: 0.2 }, areaStyle: { opacity: 0 } },
      selectedDataBackground: { lineStyle: { color: blue, opacity: 0.25 }, areaStyle: { opacity: 0 } }, handleStyle: { color: solid, borderColor: grid }, brushSelect: false },
  ];
  chart.setOption(option);
  plottedGrain = state.grain;
}

async function request(path, signal) {
  const response = await fetch(`${API}${path}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function schedule() {
  clearTimeout(timer);
  if (!document.hidden) timer = setTimeout(() => load(), TTL);
}

async function load(force = false, resetZoom = false) {
  clearTimeout(timer);
  controller?.abort();
  const version = ++revision, grain = state.grain, cached = cache.get(grain);
  renderLatest(); renderChart(resetZoom);
  if (!force && fresh(cached) && fresh(latest)) {
    chart?.hideLoading(); errorBox.hidden = true;
    $('[data-status]').textContent = 'Cloudflare Workers · D1 · Pages';
    refresh.disabled = false; refresh.setAttribute('aria-busy', 'false');
    schedule(); return;
  }
  const fetchAggregate = force || !fresh(cached), fetchLatest = force || !fresh(latest);
  const currentController = new AbortController();
  controller = currentController;
  const signal = currentController.signal;
  const timeout = setTimeout(() => currentController.abort(), 15000);
  refresh.disabled = true; refresh.setAttribute('aria-busy', 'true');
  $('[data-status]').textContent = '正在更新…';
  if (!cached) chart?.showLoading('default', { text: '正在加载', color: color('--lg-blue'),
    textColor: color('--lg-muted'), maskColor: 'transparent', fontSize: 12 });
  const [aggregateResult, latestResult] = await Promise.allSettled([
    fetchAggregate ? request(`/api/aggregated?granularity=${grain}&limit=${PROFILES[grain].limit}`, signal) : Promise.resolve(cached.data),
    fetchLatest ? request('/api/latest', signal) : Promise.resolve(latest.data),
  ]);
  clearTimeout(timeout);
  if (version !== revision) return;
  const failures = [];
  if (aggregateResult.status === 'fulfilled' && Array.isArray(aggregateResult.value)) {
    if (fetchAggregate) cache.set(grain, { data: aggregateResult.value, received: Date.now() });
  } else failures.push('趋势数据');
  if (latestResult.status === 'fulfilled' && latestResult.value && typeof latestResult.value === 'object') {
    if (fetchLatest) latest = { data: latestResult.value, received: Date.now() };
  } else failures.push('最新采样');
  chart?.hideLoading();
  renderLatest(); renderChart(resetZoom);
  errorBox.hidden = failures.length === 0;
  errorBox.textContent = failures.length ? `${failures.join('、')}暂时不可用${cache.has(grain) || latest ? '，已保留上次成功的数据' : ''}。可点击刷新重试。` : '';
  $('[data-status]').textContent = failures.length ? '等待恢复 · 2 分钟后重试' : 'Cloudflare Workers · D1 · Pages';
  refresh.disabled = false; refresh.setAttribute('aria-busy', 'false');
  schedule();
}

root.querySelectorAll('[data-grain]').forEach(button => button.addEventListener('click', () => {
  if (state.grain === button.dataset.grain) return;
  state.grain = button.dataset.grain; save('two-sum-grain', state.grain); controls(); load(false, true);
}));
select.addEventListener('change', () => { state.offset = Number(select.value); save('two-sum-offset', state.offset); renderLatest(); renderChart(); });
refresh.addEventListener('click', () => load(true));
root.querySelectorAll('.lg-glass').forEach(glass => glass.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
  const rect = glass.getBoundingClientRect();
  glass.style.setProperty('--lg-mx', `${(event.clientX - rect.left) / rect.width * 100}%`);
  glass.style.setProperty('--lg-my', `${(event.clientY - rect.top) / rect.height * 100}%`);
}));
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (document.hidden) { controller?.abort(); ++revision; refresh.disabled = false; refresh.setAttribute('aria-busy', 'false'); chart?.hideLoading(); }
  else load();
});

// Wait for the existing CDN chart dependency; render a useful error if it cannot load.
if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
controls();
if (window.echarts) {
  chart = echarts.init($('#chart'), null, { renderer: 'svg' });
  chart.on('datazoom', () => renderChart());
  new ResizeObserver(() => { controls(); chart.resize(); }).observe(root);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderChart());
  load();
} else {
  errorBox.hidden = false; errorBox.textContent = '图表组件加载失败，请检查网络后重新加载页面。';
  refresh.disabled = true;
}
