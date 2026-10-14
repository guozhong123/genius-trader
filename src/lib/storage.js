export function itemKey(item) {
  return `${item.kind}:${item.market || ''}:${item.code}`;
}

const KEYS = {
  watchlist: 'watchlist_v1',
  settings: 'settings_v1',
};

export const DEFAULT_INDICES = [
  { name: '上证指数', code: '000001', market: 'SH', marketNo: 1, secid: '1.000001', kind: 'stock', label: '沪' },
  { name: '深证成指', code: '399001', market: 'SZ', marketNo: 0, secid: '0.399001', kind: 'stock', label: '深' },
  { name: '创业板指', code: '399006', market: 'SZ', marketNo: 0, secid: '0.399006', kind: 'stock', label: '深' },
  { name: '沪深300', code: '000300', market: 'SH', marketNo: 1, secid: '1.000300', kind: 'stock', label: '沪' },
  { name: '恒生指数', code: 'HSI', market: 'HK', marketNo: 100, secid: '100.HSI', kind: 'stock', label: '港' },
  { name: '纳斯达克', code: 'NDX', market: 'US', marketNo: 100, secid: '100.NDX', kind: 'stock', label: '美' },
];

/** 固定可选指数池（勾选添加） */
export const INDEX_PRESETS = [
  ...DEFAULT_INDICES,
  { name: '上证50', code: '000016', market: 'SH', marketNo: 1, secid: '1.000016', kind: 'stock', label: '沪' },
  { name: '中证500', code: '000905', market: 'SH', marketNo: 1, secid: '1.000905', kind: 'stock', label: '沪' },
  { name: '中证1000', code: '000852', market: 'SH', marketNo: 1, secid: '1.000852', kind: 'stock', label: '沪' },
  { name: '科创50', code: '000688', market: 'SH', marketNo: 1, secid: '1.000688', kind: 'stock', label: '沪' },
  { name: '恒生科技', code: 'HSTECH', market: 'HK', marketNo: 100, secid: '100.HSTECH', kind: 'stock', label: '港' },
  { name: '道琼斯', code: 'DJIA', market: 'US', marketNo: 100, secid: '100.DJIA', kind: 'stock', label: '美' },
  { name: '标普500', code: 'SPX', market: 'US', marketNo: 100, secid: '100.SPX', kind: 'stock', label: '美' },
  { name: '黄金', code: 'BK1617', market: 'BK', marketNo: 90, secid: '90.BK1617', kind: 'stock', label: '板' },
  { name: '白酒', code: 'BK0896', market: 'BK', marketNo: 90, secid: '90.BK0896', kind: 'stock', label: '板' },
  { name: '中证白酒', code: '399997', market: 'SZ', marketNo: 0, secid: '0.399997', kind: 'stock', label: '深' },
  { name: 'COMEX黄金', code: 'GC00Y', market: 'US', marketNo: 101, secid: '101.GC00Y', kind: 'stock', label: '期' },
  { name: '黄金ETF', code: '518880', market: 'SH', marketNo: 1, secid: '1.518880', kind: 'stock', label: '沪' },
];

export const DEFAULT_SETTINGS = {
  theme: 'light',
  viewMode: 'list',
  sortBy: 'manual',
  activeGroup: 'all',
  groups: [{ id: 'default', name: '默认' }],
  indices: DEFAULT_INDICES,
  newsSidebarOpen: true,
  dismissedNewsIds: [],
  readNewsIds: [],
  lastNewsFetchAt: 0,
  cachedNews: [],
  eventBannerDismissDate: '',
  stopBannerDismissed: false,
};

export async function getWatchlist() {
  const data = await chrome.storage.local.get(KEYS.watchlist);
  return Array.isArray(data[KEYS.watchlist]) ? data[KEYS.watchlist] : [];
}

export async function setWatchlist(list) {
  await chrome.storage.local.set({ [KEYS.watchlist]: list });
}

export async function getSettings() {
  const data = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(data[KEYS.settings] || {}), groups: data[KEYS.settings]?.groups?.length ? data[KEYS.settings].groups : DEFAULT_SETTINGS.groups, indices: data[KEYS.settings]?.indices?.length ? data[KEYS.settings].indices : DEFAULT_SETTINGS.indices };
}

export async function saveSettings(partial) {
  const cur = await getSettings();
  const next = { ...cur, ...partial };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function addItem(item) {
  const list = await getWatchlist();
  const id = itemKey(item);
  if (list.some((x) => itemKey(x) === id)) return list;
  const next = [
    ...list,
    {
      ...item,
      groupId: item.groupId || 'default',
      pinned: false,
      order: list.length,
      addedAt: Date.now(),
    },
  ];
  await setWatchlist(next);
  return next;
}

export async function removeItem(item) {
  const id = itemKey(item);
  const next = (await getWatchlist()).filter((x) => itemKey(x) !== id);
  await setWatchlist(next);
  return next;
}

export async function updateItem(item, patch) {
  const id = itemKey(item);
  const list = await getWatchlist();
  const next = list.map((x) => (itemKey(x) === id ? { ...x, ...patch } : x));
  await setWatchlist(next);
  return next;
}

/** 从神器导出数据合并进自选（按代码去重，保留已有项） */
export async function importShenqiBundle(bundle) {
  const groups = Array.isArray(bundle?.groups) ? bundle.groups : [];
  const incoming = Array.isArray(bundle?.watchlist) ? bundle.watchlist : [];
  const settings = await getSettings();

  const groupMap = new Map((settings.groups || []).map((g) => [g.id, g]));
  for (const g of groups) {
    if (!groupMap.has(g.id)) groupMap.set(g.id, g);
    else groupMap.set(g.id, { ...groupMap.get(g.id), name: g.name || groupMap.get(g.id).name });
  }
  const nextGroups = [...groupMap.values()];

  const list = await getWatchlist();
  const exist = new Set(list.map(itemKey));
  const merged = [...list];
  for (const item of incoming) {
    const key = itemKey(item);
    if (exist.has(key)) continue;
    exist.add(key);
    merged.push({
      ...item,
      name: item.name || item.code,
      groupId: item.groupId || 'default',
      pinned: !!item.pinned,
      order: merged.length,
      addedAt: item.addedAt || Date.now(),
    });
  }

  await setWatchlist(merged);
  const nextSettings = await saveSettings({
    groups: nextGroups,
    importedShenqi: true,
  });
  return { list: merged, settings: nextSettings, added: merged.length - list.length };
}

export async function reorderWatchlist(orderedKeys) {
  const list = await getWatchlist();
  const map = new Map(list.map((x) => [itemKey(x), x]));
  const next = orderedKeys
    .map((k, i) => {
      const item = map.get(k);
      if (!item) return null;
      return { ...item, order: i };
    })
    .filter(Boolean);
  // keep any missing at end
  for (const item of list) {
    if (!orderedKeys.includes(itemKey(item))) next.push(item);
  }
  await setWatchlist(next);
  return next;
}
