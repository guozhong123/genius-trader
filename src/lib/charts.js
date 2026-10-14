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

export function renderIntradayChart(el, { times, prices, avgs, preClose, markLine }) {
  if (!el) return;
  const chart = getChart(el);
  const up = '#e11d48';
  const down = '#059669';
  const last = prices[prices.length - 1];
  const color = last >= preClose ? up : down;
  const mute = axisMute();
  const defaultMark = preClose
    ? {
        symbol: 'none',
        label: { formatter: '昨收', color: mute, fontSize: 10 },
        lineStyle: { type: 'dashed', color: mute, width: 1 },
        data: [{ yAxis: preClose }],
      }
    : undefined;

  chart.setOption({
    animationDuration: 280,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (v == null ? '—' : Number(v).toFixed(2)),
    },
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: { color: mute, fontSize: 10, interval: Math.ceil(times.length / 5) },
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
        name: '分时',
        type: 'line',
        data: prices,
        showSymbol: false,
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
        data: avgs,
        showSymbol: false,
        smooth: 0.15,
        lineStyle: { width: 1.2, color: '#f59e0b', opacity: 0.85 },
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

export function renderFlowChart(el, flow) {
  if (!el || !flow?.times?.length) return;
  const chart = getChart(el);
  const mute = axisMute();
  chart.setOption({
    animationDuration: 280,
    legend: {
      top: 0,
      textStyle: { color: mute, fontSize: 11 },
      data: ['主力', '超大单', '大单', '中单', '小单'],
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: flow.times,
      boundaryGap: false,
      axisLabel: { color: mute, fontSize: 10, interval: Math.ceil(flow.times.length / 5) },
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
      { name: '主力', type: 'line', showSymbol: false, data: flow.main, lineStyle: { width: 2.2, color: '#e11d48' } },
      { name: '超大单', type: 'line', showSymbol: false, data: flow.huge, lineStyle: { width: 1.2, color: '#f97316' } },
      { name: '大单', type: 'line', showSymbol: false, data: flow.large, lineStyle: { width: 1.2, color: '#0f766e' } },
      { name: '中单', type: 'line', showSymbol: false, data: flow.mid, lineStyle: { width: 1.2, color: '#0ea5e9' } },
      { name: '小单', type: 'line', showSymbol: false, data: flow.small, lineStyle: { width: 1.2, color: '#059669' } },
    ],
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
