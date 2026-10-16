/**
 * 顺势：外盘映射、主线连续性、短线情绪、板块资金、龙虎榜、报告对照。
 * 都是公开数据的粗判，外盘只是线索。
 */

/** 美股/韩股主题 → 大A板块名（与盘况里的东财板块同名） */
export const OVERNIGHT_LINKS = [
  { from: '存储', to: ['存储芯片'] },
  { from: '半导体', to: ['半导体', '存储芯片'] },
  { from: 'AI算力', to: ['算力', 'AI芯片'] },
  { from: 'CPO', to: ['CPO', '光通信模块'] },
  { from: '纳指ETF', to: ['人工智能', '半导体'] },
  { from: '数据中心', to: ['数据中心'] },
  { from: '云计算', to: ['云计算'] },
  { from: '商业航天', to: ['商业航天'] },
  { from: '卫星', to: ['卫星互联网'] },
  { from: '机器人', to: ['机器人', '人形机器人'] },
  { from: '自动驾驶', to: ['自动驾驶'] },
  { from: '电网', to: ['电网设备', '智能电网'] },
  { from: '军工', to: ['军工'] },
  { from: '光伏', to: ['光伏概念'] },
  { from: '锂电池', to: ['锂电池'] },
  { from: '电池', to: ['锂电池'] },
  { from: '油气', to: ['油气'] },
  { from: '铜有色', to: ['有色金属'] },
  { from: '黄金矿业', to: ['黄金'] },
  { from: '银行金融', to: ['银行'] },
  { from: '生物医药', to: ['生物医药'] },
  { from: '生物', to: ['生物医药'] },
  { from: '稀土', to: ['稀土永磁'] },
  { from: '通信设备', to: ['通信设备'] },
  { from: 'AI应用', to: ['人工智能'] },
];

function shParts(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? 0 : parts.hour);
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hm: `${String(hour).padStart(2, '0')}:${parts.minute}`,
    weekday: parts.weekday,
    mins: hour * 60 + Number(parts.minute),
  };
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function holidayBlocks(ymd) {
  return [
    ['2025-01-01', '2025-01-01'],
    ['2025-01-28', '2025-02-04'],
    ['2025-04-04', '2025-04-06'],
    ['2025-05-01', '2025-05-05'],
    ['2025-05-31', '2025-06-02'],
    ['2025-10-01', '2025-10-08'],
    ['2026-01-01', '2026-01-03'],
    ['2026-02-15', '2026-02-23'],
    ['2026-04-04', '2026-04-06'],
    ['2026-05-01', '2026-05-05'],
    ['2026-06-19', '2026-06-21'],
    ['2026-09-25', '2026-09-27'],
    ['2026-10-01', '2026-10-07'],
    ['2027-01-01', '2027-01-03'],
  ].some(([a, b]) => ymd >= a && ymd <= b);
}

/** 大A下一交易日。收盘后和周末都往后推，不含节假日。 */
export function nextAshareDate(now = new Date()) {
  const sh = shParts(now);
  let ymd = sh.ymd;
  const closed = sh.weekday === 'Sat' || sh.weekday === 'Sun' || sh.mins >= 15 * 60;
  if (closed) ymd = addDays(ymd, 1);
  while (weekdayOf(ymd) === 0 || weekdayOf(ymd) === 6 || holidayBlocks(ymd)) ymd = addDays(ymd, 1);
  return ymd;
}

export function marketClock(now = new Date()) {
  const sh = shParts(now);
  const et = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(now)
    .replace(',', '');
  const next = nextAshareDate(now);
  return {
    beijing: `${sh.ymd} ${sh.hm}`,
    today: sh.ymd,
    eastern: et,
    next,
    line: `北京时间 ${sh.ymd} ${sh.hm}。大A下一交易日 ${next}。美股这一时段的美东时间 ${et}。说「明天」「隔夜」「下一交易日」时都用这些日期。`,
  };
}

export function shYmd(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ts);
}

