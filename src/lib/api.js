/**
 * Public quote helpers (East Money / Tiantian Fund / Tencent suggest).
 * Data is unofficial and for personal reference only.
 */
import { TENCENT_BOARDS } from './tencent-boards.js';
import { seatStance } from './trend.js';

// f15高 f16低 f17开 f18昨收；用于列表估值高低判断
const STOCK_FIELDS = 'f12,f13,f14,f2,f3,f4,f15,f16,f17,f18,f124';

const MARKET_BY_CODE = {
  0: 'SZ',
  1: 'SH',
  90: 'BK',
  100: 'HK',
  101: 'US',
  105: 'US',
  106: 'US',
  107: 'US',
  116: 'HK',
  177: 'KR',
};

/** 腾讯行情多为 GBK；按 UTF-8 读会乱码 */
async function fetchTextGbk(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

function looksGarbledName(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/\uFFFD/.test(t)) return true;
  // GBK 被当 UTF-8：几乎无汉字却有大量拉丁扩展/奇怪符号
  const hasCjk = /[\u4e00-\u9fff]/.test(t);
  if (!hasCjk && /[\u00c0-\u024f\u0400-\u04ff]/.test(t)) return true;
  return false;
}

function preferReadableName(...candidates) {
  for (const c of candidates) {
    const t = String(c || '').trim();
    if (t && !looksGarbledName(t)) return t;
  }
  return String(candidates.find((c) => String(c || '').trim()) || '').trim();
}

function marketLabel(market) {
  const map = {
    SH: '沪',
    SZ: '深',
    BJ: '京',
    HK: '港',
    BK: '板',
    KR: '韩',
    US: '美',
    FUND: '基金',
  };
  return map[market] || market || '';
}

export function toSecid(market, code, marketNo) {
  const c = String(code).replace(/\.(SH|SZ|BJ|HK|US)$/i, '');
  if (marketNo != null && marketNo !== '') {
    const no = Number(marketNo);
    if (no === 116) return `116.${c.padStart(5, '0')}`;
    if ([105, 106, 107].includes(no)) return `${no}.${c}`;
    return `${no}.${c}`;
  }
  switch (market) {
    case 'SH':
      return `1.${c}`;
    case 'SZ':
    case 'BJ':
      return `0.${c}`;
    case 'HK':
      return `116.${c.padStart(5, '0')}`;
    case 'US':
      return `105.${c}`;
    default:
      return `1.${c}`;
  }
}

function detectAShareMarket(code) {
  const c = String(code);
  if (c.startsWith('6') || c.startsWith('9')) return 'SH';
  if (c.startsWith('8') || c.startsWith('4')) return 'BJ';
  return 'SZ';
}

export async function searchSymbols(keyword) {
  const q = keyword.trim();
  if (!q) return [];

  // 网页端东财搜索常无 CORS；腾讯 smartbox 用 script 注入最稳
  const [tencentHits, emHits, fundHits] = await Promise.all([
    searchViaTencent(q),
    searchStocksEastmoney(q),
    searchFunds(q),
  ]);
  const merged = [];
  const seen = new Set();
  for (const item of [...tencentHits, ...emHits, ...fundHits, ...directCodeHits(q)]) {
    const key = `${item.kind}:${item.market}:${item.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 20);
}

/** 6 位代码兜底：即使搜索接口全挂也能添加 */
function directCodeHits(q) {
  if (!/^\d{6}$/.test(q)) return [];
  const stockMarket = detectAShareMarket(q);
  const marketNo = stockMarket === 'SH' ? 1 : 0;
  return [
    {
      kind: 'stock',
      code: q,
      name: q,
      market: stockMarket,
      marketNo,
      secid: toSecid(stockMarket, q, marketNo),
      label: marketLabel(stockMarket),
    },
    {
      kind: 'fund',
      code: q,
      name: q,
      market: 'FUND',
      secid: null,
      label: '基金',
    },
  ];
}

async function searchStocksEastmoney(q) {
  try {
    const url = `https://search-codetable.eastmoney.com/codetable/search/web?client=web&keyword=${encodeURIComponent(q)}&pageNumber=1&pageSize=12`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.result || [];
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeEastMoneySearch)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeEastMoneySearch(row) {
  const code = String(row.code || '').trim();
  const name = String(row.shortName || row.name || '').trim();
  if (!code || !name) return null;

  const typeName = String(row.securityTypeName || '');
  const marketNo = Number(row.market);
  if (typeName.includes('概念') || typeName.includes('板块') || marketNo === 90) {
    return null;
  }

  let kind = 'stock';
  let market = MARKET_BY_CODE[marketNo] || 'SZ';

  if (typeName.includes('基金') || typeName.includes('ETF')) {
    // Keep ETF / listed funds as stocks when they have a market quote id
    if (/^\d{6}$/.test(code) && (marketNo === 0 || marketNo === 1)) {
      kind = 'stock';
      market = marketNo === 1 ? 'SH' : 'SZ';
    }
  }

  if (typeName.includes('沪')) market = 'SH';
  else if (typeName.includes('深')) market = 'SZ';
  else if (typeName.includes('京') || typeName.includes('北')) market = 'BJ';
  else if (typeName.includes('港')) market = 'HK';
  else if (typeName.includes('美')) market = 'US';

  if (!MARKET_BY_CODE[marketNo] && /^\d{6}$/.test(code)) {
    market = detectAShareMarket(code);
  }

  return {
    kind,
    code,
    name,
    market,
    marketNo,
    secid: toSecid(market, code, marketNo),
    label: marketLabel(market),
  };
}

function decodeTencentName(raw) {
  const s = String(raw || '');
  try {
    // smartbox 常返回 \uXXXX 转义
    return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
  } catch {
    return s;
  }
}

/** 通过 <script> 加载腾讯联想（无 CORS）；也会尝试 fetch */
async function searchViaTencent(q) {
  const url = `https://smartbox.gtimg.cn/s3/?v=2&t=all&q=${encodeURIComponent(q)}`;
  let payload = '';
  try {
    // 扩展 / 少数环境 fetch 可用
    payload = await fetchTextGbk(url);
  } catch {
    payload = '';
  }
  if (!payload.includes('v_hint=') && typeof document !== 'undefined') {
    payload = await loadTencentHintScript(url);
  }
  const m = String(payload).match(/v_hint="([^"]*)"/);
  if (!m || !m[1] || m[1] === 'N') return [];
  return m[1]
    .split('^')
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      const [marketTag, code, rawName] = line.split('~');
      const name = decodeTencentName(rawName);
      if (!code || !name) return null;
      let market = 'SZ';
      let kind = 'stock';
      let marketNo;
      if (marketTag === 'sh') {
        market = 'SH';
        marketNo = 1;
      } else if (marketTag === 'sz') {
        market = 'SZ';
        marketNo = 0;
      } else if (marketTag === 'hk') {
        market = 'HK';
        marketNo = 116;
      } else if (marketTag === 'us') {
        market = 'US';
        marketNo = 105;
      } else if (marketTag === 'jj' || marketTag === 'of') {
        kind = 'fund';
        market = 'FUND';
      } else {
        return null;
      }
      return {
        kind,
        code: kind === 'fund' ? String(code).padStart(6, '0') : code,
        name,
        market,
        marketNo,
        secid: kind === 'stock' ? toSecid(market, code, marketNo) : null,
        label: marketLabel(market),
      };
    })
    .filter(Boolean);
}

function loadTencentHintScript(url) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('');
      return;
    }
    const prev = window.v_hint;
    const script = document.createElement('script');
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        script.remove();
      } catch {
        /* ignore */
      }
      window.v_hint = prev;
      resolve(val != null && val !== '' && val !== 'N' ? `v_hint="${val}"` : '');
    };
    const timer = setTimeout(() => finish(window.v_hint), 3500);
    script.onload = () => finish(window.v_hint);
    script.onerror = () => finish('');
    try {
      delete window.v_hint;
    } catch {
      window.v_hint = undefined;
    }
    script.src = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

async function searchFunds(q) {
  try {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const json = await res.json();
    const rows = json?.Datas || [];
    return rows
      .slice(0, 10)
      .map((row) => ({
        kind: 'fund',
        code: String(row.CODE || '').padStart(6, '0'),
        name: String(row.NAME || ''),
        market: 'FUND',
        secid: null,
        label: '基金',
      }))
      .filter((x) => x.code && x.name);
  } catch {
    return [];
  }
}

export async function fetchQuotes(items) {
  const stocks = items.filter((x) => x.kind === 'stock');
  const funds = items.filter((x) => x.kind === 'fund');
  const [stockMap, fundMap] = await Promise.all([
    fetchStockQuotes(stocks).catch(() => ({})),
    fetchFundQuotes(funds).catch(() => ({})),
  ]);
  return { ...stockMap, ...fundMap };
}

