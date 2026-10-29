import * as echarts from 'echarts/core';
import { LineChart, BarChart, CandlestickChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  TitleComponent,
  CanvasRenderer,
]);

const charts = new Map();

export function disposeChart(el) {
  if (!el) return;
  const old = charts.get(el);
  if (old) {
    old.dispose();
    charts.delete(el);
  }
}

function getChart(el) {
  disposeChart(el);
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  charts.set(el, chart);
  return chart;
}

function axisMute() {
  return getComputedStyle(document.documentElement).getPropertyValue('--chart-mute').trim() || '#94a3b8';
}

function splitLine() {
  return getComputedStyle(document.documentElement).getPropertyValue('--chart-split').trim() || '#f1f5f9';
}

function padTimeLabel(t) {
  const s = String(t || '');
  const part = s.includes(' ') ? s.split(' ').pop() : s;
  const m = part.match(/(\d{1,2}):(\d{2})/);
  if (!m) return part.slice(0, 5);
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function pushClockRange(times, h0, m0, h1, m1) {
  let cur = h0 * 60 + m0;
  const end = h1 * 60 + m1;
  while (cur <= end) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    cur += 1;
  }
}

/** A 股交易日分时轴：09:30–11:30、13:00–15:00（含端点，逐分钟；午休不占轴，标准压缩轴） */
export function buildAshareSessionTimes() {
  const times = [];
  pushClockRange(times, 9, 30, 11, 30);
  pushClockRange(times, 13, 0, 15, 0);
  return times;
}

/**
 * 美股常规盘对应北京时间轴：21:30–次日 04:00（东财海外指数分时）
 * 纳指/道指等过夜时段用这个，不能再用 A 股 09:30–15:00。
 */
export function buildUsBeijingSessionTimes() {
  const times = [];
  pushClockRange(times, 21, 30, 23, 59);
  pushClockRange(times, 0, 0, 4, 0);
  return times;
}

/**
 * 韩/日指数北京时间轴：08:00–14:30（对应当地 09:00–15:30，连续竞价压缩）
 */
export function buildAsiaIndexSessionTimes() {
  const times = [];
  pushClockRange(times, 8, 0, 14, 30);
  return times;
}

/** 港股：09:30–12:00、13:00–16:00 */
export function buildHkSessionTimes() {
  const times = [];
  pushClockRange(times, 9, 30, 12, 0);
  pushClockRange(times, 13, 0, 16, 0);
  return times;
}

export function sessionTimesOf(session = 'ashare') {
  if (session === 'us') return buildUsBeijingSessionTimes();
  if (session === 'asia') return buildAsiaIndexSessionTimes();
  if (session === 'hk') return buildHkSessionTimes();
  if (session === 'raw') return null;
  return buildAshareSessionTimes();
}

function clockMinutesOf(label) {
  const s = String(label || '');
  const part = s.includes(' ') ? s.split(' ').pop() : s;
  const m = part.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inSessionMinutes(mins, session = 'ashare') {
  if (mins == null) return false;
  if (session === 'us') return mins >= 21 * 60 + 30 || mins <= 4 * 60;
  if (session === 'asia') return mins >= 8 * 60 && mins <= 14 * 60 + 30;
  if (session === 'hk') {
    return (
      (mins >= 9 * 60 + 30 && mins <= 12 * 60) || (mins >= 13 * 60 && mins <= 16 * 60)
    );
  }
  if (session === 'raw') return true;
  return (
    (mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30) || (mins >= 13 * 60 && mins <= 15 * 60)
  );
}

/** 将稀疏分时对齐到完整交易时段，缺失分钟填 null（再前向填充，避免折线被掐断） */
export function padSeriesToSession(times, ...seriesArrays) {
  return padSeriesToCustomSession(buildAshareSessionTimes(), times, ...seriesArrays);
}

export function padSeriesToCustomSession(session, times, ...seriesArrays) {
  if (!session?.length) {
    return { times: times || [], series: seriesArrays.map((arr) => [...(arr || [])]) };
  }
  const index = new Map((times || []).map((t, i) => [padTimeLabel(t), i]));
  const series = seriesArrays.map((arr) =>
    session.map((t) => {
      const i = index.get(t);
      if (i == null || arr == null) return null;
      const v = arr[i];
      return v == null || Number.isNaN(Number(v)) ? null : v;
    }),
  );
  return { times: session, series };
}

/** 前向填充 null，但不超过「尚未有数据」的尾部空白（全日轴未走完的时段保持空） */
function forwardFillUntilLast(values) {
  let last = null;
  let lastIdx = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] != null) lastIdx = i;
  }
  if (lastIdx < 0) return values;
  return values.map((v, i) => {
    if (i > lastIdx) return null;
    if (v != null) {
      last = v;
      return v;
    }
    return last;
  });
}

