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

/** A股纪律止损：主板成本下方 7%，创业板/科创 10%，北交 12%，ST 5%。 */
export function disciplineStop(item, cost) {
  const c = Number(cost);
  if (!(c > 0)) return null;
  const code = String(item?.code || '');
  const name = item?.name || '';
  let gap = null;
  if (/ST/i.test(name)) gap = 0.05;
  else if (item?.market === 'BJ' || /^[48]/.test(code)) gap = 0.12;
  else if (/^(300|301|688|689)/.test(code)) gap = 0.1;
  else if (item?.market === 'SH' || item?.market === 'SZ') gap = 0.07;
  if (!gap) return null;
  return { gap, price: +(c * (1 - gap)).toFixed(2) };
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

function formatLhb(lhb) {
  const rows = lhb?.recent || [];
  if (rows.length) {
    const lines = rows.map(
      (r) =>
        `- ${r.date} 涨跌${signed(r.changePct)}% 龙虎榜净额${signed(r.netYi)}亿 ${r.reason || ''} ${r.seats || ''}`,
    );
    return `近45日龙虎榜：\n${lines.join('\n')}`;
  }
  return `龙虎榜：${lhb?.note || '未提供'}`;
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
  intent,
  center,
  industry,
  lhb,
  tape,
  prior,
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
  const basis = mark > 0 ? mark : cost;
  const pnl = basis > 0 && live > 0 ? ((live - basis) / basis) * 100 : null;
  const pnlDiff = basis > 0 && live > 0 ? live - basis : null;
  const stop = disciplineStop(item, basis);
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

  const bjNow = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return [
    `当前北京时间 ${bjNow}。文中的「今天」就是这一天，不要改成含糊的明天。`,
    `标的：${name} ${item.code} ${item.market || ''}`,
    snapshot?.industry ? `行业：${snapshot.industry}${concepts ? `；概念：${concepts}` : ''}` : '',
    industry?.changePct != null ? `所属行业今日涨跌 ${signed(industry.changePct)}%（${industry.name || snapshot?.industry || ''}）` : '所属行业今日涨跌：未取到',
    `东财现价 ${num(px)}（行情时间 ${emTime}），今日 ${signed(pct)}%，今高 ${num(snapshot?.high ?? quote?.high)} 今低 ${num(snapshot?.low ?? quote?.low)} 开 ${num(snapshot?.open ?? quote?.open)} 昨收 ${num(snapshot?.prevClose ?? quote?.prevClose)}`,
    tx > 0
      ? `腾讯现价 ${num(tx)}（${cross?.time || '时间未知'}），与东财相差 ${signed(diffPct)}%。以东财为准，不要把两个价平均。`
      : '腾讯对照价：未取到。',
    cost > 0 ? `用户成本 ${num(cost)}。` : '用户成本：未填。',
    mark > 0
      ? `用户持仓价 ${num(mark)}。`
      : cost > 0
        ? '用户未另填持仓价，浮盈按成本算。'
        : '用户持仓价：未填。不要假设他已经持仓，也不要编造止损价。',
    basis > 0
      ? `相对东财现价浮盈 ${signed(pnlDiff)} 元，${signed(pnl)}%。${
          stop
            ? `纪律止损价 ${num(stop.price)}（持仓价下方 ${(stop.gap * 100).toFixed(0)}%）。${live > 0 && live <= stop.price ? '现价已跌破止损，action 只能是不买。' : '还没跌破止损。'}`
            : ''
        }`
      : '',
    `成交额 ${num(snapshot?.amountYi)} 亿，换手 ${num(snapshot?.turnover)}%，振幅 ${num(snapshot?.amplitude)}%，量比 ${num(snapshot?.volumeRatio)}`,
    `市盈率 ${num(snapshot?.pe)}，市净率 ${num(snapshot?.pb)}，总市值 ${num(snapshot?.totalMvYi, 0)} 亿，流通市值 ${num(snapshot?.floatMvYi, 0)} 亿`,
    ...describeTrend(dayK, limitBand(item, name)),
    `今日主力（亿元，累计）：主力 ${signed(s.main)}，超大 ${signed(s.huge)}，大单 ${signed(s.large)}，中单 ${signed(s.mid)}，小单 ${signed(s.small)}`,
    `本地粗判：${intent?.label || '—'}。${intent?.detail || ''}`,
    days.length ? `近5日主力合计 ${signed(main5)} 亿。逐日：\n${dayLines}` : '近几日主力拆单：未提供（港美韩或接口无数据时不要编造）',
    `大盘：${idx || '暂无'}`,
    `两市成交 ${num(ov?.amountYi)} 亿，涨 ${zd?.up ?? '—'} 家，跌 ${zd?.down ?? '—'} 家，涨停 ${zd?.limitUp ?? '—'}，跌停 ${zd?.limitDown ?? '—'}，北向 ${signed(nb?.last)} 亿，两市主力 ${signed(mktFlow?.main)} 亿`,
    tape ? `今天环境：${tape}` : '',
    formatLhb(lhb),
    related ? `个股相关资讯（只许引用这些）：\n${related}` : '个股相关资讯：未检索到。不要用常识补新闻。',
    anns ? `近期公告：\n${anns}` : '近期公告：未提供。',
    macro ? `市场快讯（宏观，不一定与该股有关）：\n${macro}` : '',
    prior ? `近5日已生成的报告（只作对照，和今天数据矛盾时以今天为准）：\n${prior}` : '近5日没有这份标的的历史报告。',
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
  '10. 今天环境是「宜等」时，买入概率不要超过25。',
  '11. 行业今日跌超过2%时，压低买入概率，板块在跌就不要因为个股强而追。',
  '12. 近45日龙虎榜净额为负，或说明里有机构卖出，倾向不买。没上榜就写没上榜，禁止编座席位。',
  '13. 现价已经跌破纪律止损价时，action 只能是不买。',
  '14. 用户做当日短线：当天分析、当天决定，默认不拿隔夜。today 要写清今天的买点、什么情况盘中走、尾盘还留不留。',
  '15. 若给出了前几天的报告，consistency 说明结论有没有变。变了就写今天的数据哪里不同。没有历史就写「无更早报告」。',
  '16. 事实里的北京时间就是「今天」。不要只写明天、隔夜，要写成给出的具体日期。',
  '17. hold 只写这只票的持仓或准备买的仓怎么处理，一句。follow 只写跟不跟这只的主力，一句。这两句是用户最后扫一眼的结论。',
  '输出严格 JSON：',
  '{"action":"买入|不买|继续等","buyProb":0到100整数,"waitProb":整数,"avoidProb":整数,',
  '"summary":"四到六句：今天做不做、为什么、最关键的一个条件",',
  '"today":"当日节奏：什么价位附近可以看、什么情况放弃、尾盘是否清掉",',
  '"sector":"所属板块今天能否带动这只票，短线是否跟板块",',
  '"position":"相对用户成本",',
  '"mainForce":"今日与近5日主力，点明真买/诱多/真卖/不明显",',
  '"trend":"均线、涨幅、是否追高、量能",',
  '"news":"只根据给出的资讯和公告，对今天的影响",',
  '"valuation":"位置贵不贵，短线是否还追得动",',
  '"market":"大盘今天允不允许做短线",',
  '"plan":"仓位几成，触发条件",',
  '"exit":"当天怎么走：冲高走、跌破走、还是尾盘走",',
  '"stop":"放弃条件",',
  '"risk":"今天最大的一个风险",',
  '"consistency":"和前几天报告比，结论变了没有",',
  '"hold":"这只票的持仓：拿着、减一点、今天走，或还没买就写买不买，一句",',
  '"follow":"跟不跟这只的主力，一句"}',
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

export async function askDeepseekReport(apiKey, facts, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: facts },
  ];
  const preferred = modelPref === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  const attempts =
    preferred === 'deepseek-v4-pro'
      ? [
          { model: 'deepseek-v4-pro', thinking: { type: 'disabled' } },
          { model: 'deepseek-flash', thinking: { type: 'disabled' } },
          { model: 'deepseek-chat' },
        ]
      : [
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
    summary: clip(report.summary, 700),
    today: clip(report.today, 500),
    sector: clip(report.sector, 400),
    position: clip(report.position, 400),
    mainForce: clip(report.mainForce, 500),
    trend: clip(report.trend, 500),
    news: clip(report.news, 500),
    valuation: clip(report.valuation, 400),
    market: clip(report.market, 400),
    plan: clip(report.plan, 500),
    exit: clip(report.exit, 400),
    stop: clip(report.stop, 300),
    risk: clip(report.risk, 300),
    consistency: clip(report.consistency, 400),
    hold: clip(report.hold, 180),
    follow: clip(report.follow, 180),
    generatedAt: Date.now(),
    source: used,
  };
}

const MARKET_SYSTEM = [
  '你是个人A股短线参谋。用户当天看盘、当天决定做哪些板块，不做中长线配置。',
  '只根据给出的指数、涨跌家数、资金和板块涨跌说话。禁止编造没列出的板块和涨幅。',
  '短线要跟当天最强、主力还在进的方向，已经大涨的板块写明是接力还是不宜再追。',
  '环境差时 action 用「今天不做」。环境一般用「只做最强」。环境好且有明确主线才用「做多」。',
  '若有前几天的大盘报告，consistency 说明主线有没有切换。',
  '事实里的北京时间和「下一交易日」日期必须原样使用。不要只写明天、隔夜。',
  'hold 是手里的票今天整体怎么处理，一句。follow 是跟着主力做哪一个方向、不跟哪些，一句。这是用户最后要看的。',
  '禁止承诺收益。输出严格 JSON：',
  '{"action":"做多|只做最强|今天不做","summary":"今天短线总判断，四到六句",',
  '"leaders":"2到4个今天更可能有短线溢价的板块，每个写今日涨跌和理由",',
  '"avoid":"今天不要碰的板块",',
  '"rhythm":"早盘和午后怎么做，做还是等",',
  '"risk":"今天最大的风险",',
  '"consistency":"和前几天的大盘结论比",',
  '"hold":"手里的票这一天整体怎么处理，一句",',
  '"follow":"跟主力做哪个方向，一句"}',
].join('');

export function buildMarketFacts({ indices, center, boards, tape, prior, sheet, clock }) {
  const idx = (indices || [])
    .slice(0, 8)
    .map((x) => `${x.name || x.code} ${signed(x.changePct)}%`)
    .join('，');
  const zd = center?.updown;
  const ov = center?.overview;
  const nb = center?.northbound;
  const flow = center?.flow?.summary;
  const ranked = [...(boards || [])].filter((b) => Number.isFinite(Number(b.changePct)));
  ranked.sort((a, b) => Number(b.changePct) - Number(a.changePct));
  const top = ranked.slice(0, 8).map((b) => `${b.name} ${signed(b.changePct)}%`).join('，');
  const bottom = ranked.slice(-5).map((b) => `${b.name} ${signed(b.changePct)}%`).join('，');
  return [
    `大盘：${idx || '暂无'}`,
    `环境：${tape || '未知'}`,
    `两市成交 ${num(ov?.amountYi)} 亿，涨 ${zd?.up ?? '—'} 跌 ${zd?.down ?? '—'}，涨停 ${zd?.limitUp ?? '—'}，跌停 ${zd?.limitDown ?? '—'}，北向 ${signed(nb?.last)} 亿，两市主力 ${signed(flow?.main)} 亿`,
    top ? `大A板块涨幅靠前：${top}` : '大A板块：未取到',
    bottom ? `大A板块涨幅靠后：${bottom}` : '',
    prior ? `近5日大盘报告（对照，以今天板块涨跌为准）：\n${prior}` : '近5日没有大盘报告。',
    sheet ? `顺势纸（外盘只是线索，跌家占优时降权；已经大涨的写不宜再追）：\n${sheet}` : '',
    clock || '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function askMarketReport(apiKey, facts, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: MARKET_SYSTEM },
    { role: 'user', content: facts },
  ];
  const preferred = modelPref === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  const attempts =
    preferred === 'deepseek-v4-pro'
      ? [
          { model: 'deepseek-v4-pro', thinking: { type: 'disabled' } },
          { model: 'deepseek-flash', thinking: { type: 'disabled' } },
          { model: 'deepseek-chat' },
        ]
      : [
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
      if (/401|invalid|api key|密钥/i.test(String(e?.message || ''))) throw e;
    }
  }
  if (!json) throw lastErr || new Error('DeepSeek 分析失败');
  const report = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  const action = ['做多', '只做最强', '今天不做'].includes(report.action) ? report.action : '只做最强';
  return {
    kind: 'market',
    action,
    summary: clip(report.summary, 700),
    leaders: clip(report.leaders, 700),
    avoid: clip(report.avoid, 400),
    rhythm: clip(report.rhythm, 500),
    risk: clip(report.risk, 300),
    consistency: clip(report.consistency, 400),
    hold: clip(report.hold, 180),
    follow: clip(report.follow, 180),
    generatedAt: Date.now(),
    source: used,
  };
}

