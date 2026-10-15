/**
 * Public quote helpers (East Money / Tiantian Fund / Tencent suggest).
 * Data is unofficial and for personal reference only.
 */

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
    fetchStockQuotes(stocks),
    fetchFundQuotes(funds),
  ]);
  return { ...stockMap, ...fundMap };
}

async function fetchStockQuotes(stocks) {
  if (!stocks.length) return {};
  const secids = stocks
    .map((s) => s.secid || toSecid(s.market, s.code, s.marketNo))
    .join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=${STOCK_FIELDS}&secids=${encodeURIComponent(secids)}`;
  const res = await fetch(url);
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
  const pctRaw =
    row.GSZZL != null && row.GSZZL !== '' && row.GSZZL !== '--'
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
      asOf: row.GZTIME || row.PDATE || '',
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
          asOf: parts[8] || '',
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
      const res = await fetch(url);
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

  // 2) 腾讯批量（网页可用，含盘中估算）
  let missing = funds.filter((f) => !map[fundQuoteKey(f.code)]?.price);
  if (missing.length) {
    Object.assign(map, await fetchFundQuotesFromTencent(missing));
  }

  // 3) 天天基金 JSONP 仅补仍缺的少量（串行、短超时）
  missing = funds.filter((f) => !map[fundQuoteKey(f.code)]?.price);
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
  /英伟达|NVIDIA|NVDA|海力士|台积电|TSMC|ASML|阿斯麦|费城半导体|半导体|芯片|GPU|HBM|AI\s*芯片|算力|苹果|微软|AMD|存储\s*板块|纳指/;

function scoreMajorNews(title) {
  const t = String(title || '');
  let score = 0;
  if (/美国?\s*CPI|核心CPI|非农|美联储|FOMC|PCE/.test(t)) score += 6;
  else if (MACRO_RE.test(t)) score += 5;
  if (TECH_RE.test(t)) score += 4;
  if (/高于预期|低于预期|暴涨|暴跌|大跌|跳水|直线|重磅|突发|利好|利空|翻倍|概率/.test(t))
    score += 2;
  if (/费城半导体|纳指|存储/.test(t)) score += 2;
  if (/盘前|盘后|开盘/.test(t) && TECH_RE.test(t)) score += 1;
  // 过滤日常噪音
  if (/会见|调研|座谈会|一财社论|国考|医改|拟发行|拟定增|股份：/.test(t)) score -= 6;
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
 * 重大消息：只保留宏观（CPI/非农/美联储）与科技龙头相关，少而精
 * @param {number} limit 默认 5
 */
export async function fetchMarketNews(limit = 6) {
  const feeds = [
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_100_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_101_ajaxResult_50_1_.html',
    'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html',
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
          if (score < 4) continue;
          const id = String(row.newsid || row.id || row.sort || title.slice(0, 40));
          items.push({
            id,
            title: title.replace(/^【|】$/g, '').slice(0, 72),
            time: row.showtime || row.time || '',
            url: row.url_w || row.url_unique || row.url_m || '',
            score,
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
  return items
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      if (seen.has(x.id) || seen.has(x.title.slice(0, 20))) return false;
      seen.add(x.id);
      seen.add(x.title.slice(0, 20));
      return true;
    })
    .slice(0, limit);
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

  for (const t of techLeaders) {
    const pct = Number(t.changePct);
    if (!Number.isFinite(pct)) continue;
    if (pct <= -2.5) {
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
    } else if (pct >= 3) {
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

export async function fetchIndices(list) {
  if (!list?.length) return [];
  const secids = list.map((x) => x.secid || toSecid(x.market, x.code, x.marketNo)).join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=${STOCK_FIELDS}&secids=${encodeURIComponent(secids)}`;
  const res = await fetch(url);
  const json = await res.json();
  const diff = json?.data?.diff || [];
  return list.map((meta, i) => {
    const secid = meta.secid || toSecid(meta.market, meta.code, meta.marketNo);
    const row =
      diff.find((d) => String(d.f12) === String(meta.code)) ||
      diff[i] ||
      {};
    let price = Number(row.f2);
    const prev = Number(row.f18);
    if (!price && prev) price = prev;
    return {
      ...meta,
      secid,
      name: row.f14 || meta.name,
      price,
      changePct: Number(row.f3),
      change: Number(row.f4),
      prevClose: prev,
    };
  });
}

function parseTrendsPayload(data) {
  if (!data?.trends?.length) return null;
  const points = data.trends.map((line) => {
    const p = String(line).split(',');
    // 东财分时常见：时间,现价,开,高,低,成交量,成交额,均价
    const price = Number(p[1]);
    const avg = Number(p[7] ?? p[1]);
    return {
      time: (p[0] || '').split(' ')[1] || p[0],
      price,
      avg: Number.isFinite(avg) ? avg : price,
      volume: Number(p[5] || 0),
    };
  }).filter((p) => Number.isFinite(p.price));

  if (!points.length) return null;
  return {
    name: data.name || '',
    code: data.code || '',
    preClose: Number(data.preClose || data.prePrice || points[0].price || 0),
    points,
  };
}