async function fetchEastStockQuotes(stocks) {
  const secids = stocks
    .map((s) => s.secid || toSecid(s.market, s.code, s.marketNo))
    .join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=${STOCK_FIELDS}&secids=${encodeURIComponent(secids)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error('ulist');
  const json = await res.json();
  const diff = json?.data?.diff || [];
  const map = {};

  const normalizeCode = (c, market) => {
    const s = String(c);
    if (market === 'HK') return s.padStart(5, '0');
    return s;
  };

  for (const row of diff) {
    const code = String(row.f12);
    const marketType = Number(row.f13);
    const market = MARKET_BY_CODE[marketType] || 'SZ';
    let price = Number(row.f2);
    const prev = Number(row.f18);
    if (!price && prev) price = prev;

    const payload = {
      name: row.f14 || '',
      price,
      changePct: Number(row.f3),
      change: Number(row.f4),
      high: Number(row.f15),
      low: Number(row.f16),
      open: Number(row.f17),
      prevClose: prev,
      market,
      updatedAt: row.f124 ? row.f124 * 1000 : Date.now(),
    };

    for (const s of stocks) {
      const sameMarket =
        s.market === market ||
        Number(s.marketNo) === marketType ||
        (s.secid && s.secid.startsWith(`${marketType}.`));
      const sameCode =
        normalizeCode(s.code, market) === normalizeCode(code, market) ||
        String(s.code).toUpperCase() === code.toUpperCase();
      if (sameMarket && sameCode) {
        map[`stock:${s.market}:${s.code}`] = payload;
      }
    }

    map[`stock:${market}:${code}`] = payload;
  }

  if (!Object.keys(map).some((k) => k.startsWith('stock:')) && diff.length) {
    stocks.forEach((s, i) => {
      const row = diff[i];
      if (!row) return;
      let price = Number(row.f2);
      const prev = Number(row.f18);
      if (!price && prev) price = prev;
      map[`stock:${s.market}:${s.code}`] = {
        name: row.f14 || s.name,
        price,
        changePct: Number(row.f3),
        change: Number(row.f4),
        prevClose: prev,
        updatedAt: Date.now(),
      };
    });
  }

  return map;
}

let quoteListDownUntil = 0;

function noteQuoteListDown() {
  quoteListDownUntil = Date.now() + 2 * 60 * 1000;
}

function quoteListLikelyDown() {
  return Date.now() < quoteListDownUntil;
}

async function fetchStockQuotes(stocks) {
  if (!stocks.length) return {};
  let map = {};
  if (!quoteListLikelyDown()) {
    try {
      map = await fetchEastStockQuotes(stocks);
    } catch {
      noteQuoteListDown();
      map = {};
    }
  }
  if (!Object.values(map).some((row) => Number(row?.price) > 0) && stocks.length) noteQuoteListDown();
  const missing = stocks.filter((s) => !(Number(map[`stock:${s.market}:${s.code}`]?.price) > 0));
  if (!missing.length) return map;
  const rows = await fetchTencentSnapshots(missing);
  for (const row of rows) {
    if (!(Number(row.price) > 0)) continue;
    const payload = {
      name: row.name || '',
      price: row.price,
      changePct: row.changePct,
      change: row.change,
      high: row.high,
      low: row.low,
      open: row.open,
      prevClose: row.prevClose,
      market: row.market,
      updatedAt: row.updatedAt || Date.now(),
    };
    map[`stock:${row.market}:${row.code}`] = payload;
  }
  return map;
}

function fundQuoteKey(code) {
  return `fund:FUND:${String(code).padStart(6, '0')}`;
}

function putFundQuote(map, code, payload) {
  const padded = String(code).padStart(6, '0');
  const raw = String(code);
  map[fundQuoteKey(padded)] = payload;
  if (raw !== padded) map[`fund:FUND:${raw}`] = payload;
}

/** 真扩展才有随机 id；网页 polyfill 固定为 'web' */
const isExtension =
  typeof chrome !== 'undefined' &&
  !!chrome.runtime?.id &&
  chrome.runtime.id !== 'web';

function parseFundEstimate(gszRaw) {
  if (gszRaw == null || gszRaw === '' || gszRaw === '--') return null;
  const n = Number(gszRaw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFundChangePct(raw) {
  if (raw == null || raw === '' || raw === '--') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolveFundPrice(estimate, nav) {
  if (estimate != null && estimate > 0) return estimate;
  const n = Number(nav);
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function quoteFromMnfRow(row) {
  const code = String(row.FCODE || '').padStart(6, '0');
  const nav = Number(row.NAV || row.DWJZ || 0);
  const estimate = parseFundEstimate(row.GSZ);
  // 有估算才用估算涨跌；否则用净值涨跌，避免「净值价 + 昨日估算涨跌」错配
  const pctRaw =
    estimate != null
      ? row.GSZZL
      : row.NAVCHGRT != null && row.NAVCHGRT !== ''
        ? row.NAVCHGRT
        : null;
  const changePct = parseFundChangePct(pctRaw);
  const price = resolveFundPrice(estimate, nav);
  return {
    code,
    payload: {
      name: row.SHORTNAME || row.NAME || '',
      price,
      nav: nav > 0 ? nav : null,
      estimate,
      changePct,
      updatedAt: Date.now(),
      asOf: estimate != null ? row.GZTIME || row.PDATE || '' : row.PDATE || row.GZTIME || '',
      source: estimate != null ? '估' : '净',
    },
  };
}

function quoteFromGzData(data, fallback) {
  const code = String(data.fundcode || fallback?.code || '').padStart(6, '0');
  const nav = Number(data.dwjz || 0);
  const estimate = parseFundEstimate(data.gsz);
  const changePct = parseFundChangePct(data.gszzl);
  const price = resolveFundPrice(estimate, nav);
  return {
    code,
    payload: {
      name: data.name || fallback?.name || '',
      price,
      nav: nav > 0 ? nav : null,
      estimate,
      changePct,
      updatedAt: Date.now(),
      asOf: data.gztime || data.jzrq || '',
      source: estimate != null ? '估' : '净',
    },
  };
}

/** 腾讯基金行情：jj代码，字段含估算涨跌与净值（响应 charset=GBK） */
async function fetchFundQuotesFromTencent(funds) {
  if (!funds.length) return {};
  const map = {};
  const byCode = new Map(
    funds.map((f) => [String(f.code).padStart(6, '0'), f]),
  );
  const chunkSize = 40;
  for (let i = 0; i < funds.length; i += chunkSize) {
    const chunk = funds.slice(i, i + chunkSize);
    const codes = chunk.map((f) => `jj${String(f.code).padStart(6, '0')}`).join(',');
    try {
      const url = `https://qt.gtimg.cn/q=${codes}&_=${Date.now()}`;
      const text = await fetchTextGbk(url);
      for (const line of text.split(';')) {
        const m = line.match(/v_jj(\d{6})="([^"]*)"/);
        if (!m) continue;
        const code = m[1];
        const parts = m[2].split('~');
        // 0代码 1名称 2估算净值 3估算涨跌幅 5单位净值 6累计? 7净值涨跌幅 8净值日期
        const fallback = byCode.get(code);
        const name = preferReadableName(parts[1], fallback?.name);
        const estimate = parseFundEstimate(parts[2]);
        const estPct = parseFundChangePct(parts[3]);
        const nav = Number(parts[5] || parts[6] || 0);
        const navPct = parseFundChangePct(parts[7]);
        const changePct = estimate != null ? estPct : navPct;
        const price = resolveFundPrice(estimate, nav);
        if (price == null) continue;
        putFundQuote(map, code, {
          name,
          price,
          nav: nav > 0 ? nav : null,
          estimate,
          changePct,
          updatedAt: Date.now(),
          // 估算优先显示估值时间；腾讯 jj 字段 4 常为估值时间，8 为净值日期
          asOf: (estimate != null ? parts[4] || parts[8] : parts[8]) || '',
          source: estimate != null ? '估' : '净',
        });
      }
    } catch {
      /* try next chunk */
    }
  }
  return map;
}

/** fundgz 固定回调名，只能串行；仅作最后兜底 */
let fundGzJsonpChain = Promise.resolve();

export function fetchFundGzJsonp(code) {
  const padded = String(code).padStart(6, '0');
  const run = () =>
    new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new Error('no document'));
        return;
      }
      const script = document.createElement('script');
      const prev = window.jsonpgz;
      const timer = setTimeout(() => {
        window.jsonpgz = prev;
        script.remove();
        reject(new Error('fundgz timeout'));
      }, 3500);
      script.onerror = () => {
        clearTimeout(timer);
        window.jsonpgz = prev;
        script.remove();
        reject(new Error('fundgz load error'));
      };
      window.jsonpgz = (data) => {
        clearTimeout(timer);
        window.jsonpgz = prev;
        script.remove();
        resolve(data);
      };
      script.src = `https://fundgz.1234567.com.cn/js/${padded}.js?rt=${Date.now()}`;
      document.head.appendChild(script);
    });
  const p = fundGzJsonpChain.then(run, run);
  fundGzJsonpChain = p.catch(() => {});
  return p;
}

async function fetchFundQuotes(funds) {
  if (!funds.length) return {};
  const map = {};
  const chunkSize = 40;
  const codes = funds.map((f) => String(f.code).padStart(6, '0'));

  // 1) 东财批量估值（扩展无 CORS；网页可能失败）
  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    try {
      const url =
        `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200` +
        `&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=genius-trader` +
        `&Fcodes=${chunk.join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`FundMNFInfo ${res.status}`);
      const json = await res.json();
      const rows = json?.Datas || json?.Data || [];
      for (const row of rows) {
        const { code, payload } = quoteFromMnfRow(row);
        if (payload.price != null) putFundQuote(map, code, payload);
      }
    } catch {
      /* 网页 CORS / 网络失败时走备用源 */
    }
  }

  // 2) 腾讯批量：补缺价，并把「只有净值、无估算」的升级成盘中估算（避免一直显示昨日净值涨跌）
  let needTx = funds.filter((f) => {
    const q = map[fundQuoteKey(f.code)];
    return !q?.price || q.estimate == null || q.source === '净';
  });
  if (needTx.length) {
    const tx = await fetchFundQuotesFromTencent(needTx);
    for (const [k, payload] of Object.entries(tx)) {
      const prev = map[k];
      if (!prev) {
        map[k] = payload;
        continue;
      }
      // 有估算时覆盖净值行情；仍无估算则保留原价只补字段
      if (payload.estimate != null) map[k] = payload;
      else if (!prev.price && payload.price != null) map[k] = payload;
    }
  }

  // 3) 天天基金 JSONP 仅补仍缺的少量（串行、短超时）
  let missing = funds.filter((f) => !map[fundQuoteKey(f.code)]?.price);
  for (const f of missing.slice(0, 12)) {
    try {
      const data = await fetchFundGzJsonp(f.code);
      const { code, payload } = quoteFromGzData(data, f);
      if (payload.price != null) putFundQuote(map, code, payload);
    } catch {
      /* ignore */
    }
  }

  return map;
}

/** 宏观重磅 */
const MACRO_RE =
  /美国?\s*CPI|核心CPI|PCE|非农|失业率|美联储|降息|加息|点阵图|FOMC|通胀|就业报告|关税|制裁|鲍威尔/;
/** 科技板块利好/利空 */
const TECH_RE =
  /英伟达|NVIDIA|NVDA|海力士|台积电|TSMC|ASML|阿斯麦|费城半导体|半导体|芯片|GPU|HBM|AI\s*芯片|算力|苹果公司|苹果股价|微软|AMD|存储\s*板块|纳指/;

const ASHERE_RE =
  /证监会|央行|降准|MLF|LPR|社融|国常会|政治局|国务院|人民币|汇率|沪指|深成指|创业板|科创|北向|南向|两市成交|涨停|跌停|原油|黄金|美股|道指|标普|纳指|恒指|日经|战争|停火|制裁/;

function newsBucket(title) {
  const t = String(title || '');
  if (/CPI|PPI|PCE|非农|美联储|FOMC|央行|降准|降息|加息|MLF|LPR|国常会|国务院|证监会|财政部|社融|潘功胜/.test(t)) return 'macro';
  if (/沪指|深成指|创业板|科创|北向|南向|成交额|涨停|跌停|A股|两市|复盘/.test(t)) return 'ashare';
  if (/美股|道指|标普|纳指|恒指|日经|韩国|欧洲|原油|黄金|铜|期货|天然气|人民币|汇率|日元|国债/.test(t)) return 'global';
  if (/战争|袭击|制裁|停火|导弹|冲突|空袭/.test(t)) return 'geo';
  if (TECH_RE.test(t)) return 'tech';
  return 'other';
}

function scoreMajorNews(title) {
  const t = String(title || '');
  const bucket = newsBucket(t);
  let score = bucket === 'other' ? 0 : 2;
  if (bucket === 'macro') score += 5;
  else if (bucket === 'ashare' || bucket === 'global') score += 4;
  else if (bucket === 'geo') score += 3;
  else if (bucket === 'tech') score += 2;
  if (MACRO_RE.test(t) || ASHERE_RE.test(t)) score += 1;
  if (/高于预期|低于预期|暴涨|暴跌|大跌|跳水|重磅|突发/.test(t)) score += 2;
  if (/公司互动|会见|调研|座谈会|拟发行|拟定增|复牌|中标|签署战略|这些公司/.test(t)) score -= 6;
  return score;
}

function parseKuaixun(text) {
  const m = text.match(/var\s+ajaxResult\s*=\s*(\{[\s\S]*\})\s*;?\s*$/m) || text.match(/(\{[\s\S]*"LivesList"[\s\S]*\})/);
  if (!m) return [];
  try {
    return JSON.parse(m[1])?.LivesList || [];
  } catch {
    return [];
  }
}

/**
 * 重大消息：宏观、大A、外盘、产业都收，按重要程度排，不限于科技。
 * @param {number} limit
 */
export async function fetchMarketNews(limit = 12) {
  const feeds = [
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_100_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_101_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_105_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_106_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_107_ajaxResult_50_1_.html',
  ];
  const items = [];
  await Promise.all(
    feeds.map(async (url) => {
      try {
        const text = await (await fetch(url)).text();
        for (const row of parseKuaixun(text)) {
          const title = String(row.title || row.digest || '').trim();
          if (!title) continue;
          const score = scoreMajorNews(title);
          if (score < 3) continue;
          const id = String(row.newsid || row.id || row.sort || title.slice(0, 40));
          items.push({
            id,
            title: title.replace(/^【|】$/g, '').slice(0, 72),
            time: row.showtime || row.time || '',
            url: row.url_w || row.url_unique || row.url_m || '',
            score,
            bucket: newsBucket(title),
            source: 'flash',
            tone: /利空|跌|跳水|低于|加息|制裁|关税|失望/.test(title)
              ? 'down'
              : /利好|涨|高于|降息|突破|强劲/.test(title)
                ? 'up'
                : 'neutral',
          });
        }
      } catch {
        /* ignore feed */
      }
    }),
  );

  const seen = new Set();
  const unique = items
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      const key = x.title.slice(0, 18);
      if (seen.has(x.id) || seen.has(key)) return false;
      seen.add(x.id);
      seen.add(key);
      return true;
    });
  const buckets = { macro: [], ashare: [], global: [], geo: [], tech: [], other: [] };
  for (const row of unique) (buckets[row.bucket] || buckets.other).push(row);
  const order = ['macro', 'ashare', 'global', 'geo', 'tech', 'other'];
  const picked = [];
  let guard = 0;
  while (picked.length < limit && guard < 80) {
    let moved = false;
    for (const key of order) {
      if (key === 'tech' && picked.filter((row) => row.bucket === 'tech').length >= 2) continue;
      const row = buckets[key].shift();
      if (!row) continue;
      picked.push(row);
      moved = true;
      if (picked.length >= limit) break;
    }
    if (!moved) break;
    guard += 1;
  }
  return picked;
}

/** 把科技龙头大涨跌 / 当日宏观日历合成补充重大消息 */
export function mergeMajorAlerts(news, { techLeaders = [], todayEvents = [] } = {}) {
  const extra = [];
  const nowLabel = new Date().toLocaleString('zh-CN', { hour12: false });

  for (const e of todayEvents) {
    if (e.type !== 'cpi' && e.type !== 'nfp' && e.type !== 'fomc') continue;
    extra.push({
      id: `cal-${e.id}`,
      title: `【今日关注】${e.title}：${e.tip}`,
      time: nowLabel,
      url: '',
      score: 8,
      source: 'calendar',
      tone: 'neutral',
      impact: e.impact || '',
    });
  }

  let techSlots = 0;
  for (const t of techLeaders) {
    if (techSlots >= 1) break;
    const pct = Number(t.changePct);
    if (!Number.isFinite(pct) || Math.abs(pct) < 4) continue;
    techSlots += 1;
    if (pct <= -4) {
      extra.push({
        id: `tech-down-${t.code}`,
        title: `科技龙头大跌：${t.name} ${pct.toFixed(2)}%`,
        time: nowLabel,
        url: '',
        score: 7,
        source: 'tech',
        tone: 'down',
        impact: '龙头承压时，相关主题基金/ETF 与 A 股映射标的易跟跌，注意仓位与止损。',
      });
    } else if (pct >= 4) {
      extra.push({
        id: `tech-up-${t.code}`,
        title: `科技龙头大涨：${t.name} +${pct.toFixed(2)}%`,
        time: nowLabel,
        url: '',
        score: 6,
        source: 'tech',
        tone: 'up',
        impact: '情绪偏热，追高需谨慎；可观察是否放量延续。',
      });
    }
  }

  const seen = new Set();
  return [...extra, ...(news || [])]
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      const k = x.id || x.title.slice(0, 20);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

/** 科技龙头行情（美股/港股/韩股等） */
export const TECH_LEADERS = [
  { name: '英伟达', code: 'NVDA', market: 'US', marketNo: 105, secid: '105.NVDA', kind: 'stock' },
  { name: '台积电', code: 'TSM', market: 'US', marketNo: 105, secid: '105.TSM', kind: 'stock' },
  { name: 'AMD', code: 'AMD', market: 'US', marketNo: 105, secid: '105.AMD', kind: 'stock' },
  { name: '苹果', code: 'AAPL', market: 'US', marketNo: 105, secid: '105.AAPL', kind: 'stock' },
  { name: '微软', code: 'MSFT', market: 'US', marketNo: 105, secid: '105.MSFT', kind: 'stock' },
  { name: 'SK海力士', code: '000660', market: 'KR', marketNo: 177, secid: '177.000660', kind: 'stock' },
  { name: '腾讯', code: '00700', market: 'HK', marketNo: 116, secid: '116.00700', kind: 'stock' },
  { name: '阿里', code: '09988', market: 'HK', marketNo: 116, secid: '116.09988', kind: 'stock' },
];

export async function fetchTechLeaders() {
  return fetchIndices(TECH_LEADERS);
}

/** 批量拉成分股行情（盘况板块加权用） */
export async function fetchMembersQuotes(members) {
  if (!members?.length) return [];
  const uniq = new Map();
  for (const m of members) {
    const secid = m.secid || `${m.marketNo}.${m.code}`;
    if (!uniq.has(secid)) {
      uniq.set(secid, {
        code: m.code,
        marketNo: m.marketNo,
        secid,
        name: m.name || m.code,
        kind: 'stock',
        market:
          m.marketNo === 90
            ? 'BK'
            : m.marketNo === 177 || m.marketNo === 100
              ? 'KR'
              : 'US',
      });
    }
  }
  const list = [...uniq.values()];
  const out = [];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = await fetchIndices(list.slice(i, i + 40));
    out.push(...chunk);
  }
  return out;
}

async function fetchEastIndices(list) {
  const secids = list.map((x) => x.secid || toSecid(x.market, x.code, x.marketNo)).join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=${STOCK_FIELDS}&secids=${encodeURIComponent(secids)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error('ulist');
  const json = await res.json();
  const diff = json?.data?.diff || [];
  return list.map((meta) => {
    const secid = meta.secid || toSecid(meta.market, meta.code, meta.marketNo);
    // 只按代码对齐，避免缺行时串到别的指数（日经空白常见原因）
    const row = diff.find((d) => String(d.f12).toUpperCase() === String(meta.code).toUpperCase());
    if (!row) return { ...meta, secid, price: null, changePct: null };
    let price = Number(row.f2);
    const prev = Number(row.f18);
    if (!(price > 0) && prev > 0) price = prev;
    const changePct = Number(row.f3);
    return {
      ...meta,
      secid,
      name: row.f14 || meta.name,
      price: price > 0 ? price : null,
      changePct: Number.isFinite(changePct) ? changePct : null,
      change: Number(row.f4),
      prevClose: Number.isFinite(prev) ? prev : null,
    };
  });
}

function indexQuoteComplete(row) {
  return Number(row?.price) > 0 && Number.isFinite(Number(row?.changePct));
}

async function fetchYahooSnapshots(list) {
  const rows = [];
  await Promise.all(
    (list || []).map(async (meta) => {
      const secid = meta.secid || toSecid(meta.market, meta.code, meta.marketNo);
      const sym = yahooSymbol(secid);
      if (!sym) return;
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const json = await res.json();
        const info = json?.chart?.result?.[0]?.meta || {};
        const price = Number(info.regularMarketPrice);
        const prev = Number(info.chartPreviousClose || info.previousClose);
        let changePct = Number(info.regularMarketChangePercent);
        if (!Number.isFinite(changePct) && price > 0 && prev > 0) changePct = ((price - prev) / prev) * 100;
        if (!(price > 0)) return;
        rows.push({
          ...meta,
          secid,
          price,
          changePct: Number.isFinite(changePct) ? changePct : null,
          prevClose: Number.isFinite(prev) ? prev : null,
          name: meta.name,
        });
      } catch {
        /* next */
      }
    }),
  );
  return rows;
}

export async function fetchIndices(list) {
  if (!list?.length) return [];
  // 腾讯先拿日经等海外指数（gzN225），避免东财缺行导致卡片空白
  let merged = list.map((meta) => {
    const secid = meta.secid || toSecid(meta.market, meta.code, meta.marketNo);
    return { ...meta, secid };
  });
  const fill = (alts) => {
    const map = new Map((alts || []).map((row) => [row.secid, row]));
    merged = merged.map((row) => {
      if (indexQuoteComplete(row)) return row;
      const alt = map.get(row.secid);
      if (!(Number(alt?.price) > 0)) return row;
      return {
        ...row,
        ...alt,
        name: row.name || alt.name,
        changePct: Number.isFinite(Number(alt.changePct)) ? Number(alt.changePct) : row.changePct,
      };
    });
  };
  fill(await fetchTencentSnapshots(list).catch(() => []));
  if (merged.every((row) => indexQuoteComplete(row))) return merged;

  let east = [];
  if (!quoteListLikelyDown()) {
    try {
      east = await fetchEastIndices(list);
    } catch {
      noteQuoteListDown();
      east = [];
    }
  }
  if (!east.some((row) => indexQuoteComplete(row))) noteQuoteListDown();
  fill(east);
  const missing = merged.filter((row) => !indexQuoteComplete(row));
  if (missing.length) fill(await fetchYahooSnapshots(missing).catch(() => []));
  return merged;
}

function formatTrendTime(rawTime, ndays = 1) {
  const raw = String(rawTime || '').trim();
  if (!raw) return '';
  // 五日：保留 MM-DD HH:MM，方便图表按交易日切开，并丢掉周末空档
  if (ndays > 1) {
    const m = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}:\d{2})/);
    if (m) {
      const mm = m[2].padStart(2, '0');
      const dd = m[3].padStart(2, '0');
      return `${mm}-${dd} ${m[4]}`;
    }
    if (raw.includes(' ')) return raw.slice(5, 16) || raw.split(' ').pop() || raw;
  }
  return raw.split(' ')[1] || raw;
}

function parseTrendsPayload(data, ndays = 1) {
  if (!data?.trends?.length) return null;
  const points = data.trends
    .map((line) => {
      const p = String(line).split(',');
      // 东财分时常见：时间,现价,开,高,低,成交量,成交额,均价
      const price = Number(p[1]);
      const avg = Number(p[7] ?? p[1]);
      const rawTime = p[0] || '';
      return {
        time: formatTrendTime(rawTime, ndays),
        price,
        avg: Number.isFinite(avg) ? avg : price,
        volume: Number(p[5] || 0),
      };
    })
    // 五日首根偶发 0 价占位，丢掉
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && p.time);

  if (!points.length) return null;
  return {
    name: data.name || '',
    code: data.code || '',
    preClose: Number(data.preClose || data.prePrice || points[0].price || 0),
    points,
    ndays,
  };
}

async function fetchTencentMinuteBySym(secid, sym, urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      const bag = json?.data?.[sym] || json?.data?.[sym.toLowerCase()] || {};
      const block = bag?.data || bag;
      const rows = block?.data || [];
      if (!Array.isArray(rows) || !rows.length) continue;
      const dateRaw = String(block.date || '');
      const dateLabel =
        dateRaw.length === 8 ? `${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : '';
      const points = [];
      let prev = null;
      for (const row of rows) {
        const parts = String(row).trim().split(/\s+/);
        if (parts.length < 2) continue;
        const clock = parts[0].length === 4 ? `${parts[0].slice(0, 2)}:${parts[0].slice(2)}` : parts[0];
        const price = Number(parts[1]);
        if (!(price > 0)) continue;
        points.push({
          time: dateLabel ? `${dateLabel} ${clock}` : clock,
          price,
          avg: price,
          volume: Number(parts[2] || 0) - (prev || 0),
        });
        prev = Number(parts[2] || 0);
      }
      if (!points.length) continue;
      const qt = bag?.qt?.[sym] || bag?.qt?.[sym.toLowerCase()] || [];
      const preClose = Number(qt[4] || qt[5] || points[0].price) || points[0].price;
      return { name: qt[1] || '', code: secid, preClose, points, ndays: 1 };
    } catch {
      /* next */
    }
  }
  return null;
}

