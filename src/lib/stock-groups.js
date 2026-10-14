/** 把当前自选股按主题归到与基金一致的二级分组 */
export const STOCK_THEME_BY_CODE = {
  // 电网 / 电力
  '561560': '电网',
  '561170': '电网',
  '159326': '电网',
  '600089': '电网',
  '603618': '电网',
  '002300': '电网',
  '601991': '电网',
  // 煤炭
  '601088': '煤炭',
  '515220': '煤炭',
  // 混合消费 / 传媒
  '001330': '混合消费',
  '600825': '混合消费',
  '002739': '混合消费',
  '516670': '混合消费',
  '601086': '混合消费',
  // 恒科
  '513010': '恒科',
  // 生物科技
  '515120': '生物科技',
  '603259': '生物科技',
  // 机器人
  '159039': '机器人',
  '002896': '机器人',
  // 卫星 / 航天
  '159267': '卫星',
  // 人工智能
  '512930': '人工智能',
  // 半导体 / CPO / 光通信
  '588290': 'cpo/半导体',
  '159558': 'cpo/半导体',
  '513310': 'cpo/半导体',
  '300308': 'cpo/半导体',
  '002384': 'cpo/半导体',
  '601869': 'cpo/半导体',
  // 锂电 / 汽车
  '002594': '锂矿/电池',
  '300750': '锂矿/电池',
  '600609': '锂矿/电池',
  '000559': '锂矿/电池',
  // 工业母机
  '601091': '工业母机',
  // 有色
  '601899': '黄金白银有色',
  // 科技 / 通信
  '512570': '科技',
  '003005': '科技',
  '600103': '科技',
  '002467': '科技',
  '600207': '科技',
  // 石油能源
  '159195': '煤炭',
};

export function regroupStocks(list, groups) {
  const nameToId = new Map((groups || []).map((g) => [g.name, g.id]));
  // aliases
  nameToId.set('自选股', nameToId.get('自选股') || nameToId.get('股票'));
  let changed = false;
  const next = list.map((item) => {
    if (item.kind !== 'stock') return item;
    const theme = STOCK_THEME_BY_CODE[String(item.code)];
    if (!theme) return item;
    const gid = nameToId.get(theme);
    if (!gid || item.groupId === gid) return item;
    changed = true;
    return { ...item, groupId: gid };
  });
  return { list: next, changed };
}