/** 分时走势（交易中走 push2，闭盘/失败再走 push2his，都能拿当天线） */
export async function fetchIntraday(secid) {
  const q =
    `fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&mpi=1000&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&secid=${encodeURIComponent(secid)}&ndays=1&iscr=0&iscca=0`;

  const urls = [
    `https://push2.eastmoney.com/api/qt/stock/trends2/get?${q}`,
    `https://push2his.eastmoney.com/api/qt/stock/trends2/get?${q}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseTrendsPayload(json?.data);
      if (parsed) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function parseFlowKlines(klines) {
  const yi = 1e8;
  const times = [];
  const main = [];
  const small = [];
  const mid = [];
  const large = [];
  const huge = [];
  for (const line of klines || []) {
    const p = String(line).split(',');
    times.push((p[0] || '').split(' ')[1] || p[0]);
    main.push(+(Number(p[1]) / yi).toFixed(2));
    small.push(+(Number(p[2]) / yi).toFixed(2));
    mid.push(+(Number(p[3]) / yi).toFixed(2));
    large.push(+(Number(p[4]) / yi).toFixed(2));
    huge.push(+(Number(p[5]) / yi).toFixed(2));
  }
  const last = (arr) => (arr.length ? arr[arr.length - 1] : 0);
  return {
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
    },
  };
}

/** 沪深大盘主力资金分时 */
export async function fetchMarketMoneyFlow() {
  const url =
    'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=1.000001&secid2=0.399001' +
    '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
  const res = await fetch(url);
  const json = await res.json();
  return parseFlowKlines(json?.data?.klines);
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

/** 个股主力资金分时 */
export async function fetchStockMoneyFlow(secid) {
  const q =
    `lmt=0&klt=1&secid=${encodeURIComponent(secid)}` +
    '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
  const urls = [
    `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?${q}`,
    `https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get?${q}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseFlowKlines(json?.data?.klines);
      if (parsed?.times?.length) return parsed;
    } catch {
      /* try next */
    }
  }
  return parseFlowKlines([]);
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
  return {
    times,
    net,
    last: net.length ? net[net.length - 1] : 0,
  };
}

/** 日/周/月/年 K：klt 101/102/103/106 */
export async function fetchKline(secid, klt = 101, lmt = 80) {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}` +
    `&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101&iscca=1` +
    `&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f59&forcect=1`;
  const res = await fetch(url);
  const json = await res.json();
  const lines = json?.data?.klines || [];
  return {
    name: json?.data?.name || '',
    points: lines.map((line) => {
      const p = String(line).split(',');
      return {
        date: p[0],
        open: Number(p[1]),
        close: Number(p[2]),
        high: Number(p[3]),
        low: Number(p[4]),
        volume: Number(p[5]),
        amount: Number(p[6]),
        changePct: Number(p[7]),
      };
    }),
  };
}

/** 沪深两市成交额等 */
export async function fetchMarketOverview() {
  const url =
    'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f1,f2,f3,f4,f6,f12,f13,f14,f104,f105,f106';
  const res = await fetch(url);
  const json = await res.json();
  const diff = json?.data?.diff || [];
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

/** 涨跌 TOP：po=1 涨幅，po=0 跌幅 */
export async function fetchTopMovers(direction = 'up', limit = 100) {
  const po = direction === 'up' ? 1 : 0;
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=${po}&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3` +
    `&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048` +
    `&fields=f12,f13,f14,f2,f3,f4,f6`;
  const res = await fetch(url);
  const json = await res.json();
  return (json?.data?.diff || []).map((row) => ({
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

/** 板块涨跌：industry / concept / region */
export async function fetchBoards(type = 'industry') {
  const fs =
    type === 'concept' ? 'm:90+t:3' : type === 'region' ? 'm:90+t:1' : 'm:90+t:2';
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${fs}` +
    `&fields=f12,f14,f2,f3,f62,f66,f184`;
  const res = await fetch(url);
  const json = await res.json();
  return (json?.data?.diff || []).map((row) => ({
    code: String(row.f12),
    name: row.f14,
    price: Number(row.f2),
    changePct: Number(row.f3),
    mainFlow: Number(row.f62 || 0) / 1e8,
    secid: `90.${row.f12}`,
    kind: 'stock',
    market: 'BK',
    marketNo: 90,
    label: '板块',
  }));
}

function shTradeDates(count = 4) {
  const out = [];
  for (let i = 0; i < 12 && out.length < count; i += 1) {
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
  if (s.includes('机构专用')) return '机构';
  if (s.includes('沪股通') || s.includes('深股通')) return '北向';
  if (/拉萨|江苏路|宛平南路|绍兴解放|源深路/.test(s)) return '游资';
  return '';
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

export { marketLabel };