/** 美股 / 全球指数（gzKS11、gzN225、usNDX）腾讯分钟兜底 */
async function fetchTencentForeignMinute(secid) {
  const sym = tencentSymbol(secid);
  if (!sym || !/^(us|gz|hk|kr)/i.test(sym)) return null;
  const urls = /^us/i.test(sym)
    ? [
        `https://web.ifzq.gtimg.cn/appstock/app/UsMinute/query?code=${encodeURIComponent(sym)}`,
        `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(sym)}`,
      ]
    : [
        `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(sym)}`,
        `https://web.ifzq.gtimg.cn/appstock/app/index/minute/query?code=${encodeURIComponent(sym)}`,
      ];
  return fetchTencentMinuteBySym(secid, sym, urls);
}

async function fetchTencentUsMinute(secid) {
  return fetchTencentForeignMinute(secid);
}

/** A 股闭盘分时兜底：腾讯当日分钟（不影响开盘东财快路径） */
async function fetchTencentAshareMinute(secid) {
  const sym = tencentSymbol(secid);
  if (!sym || !/^(sh|sz|bj)/i.test(sym)) return null;
  return fetchTencentMinuteBySym(secid, sym, [
    `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(sym)}`,
  ]);
}

async function fetchYahooChart(secid, { interval = '1m', range = '1d' } = {}) {
  const sym = yahooSymbol(secid);
  if (!sym) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const vols = quote.volume || [];
    const meta = result.meta || {};
    const points = [];
    for (let i = 0; i < ts.length; i += 1) {
      const close = Number(closes[i]);
      if (!(close > 0)) continue;
      // 日K：用交易所本地日历日；分钟：统一北京时间，与东财海外分时轴一致
      if (interval === '1d' || interval === '1wk' || interval === '1mo') {
        const d = new Date((Number(ts[i]) + (meta.gmtoffset || 0)) * 1000);
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        points.push({
          date: `${d.getUTCFullYear()}-${mm}-${dd}`,
          open: Number(opens[i]) || close,
          close,
          high: Number(highs[i]) || close,
          low: Number(lows[i]) || close,
          volume: Number(vols[i]) || 0,
          amount: 0,
          changePct: null,
        });
      } else {
        const bj = new Date((Number(ts[i]) + 8 * 3600) * 1000);
        const mm = String(bj.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(bj.getUTCDate()).padStart(2, '0');
        const hh = String(bj.getUTCHours()).padStart(2, '0');
        const mi = String(bj.getUTCMinutes()).padStart(2, '0');
        // 单日只留 HH:MM（与东财一致）；五日保留 MM-DD HH:MM
        const clock = `${hh}:${mi}`;
        points.push({
          time: range === '5d' ? `${mm}-${dd} ${clock}` : clock,
          price: close,
          avg: close,
          volume: Number(vols[i]) || 0,
        });
      }
    }
    if (!points.length) return null;
    if (interval === '1d' || interval === '1wk' || interval === '1mo') {
      return { name: meta.shortName || meta.symbol || '', points: pointsFromOhlc(points) };
    }
    return {
      name: meta.shortName || meta.symbol || '',
      code: secid,
      preClose: Number(meta.chartPreviousClose || meta.previousClose || points[0].price) || points[0].price,
      points,
      ndays: range === '5d' ? 5 : 1,
    };
  } catch {
    return null;
  }
}

