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

/** 国务院放假安排。A股周末照常休市，调休上班日也不开市。 */
const ASHARE_HOLIDAYS = [
  { name: '元旦', start: '2025-01-01', end: '2025-01-01' },
  { name: '春节', start: '2025-01-28', end: '2025-02-04' },
  { name: '清明', start: '2025-04-04', end: '2025-04-06' },
  { name: '劳动节', start: '2025-05-01', end: '2025-05-05' },
  { name: '端午', start: '2025-05-31', end: '2025-06-02' },
  { name: '国庆', start: '2025-10-01', end: '2025-10-08' },
  { name: '元旦', start: '2026-01-01', end: '2026-01-03' },
  { name: '春节', start: '2026-02-15', end: '2026-02-23' },
  { name: '清明', start: '2026-04-04', end: '2026-04-06' },
  { name: '劳动节', start: '2026-05-01', end: '2026-05-05' },
  { name: '端午', start: '2026-06-19', end: '2026-06-21' },
  { name: '中秋', start: '2026-09-25', end: '2026-09-27' },
  { name: '国庆', start: '2026-10-01', end: '2026-10-07' },
  { name: '元旦', start: '2027-01-01', end: '2027-01-03' },
];

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function shYmdNow(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

function ymdAdd(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function ymdWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function holidayOn(dateStr) {
  return ASHARE_HOLIDAYS.find((h) => dateStr >= h.start && dateStr <= h.end) || null;
}

export function isAshareTradingDay(dateStr) {
  const w = ymdWeekday(dateStr);
  if (w === 0 || w === 6) return false;
  return !holidayOn(dateStr);
}

function nextTradingDay(dateStr) {
  let x = ymdAdd(dateStr, 1);
  for (let i = 0; i < 24; i += 1) {
    if (isAshareTradingDay(x)) return x;
    x = ymdAdd(x, 1);
  }
  return x;
}

function prevTradingDay(dateStr) {
  let x = ymdAdd(dateStr, -1);
  for (let i = 0; i < 24; i += 1) {
    if (isAshareTradingDay(x)) return x;
    x = ymdAdd(x, -1);
  }
  return x;
}

function holidaysBetween(from, to) {
  const names = [];
  for (const h of ASHARE_HOLIDAYS) {
    if (h.end >= from && h.start <= to && !names.includes(h.name)) names.push(h.name);
  }
  return names;
}

function dayGap(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function indexHit(indices, re) {
  return (indices || []).find((x) => re.test(`${x?.name || ''} ${x?.code || ''}`));
}

function riskOffLine(indices, center) {
  const nas = indexHit(indices, /纳斯达克|NDX/);
  const hsi = indexHit(indices, /恒生指数|HSI/);
  const nikkei = indexHit(indices, /日经|N225/);
  const kospi = indexHit(indices, /韩国|KOSPI|KS11/);
  const gold = indexHit(indices, /黄金|GC00Y/);
  const soft = [nas, hsi, nikkei, kospi].filter((x) => Number(x?.changePct) <= -0.8);
  const warm = [nas, hsi, nikkei, kospi].filter((x) => Number(x?.changePct) >= 0.8);
  const goldUp = Number(gold?.changePct) >= 0.5;
  const zd = center?.updown;
  const weakTape = zd && Number(zd.down) > Number(zd.up) * 1.25;
  const nb = Number(center?.northbound?.last);
  const outflow = Number.isFinite(nb) && nb <= -30;
  let score = 0;
  if (soft.length >= 2) score += 1;
  if (goldUp) score += 1;
  if (weakTape) score += 1;
  if (outflow) score += 1;
  const bits = [];
  if (soft.length) bits.push(`外盘下跌：${soft.map((x) => `${x.name}${Number(x.changePct).toFixed(2)}%`).join('、')}`);
  if (gold) bits.push(`黄金 ${Number(gold.changePct).toFixed(2)}%`);
  if (weakTape) bits.push(`两市涨${zd.up}跌${zd.down}`);
  if (outflow) bits.push(`北向 ${nb.toFixed(1)} 亿`);
  let label = '风险偏好中性';
  if (score >= 2) label = '避险偏强';
  else if (score === 1) label = '有一点避险，还没坐实';
  else if (warm.length >= 2 && !weakTape) label = '风险偏好偏暖';
  return `${label}。${bits.join('；') || '外盘、黄金、涨跌家数、北向没有一起指向避险。'} 避险要这几项一起出现才算，单涨黄金不够。`;
}

/**
 * 大盘分析用的日历与情绪。节前规律是历史倾向，不是今天必涨。
 */
export function marketCalendarFacts(now = new Date(), { indices, center } = {}) {
  const today = shYmdNow(now);
  const week = WEEK_CN[ymdWeekday(today)];
  const open = isAshareTradingDay(today);
  const nxt = nextTradingDay(open ? today : ymdAdd(today, -1));
  const anchor = open ? today : prevTradingDay(today);
  const upcoming = nextTradingDay(anchor);
  const gap = dayGap(anchor, upcoming);
  const between = holidaysBetween(ymdAdd(anchor, 1), ymdAdd(upcoming, -1));
  const longBreak = gap >= 3 && between.length > 0;
  const backGapNames = holidaysBetween(ymdAdd(prevTradingDay(today), 1), ymdAdd(today, -1));
  const firstBack = open && dayGap(prevTradingDay(today), today) >= 3 && backGapNames.length > 0;
  const month = Number(today.slice(5, 7));
  const dom = Number(today.slice(8, 10));
  const monthEnd = open && dom >= 25 && dayGap(today, nextTradingDay(today)) > 0 && Number(nextTradingDay(today).slice(5, 7)) !== month;
  const quarter = [3, 6, 9, 12].includes(month) && monthEnd;

  const lines = [`今天是${week}（${today}）。${open ? '大A开市。' : '大A休市。'}`];
  if (!open) {
    const h = holidayOn(today);
    if (h) lines.push(`今天在${h.name}假期里（${h.start} 至 ${h.end}）。`);
    lines.push(`下一开市日 ${upcoming}。`);
  } else if (longBreak) {
    lines.push(
      `今天是${between.join('、')}前最后一个交易日，下一开市 ${upcoming}，中间休 ${gap - 1} 天。`,
    );
    lines.push(
      '历史规律：长假前一天（尤其春节、国庆）大A更容易红盘或冲高，资金做节前行情；也有尾盘兑现。短假（清明、端午、中秋）弱一些。这是倾向，不是必涨。节前最后一天不宜新开隔夜重仓。',
    );
    if (week === '周五') lines.push('同时又是周五，周末再加长假，隔夜更要轻。');
  } else if (firstBack) {
    lines.push(`今天是${backGapNames.join('、')}后第一个交易日。`);
    lines.push('历史规律：节后第一天会一次性反映假期里的外盘。高开容易兑现，低开看是不是修复。缺口日波动大，不追高开。');
  } else if (week === '周五') {
    lines.push('周五：短线资金常减仓过周末，尾盘容易回落。主线很强才留，否则不过夜。');
  } else if (week === '周一') {
    lines.push('周一：先消化周末外盘。上午先看方向，不按周五的结论直接开仓。');
  } else {
    lines.push(`下一交易日 ${upcoming}。`);
  }
  if (monthEnd) lines.push(quarter ? '今天靠近季末，机构调仓，波动常放大。' : '今天靠近月末，注意机构调仓。');

  const soon = [];
  const seenEvt = new Set();
  for (const e of getMajorUpcomingEvents(now, 7)) {
    if (e.date < today || seenEvt.has(e.title)) continue;
    seenEvt.add(e.title);
    soon.push(`${e.date} ${e.title}`);
  }
  if (soon.length) lines.push(`近7日宏观：${soon.join('；')}。公布日前后少做隔夜。`);
  lines.push(riskOffLine(indices, center));

  const playbook =
    '常年对照（只作背景，和今天的涨跌家数冲突时以今天为准）：节前一天偏红但尾盘会兑现；节后第一天看缺口不追；周五减仓；周一看外盘；月末季末调仓。';
  return {
    headline: lines[0],
    lines,
    text: [...lines, playbook].join('\n'),
  };
}
