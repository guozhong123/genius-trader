/**
 * 宏观事件日历（美东时间常见节奏，按 UTC+8 展示日）
 * 仅覆盖散户最该躲开的窗口：非农 / CPI / FOMC
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 某月第一个周五（非农常见日） */
function firstFriday(year, month0) {
  const d = new Date(year, month0, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}

function eventResult(dateStr, now = new Date()) {
  const today = ymd(now);
  if (dateStr < today) return '已公布，关注市场反应';
  return '待公布';
}

const IMPACT = {
  nfp: {
    tip: '非农就业数据公布窗口',
    impact:
      '影响美元、美债利率与全球风险偏好；若大幅好于预期，美元/利率易上行，成长股与纳指承压；差于预期则相反。A 股科技/赛道股隔夜情绪联动。',
  },
  cpi: {
    tip: '美国 CPI 通胀数据窗口',
    impact:
      '核心关注点：通胀是否降温。高于预期 → 加息/延迟降息预期升温，科技龙头、成长股易大跌；低于预期 → 宽松预期升温，纳指/半导体偏利好。黄金对利率预期敏感。',
  },
  fomc: {
    tip: '美联储利率决议 / 点阵图',
    impact:
      '直接定调美元流动性。偏鹰（更紧）利空估值高的科技与成长；偏鸽（更松）利好纳指、半导体、AI 主题。决议后 1–2 个交易日波动常放大。',
  },
};

/** 近年/当年已知 FOMC 决议日（可随年扩展） */
const FOMC_DATES = [
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-11-04',
  '2026-12-16',
  '2025-01-29',
  '2025-03-19',
  '2025-05-07',
  '2025-06-18',
  '2025-07-30',
  '2025-09-17',
  '2025-11-05',
  '2025-12-17',
];

/**
 * CPI：每月 10–15 日工作日关注窗（实际发布日常在此区间；滚动近三周会自然进出）
 */
function cpiWindowDays(year, month0) {
  const days = [];
  for (let day = 10; day <= 15; day += 1) {
    const d = new Date(year, month0, day);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days.push(d);
  }
  return days;
}

/**
 * 生成 [fromDate-lookback, fromDate+days] 区间事件
 */
export function getMacroEvents(fromDate = new Date(), days = 60, lookback = 3) {
  const anchor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const start = addDays(anchor, -lookback);
  const end = addDays(anchor, days);
  const events = [];

  for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const nfp = firstFriday(y, m);
      if (nfp >= start && nfp <= end) {
        const date = ymd(nfp);
        events.push({
          id: `nfp-${date}`,
          date,
          type: 'nfp',
          title: '美国非农就业',
          tip: IMPACT.nfp.tip,
          impact: IMPACT.nfp.impact,
          level: 'high',
          result: eventResult(date, anchor),
        });
      }
      for (const cpi of cpiWindowDays(y, m)) {
        if (cpi >= start && cpi <= end) {
          const date = ymd(cpi);
          events.push({
            id: `cpi-${date}`,
            date,
            type: 'cpi',
            title: '美国 CPI 关注日',
            tip: IMPACT.cpi.tip,
            impact: IMPACT.cpi.impact,
            level: 'high',
            result: eventResult(date, anchor),
          });
        }
      }
    }
  }

  for (const date of FOMC_DATES) {
    const d = new Date(date + 'T00:00:00');
    if (d >= start && d <= end) {
      events.push({
        id: `fomc-${date}`,
        date,
        type: 'fomc',
        title: '美联储 FOMC',
        tip: IMPACT.fomc.tip,
        impact: IMPACT.fomc.impact,
        level: 'high',
        result: eventResult(date, anchor),
      });
    }
  }

  const seen = new Set();
  return events
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getTodayEvents(now = new Date()) {
  const today = ymd(now);
  return getMacroEvents(now, 1, 0).filter((e) => e.date === today);
}

export function getUpcomingEvents(now = new Date(), withinDays = 14) {
  return getMacroEvents(now, withinDays, 2);
}

/** 近 N 天重大宏观日历（非农 / CPI / FOMC） */
export function getMajorUpcomingEvents(now = new Date(), withinDays = 21) {
  return getUpcomingEvents(now, withinDays).filter((e) => e.level === 'high');
}

export function isEventDay(now = new Date()) {
  return getTodayEvents(now).length > 0;
}
