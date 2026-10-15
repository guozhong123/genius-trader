/**
 * 顶部盘况：大A / 美股 / 韩股 · 盘前/盘中/盘后/暗盘
 * 美股板块用龙头成分等权涨跌（接近市场魔方思路）
 */

function tzParts(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? 0 : parts.hour);
  const minute = Number(parts.minute);
  const wd = String(parts.weekday || '');
  const isWeekend = wd === 'Sat' || wd === 'Sun';
  return { hour, minute, mins: hour * 60 + minute, isWeekend, wd };
}

/** @returns {{ key: string, label: string }} */
export function getMarketSession(market, now = new Date()) {
  if (market === 'US') {
    const { mins, isWeekend } = tzParts(now, 'America/New_York');
    if (isWeekend) return { key: 'dark', label: '暗盘' };
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) return { key: 'pre', label: '盘前' };
    if (mins >= 9 * 60 + 30 && mins < 16 * 60) return { key: 'open', label: '盘中' };
    if (mins >= 16 * 60 && mins < 20 * 60) return { key: 'post', label: '盘后' };
    return { key: 'dark', label: '暗盘' };
  }
  if (market === 'KR') {
    const { mins, isWeekend } = tzParts(now, 'Asia/Seoul');
    if (isWeekend) return { key: 'dark', label: '休市' };
    if (mins >= 8 * 60 && mins < 9 * 60) return { key: 'pre', label: '盘前' };
    if (mins >= 9 * 60 && mins < 15 * 60 + 30) return { key: 'open', label: '盘中' };
    if (mins >= 15 * 60 + 30 && mins < 20 * 60) return { key: 'post', label: '盘后' };
    return { key: 'dark', label: '休市' };
  }
  // 大A
  const { mins, isWeekend } = tzParts(now, 'Asia/Shanghai');
  if (isWeekend) return { key: 'dark', label: '休市' };
  if (mins >= 9 * 60 && mins < 9 * 60 + 25) return { key: 'pre', label: '盘前' };
  if (
    (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) ||
    (mins >= 13 * 60 && mins < 15 * 60)
  ) {
    return { key: 'open', label: '盘中' };
  }
  if (mins >= 15 * 60 && mins < 15 * 60 + 30) return { key: 'post', label: '盘后' };
  return { key: 'dark', label: '休市' };
}

/** 美股主题成分（等权） */
export const US_PULSE_SECTORS = [
  {
    name: 'CPO',
    members: [
      { code: 'COHR', marketNo: 106 },
      { code: 'LITE', marketNo: 105 },
      { code: 'AAOI', marketNo: 105 },
      { code: 'CIEN', marketNo: 106 },
      { code: 'CRDO', marketNo: 105 },
      { code: 'ALAB', marketNo: 105 },
    ],
  },
  {
    name: '半导体',
    members: [
      { code: 'NVDA', marketNo: 105 },
      { code: 'AVGO', marketNo: 105 },
      { code: 'TSM', marketNo: 105 },
      { code: 'AMD', marketNo: 105 },
      { code: 'ASML', marketNo: 105 },
      { code: 'MU', marketNo: 105 },
      { code: 'AMAT', marketNo: 105 },
    ],
  },
  {
    name: 'AI算力',
    members: [
      { code: 'NVDA', marketNo: 105 },
      { code: 'AVGO', marketNo: 105 },
      { code: 'TSM', marketNo: 105 },
      { code: 'AMD', marketNo: 105 },
      { code: 'MRVL', marketNo: 105 },
    ],
  },
  {
    name: '电网',
    members: [
      { code: 'GEV', marketNo: 106 },
      { code: 'ETN', marketNo: 106 },
      { code: 'PWR', marketNo: 106 },
      { code: 'VRT', marketNo: 106 },
      { code: 'HUBB', marketNo: 106 },
    ],
  },
  {
    name: '航天',
    members: [
      { code: 'RKLB', marketNo: 105 },
      { code: 'BA', marketNo: 106 },
      { code: 'LMT', marketNo: 106 },
      { code: 'RTX', marketNo: 106 },
      { code: 'NOC', marketNo: 106 },
    ],
  },
  {
    name: '存储',
    members: [
      { code: 'MU', marketNo: 105 },
      { code: 'WDC', marketNo: 105 },
      { code: 'STX', marketNo: 105 },
    ],
  },
  {
    name: '数据中心',
    members: [
      { code: 'VRT', marketNo: 106 },
      { code: 'ANET', marketNo: 106 },
      { code: 'SMCI', marketNo: 105 },
      { code: 'DELL', marketNo: 105 },
    ],
  },
  {
    name: '纳指ETF',
    members: [{ code: 'QQQ', marketNo: 105 }],
  },
];

/** 韩股主题 */
export const KR_PULSE_SECTORS = [
  {
    name: '半导体',
    members: [
      { code: '000660', marketNo: 177 }, // SK海力士
      { code: '005930', marketNo: 177 }, // 三星电子
    ],
  },
  {
    name: '电池',
    members: [
      { code: '373220', marketNo: 177 }, // LG能源
      { code: '006400', marketNo: 177 }, // 三星SDI
    ],
  },
  {
    name: '汽车',
    members: [
      { code: '005380', marketNo: 177 }, // 现代
      { code: '000270', marketNo: 177 }, // 起亚
    ],
  },
  {
    name: '互联网',
    members: [
      { code: '035420', marketNo: 177 }, // NAVER
      { code: '035720', marketNo: 177 }, // Kakao
    ],
  },
  {
    name: 'KOSPI',
    members: [{ code: 'KS11', marketNo: 100 }],
  },
];

/** 大A 固定板块（东财 BK，ulist 可直接取涨跌） */
export const CN_PULSE_BOARDS = [
  { name: 'CPO', code: 'BK1128', marketNo: 90, secid: '90.BK1128' },
  { name: '光通信模块', code: 'BK1136', marketNo: 90, secid: '90.BK1136' },
  { name: '半导体', code: 'BK1036', marketNo: 90, secid: '90.BK1036' },
  { name: '半导体概念', code: 'BK0917', marketNo: 90, secid: '90.BK0917' },
  { name: '算力', code: 'BK1134', marketNo: 90, secid: '90.BK1134' },
  { name: 'AI芯片', code: 'BK1127', marketNo: 90, secid: '90.BK1127' },
  { name: '存储芯片', code: 'BK1137', marketNo: 90, secid: '90.BK1137' },
  { name: '电网设备', code: 'BK0457', marketNo: 90, secid: '90.BK0457' },
  { name: '电网概念', code: 'BK1647', marketNo: 90, secid: '90.BK1647' },
  { name: '航天装备', code: 'BK1385', marketNo: 90, secid: '90.BK1385' },
  { name: '商业航天', code: 'BK0963', marketNo: 90, secid: '90.BK0963' },
  { name: '卫星互联网', code: 'BK0921', marketNo: 90, secid: '90.BK0921' },
];

export function averageChange(rows) {
  const vals = (rows || [])
    .map((r) => Number(r?.changePct))
    .filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function buildSectorFromMembers(sector, quoteBySecid) {
  const rows = [];
  for (const m of sector.members || []) {
    const secid = `${m.marketNo}.${m.code}`;
    const q = quoteBySecid.get(secid);
    if (q && Number.isFinite(Number(q.changePct))) rows.push(q);
  }
  const changePct = averageChange(rows);
  return {
    name: sector.name,
    changePct,
    count: rows.length,
    kind: 'sector',
  };
}
