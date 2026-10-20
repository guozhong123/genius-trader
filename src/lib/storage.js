import { normalizeGroups, normalizeImportedGroup } from './stock-groups.js';
import {
  pickCloudSettings,
  pullCloudBundle,
  pushCloudBundle,
} from './cloud-sync.js';

export function itemKey(item) {
  return `${item.kind}:${item.market || ''}:${item.code}`;
}

const KEYS = {
  watchlist: 'watchlist_v1',
  settings: 'settings_v1',
  /** 仅本机：DeepSeek / 同步令牌等，不进云端明文 */
  device: 'device_secrets_v1',
};

/** 内存中的权威副本（云端同步后不再回写 localStorage 自选） */
let memWatchlist = null;
let memSettings = null;
let cloudUpdatedAt = 0;
let pushTimer = null;
let pushChain = Promise.resolve();
let syncStatus = { mode: 'local', message: '', updatedAt: 0 };

export function getSyncStatus() {
  return { ...syncStatus };
}

function setSyncStatus(partial) {
  syncStatus = { ...syncStatus, ...partial, at: Date.now() };
}

export const DEFAULT_INDICES = [
  { name: '上证指数', code: '000001', market: 'SH', marketNo: 1, secid: '1.000001', kind: 'stock', label: '沪' },
  { name: '深证成指', code: '399001', market: 'SZ', marketNo: 0, secid: '0.399001', kind: 'stock', label: '深' },
  { name: '创业板指', code: '399006', market: 'SZ', marketNo: 0, secid: '0.399006', kind: 'stock', label: '深' },
  { name: '沪深300', code: '000300', market: 'SH', marketNo: 1, secid: '1.000300', kind: 'stock', label: '沪' },
  { name: '恒生指数', code: 'HSI', market: 'HK', marketNo: 100, secid: '100.HSI', kind: 'stock', label: '港' },
  { name: '纳斯达克', code: 'NDX', market: 'US', marketNo: 100, secid: '100.NDX', kind: 'stock', label: '美' },
  { name: '日经225', code: 'N225', market: 'JP', marketNo: 100, secid: '100.N225', kind: 'stock', label: '日' },
  { name: '韩国KOSPI', code: 'KS11', market: 'KR', marketNo: 100, secid: '100.KS11', kind: 'stock', label: '韩' },
];

/** 可选大盘指数（仅指数/商品，不含概念板块） */
export const INDEX_PRESETS = [
  // A股宽基
  { name: '上证指数', code: '000001', market: 'SH', marketNo: 1, secid: '1.000001', kind: 'stock', label: '沪' },
  { name: '深证成指', code: '399001', market: 'SZ', marketNo: 0, secid: '0.399001', kind: 'stock', label: '深' },
  { name: '创业板指', code: '399006', market: 'SZ', marketNo: 0, secid: '0.399006', kind: 'stock', label: '深' },
  { name: '科创50', code: '000688', market: 'SH', marketNo: 1, secid: '1.000688', kind: 'stock', label: '沪' },
  { name: '沪深300', code: '000300', market: 'SH', marketNo: 1, secid: '1.000300', kind: 'stock', label: '沪' },
  { name: '上证50', code: '000016', market: 'SH', marketNo: 1, secid: '1.000016', kind: 'stock', label: '沪' },
  { name: '中证500', code: '000905', market: 'SH', marketNo: 1, secid: '1.000905', kind: 'stock', label: '沪' },
  { name: '中证1000', code: '000852', market: 'SH', marketNo: 1, secid: '1.000852', kind: 'stock', label: '沪' },
  { name: '北证50', code: '899050', market: 'BJ', marketNo: 0, secid: '0.899050', kind: 'stock', label: '京' },
  // 港股
  { name: '恒生指数', code: 'HSI', market: 'HK', marketNo: 100, secid: '100.HSI', kind: 'stock', label: '港' },
  { name: '恒生科技', code: 'HSTECH', market: 'HK', marketNo: 100, secid: '100.HSTECH', kind: 'stock', label: '港' },
  { name: '恒生中国企', code: 'HSCEI', market: 'HK', marketNo: 100, secid: '100.HSCEI', kind: 'stock', label: '港' },
  // 美股
  { name: '纳斯达克', code: 'NDX', market: 'US', marketNo: 100, secid: '100.NDX', kind: 'stock', label: '美' },
  { name: '道琼斯', code: 'DJIA', market: 'US', marketNo: 100, secid: '100.DJIA', kind: 'stock', label: '美' },
  { name: '标普500', code: 'SPX', market: 'US', marketNo: 100, secid: '100.SPX', kind: 'stock', label: '美' },
  { name: '费城半导体', code: 'SOX', market: 'US', marketNo: 100, secid: '100.SOX', kind: 'stock', label: '美' },
  // 亚太
  { name: '日经225', code: 'N225', market: 'JP', marketNo: 100, secid: '100.N225', kind: 'stock', label: '日' },
  { name: '韩国KOSPI', code: 'KS11', market: 'KR', marketNo: 100, secid: '100.KS11', kind: 'stock', label: '韩' },
  // 商品。只留一个黄金，避免和沪市黄金ETF重复
  { name: 'COMEX黄金', code: 'GC00Y', market: 'US', marketNo: 101, secid: '101.GC00Y', kind: 'stock', label: '期' },
];

