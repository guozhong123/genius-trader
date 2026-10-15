/**
 * 盘况：大A / 美股 / 韩股 · 盘前/盘中/盘后/暗盘
 * 美股主题对齐「市场魔方」产业板块（龙头成分等权）
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

const u = (code, no = 105) => ({ code, marketNo: no });

/** 美股：对齐市场魔方 26 主题 */
export const US_PULSE_SECTORS = [
  { name: 'AI算力', members: [u('NVDA'), u('AVGO'), u('TSM'), u('AMD'), u('MRVL')] },
  {
    name: 'CPO',
    members: [u('COHR', 106), u('LITE'), u('AAOI'), u('CIEN', 106), u('CRDO'), u('ALAB'), u('FN'), u('POET')],
  },
  {
    name: '半导体',
    members: [u('NVDA'), u('AVGO'), u('TSM'), u('AMD'), u('ASML'), u('QCOM'), u('MU'), u('AMAT'), u('LRCX'), u('KLAC')],
  },
  { name: '存储', members: [u('MU'), u('WDC'), u('STX'), u('SNDK'), u('SIMO')] },
  { name: '数据中心', members: [u('VRT', 106), u('ANET', 106), u('SMCI'), u('DELL'), u('EQIX'), u('DLR')] },
  {
    name: '云计算',
    members: [u('MSFT'), u('AMZN'), u('GOOGL'), u('ORCL'), u('CRM'), u('NOW'), u('SNOW'), u('NET')],
  },
  { name: '商业航天', members: [u('RKLB'), u('ASTS'), u('LUNR'), u('RDW'), u('PL'), u('KTOS')] },
  { name: '卫星', members: [u('ASTS'), u('IRDM'), u('VSAT'), u('SATS'), u('GSAT'), u('PL')] },
  { name: '机器人', members: [u('ISRG'), u('ROK', 106), u('TER'), u('SYM'), u('CGNX'), u('ZBRA')] },
  { name: '自动驾驶', members: [u('TSLA'), u('MBLY'), u('APTV', 106), u('AUR'), u('AMBA')] },
  { name: '核电', members: [u('CEG'), u('VST', 106), u('CCJ'), u('BWXT'), u('OKLO'), u('SMR')] },
  {
    name: '电网',
    members: [u('GEV', 106), u('ETN', 106), u('PWR', 106), u('HUBB', 106), u('VRT', 106), u('NVT', 106)],
  },
  {
    name: '军工',
    members: [u('RTX', 106), u('LMT', 106), u('NOC', 106), u('GD', 106), u('LHX', 106), u('BA', 106)],
  },
  { name: '光伏', members: [u('FSLR'), u('ENPH'), u('SEDG'), u('RUN'), u('CSIQ'), u('JKS')] },
  { name: '锂电池', members: [u('ALB', 106), u('SQM', 106), u('QS'), u('ENVX'), u('LCID')] },
  { name: '油气', members: [u('XOM', 106), u('CVX', 106), u('COP', 106), u('SLB', 106), u('OXY', 106)] },
  { name: '铜有色', members: [u('FCX', 106), u('SCCO', 106), u('BHP', 106), u('RIO', 106), u('VALE', 106)] },
  { name: '黄金矿业', members: [u('NEM', 106), u('AEM', 106), u('GOLD', 106), u('WPM'), u('AU')] },
  { name: '银行金融', members: [u('JPM', 106), u('BAC', 106), u('WFC', 106), u('GS', 106), u('MS', 106)] },
  { name: '生物医药', members: [u('LLY', 106), u('NVO', 106), u('ABBV', 106), u('MRK', 106), u('AMGN')] },
  { name: '消费', members: [u('AMZN'), u('WMT', 106), u('COST'), u('HD', 106), u('MCD', 106), u('NKE', 106)] },
  { name: '稀土', members: [u('MP'), u('UUUU'), u('UEC')] },
  { name: '通信设备', members: [u('CSCO'), u('ANET', 106), u('MSI', 106), u('NOK', 106), u('ERIC')] },
  { name: '量子计算', members: [u('IONQ'), u('RGTI'), u('QBTS'), u('IBM', 106)] },
  { name: '区块链', members: [u('COIN'), u('MSTR'), u('HOOD'), u('MARA'), u('RIOT')] },
  { name: 'AI应用', members: [u('PLTR'), u('APP'), u('SHOP'), u('INTU'), u('ADBE'), u('PATH')] },
  { name: '纳指ETF', members: [u('QQQ')] },
];

/** 韩股主题（尽量对齐热门方向） */
export const KR_PULSE_SECTORS = [
  { name: '半导体', members: [u('000660', 177), u('005930', 177)] },
  { name: '电池', members: [u('373220', 177), u('006400', 177), u('247540', 177)] },
  { name: '汽车', members: [u('005380', 177), u('000270', 177)] },
  { name: '互联网', members: [u('035420', 177), u('035720', 177)] },
  { name: '生物', members: [u('207940', 177), u('068270', 177)] },
  { name: '化工', members: [u('051910', 177), u('096770', 177)] },
  { name: '金融', members: [u('105560', 177), u('055550', 177)] },
  { name: '造船', members: [u('009540', 177), u('010140', 177)] },
  { name: 'KOSPI', members: [u('KS11', 100)] },
  { name: 'KOSDAQ', members: [u('KQ11', 100)] },
];