/** 分时走势。ndays=5 为近五个交易日的分时。 */
export async function fetchIntraday(secid, ndays = 1) {
  const days = ndays > 1 ? 5 : 1;
  // 五日约 5×241 分钟，mpi=1000 会截断成「像当日」；提高到 2400
  const mpi = days > 1 ? 2400 : 1000;
  const q =
    `fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&mpi=${mpi}&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&secid=${encodeURIComponent(secid)}&ndays=${days}&iscr=0&iscca=0`;

  // —— A 股当日：开盘快路径只打 push2，成功立刻返回，不拖慢盘中 ——
  if (days <= 1 && !isForeignSecid(secid)) {
    try {
      const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/trends2/get?${q}`, {
        signal: AbortSignal.timeout(3500),
        cache: 'no-store',
      });
      if (res.ok) {
        const parsed = parseTrendsPayload((await res.json())?.data, days);
        if (parsed?.points?.length) return parsed;
      }
    } catch {
      /* 走闭盘补数 */
    }

    // —— 闭盘 / 空数据补数：his、delay、腾讯分钟并行，不影响上面的开盘快路径 ——
    const closed = await Promise.all([
      (async () => {
        try {
          const res = await fetch(
            `https://push2his.eastmoney.com/api/qt/stock/trends2/get?${q}&_=${Date.now()}`,
            { signal: AbortSignal.timeout(6000), cache: 'no-store' },
          );
          if (!res.ok) return null;
          return parseTrendsPayload((await res.json())?.data, days);
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const res = await fetch(
            `https://push2delay.eastmoney.com/api/qt/stock/trends2/get?${q}&_=${Date.now()}`,
            { signal: AbortSignal.timeout(6000), cache: 'no-store' },
          );
          if (!res.ok) return null;
          return parseTrendsPayload((await res.json())?.data, days);
        } catch {
          return null;
        }
      })(),
      fetchTencentAshareMinute(secid).catch(() => null),
    ]);
    const bestClosed = closed
      .filter((p) => p?.points?.length)
      .sort((a, b) => b.points.length - a.points.length)[0];
    return bestClosed || null;
  }

  // 海外指数 / 五日：多源串试
  const hosts = isForeignSecid(secid)
    ? [
        'https://push2delay.eastmoney.com',
        'https://push2his.eastmoney.com',
        'https://push2.eastmoney.com',
      ]
    : ['https://push2his.eastmoney.com', 'https://push2.eastmoney.com'];

  let best = null;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/qt/stock/trends2/get?${q}`, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseTrendsPayload(json?.data, days);
      if (!parsed?.points?.length) continue;
      if (days <= 1) return parsed;
      const daySet = new Set(
        parsed.points.map((p) => String(p.time || '').slice(0, 5)).filter(Boolean),
      );
      if (daySet.size >= 2 || parsed.points.length > 300) return parsed;
      if (!best || parsed.points.length > best.points.length) best = parsed;
    } catch {
      /* try next */
    }
  }
  if (best?.points?.length) return best;

  if (days <= 1) {
    const tx = await fetchTencentForeignMinute(secid).catch(() => null);
    if (tx?.points?.length) return tx;
  }
  const yahoo = await fetchYahooChart(secid, {
    interval: days > 1 ? '15m' : '1m',
    range: days > 1 ? '5d' : '1d',
  }).catch(() => null);
  if (yahoo?.points?.length) return yahoo;
  return best;
}

function flowClockMinutes(label) {
  const part = String(label || '').includes(' ')
    ? String(label).split(' ').pop()
    : String(label || '');
  const m = part.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 只保留 A 股连续竞价分钟：09:30–11:30、13:00–15:00 */
function isAshareSessionMinute(label) {
  const mins = flowClockMinutes(label);
  if (mins == null) return false;
  return (mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30) || (mins >= 13 * 60 && mins <= 15 * 60);
}

function parseFlowKlines(klines) {
  const yi = 1e8;
  const times = [];
  const main = [];
  const small = [];
  const mid = [];
  const large = [];
  const huge = [];
  let date = '';
  for (const line of klines || []) {
    const p = String(line).split(',');
    const raw = p[0] || '';
    if (!date) date = raw.split(' ')[0] || '';
    const clock = raw.split(' ')[1] || raw;
    // 丢掉午休、盘前盘后杂点，避免 15:00 后还连线
    if (!isAshareSessionMinute(clock)) continue;
    times.push(clock.length >= 5 ? clock.slice(0, 5) : clock);
    main.push(+(Number(p[1]) / yi).toFixed(2));
    small.push(+(Number(p[2]) / yi).toFixed(2));
    mid.push(+(Number(p[3]) / yi).toFixed(2));
    large.push(+(Number(p[4]) / yi).toFixed(2));
    huge.push(+(Number(p[5]) / yi).toFixed(2));
  }
  const last = (arr) => (arr.length ? arr[arr.length - 1] : 0);
  // 东财资金线是开盘累计值；近 30 分钟净变化 = 末值 - 30 分钟前，盘中意图跟这个走才像「在更新」
  const win = Math.min(30, Math.max(0, times.length - 1));
  const idx0 = Math.max(0, times.length - 1 - win);
  const recentMain = times.length ? +(last(main) - main[idx0]).toFixed(2) : 0;
  const recentSmall = times.length ? +(last(small) - small[idx0]).toFixed(2) : 0;
  return {
    date,
    times,
    main,
    small,
    mid,
    large,
    huge,
    summary: {
      main: last(main),
      small: last(small),
      mid: last(mid),
      large: last(large),
      huge: last(huge),
      recentMain,
      recentSmall,
      recentMinutes: win,
      asOf: times.length ? `${date} ${times[times.length - 1]}`.trim() : date,
      fetchedAt: Date.now(),
    },
  };
}

const FLOW_FIELDS =
  'fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';

/** 会话内资金分时缓存：盘后节点常 502，成功一次后刷新不要把图清空 */
const flowCache = new Map();

function isExtensionRuntime() {
  try {
    return typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

/** 东财 push2 主域盘后常 502；延迟/历史竞速。编号节点仅扩展可用（网页有 CORS） */
function eastFlowHosts(numbered = 8) {
  const base = [
    'https://push2delay.eastmoney.com',
    'https://push2his.eastmoney.com',
    'https://push2.eastmoney.com',
  ];
  if (!isExtensionRuntime()) return base;
  const used = new Set();
  const extra = [];
  while (extra.length < numbered && used.size < 99) {
    const n = 1 + Math.floor(Math.random() * 99);
    if (used.has(n)) continue;
    used.add(n);
    extra.push(`https://${n}.push2.eastmoney.com`);
    if (extra.length < numbered) extra.push(`https://${n}.push2delay.eastmoney.com`);
  }
  return [...base, ...extra];
}

async function fetchFlowKlineRace(query, { timeoutMs = 8000, hosts } = {}) {
  const stamp = Date.now();
  const list = hosts || eastFlowHosts();
  // 与东财大盘资金页同款 ut，部分节点无 ut 会空
  const ut = 'ut=b2884a393a59ad64002292a3e90d46a5';
  try {
    return await Promise.any(
      list.map(async (host) => {
        const res = await fetch(
          `${host}/api/qt/stock/fflow/kline/get?${query}&${ut}&_=${stamp}`,
          {
            // 每路独立超时，避免共享 abort 把慢但成功的节点掐掉
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
            headers: { Referer: 'https://data.eastmoney.com/zjlx/dpzjlx.html' },
          },
        );
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        if (!text || text.trim().startsWith('<')) throw new Error('html');
        // 兼容偶发 JSONP 外壳
        const bare = text.trim().startsWith('{')
          ? text
          : text.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
        const json = JSON.parse(bare);
        const out = parseFlowKlines(json?.data?.klines);
        if (!out?.times?.length) throw new Error('empty');
        return out;
      }),
    );
  } catch {
    return null;
  }
}

/** 同花顺 moneyflow last.js：超大/大/中/小 流入、流出 → 净流入分时 */
function parseThsMoneyFlowText(text, { note = '盘后兜底' } = {}) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  const bag = Object.values(JSON.parse(m[0]))[0];
  const raw = String(bag?.data || '');
  if (!raw) return null;
  const dateRaw = String(bag.date || '');
  const date =
    dateRaw.length === 8
      ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
      : dateRaw;
  const yi = 1e8;
  const times = [];
  const main = [];
  const small = [];
  const mid = [];
  const large = [];
  const huge = [];
  for (const line of raw.split(';')) {
    if (!line) continue;
    const p = line.split(',');
    if (p.length < 9) continue;
    const hhmm = String(p[0] || '').padStart(4, '0');
    const clock = `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
    if (!isAshareSessionMinute(clock)) continue;
    const v = p.slice(1, 9).map(Number);
    if (v.some((x) => !Number.isFinite(x))) continue;
    const hugeNet = v[0] - v[1];
    const largeNet = v[2] - v[3];
    const midNet = v[4] - v[5];
    const smallNet = v[6] - v[7];
    times.push(clock);
    huge.push(+(hugeNet / yi).toFixed(2));
    large.push(+(largeNet / yi).toFixed(2));
    mid.push(+(midNet / yi).toFixed(2));
    small.push(+(smallNet / yi).toFixed(2));
    main.push(+((hugeNet + largeNet) / yi).toFixed(2));
  }
  if (!times.length) return null;
  const last = (arr) => (arr.length ? arr[arr.length - 1] : 0);
  const win = Math.min(30, Math.max(0, times.length - 1));
  const idx0 = Math.max(0, times.length - 1 - win);
  return {
    date,
    times,
    main,
    small,
    mid,
    large,
    huge,
    source: 'ths',
    summary: {
      main: last(main),
      small: last(small),
      mid: last(mid),
      large: last(large),
      huge: last(huge),
      recentMain: +(last(main) - main[idx0]).toFixed(2),
      recentSmall: +(last(small) - small[idx0]).toFixed(2),
      recentMinutes: win,
      asOf: `${date} ${times[times.length - 1]}`.trim(),
      fetchedAt: Date.now(),
      note,
    },
  };
}

async function fetchThsMoneyFlowUrls(urls, note) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: {
          Referer: 'https://q.10jqka.com.cn/',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (!res.ok) continue;
      const parsed = parseThsMoneyFlowText(await res.text(), { note });
      if (parsed?.times?.length) return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}

/** 同花顺上证资金分时兜底（东财盘后 fflow 常 502） */
async function fetchThsMarketMoneyFlow() {
  return fetchThsMoneyFlowUrls(
    [
      'https://d.10jqka.com.cn/v6/moneyflow/hs_1A0001/last.js',
      'https://d.10jqka.com.cn/v2/moneyflow/hs_1A0001/last.js',
    ],
    '上证分时·盘后兜底',
  );
}

/** secid → 同花顺 moneyflow 代码（沪 hs_ / 深 sz_） */
function thsMoneyFlowCodes(secid) {
  const [mk, code] = String(secid || '').split('.');
  const c = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(c)) return [];
  if (mk === '1' || c.startsWith('6') || c.startsWith('9')) return [`hs_${c}`];
  if (mk === '0' || c.startsWith('0') || c.startsWith('3')) return [`sz_${c}`, `hs_${c}`];
  if (/^(92|8|4)/.test(c)) return [`hs_${c}`, `sz_${c}`];
  return [`hs_${c}`, `sz_${c}`];
}

/** 个股同花顺分时资金兜底（沪市盘后较稳；深市常空） */
async function fetchThsStockMoneyFlow(secid) {
  const codes = thsMoneyFlowCodes(secid);
  const urls = codes.flatMap((code) => [
    `https://d.10jqka.com.cn/v6/moneyflow/${code}/last.js`,
    `https://d.10jqka.com.cn/v2/moneyflow/${code}/last.js`,
  ]);
  return fetchThsMoneyFlowUrls(urls, '分时·盘后兜底');
}

/** 盘后东财分时挂掉时，用日资金摘要填卡片（避免整块「暂无资金」） */
async function fetchStockFlowDaySummary(secid) {
  const q = `lmt=3&klt=101&secid=${encodeURIComponent(secid)}&${FLOW_FIELDS}`;
  const hosts = [
    'https://push2his.eastmoney.com',
    'https://push2delay.eastmoney.com',
    'https://push2.eastmoney.com',
  ];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/qt/stock/fflow/daykline/get?${q}&_=${Date.now()}`, {
        signal: AbortSignal.timeout(7000),
        cache: 'no-store',
        headers: { Referer: 'https://data.eastmoney.com/zjlx/' },
      });
      if (!res.ok) continue;
      const lines = (await res.json())?.data?.klines || [];
      if (!lines.length) continue;
      const last = String(lines[lines.length - 1] || '').split(',');
      const date = last[0] || '';
      const yi = 1e8;
      const main = +(Number(last[1] || 0) / yi).toFixed(2);
      const small = +(Number(last[2] || 0) / yi).toFixed(2);
      const mid = +(Number(last[3] || 0) / yi).toFixed(2);
      const large = +(Number(last[4] || 0) / yi).toFixed(2);
      const huge = +(Number(last[5] || 0) / yi).toFixed(2);
      return {
        date,
        times: [],
        main: [],
        small: [],
        mid: [],
        large: [],
        huge: [],
        source: 'day',
        summary: {
          main,
          small,
          mid,
          large,
          huge,
          recentMain: null,
          recentSmall: null,
          recentMinutes: 0,
          asOf: date,
          fetchedAt: Date.now(),
          note: '日资金·盘后摘要',
        },
      };
    } catch {
      /* next */
    }
  }
  return null;
}

function rememberMarketFlow(parsed) {
  if (!parsed?.times?.length) return parsed;
  flowCache.set('market', parsed);
  try {
    localStorage.setItem(
      'gt_market_flow_v1',
      JSON.stringify({
        date: parsed.date,
        times: parsed.times,
        main: parsed.main,
        small: parsed.small,
        mid: parsed.mid,
        large: parsed.large,
        huge: parsed.huge,
        summary: parsed.summary,
        source: parsed.source || 'east',
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* private mode */
  }
  return parsed;
}

function readCachedMarketFlow() {
  const mem = flowCache.get('market');
  if (mem?.times?.length) return mem;
  try {
    const raw = localStorage.getItem('gt_market_flow_v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.times?.length) return null;
    // 只复用当日缓存，隔日作废
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (parsed.date && parsed.date !== ymd) return null;
    flowCache.set('market', parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 沪深大盘主力资金分时。
 * 盘后东财 fflow 常 502：多节点竞速 → 同花顺上证兜底 → 会话/本地缓存。
 */
export async function fetchMarketMoneyFlow() {
  const dual =
    `lmt=0&klt=1&secid=1.000001&secid2=0.399001&${FLOW_FIELDS}`;
  const solo =
    `lmt=0&klt=1&secid=1.000001&${FLOW_FIELDS}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed =
      (await fetchFlowKlineRace(dual, { timeoutMs: 5000 + attempt * 700 })) ||
      (await fetchFlowKlineRace(solo, { timeoutMs: 4000 + attempt * 500 }));
    if (parsed?.times?.length) return rememberMarketFlow(parsed);
    if (attempt < 1) await new Promise((r) => setTimeout(r, 300));
  }

  const ths = await fetchThsMarketMoneyFlow();
  if (ths?.times?.length) return rememberMarketFlow(ths);

  return readCachedMarketFlow();
}

