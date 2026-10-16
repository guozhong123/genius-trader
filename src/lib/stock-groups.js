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
  // 锂电
  '002594': '锂矿/电池',
  '300750': '锂矿/电池',
  // 汽车（不是锂矿）
  '600609': '汽车',
  '000559': '汽车',
  // 工业母机
  '601091': '工业母机',
  // 有色
  '601899': '黄金白银有色',
  // 科技
  '003005': '科技',
  // 证券不是科技
  '512570': '金融',
  // 通信
  '002467': '通信',
  // 石油不是煤炭；养殖不是消费
  '159195': '石油',
  '516670': '养殖',
};

/** 只改还停在旧错误分组里的代码，手动改过的不动 */
const THEME_REPAIR_FROM = {
  '600609': '锂矿/电池',
  '000559': '锂矿/电池',
  '512570': '科技',
  '002467': '科技',
  '159195': '煤炭',
  '516670': '混合消费',
  '600103': '科技',
  '600207': '科技',
};

const LEGACY_GROUP_NAMES = new Set(['未分组', '默认', '默认分组']);

function slugGroupId(name) {
  return `g_${name.replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 24)}_${Date.now().toString(36)}`;
}

/**
 * 清理旧版「未分组/默认」，统一为「其他」(id other)，并重映射 groupId
 */
export function normalizeGroups(settingsGroups, list) {
  let changed = false;
  const removedIds = new Set();
  const groups = [];

  for (const g of settingsGroups || []) {
    if (g.id === 'default' || LEGACY_GROUP_NAMES.has(g.name)) {
      removedIds.add(g.id);
      changed = true;
      continue;
    }
    groups.push({ ...g });
  }

  if (!groups.some((g) => g.id === 'other')) {
    groups.unshift({ id: 'other', name: '其他' });
    changed = true;
  }

  const nextList = (list || []).map((item) => {
    const gid = item.groupId || 'other';
    if (gid === 'default' || removedIds.has(gid)) {
      changed = true;
      return { ...item, groupId: 'other' };
    }
    if (!item.groupId) {
      changed = true;
      return { ...item, groupId: 'other' };
    }
    return item;
  });

  return { groups, list: nextList, changed };
}

/** 导入分组：未分组/默认 → 其他 */
export function normalizeImportedGroup(g) {
  if (!g) return { id: 'other', name: '其他' };
  if (g.id === 'default' || LEGACY_GROUP_NAMES.has(g.name)) {
    return { id: 'other', name: '其他' };
  }
  return g;
}

export function repairStockGroups(list, groups) {
  const nextGroups = [...(groups || [])];
  const nameToId = new Map(nextGroups.map((g) => [g.name, g.id]));
  const idToName = new Map(nextGroups.map((g) => [g.id, g.name]));
  const ensure = (name) => {
    if (name === '其他') {
      if (!nameToId.has('其他')) {
        nextGroups.unshift({ id: 'other', name: '其他' });
        nameToId.set('其他', 'other');
        idToName.set('other', '其他');
      }
      return nameToId.get('其他');
    }
    if (nameToId.has(name)) return nameToId.get(name);
    const id = `g_${name.replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 24)}`;
    nextGroups.push({ id, name });
    nameToId.set(name, id);
    idToName.set(id, name);
    return id;
  };

  let changed = false;
  const next = (list || []).map((item) => {
    if (item.kind !== 'stock') return item;
    const code = String(item.code);
    const from = THEME_REPAIR_FROM[code];
    const theme = STOCK_THEME_BY_CODE[code];
    const current = idToName.get(item.groupId || 'other') || '';
    if (from && current === from) {
      const gid = theme ? ensure(theme) : ensure('其他');
      if (gid !== item.groupId) {
        changed = true;
        return { ...item, groupId: gid };
      }
    }
    if (!theme && (code === '600103' || code === '600207') && current === '科技') {
      const gid = ensure('其他');
      if (gid !== item.groupId) {
        changed = true;
        return { ...item, groupId: gid };
      }
    }
    return item;
  });
  if (nextGroups.length !== (groups || []).length) changed = true;
  return { list: next, groups: nextGroups, changed };
}

export function regroupStocks(list, groups) {
  const nextGroups = [...(groups || [])];
  const nameToId = new Map(nextGroups.map((g) => [g.name, g.id]));

  const ensureGroupByName = (name) => {
    if (nameToId.has(name)) return nameToId.get(name);
    const id = name === '其他' ? 'other' : slugGroupId(name);
    nextGroups.push({ id, name });
    nameToId.set(name, id);
    return id;
  };

  ensureGroupByName('其他');

  let changed = false;
  const next = (list || []).map((item) => {
    if (item.kind !== 'stock') return item;
    const theme = STOCK_THEME_BY_CODE[String(item.code)];
    const groupName = theme || '其他';
    const gid = ensureGroupByName(groupName);
    if (item.groupId === gid) return item;
    changed = true;
    return { ...item, groupId: gid };
  });

  if (nextGroups.length !== (groups || []).length) changed = true;

  return { list: next, groups: nextGroups, changed };
}