/** 大A：对应魔方主题的东财板块 */
export const CN_PULSE_BOARDS = [
  { name: 'CPO', code: 'BK1128', marketNo: 90, secid: '90.BK1128' },
  { name: '光通信模块', code: 'BK1136', marketNo: 90, secid: '90.BK1136' },
  { name: '半导体', code: 'BK1036', marketNo: 90, secid: '90.BK1036' },
  { name: '半导体概念', code: 'BK0917', marketNo: 90, secid: '90.BK0917' },
  { name: '算力', code: 'BK1134', marketNo: 90, secid: '90.BK1134' },
  { name: 'AI芯片', code: 'BK1127', marketNo: 90, secid: '90.BK1127' },
  { name: '人工智能', code: 'BK0800', marketNo: 90, secid: '90.BK0800' },
  { name: '存储芯片', code: 'BK1137', marketNo: 90, secid: '90.BK1137' },
  { name: '数据中心', code: 'BK0995', marketNo: 90, secid: '90.BK0995' },
  { name: '云计算', code: 'BK0579', marketNo: 90, secid: '90.BK0579' },
  { name: '商业航天', code: 'BK0963', marketNo: 90, secid: '90.BK0963' },
  { name: '航天装备', code: 'BK1385', marketNo: 90, secid: '90.BK1385' },
  { name: '卫星互联网', code: 'BK0921', marketNo: 90, secid: '90.BK0921' },
  { name: '机器人', code: 'BK1090', marketNo: 90, secid: '90.BK1090' },
  { name: '人形机器人', code: 'BK1184', marketNo: 90, secid: '90.BK1184' },
  { name: '自动驾驶', code: 'BK0706', marketNo: 90, secid: '90.BK0706' },
  { name: '电网设备', code: 'BK0457', marketNo: 90, secid: '90.BK0457' },
  { name: '电网概念', code: 'BK1647', marketNo: 90, secid: '90.BK1647' },
  { name: '智能电网', code: 'BK0581', marketNo: 90, secid: '90.BK0581' },
  { name: '军工', code: 'BK0480', marketNo: 90, secid: '90.BK0480' },
  { name: '光伏概念', code: 'BK0588', marketNo: 90, secid: '90.BK0588' },
  { name: '锂电池', code: 'BK0574', marketNo: 90, secid: '90.BK0574' },
  { name: '油气', code: 'BK0495', marketNo: 90, secid: '90.BK0495' },
  { name: '有色金属', code: 'BK0478', marketNo: 90, secid: '90.BK0478' },
  { name: '黄金', code: 'BK1617', marketNo: 90, secid: '90.BK1617' },
  { name: '银行', code: 'BK0475', marketNo: 90, secid: '90.BK0475' },
  { name: '生物医药', code: 'BK1044', marketNo: 90, secid: '90.BK1044' },
  { name: '白酒', code: 'BK0896', marketNo: 90, secid: '90.BK0896' },
  { name: '稀土永磁', code: 'BK0701', marketNo: 90, secid: '90.BK0701' },
  { name: '通信设备', code: 'BK0448', marketNo: 90, secid: '90.BK0448' },
];

/** 东财板块行情断掉时，用这几只的等权涨跌顶上。 */
export const CN_PULSE_PROXIES = {
  CPO: ['300308', '300502', '300394'],
  光通信模块: ['300308', '300502', '300394'],
  半导体: ['688981', '002371', '603501'],
  半导体概念: ['688981', '002371', '603501'],
  算力: ['603019', '000977', '601138'],
  AI芯片: ['688256', '688041', '688981'],
  人工智能: ['002230', '300496', '688256'],
  存储芯片: ['603986', '688008', '300223'],
  数据中心: ['600845', '002335', '603881'],
  云计算: ['600588', '002230', '300454'],
  商业航天: ['600118', '600879', '002025'],
  航天装备: ['600893', '600760', '000768'],
  卫星互联网: ['600118', '601698', '600879'],
  机器人: ['300024', '002747', '002050'],
  人形机器人: ['002050', '601689', '300124'],
  自动驾驶: ['002920', '002405', '600699'],
  电网设备: ['600089', '601877', '600312'],
  电网概念: ['600089', '601877', '600312'],
  智能电网: ['600089', '601877', '600312'],
  军工: ['600760', '000768', '600893'],
  光伏概念: ['601012', '600438', '002459'],
  锂电池: ['300750', '002460', '300014'],
  油气: ['601857', '600028', '600938'],
  有色金属: ['601899', '603993', '000630'],
  黄金: ['600547', '600489', '601899'],
  银行: ['601398', '600036', '601288'],
  生物医药: ['600276', '603259', '300760'],
  白酒: ['600519', '000858', '000568'],
  稀土永磁: ['600111', '000831', '600392'],
  通信设备: ['000063', '600487', '600498'],
};

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