/** 每个交易日三档。到点之后打开页面，只补当前这一档。 */
export const SESSION_SLOTS = [
  { id: 'open', label: '开盘', start: 9 * 60 + 25 },
  { id: 'mid', label: '盘中', start: 13 * 60 },
  { id: 'close', label: '尾盘', start: 14 * 60 + 40 },
];

export function tradingSlot(now = new Date()) {
  const sh = shParts(now);
  if (sh.weekday === 'Sat' || sh.weekday === 'Sun') return null;
  let current = null;
  for (const slot of SESSION_SLOTS) {
    if (sh.mins >= slot.start) current = slot;
  }
  if (!current) return null;
  return { id: current.id, label: current.label, day: sh.ymd };
}

export function moodLabel(sentiment) {
  if (!sentiment) return '';
  const { height, zbRate, premium, promoRate } = sentiment;
  const zb = Number(zbRate);
  const prem = Number(premium);
  const promo = Number(promoRate);
  if ((Number.isFinite(prem) && prem <= -1) || (Number.isFinite(zb) && zb >= 0.4) || (height <= 2 && promo < 0.2)) {
    return '退潮';
  }
  if (height >= 4 && promo >= 0.25 && prem >= 0 && zb < 0.3) return '主升';
  if (prem >= -0.3 || promo >= 0.18) return '修复';
  return '退潮';
}

export function klineWindow(points, today) {
  const rows = points || [];
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const lastDay = String(last?.date || '').slice(0, 10);
  const usePrev = lastDay === today ? prev : last;
  const slice = rows.slice(-5);
  const sum5 = slice.reduce((s, row) => s + (Number(row.changePct) || 0), 0);
  const upDays = slice.filter((row) => Number(row.changePct) > 0).length;
  return {
    prev: Number(usePrev?.changePct),
    sum5,
    upDays,
    days: slice.length,
  };
}

function overnightTag(overseas, todayPct, prev, sum5) {
  const today = Number(todayPct);
  const hot = today >= 3 || (Number(prev) >= 3 && today >= 1) || Number(sum5) >= 8;
  if (hot) return '不宜再追';
  if (overseas >= 1 && today <= 0.6) return '还没动';
  if (overseas >= 1) return '还可看';
  return '';
}

export function buildOvernight(usBoards, krBoards, cnByName, klines, today) {
  const abroad = [...(usBoards || []), ...(krBoards || [])].filter((b) => Number.isFinite(Number(b.changePct)));
  const ranked = [...abroad].sort((a, b) => Number(b.changePct) - Number(a.changePct));
  let strong = ranked.filter((b) => Number(b.changePct) >= 1);
  if (!strong.length) strong = ranked.filter((b) => Number(b.changePct) >= 0.4).slice(0, 3);
  const rows = [];
  const seen = new Set();
  for (const board of strong) {
    const link = OVERNIGHT_LINKS.find((item) => item.from === board.name);
    if (!link || seen.has(board.name)) continue;
    seen.add(board.name);
    const targets = link.to
      .map((name) => {
        const cn = cnByName.get(name);
        if (!cn) return null;
        const win = klineWindow(klines.get(cn.code), today);
        const tag = overnightTag(Number(board.changePct), cn.changePct, win.prev, win.sum5);
        return { name, changePct: Number(cn.changePct), prev: win.prev, sum5: win.sum5, tag };
      })
      .filter(Boolean);
    if (!targets.length) continue;
    rows.push({
      from: board.name,
      overseas: Number(board.changePct),
      targets,
    });
    if (rows.length >= 4) break;
  }
  return rows;
}

