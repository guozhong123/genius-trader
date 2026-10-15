/**
 * 把本机已拉到的行情、主力、均线、个股消息交给 DeepSeek。
 * 密钥只存在本机 storage，不写入仓库。
 * 实时性来自东财数据，不靠模型自己上网。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

function num(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}

function signed(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x > 0 ? '+' : ''}${x.toFixed(d)}`;
}

function sma(values, n) {
  if (!values || values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

function limitBand(item, name) {
  const code = String(item?.code || '');
  const market = item?.market;
  if (/ST/i.test(String(name || ''))) return 5;
  if (market === 'BJ' || /^[48]/.test(code)) return 30;
  if (/^(300|301|688|689)/.test(code)) return 20;
  if (market === 'SH' || market === 'SZ') return 10;
  return null;
}

function streak(points) {
  if (!points.length) return '—';
  const last = Number(points.at(-1).changePct);
  if (!Number.isFinite(last) || last === 0) return '最近一日平盘';
  const up = last > 0;
  let n = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = Number(points[i].changePct);
    if (!Number.isFinite(p) || p === 0 || (p > 0) !== up) break;
    n += 1;
  }
  return `连${up ? '涨' : '跌'} ${n} 日`;
}

function describeTrend(dayK, band) {
  const points = dayK?.points || [];
  const closes = points.map((p) => Number(p.close)).filter((n) => n > 0);
  const last = closes.at(-1);
  if (!last) return ['趋势：日K不足，无法判断均线。'];
  const pct = (from) => (from ? ((last - from) / from) * 100 : null);
  const lines = [];
  const maBits = [5, 10, 20, 60]
    .map((n) => {
      const m = sma(closes, n);
      if (!m) return null;
      const d = ((last - m) / m) * 100;
      return `MA${n} ${d >= 0 ? '上' : '下'} ${signed(d)}%`;
    })
    .filter(Boolean);
  if (maBits.length) lines.push(`现价相对均线：${maBits.join('，')}`);
  const d5 = closes.length >= 6 ? pct(closes[closes.length - 6]) : null;
  const d10 = closes.length >= 11 ? pct(closes[closes.length - 11]) : null;
  const d20 = closes.length >= 21 ? pct(closes[closes.length - 21]) : null;
  lines.push(`区间涨跌：5日 ${signed(d5)}%，10日 ${signed(d10)}%，20日 ${signed(d20)}%`);
  const window = points.slice(-20);
  if (window.length) {
    const highs = window.map((p) => Number(p.high)).filter((n) => n > 0);
    const lows = window.map((p) => Number(p.low)).filter((n) => n > 0);
    if (highs.length) {
      const hi = Math.max(...highs);
      lines.push(`距20日高点 ${signed(((last - hi) / hi) * 100)}%（高点 ${num(hi)}）`);
    }
    if (lows.length) {
      const lo = Math.min(...lows);
      lines.push(`距20日低点 ${signed(((last - lo) / lo) * 100)}%（低点 ${num(lo)}）`);
    }
  }
  const amounts = points.map((p) => Number(p.amount)).filter((n) => n > 0);
  if (amounts.length >= 6) {
    const avg = sma(amounts.slice(0, -1), Math.min(5, amounts.length - 1));
    const today = amounts.at(-1);
    if (avg) lines.push(`今日成交额 / 前5日均额 = ${(today / avg).toFixed(2)} 倍`);
  }
  lines.push(streak(points));
  if (band) {
    const hits = points.slice(-20).filter((p) => Number(p.changePct) >= band * 0.97).length;
    lines.push(`近20日接近涨停（≥${band}%）的天数：${hits}`);
  }
  return lines;
}

export function buildStockFacts({
  item,
  quote,
  dayK,
  flow,
  flowDays,
  snapshot,
  headlines,
  announcements,
  news,
  cross,
  indices,
  valuation,
  intent,
  center,
}) {
  const name = quote?.name || snapshot?.name || item.name || '';
  const px = snapshot?.price ?? quote?.price;
  const cost = Number(item?.cost);
  const mark = Number(item?.markPrice);
  const live = Number(px);
  const emTime = quote?.updatedAt
    ? new Date(quote.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知';
  const tx = Number(cross?.price);
  const diffPct = live > 0 && tx > 0 ? ((tx - live) / live) * 100 : null;
  const pnl = cost > 0 && live > 0 ? ((live - cost) / cost) * 100 : null;
  const pct = snapshot?.changePct ?? quote?.changePct;
  const s = flow?.summary || {};
  const days = flowDays || [];
  const main5 = days.slice(-5).reduce((a, d) => a + (Number(d.main) || 0), 0);
  const idx = (indices || [])
    .slice(0, 6)
    .map((x) => `${x.name || x.code} ${signed(x.changePct)}%`)
    .join('，');
  const zd = center?.updown;
  const ov = center?.overview;
  const nb = center?.northbound;
  const mktFlow = center?.flow?.summary;
  const concepts = (snapshot?.concepts || []).slice(0, 6).join('、');
  const related = (headlines || [])
    .slice(0, 6)
    .map((n) => `- ${n.time || ''} ${n.title}`)
    .join('\n');
  const anns = (announcements || [])
    .slice(0, 3)
    .map((n) => `- ${n.date || ''} ${n.title}`)
    .join('\n');
  const macro = (news || [])
    .slice(0, 3)
    .map((n) => `- ${n.title || ''}`)
    .join('\n');
  const dayLines = days
    .slice(-5)
    .map(
      (d) =>
        `${String(d.date || '').slice(5)} 主力${signed(d.main)}亿 小单${signed(d.small)}亿 涨跌${signed(d.changePct)}%`,
    )
    .join('\n');

  return [
    `标的：${name} ${item.code} ${item.market || ''}`,
    snapshot?.industry ? `行业：${snapshot.industry}${concepts ? `；概念：${concepts}` : ''}` : '',
    `东财现价 ${num(px)}（行情时间 ${emTime}），今日 ${signed(pct)}%，今高 ${num(snapshot?.high ?? quote?.high)} 今低 ${num(snapshot?.low ?? quote?.low)} 开 ${num(snapshot?.open ?? quote?.open)} 昨收 ${num(snapshot?.prevClose ?? quote?.prevClose)}`,
    tx > 0
      ? `腾讯现价 ${num(tx)}（${cross?.time || '时间未知'}），与东财相差 ${signed(diffPct)}%。以东财为准，不要把两个价平均。`
      : '腾讯对照价：未取到。',
    cost > 0
      ? `用户成本 ${num(cost)}，相对东财现价浮盈 ${signed(pnl)}%。`
      : '用户成本：未填。不要假设他已经持仓。',
    mark > 0
      ? `用户另外填写的价格 ${num(mark)}，与东财现价相差 ${live > 0 ? signed(((mark - live) / live) * 100) : '—'}%。这是他关心的价，不是行情。`
      : '用户未另填价格。',
    `成交额 ${num(snapshot?.amountYi)} 亿，换手 ${num(snapshot?.turnover)}%，振幅 ${num(snapshot?.amplitude)}%，量比 ${num(snapshot?.volumeRatio)}`,
    `市盈率 ${num(snapshot?.pe)}，市净率 ${num(snapshot?.pb)}，总市值 ${num(snapshot?.totalMvYi, 0)} 亿，流通市值 ${num(snapshot?.floatMvYi, 0)} 亿`,
    `今日价位：${valuation?.label || '未知'}（${valuation?.tip || '无'}）`,
    ...describeTrend(dayK, limitBand(item, name)),
    `今日主力（亿元，累计）：主力 ${signed(s.main)}，超大 ${signed(s.huge)}，大单 ${signed(s.large)}，中单 ${signed(s.mid)}，小单 ${signed(s.small)}`,
    `本地粗判：${intent?.label || '—'}。${intent?.detail || ''}`,
    days.length ? `近5日主力合计 ${signed(main5)} 亿。逐日：\n${dayLines}` : '近几日主力拆单：未提供（港美韩或接口无数据时不要编造）',
    `大盘：${idx || '暂无'}`,
    `两市成交 ${num(ov?.amountYi)} 亿，涨 ${zd?.up ?? '—'} 家，跌 ${zd?.down ?? '—'} 家，涨停 ${zd?.limitUp ?? '—'}，跌停 ${zd?.limitDown ?? '—'}，北向 ${signed(nb?.last)} 亿，两市主力 ${signed(mktFlow?.main)} 亿`,
    related ? `个股相关资讯（只许引用这些）：\n${related}` : '个股相关资讯：未检索到。不要用常识补新闻。',
    anns ? `近期公告：\n${anns}` : '近期公告：未提供。',
    macro ? `市场快讯（宏观，不一定与该股有关）：\n${macro}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM = [
  '你是个人A股交易参谋，方法只有一条：跟着主力，但先分清真买和诱多，再谈买不买。',
  '只根据用户给出的数字和标题下结论。缺的数据写「未提供」，禁止编造财报、龙虎榜、北向持股、内幕或未列出的新闻。',
  '判断顺序：',
  '1. 真买=主力净流入且小单净流出；诱多=主力与小单一起流入。近5日主力合计为负，或今日主力流出，默认不买。',
  '2. 现价远离MA20上方且距20日高点很近、5日涨幅过大，视为追高，倾向继续等或不买，哪怕主力还在进。',
  '3. 换手或成交额明显放大且主力流出，视为派发。',
  '4. 跌家远多于涨家、北向大幅流出、两市主力流出时，个股再好也把买入概率压低。',
  '5. 资讯只分成利好、利空、无关。没有个股资讯就明确说没有，不要用板块故事代替。',
  '6. 非A股没有主力拆单时，不要假装有主力，只根据涨幅、均线和消息给继续等或不买，买入要更苛刻。',
  '7. 仓位建议单票不超过三成，必须写出放弃条件。禁止承诺收益。',
  '8. 填了成本时：浮盈已经很大不要加仓；亏损且主力流出倾向减仓或不买；成本附近且是真买才允许小仓。没填成本就不要写他已经赚了或亏了。',
  '9. 现价以东财为准。腾讯和东财相差超过0.3%时，在风险里写一句去券商软件核对，不要采用用户手填价格代替行情。',
  '输出严格 JSON：',
  '{"action":"买入|不买|继续等","buyProb":0到100整数,"waitProb":整数,"avoidProb":整数,',
  '"summary":"两句，先说结论再说最关键的一个理由",',
  '"position":"相对用户成本：未持仓/持有/不加仓/考虑减仓，并写出浮盈",',
  '"mainForce":"今日与近5日主力，点明真买/诱多/真卖/不明显",',
  '"trend":"均线位置、区间涨幅、是否追高、量能",',
  '"news":"只根据给出的资讯和公告",',
  '"valuation":"市盈率市净率仅作位置参考，结合涨幅说贵不贵",',
  '"market":"大盘是否允许做多",',
  '"plan":"什么条件下才动手、仓位几成",',
  '"stop":"跌破哪类条件就放弃",',
  '"risk":"当前最大的一个风险"}',
  '三个概率加起来约等于100。',
].join('');

async function postDeepseek(apiKey, body) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 180);
    try {
      msg = JSON.parse(text)?.error?.message || msg;
    } catch {
      /* keep */
    }
    const err = new Error(msg || `DeepSeek ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

export async function askDeepseekReport(apiKey, facts) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: facts },
  ];
  const attempts = [
    { model: 'deepseek-flash', thinking: { type: 'disabled' } },
    { model: 'deepseek-chat' },
  ];
  let json = null;
  let used = 'deepseek-flash';
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      json = await postDeepseek(key, {
        model: attempt.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages,
        ...(attempt.thinking ? { thinking: attempt.thinking } : {}),
      });
      used = attempt.model;
      break;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || '');
      if (/401|invalid|api key|密钥/i.test(msg)) throw e;
    }
  }
  if (!json) throw lastErr || new Error('DeepSeek 分析失败');
  const raw = json?.choices?.[0]?.message?.content || '{}';
  const report = JSON.parse(raw);
  const action = ['买入', '不买', '继续等'].includes(report.action) ? report.action : '继续等';
  return {
    action,
    buyProb: clampPct(report.buyProb),
    waitProb: clampPct(report.waitProb),
    avoidProb: clampPct(report.avoidProb),
    summary: String(report.summary || '').slice(0, 400),
    position: String(report.position || '').slice(0, 300),
    mainForce: String(report.mainForce || '').slice(0, 400),
    trend: String(report.trend || '').slice(0, 400),
    news: String(report.news || '').slice(0, 400),
    valuation: String(report.valuation || '').slice(0, 300),
    market: String(report.market || '').slice(0, 300),
    plan: String(report.plan || '').slice(0, 400),
    stop: String(report.stop || '').slice(0, 240),
    risk: String(report.risk || '').slice(0, 240),
    generatedAt: Date.now(),
    source: used,
  };
}

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}