export const DEFAULT_SETTINGS = {
  theme: 'light',
  viewMode: 'list',
  sortBy: 'manual',
  activeGroup: 'all',
  groups: [{ id: 'other', name: '其他' }],
  indices: DEFAULT_INDICES,
  chartAxisMode: 'full',
  funFlowNames: false,
  predictOpen: true,
  briefModalTab: 'insight',
  newsSidebarOpen: true,
  dismissedNewsIds: [],
  readNewsIds: [],
  lastNewsFetchAt: 0,
  cachedNews: [],
  eventBannerDismissDate: '',
  stopBannerDismissed: false,
  /** DeepSeek 密钥，仅本机，不随导出、不进仓库 */
  deepseekApiKey: '',
  /** deepseek-flash | deepseek-v4-pro */
  aiModel: 'deepseek-flash',
  /** itemKey -> 最新一份，列表按钮用 */
  aiReports: {},
  /** 全部历史报告，新的在前 */
  aiHistory: [],
  aiHistoryMigrated: false,
  /** 已自动写过的档，形如 2026-10-15|close|trend */
  aiAutoDone: [],
  /** 移动端分组条是否展开；默认折叠 */
  mobileGroupsExpanded: false,
  /** 刷新后回到上次的页面、股票/基金、分组 */
  lastView: 'watch',
  lastPrimary: 'stock',
  lastGroup: 'all',
  /**
   * 今日计划池（与自选分离）：今天/明天可能动手的短名单，最多 5 条
   * { id, name, code, market, theme, tag, addedAt }
   */
  planPool: [],
  /** AI 预测页最近一次结果（TA + 大盘预测K） */
  predictPack: null,
  /**
   * AI 模拟盘账本
   * { capital, cash, positions[], trades[], realizedPnl, note, updatedAt, lastRunAt }
   */
  simBook: null,
};

export const SIM_START_CASH = 100000;

export function emptySimBook() {
  return {
    capital: SIM_START_CASH,
    cash: SIM_START_CASH,
    positions: [],
    trades: [],
    realizedPnl: 0,
    note: '',
    updatedAt: Date.now(),
    lastRunAt: 0,
  };
}

async function readLocalWatchlist() {
  const data = await chrome.storage.local.get(KEYS.watchlist);
  return Array.isArray(data[KEYS.watchlist]) ? data[KEYS.watchlist] : [];
}

async function readLocalSettingsRaw() {
  const data = await chrome.storage.local.get(KEYS.settings);
  return data[KEYS.settings] || {};
}

async function readDeviceSecrets() {
  const data = await chrome.storage.local.get(KEYS.device);
  const raw = data[KEYS.device] || {};
  // 兼容旧版：密钥曾写在 settings 里
  if (!raw.deepseekApiKey || !raw.githubSyncToken) {
    const legacy = await readLocalSettingsRaw();
    return {
      deepseekApiKey: raw.deepseekApiKey || legacy.deepseekApiKey || '',
      githubSyncToken: raw.githubSyncToken || legacy.githubSyncToken || '',
    };
  }
  return {
    deepseekApiKey: raw.deepseekApiKey || '',
    githubSyncToken: raw.githubSyncToken || '',
  };
}

async function writeDeviceSecrets(partial) {
  const cur = await readDeviceSecrets();
  const next = { ...cur, ...partial };
  await chrome.storage.local.set({ [KEYS.device]: next });
  return next;
}

/** 清掉本机自选/设置持久化，避免手机和电脑各存一份对不上 */
export async function clearLocalUserData() {
  await chrome.storage.local.remove([KEYS.watchlist, KEYS.settings]);
}

export async function getWatchlist() {
  if (Array.isArray(memWatchlist)) return memWatchlist.map((x) => ({ ...x }));
  memWatchlist = await readLocalWatchlist();
  return memWatchlist.map((x) => ({ ...x }));
}

