/**
 * 资金折线：稳定源优先 + 解析单测 + 东财接口耗时对照。
 * 运行：node scripts/test-flow.mjs
 */
async function firstOk(factories) {
  for (const factory of factories) {
    try {
      const value = await factory();
      if (value != null) return value;
    } catch {
      /* next */
    }
  }
  return null;
}

function flowClockMinutes(label) {
  const part = String(label || '').includes(' ')
    ? String(label).split(' ').pop()
    : String(label || '');
  const m = part.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

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
  let date = '';
  const rows = Array.isArray(klines) ? klines : [];
  for (const line of rows) {
    const p = String(line).split(',');
    const raw = p[0] || '';
    if (!date) date = raw.split(' ')[0] || '';
    const clock = raw.split(' ')[1] || raw;
    if (!isAshareSessionMinute(clock)) continue;
    times.push(clock.length >= 5 ? clock.slice(0, 5) : clock);
    main.push(+(Number(p[1]) / yi).toFixed(2));
    small.push(+(Number(p[2]) / yi).toFixed(2));
  }
  const last = (arr) => (arr.length ? arr[arr.length - 1] : 0);
  const win = Math.min(30, Math.max(0, times.length - 1));
  return { date, times, main, small, summary: { main: last(main), small: last(small), recentMinutes: win } };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testFirstOk() {
  const order = [];
  const won = await firstOk([
    async () => {
      order.push('fail');
      throw new Error('unstable');
    },
    async () => {
      order.push('empty');
      return null;
    },
    async () => {
      order.push('ok');
      return { host: 'his' };
    },
    async () => {
      order.push('skip');
      return { host: 'never' };
    },
  ]);
  assert(won?.host === 'his', `firstOk should take first non-null, got ${JSON.stringify(won)}`);
  assert(order.join(',') === 'fail,empty,ok', `stable-then-fallback order ${order}`);
  const empty = await firstOk([() => Promise.resolve(null), () => Promise.reject(new Error('x'))]);
  assert(empty == null, 'firstOk all-empty should be null');
  console.log('ok  firstOk stable-then-fallback');
}

function testParseFlow() {
  const parsed = parseFlowKlines([
    '2026-10-27 09:25,100000000,0,0,0,0',
    '2026-10-27 09:31,200000000,-50000000,0,0,0',
    '2026-10-27 11:45,300000000,0,0,0,0',
    '2026-10-27 13:01,250000000,-80000000,0,0,0',
    '2026-10-27 15:05,400000000,0,0,0,0',
  ]);
  assert(parsed.date === '2026-10-27', `date ${parsed.date}`);
  assert(parsed.times.join(',') === '09:31,13:01', `times ${parsed.times}`);
  assert(parsed.main[0] === 2 && parsed.main[1] === 2.5, `main ${parsed.main}`);
  assert(parseFlowKlines('not-array').times.length === 0, 'non-array klines ignored');
  console.log('ok  parseFlowKlines filters session minutes');
}

async function timeUrl(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const json = await res.json();
    const n = json?.data?.klines?.length || 0;
    return { ms: Date.now() - t0, ok: res.ok, n };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, n: 0, err: e.name || String(e) };
  }
}

async function timeLiveApis() {
  const q =
    'lmt=0&klt=1&secid=1.000001&secid2=0.399001' +
    '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
  const a = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?${q}&_=${Date.now()}`;
  const b = `https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get?${q}&_=${Date.now()}`;

  const seq = await firstOk([
    async () => {
      const r = await timeUrl(a);
      return r.ok && r.n ? { host: 'push2', ...r } : null;
    },
    async () => {
      const r = await timeUrl(b);
      return r.ok && r.n ? { host: 'push2his', ...r } : null;
    },
  ]);
  console.log(`live firstOk ${JSON.stringify(seq)}`);
}

const failed = [];
try {
  await testFirstOk();
} catch (e) {
  failed.push(e);
  console.error('fail firstOk', e.message);
}
try {
  testParseFlow();
} catch (e) {
  failed.push(e);
  console.error('fail parse', e.message);
}
await timeLiveApis();
if (failed.length) {
  console.error(`\n${failed.length} test(s) failed`);
  process.exit(1);
}
console.log('\nall unit checks passed');