const SEAT_SYSTEM = [
  '你是个人A股短线参谋。用户给你的是期货交易所公布的会员持仓增减，单位是手，不是股票股数。',
  '加多单的意思：这家期货公司当天的多头持仓比上一交易日多了这么多手。加空单是空头持仓增加。',
  '名字里带「代客」的是客户的单，不是期货公司拿自有资金在押方向。不带代客的商品席位，常常是会员合计，同样不是它的自营底仓。',
  '多空一起大增时，写成对冲、套保或客户两边都有。禁止把这种情况说成这家公司单边看多。',
  '只有多头明显增加、空头不动或减少，才写成偏多。只有空头明显增加，才写成偏空。',
  '股指（沪深300、上证50、中证500、中证1000）只说明指数情绪，不要写成去买某一只股票。',
  '商品席位只对应同名板块，例如铜对应有色、原油对应油气。不要推到无关板块。',
  '事实里的日期必须原样使用。hold 是手里的股票这一天怎么处理，一句。follow 是跟不跟这些席位、跟的话跟哪一段，一句。',
  '禁止编造没有列出的席位和手数。禁止承诺收益。输出严格 JSON：',
  '{"action":"跟|不跟|只观察","summary":"用四到六句说明这些席位整体在做什么",',
  '"read":"按席位写：谁在偏多，谁在偏空，谁是多空一起加所以像对冲",',
  '"risk":"最容易看错的地方",',
  '"hold":"手里的票这一天怎么处理，一句",',
  '"follow":"跟不跟这些席位，一句"}',
].join('');