export function scoreMainLines(flows, klines, leaders, today) {
  const merged = new Map();
  for (const row of [...(flows.industry || []), ...(flows.concept || [])]) {
    if (!row?.code || merged.has(row.code)) continue;
    merged.set(row.code, row);
  }
  const scored = [...merged.values()].map((row) => {
    const win = klineWindow(klines.get(row.code), today);
    const todayPct = Number(row.changePct);
    const flow = Number(row.mainFlow);
    let tag = '观察';
    if ((win.sum5 >= 8 || (win.upDays >= 4 && todayPct >= 2)) && todayPct >= 0) tag = '不宜再追';
    else if (flow > 0 && win.upDays >= 3 && todayPct > -1) tag = '还在进';
    else if (win.upDays <= 1 && todayPct >= 2) tag = '一日游';
    else if (flow > 0 && todayPct <= -1) tag = '价已走弱';
    else if (flow <= -15 && todayPct < -1) tag = '资金在撤';
    else if (flow > 0) tag = '有资金';
    return {
      ...row,
      upDays: win.upDays,
      sum5: win.sum5,
      known: win.days > 0,
      tag,
      leader: leaders.get(row.code)?.name || '',
      leaderPct: leaders.get(row.code)?.changePct,
    };
  });
  const order = { 还在进: 0, 价已走弱: 1, 不宜再追: 2, 一日游: 3, 资金在撤: 4, 有资金: 5, 观察: 6 };
  scored.sort((a, b) => (order[a.tag] ?? 9) - (order[b.tag] ?? 9) || Number(b.mainFlow) - Number(a.mainFlow));
  const picked = [];
  for (const tag of ['还在进', '价已走弱', '不宜再追', '一日游', '资金在撤']) {
    const cap = tag === '还在进' ? 3 : 2;
    const rows = scored.filter((row) => row.tag === tag);
    if (tag === '资金在撤') rows.sort((a, b) => Number(a.mainFlow) - Number(b.mainFlow));
    picked.push(...rows.slice(0, cap));
  }
  return picked;
}

export function planText({ tapeWeak, mood, overnight, mains }) {
  const parts = [];
  if (tapeWeak || mood === '退潮') parts.push('今天少做。跌家占优或情绪在退潮时，外盘涨了也不当买点。');
  else if (mood === '主升') parts.push('情绪偏主升，只做资金还在进、又没有连续大涨的方向。');
  else parts.push('情绪在修复，只做最强的那一段，不扩成全面做多。');
  const watch = [];
  const chase = [];
  for (const row of overnight || []) {
    for (const target of row.targets) {
      if (target.tag === '不宜再追') chase.push(target.name);
      else if (target.tag) watch.push(target.name);
    }
  }
  const uniq = (list) => [...new Set(list)];
  if (watch.length) parts.push(`外盘对应、A股还没涨透：${uniq(watch).slice(0, 3).join('、')}。`);
  if (chase.length) parts.push(`外盘强但A股已经大涨，不宜再追：${uniq(chase).slice(0, 3).join('、')}。`);
  const live = (mains || []).filter((row) => row.tag === '还在进');
  if (live.length) {
    parts.push(
      `主线还在：${live
        .map((row) => (row.leader ? `${row.name}（${row.leader}）` : row.name))
        .join('、')}。`,
    );
  }
  return parts.join('');
}

function verdict(action, pct) {
  if (action === '买入') {
    if (pct >= 1) return '跟上了';
    if (pct <= -1) return '回落';
    return '差不多';
  }
  if (action === '不买') {
    if (pct >= 3) return '大涨了';
    if (pct <= 0) return '避开了';
    return '小涨';
  }
  if (pct >= 2) return '等的时候涨了';
  if (pct <= -2) return '等对了';
  return '震荡';
}

