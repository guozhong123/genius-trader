import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STOCK_THEME_BY_CODE } from '../src/lib/stock-groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || 'C:/Users/YJJ/Desktop/股票基金神器 (3).txt';
const raw = fs.readFileSync(src, 'utf8');
const data = JSON.parse(raw);
const groupsMap = data.groups || {};

function parseStockCode(code) {
  const c = String(code || '').toLowerCase();
  let market = 'SZ';
  let marketNo = 0;
  let num = c;
  if (c.startsWith('sh')) {
    market = 'SH';
    marketNo = 1;
    num = c.slice(2);
  } else if (c.startsWith('sz')) {
    market = 'SZ';
    marketNo = 0;
    num = c.slice(2);
  } else if (c.startsWith('bj')) {
    market = 'BJ';
    marketNo = 0;
    num = c.slice(2);
  } else if (c.startsWith('hk')) {
    market = 'HK';
    marketNo = 116;
    num = c.slice(2);
  } else if (c.startsWith('us')) {
    market = 'US';
    marketNo = 105;
    num = c.slice(2);
  }
  const codeOut = num.toUpperCase();
  let secid;
  if (market === 'HK') secid = `116.${codeOut.padStart(5, '0')}`;
  else if (market === 'US') secid = `105.${codeOut}`;
  else secid = `${marketNo}.${codeOut}`;
  return { code: codeOut, market, marketNo, secid };
}

function labelOf(market) {
  return { SH: '沪', SZ: '深', BJ: '京', HK: '港', US: '美', FUND: '基金' }[market] || '股';
}

const NAME_FIX = {
  股票: '自选股',
  工业母鸡: '工业母机',
  默认: '未分组',
  默认分组: '未分组',
};

const outGroups = [{ id: 'default', name: '未分组' }];
for (const [gid, gname] of Object.entries(groupsMap)) {
  if (gid === 'default-group') continue;
  outGroups.push({ id: `g_${gid}`, name: NAME_FIX[gname] || gname });
}

const watchlist = [];
const seen = new Set();

const groupNameToId = new Map(outGroups.map((g) => [g.name, g.id]));

for (const [key, arr] of Object.entries(data)) {
  if (!key.endsWith('_stocks') || !Array.isArray(arr)) continue;
  const gid = key.replace(/_stocks$/, '');
  const fallbackGroupId = gid === 'default-group' ? 'default' : `g_${gid}`;
  for (const s of arr) {
    const p = parseStockCode(s.code);
    const id = `stock:${p.market}:${p.code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const theme = STOCK_THEME_BY_CODE[p.code];
    const groupId = (theme && groupNameToId.get(theme)) || fallbackGroupId;
    watchlist.push({
      kind: 'stock',
      code: p.code,
      name: s.name || '',
      market: p.market,
      marketNo: p.marketNo,
      secid: p.secid,
      label: labelOf(p.market),
      groupId,
      pinned: false,
      order: watchlist.length,
      addedAt: Date.now(),
    });
  }
}

for (const [key, arr] of Object.entries(data)) {
  if (!key.endsWith('_funds') || !Array.isArray(arr)) continue;
  const gid = key.replace(/_funds$/, '');
  const groupId = gid === 'default-group' ? 'default' : `g_${gid}`;
  for (const f of arr) {
    const code = String(f.fundCode || '').padStart(6, '0');
    const id = `fund:FUND:${code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    watchlist.push({
      kind: 'fund',
      code,
      name: f.name || '',
      market: 'FUND',
      secid: null,
      label: '基金',
      groupId,
      pinned: false,
      order: watchlist.length,
      addedAt: Date.now(),
    });
  }
}

async function resolveNames(list) {
  const need = list.filter((x) => !x.name);
  console.log('need name resolve:', need.length);
  for (const item of need) {
    try {
      if (item.kind === 'stock') {
        const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f12,f14&secids=${encodeURIComponent(item.secid)}`;
        const json = await (await fetch(url)).json();
        const row = json?.data?.diff?.[0];
        if (row?.f14) item.name = row.f14;
      } else {
        const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=1&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${item.code}`;
        const json = await (await fetch(url)).json();
        const row = json?.Datas?.[0];
        if (row?.SHORTNAME || row?.NAME) item.name = row.SHORTNAME || row.NAME;
      }
    } catch {
      /* ignore */
    }
    if (!item.name) item.name = item.code;
    await new Promise((r) => setTimeout(r, 40));
  }
}

await resolveNames(watchlist);

const out = { groups: outGroups, watchlist };
const dest = path.join(__dirname, '../public/import-shenqi.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log('groups', outGroups.length);
console.log('stocks', watchlist.filter((x) => x.kind === 'stock').length);
console.log('funds', watchlist.filter((x) => x.kind === 'fund').length);
console.log('written', dest);
console.log(
  'sample',
  watchlist.slice(0, 5).map((x) => `${x.name}(${x.code})/${x.groupId}`),
);
