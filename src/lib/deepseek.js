/**
 * 把本机已拉到的行情/主力/估值交给 DeepSeek，生成个人炒股报告。
 * 密钥只存在本机 storage，不写入仓库。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

function num(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}

export function buildStockFacts({ item, quote, dayK, flow, news, indices, valuation, intent }) {
  const points = dayK?.points || [];
  const closes = points.map((p) => Number(p.close)).filter((n) => n > 0);
  const last = closes.at(-1);
  const pctN = (from, to) =>
    from && to ? (((to - from) / from) * 100).toFixed(2) : null;
  const d5 = closes.length >= 6 ? pctN(closes[closes.length - 6], last) : null;
  const d20 = closes.length >= 21 ? pctN(closes[closes.length - 21], last) : null;
  const s = flow?.summary || {};
  const idx = (indices || [])
    .slice(0, 6)
    .map((x) => `${x.name || x.code} ${num(x.changePct)}%`)
    .join('，');
  const headlines = (news || [])
    .slice(0, 6)
    .map((n) => `- ${n.title || ''}`)
    .join('\n');
  return [
    `标的：${quote?.name || item.name || ''} ${item.code} ${item.market || ''}`,
    `现价 ${num(quote?.price)}，今日涨跌 ${num(quote?.changePct)}%，今高 ${num(quote?.high)} 今低 ${num(quote?.low)} 昨收 ${num(quote?.prevClose)}`,
    `近5日涨跌 ${d5 ?? '—'}%，近20日涨跌 ${d20 ?? '—'}%`,
    `估值位置：${valuation?.label || '未知'}（${valuation?.tip || '无'}）`,
    `主力资金（亿元，当日累计）：主力 ${num(s.main)}，超大 ${num(s.huge)}，大单 ${num(s.large)}，中单 ${num(s.mid)}，小单 ${num(s.small)}`,
    `本地主力意图粗判：${intent?.label || '—'} ${intent?.detail || ''}`,
    `大盘：${idx || '暂无'}`,
    headlines ? `近期相关消息：\n${headlines}` : '近期相关消息：暂无',
  ].join('\n');
}

export async function askDeepseekReport(apiKey, facts) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('缺少 DeepSeek 密钥');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是个人A股交易助手，风格是「跟着主力、控制回撤」，不是荐股销售。只根据用户给出的事实说话，不要编造未提供的财报或内幕。输出严格 JSON：' +
            '{"action":"买入|不买|继续等","buyProb":0到100的整数,"waitProb":整数,"avoidProb":整数,"summary":"两句结论","mainForce":"主力怎么看","news":"利好利空","valuation":"估值与追高风险","market":"大盘环境","plan":"仓位与买卖触发条件","stop":"止损或放弃条件"}。' +
            '三个概率加起来约等于100。已大涨、主力流出、估值偏高时倾向不买或继续等。禁止承诺收益。',
        },
        { role: 'user', content: facts },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 180);
    try {
      msg = JSON.parse(text)?.error?.message || msg;
    } catch {
      /* keep */
    }
    throw new Error(msg || `DeepSeek ${res.status}`);
  }
  const json = JSON.parse(text);
  const raw = json?.choices?.[0]?.message?.content || '{}';
  const report = JSON.parse(raw);
  const action = ['买入', '不买', '继续等'].includes(report.action) ? report.action : '继续等';
  return {
    action,
    buyProb: clampPct(report.buyProb),
    waitProb: clampPct(report.waitProb),
    avoidProb: clampPct(report.avoidProb),
    summary: String(report.summary || '').slice(0, 400),
    mainForce: String(report.mainForce || '').slice(0, 400),
    news: String(report.news || '').slice(0, 400),
    valuation: String(report.valuation || '').slice(0, 300),
    market: String(report.market || '').slice(0, 300),
    plan: String(report.plan || '').slice(0, 400),
    stop: String(report.stop || '').slice(0, 240),
    generatedAt: Date.now(),
    source: 'deepseek',
  };
}

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}