/**
 * 单只股票的估值与盘口，只在点 AI 时拉，不进自选轮询。
 * 成交额/市值单位：亿元。
 */
export async function fetchStockSnapshot(secid) {
  const fields = 'f12,f14,f2,f3,f6,f7,f8,f9,f10,f15,f16,f17,f18,f20,f21,f23,f100,f103,f124';
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=${fields}&secids=${encodeURIComponent(secid)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const row = (await res.json())?.data?.diff?.[0];
  if (!row) return null;
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const yi = (v) => {
    const x = n(v);
    return x == null ? null : x / 1e8;
  };
  return {
    name: row.f14 || '',
    price: n(row.f2),
    changePct: n(row.f3),
    amountYi: yi(row.f6),
    amplitude: n(row.f7),
    turnover: n(row.f8),
    pe: n(row.f9),
    volumeRatio: n(row.f10),
    high: n(row.f15),
    low: n(row.f16),
    open: n(row.f17),
    prevClose: n(row.f18),
    totalMvYi: yi(row.f20),
    floatMvYi: yi(row.f21),
    pb: n(row.f23),
    updatedAt: row.f124 ? row.f124 * 1000 : Date.now(),
    industry: row.f100 || '',
    concepts: String(row.f103 || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

/** 近几日主力拆单（亿元）。无数据时返回空数组。 */
export async function fetchStockFlowDays(secid, limit = 8) {
  const q =
    `lmt=${limit}&klt=101&secid=${encodeURIComponent(secid)}` +
    '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
  const urls = [
    `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?${q}`,
    `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?${q}`,
  ];
  const yi = 1e8;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const lines = (await res.json())?.data?.klines || [];
      if (!lines.length) continue;
      return lines.map((line) => {
        const p = String(line).split(',');
        const yuan = (i) => +(Number(p[i] || 0) / yi).toFixed(2);
        return {
          date: p[0],
          main: yuan(1),
          small: yuan(2),
          mid: yuan(3),
          large: yuan(4),
          huge: yuan(5),
          changePct: Number(p[12]),
        };
      });
    } catch {
      /* try next */
    }
  }
  return [];
}

/**
 * 腾讯行情，用来和东财对一下现价。只覆盖沪深京港。
 * 时间字段是行情源自己的时间，不是本机点击时间。
 */
export async function fetchTencentStockQuote(item) {
  const code = String(item?.code || '').trim();
  const market = item?.market;
  let symbol = '';
  if (market === 'SH') symbol = `sh${code}`;
  else if (market === 'SZ') symbol = `sz${code}`;
  else if (market === 'BJ') symbol = `bj${code}`;
  else if (market === 'HK') symbol = `hk${code.padStart(5, '0')}`;
  else return null;
  const text = await fetchTextGbk(`https://qt.gtimg.cn/q=${symbol}&_=${Date.now()}`);
  const m = text.match(/="([^"]*)"/);
  if (!m) return null;
  const p = m[1].split('~');
  const price = Number(p[3]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const raw = String(p[30] || '');
  const time = /^\d{14}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`
    : '';
  return {
    price,
    prevClose: Number(p[4]),
    changePct: Number(p[32]),
    time,
    source: 'tencent',
  };
}

/** 标题里带这只股票的近期资讯。 */
export async function fetchStockHeadlines(keyword, limit = 6) {
  const name = String(keyword || '').trim();
  if (name.length < 2) return [];
  const param = {
    uid: '',
    keyword: name,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'time',
        pageIndex: 1,
        pageSize: limit,
        preTag: '',
        postTag: '',
      },
    },
  };
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(JSON.stringify(param))}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  const rows = JSON.parse(text.slice(start, end + 1))?.result?.cmsArticleWebOld || [];
  return rows.slice(0, limit).map((r) => ({
    title: String(r.title || '').replace(/<[^>]+>/g, '').trim(),
    time: String(r.date || '').slice(0, 16),
    source: r.mediaName || '',
  })).filter((r) => r.title);
}

/** A 股公告。港美韩没有这套代码时返回空。 */
export async function fetchStockAnnouncements(code, limit = 3) {
  const c = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(c)) return [];
  const url =
    `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${limit}` +
    `&page_index=1&ann_type=A&client_source=web&stock_list=${c}&f_node=0&s_node=0`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const list = (await res.json())?.data?.list || [];
  return list.slice(0, limit).map((r) => ({
    title: String(r.title_ch || r.title || '').trim(),
    date: String(r.notice_date || '').slice(0, 10),
  })).filter((r) => r.title);
}

/** 行业板块今天的涨跌。名称对不上时返回 null。 */
export async function fetchIndustryMove(name) {
  const q = String(name || '').trim();
  if (q.length < 2) return null;
  const searchUrl =
    `https://search-codetable.eastmoney.com/codetable/search/web?client=web&keyword=${encodeURIComponent(q)}` +
    '&pageNumber=1&pageSize=6';
  const res = await fetch(searchUrl);
  if (!res.ok) return null;
  const rows = (await res.json())?.result || [];
  const hit =
    rows.find((r) => Number(r.market) === 90 && String(r.shortName || '') === q) ||
    rows.find((r) => Number(r.market) === 90);
  if (!hit?.code) return null;
  const quoteUrl =
    `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f12,f14,f3&secids=${encodeURIComponent(`90.${hit.code}`)}`;
  const row = (await (await fetch(quoteUrl)).json())?.data?.diff?.[0];
  if (!row) return null;
  const changePct = Number(row.f3);
  return {
    name: row.f14 || hit.shortName || q,
    code: String(hit.code),
    changePct: Number.isFinite(changePct) ? changePct : null,
  };
}

/**
 * 近几次龙虎榜。45 日内没有则 recent 为空，note 说明上次日期。
 * 净额单位：亿元。
 */
export async function fetchDragonTiger(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(c)) return { recent: [], note: '非A股无龙虎榜' };
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW' +
    '&columns=TRADE_DATE,EXPLAIN,CHANGE_RATE,BILLBOARD_NET_AMT,EXPLANATION' +
    `&filter=(SECURITY_CODE=%22${c}%22)&pageNumber=1&pageSize=12&sortColumns=TRADE_DATE&sortTypes=-1`;
  const res = await fetch(url);
  if (!res.ok) return { recent: [], note: '龙虎榜未取到' };
  const rows = (await res.json())?.result?.data || [];
  const seen = new Set();
  const all = [];
  for (const r of rows) {
    const date = String(r.TRADE_DATE || '').slice(0, 10);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    all.push({
      date,
      changePct: Number(r.CHANGE_RATE),
      netYi: +(Number(r.BILLBOARD_NET_AMT || 0) / 1e8).toFixed(2),
      reason: String(r.EXPLANATION || '').trim(),
      seats: String(r.EXPLAIN || '').trim(),
    });
  }
  const cutoff = Date.now() - 45 * 86400000;
  const recent = all.filter((x) => new Date(`${x.date}T00:00:00`).getTime() >= cutoff).slice(0, 3);
  if (recent.length) return { recent, note: '' };
  if (all[0]) return { recent: [], note: `近45日未上龙虎榜，上次是 ${all[0].date}` };
  return { recent: [], note: '没有龙虎榜记录' };
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rememberStockFlow(secid, parsed) {
  if (!parsed) return parsed;
  const key = `stock:${secid}`;
  flowCache.set(key, parsed);
  if (!parsed.times?.length && !parsed.summary) return parsed;
  try {
    localStorage.setItem(
      `gt_stock_flow_v1:${secid}`,
      JSON.stringify({ ...parsed, savedAt: Date.now() }),
    );
  } catch {
    /* private mode */
  }
  return parsed;
}

function readCachedStockFlow(secid) {
  const key = `stock:${secid}`;
  const mem = flowCache.get(key);
  if (mem?.times?.length || mem?.summary) return mem;
  try {
    const raw = localStorage.getItem(`gt_stock_flow_v1:${secid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.date && parsed.date !== todayYmd()) return null;
    if (!parsed?.times?.length && !parsed?.summary) return null;
    flowCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 个股主力资金分时。
 * 盘后东财分钟 fflow 常 502/CORS：竞速 → 同花顺分时 → 日资金摘要 → 缓存。
 */
export async function fetchStockMoneyFlow(secid) {
  if (!secid || isForeignSecid(secid)) return parseFlowKlines([]);
  const q = `lmt=0&klt=1&secid=${encodeURIComponent(secid)}&${FLOW_FIELDS}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parsed = await fetchFlowKlineRace(q, {
      timeoutMs: 7000 + attempt * 1000,
      hosts: eastFlowHosts(6),
    });
    if (parsed?.times?.length) return rememberStockFlow(secid, parsed);
    if (attempt < 2) await new Promise((r) => setTimeout(r, 350 + attempt * 250));
  }

  const ths = await fetchThsStockMoneyFlow(secid);
  if (ths?.times?.length) return rememberStockFlow(secid, ths);

  const cached = readCachedStockFlow(secid);
  if (cached?.times?.length) return cached;

  const day = await fetchStockFlowDaySummary(secid);
  if (day?.summary) return rememberStockFlow(secid, day);

  return cached || parseFlowKlines([]);
}

/** 涨跌家数分布 */
export async function fetchUpDownDistribution() {
  const url =
    'https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt';
  const res = await fetch(url);
  const json = await res.json();
  const fenbu = json?.data?.fenbu || [];
  const map = {};
  for (const obj of fenbu) {
    const [k, v] = Object.entries(obj)[0] || [];
    map[Number(k)] = Number(v);
  }
  const order = [-11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const labels = order.map((n) => {
    if (n === -11) return '跌停';
    if (n === 11) return '涨停';
    if (n === 0) return '平';
    return `${n > 0 ? '+' : ''}${n}%`;
  });
  const values = order.map((n) => map[n] || 0);
  const down = values.slice(0, 11).reduce((a, b) => a + b, 0);
  const flat = values[11] || 0;
  const up = values.slice(12).reduce((a, b) => a + b, 0);
  return {
    labels,
    values,
    up,
    down,
    flat,
    limitUp: map[11] || 0,
    limitDown: map[-11] || 0,
  };
}

/** 北向资金分时（亿元） */
export async function fetchNorthbound() {
  const url =
    'https://push2.eastmoney.com/api/qt/kamt.rtmin/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56';
  const res = await fetch(url);
  const json = await res.json();
  const s2n = json?.data?.s2n || [];
  const times = [];
  const net = [];
  for (const line of s2n) {
    const p = String(line).split(',');
    times.push(p[0]);
    // 常见字段：时间,沪股通净流入,深股通净流入,... 单位元
    const hu = Number(p[1] || 0);
    const shen = Number(p[2] || 0);
    net.push(+((hu + shen) / 1e8).toFixed(2));
  }
  const rawDate = String(json?.data?.s2nDate || '');
  const date = /^\d{2}-\d{2}$/.test(rawDate) ? `${new Date().getFullYear()}-${rawDate}` : rawDate;
  return {
    date,
    times,
    net,
    last: net.length ? net[net.length - 1] : 0,
  };
}

function pointsFromOhlc(rows) {
  const points = [];
  let prev = null;
  for (const row of rows) {
    const close = Number(row.close);
    const rawPct = row.changePct == null || row.changePct === '' ? NaN : Number(row.changePct);
    const computed = prev > 0 ? ((close - prev) / prev) * 100 : NaN;
    points.push({
      date: row.date,
      open: Number(row.open),
      close,
      high: Number(row.high),
      low: Number(row.low),
      volume: Number(row.volume) || 0,
      amount: Number(row.amount) || 0,
      changePct: Number.isFinite(rawPct) ? rawPct : Number.isFinite(computed) ? computed : null,
    });
    if (close > 0) prev = close;
  }
  return points;
}

function tencentSymbol(secid) {
  const [mk, code] = String(secid || '').split('.');
  if (!code) return '';
  if (mk === '1') return `sh${code}`;
  if (mk === '0') return /^(8|4|92)/.test(code) ? `bj${code}` : `sz${code}`;
  if (mk === '116') return `hk${code.padStart(5, '0')}`;
  if (mk === '105' || mk === '106' || mk === '107') return `us${String(code).toUpperCase()}`;
  if (mk === '100') {
    const c = String(code).toUpperCase();
    const direct = {
      HSI: 'hkHSI',
      HSTECH: 'hkHSTECH',
      HSCEI: 'hkHSCEI',
      NDX: 'usNDX',
      NDX100: 'usNDX',
      DJIA: 'usDJI',
      DJI: 'usDJI',
      SPX: 'usSPX',
      IXIC: 'usIXIC',
      // jpN225 在腾讯常 none_match；日经走全球指数 gzN225
      N225: 'gzN225',
      KS11: 'gzKS11',
      KQ11: 'gzKOSDAQ',
    };
    return direct[c] || `gz${c}`;
  }
  if (mk === '101') {
    const c = String(code).toUpperCase();
    if (c === 'GC00Y' || c === 'GC' || c.startsWith('GC')) return 'hf_GC';
  }
  if (mk === '177') return `kr${code}`;
  return '';
}

/** Yahoo 指数符号（东财/腾讯分时或日K不通时的兜底） */
function yahooSymbol(secid) {
  const [mk, code] = String(secid || '').split('.');
  const c = String(code || '').toUpperCase();
  if (mk === '100') {
    const map = {
      NDX: '%5ENDX',
      NDX100: '%5ENDX',
      DJIA: '%5EDJI',
      DJI: '%5EDJI',
      SPX: '%5EGSPC',
      IXIC: '%5EIXIC',
      HSI: '%5EHSI',
      N225: '%5EN225',
      KS11: '%5EKS11',
      KOSPI200: '%5EKOSPI200',
    };
    return map[c] || '';
  }
  if (mk === '101' && /^GC/i.test(c)) return 'GC=F';
  if (mk === '105' || mk === '106' || mk === '107') return c;
  if (mk === '116') return `${c.padStart(4, '0')}.HK`;
  // A 股：周/月 K 在东财、腾讯挂掉时走 Yahoo
  if ((mk === '1' || mk === '0') && /^\d{6}$/.test(c)) {
    if (mk === '1' || c.startsWith('6') || c.startsWith('9')) return `${c}.SS`;
    if (/^(92|8|4)/.test(c)) return `${c}.BJ`;
    return `${c}.SZ`;
  }
  return '';
}

function isForeignSecid(secid) {
  const mk = String(secid || '').split('.')[0];
  return mk === '100' || mk === '101' || mk === '105' || mk === '106' || mk === '107' || mk === '116' || mk === '177';
}

function parseTencentQuoteLine(line) {
  const matched = line.match(/v_([a-z0-9_.]+)="([^"]*)"/i);
  if (!matched) return null;
  const sym = matched[1].toLowerCase();
  if (sym.startsWith('hf_')) {
    const bits = String(matched[2] || '').split(',');
    const price = Number(bits[0]);
    const changePct = Number(bits[1]);
    const prev = Number(bits[7]);
    if (!(price > 0)) return null;
    let pct = Number.isFinite(changePct) ? changePct : null;
    if ((!Number.isFinite(pct) || pct === 0) && prev > 0) {
      const computed = ((price - prev) / prev) * 100;
      if (Number.isFinite(computed)) pct = computed;
    }
    return {
      symbol: sym,
      name: bits[bits.length - 1] || '',
      price,
      prevClose: Number.isFinite(prev) ? prev : null,
      open: Number(bits[2]),
      change: Number.isFinite(pct) && prev > 0 ? (price - prev) : null,
      changePct: pct,
      high: Number(bits[4]),
      low: Number(bits[5]),
      amount: null,
    };
  }
  const parts = matched[2].split('~');
  if (sym.startsWith('gz')) {
    const price = Number(parts[3]);
    const change = Number(parts[4]);
    const changePct = Number(parts[5]);
    if (!(price > 0)) return null;
    return {
      symbol: matched[1].toLowerCase(),
      name: parts[1] || '',
      price,
      prevClose: null,
      open: null,
      change: Number.isFinite(change) ? change : null,
      changePct: Number.isFinite(changePct) ? changePct : null,
      high: null,
      low: null,
      amount: null,
    };
  }
  const price = Number(parts[3]);
  const prev = Number(parts[4]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const change = Number(parts[31]);
  let changePct = Number(parts[32]);
  if ((!Number.isFinite(changePct) || changePct === 0) && prev > 0) {
    const computed = ((price - prev) / prev) * 100;
    if (Number.isFinite(computed) && (changePct !== 0 || Math.abs(computed) >= 0.005)) changePct = computed;
  }
  return {
    symbol: matched[1].toLowerCase(),
    name: parts[1] || '',
    price,
    prevClose: Number.isFinite(prev) ? prev : null,
    open: Number(parts[5]),
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    high: Number(parts[33]),
    low: Number(parts[34]),
    amount: tencentAmount(parts),
  };
}

function tencentAmount(parts) {
  for (const part of parts) {
    const bits = String(part).split('/');
    if (bits.length >= 3 && Number(bits[2]) > 0) return Number(bits[2]);
  }
  return null;
}

async function fetchTencentSnapshots(list) {
  const metas = [];
  for (const meta of list || []) {
    const secid = meta.secid || toSecid(meta.market, meta.code, meta.marketNo);
    const symbol = tencentSymbol(secid);
    if (!symbol) continue;
    metas.push({ meta, secid, symbol: symbol.toLowerCase(), query: symbol });
  }
  const bySymbol = new Map();
  const queries = [...new Set(metas.map((row) => row.query))];
  for (let i = 0; i < queries.length; i += 40) {
    try {
      const text = await fetchTextGbk(`https://qt.gtimg.cn/q=${queries.slice(i, i + 40).join(',')}`);
      for (const line of text.split(';')) {
        const row = parseTencentQuoteLine(line);
        if (row) bySymbol.set(row.symbol, row);
      }
    } catch {
      /* next chunk */
    }
  }
  return metas.map(({ meta, secid, symbol }) => {
    const row = bySymbol.get(symbol);
    if (!row) return { ...meta, secid, price: null, changePct: null };
    return {
      ...meta,
      secid,
      name: row.name || meta.name,
      price: row.price,
      changePct: row.changePct,
      change: row.change,
      high: row.high,
      low: row.low,
      open: row.open,
      prevClose: row.prevClose,
      amount: row.amount,
      updatedAt: Date.now(),
    };
  });
}

async function fetchEastKline(secid, klt, lmt) {
  const hosts = isForeignSecid(secid)
    ? [
        'https://push2delay.eastmoney.com',
        'https://push2his.eastmoney.com',
        'https://push2.eastmoney.com',
      ]
    : ['https://push2his.eastmoney.com', 'https://push2.eastmoney.com'];
  for (const host of hosts) {
    try {
      const url =
        `${host}/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}` +
        `&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101&iscca=1` +
        `&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59&forcect=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!res.ok) continue;
      const json = await res.json();
      const lines = json?.data?.klines || [];
      if (!lines.length) continue;
      return {
        name: json?.data?.name || '',
        points: lines.map((line) => {
          const p = String(line).split(',');
          const changePct = Number(p[8] ?? p[7]);
          return {
            date: p[0],
            open: Number(p[1]),
            close: Number(p[2]),
            high: Number(p[3]),
            low: Number(p[4]),
            volume: Number(p[5]),
            amount: Number(p[6]),
            changePct: Number.isFinite(changePct) ? changePct : null,
          };
        }).filter((row) => row.date && row.close > 0),
      };
    } catch {
      /* next host */
    }
  }
  return null;
}

async function fetchYahooKline(secid, klt, lmt) {
  const interval = { 101: '1d', 102: '1wk', 103: '1mo' }[klt] || '1d';
  const range =
    interval === '1mo' ? '5y' : interval === '1wk' ? '2y' : lmt <= 10 ? '1mo' : lmt <= 40 ? '3mo' : '1y';
  const pack = await fetchYahooChart(secid, { interval, range });
  if (!pack?.points?.length) return null;
  return { name: pack.name || '', points: pack.points.slice(-lmt) };
}

function parseTencentKlineBag(json, sym, period) {
  const bag = json?.data?.[sym] || json?.data?.[String(sym).toLowerCase()] || {};
  const rows = bag[`qfq${period}`] || bag[period] || bag[`qfq${period}s`] || [];
  if (!Array.isArray(rows) || !rows.length) return null;
  const points = pointsFromOhlc(
    rows.map((row) => ({
      date: row[0],
      open: row[1],
      close: row[2],
      high: row[3],
      low: row[4],
      volume: row[5],
    })),
  ).filter((row) => row.date && row.close > 0);
  return points.length ? { name: '', points } : null;
}

async function fetchTencentKline(secid, klt, lmt) {
  const sym = tencentSymbol(secid);
  if (!sym) return null;
  const period = { 101: 'day', 102: 'week', 103: 'month', 106: 'year' }[klt] || 'day';
  const param = `${sym},${period},,,${lmt},qfq`;
  const urls = [
    `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${param}`,
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${param}`,
    `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${param}`,
    `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=${param}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(7000),
        headers: { Referer: 'https://finance.qq.com/' },
      });
      if (!res.ok) continue;
      const parsed = parseTencentKlineBag(await res.json(), sym, period);
      if (parsed?.points?.length) return parsed;
    } catch {
      /* next mirror */
    }
  }
  return null;
}

async function fetchSinaKline(secid, klt, lmt) {
  if (klt !== 101) return null;
  const sym = tencentSymbol(secid);
  if (!sym || sym.startsWith('us') || sym.startsWith('hk')) return null;
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${sym}&scale=240&ma=no&datalen=${lmt}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    name: '',
    points: pointsFromOhlc(
      rows.map((row) => ({
        date: row.day,
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
      })),
    ).filter((row) => row.date && row.close > 0),
  };
}

/** 用日 K 拼周/月，东财和腾讯周月接口都挂时还能画图。 */
function aggregateDailyKline(points, klt) {
  if (klt !== 102 && klt !== 103) return [];
  const rows = (points || []).filter((p) => p?.date && Number(p.close) > 0);
  if (!rows.length) return [];
  const groups = new Map();
  for (const row of rows) {
    const day = String(row.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    let key = day.slice(0, 7);
    if (klt === 102) {
      const [y, m, d] = day.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const wd = dt.getUTCDay(); // 0日 … 5五
      const toFri = wd === 0 ? -2 : 5 - wd;
      dt.setUTCDate(dt.getUTCDate() + toFri);
      key = dt.toISOString().slice(0, 10);
    }
    const bag = groups.get(key) || {
      date: key,
      open: Number(row.open),
      close: Number(row.close),
      high: Number(row.high),
      low: Number(row.low),
      volume: 0,
      amount: 0,
    };
    bag.high = Math.max(bag.high, Number(row.high) || bag.high);
    bag.low = Math.min(bag.low, Number(row.low) || bag.low);
    bag.close = Number(row.close);
    bag.volume += Number(row.volume) || 0;
    bag.amount += Number(row.amount) || 0;
    bag.date = day; // 显示该段最后交易日
    groups.set(key, bag);
  }
  return pointsFromOhlc([...groups.values()]);
}

async function fetchDailyThenAggregate(secid, klt, lmt) {
  if (klt !== 102 && klt !== 103) return null;
  const need = klt === 103 ? Math.max(lmt * 22, 260) : Math.max(lmt * 5, 120);
  const day =
    (await fetchTencentKline(secid, 101, need).catch(() => null)) ||
    (await fetchEastKline(secid, 101, need).catch(() => null)) ||
    (await fetchSinaKline(secid, 101, need).catch(() => null)) ||
    (await fetchYahooKline(secid, 101, need).catch(() => null));
  const points = aggregateDailyKline(day?.points || [], klt).slice(-lmt);
  return points.length ? { name: day?.name || '', points } : null;
}

/** 日/周/月/年 K。闭盘也要能画：腾讯优先，东财其次，再 Yahoo / 新浪，周月可从日 K 合成。 */
export async function fetchKline(secid, klt = 101, lmt = 80) {
  const tx = await fetchTencentKline(secid, klt, lmt).catch(() => null);
  if (tx?.points?.length) return tx;
  const east = await fetchEastKline(secid, klt, lmt).catch(() => null);
  if (east?.points?.length) return east;
  const yahoo = await fetchYahooKline(secid, klt, lmt).catch(() => null);
  if (yahoo?.points?.length) return yahoo;
  const sina = await fetchSinaKline(secid, klt, lmt).catch(() => null);
  if (sina?.points?.length) return sina;
  const built = await fetchDailyThenAggregate(secid, klt, lmt).catch(() => null);
  if (built?.points?.length) return built;
  return { name: '', points: [] };
}

/** 沪深两市成交额等。东财列表不通时，用腾讯指数成交额。 */
export async function fetchMarketOverview() {
  try {
    const url =
      'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f1,f2,f3,f4,f6,f12,f13,f14,f104,f105,f106';
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error('overview');
    const json = await res.json();
    const diff = json?.data?.diff || [];
    if (diff.length) {
      let amount = 0;
      let up = 0;
      let down = 0;
      let flat = 0;
      for (const row of diff) {
        amount += Number(row.f6 || 0);
        up += Number(row.f104 || 0);
        down += Number(row.f105 || 0);
        flat += Number(row.f106 || 0);
      }
      return {
        amountYi: +(amount / 1e8).toFixed(2),
        up,
        down,
        flat,
        rows: diff,
      };
    }
  } catch {
    /* tencent */
  }
  const rows = await fetchTencentSnapshots([
    { name: '上证指数', code: '000001', market: 'SH', marketNo: 1, secid: '1.000001' },
    { name: '深证成指', code: '399001', market: 'SZ', marketNo: 0, secid: '0.399001' },
  ]);
  const amount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    amountYi: amount > 0 ? +(amount / 1e8).toFixed(2) : null,
    up: null,
    down: null,
    flat: null,
    rows,
  };
}

/** 涨跌 TOP：po=1 涨幅，po=0 跌幅 */
export async function fetchTopMovers(direction = 'up', limit = 100) {
  const po = direction === 'up' ? 1 : 0;
  try {
    const url =
      `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=${po}&np=1` +
      `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3` +
      `&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048` +
      `&fields=f12,f13,f14,f2,f3,f4,f6`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error('clist');
    const json = await res.json();
    const rows = json?.data?.diff || [];
    if (rows.length) {
      return rows.map((row) => ({
        code: String(row.f12),
        marketNo: Number(row.f13),
        name: row.f14,
        price: Number(row.f2),
        changePct: Number(row.f3),
        change: Number(row.f4),
        amount: Number(row.f6),
        market: Number(row.f13) === 1 ? 'SH' : 'SZ',
        kind: 'stock',
        secid: `${row.f13}.${row.f12}`,
        label: Number(row.f13) === 1 ? '沪' : '深',
      }));
    }
  } catch {
    /* sina */
  }
  const asc = direction === 'up' ? 0 : 1;
  const sina =
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
    `?page=1&num=${Math.min(limit + 30, 120)}&sort=changepercent&asc=${asc}&node=hs_a`;
  const res = await fetch(sina, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && !/^N/.test(String(row.name)))
    .slice(0, limit)
    .map((row) => {
      const symbol = String(row.symbol || '');
      const code = String(row.code || '');
      const market = symbol.startsWith('sh') ? 'SH' : symbol.startsWith('bj') ? 'BJ' : 'SZ';
      const marketNo = market === 'SH' ? 1 : 0;
      return {
        code,
        marketNo,
        name: row.name,
        price: Number(row.trade),
        changePct: Number(row.changepercent),
        change: Number(row.pricechange),
        amount: Number(row.amount) || null,
        market,
        kind: 'stock',
        secid: `${marketNo}.${code}`,
        label: market === 'SH' ? '沪' : market === 'BJ' ? '京' : '深',
      };
    });
}

function mapBoardRows(rows) {
  return rows.map((row) => ({
    code: String(row.code || row.f12 || ''),
    name: row.name || row.f14,
    price: Number(row.price ?? row.f2),
    changePct: Number(row.changePct ?? row.f3),
    mainFlow: row.f62 == null && row.mainFlow == null ? null : Number(row.mainFlow ?? row.f62 ?? 0) / (row.f62 == null ? 1 : 1e8),
    secid: row.secid || (row.f12 ? `90.${row.f12}` : ''),
    kind: 'stock',
    market: 'BK',
    marketNo: 90,
    label: '板块',
  }));
}

async function fetchEastBoards(type) {
  const fs = type === 'concept' ? 'm:90+t:3' : type === 'region' ? 'm:90+t:1' : 'm:90+t:2';
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${fs}` +
    `&fields=f12,f14,f2,f3,f62,f66,f184`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return mapBoardRows(json?.data?.diff || []);
}

async function fetchSinaBoards(type) {
  const url =
    type === 'concept'
      ? 'https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class'
      : type === 'region'
        ? 'https://money.finance.sina.com.cn/q/view/newFLJK.php?param=area'
        : 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php';
  const text = await fetchTextGbk(url);
  const matched = text.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!matched) return [];
  const obj = JSON.parse(matched[1]);
  const rows = Object.values(obj)
    .map((line) => {
      const p = String(line).split(',');
      return {
        code: p[0],
        name: p[1],
        price: Number(p[3]),
        changePct: Number(p[5]),
        mainFlow: null,
        secid: '',
      };
    })
    .filter((row) => row.name && Number.isFinite(row.changePct))
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 80);
  return mapBoardRows(rows);
}

async function fetchTencentBoardQuotes(type) {
  const list = TENCENT_BOARDS[type] || TENCENT_BOARDS.industry || [];
  const rows = [];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const text = await fetchTextGbk(`https://qt.gtimg.cn/q=${chunk.map((b) => `s_${b.code}`).join(',')}`);
    for (const line of text.split(';')) {
      const matched = line.match(/="([^"]*)"/);
      if (!matched) continue;
      const p = matched[1].split('~');
      const changePct = Number(p[5]);
      if (!p[1] || !Number.isFinite(changePct)) continue;
      rows.push({
        code: p[2] || '',
        name: p[1],
        price: Number(p[3]),
        changePct,
        mainFlow: null,
        secid: '',
      });
    }
  }
  return mapBoardRows(rows.sort((a, b) => b.changePct - a.changePct));
}

/** 板块涨跌：industry / concept / region。东财、新浪不通时用腾讯板块行情。 */
export async function fetchBoards(type = 'industry') {
  try {
    const rows = await fetchEastBoards(type);
    if (rows.length) return rows;
  } catch {
    /* next */
  }
  try {
    const sina = await fetchSinaBoards(type);
    if (sina.length) return sina;
  } catch {
    /* next */
  }
  return fetchTencentBoardQuotes(type);
}

export function shTradeDates(count = 4) {
  const out = [];
  for (let i = 0; i < Math.max(20, count * 2) && out.length < count; i += 1) {
    const dt = new Date(Date.now() - i * 86400000);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(dt);
    if (wd === 'Sat' || wd === 'Sun') continue;
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(dt);
    out.push(ymd);
  }
  return out;
}

async function fetchTopicPool(kind, date, pagesize) {
  const path =
    kind === 'zb' ? 'getTopicZBPool' : kind === 'yzt' ? 'getYesterdayZTPool' : 'getTopicZTPool';
  const sort = kind === 'zt' ? 'lbc:desc' : kind === 'zb' ? 'fbt:asc' : 'zs:desc';
  const compact = String(date).replace(/-/g, '');
  const url =
    `https://push2ex.eastmoney.com/${path}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=${pagesize}&sort=${sort}&date=${compact}`;
  const res = await fetch(url);
  if (!res.ok) return { tc: 0, pool: [] };
  const json = await res.json();
  return { tc: Number(json?.data?.tc || 0), pool: json?.data?.pool || [] };
}

function limitUpPct(code) {
  const c = String(code || '');
  if (c.startsWith('300') || c.startsWith('301') || c.startsWith('688')) return 19.5;
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return 29;
  return 9.5;
}

/** 连板高度、炸板率、昨日涨停溢价、首板晋级。取最近一个有涨停池的交易日。 */
export async function fetchLimitSentiment() {
  for (const date of shTradeDates(4)) {
    const [zt, zb, yzt] = await Promise.all([
      fetchTopicPool('zt', date, 100),
      fetchTopicPool('zb', date, 20),
      fetchTopicPool('yzt', date, 200),
    ]);
    if (!zt.tc && !yzt.tc) continue;
    const height = zt.pool.reduce((m, row) => Math.max(m, Number(row.lbc) || 0), 0);
    const zbRate = zt.tc + zb.tc > 0 ? zb.tc / (zt.tc + zb.tc) : null;
    const premium = yzt.pool.length
      ? yzt.pool.reduce((s, row) => s + (Number(row.zdp) || 0), 0) / yzt.pool.length
      : null;
    const first = yzt.pool.filter((row) => Number(row.ylbc) === 1);
    const promo = first.filter((row) => Number(row.zdp) >= limitUpPct(row.c));
    return {
      date,
      height,
      ztCount: zt.tc,
      zbCount: zb.tc,
      zbRate,
      premium,
      firstCount: first.length,
      promoCount: promo.length,
      promoRate: first.length ? promo.length / first.length : null,
    };
  }
  return null;
}

/** 已跟踪主题的主力净额。用行情列表，不走经常被断开的板块排行接口。 */
export async function fetchTrackedFlows(boards) {
  const list = (boards || []).filter((b) => b.secid || b.code);
  if (!list.length) return [];
  const secids = list.map((b) => b.secid || `90.${b.code}`).join(',');
  const url =
    `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f12,f14,f3,f62&secids=${encodeURIComponent(secids)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.data?.diff || [])
    .map((row) => ({
      code: String(row.f12),
      name: row.f14,
      changePct: Number(row.f3),
      mainFlow: Number(row.f62 || 0) / 1e8,
      secid: `90.${row.f12}`,
    }))
    .filter((row) => Number.isFinite(row.mainFlow))
    .sort((a, b) => b.mainFlow - a.mainFlow);
}

/** 行业或概念按主力净额排序。正数是流入。 */
export async function fetchBoardFlowRank(type = 'industry', limit = 8) {
  const fs = type === 'concept' ? 'm:90+t:3' : 'm:90+t:2';
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=${fs}` +
    `&fields=f12,f14,f3,f62`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('board flow');
      const json = await res.json();
      const rows = (json?.data?.diff || []).map((row) => ({
        code: String(row.f12),
        name: row.f14,
        changePct: Number(row.f3),
        mainFlow: Number(row.f62 || 0) / 1e8,
        secid: `90.${row.f12}`,
      }));
      if (rows.length || attempt === 1) return rows;
    } catch {
      if (attempt === 1) return [];
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return [];
}

/** 板块里成交额最大的几只，当作中军而不是最小盘的领涨。 */
export async function fetchBoardLeaders(code, limit = 1) {
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(`b:${code}`)}` +
    `&fields=f12,f14,f3,f6`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.data?.diff || []).map((row) => ({
    code: String(row.f12),
    name: row.f14,
    changePct: Number(row.f3),
  }));
}

function seatTag(name) {
  const s = String(name || '');
  if (/沪股通|深股通|港股通|北向/.test(s)) return '北向';
  if (/机构专用|机构席位|投资者分类/.test(s)) return '机构';
  if (/拉萨|江苏路|宛平南路|绍兴解放|源深路|华鑫上海|国金成都|开源西安西大街/.test(s)) return '游资';
  return '营业部';
}

function shortSeatName(name) {
  const s = String(name || '').trim();
  if (!s) return '未知席位';
  if (/沪股通/.test(s)) return '沪股通';
  if (/深股通/.test(s)) return '深股通';
  if (/港股通/.test(s)) return '港股通';
  if (/机构专用/.test(s)) return '机构专用';
  if (/投资者分类/.test(s)) return '机构(分类)';
  const cleaned = s
    .replace(/股份有限公司|有限责任公司|有限公司/g, '')
    .replace(/证券营业部$/, '')
    .trim();
  const loc = cleaned.replace(/^.*?证券/, '').replace(/^.*?分公司/, '').trim();
  return (loc || cleaned).slice(0, 14);
}

function tagsFromExplain(text) {
  const s = String(text || '');
  const tags = [];
  if (/沪股通|深股通|港股通|北向/.test(s)) tags.push('北向');
  if (/机构/.test(s)) tags.push('机构');
  if (/游资/.test(s)) tags.push('游资');
  if (/主力/.test(s)) tags.push('主力');
  if (/普通席位/.test(s)) tags.push('营业部');
  return tags;
}

function uniqueTags(list) {
  const order = ['北向', '机构', '游资', '主力', '营业部'];
  const set = new Set((list || []).filter(Boolean));
  return order.filter((t) => set.has(t));
}

async function fetchBillboardSeats(date, pages = 2) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= pages; page += 1) {
    const url =
      'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_OPERATEDEPT_TRADE_DETAILSNEW' +
      '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,OPERATEDEPT_NAME,NET_AMT,ACT_BUY,ACT_SELL,EXPLANATION' +
      `&pageSize=400&pageNumber=${page}&sortColumns=NET_AMT&sortTypes=-1` +
      `&filter=(TRADE_DATE='${date}')&source=WEB&client=WEB`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) break;
      const json = await res.json();
      const rows = json?.result?.data || [];
      if (!rows.length) break;
      for (const row of rows) {
        const code = String(row.SECURITY_CODE || '');
        const seat = String(row.OPERATEDEPT_NAME || '').trim();
        if (!code || !seat) continue;
        const key = `${code}|${seat}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const netYi = +(Number(row.NET_AMT || 0) / 1e8).toFixed(2);
        out.push({
          code,
          name: String(row.SECURITY_NAME_ABBR || ''),
          seat,
          short: shortSeatName(seat),
          tag: seatTag(seat),
          netYi,
        });
      }
      const total = Number(json?.result?.count || 0);
      if (page * 400 >= total) break;
    } catch {
      break;
    }
  }
  return out;
}