export function buildSeatFacts({ seats, clock }) {
  const rows = [...(seats?.indexRows || []), ...(seats?.commodityRows || [])];
  const lines = rows.map((row) => {
    const who = `${row.house}${row.client ? '（代客，客户的单）' : ''}`;
    return `${seats?.date || ''} ${row.productName} ${row.contract} ${row.hint || ''} ${who} 多单${row.longPos ?? '—'}手 增减${row.longAdd ?? '—'} 空单${row.shortPos ?? '—'}手 增减${row.shortAdd ?? '—'} 页面粗读：${row.stance}`;
  });
  return [
    clock || '',
    seats?.date ? `持仓公布日 ${seats.date}。这是该日收盘后的增减。` : '席位日期未提供。',
    '下面每一行都要单独判断是偏多、偏空，还是多空一起加。',
    lines.join('\n') || '没有席位数据。不要编造。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function askSeatReport(apiKey, facts, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: SEAT_SYSTEM },
    { role: 'user', content: facts },
  ];
  const preferred = modelPref === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  const attempts =
    preferred === 'deepseek-v4-pro'
      ? [
          { model: 'deepseek-v4-pro', thinking: { type: 'disabled' } },
          { model: 'deepseek-flash', thinking: { type: 'disabled' } },
          { model: 'deepseek-chat' },
        ]
      : [
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
      if (/401|invalid|api key|密钥/i.test(String(e?.message || ''))) throw e;
    }
  }
  if (!json) throw lastErr || new Error('DeepSeek 分析失败');
  const report = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  const action = ['跟', '不跟', '只观察'].includes(report.action) ? report.action : '只观察';
  return {
    kind: 'seat',
    action,
    summary: clip(report.summary, 700),
    read: clip(report.read, 800),
    risk: clip(report.risk, 300),
    hold: clip(report.hold, 180),
    follow: clip(report.follow, 180),
    generatedAt: Date.now(),
    source: used,
  };
}

function clip(value, max) {
  return String(value || '').slice(0, max);
}

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}
