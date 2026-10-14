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

/**
 * 美国 CPI：常见为每月中旬（约 10–15 日）工作日发布。
 * 这里用「该月 11–13 日中第一个工作日」作近似提示日（非官方精确日）。
 */
function approxCpiDay(year, month0) {
  for (let day = 11; day <= 15; day += 1) {
    const d = new Date(year, month0, day);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) return d;
  }
  return new Date(year, month0, 13);
}

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
 * 生成从 today 起未来 days 天内的事件
 */
export function getMacroEvents(fromDate = new Date(), days = 60) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = addDays(start, days);
  const events = [];

  for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const nfp = firstFriday(y, m);
      const cpi = approxCpiDay(y, m);
      if (nfp >= start && nfp <= end) {
        events.push({
          id: `nfp-${ymd(nfp)}`,
          date: ymd(nfp),
          type: 'nfp',
          title: '美国非农就业',
          tip: '就业数据窗口，波动大，宜减仓或观望',
          level: 'high',
        });
      }
      if (cpi >= start && cpi <= end) {
        events.push({
          id: `cpi-${ymd(cpi)}`,
          date: ymd(cpi),
          type: 'cpi',
          title: '美国 CPI（约）',
          tip: '通胀数据窗口（近似日期，请以官网为准），科技/利率敏感',
          level: 'high',
        });
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
        tip: '利率决议日，隔夜波动剧烈',
        level: 'high',
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
  return getMacroEvents(now, 1).filter((e) => e.date === today);
}

export function getUpcomingEvents(now = new Date(), withinDays = 14) {
  return getMacroEvents(now, withinDays);
}

export function isEventDay(now = new Date()) {
  return getTodayEvents(now).length > 0;
}