export async function setWatchlist(list) {
  memWatchlist = Array.isArray(list) ? list.map((x) => ({ ...x })) : [];
  const secrets = await readDeviceSecrets();
  if (!String(secrets.githubSyncToken || '').trim()) {
    // 尚未开通云写入时，仍落本机，避免刷新丢自选
    await chrome.storage.local.set({ [KEYS.watchlist]: memWatchlist });
  }
  scheduleCloudPush();
  return memWatchlist;
}

function isGoldIndex(x) {
  const text = `${x?.name || ''} ${x?.code || ''} ${x?.secid || ''}`;
  return /黄金|GC00Y|AU9999|AU0|518880|518800|159934/.test(text);
}

export function uniqueIndices(list) {
  const rows = list || [];
  const gold = rows.find((x) => isGoldIndex(x) && /GC00Y/.test(`${x.code}${x.secid}`)) || rows.find(isGoldIndex);
  const seen = new Set();
  const out = [];
  let goldUsed = false;
  for (const x of rows) {
    const sid = x?.secid || '';
    if (!sid) continue;
    if (isGoldIndex(x)) {
      if (goldUsed || (gold && x !== gold)) continue;
      goldUsed = true;
    }
    if (seen.has(sid)) continue;
    seen.add(sid);
    out.push(x);
  }
  return out;
}

function normalizeSettingsObject(saved = {}) {
  const indices = Array.isArray(saved.indices) ? uniqueIndices(saved.indices) : DEFAULT_INDICES;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    groups: saved.groups?.length ? saved.groups : DEFAULT_SETTINGS.groups,
    indices,
  };
}

export async function getSettings() {
  if (memSettings) {
    const secrets = await readDeviceSecrets();
    return {
      ...memSettings,
      deepseekApiKey: secrets.deepseekApiKey || '',
      githubSyncToken: secrets.githubSyncToken || '',
    };
  }
  const saved = await readLocalSettingsRaw();
  const secrets = await readDeviceSecrets();
  memSettings = normalizeSettingsObject({
    ...saved,
    deepseekApiKey: undefined,
    githubSyncToken: undefined,
  });
  return {
    ...memSettings,
    deepseekApiKey: secrets.deepseekApiKey || saved.deepseekApiKey || '',
    githubSyncToken: secrets.githubSyncToken || saved.githubSyncToken || '',
  };
}

export async function saveSettings(partial) {
  const cur = await getSettings();
  const next = { ...cur, ...partial };

  // 密钥只留本机 device 槽
  const secretPatch = {};
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'deepseekApiKey')) {
    secretPatch.deepseekApiKey = String(partial.deepseekApiKey || '');
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'githubSyncToken')) {
    secretPatch.githubSyncToken = String(partial.githubSyncToken || '');
  }
  if (Object.keys(secretPatch).length) await writeDeviceSecrets(secretPatch);

  const secrets = await readDeviceSecrets();
  memSettings = normalizeSettingsObject({
    ...next,
    deepseekApiKey: undefined,
    githubSyncToken: undefined,
  });
  if (!String(secrets.githubSyncToken || '').trim()) {
    await chrome.storage.local.set({
      [KEYS.settings]: {
        ...memSettings,
        // 旧字段不再写入密钥
        deepseekApiKey: '',
        githubSyncToken: '',
      },
    });
  }
  scheduleCloudPush();
  return {
    ...memSettings,
    deepseekApiKey: secrets.deepseekApiKey || '',
    githubSyncToken: secrets.githubSyncToken || '',
  };
}

function scheduleCloudPush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushChain = pushChain.then(() => flushCloudPush()).catch((e) => {
      console.warn('[sync] push', e);
      setSyncStatus({ mode: syncStatus.mode || 'cloud', message: String(e?.message || e) });
    });
  }, 900);
}

async function flushCloudPush() {
  const secrets = await readDeviceSecrets();
  const token = String(secrets.githubSyncToken || '').trim();
  const list = Array.isArray(memWatchlist) ? memWatchlist : await getWatchlist();
  const settings = memSettings || pickCloudSettings(await getSettings());
  if (!token) {
    setSyncStatus({
      mode: 'readonly',
      message: '已用云端数据，但本机还没同步令牌，改动不会上传',
      updatedAt: cloudUpdatedAt,
    });
    return;
  }
  const payload = {
    watchlist: list,
    settings: pickCloudSettings(settings),
    writeToken: token,
    updatedAt: Date.now(),
  };
  setSyncStatus({ mode: 'pushing', message: '正在上传云端…', updatedAt: cloudUpdatedAt });
  const updatedAt = await pushCloudBundle(payload, token);
  cloudUpdatedAt = updatedAt || Date.now();
  await clearLocalUserData();
  setSyncStatus({ mode: 'cloud', message: '已同步到云端', updatedAt: cloudUpdatedAt });
}

