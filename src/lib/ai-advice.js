import { analyzeMainForceIntent } from './predict.js';

/**
 * 个股启发式 AI 分析：历史走势 + 主力资金 + 新闻情绪 + 大盘环境
 * 仅供参考，不构成投资建议。
 */

function pctChange(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

function closesFromKline(points) {
  return (points || [])
    .map((p) => Number(p.close ?? p.price))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function sma(arr, n) {
  if (!arr?.length || arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function scoreHistory(dayPoints) {
  const closes = closesFromKline(dayPoints);
  const reasons = [];
  let score = 0;
  if (closes.length < 3) {
    return { score: 0, reasons: ['历史K线不足，技术面参考有限'] };
  }
  const last = closes[closes.length - 1];
  const d1 = pctChange(closes[closes.length - 2], last);
  const d5 = closes.length >= 6 ? pctChange(closes[closes.length - 6], last) : null;
  const d20 = closes.length >= 21 ? pctChange(closes[closes.length - 21], last) : null;
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, Math.min(20, closes.length));

  if (d1 != null) {
    if (d1 > 1.5) {
      score += 1.2;
      reasons.push(`近1日偏强（${d1.toFixed(2)}%）`);
    } else if (d1 < -1.5) {
      score -= 1.2;
      reasons.push(`近1日偏弱（${d1.toFixed(2)}%）`);
    } else {
      reasons.push(`近1日震荡（${d1.toFixed(2)}%）`);
    }
  }
  if (d5 != null) {
    if (d5 > 3) {
      score += 1.5;
      reasons.push(`近5日上涨 ${d5.toFixed(2)}%`);
    } else if (d5 < -3) {
      score -= 1.5;
      reasons.push(`近5日下跌 ${d5.toFixed(2)}%`);
    }
  }
  if (d20 != null) {
    if (d20 > 5) {
      score += 1;
      reasons.push(`近20日趋势向上（${d20.toFixed(2)}%）`);
    } else if (d20 < -5) {
      score -= 1;
      reasons.push(`近20日趋势偏弱（${d20.toFixed(2)}%）`);
    }
  }
  if (ma5 != null && ma20 != null) {
    if (last > ma5 && ma5 > ma20) {
      score += 1.4;
      reasons.push('价格站上短均线，均线多头排列');
    } else if (last < ma5 && ma5 < ma20) {
      score -= 1.4;
      reasons.push('价格跌破短均线，均线空头排列');
    } else {
      reasons.push('均线交织，方向待确认');
    }
  }
  return { score, reasons, d1, d5, d20 };
}

function scoreFlow(flowSummary) {
  const intent = analyzeMainForceIntent(flowSummary || {});
  const main = Number(flowSummary?.main ?? 0);
  const reasons = [];
  let score = 0;
  if (intent.label === '真买') {
    score += 2.2;
    reasons.push(`主力意图偏「真买」（置信约 ${(intent.probability * 100).toFixed(0)}%）：${intent.detail}`);
  } else if (intent.label === '诱多') {
    score -= 0.6;
    reasons.push(`主力意图偏「诱多」：${intent.detail}`);
  } else if (intent.label === '真卖') {
    score -= 2.2;
    reasons.push(`主力意图偏「真卖」：${intent.detail}`);
  } else if (intent.label === '诱空') {
    score += 0.4;
    reasons.push(`主力意图偏「诱空」：${intent.detail}`);
  }
  if (main > 0.3) {
    score += 0.8;
    reasons.push(`主力净流入约 ${main.toFixed(2)} 亿`);
  } else if (main < -0.3) {
    score -= 0.8;
    reasons.push(`主力净流出约 ${Math.abs(main).toFixed(2)} 亿`);
  }
  return { score, reasons, intent };
}

function scoreNews(newsList) {
  const list = newsList || [];
  let score = 0;
  const hits = [];
  for (const n of list.slice(0, 12)) {
    const title = String(n.title || '');
    const tone = n.tone || 'neutral';
    if (tone === 'up' || /利好|降息|超预期|突破|大涨|流入/.test(title)) {
      score += 0.45;
      hits.push(title.slice(0, 28));
    } else if (tone === 'down' || /利空|加息|不及|暴跌|流出|制裁|关税/.test(title)) {
      score -= 0.45;
      hits.push(title.slice(0, 28));
    }
  }
  const reasons = [];
  if (!list.length) reasons.push('暂无可用新闻，情绪面中性');
  else if (score > 0.6) reasons.push(`消息面偏暖：${hits.slice(0, 2).join('；')}`);
  else if (score < -0.6) reasons.push(`消息面偏冷：${hits.slice(0, 2).join('；')}`);
  else reasons.push('近期宏观/科技消息情绪中性');
  return { score: Math.max(-2, Math.min(2, score)), reasons };
}

function scoreMarket(indices) {
  const rows = (indices || []).filter((x) => Number.isFinite(Number(x.changePct)));
  if (!rows.length) {
    return { score: 0, reasons: ['大盘数据暂缺'], avgPct: null, label: '未知' };
  }
  const avg = rows.reduce((a, b) => a + Number(b.changePct), 0) / rows.length;
  const up = rows.filter((x) => x.changePct > 0).length;
  const reasons = [];
  let score = 0;
  if (avg > 0.6) {
    score += 1.5;
    reasons.push(`大盘偏强，样本均涨 ${avg.toFixed(2)}%（上涨 ${up}/${rows.length}）`);
  } else if (avg < -0.6) {
    score -= 1.5;
    reasons.push(`大盘偏弱，样本均跌 ${avg.toFixed(2)}%（上涨 ${up}/${rows.length}）`);
  } else {
    reasons.push(`大盘震荡，样本均涨跌 ${avg.toFixed(2)}%`);
  }
  const tops = [...rows]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
    .map((x) => `${x.name || x.code} ${x.changePct > 0 ? '+' : ''}${Number(x.changePct).toFixed(2)}%`);
  if (tops.length) reasons.push(`关注指数：${tops.join('，')}`);
  const label = avg > 0.6 ? '偏多' : avg < -0.6 ? '偏空' : '中性';
  return { score, reasons, avgPct: avg, label };
}

function toAdvice(score, horizon) {
  // score 大致落在 -8 ~ +8
  let action = '观望';
  let tip = '';
  if (score >= 3.2) {
    action = '买入';
    tip = horizon === 'day' ? '短线动能与资金偏顺，可轻仓试多，设好止损。' : '一周维度趋势与资金共振偏多，宜分批、控制仓位。';
  } else if (score >= 1.2) {
    action = '谨慎买入';
    tip = horizon === 'day' ? '信号略偏多但不够强，宁可少买、快进快出。' : '周线略偏多，适合观察确认后再加仓。';
  } else if (score <= -3.2) {
    action = '减仓/回避';
    tip = horizon === 'day' ? '短线抛压或大盘拖累明显，不宜追高。' : '一周偏弱信号较多，优先防守、控制回撤。';
  } else if (score <= -1.2) {
    action = '观望偏空';
    tip = horizon === 'day' ? '多空胶着偏弱，等待更清晰的资金或反弹信号。' : '周线偏弱，反弹宜减不宜追。';
  } else {
    action = '观望';
    tip = '多空力量接近，建议等待方向确认后再动手。';
  }
  const confidence = Math.min(0.88, 0.42 + Math.abs(score) * 0.06);
  return { action, tip, confidence, score: +score.toFixed(2) };
}

/**
 * @param {{
 *   name?: string,
 *   dayK?: { points?: any[] },
 *   flow?: { summary?: object },
 *   news?: any[],
 *   indices?: any[],
 *   quote?: { changePct?: number, price?: number }
 * }} input
 */
export function buildStockAiAdvice(input) {
  const name = input?.name || '该股';
  const hist = scoreHistory(input?.dayK?.points || input?.dayPoints || []);
  const flow = scoreFlow(input?.flow?.summary || input?.flowSummary);
  const news = scoreNews(input?.news);
  const market = scoreMarket(input?.indices);

  const quotePct = Number(input?.quote?.changePct);
  let quoteAdj = 0;
  const quoteReasons = [];
  if (Number.isFinite(quotePct)) {
    if (quotePct > 3) {
      quoteAdj -= 0.4;
      quoteReasons.push(`今日已大涨 ${quotePct.toFixed(2)}%，追高风险上升`);
    } else if (quotePct < -3) {
      quoteAdj += 0.2;
      quoteReasons.push(`今日跌幅较大（${quotePct.toFixed(2)}%），短线或有技术反抽，仍需看资金`);
    }
  }

  // 次日更看资金+当日动能；一周更看趋势+大盘
  const dayScore = hist.score * 0.35 + flow.score * 0.4 + news.score * 0.1 + market.score * 0.15 + quoteAdj;
  const weekScore = hist.score * 0.45 + flow.score * 0.25 + news.score * 0.15 + market.score * 0.15;

  const day = toAdvice(dayScore, 'day');
  const week = toAdvice(weekScore, 'week');

  const bullets = [
    ...hist.reasons.slice(0, 3),
    ...flow.reasons.slice(0, 2),
    ...news.reasons.slice(0, 1),
    ...market.reasons.slice(0, 2),
    ...quoteReasons,
  ].slice(0, 8);

  return {
    name,
    marketView: {
      label: market.label,
      avgPct: market.avgPct,
      text: market.reasons.join('；'),
    },
    day,
    week,
    bullets,
    disclaimer: '以上为基于历史行情、主力资金与公开消息的启发式分析，仅供参考，不构成投资建议。股市有风险，决策请自负。',
    generatedAt: Date.now(),
  };
}
