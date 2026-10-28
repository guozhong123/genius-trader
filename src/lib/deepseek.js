/**
 * 把本机已拉到的行情、主力、均线、个股消息交给 DeepSeek。
 * 密钥只存在本机 storage，不写入仓库。
 * 原则：数据源负责「看」（带时间戳的东财/腾讯），模型只负责「想」。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** 所有 DeepSeek 角色共用：禁止把语言模型当行情终端 */
const FACTS_GROUNDING = [
  '你没有实时行情通道。禁止凭训练记忆报出现价、涨跌幅、成交额、资金流向或臆造数字。',
  '用户消息里的数字才是唯一依据；每条事实若带「行情时间/北京时间」，解读时必须沿用，不要改成「大概」。',
  '缺字段就写「未提供」。看起来合理但事实里没有的价格，一律视为编造，禁止输出。',
  '你的工作是推理与纪律（做不做、跟哪条主线、买/等/不买、仓位与放弃条件），不是充当行情软件。',
].join('');

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
  const lots = Number(item?.lots ?? item?.markPrice);
  const live = Number(px);
  const emTime = quote?.updatedAt
    ? new Date(quote.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知';
  const tx = Number(cross?.price);
  const diffPct = live > 0 && tx > 0 ? ((tx - live) / live) * 100 : null;
  const pnl = cost > 0 && live > 0 ? ((live - cost) / cost) * 100 : null;
  const perShare = cost > 0 && live > 0 ? live - cost : null;
  const lotMul =
    item?.kind === 'fund' || item?.market === 'FUND'
      ? 1
      : item?.market === 'SH' || item?.market === 'SZ' || item?.market === 'BJ'
        ? 100
        : 1;
  const pnlMoney = perShare != null && lots > 0 ? perShare * lots * lotMul : null;
  const stop = disciplineStop(item, cost);
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
    cost > 0 ? `用户成本 ${num(cost)}。` : '用户成本：未填。不要假设他已经持仓，也不要编造止损价。',
    lots > 0
      ? `用户手数/份额 ${num(lots, lots % 1 ? 2 : 0)}（A股按手×100股，基金按份）。`
      : '用户手数：未填。浮盈只给百分比，不给总金额。',
    cost > 0
      ? `相对东财现价浮盈 ${signed(pnl)}%${pnlMoney != null ? `，约 ${signed(pnlMoney)} 元` : ''}。${
          stop
            ? `纪律止损价 ${num(stop.price)}（成本下方 ${(stop.gap * 100).toFixed(0)}%）。${live > 0 && live <= stop.price ? '现价已跌破止损，action 只能是不买。' : '还没跌破止损。'}`
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
  FACTS_GROUNDING,
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
  '14. 用户做当日短线：当天分析、当天决定。today 只写什么价附近可以买、什么价该卖、尾盘留不留。',
  '15. 若给出了前几天的报告，consistency 说明结论有没有变。变了就写今天的数据哪里不同。没有历史就写「无更早报告」。',
  '16. 事实里的北京时间就是「今天」。不要只写明天、隔夜，要写成给出的具体日期。',
  '17. summary 最多两句，先给结论。hold 必须写卖不卖、卖几成、拿不拿；没填成本或手数就写买不买、买几成、什么价买。exit 写具体价格。follow 一句。不要重复展开。',
  '输出严格 JSON：',
  '{"action":"买入|不买|继续等","buyProb":0到100整数,"waitProb":整数,"avoidProb":整数,',
  '"summary":"最多两句：今天卖不卖或买不买，以及唯一条件",',
  '"today":"什么价附近买、什么价卖、尾盘留不留",',
  '"sector":"所属板块今天能否带动这只票，短线是否跟板块",',
  '"position":"相对用户成本",',
  '"mainForce":"今日与近5日主力，点明真买/诱多/真卖/不明显",',
  '"trend":"均线、涨幅、是否追高、量能",',
  '"news":"只根据给出的资讯和公告，对今天的影响",',
  '"valuation":"位置贵不贵，短线是否还追得动",',
  '"market":"大盘今天允不允许做短线",',
  '"plan":"仓位几成，触发条件",',
  '"exit":"什么价卖、卖几成；没仓就写什么价买，一句",',
  '"stop":"放弃条件",',
  '"risk":"今天最大的一个风险",',
  '"consistency":"和前几天报告比，结论变了没有",',
  '"hold":"卖不卖、卖几成、拿不拿；没仓就写买几成和什么价，一句",',
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
  FACTS_GROUNDING,
  '你是个人A股短线参谋。用户当天看盘、当天决定做哪些板块，不做中长线配置。',
  '只根据给出的指数、涨跌家数、资金和板块涨跌说话。禁止编造没列出的板块和涨幅。',
  '短线要跟当天最强、主力还在进的方向，已经大涨的板块写明是接力还是不宜再追。',
  '环境差时 action 用「今天不做」。环境一般用「只做最强」。环境好且有明确主线才用「做多」。',
  '必须用给出的星期、是否节前/节后/周五、避险情绪。节前红盘只是历史倾向，和今天涨跌家数冲突时以今天为准，禁止写成必涨。',
  '避险要黄金、外盘权益、跌家、北向至少两项一起才写避险偏强。只有黄金涨，写成线索不够。',
  '周五默认不建议隔夜。长假前一天可以有冲高，但尾盘写成宜兑现，不新开隔夜重仓。节后第一天不追高开。',
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

export function buildMarketFacts({ indices, center, boards, tape, prior, sheet, clock, calendar }) {
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
    `本机拉取事实的北京时间 ${bjNow}。以下指数/涨跌家数/资金/板块均来自东财等公开接口，不是模型记忆。`,
    calendar || '',
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
  FACTS_GROUNDING,
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

const LHB_SYSTEM = [
  FACTS_GROUNDING,
  '你是个人A股短线参谋。用户给你的是东财龙虎榜营业部净买入明细（亿元），不是期货持仓。',
  '每一行是：营业部名称、买入的股票、净买入额、标签（机构/北向/游资）。净额为正是净买入，为负是净卖出。',
  '机构、北向、知名游资席位更值得写；不要把未知营业部写成庄家底仓。',
  '同一股票多席位同向净买，写成资金聚焦；多空打架或一日游风格席位，写成谨慎跟。',
  '禁止编造名单外的营业部、股票和金额。禁止承诺收益。',
  'hold 是手里股票今天怎么处理，一句。follow 是跟不跟这些龙虎榜动向、跟哪一段，一句。',
  '输出严格 JSON：',
  '{"action":"跟|不跟|只观察","summary":"四到六句总判断",',
  '"read":"按席位/股票写：谁在买、买了谁、是否像接力还是出货",',
  '"risk":"最容易看错的地方",',
  '"hold":"手里的票这一天怎么处理，一句",',
  '"follow":"跟不跟这些龙虎榜动向，一句"}',
].join('');

/** 盘况龙虎榜：本机刚拉到的营业部净买入事实 */
export function buildLhbFacts({ date, rows, clock }) {
  const bjNow = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  const lines = (rows || []).map(
    (row, i) =>
      `${i + 1}. ${row.tag ? `[${row.tag}] ` : ''}${row.name || '营业部'} → ${row.stock || '—'} 净额 ${signed(row.netYi)} 亿`,
  );
  return [
    `本机拉取事实的北京时间 ${bjNow}。以下来自东财龙虎榜接口，不是模型记忆。`,
    clock || '',
    date ? `龙虎榜交易日 ${date}` : '龙虎榜日期未提供。',
    lines.join('\n') || '没有龙虎榜席位。不要编造。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function askLhbReport(apiKey, facts, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: LHB_SYSTEM },
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
    kind: 'lhb',
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

const LHB_DAYTRIP_SYSTEM = [
  FACTS_GROUNDING,
  '你是个人A股「主力一日游 / 打板接力」超短参谋。用户玩法固定：',
  '当晚龙虎榜出来后分析锁票 → 次日低开或盘中低点买入 → 第三天卖出兑现（A股T+1）。',
  '只从给出的龙虎榜名单里挑 2～3 只，禁止名单外代码。必须恰好按买入概率从高到低排序。',
  '核心逻辑：顺势跟主力真买；位置已高、诱多、纯游资一日游出货要大幅降权。',
  'force 只能是：真买 / 诱多 / 分歧 / 不明。',
  'position 只能是：不高 / 偏高 / 追高。',
  'buyProb 是「次日按计划低吸后、第三天能兑现」的主观概率 0～100，整数。诱多或追高一般 ≤45；真买且位置不高可到 55～78；禁止给 90 以上。',
  'buyPlan 写次日怎么买（低开几点附近、是否等回踩）；sellPlan 写第三天怎么卖（高开减、冲高卖、破位走）。',
  'reason 一句人话，点明买家类型与真买/诱多判断。risk 一句主要风险。',
  '禁止承诺收益。输出严格 JSON：',
  '{"note":"两句总判断（适不适合做一日游）",',
  '"picks":[{"code":"600000","name":"浦发银行","buyProb":62,"force":"真买","position":"不高",',
  '"reason":"机构净买且位置不高","buyPlan":"次日低开1%内或回踩分时均线买","sellPlan":"第三天冲高减仓，弱转强才拿到尾盘","risk":"大盘若低开扩散则放弃"}]}',
].join('');

function clampBuyProb(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

/** 龙虎榜一日游分析：买入概率 + 真买/诱多 + 次日买/第三天卖计划 */
export async function askLhbPick3(apiKey, { date, rows, clock, tape, marketBits }, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const bjNow = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  const lines = (rows || []).map((row, i) => {
    const seats =
      (row.buyers || [])
        .map((b) => `${b.short || b.seat} ${signed(b.netYi)}亿`)
        .join('、') || row.seats || '未提供';
    const pos = row.aiPos;
    const posBit = pos
      ? ` 近5日合计${signed(pos.sum5)}% 距20日高${signed(pos.distHigh)}%`
      : '';
    return `${i + 1}. ${row.code} ${row.name} 上榜涨跌${signed(row.changePct)}% 净买${signed(row.netYi)}亿 买家:${(row.buyerTags || []).join('/') || '未标注'} 席位:${seats}${posBit}`;
  });
  const facts = [
    `本机拉取事实的北京时间 ${bjNow}。以下来自东财龙虎榜与本机日K，不是模型记忆。`,
    clock || '',
    date ? `龙虎榜交易日 ${date}（收盘后披露）。用户打算次日买、第三天卖。` : '龙虎榜日期未提供。',
    tape ? `大盘情绪：${tape}` : '',
    marketBits || '',
    '候选名单：',
    lines.join('\n') || '没有龙虎榜。不要编造。',
    '请按一日游/打板接力逻辑给出 2～3 只，并写清买入概率与真买/诱多。',
  ]
    .filter(Boolean)
    .join('\n');
  const messages = [
    { role: 'system', content: LHB_DAYTRIP_SYSTEM },
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
  const byCode = new Map((rows || []).map((r) => [String(r.code), r]));
  const forceOk = new Set(['真买', '诱多', '分歧', '不明']);
  const posOk = new Set(['不高', '偏高', '追高']);
  const picks = (Array.isArray(report.picks) ? report.picks : [])
    .map((p) => {
      const code = String(p?.code || '').replace(/\D/g, '').slice(-6);
      const row = byCode.get(code);
      if (!row) return null;
      const force = forceOk.has(String(p.force || '').trim()) ? String(p.force).trim() : '不明';
      const position = posOk.has(String(p.position || '').trim()) ? String(p.position).trim() : '不明';
      return {
        code: row.code,
        name: row.name,
        buyProb: clampBuyProb(p.buyProb),
        force,
        position,
        reason: clip(p.reason || '', 100),
        buyPlan: clip(p.buyPlan || '', 80),
        sellPlan: clip(p.sellPlan || '', 80),
        risk: clip(p.risk || '', 80),
        buyerTags: row.buyerTags || [],
        netYi: row.netYi,
        changePct: row.changePct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.buyProb - a.buyProb)
    .slice(0, 3);
  return {
    kind: 'lhb-daytrip',
    picks,
    note: clip(report.note, 220),
    generatedAt: Date.now(),
    source: used,
    boardDate: date || '',
  };
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

function holdingBlock(row) {
  const { item, quote, dayK } = row;
  const live = Number(quote?.price);
  const cost = Number(item?.cost);
  const lots = Number(item?.lots);
  const pct = Number(quote?.changePct);
  const pnl = cost > 0 && live > 0 ? ((live - cost) / cost) * 100 : null;
  const stop = disciplineStop(item, cost);
  const trend = describeTrend(dayK, limitBand(item, item?.name)).slice(0, 4).join('；');
  return [
    `${item.name || ''} ${item.code}`,
    `现价 ${num(live)} 今日 ${signed(pct)}% 今高 ${num(quote?.high)} 今低 ${num(quote?.low)}`,
    cost > 0 ? `成本 ${num(cost)} 浮盈 ${signed(pnl)}% 手数 ${num(lots, lots % 1 ? 2 : 0)}` : `手数 ${num(lots, lots % 1 ? 2 : 0)} 成本未填`,
    stop ? `纪律止损 ${num(stop.price)}${live > 0 && live <= stop.price ? '，已跌破' : ''}` : '',
    trend || '日K未取到',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildHoldingsFacts(rows) {
  const bjNow = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  const body = (rows || []).map(holdingBlock).join('\n---\n');
  return [
    `当前北京时间 ${bjNow}。文中的今天就是这一天。`,
    '下面全是用户已经持仓的股票（手数已填）。不要分析名单以外的票，不要编造新闻、龙虎榜或资金流。',
    body || '没有持仓。',
  ].join('\n');
}

const HOLDINGS_SYSTEM = [
  FACTS_GROUNDING,
  '你是个人短线参谋。用户已经持有下面这些股票，要你判断：哪些今天还适合买（加仓或今天才值得动手），已经拿着的应该什么时候卖。',
  '只根据给出的现价、涨跌、成本和日K位置。缺的数据写未提供，禁止编造主力、消息和目标价。',
  '适合今天买：现价不在20日高点附近、没有远离均线追高、没有跌破纪律止损。已经浮盈很大的不要再建议买。',
  '卖出时机要写成能执行的条件：冲到压力附近卖、跌破止损卖、尾盘不留隔夜。不要只写「择机卖出」。',
  '今天不适合动的放进 hold，一句原因。',
  '输出严格 JSON：',
  '{"summary":"今天整体两句",',
  '"buy":[{"code":"代码","name":"名称","why":"为什么今天可以买","when":"什么价位或什么情况买"}],',
  '"sell":[{"code":"代码","name":"名称","when":"什么时候卖","why":"为什么"}],',
  '"hold":[{"code":"代码","name":"名称","note":"为什么今天先拿着"}]}',
  'buy、sell、hold 里的 code 必须来自名单。没有就给空数组。每类最多 8 只。',
].join('');

export async function askHoldingsReport(apiKey, facts, modelPref) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: HOLDINGS_SYSTEM },
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
  const report = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  const clean = (list) =>
    (Array.isArray(list) ? list : [])
      .map((row) => ({
        code: String(row?.code || '').replace(/\D/g, '').slice(0, 6),
        name: clip(row?.name, 20),
        why: clip(row?.why, 180),
        when: clip(row?.when, 180),
        note: clip(row?.note, 180),
      }))
      .filter((row) => row.code)
      .slice(0, 8);
  return {
    summary: clip(report.summary, 400),
    buy: clean(report.buy),
    sell: clean(report.sell),
    hold: clean(report.hold),
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

const SCAN_SYSTEM = [
  FACTS_GROUNDING,
  '你给一批自选股同时打分，只输出买入、继续等、不买的概率。',
  '只根据给出的现价、涨跌、成本、止损和日K位置。禁止编造主力、新闻和目标价。',
  '远离20日高点、均线之上追高、或已经跌破纪律止损：买入概率要低。',
  '三个概率加起来约等于100。action 取概率最高的一项。',
  '输出严格 JSON：{"items":[{"code":"6位代码","action":"买入|继续等|不买","buyProb":0到100,"waitProb":0到100,"avoidProb":0到100}]}',
  'items 必须覆盖名单里的每一只，不要多出名单外的代码。',
].join('');

export function buildScanFacts(rows, tape) {
  const body = (rows || []).map(holdingBlock).join('\n---\n');
  return [tape || '', '下面每只单独打分，不要漏。', body].filter(Boolean).join('\n');
}

export async function askScanBatch(apiKey, facts) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: SCAN_SYSTEM },
    { role: 'user', content: facts },
  ];
  const attempts = [
    { model: 'deepseek-flash', thinking: { type: 'disabled' } },
    { model: 'deepseek-chat' },
  ];
  let json = null;
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
      break;
    } catch (e) {
      lastErr = e;
      if (/401|invalid|api key|密钥/i.test(String(e?.message || ''))) throw e;
    }
  }
  if (!json) throw lastErr || new Error('DeepSeek 分析失败');
  const report = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  const list = Array.isArray(report.items) ? report.items : Array.isArray(report.stocks) ? report.stocks : [];
  return list
    .map((row) => {
      const action = ['买入', '继续等', '不买'].includes(row?.action) ? row.action : '继续等';
      return {
        code: String(row?.code || '').replace(/\D/g, '').slice(-6),
        action,
        buyProb: clampPct(row?.buyProb),
        waitProb: clampPct(row?.waitProb),
        avoidProb: clampPct(row?.avoidProb),
      };
    })
    .filter((row) => row.code);
}

const FORCE_SYSTEM = [
  FACTS_GROUNDING,
  '你判断今天A股主力盘中可能怎么走，给短线用。',
  '只根据给出的日历、资金、涨跌家数和板块涨跌。禁止编造市盈率、目标点位和没列出的新闻。',
  '早上强、下午转弱要写成条件，不要写成已经发生。',
  '位置靠后只看今天涨跌：跌得多、但不是跌停潮的，写成位置靠后、可能有修复。禁止写低估值或市盈率。',
  '每句都短。输出严格 JSON：',
  '{"now":"现在主力一句","later":"下午可能一句","turn":"由强转弱的条件一句","watch":["最多4个板块"],"soft":[{"name":"板块","why":"一句"}]}',
].join('');

export async function askForceOutlook(apiKey, facts) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const messages = [
    { role: 'system', content: FORCE_SYSTEM },
    { role: 'user', content: facts },
  ];
  const attempts = [
    { model: 'deepseek-flash', thinking: { type: 'disabled' } },
    { model: 'deepseek-chat' },
  ];
  let json = null;
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
      break;
    } catch (e) {
      lastErr = e;
      if (/401|invalid|api key|密钥/i.test(String(e?.message || ''))) throw e;
    }
  }
  if (!json) throw lastErr || new Error('DeepSeek 分析失败');
  const report = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  const watch = (Array.isArray(report.watch) ? report.watch : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const soft = (Array.isArray(report.soft) ? report.soft : [])
    .map((row) => ({
      name: String(row?.name || '').trim(),
      why: String(row?.why || '').trim(),
    }))
    .filter((row) => row.name)
    .slice(0, 6);
  return {
    now: String(report.now || '').trim(),
    later: String(report.later || '').trim(),
    turn: String(report.turn || '').trim(),
    watch,
    soft,
  };
}

async function askJson(apiKey, system, facts, modelPref, temperature = 0.25) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
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
  let used = preferred;
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      json = await postDeepseek(key, {
        model: attempt.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: facts },
        ],
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
  return { report: JSON.parse(json?.choices?.[0]?.message?.content || '{}'), source: used };
}

const PREDICT_SYSTEM = [
  FACTS_GROUNDING,
  '你是个人A股短线参谋，专做「情景推演」：例如早盘急跌几个点、下午修复到翻红（类似做T/低吸）。',
  '只根据用户给出的指数日K、涨跌家数、主力资金、主线。禁止编造未提供的现价和新闻。',
  'forecastBars 必须正好 5 根，每根相对「上一根收盘」的开高低收涨跌幅（百分比小数，如 -0.8 表示跌 0.8%）。',
  'pctHigh ≥ max(pctOpen,pctClose)，pctLow ≤ min(pctOpen,pctClose)。幅度要克制，单日 |pctClose| 一般不超过 2.5。',
  'forecastFlow 必须给出后续交易时段的「主力净流入（亿元）」推演曲线，大约 12～16 个点。',
  'time 用 HH:MM；若已收盘则推明天 09:35 起；若盘中则从下一时刻续写到 15:00。main 是累计主力净流入（亿），要与事实里最近主力值衔接，不要跳变。',
  'scenarios 写 2～4 个可执行情景（做T、低吸、空仓等），trigger/action/exit 各一句。',
  '禁止承诺收益。输出严格 JSON：',
  '{"summary":"两到三句总看法",',
  '"ta":{"scenario":"主情景名","advice":"怎么做","buyZone":"买点","sellZone":"卖点","avoid":"别做什么"},',
  '"scenarios":[{"title":"","trigger":"","action":"","exit":""}],',
  '"forecastBars":[{"pctOpen":0,"pctHigh":0,"pctLow":0,"pctClose":0,"note":"一句"}],',
  '"forecastFlow":[{"time":"09:35","main":0.0}]}',
].join('');

export function buildPredictFacts({ indexName, lastClose, recentBars, tape, flow, flowSeries, mains, clock }) {
  const bars = (recentBars || [])
    .slice(-20)
    .map(
      (p) =>
        `${p.date} 开${num(p.open)} 高${num(p.high)} 低${num(p.low)} 收${num(p.close)} 涨跌${signed(p.changePct)}%`,
    )
    .join('\n');
  const flowPts = (flowSeries || [])
    .slice(-20)
    .map((p) => `${p.time} 主力${num(p.main)}亿`)
    .join('；');
  return [
    clock || '',
    `指数 ${indexName || '上证指数'} 最近收盘 ${num(lastClose)}。`,
    tape ? `市场情绪：${tape}` : '',
    flow || '',
    flowPts ? `今日主力分时（抽样，单位亿）：${flowPts}` : '今日主力分时未提供。',
    mains ? `主线线索：${mains}` : '',
    '近20根日K（只许用这些数字推演未来5根）：',
    bars || '日K未提供。',
    '请给出：1) 做T/低吸情景 2) 未来5个交易日预测K 3) 后续主力资金分时推演 forecastFlow。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function askPredictPack(apiKey, facts, modelPref) {
  const { report, source } = await askJson(apiKey, PREDICT_SYSTEM, facts, modelPref, 0.3);
  const scenarios = (Array.isArray(report.scenarios) ? report.scenarios : [])
    .map((row) => ({
      title: clip(row?.title, 40),
      trigger: clip(row?.trigger, 120),
      action: clip(row?.action, 160),
      exit: clip(row?.exit, 120),
    }))
    .filter((row) => row.title || row.action)
    .slice(0, 4);
  const forecastBars = (Array.isArray(report.forecastBars) ? report.forecastBars : [])
    .slice(0, 5)
    .map((row) => ({
      pctOpen: Number(row?.pctOpen),
      pctHigh: Number(row?.pctHigh),
      pctLow: Number(row?.pctLow),
      pctClose: Number(row?.pctClose),
      note: clip(row?.note, 40),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.pctOpen) &&
        Number.isFinite(row.pctHigh) &&
        Number.isFinite(row.pctLow) &&
        Number.isFinite(row.pctClose),
    );
  const forecastFlow = (Array.isArray(report.forecastFlow) ? report.forecastFlow : [])
    .map((row) => {
      const time = String(row?.time || '').trim();
      const main = Number(row?.main);
      if (!/^\d{1,2}:\d{2}$/.test(time) || !Number.isFinite(main)) return null;
      const [hh, mm] = time.split(':');
      return { time: `${hh.padStart(2, '0')}:${mm}`, main: +main.toFixed(2) };
    })
    .filter(Boolean)
    .slice(0, 24);
  const ta = report.ta && typeof report.ta === 'object' ? report.ta : {};
  return {
    kind: 'predict',
    summary: clip(report.summary, 500),
    ta: {
      scenario: clip(ta.scenario, 40),
      advice: clip(ta.advice, 280),
      buyZone: clip(ta.buyZone, 120),
      sellZone: clip(ta.sellZone, 120),
      avoid: clip(ta.avoid, 160),
    },
    scenarios,
    forecastBars,
    forecastFlow,
    generatedAt: Date.now(),
    source,
  };
}

const SIM_SYSTEM = [
  FACTS_GROUNDING,
  '你是「AI 模拟盘」操盘手：用虚拟本金买卖 A 股，给出清晰下单计划。',
  '优先考虑用户持仓里的股票（可做T、加减仓）；也可以从自选/候选里另选。单票仓位建议不超过总资产三成。',
  '只能用事实里的现价。禁止编造行情。现金不够就不要买。已有仓位才能卖。',
  '成交价必须写事实里的现价；系统会按现价成交并另扣万五手续费，不要假设买入瞬间就有浮盈。',
  '每笔写清：买/卖、代码、价格（用现价）、手数（1手=100股）、计划何时买、拿到何时卖、为什么。',
  '今天最多 4 笔订单。若看空可空仓、只输出空数组。禁止承诺收益。',
  '输出严格 JSON：',
  '{"note":"今天操盘思路两到四句",',
  '"orders":[{"side":"buy|sell","code":"六位代码","name":"名称","market":"SH|SZ|BJ",',
  '"price":现价附近小数,"lots":整数手数,"planBuy":"预计何时/什么价买",',
  '"planSell":"预计何时/什么价卖","holdUntil":"拿到什么时候","why":"为什么买或卖"}]}',
].join('');

export function buildSimFacts({ book, holdings, candidates, tape, clock }) {
  const pos = (book?.positions || [])
    .map(
      (p) =>
        `模拟仓 ${p.name} ${p.code} ${p.market || ''} 成本${num(p.avgCost)} 现价参考${num(p.mark)} 股数${p.shares} 浮盈参考${num(p.unrealized)}元`,
    )
    .join('\n');
  const hold = (holdings || [])
    .map(
      (h) =>
        `用户持仓 ${h.name} ${h.code} ${h.market || ''} 成本${num(h.cost)} 现价${num(h.price)} 涨跌${signed(h.changePct)}% 手数${num(h.lots, 1)}`,
    )
    .join('\n');
  const cand = (candidates || [])
    .map((c) => `候选 ${c.name} ${c.code} ${c.market || ''} 现价${num(c.price)} 涨跌${signed(c.changePct)}%`)
    .join('\n');
  return [
    clock || '',
    tape ? `大盘情绪：${tape}` : '',
    `模拟账本：初始本金 ${num(book?.capital, 0)} 元，现金 ${num(book?.cash, 0)} 元，已实现盈亏 ${num(book?.realizedPnl, 0)} 元。`,
    pos || '模拟仓：空仓。',
    hold || '用户持仓：无（可从候选里选）。',
    cand || '候选：无。',
    '请给出今天最多4笔模拟买卖。价格必须贴近给出的现价。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function askSimOrders(apiKey, facts, modelPref) {
  const { report, source } = await askJson(apiKey, SIM_SYSTEM, facts, modelPref, 0.25);
  const orders = (Array.isArray(report.orders) ? report.orders : [])
    .map((row) => {
      const side = row?.side === 'sell' ? 'sell' : row?.side === 'buy' ? 'buy' : '';
      const code = String(row?.code || '')
        .replace(/\D/g, '')
        .slice(-6);
      const lots = Math.max(0, Math.round(Number(row?.lots) || 0));
      const price = Number(row?.price);
      if (!side || !code || !(lots > 0) || !(price > 0)) return null;
      let market = String(row?.market || '').toUpperCase();
      if (!['SH', 'SZ', 'BJ'].includes(market)) {
        market = code.startsWith('6') ? 'SH' : code.startsWith('4') || code.startsWith('8') ? 'BJ' : 'SZ';
      }
      return {
        side,
        code,
        name: clip(row?.name || code, 20),
        market,
        price: +price.toFixed(2),
        lots,
        planBuy: clip(row?.planBuy, 80),
        planSell: clip(row?.planSell, 80),
        holdUntil: clip(row?.holdUntil, 60),
        why: clip(row?.why, 160),
      };
    })
    .filter(Boolean)
    .slice(0, 4);
  return {
    note: clip(report.note, 500),
    orders,
    generatedAt: Date.now(),
    source,
  };
}