/**
 * 登录后调用：云端优先；云端空则把本机旧数据迁上去；成功后清掉本机自选副本。
 */
export async function hydrateFromCloud() {
  const secrets = await readDeviceSecrets();
  let token = String(secrets.githubSyncToken || '').trim();
  const localList = await readLocalWatchlist();
  const localSettings = await readLocalSettingsRaw();

  try {
    const remote = await pullCloudBundle();
    if (!remote.empty && remote.payload) {
      const p = remote.payload;
      memWatchlist = Array.isArray(p.watchlist) ? p.watchlist : [];
      memSettings = normalizeSettingsObject(p.settings || {});
      cloudUpdatedAt = Number(p.updatedAt) || Date.now();
      if (p.writeToken && !token) {
        token = String(p.writeToken).trim();
        await writeDeviceSecrets({ githubSyncToken: token });
      }
      await clearLocalUserData();
      setSyncStatus({
        mode: token ? 'cloud' : 'readonly',
        message: token ? '已从云端加载' : '已从云端加载（只读，配置同步令牌后可改）',
        updatedAt: cloudUpdatedAt,
      });
      return getSettings().then((settings) => ({
        list: memWatchlist.map((x) => ({ ...x })),
        settings,
        from: 'cloud',
      }));
    }

    // 云端空：若本机有旧数据则上传
    memWatchlist = localList;
    memSettings = normalizeSettingsObject({
      ...localSettings,
      deepseekApiKey: undefined,
      githubSyncToken: undefined,
    });
    if (token && (localList.length || Object.keys(localSettings).length)) {
      await flushCloudPush();
      setSyncStatus({ mode: 'cloud', message: '本机数据已迁到云端', updatedAt: cloudUpdatedAt });
    } else if (!token) {
      setSyncStatus({
        mode: 'need-token',
        message: '首次同步：在「分析模型」里粘贴 GitHub 同步令牌，手机和电脑就会一致',
        updatedAt: 0,
      });
    } else {
      setSyncStatus({ mode: 'cloud', message: '云端为空', updatedAt: 0 });
    }
    return getSettings().then((settings) => ({
      list: (memWatchlist || []).map((x) => ({ ...x })),
      settings,
      from: 'local-migrate',
    }));
  } catch (e) {
    console.warn('[sync] hydrate', e);
    memWatchlist = localList;
    memSettings = normalizeSettingsObject({
      ...localSettings,
      deepseekApiKey: undefined,
      githubSyncToken: undefined,
    });
    setSyncStatus({
      mode: 'offline',
      message: `云端暂不可用：${String(e?.message || e)}`,
      updatedAt: 0,
    });
    return getSettings().then((settings) => ({
      list: (memWatchlist || []).map((x) => ({ ...x })),
      settings,
      from: 'offline',
    }));
  }
}

/** 定时/切回前台时拉云端；若远端更新则覆盖内存 */
export async function refreshFromCloud({ force = false } = {}) {
  try {
    const remote = await pullCloudBundle();
    if (remote.empty || !remote.payload) return false;
    const remoteAt = Number(remote.payload.updatedAt) || 0;
    if (!force && remoteAt && cloudUpdatedAt && remoteAt <= cloudUpdatedAt) return false;
    memWatchlist = Array.isArray(remote.payload.watchlist) ? remote.payload.watchlist : [];
    memSettings = normalizeSettingsObject(remote.payload.settings || {});
    cloudUpdatedAt = remoteAt || Date.now();
    if (remote.payload.writeToken) {
      const secrets = await readDeviceSecrets();
      if (!secrets.githubSyncToken) {
        await writeDeviceSecrets({ githubSyncToken: String(remote.payload.writeToken) });
      }
    }
    await clearLocalUserData();
    setSyncStatus({
      mode: 'cloud',
      message: '已拉取云端最新',
      updatedAt: cloudUpdatedAt,
    });
    return true;
  } catch (e) {
    console.warn('[sync] refresh', e);
    return false;
  }
}

