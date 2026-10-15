/**
 * 主力意图启发式：主力 vs 小单方向背离
 * @param {{ main?: number, small?: number, huge?: number, large?: number }} flowSummary
 */
export function analyzeMainForceIntent(flowSummary) {
  const main = Number(flowSummary?.main ?? 0);
  const small = Number(flowSummary?.small ?? 0);
  const threshold = 0.05;

  const mainIn = main > threshold;
  const mainOut = main < -threshold;
  const smallIn = small > threshold;
  const smallOut = small < -threshold;

  if (mainIn && smallOut) {
    return {
      label: '真买',
      probability: 0.74,
      detail: '主力净流入、小单净流出，筹码向主力集中，偏主动吸筹。',
    };
  }
  if (mainIn && smallIn) {
    return {
      label: '诱多',
      probability: 0.68,
      detail: '主力与小单同向净流入，散户跟风明显，需防拉高派发。',
    };
  }
  if (mainOut && smallIn) {
    return {
      label: '真卖',
      probability: 0.74,
      detail: '主力净流出、小单净流入，抛压由主力主导，偏真实卖出。',
    };
  }
  if (mainOut && smallOut) {
    return {
      label: '诱空',
      probability: 0.66,
      detail: '主力与小单同向净流出，或刻意制造恐慌后反手。',
    };
  }

  if (mainIn) {
    return {
      label: '真买',
      probability: 0.52,
      detail: '主力略偏净流入，小单方向中性，信号一般。',
    };
  }
  if (mainOut) {
    return {
      label: '真卖',
      probability: 0.52,
      detail: '主力略偏净流出，小单方向中性，宜谨慎。',
    };
  }

  return {
    label: '诱多',
    probability: 0.42,
    detail: '主力流向不明显，暂无法判断意图，宜观望。',
  };
}
