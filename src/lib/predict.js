/**
 * 主力意图启发式：主力 vs 小单方向背离
 * 盘中优先看近 N 分钟净变化（累计线的差分），全日累计作对照，避免早盘定调后整天不更新。
 * @param {{
 *   main?: number,
 *   small?: number,
 *   huge?: number,
 *   large?: number,
 *   recentMain?: number,
 *   recentSmall?: number,
 *   recentMinutes?: number,
 * }} flowSummary
 */
export function analyzeMainForceIntent(flowSummary) {
  const dayMain = Number(flowSummary?.main ?? 0);
  const daySmall = Number(flowSummary?.small ?? 0);
  const hasRecent =
    flowSummary?.recentMain != null &&
    flowSummary?.recentSmall != null &&
    Number(flowSummary?.recentMinutes) > 0;
  const recentMain = hasRecent ? Number(flowSummary.recentMain) : dayMain;
  const recentSmall = hasRecent ? Number(flowSummary.recentSmall) : daySmall;
  const mins = hasRecent ? Number(flowSummary.recentMinutes) : 0;
  const threshold = hasRecent ? 0.08 : 0.05;

  const classify = (main, small, thr) => {
    const mainIn = main > thr;
    const mainOut = main < -thr;
    const smallIn = small > thr;
    const smallOut = small < -thr;
    if (mainIn && smallOut) {
      return { label: '真买', probability: 0.74, tag: '主力进、小单出' };
    }
    if (mainIn && smallIn) {
      return { label: '诱多', probability: 0.68, tag: '主力与小单同进' };
    }
    if (mainOut && smallIn) {
      return { label: '真卖', probability: 0.74, tag: '主力出、小单进' };
    }
    if (mainOut && smallOut) {
      return { label: '诱空', probability: 0.66, tag: '主力与小单同出' };
    }
    if (mainIn) {
      return { label: '真买', probability: 0.52, tag: '主力略进' };
    }
    if (mainOut) {
      return { label: '真卖', probability: 0.52, tag: '主力略出' };
    }
    return { label: '观望', probability: 0.42, tag: '流向不明显' };
  };

  const recent = classify(recentMain, recentSmall, threshold);
  const day = classify(dayMain, daySmall, 0.05);

  // 近窗有足够波动时，以近窗定调；否则退回全日
  const recentActive = hasRecent && (Math.abs(recentMain) >= threshold || Math.abs(recentSmall) >= threshold);
  const pick = recentActive ? recent : day;
  const scope = recentActive ? `近${mins}分钟` : '全天累计';

  const fmt = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  };

  let detail = `${scope}：${pick.tag}。`;
  if (recentActive) {
    detail += `近${mins}分主力 ${fmt(recentMain)} 亿、小单 ${fmt(recentSmall)} 亿；`;
    detail += `全天累计主力 ${fmt(dayMain)} 亿、小单 ${fmt(daySmall)} 亿。`;
    if (day.label !== pick.label) {
      detail += `全天口径偏「${day.label}」，近窗已转向「${pick.label}」。`;
    }
  } else {
    detail += `主力 ${fmt(dayMain)} 亿、小单 ${fmt(daySmall)} 亿。`;
    if (pick.label === '真买') detail += '筹码向主力集中，偏主动吸筹。';
    else if (pick.label === '真卖') detail += '抛压由主力主导，偏真实卖出。';
    else if (pick.label === '诱多') detail += '散户跟风明显，需防拉高派发。';
    else if (pick.label === '诱空') detail += '或刻意制造恐慌后反手。';
    else detail += '暂无法判断意图，宜观望。';
  }

  return {
    label: pick.label,
    probability: pick.probability,
    detail,
    scope,
    recentMain: hasRecent ? recentMain : null,
    recentSmall: hasRecent ? recentSmall : null,
  };
}