function ashareSecid(code) {
  const c = String(code || '').replace(/\D/g, '').slice(-6);
  if (!/^\d{6}$/.test(c)) return '';
  if (/^(92|8|4|0|1|2|3)/.test(c)) return `0.${c}`;
  return `1.${c}`;
}

/**
 * 今日涨跌旁边的「前一日」：K 线里今天这根之前的那一根。
 * 今天的日 K 还没出来时，最后一根就是上一个已收盘交易日。
 */
export function previousSessionChange(points, todayYmd) {
  const rows = [];
  for (const point of points || []) {
    const date = String(point?.date || '').slice(0, 10);
    const close = Number(point?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue;
    const given = Number(point?.changePct);
    rows.push({ date, close, changePct: Number.isFinite(given) ? given : null });
  }
  if (!rows.length) return null;
  const today = String(todayYmd || '').slice(0, 10);
  let idx = rows.length - 1;
  // 今天这根不能当成前一日。涨跌用前一根收盘算，避免接口把当天涨跌填进每一根。
  if (today && rows[idx].date >= today) idx -= 1;
  if (idx < 0) return null;
  const row = rows[idx];
  const base = idx > 0 ? rows[idx - 1].close : 0;
  const fromClose = base > 0 ? ((row.close - base) / base) * 100 : null;
  const changePct = Number.isFinite(fromClose) ? fromClose : row.changePct;
  if (!Number.isFinite(changePct)) return null;
  if (today && row.date >= today) return null;
  return { date: row.date, changePct: +Number(changePct).toFixed(2) };
}

async function fetchRecentDayPoints(secid) {
  try {
    const tx = await fetchTencentKline(secid, 101, 6);
    if ((tx?.points?.length || 0) >= 2) return tx.points;
  } catch {
    /* next */
  }
  try {
    const sina = await fetchSinaKline(secid, 101, 6);
    if ((sina?.points?.length || 0) >= 2) return sina.points;
  } catch {
    /* next */
  }
  try {
    const east = await fetchEastKline(secid, 101, 6);
    if ((east?.points?.length || 0) >= 2) return east.points;
  } catch {
    /* next */
  }
  return [];
}

/** code -> { date, changePct }。前一日涨跌，不是龙虎榜上榜当天的 CHANGE_RATE。 */
export async function fetchPreviousSessionChanges(codes, todayYmd) {
  const list = [
    ...new Set(
      (codes || [])
        .map((code) => String(code || '').replace(/\D/g, '').slice(-6))
        .filter((code) => /^\d{6}$/.test(code)),
    ),
  ];
  const today =
    todayYmd || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const map = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const code = list[cursor];
      cursor += 1;
      const secid = ashareSecid(code);
      if (!secid) continue;
      const prev = previousSessionChange(await fetchRecentDayPoints(secid), today);
      if (prev) map[code] = prev;
    }
  };
  const width = Math.min(6, list.length);
  if (width > 0) await Promise.all(Array.from({ length: width }, () => worker()));
  return map;
}

