/**
 * 个股当前价位高低判断（相对今日高低点；无则相对昨收）
 * @returns {{ label: '偏高'|'偏低'|'中性'|null, score: number|null, tip: string }}
 */
export function calcValuationBias(quote) {
  const price = Number(quote?.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { label: null, score: null, tip: '' };
  }
  const high = Number(quote?.high);
  const low = Number(quote?.low);
  const prev = Number(quote?.prevClose);

  if (Number.isFinite(high) && Number.isFinite(low) && high > low) {
    const score = (price - low) / (high - low);
    if (score >= 0.72) {
      return {
        label: '偏高',
        score,
        tip: `相对今日高低点偏上区（${(score * 100).toFixed(0)}%）`,
      };
    }
    if (score <= 0.28) {
      return {
        label: '偏低',
        score,
        tip: `相对今日高低点偏下区（${(score * 100).toFixed(0)}%）`,
      };
    }
    return {
      label: '中性',
      score,
      tip: `相对今日高低点居中（${(score * 100).toFixed(0)}%）`,
    };
  }

  if (Number.isFinite(prev) && prev > 0) {
    const pct = ((price - prev) / prev) * 100;
    if (pct >= 3) return { label: '偏高', score: null, tip: `相对昨收 +${pct.toFixed(2)}%` };
    if (pct <= -3) return { label: '偏低', score: null, tip: `相对昨收 ${pct.toFixed(2)}%` };
    return { label: '中性', score: null, tip: `相对昨收 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` };
  }

  return { label: null, score: null, tip: '' };
}
