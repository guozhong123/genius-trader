import * as echarts from 'echarts/core';
import { LineChart, BarChart, CandlestickChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
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

/** A 股交易日分时轴：09:30–11:30、13:00–15:00（含端点，逐分钟） */
export function buildAshareSessionTimes() {
  const times = [];
  const pushRange = (h0, m0, h1, m1) => {
    let cur = h0 * 60 + m0;
    const end = h1 * 60 + m1;
    while (cur <= end) {
      const h = Math.floor(cur / 60);
      const m = cur % 60;
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      cur += 1;
    }
  };
  pushRange(9, 30, 11, 30);
  pushRange(13, 0, 15, 0);
  return times;
}

/** 将稀疏分时对齐到完整交易时段，缺失分钟填 null（价格类可前向填充避免折线断开） */
export function padSeriesToSession(times, ...seriesArrays) {
  const session = buildAshareSessionTimes();
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

export function renderIntradayChart(
  el,
  { times, prices, avgs, volumes, preClose, markLine },
  { axisMode = 'full' } = {},
) {
  if (!el) return;
  let chartTimes = times || [];
  let chartPrices = prices || [];
  let chartAvgs = avgs || [];
  let chartVolumes = volumes || [];
  if (axisMode === 'full' && chartTimes.length) {
    const padded = padSeriesToSession(chartTimes, chartPrices, chartAvgs, chartVolumes);
    chartTimes = padded.times;
    [chartPrices, chartAvgs, chartVolumes] = padded.series;
    // 稀疏分钟对齐后补齐，避免折线中间断裂；成交量保持空洞
    chartPrices = forwardFillUntilLast(chartPrices);
    chartAvgs = forwardFillUntilLast(chartAvgs);
  }
  const chart = getChart(el);
  const up = '#e11d48';
  const down = '#059669';
  const base = Number(preClose) || 0;
  const last =
    [...chartPrices].reverse().find((v) => v != null) ?? chartPrices[chartPrices.length - 1];
  const color = last >= base ? up : down;
  const mute = axisMute();

  // 右轴涨跌幅（相对昨收）
  const pcts = chartPrices.map((p) =>
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

  const defaultMark = base
    ? {
        symbol: 'none',
        label: { formatter: '昨收', color: mute, fontSize: 10 },
        lineStyle: { type: 'dashed', color: mute, width: 1 },
        data: [{ yAxis: base }],
      }
    : undefined;

  const interval = Math.max(1, Math.ceil(chartTimes.length / 5));

  chart.setOption({
    animationDuration: 280,
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
      { left: 48, right: 48, top: 20, bottom: '32%' },
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
        axisLabel: { color: mute, fontSize: 10, interval },
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
        name: '分时',
        type: 'line',
        data: chartPrices,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: true,
        smooth: 0.15,
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
        smooth: 0.15,
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

export function renderKlineChart(el, points, { markLine } = {}) {
  if (!el || !points?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  const dates = points.map((p) => p.date);
  const ohlc = points.map((p) => [p.open, p.close, p.low, p.high]);
  chart.setOption({
    animationDuration: 280,
    grid: { left: 48, right: 16, top: 24, bottom: 48 },
    tooltip: { trigger: 'axis' },
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
      textStyle: { color: mute, fontSize: 11 },
      data: legends,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: { color: mute, fontSize: 10, interval: Math.ceil(times.length / 5) },
      axisLine: { lineStyle: { color: splitLine() } },
    },
    yAxis: {
      type: 'value',
      name: '亿',
      nameTextStyle: { color: mute, fontSize: 10 },
      splitLine: { lineStyle: { color: splitLine() } },
      axisLabel: { color: mute, fontSize: 10 },
    },
    series: legends.map((name, i) => ({
      name,
      type: 'line',
      showSymbol: false,
      connectNulls: true,
      data: seriesData[i] ?? [],
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
      axisLabel: { color: mute, fontSize: 9, rotate: 40 },
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
      nameTextStyle: { color: mute, fontSize: 10 },
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