function mapBillboardRows(rows, limit = 60) {
  const byCode = new Map();
  for (const row of rows || []) {
    const code = String(row.SECURITY_CODE || '');
    if (!code) continue;
    const netYi = +(Number(row.BILLBOARD_NET_AMT || 0) / 1e8).toFixed(2);
    const cur = byCode.get(code);
    if (cur && Number(cur.netYi) >= Number(netYi)) {
      if (row.EXPLANATION && !cur.reason.includes(String(row.EXPLANATION))) {
        cur.reason = [cur.reason, String(row.EXPLANATION).trim()].filter(Boolean).join('；');
      }
      continue;
    }
    byCode.set(code, {
      code,
      name: String(row.SECURITY_NAME_ABBR || ''),
      close: Number(row.CLOSE_PRICE),
      changePct: Number(row.CHANGE_RATE),
      netYi,
      buyYi: +(Number(row.BILLBOARD_BUY_AMT || 0) / 1e8).toFixed(2),
      sellYi: +(Number(row.BILLBOARD_SELL_AMT || 0) / 1e8).toFixed(2),
      seats: String(row.EXPLAIN || '').trim(),
      reason: String(row.EXPLANATION || '').trim(),
      buyers: [],
      buyerTags: tagsFromExplain(`${row.EXPLAIN || ''} ${row.EXPLANATION || ''}`),
    });
  }
  return [...byCode.values()]
    .sort((a, b) => Number(b.netYi) - Number(a.netYi))
    .slice(0, limit);
}