function isMultiDayLabel(t) {
  const s = String(t || '');
  return /\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(s) || /\d{4}-\d{2}-\d{2}/.test(s);
}

function trendDateKey(t) {
  const s = String(t || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2})\s+/);
  return m ? m[1] : null;
}

/** 多个不同日历日才算多日；同一天的 MM-DD HH:MM（如腾讯）仍按单日全日轴铺 */
function isMultiDaySeries(times, session = 'ashare') {
  const keys = new Set();
  for (const t of times || []) {
    const k = trendDateKey(t);
    if (k) keys.add(k);
  }
  if (keys.size >= 2) return true;
  // 仅 A 股：无日期且点数异常多，才当五日
  if (session === 'ashare' && keys.size === 0 && (times || []).length > 300) return true;
  return false;
}

/** 按市场时段丢掉非交易分钟（A 股午休 / 美股盘前杂点等） */
function filterIntradayPoints(times, prices, avgs, volumes, session = 'ashare') {
  const outT = [];
  const outP = [];
  const outA = [];
  const outV = [];
  for (let i = 0; i < (times || []).length; i += 1) {
    const label = String(times[i] || '');
    const clock = label.includes(' ') ? label.split(' ').pop() : label;
    const m = clock.match(/(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const mins = Number(m[1]) * 60 + Number(m[2]);
    if (!inSessionMinutes(mins, session)) continue;
    outT.push(label);
    outP.push(prices?.[i] ?? null);
    outA.push(avgs?.[i] ?? null);
    outV.push(volumes?.[i] ?? null);
  }
  return { times: outT, prices: outP, avgs: outA, volumes: outV };
}

export function renderIntradayChart(
  el,
  { times, prices, avgs, volumes, preClose, markLine },
  { axisMode = 'full', session = 'ashare' } = {},
) {
  if (!el) return;
  let chartTimes = times || [];
  let chartPrices = prices || [];
  let chartAvgs = avgs || [];
  let chartVolumes = volumes || [];
  // 多日才走压缩轴；腾讯单日即便带 MM-DD 也要铺全日时段
  const multiDay = isMultiDaySeries(chartTimes, session);
  // 滤掉非交易分钟；全日轴对齐并前向填充，稀疏缺口不再把线掐断
  if (multiDay || axisMode === 'live') {
    const filtered = filterIntradayPoints(
      chartTimes,
      chartPrices,
      chartAvgs,
      chartVolumes,
      session,
    );
    chartTimes = filtered.times;
    chartPrices = forwardFillUntilLast(filtered.prices);
    chartAvgs = forwardFillUntilLast(filtered.avgs);
    chartVolumes = filtered.volumes;
  } else if (axisMode === 'full' && chartTimes.length) {
    const sessionAxis = sessionTimesOf(session);
    const padded = sessionAxis
      ? padSeriesToCustomSession(sessionAxis, chartTimes, chartPrices, chartAvgs, chartVolumes)
      : { times: chartTimes, series: [chartPrices, chartAvgs, chartVolumes] };
    chartTimes = padded.times;
    [chartPrices, chartAvgs, chartVolumes] = padded.series;
    chartPrices = forwardFillUntilLast(chartPrices);
    chartAvgs = forwardFillUntilLast(chartAvgs);
  }
  const chart = getChart(el);
  const up = '#e11d48';
  const down = '#059669';
  const base = Number(preClose) || 0;
  const last =
    [...chartPrices].reverse().find((v) => v != null) ?? chartPrices[chartPrices.length - 1];
  const color = !base || last == null ? up : last >= base ? up : down;
  const mute = axisMute();

  // 右轴涨跌幅：单日相对昨收；五日多日不作跨日昨收百分比（易误导）
  const pcts = multiDay
    ? chartPrices.map(() => null)
    : chartPrices.map((p) =>
        p == null || !base ? null : +(((p - base) / base) * 100).toFixed(2),
      );
  const pctVals = pcts.filter((v) => v != null);
  const maxAbsPct = Math.max(2, ...(pctVals.map((v) => Math.abs(v)) || [2]));

  // 量柱：相对上一分钟涨红跌绿（买强/卖强视觉）
  const volBars = chartVolumes.map((v, i) => {
    if (v == null) return { value: null };
    const cur = chartPrices[i];
    const prev = i > 0 ? chartPrices[i - 1] : base;
    const barColor =
      cur == null || prev == null ? mute : cur >= prev ? up : down;
    return { value: v, itemStyle: { color: barColor } };
  });

  const defaultMark =
    !multiDay && base
      ? {
          symbol: 'none',
          label: { formatter: '昨收', color: mute, fontSize: 10 },
          lineStyle: { type: 'dashed', color: mute, width: 1 },
          data: [{ yAxis: base }],
        }
      : undefined;

  const interval = Math.max(1, Math.ceil(chartTimes.length / (multiDay ? 8 : 5)));
  const priced = chartPrices.filter((v) => v != null && Number(v) > 0).map(Number);
  const hi = priced.length ? Math.max(...priced) : null;
  const lo = priced.length ? Math.min(...priced) : null;
  const pctText = (price) => {
    if (!(base > 0) || !(price > 0) || multiDay) return '—';
    const pct = ((price - base) / base) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };
  const hiPct = pctText(hi);
  const loPct = pctText(lo);
  const loColor = lo != null && base > 0 && lo >= base ? up : down;

  chart.setOption({
    animationDuration: 280,
    title:
      hi && !multiDay
        ? {
            text: `{hi|最高涨幅 ${hiPct}}    {lo|最低涨幅 ${loPct}}`,
            left: 48,
            top: 0,
            textStyle: {
              rich: {
                hi: { color: up, fontSize: 12, fontWeight: 700 },
                lo: { color: loColor, fontSize: 12, fontWeight: 700 },
              },
            },
          }
        : hi && multiDay
          ? {
              text: `{hi|区间高 ${Number(hi).toFixed(2)}}    {lo|区间低 ${Number(lo).toFixed(2)}}`,
              left: 48,
              top: 0,
              textStyle: {
                rich: {
                  hi: { color: up, fontSize: 12, fontWeight: 700 },
                  lo: { color: down, fontSize: 12, fontWeight: 700 },
                },
              },
            }
          : undefined,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter(params) {
        if (!params?.length) return '';
        const t = params[0].axisValueLabel || params[0].name;
        const lines = [`${t}`];
        for (const p of params) {
          if (p.seriesName === '涨跌幅') {
            const v = p.value;
            lines.push(`${p.marker}${p.seriesName} ${v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`}`);
          } else if (p.seriesName === '成交量') {
            const v = p.value;
            lines.push(`${p.marker}${p.seriesName} ${v == null ? '—' : Number(v).toLocaleString('zh-CN')}`);
          } else {
            const v = p.value;
            lines.push(`${p.marker}${p.seriesName} ${v == null ? '—' : Number(v).toFixed(2)}`);
          }
        }
        return lines.join('<br/>');
      },
    },
    grid: [
      { left: 48, right: 48, top: 28, bottom: '32%' },
      { left: 48, right: 48, top: '74%', bottom: 28 },
    ],
    xAxis: [
      {
        type: 'category',
        data: chartTimes,
        boundaryGap: false,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: splitLine() } },
        axisTick: { show: false },
        gridIndex: 0,
      },
      {
        type: 'category',
        data: chartTimes,
        boundaryGap: true,
        axisLabel: {
          color: mute,
          fontSize: 10,
          interval: multiDay ? 'auto' : interval,
          hideOverlap: true,
          formatter: multiDay
            ? (v, idx) => {
                const s = String(v || '');
                const day = s.slice(0, 5);
                const prev = idx > 0 ? String(chartTimes[idx - 1] || '').slice(0, 5) : '';
                if (day !== prev) return day;
                const clock = s.includes(' ') ? s.split(' ').pop() : s;
                return clock === '09:30' || clock === '13:00' || clock === '15:00' ? clock : '';
              }
            : undefined,
        },
        axisLine: { lineStyle: { color: splitLine() } },
        gridIndex: 1,
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        gridIndex: 0,
        splitLine: { lineStyle: { color: splitLine() } },
        axisLabel: { color: mute, fontSize: 10 },
      },
      {
        type: 'value',
        gridIndex: 0,
        show: !multiDay,
        min: -maxAbsPct,
        max: maxAbsPct,
        splitLine: { show: false },
        axisLabel: {
          color: mute,
          fontSize: 10,
          formatter: (v) => `${v > 0 ? '+' : ''}${v}%`,
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 2,
        splitLine: { show: false },
        axisLabel: { show: false },
      },
    ],
    series: [
      {
        name: multiDay ? '五日' : '分时',
        type: 'line',
        data: chartPrices,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: true,
        smooth: multiDay ? 0 : 0.15,
        lineStyle: { width: 2, color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '33' },
            { offset: 1, color: color + '00' },
          ]),
        },
        markLine: markLine || defaultMark,
      },
      {
        name: '均价',
        type: 'line',
        data: chartAvgs,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: true,
        smooth: multiDay ? 0 : 0.15,
        lineStyle: { width: 1.2, color: '#f59e0b', opacity: 0.85 },
      },
      {
        name: '涨跌幅',
        type: 'line',
        data: pcts,
        xAxisIndex: 0,
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 0, opacity: 0 },
        itemStyle: { color: 'transparent' },
        tooltip: { show: true },
      },
      {
        name: '成交量',
        type: 'bar',
        data: volBars,
        xAxisIndex: 1,
        yAxisIndex: 2,
        barMaxWidth: 4,
      },
    ],
  });
  return chart;
}

function movingAverage(closes, n) {
  return closes.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let j = i - n + 1; j <= i; j += 1) sum += closes[j];
    return +(sum / n).toFixed(3);
  });
}

function ohlcTuple(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length >= 5 && typeof arr[0] === 'number' && arr[0] === Math.floor(arr[0]) && arr[0] < arr.length + 5) {
    return arr.slice(-4);
  }
  return arr.slice(0, 4);
}

export function renderKlineChart(el, points, { markLine, title = '日K' } = {}) {
  if (!el || !points?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  const dates = points.map((p) => p.date);
  const ohlc = points.map((p) => [p.open, p.close, p.low, p.high]);
  const closes = points.map((p) => Number(p.close));
  const ma = [
    ['5日均线', movingAverage(closes, 5), '#f59e0b'],
    ['10日均线', movingAverage(closes, 10), '#0ea5e9'],
    ['20日均线', movingAverage(closes, 20), '#a78bfa'],
  ];
  chart.setOption({
    animationDuration: 280,
    legend: {
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: mute, fontSize: 11 },
      data: [title, ...ma.map((row) => row[0])],
    },
    grid: { left: 48, right: 16, top: 32, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        if (!params?.length) return '';
        const head = params[0].axisValueLabel || params[0].name || '';
        const lines = [head];
        for (const p of params) {
          if (p.seriesType === 'candlestick') {
            const [open, close, low, high] = ohlcTuple(p.value);
            const fmt = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(2));
            lines.push(`开盘 ${fmt(open)}`);
            lines.push(`收盘 ${fmt(close)}`);
            lines.push(`最低 ${fmt(low)}`);
            lines.push(`最高 ${fmt(high)}`);
          } else if (p.value != null && p.value !== '-') {
            lines.push(`${p.marker || ''}${p.seriesName} ${Number(p.value).toFixed(2)}`);
          }
        }
        return lines.join('<br/>');
      },
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: mute, fontSize: 10 },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: [
      {
        name: title,
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: '#e11d48',
          color0: '#059669',
          borderColor: '#e11d48',
          borderColor0: '#059669',
        },
        markLine: markLine,
      },
      ...ma.map(([name, data, color]) => ({
        name,
        type: 'line',
        data,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.1, color },
        itemStyle: { color },
      })),
    ],
  });
  return chart;
}

/**
 * 真实日K + AI 预测K（预测段用半透明烛 + 竖线分隔）
 * history: [{date,open,high,low,close}]
 * forecast: 同上，date 已标好
 */
export function renderForecastKline(el, history, forecast, { title = '日K+预测', focusTomorrow = true } = {}) {
  if (!el) return;
  const histAll = history || [];
  const fut = forecast || [];
  // 默认只留少量真实日K作对照，视觉重心落在「明天」起的推演
  const hist = focusTomorrow ? histAll.slice(-8) : histAll;
  if (!hist.length && !fut.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  const splitAt = hist.length ? hist.length - 1 : -1;
  const dates = [
    ...hist.map((p) => p.date),
    ...fut.map((p, i) => (i === 0 ? `${p.date} 明` : p.date)),
  ];
  const ohlc = [
    ...hist.map((p) => [p.open, p.close, p.low, p.high]),
    ...fut.map((p) => [p.open, p.close, p.low, p.high]),
  ];
  const itemStyles = [
    ...hist.map(() => ({
      color: '#e11d48',
      color0: '#059669',
      borderColor: '#e11d48',
      borderColor0: '#059669',
    })),
    ...fut.map(() => ({
      color: 'rgba(14,165,233,0.55)',
      color0: 'rgba(45,212,191,0.55)',
      borderColor: '#0ea5e9',
      borderColor0: '#2dd4bf',
      borderWidth: 1.5,
    })),
  ];
  const total = dates.length || 1;
  // 窗口起点尽量贴近预测段，默认就能看到明天
  const windowStart = Math.max(0, hist.length - 3);
  const startPct = Math.max(0, Math.min(90, (windowStart / total) * 100));
  chart.setOption({
    animationDuration: 280,
    legend: {
      top: 0,
      textStyle: { color: mute, fontSize: 11 },
      data: [title],
    },
    grid: { left: 48, right: 16, top: 28, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        if (!params?.length) return '';
        const idx = params[0].dataIndex;
        const head = params[0].axisValueLabel || '';
        const tag = idx > splitAt ? (idx === splitAt + 1 ? '（明天·预测）' : '（预测）') : '';
        const [open, close, low, high] = ohlc[idx] || [];
        const fmt = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(2));
        const note = idx > splitAt ? fut[idx - hist.length]?.note || '' : '';
        return [
          `${head}${tag}`,
          `开 ${fmt(open)} 收 ${fmt(close)}`,
          `低 ${fmt(low)} 高 ${fmt(high)}`,
          note ? `说明 ${note}` : '',
        ]
          .filter(Boolean)
          .join('<br/>');
      },
    },
    dataZoom: [
      { type: 'inside', start: startPct, end: 100 },
      { type: 'slider', height: 18, bottom: 8, start: startPct, end: 100 },
    ],
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        color: mute,
        fontSize: 10,
        formatter: (v, idx) => (idx > splitAt ? `{pred|${v}}` : v),
        rich: { pred: { color: '#0ea5e9', fontWeight: 600 } },
      },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: [
      {
        name: title,
        type: 'candlestick',
        data: ohlc.map((v, i) => ({ value: v, itemStyle: itemStyles[i] })),
        markLine:
          splitAt >= 0 && fut.length
            ? {
                symbol: 'none',
                label: { formatter: '明天→', color: '#0ea5e9', fontSize: 10 },
                lineStyle: { type: 'dashed', color: '#0ea5e9', width: 1 },
                data: [{ xAxis: dates[splitAt] }],
              }
            : undefined,
      },
    ],
  });
  return chart;
}

/**
 * 沪深主力：今日实盘 + AI 预测续段（预测用虚线）
 * real: { times, main }
 * forecast: [{ time, main }]
 * 规则：压缩交易轴 + 前向填充保证折线连续；收盘后不再向 15:00 之后续线；
 * AI 只画「最后实盘时刻之后、且 ≤15:00」的剩余时段。
 */
export function renderPredictFlowChart(el, real, forecast) {
  if (!el) return;
  const rawTimes = (real?.times || []).map(padTimeLabel).filter(Boolean);
  const rawMain = real?.main || [];
  const byTime = new Map();
  rawTimes.forEach((t, i) => {
    if (clockMinutesOf(t) == null) return;
    byTime.set(t, rawMain[i] ?? null);
  });
  const session = buildAshareSessionTimes();
  let lastRealIdx = -1;
  let lastRealMin = -1;
  const sessionMain = session.map((t, i) => {
    const v = byTime.has(t) ? byTime.get(t) : null;
    if (v != null) {
      lastRealIdx = i;
      lastRealMin = clockMinutesOf(t) ?? lastRealMin;
    }
    return v;
  });
  const filledReal = forwardFillUntilLast(sessionMain);

  const futAll = (forecast || [])
    .map((p) => ({ time: padTimeLabel(p.time), main: Number(p.main) }))
    .filter((p) => p.time && Number.isFinite(p.main) && clockMinutesOf(p.time) != null);

  // 市场已走到/过 15:00：不再把「预 09:xx」接在收盘后面
  const marketDone = lastRealMin >= 15 * 60;
  const fut = marketDone
    ? []
    : futAll.filter((p) => {
        const m = clockMinutesOf(p.time);
        return m != null && m > lastRealMin && m <= 15 * 60;
      });

  const futMap = new Map(fut.map((p) => [p.time, p.main]));
  const predSeries = session.map((t, i) => {
    if (futMap.has(t)) return futMap.get(t);
    if (filledReal.some((v) => v != null) && i === lastRealIdx) return filledReal[i];
    return null;
  });

  const hasReal = filledReal.some((v) => v != null);
  const hasPred = fut.length > 0;
  if (!hasReal && !hasPred && !futAll.length) return;

  const chart = getChart(el);
  const mute = axisMute();
  const legend = [];
  if (hasReal) legend.push('今日主力');
  if (hasPred) legend.push('AI预测');
  chart.setOption({
    animationDuration: 280,
    legend: {
      top: 0,
      textStyle: { color: mute, fontSize: 11 },
      data: legend,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: session,
      boundaryGap: false,
      axisLabel: {
        color: mute,
        fontSize: 10,
        interval: Math.max(1, Math.ceil(session.length / 6)),
      },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      name: '亿',
      nameTextStyle: { color: mute, fontSize: 10 },
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: [
      ...(hasReal
        ? [
            {
              name: '今日主力',
              type: 'line',
              showSymbol: false,
              connectNulls: true,
              data: filledReal,
              lineStyle: { width: 2.2, color: '#e11d48' },
              itemStyle: { color: '#e11d48' },
            },
          ]
        : []),
      ...(hasPred
        ? [
            {
              name: 'AI预测',
              type: 'line',
              showSymbol: false,
              connectNulls: true,
              data: predSeries,
              lineStyle: { width: 2, type: 'dashed', color: '#0ea5e9' },
              itemStyle: { color: '#0ea5e9' },
            },
          ]
        : []),
    ],
  });
  return chart;
}

/** 卡片迷你分时 */
export function renderSparkline(el, prices, preClose) {
  if (!el || !prices?.length) return;
  const chart = getChart(el);
  const last = prices[prices.length - 1];
  const color = last >= (preClose || last) ? '#e11d48' : '#059669';
  chart.setOption({
    animation: false,
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: { type: 'category', show: false, data: prices.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: prices,
        showSymbol: false,
        lineStyle: { width: 1.5, color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '44' },
            { offset: 1, color: color + '00' },
          ]),
        },
      },
    ],
  });
  return chart;
}

export function renderFlowChart(el, flow, { axisMode = 'full', legendNames } = {}) {
  if (!el || !flow?.times?.length) return;
  let times = flow.times;
  let main = flow.main;
  let huge = flow.huge;
  let large = flow.large;
  let mid = flow.mid;
  let small = flow.small;
  if (axisMode === 'full') {
    const padded = padSeriesToSession(times, main, huge, large, mid, small);
    times = padded.times;
    [main, huge, large, mid, small] = padded.series.map(forwardFillUntilLast);
  } else {
    // 已走：只留连续竞价分钟，缺口前向填充，避免折线被掐断
    const t2 = [];
    const m2 = [];
    const h2 = [];
    const l2 = [];
    const mid2 = [];
    const s2 = [];
    for (let i = 0; i < times.length; i += 1) {
      const mins = clockMinutesOf(times[i]);
      if (mins == null) continue;
      if (
        !(
          (mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30) ||
          (mins >= 13 * 60 && mins <= 15 * 60)
        )
      ) {
        continue;
      }
      t2.push(padTimeLabel(times[i]));
      m2.push(main?.[i] ?? null);
      h2.push(huge?.[i] ?? null);
      l2.push(large?.[i] ?? null);
      mid2.push(mid?.[i] ?? null);
      s2.push(small?.[i] ?? null);
    }
    times = t2;
    main = forwardFillUntilLast(m2);
    huge = forwardFillUntilLast(h2);
    large = forwardFillUntilLast(l2);
    mid = forwardFillUntilLast(mid2);
    small = forwardFillUntilLast(s2);
  }
  const legends = legendNames?.length
    ? legendNames
    : ['主力', '超大单', '大单', '中单', '小单'];
  const colors = ['#e11d48', '#f97316', '#0f766e', '#0ea5e9', '#059669'];
  const widths = [2.2, 1.2, 1.2, 1.2, 1.2];
  const seriesData = [main, huge, large, mid, small];
  const chart = getChart(el);
  const mute = axisMute();
  chart.setOption({
    animationDuration: 280,
    legend: {
      top: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: mute, fontSize: 11 },
      data: legends,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: {
        color: mute,
        fontSize: 10,
        interval: Math.ceil(times.length / 5),
      },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      name: '亿',
      nameLocation: 'end',
      nameRotate: 0,
      nameGap: 10,
      nameTextStyle: { color: mute, fontSize: 10, align: 'left' },
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: legends.map((name, i) => ({
      name,
      type: 'line',
      showSymbol: false,
      connectNulls: true,
      data: seriesData[i] ?? [],
      color: colors[i] ?? mute,
      itemStyle: { color: colors[i] ?? mute },
      lineStyle: { width: widths[i] ?? 1.2, color: colors[i] ?? mute },
    })),
  });
  return chart;
}

export function renderUpDownChart(el, dist) {
  if (!el || !dist?.labels?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  chart.setOption({
    animationDuration: 280,
    grid: { left: 40, right: 12, top: 16, bottom: 48 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dist.labels,
      axisLabel: { color: mute, fontSize: 10, rotate: 0, interval: 0 },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        data: dist.values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: i < 11 ? '#059669' : i === 11 ? '#94a3b8' : '#e11d48',
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barMaxWidth: 18,
      },
    ],
  });
  return chart;
}

export function renderNorthboundChart(el, nb) {
  if (!el || !nb?.times?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  const last = nb.last;
  const color = last >= 0 ? '#e11d48' : '#059669';
  chart.setOption({
    animationDuration: 280,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: nb.times,
      boundaryGap: false,
      axisLabel: { color: mute, fontSize: 10, interval: Math.ceil(nb.times.length / 5) },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      name: '亿',
      nameLocation: 'end',
      nameRotate: 0,
      nameGap: 10,
      nameTextStyle: { color: mute, fontSize: 10, align: 'left' },
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: [
      {
        type: 'line',
        showSymbol: false,
        data: nb.net,
        lineStyle: { width: 2, color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '33' },
            { offset: 1, color: color + '00' },
          ]),
        },
      },
    ],
  });
  return chart;
}

/** 板块涨跌横向柱状图 */
export function renderBoardBarChart(el, boards) {
  if (!el || !boards?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  const top = boards.slice(0, 30);
  const names = top.map((b) => b.name).reverse();
  const values = top.map((b) => b.changePct).reverse();
  chart.setOption({
    animationDuration: 280,
    grid: { left: 88, right: 36, top: 8, bottom: 8 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => `${Number(v).toFixed(2)}%`,
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: mute, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: mute, fontSize: 10, width: 78, overflow: 'truncate' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v) => ({
          value: v,
          itemStyle: {
            color: v >= 0 ? '#e11d48' : '#059669',
            borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
        })),
        barMaxWidth: 14,
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          color: mute,
          formatter: (p) => `${Number(p.value).toFixed(2)}%`,
        },
      },
    ],
  });
  return chart;
}

export function resizeAllCharts() {
  for (const chart of charts.values()) chart.resize();
}