export async function addItem(item) {
  const list = await getWatchlist();
  const id = itemKey(item);
  if (list.some((x) => itemKey(x) === id)) return list;
  const next = [
    ...list,
    {
      ...item,
      groupId: item.groupId || 'other',
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

function posValue(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : undefined;
}

const IMPORT_SETTING_KEYS = [
  'theme',
  'sortBy',
  'chartAxisMode',
  'funFlowNames',
  'predictOpen',
  'lastView',
  'lastPrimary',
  'lastGroup',
  'mobileGroupsExpanded',
  'aiModel',
];

function lotsValue(item) {
  const fromLots = posValue(item?.lots);
  if (fromLots != null) return fromLots;
  // 旧备份里 markPrice 实际是手数
  return posValue(item?.lots == null ? item?.markPrice : null);
}

/** 合并导入股票/基金/分组；已有代码会补上成本和手数 */
export async function importShenqiBundle(bundle) {
  const groups = Array.isArray(bundle?.groups) ? bundle.groups : [];
  const incoming = Array.isArray(bundle?.watchlist) ? bundle.watchlist : [];
  const settings = await getSettings();

  const groupMap = new Map((settings.groups || []).map((g) => [g.id, g]));
  for (const raw of groups) {
    const g = normalizeImportedGroup(raw);
    const mergeKey = raw.id === 'default' ? 'other' : g.id;
    if (!groupMap.has(mergeKey)) groupMap.set(mergeKey, g);
    else {
      groupMap.set(mergeKey, {
        ...groupMap.get(mergeKey),
        name: g.name || groupMap.get(mergeKey).name,
      });
    }
  }
  let nextGroups = [...groupMap.values()];
  const normalized = normalizeGroups(nextGroups, []);
  nextGroups = normalized.groups;

  const list = await getWatchlist();
  const exist = new Set(list.map(itemKey));
  const merged = [...list];
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (!item || !item.code) continue;
    const key = itemKey(item);
    const gid = !item.groupId || item.groupId === 'default' ? 'other' : item.groupId;
    const cost = posValue(item.cost);
    const lots = lotsValue(item);
    if (exist.has(key)) {
      const i = merged.findIndex((x) => itemKey(x) === key);
      if (i >= 0) {
        const cur = merged[i];
        merged[i] = {
          ...cur,
          name: item.name || cur.name,
          groupId: gid || cur.groupId,
          pinned: item.pinned != null ? !!item.pinned : cur.pinned,
          cost: cost != null ? cost : cur.cost,
          lots: lots != null ? lots : cur.lots,
          markPrice: null,
        };
        updated += 1;
      }
      continue;
    }
    exist.add(key);
    const { markPrice: _drop, ...rest } = item;
    merged.push({
      ...rest,
      name: item.name || item.code,
      groupId: gid,
      pinned: !!item.pinned,
      order: merged.length,
      addedAt: item.addedAt || Date.now(),
      cost: cost ?? null,
      lots: lots ?? null,
      markPrice: null,
    });
    added += 1;
  }

  const listNorm = normalizeGroups(nextGroups, merged);
  await setWatchlist(listNorm.list);
  const nextSettings = await saveSettings({
    groups: listNorm.groups,
    importedShenqi: true,
  });
  return {
    list: listNorm.list,
    settings: { ...nextSettings, groups: listNorm.groups },
    added,
    updated,
  };
}

/** 导入完整备份：自选 + 分组 + 成本/手数 + 指数/主题等（不含密钥） */
export async function importUserBundle(bundle) {
  const result = await importShenqiBundle(bundle);
  const incomingSettings = bundle?.settings && typeof bundle.settings === 'object' ? bundle.settings : {};
  const patch = {};
  for (const k of IMPORT_SETTING_KEYS) {
    const v = incomingSettings[k] !== undefined ? incomingSettings[k] : bundle?.[k];
    if (v !== undefined && v !== '') patch[k] = v;
  }
  const idx = Array.isArray(bundle?.indices)
    ? bundle.indices
    : Array.isArray(incomingSettings.indices)
      ? incomingSettings.indices
      : null;
  if (idx?.length) patch.indices = uniqueIndices(idx);
  if (Array.isArray(incomingSettings.aiHistory) && incomingSettings.aiHistory.length) {
    const cur = result.settings.aiHistory || [];
    const seen = new Set(cur.map((r) => r?.id).filter(Boolean));
    const extra = incomingSettings.aiHistory.filter((r) => r?.id && !seen.has(r.id));
    patch.aiHistory = [...extra, ...cur].slice(0, 200);
  }
  if (incomingSettings.aiReports && typeof incomingSettings.aiReports === 'object') {
    patch.aiReports = { ...incomingSettings.aiReports, ...(result.settings.aiReports || {}) };
  }
  if (!Object.keys(patch).length) return result;
  const settings = await saveSettings(patch);
  return { ...result, settings };
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