/** 指定交易日的龙虎榜（轻量：不拉席位明细，够启发式挑三只） */
export async function fetchDailyBillboardOn(date, limit = 60) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { date: '', rows: [] };
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW' +
    '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,' +
    'BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,EXPLAIN,EXPLANATION' +
    '&pageSize=200&pageNumber=1&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1' +
    `&filter=(TRADE_DATE='${day}')&source=WEB&client=WEB`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { date: day, rows: [] };
    const rows = (await res.json())?.result?.data || [];
    if (!rows.length) return { date: day, rows: [] };
    return {
      date: day,
      rows: mapBillboardRows(rows, limit).map((row) => ({
        ...row,
        buyerTags: row.buyerTags?.length ? uniqueTags(row.buyerTags) : ['营业部'],
      })),
    };
  } catch {
    return { date: day, rows: [] };
  }
}

/**
 * 最近一个已披露交易日的龙虎榜个股（按净买入排序，代码去重）。
 * 附带席位买家标签（北向 / 机构 / 游资 / 营业部）。
 * prevChangePct 是上一个交易日的涨跌，不是上榜当天（上榜日若是今天，会和今日涨跌重复）。
 */
export async function fetchDailyBillboard(limit = 60) {
  for (const date of shTradeDates(8)) {
    try {
      const basic = await fetchDailyBillboardOn(date, limit);
      if (!basic.rows?.length) continue;
      const [seats, prevByCode] = await Promise.all([
        fetchBillboardSeats(date).catch(() => []),
        fetchPreviousSessionChanges(basic.rows.map((row) => row.code)).catch(() => ({})),
      ]);
      const seatsByCode = new Map();
      for (const seat of seats) {
        const list = seatsByCode.get(seat.code) || [];
        list.push(seat);
        seatsByCode.set(seat.code, list);
      }
      const mapped = basic.rows.map((row) => {
        const list = (seatsByCode.get(row.code) || [])
          .filter((s) => Number(s.netYi) > 0)
          .sort((a, b) => Number(b.netYi) - Number(a.netYi))
          .slice(0, 4);
        const tags = uniqueTags([...row.buyerTags, ...list.map((s) => s.tag)]);
        const prev = prevByCode[row.code];
        return {
          ...row,
          buyers: list,
          buyerTags: tags.length ? tags : ['营业部'],
          prevChangePct: prev ? prev.changePct : null,
          prevDate: prev?.date || '',
        };
      });
      return { date, rows: mapped };
    } catch {
      /* try older day */
    }
  }
  return { date: '', rows: [] };
}

/** 当日龙虎榜净买入靠前的席位。机构、北向、常见游资席位优先。 */
export async function fetchSeatHighlights(limit = 6) {
  for (const date of shTradeDates(4)) {
    const url =
      'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_OPERATEDEPT_TRADE_DETAILSNEW' +
      '&columns=OPERATEDEPT_NAME,SECURITY_NAME_ABBR,SECURITY_CODE,NET_AMT,TRADE_DATE' +
      `&pageSize=80&pageNumber=1&sortColumns=NET_AMT&sortTypes=-1&filter=(TRADE_DATE='${date}')`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = await res.json();
    const rows = json?.result?.data || [];
    if (!rows.length) continue;
    const seen = new Set();
    const mapped = [];
    for (const row of rows) {
      const key = `${row.OPERATEDEPT_NAME}|${row.SECURITY_CODE}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({
        name: row.OPERATEDEPT_NAME,
        stock: row.SECURITY_NAME_ABBR,
        netYi: Number(row.NET_AMT || 0) / 1e8,
        tag: seatTag(row.OPERATEDEPT_NAME),
      });
    }
    const tagged = mapped.filter((row) => row.tag);
    const picked = (tagged.length >= 3 ? tagged : mapped).slice(0, limit);
    return { date, rows: picked };
  }
  return { date: '', rows: [] };
}

const FUT_PRODUCT = {
  IF: '沪深300股指',
  IH: '上证50股指',
  IC: '中证500股指',
  IM: '中证1000股指',
  AU: '黄金',
  AG: '白银',
  CU: '铜',
  AL: '铝',
  ZN: '锌',
  PB: '铅',
  NI: '镍',
  SN: '锡',
  RB: '螺纹钢',
  HC: '热卷',
  SS: '不锈钢',
  I: '铁矿',
  JM: '焦煤',
  J: '焦炭',
  SC: '原油',
  FU: '燃油',
  BU: '沥青',
  LU: '低硫燃油',
  PG: '液化气',
  LC: '碳酸锂',
  SI: '工业硅',
  SA: '纯碱',
  FG: '玻璃',
  MA: '甲醇',
  TA: 'PTA',
  RU: '橡胶',
  M: '豆粕',
  RM: '菜粕',
  C: '玉米',
  P: '棕榈',
  Y: '豆油',
  PP: '聚丙烯',
  V: 'PVC',
  SR: '白糖',
};

function futHint(code) {
  if (['IF', 'IH', 'IC', 'IM'].includes(code)) return '对应大A指数，不是某一只股票';
  if (['AU', 'AG'].includes(code)) return '对应黄金、白银';
  if (['CU', 'AL', 'ZN', 'PB', 'NI', 'SN'].includes(code)) return '对应有色';
  if (['RB', 'HC', 'SS', 'I', 'JM', 'J'].includes(code)) return '对应钢铁、煤焦';
  if (['SC', 'FU', 'BU', 'LU', 'PG'].includes(code)) return '对应油气';
  if (code === 'LC') return '对应锂电';
  if (code === 'SI') return '对应工业硅';
  if (['SA', 'FG'].includes(code)) return '对应玻璃、纯碱';
  if (['M', 'RM', 'C', 'P', 'Y'].includes(code)) return '对应养殖、油脂';
  return '';
}

function mapFutRow(row) {
  const product = String(row.TRADE_CODE || '').toUpperCase();
  const raw = String(row.MEMBER_NAME_ABBR || '').trim();
  const client = /代客/.test(raw);
  const house = raw.replace(/[（(]代客[）)]/g, '').trim() || raw;
  const longAdd = Number(row.LP_CHANGE);
  const shortAdd = Number(row.SP_CHANGE);
  const longPos = Number(row.LONG_POSITION);
  const shortPos = Number(row.SHORT_POSITION);
  return {
    product,
    productName: FUT_PRODUCT[product] || product,
    hint: futHint(product),
    contract: String(row.SECURITY_CODE || ''),
    house,
    client,
    longPos: Number.isFinite(longPos) ? longPos : null,
    longAdd: Number.isFinite(longAdd) ? longAdd : null,
    shortPos: Number.isFinite(shortPos) ? shortPos : null,
    shortAdd: Number.isFinite(shortAdd) ? shortAdd : null,
    stance: seatStance(longAdd, shortAdd),
    index: ['IF', 'IH', 'IC', 'IM'].includes(product),
  };
}

async function fetchFutRank(date, filter, sort, pageSize) {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_FUTU_DAILYPOSITION' +
    '&columns=SECURITY_CODE,MEMBER_NAME_ABBR,LONG_POSITION,LP_CHANGE,SHORT_POSITION,SP_CHANGE,TRADE_CODE,TRADE_DATE' +
    `&pageSize=${pageSize}&pageNumber=1&sortColumns=${sort}&sortTypes=-1` +
    `&filter=${encodeURIComponent(`(TRADE_DATE='${date}')${filter}`)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.result?.data || []).map(mapFutRow).filter((row) => row.house && row.contract);
}

function pickMainContract(rows) {
  const by = new Map();
  for (const row of rows) {
    const bag = by.get(row.contract) || { score: 0, rows: [] };
    bag.score += Math.abs(row.longAdd || 0) + Math.abs(row.shortAdd || 0);
    bag.rows.push(row);
    by.set(row.contract, bag);
  }
  const best = [...by.values()].sort((a, b) => b.score - a.score)[0];
  if (!best) return [];
  const sorted = [...best.rows].sort(
    (a, b) =>
      Math.abs(b.longAdd || 0) + Math.abs(b.shortAdd || 0) - (Math.abs(a.longAdd || 0) + Math.abs(a.shortAdd || 0)),
  );
  const picked = [];
  const citic = sorted.find((row) => row.house.includes('中信'));
  if (citic) picked.push(citic);
  for (const row of sorted) {
    if (picked.length >= 3) break;
    if (picked.includes(row)) continue;
    picked.push(row);
  }
  return picked;
}

/** 期货会员持仓增减。中信等加多单、加空单，用来区分偏多和对冲。 */
export async function fetchFuturesSeatMoves() {
  for (const date of shTradeDates(4)) {
    const [indexes, longs, shorts] = await Promise.all([
      Promise.all(
        ['IF', 'IH', 'IC', 'IM'].map((code) =>
          fetchFutRank(date, `(TRADE_CODE="${code}")(TYPE="0")(LP_CHANGE>200)`, 'LP_CHANGE', 25).catch(() => []),
        ),
      ),
      fetchFutRank(date, `(TYPE="0")(LP_CHANGE>1500)`, 'LP_CHANGE', 12).catch(() => []),
      fetchFutRank(date, `(TYPE="0")(SP_CHANGE>4000)`, 'SP_CHANGE', 8).catch(() => []),
    ]);
    const indexRows = indexes.flatMap((rows) => pickMainContract(rows));
    const seen = new Set(indexRows.map((row) => `${row.contract}|${row.house}`));
    const commodityRows = [];
    for (const row of [...longs, ...shorts]) {
      const key = `${row.contract}|${row.house}`;
      if (row.index || seen.has(key)) continue;
      if (commodityRows.length >= 6) break;
      seen.add(key);
      commodityRows.push(row);
    }
    if (indexRows.length || commodityRows.length) return { date, indexRows, commodityRows };
  }
  return { date: '', indexRows: [], commodityRows: [] };
}

export { marketLabel };