/** changes: itemKey -> 今日涨跌幅。只对今天之前最近一天的个股报告。 */
export function reviewCalls(history, changes) {
  const today = shYmd();
  const byDay = new Map();
  for (const report of history || []) {
    if (!report || report.kind === 'market' || !report.itemKey || !report.generatedAt) continue;
    const day = shYmd(report.generatedAt);
    if (day >= today) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(report);
  }
  const day = [...byDay.keys()].sort().pop();
  if (!day) {
    return { day: '', rows: [], summary: '还没有更早的个股报告。点过 AI 之后，下一个交易日会在这里对一下。' };
  }
  const latest = new Map();
  for (const report of byDay.get(day)) {
    const prev = latest.get(report.itemKey);
    if (!prev || report.generatedAt > prev.generatedAt) latest.set(report.itemKey, report);
  }
  const rows = [];
  for (const report of latest.values()) {
    const pct = Number(changes?.[report.itemKey]);
    if (!Number.isFinite(pct)) continue;
    rows.push({
      name: report.title || report.code || report.itemKey,
      action: report.action || '',
      changePct: pct,
      verdict: verdict(report.action, pct),
    });
  }
  if (!rows.length) {
    return { day, rows, summary: `${day} 有报告，但这批股票今天还没有行情，对不上。` };
  }
  const avg = (list) => (list.length ? list.reduce((s, row) => s + row.changePct, 0) / list.length : null);
  const buys = rows.filter((row) => row.action === '买入');
  const avoids = rows.filter((row) => row.action === '不买');
  const bits = [`${day} 的报告，今天对一下。`];
  if (buys.length) {
    bits.push(
      `当时买入 ${buys.length} 只，今天平均 ${avg(buys).toFixed(2)}%，跟上 ${buys.filter((r) => r.verdict === '跟上了').length}，回落 ${buys.filter((r) => r.verdict === '回落').length}。`,
    );
  }
  if (avoids.length) {
    bits.push(
      `当时不买 ${avoids.length} 只，避开 ${avoids.filter((r) => r.verdict === '避开了').length}，大涨漏过 ${avoids.filter((r) => r.verdict === '大涨了').length}。`,
    );
  }
  if (!buys.length && !avoids.length) bits.push(`当时以继续等为主，共 ${rows.length} 只。`);
  return { day, rows: rows.slice(0, 8), summary: bits.join('') };
}

/** 期货席位增减的粗读。多空一起加，不当成单边看多。 */
export function seatStance(longAdd, shortAdd) {
  const L = Number.isFinite(Number(longAdd)) ? Number(longAdd) : 0;
  const S = Number.isFinite(Number(shortAdd)) ? Number(shortAdd) : 0;
  const bothUp = L >= 400 && S >= 400;
  if (bothUp && Math.min(L, S) >= Math.max(L, S) * 0.45) return '多空一起加，像对冲';
  if (bothUp && L > S) return '多单加得更多';
  if (bothUp) return '空单加得更多';
  if (L >= 400 && S <= 80) return '偏多';
  if (S >= 400 && L <= 80) return '偏空';
  if (L <= -400 && S <= -400) return '多空都在减';
  if (L <= -400) return '多单在减';
  if (S <= -400) return '空单在减';
  return '变化不大';
}

export function futuresBrief(seats) {
  const rows = [...(seats?.indexRows || []), ...(seats?.commodityRows || [])].slice(0, 8);
  if (!rows.length) return '';
  const line = rows
    .map(
      (row) =>
        `${row.house}${row.client ? '代客' : ''} ${row.productName} ${row.contract} 多${row.longAdd ?? '—'} 空${row.shortAdd ?? '—'} ${row.stance}`,
    )
    .join('；');
  return `期货席位（${seats.date} 收盘，手）：${line}。`;
}

export function sheetBrief({ tapeWeak, mood, overnight, mains, sentiment, flows, seats }) {
  const industry = (flows?.themes || flows?.industry || [])
    .filter((row) => Number(row.mainFlow) > 0)
    .slice(0, 4)
    .map((row) => `${row.name}主力${Number(row.mainFlow).toFixed(1)}亿`)
    .join('，');
  return [
    planText({ tapeWeak, mood, overnight, mains }),
    sentiment
      ? `情绪${mood || '—'}，高度${sentiment.height || 0}板，炸板率${sentiment.zbRate == null ? '—' : `${Math.round(sentiment.zbRate * 100)}%`}，昨涨停溢价${sentiment.premium == null ? '—' : sentiment.premium.toFixed(2)}%，首板晋级${sentiment.promoRate == null ? '—' : `${Math.round(sentiment.promoRate * 100)}%`}。`
      : '',
    industry ? `主题主力净流入靠前：${industry}。` : '',
    futuresBrief(seats),
    tapeWeak ? '两市跌家明显偏多，上面的外盘方向只作线索。' : '',
  ]
    .filter(Boolean)
    .join('');
}
