/**
 * 支撑/压力：用近期 K 线高低点估算；可被用户手动价覆盖
 */

export function calcAutoLevels(points, lookback = 20) {
  if (!points?.length) return { support: null, resistance: null };
  const slice = points.slice(-lookback);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of slice) {
    const low = Number(p.low ?? p.price);
    const high = Number(p.high ?? p.price);
    if (Number.isFinite(low)) lo = Math.min(lo, low);
    if (Number.isFinite(high)) hi = Math.max(hi, high);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
    return { support: null, resistance: null };
  }
  return {
    support: +lo.toFixed(3),
    resistance: +hi.toFixed(3),
  };
}

/** 合并用户设置与自动估算 */
export function resolveLevels(item, auto = {}) {
  const support =
    item?.support != null && item.support !== ''
      ? Number(item.support)
      : auto.support ?? null;
  const resistance =
    item?.resistance != null && item.resistance !== ''
      ? Number(item.resistance)
      : auto.resistance ?? null;
  return {
    support: Number.isFinite(support) ? support : null,
    resistance: Number.isFinite(resistance) ? resistance : null,
  };
}

/**
 * 止损检查
 * @returns {{ hit: boolean, kind: 'stop'|'near'|null, price, stopLoss, pctToStop }}
 */
export function checkStopLoss(item, quote) {
  const stop = Number(item?.stopLoss);
  const price = Number(quote?.price);
  if (!Number.isFinite(stop) || stop <= 0 || !Number.isFinite(price) || price <= 0) {
    return { hit: false, kind: null, price, stopLoss: stop, pctToStop: null };
  }
  const pctToStop = ((price - stop) / price) * 100;
  if (price <= stop) {
    return { hit: true, kind: 'stop', price, stopLoss: stop, pctToStop };
  }
  // 距止损 1.5% 内预警
  if (pctToStop <= 1.5) {
    return { hit: true, kind: 'near', price, stopLoss: stop, pctToStop };
  }
  return { hit: false, kind: null, price, stopLoss: stop, pctToStop };
}

export function buildLevelMarkLines({ support, resistance, stopLoss, preClose }) {
  const mute = '#94a3b8';
  const data = [];
  if (preClose != null && Number.isFinite(Number(preClose))) {
    data.push({
      yAxis: Number(preClose),
      name: '昨收',
      lineStyle: { type: 'dashed', color: mute, width: 1 },
      label: { formatter: '昨收', color: mute, fontSize: 10 },
    });
  }
  if (support != null) {
    data.push({
      yAxis: support,
      name: '支撑',
      lineStyle: { type: 'solid', color: '#059669', width: 1.2 },
      label: { formatter: '支撑', color: '#059669', fontSize: 10 },
    });
  }
  if (resistance != null) {
    data.push({
      yAxis: resistance,
      name: '压力',
      lineStyle: { type: 'solid', color: '#e11d48', width: 1.2 },
      label: { formatter: '压力', color: '#e11d48', fontSize: 10 },
    });
  }
  if (stopLoss != null && Number.isFinite(Number(stopLoss))) {
    data.push({
      yAxis: Number(stopLoss),
      name: '止损',
      lineStyle: { type: 'dashed', color: '#f59e0b', width: 1.4 },
      label: { formatter: '止损', color: '#f59e0b', fontSize: 10 },
    });
  }
  if (!data.length) return undefined;
  return {
    symbol: 'none',
    data,
  };
}
