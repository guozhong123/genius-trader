import './lib/chrome-polyfill.js';
import './styles.css';
import {
  addItem,
  getSettings,
  getWatchlist,
  importUserBundle,
  INDEX_PRESETS,
  itemKey,
  removeItem,
  reorderWatchlist,
  saveSettings,
  setWatchlist,
  uniqueIndices,
  updateItem,
  emptySimBook,
  SIM_START_CASH,
} from './lib/storage.js';
import {
  fetchBoards,
  fetchIndices,
  fetchIntraday,
  fetchKline,
  fetchMarketMoneyFlow,
  fetchMarketNews,
  fetchMarketOverview,
  mergeMajorAlerts,
  fetchNorthbound,
  fetchQuotes,
  fetchStockMoneyFlow,
  fetchStockSnapshot,
  fetchStockFlowDays,
  fetchStockHeadlines,
  fetchStockAnnouncements,
  fetchTencentStockQuote,
  fetchIndustryMove,
  fetchDragonTiger,
  fetchDailyBillboard,
  fetchDailyBillboardOn,
  shTradeDates,
  fetchLimitSentiment,
  fetchTrackedFlows,
  fetchBoardLeaders,
  fetchSeatHighlights,
  fetchFuturesSeatMoves,
  fetchTechLeaders,
  fetchMembersQuotes,
  fetchTopMovers,
  fetchUpDownDistribution,
  marketLabel,
  searchSymbols,
  toSecid,
} from './lib/api.js';
import {
  US_PULSE_SECTORS,
  KR_PULSE_SECTORS,
  CN_PULSE_BOARDS,
  CN_PULSE_PROXIES,
  buildSectorFromMembers,
  getMarketSession,
} from './lib/market-pulse.js';
import {
  disposeChart,
  renderBoardBarChart,
  renderFlowChart,
  renderForecastKline,
  renderIntradayChart,
  renderKlineChart,
  renderNorthboundChart,
  renderPredictFlowChart,
  renderUpDownChart,
  resizeAllCharts,
} from './lib/charts.js';
import { getTodayEvents, getUpcomingEvents, getMajorUpcomingEvents, marketCalendarFacts } from './lib/calendar.js';
import { buildLevelMarkLines, calcAutoLevels } from './lib/levels.js';
import { normalizeGroups, repairStockGroups } from './lib/stock-groups.js';
import { analyzeMainForceIntent } from './lib/predict.js';
import {
  askDeepseekReport,
  askLhbPick3,
  askLhbReport,
  askMarketReport,
  askPredictPack,
  askScanBatch,
  askSeatReport,
  askSimOrders,
  buildLhbFacts,
  buildMarketFacts,
  buildPredictFacts,
  buildScanFacts,
  buildSeatFacts,
  buildSimFacts,
  buildStockFacts,
  disciplineStop,
} from './lib/deepseek.js';
import { OVERNIGHT_LINKS, buildOvernight, marketClock, moodLabel, planText, reviewCalls, scoreMainLines, shYmd, sheetBrief, tradingSlot } from './lib/trend.js';
import { isLoggedIn, login, logout, currentUser } from './lib/auth.js';

const REFRESH_MS = 15000;

const GROUP_NAME_FIX = {
  股票: '自选股',
  工业母鸡: '工业母机',
  默认: '其他',
  未分组: '其他',
};

const FUN_FLOW_NAMES = ['畜生', '庄家', '游资', '打工人', '韭菜'];
const FLOW_NAMES_NORMAL = ['主力', '超大单', '大单', '中单', '小单'];

const THEMES = [
  { id: 'light', label: '浅色', colors: ['#14b8a6', '#e2e8f0'] },
  { id: 'dark', label: '深色', colors: ['#2dd4bf', '#1e293b'] },
];


function waitFrames(n = 2) {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const state = {
  view: 'watch',
  primaryKind: 'stock',
  secondaryGroup: 'all',
  list: [],
  quotes: {},
  indices: [],
  settings: null,
  searchResults: [],
  loading: false,
  lastUpdated: null,
  detail: null,
  period: 'intraday',
  center: {},
  boards: [],
  boardType: 'industry',
  rank: { dir: 'up', rows: [], sort: 'pct' },
  dialogResolve: null,
  dialogSnapshot: null,
  dragKey: null,
  aiAdvice: null,
  aiAdviceKey: null,
  reportDrawer: { open: false, focusId: null, filter: null },
  marketAiRunning: false,
  trend: null,
  trendAt: 0,
  trendLoading: false,
  aiRunning: {},
  timersStarted: false,
  briefOpen: false,
  briefTab: 'insight',
  insightOpen: false,
  insightNews: [],
  techLeaders: [],
  eventPanelOpen: false,
  pulseBoards: { CN: [], US: [], KR: [] },
  pulseSort: { CN: 'desc', US: 'desc', KR: 'desc' },
  predictRunning: false,
  predictHistory: [],
  simRunning: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  list: $('list'),
  empty: $('empty'),
  indices: $('indices'),
  indicesBar: $('indices-bar'),
  indicesMobile: $('indices-mobile'),
  pulseBar: $('pulse-bar'),
  pulseBoardsEl: $('pulse-boards'),
  trendSheet: $('trend-sheet'),
  trendStrip: $('trend-strip'),
  strategyDesk: $('strategy-desk'),
  pulseSession: $('pulse-session'),
  pulseHint: $('pulse-hint'),
  searchInput: $('search-input'),
  searchResults: $('search-results'),
  refreshBtn: $('refresh-btn'),
  statusText: $('status-text'),
  groupTabs: $('group-tabs'),
  themePicker: $('theme-picker'),
  flowSummary: $('flow-summary'),
  boardsList: $('boards-list'),
  chartBoards: $('chart-boards'),
  rankList: $('rank-list'),
  rankSort: $('rank-sort'),
  detailRoot: $('detail-root'),
  detailMask: $('detail-mask'),
  detailPanel: $('detail-panel'),
  dialogRoot: $('dialog-root'),
  dialogMask: $('dialog-mask'),
  dialog: $('dialog'),
  dialogTitle: $('dialog-title'),
  dialogBody: $('dialog-body'),
  dialogOk: $('dialog-ok'),
  dialogCancel: $('dialog-cancel'),
  chartMain: $('chart-main'),
  chartStockFlow: $('chart-stock-flow'),
  detailFlowCards: $('detail-flow-cards'),
  fundStats: $('fund-stats'),
  stockChartWrap: $('stock-chart-wrap'),
  insightPanel: $('insight-panel'),
  insightBtn: $('insight-btn'),
  newsSidebar: $('news-sidebar'),
  newsBackdrop: $('news-backdrop'),
  newsList: $('news-list'),
  newsEmpty: $('news-empty'),
  newsCloseBtn: $('news-close-btn'),
  newsOpenBtn: $('news-open-btn'),
  newsBadge: $('news-badge'),
  eventBanner: $('event-banner'),
  eventBannerText: $('event-banner-text'),
  eventPanel: $('event-panel'),
  eventCalendarBtn: $('event-calendar-btn'),
  eventDismissBtn: $('event-dismiss-btn'),
  calendarBtn: $('calendar-btn'),
  loginRoot: $('login-root'),
  loginForm: $('login-form'),
  loginUser: $('login-user'),
  loginPass: $('login-pass'),
  loginError: $('login-error'),
  appFrame: $('app-frame'),
  logoutBtn: $('logout-btn'),
  aiAdviceBody: $('ai-advice-body'),
  aiAdviceRefresh: $('ai-advice-refresh'),
  aiAdviceHistory: $('ai-advice-history'),
  reportOpenBtn: $('report-open-btn'),
  marketAiBtn: $('market-ai-btn'),
  reportDrawer: $('report-drawer'),
  reportBackdrop: $('report-backdrop'),
  reportDrawerTitle: $('report-drawer-title'),
  reportDrawerBody: $('report-drawer-body'),
  reportBack: $('report-back'),
  reportDrawerClose: $('report-drawer-close'),
  briefOpenBtn: $('brief-open-btn'),
  briefRoot: $('brief-root'),
  briefMask: $('brief-mask'),
  briefBody: $('brief-body'),
  briefClose: $('brief-close'),
  newsDot: $('news-dot'),
  exportBtn: $('export-btn'),
  predictCard: $('predict-card'),
  predictBody: $('predict-body'),
  predictToggle: $('predict-toggle'),
  funNamesBtn: $('fun-names-btn'),
  watchSubnav: $('watch-subnav'),
  predictAiBtn: $('predict-ai-btn'),
  predictMeta: $('predict-meta'),
  predictTa: $('predict-ta'),
  predictIndexName: $('predict-index-name'),
  chartPredictK: $('chart-predict-k'),
  chartPredictFlow: $('chart-predict-flow'),
  lhbRefreshBtn: $('lhb-refresh-btn'),
  lhbAsof: $('lhb-asof'),
  lhbMeta: $('lhb-meta'),
  lhbBoard: $('lhb-board'),
  lhbFilters: $('lhb-filters'),
  lhbAiMeta: $('lhb-ai-meta'),
  lhbAiPicks: $('lhb-ai-picks'),
  lhbAiWeekTable: $('lhb-ai-week-table'),
  lhbAiGainTable: $('lhb-ai-gain-table'),
  simAiBtn: $('sim-ai-btn'),
  simMarkBtn: $('sim-mark-btn'),
  simResetBtn: $('sim-reset-btn'),
  simSummary: $('sim-summary'),
  simNote: $('sim-note'),
  simPositions: $('sim-positions'),
  simTrades: $('sim-trades'),
};

const NEWS_REFRESH_MS = 90 * 1000;
const MACRO_HINT = /非农|CPI|PCE|美联储|降息|加息/;

function quoteKey(item) {
  if (item.kind === 'fund') {
    return `fund:FUND:${String(item.code).padStart(6, '0')}`;
  }
  return `${item.kind}:${item.market}:${item.code}`;
}
function fmtPrice(n, market) {
  if (n == null || Number.isNaN(n) || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (market === 'FUND') {
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: market === 'US' || market === 'HK' || market === 'KR' ? 3 : 2,
  });
}
function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
}
function fmtYi(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}`;
}
function tone(n) {
  if (n > 0) return 'text-up';
  if (n < 0) return 'text-down';
  return '';
}
function chip(n) {
  if (n > 0) return 'background:color-mix(in oklab, var(--up) 12%, transparent);color:var(--up)';
  if (n < 0) return 'background:color-mix(in oklab, var(--down) 12%, transparent);color:var(--down)';
  return 'background:color-mix(in oklab, var(--muted) 12%, transparent);color:var(--muted)';
}
/** 行情名乱码时回退到自选里保存的名称 */
function preferDisplayName(...candidates) {
  for (const c of candidates) {
    const t = String(c || '').trim();
    if (!t) continue;
    if (/\uFFFD/.test(t)) continue;
    const hasCjk = /[\u4e00-\u9fff]/.test(t);
    if (!hasCjk && /[\u00c0-\u024f\u0400-\u04ff]/.test(t)) continue;
    return t;
  }
  return String(candidates.find((c) => String(c || '').trim()) || '').trim();
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function escAttr(s) {
  return esc(s).replaceAll("'", '&#39;');
}

function displayGroupName(name) {
  if (!name || name === '未分组' || name === '默认') return '其他';
  return GROUP_NAME_FIX[name] || name;
}

function flowLegendNames() {
  return state.settings?.funFlowNames ? FUN_FLOW_NAMES : FLOW_NAMES_NORMAL;
}

function chartAxisMode() {
  return state.settings?.chartAxisMode || 'full';
}

function sortCycleLabel(sortBy) {
  if (sortBy === 'pct') return '涨↓';
  if (sortBy === 'pctAsc') return '跌↑';
  return '不排';
}

function nextSortCycle(sortBy) {
  if (sortBy === 'manual') return 'pct';
  if (sortBy === 'pct') return 'pctAsc';
  return 'manual';
}

function syncAxisModeButtons() {
  const mode = chartAxisMode();
  document.querySelectorAll('.axis-mode-btn').forEach((btn) => {
    const on = btn.dataset.axisMode === mode;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
  document.querySelectorAll('.detail-axis-btn').forEach((btn) => {
    const on = btn.dataset.detailAxis === mode;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.add('theme-animating');
  document.documentElement.setAttribute('data-theme', next);
  renderThemeToggle();
  window.setTimeout(() => document.documentElement.classList.remove('theme-animating'), 320);
}

function renderThemeToggle() {
  const cur = state.settings?.theme || 'light';
  const btn = $('theme-toggle');
  if (!btn) return;
  const dark = cur === 'dark';
  btn.title = dark ? '切换到浅色' : '切换到深色';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = dark
    ? `<svg class="theme-toggle-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg class="theme-toggle-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z"/></svg>`;
}

/** @deprecated kept for boot compat */
function renderThemePicker() {
  renderThemeToggle();
}

function scrollPageTop() {
  window.scrollTo(0, 0);
  const root = document.scrollingElement || document.documentElement;
  if (root) root.scrollTop = 0;
  document.querySelector('.page-shell')?.scrollTo?.(0, 0);
}

const APP_VIEWS = ['watch', 'pulse', 'lhb', 'data', 'etf'];
let lhbBoardCache = null;
let lhbBoardLoading = false;
let lhbAdviceCache = null;
let lhbAdviceLoading = false;
let lhbAdviceForDate = '';
const LHB_FILTERS = ['北向', '机构', '主力', '游资'];
const lhbFilterOn = new Set(LHB_FILTERS);
const LHB_SORT_KEYS = { livePct: '今日涨跌', prevPct: '前一日涨跌', netYi: '净买亿' };
let lhbSort = { key: 'netYi', dir: 'desc' };
const SIM_FEE_RATE = 0.0005; // 万五
const SIM_FEE_MIN = 5;

/** A股休市（周末另判）。逐年补节假日，避免预测K落到放假日 */
const CN_HOLIDAYS = new Set([
  // 2025
  '2025-01-01',
  '2025-01-28',
  '2025-01-29',
  '2025-01-30',
  '2025-01-31',
  '2025-02-01',
  '2025-02-02',
  '2025-02-03',
  '2025-02-04',
  '2025-04-04',
  '2025-04-05',
  '2025-04-06',
  '2025-05-01',
  '2025-05-02',
  '2025-05-03',
  '2025-05-04',
  '2025-05-05',
  '2025-05-31',
  '2025-06-01',
  '2025-06-02',
  '2025-10-01',
  '2025-10-02',
  '2025-10-03',
  '2025-10-04',
  '2025-10-05',
  '2025-10-06',
  '2025-10-07',
  '2025-10-08',
  // 2026
  '2026-01-01',
  '2026-01-02',
  '2026-02-15',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]);

function ymdOfDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isCnTradeDay(d) {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !CN_HOLIDAYS.has(ymdOfDate(d));
}

function simFee(amount) {
  const a = Math.abs(Number(amount) || 0);
  return Math.max(SIM_FEE_MIN, +(a * SIM_FEE_RATE).toFixed(2));
}

function setView(view) {
  state.view = APP_VIEWS.includes(view) ? view : 'watch';
  scrollPageTop();
  APP_VIEWS.forEach((v) => {
    const el = $(`view-${v}`);
    if (!el) return;
    const on = v === state.view;
    el.classList.toggle('hidden', !on);
    if (on) {
      el.classList.remove('view-enter');
      // restart enter animation
      void el.offsetWidth;
      el.classList.add('view-enter');
    }
  });
  els.indicesBar?.classList.toggle('hidden', state.view !== 'watch');
  els.watchSubnav?.classList.toggle('hidden', state.view !== 'watch');
  if (state.view === 'watch') renderStrategyDesk();
  document.querySelectorAll('.view-tab').forEach((tab) => {
    const on = tab.dataset.view === state.view;
    tab.classList.toggle('bg-accent', on);
    tab.classList.toggle('text-white', on);
    tab.style.color = on ? '#fff' : 'var(--muted)';
  });
  if (state.view === 'data') {
    loadDataCenter();
    loadBoards();
    loadRank();
  }
  if (state.view === 'pulse') {
    refreshPulse();
    loadTrendSheet();
  }
  if (state.view === 'lhb') void refreshLhbBoard(false);
  if (state.view === 'etf') ensureHeatmap();
  syncMarketAiBtn();
  requestAnimationFrame(() => resizeAllCharts());
  rememberPlace();
}

function rememberPlace() {
  if (!state.settings) return;
  const lastView = APP_VIEWS.includes(state.view) ? state.view : 'watch';
  const lastPrimary = state.primaryKind === 'fund' ? 'fund' : 'stock';
  const lastGroup = state.secondaryGroup || 'all';
  if (
    state.settings.lastView === lastView &&
    state.settings.lastPrimary === lastPrimary &&
    state.settings.lastGroup === lastGroup
  ) {
    return;
  }
  saveSettings({ lastView, lastPrimary, lastGroup }).then((saved) => {
    state.settings = saved;
  });
}

function groupsForPrimary() {
  const kind = state.primaryKind;
  const counts = new Map();
  const otherKind = new Set();
  for (const item of state.list) {
    const gid = item.groupId || 'other';
    if (item.kind === kind) counts.set(gid, (counts.get(gid) || 0) + 1);
    else otherKind.add(gid);
  }
  const groups = state.settings?.groups || [];
  return groups
    .filter((g) => {
      const n = counts.get(g.id) || 0;
      if (n > 0 || g.id === 'other') return true;
      if (g.id === state.secondaryGroup) return true;
      return !otherKind.has(g.id);
    })
    .map((g) => ({
      ...g,
      count: counts.get(g.id) || 0,
      displayName: displayGroupName(g.name),
    }));
}

function isHeld(item) {
  return Number(item?.cost) > 0 || Number(item?.lots) > 0;
}

function sortedList() {
  let rows = state.list.filter((x) => x.kind === state.primaryKind);
  if (state.secondaryGroup !== 'all') {
    rows = rows.filter((x) => (x.groupId || 'other') === state.secondaryGroup);
  }
  const sortBy = state.settings?.sortBy || 'manual';
  const byBuy = state.primaryKind === 'stock' && (sortBy === 'manual' || sortBy === 'buyProb');
  const q = (item) => state.quotes[quoteKey(item)] || {};
  const compare = (a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin) return pin;
    if (byBuy) {
      const pa = Number(probSnapshot(a)?.buyProb);
      const pb = Number(probSnapshot(b)?.buyProb);
      const diff = (Number.isFinite(pb) ? pb : -1) - (Number.isFinite(pa) ? pa : -1);
      if (diff) return diff;
      return (a.order ?? 0) - (b.order ?? 0);
    }
    if (sortBy === 'pct') return (q(b).changePct || 0) - (q(a).changePct || 0);
    if (sortBy === 'pctAsc') return (q(a).changePct || 0) - (q(b).changePct || 0);
    if (sortBy === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
    if (sortBy === 'price') return (q(b).price || 0) - (q(a).price || 0);
    return (a.order ?? 0) - (b.order ?? 0);
  };
  const held = rows.filter(isHeld).sort(compare);
  const rest = rows.filter((row) => !isHeld(row)).sort(compare);
  return [...held, ...rest];
}

function renderPrimaryTabs() {
  document.querySelectorAll('.primary-tab').forEach((btn) => {
    const on = btn.dataset.primary === state.primaryKind;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
}

function activeGroupLabel(secs, active) {
  if (active === 'all') return '全部';
  return secs.find((g) => g.id === active)?.displayName || '分组';
}

function renderGroupTabs() {
  const secs = groupsForPrimary();
  const active = state.secondaryGroup;
  const expanded = state.settings?.groupsExpanded === true;

  const allBtn = `<button data-group="all" class="rounded-md px-2 py-0.5 text-[11px] font-semibold ${active === 'all' ? 'bg-accent text-white' : 'ring-soft'}" style="${active === 'all' ? '' : 'color:var(--muted)'}">全部</button>`;
  const groupBtns = secs.map(
    (g) =>
      `<button type="button" draggable="${expanded ? 'true' : 'false'}" data-group="${escAttr(g.id)}" data-group-drag="${escAttr(g.id)}" title="单击切换 · 双击改名/删除 · 拖拽排序" class="group-chip rounded-md px-2 py-0.5 text-[11px] font-semibold ${active === g.id ? 'bg-accent text-white' : 'ring-soft'}" style="${active === g.id ? '' : 'color:var(--muted)'}">${esc(g.displayName)} <span style="opacity:.7">${g.count}</span></button>`,
  );
  const addBtn = `<button type="button" id="add-group-btn" class="group-add-btn" title="新建分组">+</button>`;
  const foldLabel = expanded ? '收起分组' : `分组 · ${esc(activeGroupLabel(secs, active))}`;
  const foldBtn = `<button type="button" id="groups-fold-btn" class="groups-fold-btn" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${foldLabel}</button>`;
  if (expanded) {
    els.groupTabs.innerHTML = [foldBtn, allBtn, ...groupBtns, addBtn].join('');
  } else {
    els.groupTabs.innerHTML = [foldBtn, addBtn].join('');
  }

  $('add-group-btn')?.addEventListener('click', () => addGroupDialog());
  $('groups-fold-btn')?.addEventListener('click', async () => {
    const next = !(state.settings?.groupsExpanded === true);
    state.settings = await saveSettings({ groupsExpanded: next });
    renderGroupTabs();
  });

  els.groupTabs.querySelectorAll('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.secondaryGroup = btn.dataset.group;
      renderGroupTabs();
      renderList();
      scrollPageTop();
      rememberPlace();
    });
    btn.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      const gid = btn.dataset.group;
      if (gid === 'all') return;
      await renameGroup(gid);
    });
  });

  els.groupTabs.querySelectorAll('[data-group-drag]').forEach((chip) => {
    chip.addEventListener('dragstart', () => {
      state.dragKey = `group:${chip.getAttribute('data-group-drag')}`;
      chip.style.opacity = '0.5';
    });
    chip.addEventListener('dragend', () => {
      chip.style.opacity = '1';
      state.dragKey = null;
    });
    chip.addEventListener('dragover', (e) => e.preventDefault());
    chip.addEventListener('drop', async (e) => {
      e.preventDefault();
      const to = chip.getAttribute('data-group-drag');
      const from = String(state.dragKey || '').replace(/^group:/, '');
      if (!from || from === to) return;
      const arr = [...(state.settings.groups || [])];
      const fi = arr.findIndex((g) => g.id === from);
      const ti = arr.findIndex((g) => g.id === to);
      if (fi < 0 || ti < 0) return;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      state.settings = await saveSettings({ groups: arr });
      renderGroupTabs();
    });
  });
}

function indexCardHtml(idx) {
  const short = String(idx.name || '').replace(/指数|成指|板指|COMEX/g, '').slice(0, 5);
  const pct = idx.changePct;
  const priceTone = tone(pct);
  return `
    <div draggable="true" data-index-key="${escAttr(idx.secid)}" class="index-chip glass cursor-grab active:cursor-grabbing" title="${esc(idx.name)}">
      <div class="top">
        <span class="name">${esc(short || idx.name)}</span>
      </div>
      <div class="flex items-center justify-between gap-1">
        <span class="text-[13px] font-semibold tabular-nums leading-none ${priceTone}">${fmtPrice(idx.price, idx.market)}</span>
        <span class="rounded px-1 py-px text-[10px] font-semibold tabular-nums ${priceTone}" style="${chip(pct)}">${fmtPct(pct)}</span>
      </div>
    </div>`;
}

function bindIndexEvents(root) {
  root.querySelectorAll('[data-index-key]').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = state.indices.find((x) => x.secid === card.getAttribute('data-index-key'));
      if (idx) openDetail(idx);
    });
    card.addEventListener('dragstart', () => {
      state.dragKey = card.getAttribute('data-index-key');
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      state.dragKey = null;
    });
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const to = card.getAttribute('data-index-key');
      const from = state.dragKey;
      if (!from || from === to) return;
      const arr = [...(state.settings.indices || [])];
      const fi = arr.findIndex((x) => (x.secid || toSecid(x.market, x.code, x.marketNo)) === from);
      const ti = arr.findIndex((x) => (x.secid || toSecid(x.market, x.code, x.marketNo)) === to);
      if (fi < 0 || ti < 0) return;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      state.settings = await saveSettings({ indices: arr });
      await refreshIndices();
    });
  });
}

function renderIndices() {
  els.indices.innerHTML = state.indices.map(indexCardHtml).join('');
  if (els.indicesMobile) els.indicesMobile.innerHTML = '';
  bindIndexEvents(els.indices);
}

function reportHistory() {
  return Array.isArray(state.settings?.aiHistory) ? state.settings.aiHistory : [];
}

function aiReportOf(item) {
  const key = itemKey(item);
  const latest = state.settings?.aiReports?.[key];
  if (latest) return latest;
  return reportHistory().find((r) => r.kind !== 'market' && r.itemKey === key) || null;
}

function priorContext(match, limit = 6) {
  const cutoff = Date.now() - 5 * 86400000;
  return reportHistory()
    .filter((r) => (r.generatedAt || 0) >= cutoff && match(r))
    .sort((a, b) => (a.generatedAt || 0) - (b.generatedAt || 0))
    .slice(-limit)
    .map((r) => {
      const t = new Date(r.generatedAt).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const extra = r.kind === 'market' ? r.leaders || r.summary : r.summary;
      return `${t} ${r.action || ''} ${extra || ''}`.slice(0, 280);
    })
    .join('\n');
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function trimReportHistory(list, keepMs = WEEK_MS) {
  const cutoff = Date.now() - keepMs;
  return (list || []).filter((r) => Number(r?.generatedAt || 0) >= cutoff).slice(0, 80);
}

function pruneAiReports(map, keepMs = WEEK_MS) {
  const cutoff = Date.now() - keepMs;
  const next = {};
  for (const [key, report] of Object.entries(map || {})) {
    if (Number(report?.generatedAt || 0) >= cutoff) next[key] = report;
  }
  return next;
}

async function pushReport(entry) {
  const row = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    generatedAt: entry.generatedAt || Date.now(),
  };
  const aiHistory = trimReportHistory([row, ...reportHistory()]);
  const patch = { aiHistory, aiHistoryMigrated: true };
  if (row.kind === 'stock' && row.itemKey) {
    patch.aiReports = pruneAiReports({
      ...(state.settings?.aiReports || {}),
      [row.itemKey]: row,
    });
    // 列表概率与弹窗统一：完整报告覆盖扫描缓存
    patch.aiScan = {
      ...(state.settings?.aiScan || {}),
      [row.itemKey]: {
        action: row.action,
        buyProb: row.buyProb,
        waitProb: row.waitProb,
        avoidProb: row.avoidProb,
        generatedAt: row.generatedAt,
      },
    };
  }
  state.settings = await saveSettings(patch);
  return row;
}

/** 启动时清掉超过一周的报告，避免本地越积越多 */
async function pruneStaleReports() {
  const history = reportHistory();
  const trimmed = trimReportHistory(history);
  const reports = state.settings?.aiReports || {};
  const prunedReports = pruneAiReports(reports);
  const historyChanged = trimmed.length !== history.length;
  const reportsChanged = Object.keys(prunedReports).length !== Object.keys(reports).length;
  if (!historyChanged && !reportsChanged) return;
  state.settings = await saveSettings({
    aiHistory: trimmed,
    aiReports: prunedReports,
    aiHistoryMigrated: true,
  });
}

async function ensureReportHistory() {
  if (state.settings?.aiHistoryMigrated) {
    await pruneStaleReports();
    return;
  }
  if (reportHistory().length) {
    state.settings = await saveSettings({ aiHistoryMigrated: true });
    await pruneStaleReports();
    return;
  }
  const seeded = Object.entries(state.settings?.aiReports || {})
    .filter(([, report]) => report && typeof report === 'object' && !Array.isArray(report))
    .map(([key, report]) => ({
      ...report,
      id: report.id || `legacy-${key}`,
      kind: 'stock',
      itemKey: key,
      code: report.code || '',
      title: report.title || key,
      generatedAt: report.generatedAt || 0,
    }))
    .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
  state.settings = await saveSettings({
    aiHistory: trimReportHistory(seeded),
    aiHistoryMigrated: true,
  });
  await pruneStaleReports();
}

function parseUserPrice(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

/** 手数/份额：A股按手，基金按份，其它按股 */
function parseLots(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function shownField(item, field) {
  if (field === 'cost') {
    const stored = item.cost;
    return stored == null || stored === '' ? '' : String(stored);
  }
  // 手数：优先 lots；旧数据误把手数写在 markPrice 里也认
  const lots = item.lots != null && item.lots !== '' ? item.lots : item.markPrice;
  return lots == null || lots === '' ? '' : String(lots);
}

function sharesPerLot(item) {
  if (item?.kind === 'fund' || item?.market === 'FUND') return 1;
  if (item?.market === 'SH' || item?.market === 'SZ' || item?.market === 'BJ') return 100;
  return 1;
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function pnlParts(cost, live, lots, item) {
  if (!(cost > 0) || !(live > 0)) return null;
  const pct = ((live - cost) / cost) * 100;
  const perShare = live - cost;
  const money = lots > 0 ? perShare * lots * sharesPerLot(item) : null;
  return { pct, perShare, money };
}

function pnlHtml(cost, live, lots, item) {
  const p = pnlParts(cost, live, lots, item);
  if (!p) return '';
  const moneyText = p.money != null ? fmtMoney(p.money) : fmtMoney(p.perShare);
  return `<span class="pnl ${tone(p.pct)}"><span class="pnl-diff">${moneyText}</span><span class="pnl-pct">${fmtPct(p.pct)}</span></span>`;
}

function stopHtml(item, cost, live) {
  if (item.kind === 'fund') return '';
  const stop = disciplineStop(item, cost);
  if (!stop) return '';
  const broken = live > 0 && live <= stop.price;
  return `<span class="stop-tag ${broken ? 'text-down' : ''}" title="成本下方 ${(stop.gap * 100).toFixed(0)}%">止损 ${stop.price.toFixed(2)}${broken ? '·已破' : ''}</span>`;
}

function costLineHtml(item, livePrice) {
  const key = escAttr(itemKey(item));
  const cost = parseUserPrice(shownField(item, 'cost'));
  const lots = parseLots(shownField(item, 'lots'));
  const live = Number(livePrice);
  const costText = cost != null ? String(cost) : '—';
  const lotsText = lots != null ? String(lots) : '—';
  const stop = stopHtml(item, cost, live);
  // 桌面靠 display:contents 进多列；移动端由 .pos-board 收成紧凑两行
  return `<div class="pos-fields" data-live="${Number.isFinite(live) ? live : ''}">
    <div class="pos-meta-line">
      <div class="pos-field pos-read pos-cost"><span class="pos-label">成本</span><span class="pos-val tabular-nums">${esc(costText)}</span></div>
      <div class="pos-field pos-read pos-lots"><span class="pos-label">手数</span><span class="pos-val tabular-nums">${esc(lotsText)}</span></div>
      ${stop ? `<span class="pos-stop-inline">${stop}</span>` : ''}
    </div>
    <div class="pos-pnl">${pnlHtml(cost, live, lots, item)}<span class="pos-stop-desk">${stop}</span></div>
    <button type="button" data-edit-pos="${key}" class="pos-edit pos-edit-desk" title="修改成本与手数">改</button>
  </div>`;
}

function probSnapshot(item) {
  const key = itemKey(item);
  const report = aiReportOf(item);
  // 弹窗完整报告优先，避免列表仍显示旧的「分析全部」扫描概率
  if (report && (report.buyProb != null || report.action)) return report;
  return state.settings?.aiScan?.[key] || null;
}

function aiProbCell(item) {
  if (item.kind === 'fund') return '';
  const key = itemKey(item);
  if (state.aiRunning?.[key]) {
    return '<div class="ai-probs"><span style="color:var(--muted)">分析中</span></div>';
  }
  const report = probSnapshot(item);
  if (!report) return '<div class="ai-probs"><span style="color:var(--muted)">—</span></div>';
  const line = (name, pct, on, bad) =>
    `<span class="${on ? `on${bad ? ' down' : ''}` : ''}">${name} ${pct ?? 0}%</span>`;
  const when = formatAiTime(report.generatedAt);
  return `<div class="ai-probs" title="${when ? `分析于 ${when} · ` : ''}买入 / 继续等 / 不买（与个股弹窗同源）">
    ${line('买入', report.buyProb, report.action === '买入', false)}
    ${line('继续等', report.waitProb, report.action === '继续等', false)}
    ${line('不买', report.avoidProb, report.action === '不买', true)}
    ${when ? `<span class="ai-prob-time">${esc(when)}</span>` : ''}
  </div>`;
}

function scanBarHtml() {
  if (state.primaryKind !== 'stock') return '';
  const label = state.scanRunning
    ? `分析中 ${state.scanProgress?.done || 0}/${state.scanProgress?.total || 0}`
    : '分析全部';
  const dis = state.scanRunning ? 'disabled' : '';
  return `<div class="scan-bar">
    <button type="button" data-scan-all ${dis} class="scan-btn" title="本页唯一批量 AI：只在你点时调用">${esc(label)}</button>
    <span class="scan-hint">点股票打开详情可单独分析；刷新不会自动调用 AI</span>
  </div>`;
}

function rowHtml(item) {
  const q = state.quotes[quoteKey(item)] || {};
  const name = preferDisplayName(q.name, item.name);
  const pct = q.changePct;
  const price = q.price;
  const isFund = item.kind === 'fund';
  const gname =
    state.secondaryGroup === 'all'
      ? displayGroupName((state.settings?.groups || []).find((g) => g.id === (item.groupId || 'other'))?.name)
      : '';
  const priceLabel = isFund
    ? `${fmtPrice(price, 'FUND')}${q.source ? `<span class="ml-0.5 text-[9px] font-normal" style="color:var(--muted)">${q.source}</span>` : ''}`
    : fmtPrice(price, item.market);
  const held = isHeld(item);
  return `
    <article data-open="${escAttr(itemKey(item))}" draggable="${state.settings.sortBy === 'manual'}"
      class="list-row row-compact glass group cursor-pointer rounded-lg has-pos${isFund ? '' : ' has-ai'}${held ? ' is-held' : ''}">
      <div class="col-name-block">
        <div class="meta min-w-0 overflow-hidden">
        <div class="flex min-w-0 items-center gap-1">
            ${item.pinned ? '<span class="shrink-0 text-[9px] text-accent">顶</span>' : ''}
            ${held ? '<span class="hold-tag">持有</span>' : ''}
            <h3 class="truncate text-[13px] font-medium leading-none ${tone(pct)}">${esc(name)}</h3>
            ${gname ? `<span class="shrink-0 rounded px-1 text-[9px]" style="background:color-mix(in oklab,var(--muted) 12%,transparent);color:var(--muted)">${esc(gname)}</span>` : ''}
        </div>
          <p class="mt-0.5 truncate text-[10px] leading-none" style="color:var(--muted)">${esc(item.code)}${isFund && q.asOf ? ` · ${esc(q.asOf)}` : ''}</p>
        </div>
        <span class="pct-chip shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums" style="${chip(pct)}">${fmtPct(pct)}</span>
      </div>
      <div class="pos-board">
        <div class="col-num live-price text-[13px] font-semibold leading-none ${tone(pct)}">${priceLabel}</div>
        ${costLineHtml(item, price)}
      </div>
      ${aiProbCell(item)}
      <div class="col-actions">
        <button type="button" data-edit-pos="${escAttr(itemKey(item))}" class="row-act pos-edit-mobile" title="修改成本与手数">改</button>
        <button type="button" data-move-group="${escAttr(itemKey(item))}" class="row-act" title="改分组">组</button>
        <button type="button" data-pin="${escAttr(itemKey(item))}" class="row-act${item.pinned ? ' is-on' : ''}" title="${item.pinned ? '取消置顶' : '置顶'}">${item.pinned ? '取消' : '置顶'}</button>
        <button type="button" data-remove="${escAttr(itemKey(item))}" class="row-act danger" title="删除">删</button>
      </div>
    </article>`;
}

function listHeaderHtml() {
  const sortBy = state.settings?.sortBy || 'manual';
  const isFund = state.primaryKind === 'fund';
  return `
    <div class="list-head mb-0.5 has-pos${isFund ? '' : ' has-ai'}">
      <div class="col-name">
        <span>名称</span>
        <span class="col-sort">
          <button type="button" data-sort-cycle class="active" title="点击切换：不排 → 涨↓ → 跌↑">${sortCycleLabel(sortBy)}</button>
        </span>
      </div>
      <div class="col-num">${isFund ? '净值' : '现价'}</div>
      <div class="col-num">成本</div>
      <div class="col-num">手数</div>
      <div class="pos-pnl">浮盈</div>
      <div class="pos-edit-h"></div>
      ${isFund ? '' : '<div class="ai-probs">概率</div>'}
      <div class="col-actions text-[11px]" style="color:var(--muted)">操作</div>
    </div>`;
}

function renderList() {
  const rows = sortedList();

  if (!state.list.some((x) => x.kind === state.primaryKind)) {
    els.empty.classList.remove('hidden');
    els.empty.querySelector('[data-empty-title]').textContent =
      state.primaryKind === 'stock' ? '还没有股票' : '还没有基金';
    els.list.innerHTML = '';
    return;
  }
  if (!rows.length) {
    els.empty.classList.remove('hidden');
    els.empty.querySelector('[data-empty-title]').textContent = '该分组为空';
    els.list.innerHTML = '';
    return;
  }
  els.empty.classList.add('hidden');

  const held = rows.filter(isHeld);
  const rest = rows.filter((row) => !isHeld(row));
  const blocks = [];
  if (held.length) {
    blocks.push(`<div class="bucket-label held">持仓 ${held.length}</div>`);
    blocks.push(held.map(rowHtml).join(''));
  }
  if (rest.length) {
    if (held.length) blocks.push(`<div class="bucket-label watch">自选 ${rest.length}</div>`);
    blocks.push(rest.map(rowHtml).join(''));
  }
  els.list.innerHTML = `
    ${scanBarHtml()}
    ${listHeaderHtml()}
    <div class="grid gap-0.5">${blocks.join('')}</div>`;
  bindListEvents();
}

async function openEditPosDialog(item) {
  if (!item) return;
  const key = itemKey(item);
  const live = Number(state.quotes[quoteKey(item)]?.price);
  const cost0 = shownField(item, 'cost');
  const lots0 = shownField(item, 'lots');
  const lotsHint =
    item.kind === 'fund' || item.market === 'FUND' ? '基金填份额' : 'A股 1 手 = 100 股';
  const ok = await openDialog({
    title: `持仓 · ${item.name || item.code}`,
    bodyHtml: `<p class="mb-2 text-[12px] leading-relaxed" style="color:var(--muted)">修改成本与手数后点确定保存。</p>
      <label class="mb-1 block text-[11px]" style="color:var(--muted)">成本价</label>
      <input id="dlg-pos-cost" inputmode="decimal" value="${escAttr(cost0)}" placeholder="如 12.35" class="mb-3 w-full rounded-lg px-3 py-2 text-sm outline-none" style="background:var(--panel);border:1px solid var(--line)" />
      <label class="mb-1 block text-[11px]" style="color:var(--muted)">手数 / 份额</label>
      <input id="dlg-pos-lots" inputmode="decimal" value="${escAttr(lots0)}" placeholder="${escAttr(lotsHint)}" class="mb-2 w-full rounded-lg px-3 py-2 text-sm outline-none" style="background:var(--panel);border:1px solid var(--line)" />
      <p class="text-[11px]" style="color:var(--muted)">${esc(lotsHint)}${Number.isFinite(live) ? ` · 现价 ${live}` : ''}</p>
      <label class="mt-3 flex items-center gap-2 text-[12px]" style="color:var(--muted)">
        <input id="dlg-pos-clear" type="checkbox" /> 清空成本与手数
      </label>`,
  });
  if (!ok) return;
  const snap = state.dialogSnapshot || {};
  const clear = !!snap['dlg-pos-clear'];
  const patch = clear
    ? { cost: null, lots: null, markPrice: null }
    : {
        cost: parseUserPrice(snap['dlg-pos-cost']),
        lots: parseLots(snap['dlg-pos-lots']),
        markPrice: null,
      };
  const idx = state.list.findIndex((x) => itemKey(x) === key);
  if (idx >= 0) state.list[idx] = { ...state.list[idx], ...patch };
  state.list = await updateItem(state.list[idx] || item, patch);
  renderList();
  renderStatus();
}

function bindListEvents() {
  els.list.querySelectorAll('[data-scan-all]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      scanAllStocks();
    });
  });

  els.list.querySelector('[data-sort-cycle]')?.addEventListener('click', async () => {
    const cur = state.settings?.sortBy || 'manual';
    await setSort(nextSortCycle(cur));
  });

  els.list.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, input, .pos-edit, .pos-fields')) return;
      const item = state.list.find((x) => itemKey(x) === row.getAttribute('data-open'));
      if (item) openDetail(item);
    });
    if (row.getAttribute('draggable') === 'true') {
      row.addEventListener('dragstart', () => {
        state.dragKey = row.getAttribute('data-open');
      });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        const to = row.getAttribute('data-open');
        const from = state.dragKey;
        if (!from || from === to) return;
        const keys = sortedList().map(itemKey);
        const fi = keys.indexOf(from);
        const ti = keys.indexOf(to);
        if (fi < 0 || ti < 0) return;
        keys.splice(fi, 1);
        keys.splice(ti, 0, from);
        state.list = await reorderWatchlist(keys);
        renderList();
      });
    }
  });

  els.list.querySelectorAll('[data-pin]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = state.list.find((x) => itemKey(x) === btn.getAttribute('data-pin'));
      if (!item) return;
      state.list = await updateItem(item, { pinned: !item.pinned });
      renderList();
    });
  });

  els.list.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = state.list.find((x) => itemKey(x) === btn.getAttribute('data-remove'));
      if (!item) return;
      const kindLabel = item.kind === 'fund' ? '基金' : '股票';
      const ok = await confirmDialog(
        `删除${kindLabel}`,
        `确定删除「${item.name || item.code}」吗？删除后可从搜索重新添加。`,
      );
      if (!ok) return;
      state.list = await removeItem(item);
      renderGroupTabs();
      renderList();
      renderStatus();
    });
  });

  els.list.querySelectorAll('[data-move-group]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = state.list.find((x) => itemKey(x) === btn.getAttribute('data-move-group'));
      if (item) await moveItemGroup(item);
    });
  });

  els.list.querySelectorAll('[data-edit-pos]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = state.list.find((x) => itemKey(x) === btn.getAttribute('data-edit-pos'));
      if (item) await openEditPosDialog(item);
    });
  });
}

function renderSearchResults() {
  if (!state.searchResults.length) {
    els.searchResults.classList.add('hidden');
    els.searchResults.innerHTML = '';
    return;
  }
  els.searchResults.classList.remove('hidden');
  els.searchResults.innerHTML = state.searchResults
    .map((item, idx) => {
      const exists = state.list.some((x) => itemKey(x) === itemKey(item));
      return `<button type="button" data-add-idx="${idx}" class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${exists ? 'opacity-40' : ''}" ${exists ? 'disabled' : ''}>
        <span class="rounded px-1 text-[10px]" style="background:color-mix(in oklab,var(--muted) 12%,transparent);color:var(--muted)">${esc(item.label || marketLabel(item.market))}</span>
        <span class="min-w-0 flex-1 truncate font-medium ${tone(item.changePct)}">${esc(item.name)}</span>
        <span class="font-mono text-[11px]" style="color:var(--muted)">${esc(item.code)}</span>
        <span class="shrink-0 text-[12px] font-semibold tabular-nums ${tone(item.changePct)}">${fmtPct(item.changePct)}</span>
        <span class="text-[11px] font-semibold text-accent">${exists ? '已有' : '添加'}</span>
      </button>`;
    })
    .join('');

  els.searchResults.querySelectorAll('[data-add-idx]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-add-idx'));
      const item = state.searchResults[idx];
      if (!item || btn.disabled) return;
      const groupId =
        state.secondaryGroup !== 'all'
          ? state.secondaryGroup
          : state.primaryKind === 'fund'
            ? groupsForPrimary()[0]?.id || 'other'
            : 'other';
      try {
        state.list = await addItem({ ...item, groupId });
        if (item.kind === 'stock' || item.kind === 'fund') state.primaryKind = item.kind;
        setView('watch');
        renderPrimaryTabs();
        renderGroupTabs();
        renderList();
        refreshQuotes();
        els.statusText.textContent = `已添加 ${item.name}（${item.code}）`;
      } catch (err) {
        console.error(err);
        els.statusText.textContent = '添加失败，请重试';
      }
      state.searchResults = [];
      els.searchInput.value = '';
      renderSearchResults();
    });
  });
}

function renderStatus() {
  const time = state.lastUpdated
    ? new Date(state.lastUpdated).toLocaleTimeString('zh-CN', { hour12: false })
    : '—';
  const n = state.list.filter((x) => x.kind === state.primaryKind).length;
  els.statusText.textContent = state.loading ? '刷新中…' : `已更新 ${time} · ${state.primaryKind === 'stock' ? '股票' : '基金'} ${n}`;
}

function renderFlowSummary() {
  const s = state.center.flow?.summary;
  const zd = state.center.updown;
  const nb = state.center.northbound;
  const ov = state.center.overview;
  const up = zd?.up ?? ov?.up;
  const down = zd?.down ?? ov?.down;
  const bit = (label, value, cls, suffix = '') =>
    `<span>${label} <b class="${cls}">${value}</b>${suffix}</span>`;
  const day = state.center.flow?.date || nb?.date || '';
  els.flowSummary.innerHTML = [
    day ? `<span class="flow-date">${esc(day)}</span>` : '',
    bit('两市成交', ov?.amountYi == null ? '—' : Number(ov.amountYi).toFixed(2), '', ' 亿'),
    bit('主力', fmtYi(s?.main), tone(s?.main), ' 亿'),
    bit('超大单', fmtYi(s?.huge), tone(s?.huge), ' 亿'),
    bit('大单', fmtYi(s?.large), tone(s?.large), ' 亿'),
    bit('上涨', up ?? '—', 'text-up'),
    bit('下跌', down ?? '—', 'text-down'),
    bit('北向', fmtYi(nb?.last), tone(nb?.last), ' 亿'),
  ].join('');
  const flowTitle = $('flow-asof');
  if (flowTitle) {
    const asOf = state.center.flow?.summary?.asOf || day;
    flowTitle.textContent = asOf || '';
  }
  if (zd) {
    $('zd-summary').innerHTML = `${day ? `${esc(day)} · ` : ''}涨 <span class="text-up font-semibold">${zd.up}</span> / 跌 <span class="text-down font-semibold">${zd.down}</span>`;
  }
  if (nb) {
    $('nb-summary').innerHTML = `${nb.date ? `${esc(nb.date)} · ` : ''}净流入 <span class="font-semibold ${tone(nb.last)}">${fmtYi(nb.last)} 亿</span>`;
  }
  renderMarketTone();
}

function judgeTape(center) {
  const zd = center?.updown;
  const up = Number(zd?.up);
  const down = Number(zd?.down);
  if (!Number.isFinite(up) || !Number.isFinite(down) || up + down < 100) return null;
  const main = Number(center?.flow?.summary?.main);
  const lu = Number(zd.limitUp) || 0;
  const ld = Number(zd.limitDown) || 0;
  const detail = `涨${up} 跌${down} 涨停${lu} 跌停${ld}`;
  if (down >= up * 1.45 || (Number.isFinite(main) && main <= -80) || (ld >= 20 && ld > lu)) {
    return { label: '宜等', detail, tip: '跌家明显多，或主力、跌停偏空。少开新仓。' };
  }
  if (up >= down * 1.15 && (!Number.isFinite(main) || main >= -20) && lu >= ld) {
    return { label: '可找买点', detail, tip: '涨家占优。仍然只做主力真买、没追高的票。' };
  }
  return { label: '只做最强', detail, tip: '环境一般。没有板块共振和真买，就继续等。' };
}

function renderMarketTone() {
  const el = $('market-tone');
  if (!el) return;
  const tape = judgeTape(state.center);
  if (!tape) {
    el.classList.add('hidden');
    el.textContent = '';
    renderStrategyDesk();
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `今天${tape.label} · ${tape.detail}`;
  el.title = tape.tip;
  el.style.color = tape.label === '宜等' ? 'var(--down)' : tape.label === '可找买点' ? 'var(--up)' : 'var(--muted)';
  renderStrategyDesk();
}

function latestMarketAi() {
  return (reportHistory() || []).find((r) => r?.kind === 'market') || null;
}

function planPoolList() {
  return Array.isArray(state.settings?.planPool) ? state.settings.planPool : [];
}

function marketOfCode(code) {
  const c = String(code || '');
  if (/^(6|9)/.test(c)) return 'SH';
  if (/^(0|1|2|3)/.test(c)) return 'SZ';
  if (/^[48]/.test(c)) return 'BJ';
  return 'SH';
}

async function savePlanPool(next) {
  state.settings = await saveSettings({ planPool: next.slice(0, 5) });
  renderStrategyDesk();
}

function flashStatus(msg) {
  if (els.statusText) els.statusText.textContent = msg;
}

async function addPlanPoolItem(entry) {
  const id = entry.id || (entry.code ? `stock:${entry.market || ''}:${entry.code}` : `theme:${entry.theme || entry.name}`);
  const cur = planPoolList().filter((x) => x.id !== id);
  if (cur.length >= 5) {
    flashStatus('计划池最多 5 只，先去掉一只再加');
    return;
  }
  await savePlanPool([
    {
      id,
      name: entry.name || entry.theme || entry.code,
      code: entry.code || '',
      market: entry.market || (entry.code ? marketOfCode(entry.code) : ''),
      theme: entry.theme || '',
      tag: entry.tag || '',
      addedAt: Date.now(),
    },
    ...cur,
  ]);
  flashStatus(`已加入计划池：${entry.name || entry.theme}`);
}

async function removePlanPoolItem(id) {
  await savePlanPool(planPoolList().filter((x) => x.id !== id));
}

async function addPlanToWatch(id) {
  const row = planPoolList().find((x) => x.id === id);
  if (!row?.code) {
    flashStatus('这条只有板块名，请顶部搜索具体股票再加自选');
    return;
  }
  await addItem({
    kind: 'stock',
    code: row.code,
    market: row.market || marketOfCode(row.code),
    name: row.name,
    groupId: state.secondaryGroup !== 'all' ? state.secondaryGroup : 'other',
  });
  state.list = await getWatchlist();
  renderList();
  flashStatus(`已加入自选：${row.name}`);
}

function strategyMainCandidates() {
  const mains = state.trend?.mains || [];
  const overnight = [];
  for (const row of state.trend?.overnight || []) {
    for (const t of row.targets || []) {
      if (!t?.name) continue;
      overnight.push({
        theme: t.name,
        tag: t.tag || '观察',
        name: t.name,
        pct: t.changePct,
        from: row.from,
      });
    }
  }
  const fromMains = mains
    .filter((m) => m && (m.tag === '还在进' || m.tag === '有资金' || m.tag === '价已走弱'))
    .slice(0, 5)
    .map((m) => ({
      theme: m.name,
      tag: m.tag,
      name: m.leader || m.name,
      code: m.leaderCode || '',
      market: m.leaderCode ? marketOfCode(m.leaderCode) : '',
      pct: m.leaderPct ?? m.changePct,
      boardCode: m.code,
    }));
  const seen = new Set(fromMains.map((x) => x.theme));
  for (const o of overnight) {
    if (seen.has(o.theme) || o.tag === '不宜再追') continue;
    fromMains.push({
      theme: o.theme,
      tag: o.tag,
      name: o.theme,
      code: '',
      market: '',
      pct: o.pct,
    });
    if (fromMains.length >= 6) break;
  }
  return fromMains;
}

function renderStrategyDesk() {
  const el = els.strategyDesk;
  if (!el) return;
  if (state.view !== 'watch' || state.primaryKind === 'fund') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const tape = judgeTape(state.center);
  const ai = latestMarketAi();
  const candidates = strategyMainCandidates();
  const envColor =
    tape?.label === '宜等' ? 'var(--down)' : tape?.label === '可找买点' ? 'var(--up)' : 'var(--accent)';
  const aiAge = ai?.generatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(ai.generatedAt)
    : '';
  const candHtml = candidates.length
    ? `<div class="strategy-chips">${candidates
        .map((c) => {
          const warn = c.tag === '价已走弱' || c.tag === '不宜再追';
          const pct =
            c.pct == null || !Number.isFinite(Number(c.pct)) ? '' : `<span class="pct">${fmtPct(c.pct)}</span>`;
          return `<div class="strategy-chip${warn ? ' warn' : ''}" title="主线观察，不代表立刻买入">
            <span class="tag">${esc(c.tag)}</span>
            <span class="meta">${esc(c.theme)}${c.name && c.name !== c.theme ? ` · ${esc(c.name)}` : ''}</span>
            ${pct}
          </div>`;
        })
        .join('')}</div>`
    : `<p class="strategy-empty">${
        state.trendLoading ? '主线加载中…' : '暂无主线候选。可先点「大盘分析」或打开盘况。'
      }</p>`;

  el.innerHTML = `
    <div class="strategy-desk-head">
      <div class="strategy-desk-title">今日作战室</div>
      <div class="strategy-desk-note">价格来自东财/腾讯轮询；AI 只解读本机事实，不编造现价</div>
    </div>
    <div class="strategy-env">
      <span class="strategy-env-label" style="color:${envColor}">${esc(tape?.label || '环境待定')}</span>
      ${tape?.detail ? `<span class="strategy-env-detail">${esc(tape.detail)}</span>` : ''}
      <p class="strategy-env-tip">${esc(
        tape?.tip || '涨跌家数不足时先看指数与资金页，再决定做不做。',
      )}</p>
    </div>
    <div class="strategy-ai">
      ${
        ai
          ? `<b>${esc(ai.action || '大盘')}</b> · ${esc((ai.follow || ai.summary || '').slice(0, 120))}${
              aiAge ? ` <span style="color:var(--muted)">（${esc(aiAge)}）</span>` : ''
            }`
          : '还没有大盘结论。点顶部「大盘分析」（仅手动，刷新不会自动调用）。'
      }
    </div>
    <div>
      <p class="strategy-section-label">主线候选</p>
      ${candHtml}
    </div>
    <div class="strategy-actions">
      <button type="button" data-strategy-pulse>看盘况</button>
      <span class="strategy-ai-tip">AI 仅顶部「大盘分析」一处；刷新不会自动调用</span>
    </div>`;
}

function renderPredictCard() {
  if (!els.predictCard || !els.predictBody) return;
  const open = state.settings?.predictOpen !== false;
  els.predictBody.classList.toggle('hidden', !open);
  if (els.predictToggle) els.predictToggle.textContent = open ? '关闭' : '展开';
  if (!open) return;
  const flow = state.center?.flow;
  const s = flow?.summary;
  if (!s) {
    els.predictBody.textContent = '暂无主力资金数据';
    return;
  }
  const intent = analyzeMainForceIntent(s);
  const asOf = s.asOf || flow?.date || '';
  const fetched = Number(s.fetchedAt);
  const refreshed = Number.isFinite(fetched)
    ? new Date(fetched).toLocaleTimeString('zh-CN', { hour12: false })
    : '';
  const mainYi = Number.isFinite(Number(s.main)) ? Number(s.main).toFixed(2) : '—';
  const smallYi = Number.isFinite(Number(s.small)) ? Number(s.small).toFixed(2) : '—';
  const rMain = intent.recentMain;
  const rSmall = intent.recentSmall;
  const recentBit =
    rMain != null && rSmall != null
      ? ` · 近窗主力 ${rMain > 0 ? '+' : ''}${Number(rMain).toFixed(2)} / 小单 ${rSmall > 0 ? '+' : ''}${Number(rSmall).toFixed(2)} 亿`
      : '';
  els.predictBody.innerHTML = `
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-sm font-semibold text-accent">${esc(intent.label)}</span>
      <span class="text-[11px] tabular-nums" style="color:var(--muted)">置信 ${Math.round(intent.probability * 100)}%</span>
      ${intent.scope ? `<span class="text-[10px]" style="color:var(--muted)">${esc(intent.scope)}</span>` : ''}
      ${asOf ? `<span class="text-[10px] tabular-nums" style="color:var(--muted)">行情 ${esc(asOf)}</span>` : ''}
      ${refreshed ? `<span class="text-[10px] tabular-nums" style="color:var(--muted)">刷新 ${esc(refreshed)}</span>` : ''}
    </div>
    <p class="mt-1">${esc(intent.detail)}</p>
    <p class="mt-1 text-[11px] tabular-nums" style="color:var(--muted)">全天主力 ${esc(mainYi)} 亿 · 小单 ${esc(smallYi)} 亿${esc(recentBit)}</p>`;
}

async function loadDataCenter() {
  try {
    const settled = await Promise.allSettled([
      fetchMarketMoneyFlow(),
      fetchUpDownDistribution(),
      fetchNorthbound(),
      fetchMarketOverview(),
    ]);
    const pick = (i) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    const flow = pick(0);
    const updown = pick(1);
    const northbound = pick(2);
    const overview = pick(3);
    // 成功才覆盖对应字段，避免单接口失败时把主力意图打回「暂无」
    state.center = {
      ...(state.center || {}),
      ...(flow ? { flow } : {}),
      ...(updown ? { updown } : {}),
      ...(northbound ? { northbound } : {}),
      ...(overview ? { overview } : {}),
    };
    renderFlowSummary();
    const axisOpts = { axisMode: chartAxisMode(), legendNames: flowLegendNames() };
    if (state.center.flow) renderFlowChart($('chart-market-flow'), state.center.flow, axisOpts);
    if (state.center.updown) renderUpDownChart($('chart-updown'), state.center.updown);
    if (state.center.northbound) renderNorthboundChart($('chart-northbound'), state.center.northbound);
    renderPredictCard();
    if (state.briefOpen && state.briefTab === 'insight') renderBriefBody();
  } catch (e) {
    console.error(e);
  }
}

async function loadBoards() {
  try {
    state.boards = await fetchBoards(state.boardType);
    renderBoardBarChart(els.chartBoards, state.boards);
  } catch (e) {
    console.error(e);
  }
}

function rankRowsSorted() {
  const rows = [...state.rank.rows];
  const s = state.rank.sort;
  rows.sort((a, b) => {
    if (s === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
    if (s === 'price') return (b.price || 0) - (a.price || 0);
    return state.rank.dir === 'up'
      ? (b.changePct || 0) - (a.changePct || 0)
      : (a.changePct || 0) - (b.changePct || 0);
  });
  return rows;
}

function renderRank() {
  const rows = rankRowsSorted();
  els.rankList.innerHTML = `
    <div class="rank-head">
      <div>#</div>
      <div>名称</div>
      <div>现价</div>
      <div>涨跌</div>
    </div>
    <div class="max-h-[68vh] overflow-auto">
      ${rows
        .map(
          (r, i) => `<button data-rank-open="${i}" class="rank-row">
            <div class="text-[10px]" style="color:var(--muted)">${i + 1}</div>
            <div class="min-w-0 overflow-hidden">
              <div class="truncate font-medium leading-none ${tone(r.changePct)}">${esc(r.name)}</div>
              <div class="mt-0.5 truncate text-[9px] leading-none" style="color:var(--muted)">${esc(r.code)}</div>
            </div>
            <div class="tabular-nums">${fmtPrice(r.price, r.market)}</div>
            <div class="tabular-nums font-semibold ${tone(r.changePct)}">${fmtPct(r.changePct)}</div>
          </button>`,
        )
        .join('')}
    </div>`;
  els.rankList.querySelectorAll('[data-rank-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = rankRowsSorted()[Number(btn.getAttribute('data-rank-open'))];
      if (row) openDetail(row);
    });
  });
}

async function loadRank() {
  try {
    state.rank.rows = await fetchTopMovers(state.rank.dir, 100);
    renderRank();
  } catch (e) {
    console.error(e);
  }
}

function ensureHeatmap() {
  const frame = $('etf-frame');
  if (!frame || frame.dataset.ready === '1') return;
  frame.dataset.ready = '1';
  frame.src = 'https://52etf.site/';
}

/** 从某日起向后取 n 个交易日标签（跳过周末与节假日） */
function nextTradeDates(fromYmd, n = 5) {
  const out = [];
  let raw = String(fromYmd || '').trim();
  if (/^\d{2}-\d{2}$/.test(raw)) {
    const y = new Date().getFullYear();
    raw = `${y}-${raw}`;
  }
  const d = new Date(`${raw}T12:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return out;
  let guard = 0;
  while (out.length < n && guard < 40) {
    guard += 1;
    d.setDate(d.getDate() + 1);
    if (!isCnTradeDay(d)) continue;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push(`${mm}-${dd}`);
  }
  return out;
}

async function loadPredictFlow() {
  const el = $('chart-predict-flow');
  if (!el) return;
  try {
    // 每次进预测页都拉最新实盘，避免沿用资金页旧缓存
    const flow = (await fetchMarketMoneyFlow()) || state.center?.flow || null;
    if (flow) {
      state.center = { ...(state.center || {}), flow };
      renderPredictCard();
    }
    const pack = state.settings?.predictPack;
    const forecast = pack?.forecastFlow || [];
    const lastClock = flow?.times?.length ? flow.times[flow.times.length - 1] : '';
    const marketDone = lastClock >= '15:00';
    const asof = $('predict-flow-asof');
    if (asof) {
      if (marketDone) {
        asof.textContent = flow?.date
          ? `实盘 ${flow.date} ${lastClock} · 已收盘，AI 续段待下一交易时段`
          : '已收盘';
      } else if (forecast.length) {
        asof.textContent = `${flow?.date ? `实盘 ${flow.date} · ` : ''}含 AI 推演 ${formatAiTime(pack.generatedAt) || ''}`;
      } else if (flow?.date) {
        asof.textContent = `实盘 ${flow.date} · 点「AI 预测」生成后续推演`;
      } else {
        asof.textContent = '点「AI 预测」生成主力资金推演';
      }
    }
    if (flow?.times?.length || forecast.length) {
      renderPredictFlowChart(el, { times: flow?.times || [], main: flow?.main || [] }, forecast);
    } else {
      el.innerHTML =
        '<div class="flex h-full items-center justify-center text-[12px]" style="color:var(--muted)">暂无主力资金。点「AI 预测」可生成推演折线。</div>';
    }
  } catch (e) {
    console.error(e);
    el.innerHTML =
      '<div class="flex h-full items-center justify-center text-[12px]" style="color:var(--muted)">主力资金加载失败</div>';
  }
}

function materializeForecastBars(lastClose, bars, dates) {
  let prev = Number(lastClose);
  if (!(prev > 0)) return [];
  return (bars || []).slice(0, dates.length).map((bar, i) => {
    const open = +(prev * (1 + Number(bar.pctOpen) / 100)).toFixed(2);
    let high = +(prev * (1 + Number(bar.pctHigh) / 100)).toFixed(2);
    let low = +(prev * (1 + Number(bar.pctLow) / 100)).toFixed(2);
    const close = +(prev * (1 + Number(bar.pctClose) / 100)).toFixed(2);
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);
    prev = close;
    return { date: dates[i], open, high, low, close, note: bar.note || '', forecast: true };
  });
}

function fmtYiBoard(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function lhbRowToItem(row) {
  if (!row?.code) return null;
  const item = toQuoteItem(row);
  const livePct = Number(row.liveChangePct);
  const livePrice = Number(row.livePrice);
  return {
    ...item,
    price: Number.isFinite(livePrice)
      ? livePrice
      : Number.isFinite(Number(row.close))
        ? Number(row.close)
        : item.price,
    changePct: Number.isFinite(livePct)
      ? livePct
      : Number.isFinite(Number(row.changePct))
        ? Number(row.changePct)
        : item.changePct,
    label: marketLabel(item.market),
  };
}

function rowMatchesLhbFilter(row) {
  if (lhbFilterOn.size === LHB_FILTERS.length) return true;
  if (!lhbFilterOn.size) return false;
  return (row.buyerTags || []).some((t) => lhbFilterOn.has(t));
}

function visibleLhbRows() {
  return (lhbBoardCache?.rows || []).filter(rowMatchesLhbFilter);
}

function lhbSortValue(row, key) {
  if (key === 'livePct') return Number(row.liveChangePct);
  if (key === 'prevPct') return Number(row.prevChangePct);
  if (key === 'netYi') return Number(row.netYi);
  return NaN;
}

function sortedLhbRows(rows) {
  const dir = lhbSort.dir === 'asc' ? 1 : -1;
  const key = lhbSort.key;
  return [...(rows || [])].sort((a, b) => {
    const av = lhbSortValue(a, key);
    const bv = lhbSortValue(b, key);
    const aOk = Number.isFinite(av);
    const bOk = Number.isFinite(bv);
    if (!aOk && !bOk) return String(a.code || '').localeCompare(String(b.code || ''));
    if (!aOk) return 1;
    if (!bOk) return -1;
    if (av !== bv) return (av - bv) * dir;
    const netDiff = (Number(b.netYi) || 0) - (Number(a.netYi) || 0);
    if (netDiff) return netDiff;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

function setLhbSort(key) {
  if (!LHB_SORT_KEYS[key]) return;
  if (lhbSort.key === key) {
    lhbSort = { key, dir: lhbSort.dir === 'desc' ? 'asc' : 'desc' };
  } else {
    lhbSort = { key, dir: 'desc' };
  }
  if (!lhbBoardCache) return;
  renderLhbBoard(lhbBoardCache);
  if (els.lhbMeta) els.lhbMeta.textContent = lhbMetaText(lhbBoardCache, true);
}

function lhbSortTh(key, labelOverride) {
  const label = labelOverride || LHB_SORT_KEYS[key] || key;
  const active = lhbSort.key === key;
  const mark = active ? (lhbSort.dir === 'asc' ? '↑' : '↓') : '';
  const aria = active ? ` aria-sort="${lhbSort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
  const title =
    key === 'prevPct' ? '上一个交易日的涨跌，不是上榜当天' : `点击按${label}排序`;
  return `<th class="lhb-th-sort${active ? ' is-active' : ''}"${aria}>
      <button type="button" class="lhb-sort-btn" data-lhb-sort="${escAttr(key)}" title="${escAttr(title)}">
        ${esc(label)}${mark ? `<span class="lhb-sort-mark">${mark}</span>` : ''}
      </button>
    </th>`;
}

function syncLhbFilterButtons() {
  els.lhbFilters?.querySelectorAll('[data-lhb-filter]').forEach((btn) => {
    const on = lhbFilterOn.has(btn.getAttribute('data-lhb-filter'));
    btn.classList.toggle('on', on);
  });
}

async function applyLhbLiveQuotes(pack) {
  const rows = pack?.rows || [];
  if (!rows.length) return pack;
  const items = rows.map((r) => toQuoteItem(r)).filter((x) => x?.code);
  const map = {};
  for (let i = 0; i < items.length; i += 40) {
    try {
      Object.assign(map, await fetchQuotes(items.slice(i, i + 40)));
    } catch {
      /* keep listed prices */
    }
  }
  state.quotes = { ...state.quotes, ...map };
  for (const row of rows) {
    const item = toQuoteItem(row);
    const q = map[quoteKey(item)] || {};
    if (Number.isFinite(Number(q.price))) row.livePrice = Number(q.price);
    if (Number.isFinite(Number(q.changePct))) row.liveChangePct = Number(q.changePct);
    if (q.name) row.name = q.name;
  }
  return pack;
}

function lhbBuyerHtml(row) {
  const tags = row.buyerTags?.length ? row.buyerTags : [];
  const chips = tags
    .map((t) => `<span class="lhb-tag lhb-tag-${escAttr(t)}">${esc(t)}</span>`)
    .join('');
  const seats = (row.buyers || [])
    .slice(0, 3)
    .map((b) => `${b.short || b.seat} ${fmtYiBoard(b.netYi)}亿`)
    .join(' · ');
  const fallback = row.seats || '';
  const detail = seats || fallback || '席位未披露';
  return `<div class="lhb-buyers">${chips || '<span class="lhb-tag lhb-tag-营业部">营业部</span>'}<div class="lhb-buyer-seats" title="${escAttr(detail)}">${esc(detail)}</div></div>`;
}

function renderLhbBoard(pack) {
  if (!els.lhbBoard) return;
  const all = pack?.rows || [];
  const rows = all.filter(rowMatchesLhbFilter);
  if (!all.length) {
    els.lhbBoard.innerHTML =
      '<p class="text-[12px]" style="color:var(--muted)">暂无龙虎榜数据。收盘后通常会晚些披露，可稍后点「刷新榜单」。</p>';
    return;
  }
  if (!rows.length) {
    els.lhbBoard.innerHTML =
      '<p class="text-[12px]" style="color:var(--muted)">当前筛选下没有股票。点一下筛选项，默认全开即可看全部。</p>';
    return;
  }
  const sorted = sortedLhbRows(rows);
  const today = marketClock().today;
  const prevDay = sorted.map((row) => row.prevDate).find((day) => day && day < today);
  const liveLabel = today ? `今日 ${today.slice(5)}` : '今日涨跌';
  const prevLabel = prevDay ? `前一日 ${prevDay.slice(5)}` : '前一日涨跌';
  els.lhbBoard.innerHTML = `<table class="lhb-table">
    <thead>
      <tr>
        <th>代码</th><th>名称</th>
        ${lhbSortTh('livePct', liveLabel)}${lhbSortTh('prevPct', prevLabel)}
        <th>上榜收盘</th>
        ${lhbSortTh('netYi')}
        <th>谁在买</th><th>上榜原因</th>
      </tr>
    </thead>
    <tbody>
      ${sorted
        .map((r) => {
          const livePct = Number(r.liveChangePct);
          const prevDate = String(r.prevDate || '');
          const prevPct = prevDate && prevDate < today ? Number(r.prevChangePct) : NaN;
          const price = Number(r.close);
          return `<tr class="lhb-row" data-lhb-open="${escAttr(r.code)}" title="查看 ${escAttr(r.name || r.code)} 详情" role="button" tabindex="0">
            <td class="tabular-nums">${esc(r.code)}</td>
            <td class="lhb-name">${esc(r.name)}</td>
            <td class="tabular-nums ${tone(livePct)}" title="${escAttr(today)} 涨跌">${fmtPct(Number.isFinite(livePct) ? livePct : null)}</td>
            <td class="tabular-nums ${tone(prevPct)}" title="${escAttr(prevDate || '前一日')} 涨跌">${fmtPct(Number.isFinite(prevPct) ? prevPct : null)}</td>
            <td class="tabular-nums">${Number.isFinite(price) ? price.toFixed(2) : '—'}</td>
            <td class="tabular-nums ${tone(r.netYi)}">${fmtYiBoard(r.netYi)}</td>
            <td>${lhbBuyerHtml(r)}</td>
            <td class="lhb-reason" title="${escAttr(r.reason || r.seats || '')}">${esc(r.reason || r.seats || '—')}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  </table>`;
}

function scoreLhbPick(row) {
  const net = Number(row.netYi) || 0;
  const pct = Number(row.changePct) || 0;
  const tags = row.buyerTags || [];
  const code = String(row.code || '');
  let score = net;
  if (tags.includes('北向')) score += 3.2;
  if (tags.includes('机构')) score += 2.2;
  if (tags.includes('游资')) score += 0.4;
  if (net <= 0) score -= 10;
  const band = /^(300|301|688|689)/.test(code) ? 19.5 : /^[48]/.test(code) ? 29.5 : 9.5;
  if (pct >= band - 0.15 && !tags.includes('北向') && !tags.includes('机构')) score -= 3.5;
  return score;
}

function heuristicLhbReason(row) {
  const tags = row.buyerTags || [];
  const top = row.buyers?.[0];
  if (tags.includes('北向') && tags.includes('机构')) return '北向+机构同时净买，资金比纯游资干净。';
  if (tags.includes('北向')) return `北向席位在买${top ? `（${top.short} ${fmtYiBoard(top.netYi)}亿）` : ''}。`;
  if (tags.includes('机构')) return `有机构席位净买${top ? `，${top.short} ${fmtYiBoard(top.netYi)}亿` : ''}。`;
  if (tags.includes('游资')) return `游资净买靠前，短线可看一眼，注意一日游。`;
  return `榜上净买入 ${fmtYiBoard(row.netYi)} 亿，席位以营业部为主。`;
}

function pickLhbThree(rows) {
  return [...(rows || [])]
    .filter((r) => Number(r.netYi) > 0)
    .sort((a, b) => scoreLhbPick(b) - scoreLhbPick(a))
    .slice(0, 3)
    .map((r) => ({
      code: r.code,
      name: r.name,
      reason: heuristicLhbReason(r),
      buyerTags: r.buyerTags || [],
      netYi: r.netYi,
      changePct: Number.isFinite(Number(r.liveChangePct)) ? Number(r.liveChangePct) : r.changePct,
    }));
}

function livePctOf(code, fallback) {
  const row = (lhbBoardCache?.rows || []).find((r) => r.code === String(code));
  const live = Number(row?.liveChangePct);
  if (Number.isFinite(live)) return live;
  const n = Number(fallback);
  return Number.isFinite(n) ? n : null;
}

function renderLhbAdvice(pack) {
  if (!els.lhbAiPicks) return;
  const picks = (pack?.picks || []).map((p) => ({
    ...p,
    changePct: livePctOf(p.code, p.changePct),
  }));
  if (!picks.length) {
    els.lhbAiPicks.innerHTML =
      '<p class="text-[12px]" style="color:var(--muted)">暂无建议。等榜单出来后再看。</p>';
    return;
  }
  els.lhbAiPicks.innerHTML = picks
    .map((p, i) => {
      const tags = (p.buyerTags || [])
        .map((t) => `<span class="lhb-tag lhb-tag-${escAttr(t)}">${esc(t)}</span>`)
        .join('');
      return `<button type="button" class="lhb-ai-pick" data-lhb-pick="${i}">
        <div class="lhb-ai-pick-top">
          <span class="lhb-ai-rank">${i + 1}</span>
          <span class="lhb-ai-name">${esc(p.name)}</span>
          <span class="tabular-nums" style="color:var(--muted)">${esc(p.code)}</span>
          <span class="tabular-nums ${tone(p.changePct)}">${fmtPct(p.changePct)}</span>
        </div>
        <div class="lhb-ai-pick-tags">${tags}</div>
        <p class="lhb-ai-reason">${esc(p.reason)}</p>
      </button>`;
    })
    .join('');
}

const LHB_HISTORY_DAYS = 10; // 近两周约 10 个交易日
const LHB_GAIN_DAYS = 7;
let lhbHistoryTask = null;
let lhbGainTask = null;
let lhbGainCache = { key: '', days: [], byCode: {} };

function slimLhbPicks(picks) {
  return (picks || []).slice(0, 3).map((p) => ({
    code: String(p.code || '').replace(/\D/g, '').slice(-6),
    name: String(p.name || '').trim(),
    reason: String(p.reason || '').slice(0, 80),
    buyerTags: Array.isArray(p.buyerTags) ? p.buyerTags.slice(0, 4) : [],
    changePct: Number.isFinite(Number(p.changePct)) ? Number(p.changePct) : null,
  }));
}

function lhbAiHistoryList() {
  return Array.isArray(state.settings?.lhbAiHistory) ? state.settings.lhbAiHistory : [];
}

async function rememberLhbAdviceDay(date, pack) {
  const day = String(date || '').slice(0, 10);
  const picks = slimLhbPicks(pack?.picks);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || picks.length < 1) return;
  const cur = lhbAiHistoryList().filter((row) => row?.date !== day);
  const next = [
    {
      date: day,
      picks,
      source: pack?.source || 'local',
      note: String(pack?.note || '').slice(0, 160),
      generatedAt: pack?.generatedAt || Date.now(),
    },
    ...cur,
  ]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20);
  const same =
    next.length === lhbAiHistoryList().length &&
    next.every((row, i) => {
      const old = lhbAiHistoryList()[i];
      return (
        old?.date === row.date &&
        JSON.stringify(old?.picks?.map((p) => p.code)) === JSON.stringify(row.picks.map((p) => p.code)) &&
        old?.source === row.source
      );
    });
  if (same) return;
  state.settings = await saveSettings({ lhbAiHistory: next });
}

function renderLhbWeekTable(rows) {
  if (!els.lhbAiWeekTable) return;
  const list = (rows || [])
    .filter((r) => r?.date && r?.picks?.length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, LHB_HISTORY_DAYS);
  if (!list.length) {
    els.lhbAiWeekTable.innerHTML =
      '<p class="px-2 py-2 text-[11px]" style="color:var(--muted)">正在补近两周建议…</p>';
    return;
  }
  els.lhbAiWeekTable.innerHTML = `<table class="lhb-ai-hist">
    <thead><tr><th>日期</th><th>第1只</th><th>第2只</th><th>第3只</th></tr></thead>
    <tbody>
      ${list
        .map((row) => {
          const cells = [0, 1, 2]
            .map((i) => {
              const p = row.picks[i];
              if (!p?.code) return '<td style="color:var(--muted)">—</td>';
              return `<td><button type="button" class="lhb-ai-cell" data-lhb-hist-code="${escAttr(p.code)}">
                <span class="lhb-ai-cell-name">${esc(p.name || p.code)}</span>
                <span class="lhb-ai-cell-code">${esc(p.code)}</span>
              </button></td>`;
            })
            .join('');
          const short = `${String(row.date).slice(5)}${lhbWeekday(row.date) ? ` ${lhbWeekday(row.date)}` : ''}`;
          return `<tr><td class="lhb-ai-date">${esc(short)}</td>${cells}</tr>`;
        })
        .join('')}
    </tbody>
  </table>`;
}

function renderLhbGainTable(days, stocks, byCode) {
  if (!els.lhbAiGainTable) return;
  const dates = (days || []).slice(0, LHB_GAIN_DAYS);
  const rows = stocks || [];
  if (!dates.length || !rows.length) {
    els.lhbAiGainTable.innerHTML =
      '<p class="px-2 py-2 text-[11px]" style="color:var(--muted)">等上面选出股票后再拉近 7 日涨幅。</p>';
    return;
  }
  els.lhbAiGainTable.innerHTML = `<table class="lhb-ai-hist">
    <thead><tr><th>股票</th>${dates
      .map((d) => `<th class="tabular-nums">${esc(String(d).slice(5))}</th>`)
      .join('')}</tr></thead>
    <tbody>
      ${rows
        .map((s) => {
          const series = byCode?.[s.code] || {};
          const cells = dates
            .map((d) => {
              const pct = series[d];
              return `<td class="lhb-ai-pct ${tone(pct)}">${esc(fmtPct(pct))}</td>`;
            })
            .join('');
          return `<tr>
            <td><button type="button" class="lhb-ai-cell" data-lhb-hist-code="${escAttr(s.code)}">
              <span class="lhb-ai-cell-name">${esc(s.name || s.code)}</span>
              <span class="lhb-ai-cell-code">${esc(s.code)}</span>
            </button></td>${cells}
          </tr>`;
        })
        .join('')}
    </tbody>
  </table>`;
}

function stocksFromLhbHistory(history) {
  const seen = new Set();
  const out = [];
  for (const day of history || []) {
    for (const p of day.picks || []) {
      const code = String(p.code || '').replace(/\D/g, '').slice(-6);
      if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, name: p.name || code });
      if (out.length >= 9) return out;
    }
  }
  return out;
}

async function loadLhbGainTable(history) {
  const stocks = stocksFromLhbHistory(history);
  if (!els.lhbAiGainTable || !stocks.length) {
    renderLhbGainTable([], [], {});
    return;
  }
  const key = stocks.map((s) => s.code).join(',');
  if (lhbGainCache.key === key && lhbGainCache.days?.length) {
    renderLhbGainTable(lhbGainCache.days, stocks, lhbGainCache.byCode);
    return;
  }
  if (lhbGainTask) return lhbGainTask;
  els.lhbAiGainTable.innerHTML =
    '<p class="px-2 py-2 text-[11px]" style="color:var(--muted)">正在拉近 7 日涨幅…</p>';
  lhbGainTask = (async () => {
    const byCode = {};
    const daySet = new Set();
    await Promise.all(
      stocks.map(async (s) => {
        const market = marketOfCode(s.code);
        const secid = toSecid(market, s.code);
        const k = await fetchKline(secid, 101, 12).catch(() => null);
        const points = (k?.points || []).filter((p) => p?.date && Number.isFinite(Number(p.changePct)));
        const last = points.slice(-LHB_GAIN_DAYS).reverse();
        const map = {};
        for (const p of last) {
          const d = String(p.date).slice(0, 10);
          map[d] = Number(p.changePct);
          daySet.add(d);
        }
        byCode[s.code] = map;
      }),
    );
    const days = [...daySet].sort((a, b) => b.localeCompare(a)).slice(0, LHB_GAIN_DAYS);
    lhbGainCache = { key, days, byCode };
    renderLhbGainTable(days, stocks, byCode);
  })()
    .catch((e) => {
      console.warn('lhb gain table', e);
      if (els.lhbAiGainTable) {
        els.lhbAiGainTable.innerHTML =
          '<p class="px-2 py-2 text-[11px]" style="color:var(--muted)">近 7 日涨幅暂时拉不到。</p>';
      }
    })
    .finally(() => {
      lhbGainTask = null;
    });
  return lhbGainTask;
}

function paintLhbHistoryFromSettings() {
  const want = shTradeDates(LHB_HISTORY_DAYS);
  const history = lhbAiHistoryList()
    .filter((r) => want.includes(r.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderLhbWeekTable(history);
  void loadLhbGainTable(history);
  return history;
}

async function ensureLhbAiHistoryTables(preferDate) {
  if (!els.lhbAiWeekTable) return;
  paintLhbHistoryFromSettings();
  if (lhbHistoryTask) return lhbHistoryTask;
  lhbHistoryTask = (async () => {
    const want = shTradeDates(LHB_HISTORY_DAYS);
    const have = new Set(lhbAiHistoryList().map((r) => r.date));
    const missing = want.filter((day) => !have.has(day));
    // 缺的交易日用当天榜单启发式补三只，不批量打 AI；并行拉几天加快首屏
    const chunk = 3;
    for (let i = 0; i < missing.length; i += chunk) {
      const batch = missing.slice(i, i + chunk);
      await Promise.all(
        batch.map(async (day) => {
          if (preferDate === day && lhbAdviceCache?.picks?.length) {
            await rememberLhbAdviceDay(day, lhbAdviceCache);
            return;
          }
          const pack = await fetchDailyBillboardOn(day, 40).catch(() => null);
          if (!pack?.rows?.length) return;
          const picks = pickLhbThree(pack.rows);
          if (!picks.length) return;
          await rememberLhbAdviceDay(day, { picks, source: 'local', note: '', generatedAt: Date.now() });
        }),
      );
      paintLhbHistoryFromSettings();
    }
    paintLhbHistoryFromSettings();
  })()
    .catch((e) => console.warn('lhb history tables', e))
    .finally(() => {
      lhbHistoryTask = null;
    });
  return lhbHistoryTask;
}

async function refreshLhbAdvice(pack, force = false) {
  if (!els.lhbAiPicks) return;
  const date = pack?.date || '';
  const heuristic = { picks: pickLhbThree(pack?.rows || []), note: '', source: 'local', generatedAt: Date.now() };
  if (!force && lhbAdviceCache?.picks?.length && lhbAdviceForDate === date) {
    renderLhbAdvice(lhbAdviceCache);
    if (els.lhbAiMeta) {
      els.lhbAiMeta.textContent = lhbAdviceCache.source && lhbAdviceCache.source !== 'local'
        ? `建议买这三只 · ${date} · ${lhbAdviceCache.source}`
        : `建议买这三只 · ${date}`;
    }
    void rememberLhbAdviceDay(date, lhbAdviceCache).then(() => {
      paintLhbHistoryFromSettings();
      void ensureLhbAiHistoryTables(date);
    });
    return;
  }
  lhbAdviceCache = heuristic;
  lhbAdviceForDate = date;
  renderLhbAdvice(heuristic);
  if (els.lhbAiMeta) els.lhbAiMeta.textContent = date ? `建议买这三只 · ${date}` : '建议买这三只';
  void rememberLhbAdviceDay(date, heuristic).then(() => {
    paintLhbHistoryFromSettings();
    void ensureLhbAiHistoryTables(date);
  });
  const apiKey = String(state.settings?.deepseekApiKey || '').trim();
  if (!apiKey || lhbAdviceLoading || !pack?.rows?.length) return;
  lhbAdviceLoading = true;
  if (els.lhbAiMeta) els.lhbAiMeta.textContent = `正在用 AI 从 ${pack.rows.length} 只里挑三只…`;
  try {
    const clock = marketClock();
    const ai = await askLhbPick3(
      apiKey,
      { date, rows: pack.rows.slice(0, 40), clock: clock.line },
      state.settings?.aiModel,
    );
    if (ai.picks?.length === 3) {
      lhbAdviceCache = ai;
      lhbAdviceForDate = date;
      renderLhbAdvice(ai);
      if (els.lhbAiMeta) {
        els.lhbAiMeta.textContent = `${ai.note || '建议买这三只'} · ${date}`;
      }
      void rememberLhbAdviceDay(date, ai).then(() => {
        paintLhbHistoryFromSettings();
        void ensureLhbAiHistoryTables(date);
      });
    } else if (els.lhbAiMeta) {
      els.lhbAiMeta.textContent = `建议买这三只 · ${date}`;
    }
  } catch (e) {
    console.warn('lhb ai pick', e);
    if (els.lhbAiMeta) els.lhbAiMeta.textContent = `建议买这三只 · ${date}（AI 未连上，先按席位排序）`;
  } finally {
    lhbAdviceLoading = false;
  }
}

function openLhbDetail(code) {
  const row = lhbBoardCache?.rows?.find((r) => r.code === String(code));
  const item = lhbRowToItem(row);
  if (!item) return;
  void openDetail(item);
}

function lhbWeekday(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

function lhbClockHm(ts = Date.now()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ts);
}

function lhbDateLabel(ymd) {
  if (!ymd) return '';
  const wd = lhbWeekday(ymd);
  return wd ? `${ymd}（${wd}）` : ymd;
}

function lhbAsofText(pack) {
  if (!pack?.date) return '还没确认这份榜是哪一天的';
  const today = marketClock().today;
  const when = lhbDateLabel(pack.date);
  if (pack.date === today) return `${when} · 今日收盘后披露`;
  return `${when} · 最近已披露的榜（非今日）`;
}

function syncLhbAsof(pack, { loading = false } = {}) {
  if (!els.lhbAsof) return;
  if (loading && pack?.date) {
    els.lhbAsof.textContent = `刷新中 · 上次是 ${lhbDateLabel(pack.date)}`;
    return;
  }
  if (loading) {
    els.lhbAsof.textContent = '正在确认这份榜是哪一天的…';
    return;
  }
  els.lhbAsof.textContent = lhbAsofText(pack);
}

function lhbMetaText(pack, live = false) {
  if (!pack?.date) return '暂未取到龙虎榜，请稍后再试';
  const shown = (pack.rows || []).filter(rowMatchesLhbFilter).length;
  const total = pack.rows?.length || 0;
  const filterNote = shown === total ? '' : `，筛选后 ${shown} 只`;
  const sortLabel = LHB_SORT_KEYS[lhbSort.key] || '净买亿';
  const sortDir = lhbSort.dir === 'asc' ? '升序' : '降序';
  const fetchedAt = Number(pack.fetchedAt);
  const refreshNote = Number.isFinite(fetchedAt)
    ? `刷新于 ${lhbClockHm(fetchedAt)}`
    : live
      ? `刷新于 ${lhbClockHm()}`
      : '';
  const liveNote = live ? ' · 今日涨跌已更新' : '';
  const today = marketClock().today;
  const prevDay = (pack.rows || []).map((row) => row.prevDate).find((day) => day && day < today);
  const dayNote = prevDay ? ` · 前一日涨跌是 ${prevDay}，不是上榜当天` : '';
  return `当前龙虎榜是${lhbDateLabel(pack.date)}的 · ${refreshNote} · 按${sortLabel}${sortDir} · 共 ${total} 只${filterNote}${liveNote}${dayNote}`;
}

async function refreshLhbBoard(force = false) {
  if (lhbBoardLoading) return;
  if (!force && lhbBoardCache?.rows?.length) {
    await applyLhbLiveQuotes(lhbBoardCache);
    renderLhbBoard(lhbBoardCache);
    if (els.lhbMeta) els.lhbMeta.textContent = lhbMetaText(lhbBoardCache, true);
    syncLhbAsof(lhbBoardCache);
    void refreshLhbAdvice({ ...lhbBoardCache, rows: visibleLhbRows() }, false);
    return;
  }
  lhbBoardLoading = true;
  if (els.lhbRefreshBtn) {
    els.lhbRefreshBtn.disabled = true;
    els.lhbRefreshBtn.textContent = '刷新中…';
  }
  syncLhbAsof(lhbBoardCache, { loading: true });
  if (els.lhbMeta) {
    els.lhbMeta.textContent = lhbBoardCache?.date
      ? `正在刷新龙虎榜… 上次是 ${lhbDateLabel(lhbBoardCache.date)} 的`
      : '正在拉取最近已披露的龙虎榜，确认是哪一天的名单…';
  }
  try {
    const pack = await fetchDailyBillboard(80);
    pack.fetchedAt = Date.now();
    await applyLhbLiveQuotes(pack);
    lhbBoardCache = pack;
    renderLhbBoard(pack);
    if (els.lhbMeta) els.lhbMeta.textContent = lhbMetaText(pack, true);
    syncLhbAsof(pack);
    void refreshLhbAdvice({ ...pack, rows: visibleLhbRows() }, force);
  } catch (e) {
    console.error(e);
    if (els.lhbMeta) els.lhbMeta.textContent = `加载失败：${e?.message || e}`;
    syncLhbAsof(lhbBoardCache);
    if (els.lhbBoard) {
      els.lhbBoard.innerHTML =
        '<p class="text-[12px]" style="color:var(--muted)">龙虎榜加载失败，请点「刷新榜单」重试。</p>';
    }
  } finally {
    lhbBoardLoading = false;
    if (els.lhbRefreshBtn) {
      els.lhbRefreshBtn.disabled = false;
      els.lhbRefreshBtn.textContent = '刷新榜单';
    }
  }
}

function renderPredictView() {
  const pack = state.settings?.predictPack;
  if (els.predictAiBtn) {
    els.predictAiBtn.disabled = !!state.predictRunning;
    els.predictAiBtn.textContent = state.predictRunning ? '预测中…' : 'AI 预测';
  }
  if (!pack) {
    if (els.predictMeta) els.predictMeta.textContent = '还没有预测。点「AI 预测」才会调用模型（刷新不会自动跑）。';
    if (els.predictTa) els.predictTa.innerHTML = '<p style="color:var(--muted)">等待手动预测。</p>';
    return;
  }
  if (!state.predictHistory?.length && pack.history?.length) {
    state.predictHistory = pack.history;
  }
  if (els.predictMeta) {
    els.predictMeta.textContent = `上次预测 ${formatAiTime(pack.generatedAt) || '—'} · ${pack.indexName || '上证指数'} · 仅供推演`;
  }
  if (els.predictIndexName) els.predictIndexName.textContent = pack.indexName || '上证指数';
  const ta = pack.ta || {};
  const scenarios = (pack.scenarios || [])
    .map(
      (s) => `<div class="predict-card">
        <div class="predict-card-head">${esc(s.title || '情景')}</div>
        <p><b>触发</b> ${esc(s.trigger || '—')}</p>
        <p><b>怎么做</b> ${esc(s.action || '—')}</p>
        <p><b>离场</b> ${esc(s.exit || '—')}</p>
      </div>`,
    )
    .join('');
  if (els.predictTa) {
    els.predictTa.innerHTML = `
      <p class="mb-2">${esc(pack.summary || '')}</p>
      <div class="predict-card">
        <div class="predict-card-head">${esc(ta.scenario || '主情景')}</div>
        <p>${esc(ta.advice || '')}</p>
        <p><b>买点</b> ${esc(ta.buyZone || '—')}</p>
        <p><b>卖点</b> ${esc(ta.sellZone || '—')}</p>
        <p><b>别做</b> ${esc(ta.avoid || '—')}</p>
      </div>
      ${scenarios}`;
  }
  const hist = state.predictHistory?.length
    ? state.predictHistory
    : pack.history || [];
  const forecast = pack.forecast || [];
  if (els.chartPredictK && (hist.length || forecast.length)) {
    renderForecastKline(els.chartPredictK, hist, forecast, {
      title: `${pack.indexName || '指数'} · 预测`,
      focusTomorrow: true,
    });
  }
  void loadPredictFlow();
}

async function runPredictAi() {
  if (state.predictRunning) return;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return;
  state.predictRunning = true;
  renderPredictView();
  try {
    if (!state.center?.overview) await loadDataCenter().catch(() => {});
    if (!state.center?.flow) {
      try {
        const f = await fetchMarketMoneyFlow();
        if (f) state.center = { ...(state.center || {}), flow: f };
      } catch {
        /* optional */
      }
    }
    const indexMeta = { name: '上证指数', code: '000001', market: 'SH', marketNo: 1, secid: '1.000001' };
    const k = await fetchKline(indexMeta.secid, 101, 60);
    const points = k?.points || [];
    state.predictHistory = points.map((p) => ({
      date: String(p.date || '').slice(5) || p.date,
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
      changePct: Number(p.changePct),
    }));
    const last = state.predictHistory[state.predictHistory.length - 1];
    const lastClose = Number(last?.close);
    const lastDate = String(points.at(-1)?.date || shYmd(new Date()));
    const clock = marketClock();
    const s = state.center?.flow?.summary;
    const flow = s
      ? `主力 ${fmtYi(s.main)} 亿，超大单 ${fmtYi(s.huge)} 亿。涨跌家 ${state.center?.updown?.up ?? '—'}/${state.center?.updown?.down ?? '—'}`
      : '';
    const flowRaw = state.center?.flow;
    const flowSeries = [];
    if (flowRaw?.times?.length) {
      const step = Math.max(1, Math.ceil(flowRaw.times.length / 20));
      for (let i = 0; i < flowRaw.times.length; i += step) {
        flowSeries.push({ time: flowRaw.times[i], main: Number(flowRaw.main?.[i]) || 0 });
      }
      const lastIdx = flowRaw.times.length - 1;
      if (flowSeries.length && flowSeries[flowSeries.length - 1].time !== flowRaw.times[lastIdx]) {
        flowSeries.push({ time: flowRaw.times[lastIdx], main: Number(flowRaw.main?.[lastIdx]) || 0 });
      }
    }
    const mains = (state.trend?.mains || [])
      .slice(0, 4)
      .map((m) => `${m.name || m.theme} ${m.tag || ''}`)
      .join('；');
    const pack = await askPredictPack(
      apiKey,
      buildPredictFacts({
        indexName: indexMeta.name,
        lastClose,
        recentBars: state.predictHistory,
        tape: judgeTape(state.center)?.label || '',
        flow,
        flowSeries,
        mains,
        clock: clock.line,
      }),
      state.settings?.aiModel,
    );
    const dates = nextTradeDates(lastDate, 5);
    const forecast = materializeForecastBars(lastClose, pack.forecastBars, dates);
    const saved = {
      ...pack,
      indexName: indexMeta.name,
      lastClose,
      history: state.predictHistory.slice(-40),
      forecast,
      forecastFlow: pack.forecastFlow || [],
    };
    state.settings = await saveSettings({ predictPack: saved });
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e || '预测失败');
    if (els.predictMeta) els.predictMeta.textContent = msg;
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
  } finally {
    state.predictRunning = false;
    renderPredictView();
  }
}

function ensureSimBook() {
  if (state.settings?.simBook?.capital) return state.settings.simBook;
  const book = emptySimBook();
  return book;
}

async function persistSimBook(book) {
  const next = { ...book, updatedAt: Date.now() };
  state.settings = await saveSettings({ simBook: next });
  return next;
}

function simMoney(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function simBookEquity(book) {
  const posVal = (book?.positions || []).reduce((s, p) => s + Number(p.shares || 0) * Number(p.mark || p.avgCost || 0), 0);
  return Number(book?.cash || 0) + posVal;
}

function renderSimView() {
  const book = state.settings?.simBook || ensureSimBook();
  if (els.simAiBtn) {
    els.simAiBtn.disabled = !!state.simRunning;
    els.simAiBtn.textContent = state.simRunning ? '操盘中…' : 'AI 操盘';
  }
  const equity = simBookEquity(book);
  const pnl = equity - Number(book.capital || SIM_START_CASH);
  const unrealized = (book.positions || []).reduce((s, p) => {
    const mark = Number(p.mark || p.avgCost || 0);
    return s + (mark - Number(p.avgCost || 0)) * Number(p.shares || 0);
  }, 0);
  if (els.simSummary) {
    els.simSummary.innerHTML = `
      <div class="sim-metric"><span>总本金</span><b>${simMoney(book.capital)} 元</b></div>
      <div class="sim-metric"><span>现金</span><b>${simMoney(book.cash)} 元</b></div>
      <div class="sim-metric"><span>总市值</span><b>${simMoney(equity)} 元</b></div>
      <div class="sim-metric"><span>总盈亏</span><b class="${tone(pnl)}">${pnl >= 0 ? '+' : ''}${simMoney(pnl)} 元</b></div>
      <div class="sim-metric"><span>已实现</span><b class="${tone(book.realizedPnl)}">${Number(book.realizedPnl) >= 0 ? '+' : ''}${simMoney(book.realizedPnl)} 元</b></div>
      <div class="sim-metric"><span>浮动</span><b class="${tone(unrealized)}">${unrealized >= 0 ? '+' : ''}${simMoney(unrealized)} 元</b></div>
      <div class="sim-metric"><span>持仓数</span><b>${(book.positions || []).length}</b></div>
      <div class="sim-metric"><span>上次操盘</span><b style="font-size:12px">${book.lastRunAt ? formatAiTime(book.lastRunAt) : '—'}</b></div>`;
  }
  if (els.simNote) {
    els.simNote.textContent = book.note
      ? book.note
      : '点「AI 操盘」：按现价成交，手续费万五（最低 5 元）计入成本；刚买入浮盈应为小亏（扣费），不会凭空赚钱。';
  }
  if (els.simPositions) {
    const rows = book.positions || [];
    els.simPositions.innerHTML = rows.length
      ? rows
          .map((p) => {
            const mark = Number(p.mark || p.avgCost || 0);
            const u = (mark - Number(p.avgCost || 0)) * Number(p.shares || 0);
            return `<div class="sim-row">
              <div class="sim-row-head"><span>${esc(p.name)} ${esc(p.code)}</span><b class="${tone(u)}">${u >= 0 ? '+' : ''}${simMoney(u)} 元</b></div>
              <div class="sim-row-meta">${Number(p.shares)} 股 · 成本(含费) ${Number(p.avgCost).toFixed(3)} · 现价 ${mark ? mark.toFixed(2) : '—'} · 计划卖 ${esc(p.planSell || '—')} · 拿到 ${esc(p.holdUntil || '—')}</div>
              <div class="sim-row-meta">为什么：${esc(p.why || '—')}</div>
            </div>`;
          })
          .join('')
      : '<p style="color:var(--muted)">暂无持仓</p>';
  }
  if (els.simTrades) {
    const trades = book.trades || [];
    els.simTrades.innerHTML = trades.length
      ? trades
          .slice(0, 40)
          .map((t) => {
            const sideCls = t.side === 'buy' ? 'sim-side-buy' : 'sim-side-sell';
            const sideLabel = t.side === 'buy' ? '买入' : '卖出';
            const fee = Number(t.fee) || 0;
            return `<div class="sim-row">
              <div class="sim-row-head">
                <span><b class="${sideCls}">${sideLabel}</b> ${esc(t.name)} ${esc(t.code)}</span>
                <span>${formatAiTime(t.at) || ''}</span>
              </div>
              <div class="sim-row-meta">${Number(t.shares)} 股 · 价 ${Number(t.price).toFixed(2)} · 金额 ${simMoney(t.amount)} 元 · 手续费 ${fee.toFixed(2)} 元（万五）</div>
              <div class="sim-row-meta">预计买：${esc(t.planBuy || '—')} · 预计卖：${esc(t.planSell || '—')} · 拿到：${esc(t.holdUntil || '—')}</div>
              <div class="sim-row-meta">为什么：${esc(t.why || '—')}</div>
            </div>`;
          })
          .join('')
      : '<p style="color:var(--muted)">还没有成交</p>';
  }
}

async function markSimToMarket() {
  const book = state.settings?.simBook || ensureSimBook();
  const positions = book.positions || [];
  if (!positions.length) {
    if (!state.settings?.simBook) await persistSimBook(book);
    renderSimView();
    return;
  }
  try {
    const items = positions.map((p) => ({
      kind: 'stock',
      code: p.code,
      market: p.market,
      marketNo: p.market === 'SH' ? 1 : 0,
      secid: p.secid || toSecid(p.market, p.code),
      name: p.name,
    }));
    const map = await fetchQuotes(items);
    const nextPos = positions.map((p) => {
      const q = quoteFromMap(map, p.code, p.market);
      const mark = Number(q?.price);
      // 无新行情时保持原 mark；有行情则更新。成本已含万五，现价不变时浮盈≈-手续费
      return { ...p, mark: mark > 0 ? mark : Number(p.mark) || Number(p.avgCost) };
    });
    await persistSimBook({ ...book, positions: nextPos });
  } catch (e) {
    console.error(e);
  }
  renderSimView();
}

function quoteFromMap(quoteMap, code, market) {
  const key = quoteKey({ kind: 'stock', market: market || '', code });
  const direct = quoteMap?.[key];
  if (Number(direct?.price) > 0) return direct;
  const code6 = String(code || '').replace(/\D/g, '').slice(-6);
  return (
    Object.values(quoteMap || {}).find((q) => String(q.code || '').replace(/\D/g, '').slice(-6) === code6) ||
    null
  );
}

function applySimOrders(book, orders, quoteMap) {
  let cash = Number(book.cash);
  let realized = Number(book.realizedPnl || 0);
  const positions = [...(book.positions || [])];
  const trades = [...(book.trades || [])];
  const now = Date.now();

  const findPos = (code) => positions.findIndex((p) => p.code === code);

  for (const order of orders) {
    // 必须有现价才成交，避免 AI 报价与刷新市值不一致导致「刚买就赚」
    const q = quoteFromMap(quoteMap, order.code, order.market);
    const px = Number(q?.price);
    if (!(px > 0)) continue;
    const shares = order.lots * 100;
    const notional = +(px * shares).toFixed(2);
    const fee = simFee(notional);
    if (order.side === 'buy') {
      const debit = +(notional + fee).toFixed(2);
      if (debit > cash + 0.01) continue;
      cash -= debit;
      const idx = findPos(order.code);
      if (idx >= 0) {
        const cur = positions[idx];
        const totalShares = cur.shares + shares;
        // 成本含手续费
        const avgCost = (cur.avgCost * cur.shares + debit) / totalShares;
        positions[idx] = {
          ...cur,
          shares: totalShares,
          avgCost: +avgCost.toFixed(4),
          mark: px,
          planSell: order.planSell || cur.planSell,
          holdUntil: order.holdUntil || cur.holdUntil,
          why: order.why || cur.why,
        };
      } else {
        positions.push({
          code: order.code,
          name: order.name,
          market: order.market,
          secid: toSecid(order.market, order.code),
          shares,
          avgCost: +(debit / shares).toFixed(4),
          mark: px,
          planSell: order.planSell,
          holdUntil: order.holdUntil,
          why: order.why,
          openedAt: now,
        });
      }
      trades.unshift({
        id: `${now}-${order.code}-b`,
        side: 'buy',
        code: order.code,
        name: order.name,
        market: order.market,
        price: px,
        shares,
        amount: notional,
        fee,
        planBuy: order.planBuy,
        planSell: order.planSell,
        holdUntil: order.holdUntil,
        why: order.why,
        at: now,
      });
    } else {
      const idx = findPos(order.code);
      if (idx < 0) continue;
      const cur = positions[idx];
      const sellShares = Math.min(shares, cur.shares);
      if (!(sellShares > 0)) continue;
      const proceed = +(px * sellShares).toFixed(2);
      const feeSell = simFee(proceed);
      const net = +(proceed - feeSell).toFixed(2);
      const costBasis = cur.avgCost * sellShares;
      realized += net - costBasis;
      cash += net;
      const left = cur.shares - sellShares;
      if (left <= 0) positions.splice(idx, 1);
      else positions[idx] = { ...cur, shares: left, mark: px };
      trades.unshift({
        id: `${now}-${order.code}-s`,
        side: 'sell',
        code: order.code,
        name: order.name || cur.name,
        market: order.market || cur.market,
        price: px,
        shares: sellShares,
        amount: proceed,
        fee: feeSell,
        planBuy: order.planBuy,
        planSell: order.planSell,
        holdUntil: order.holdUntil,
        why: order.why,
        at: now,
      });
    }
  }

  return {
    ...book,
    cash: +cash.toFixed(2),
    realizedPnl: +realized.toFixed(2),
    positions,
    trades: trades.slice(0, 80),
    lastRunAt: now,
  };
}

function toQuoteItem(row) {
  const code = String(row.code || '').replace(/\D/g, '').slice(-6);
  const market = row.market || (code.startsWith('6') ? 'SH' : code.startsWith('4') || code.startsWith('8') ? 'BJ' : 'SZ');
  return {
    kind: 'stock',
    code,
    market,
    marketNo: market === 'SH' ? 1 : 0,
    secid: row.secid || toSecid(market, code),
    name: row.name || code,
  };
}

async function runSimAi() {
  if (state.simRunning) return;
  if (els.simNote) els.simNote.textContent = '正在准备密钥与行情…';
  if (els.simAiBtn) {
    els.simAiBtn.disabled = true;
    els.simAiBtn.textContent = '操盘中…';
  }
  let apiKey = '';
  try {
    apiKey = await ensureDeepseekKey();
  } catch (e) {
    console.error(e);
    if (els.simNote) els.simNote.textContent = String(e?.message || e || '密钥读取失败');
    if (els.simAiBtn) {
      els.simAiBtn.disabled = false;
      els.simAiBtn.textContent = 'AI 操盘';
    }
    return;
  }
  if (!apiKey) {
    if (els.simNote) els.simNote.textContent = '未配置 DeepSeek 密钥，无法操盘。点右上「更多 → 模型」填写。';
    if (els.simAiBtn) {
      els.simAiBtn.disabled = false;
      els.simAiBtn.textContent = 'AI 操盘';
    }
    return;
  }
  state.simRunning = true;
  renderSimView();
  if (els.simNote) els.simNote.textContent = 'AI 操盘中：拉行情 → 决策 → 按现价下单…';
  try {
    let book = state.settings?.simBook || ensureSimBook();
    if (!state.settings?.simBook) book = await persistSimBook(book);

    const holdings = state.list
      .filter((x) => x.kind === 'stock' && isHeld(x))
      .map((item) => {
        const q = state.quotes[quoteKey(item)] || {};
        return {
          name: preferDisplayName(q.name, item.name),
          code: String(item.code).replace(/\D/g, '').slice(-6),
          market: item.market,
          cost: Number(item.cost),
          lots: Number(item.lots || item.markPrice) || 0,
          price: Number(q.price),
          changePct: Number(q.changePct),
        };
      })
      .filter((h) => h.code);

    const watchCands = state.list
      .filter((x) => x.kind === 'stock')
      .slice(0, 20)
      .map((item) => {
        const q = state.quotes[quoteKey(item)] || {};
        return {
          name: preferDisplayName(q.name, item.name),
          code: String(item.code).replace(/\D/g, '').slice(-6),
          market: item.market,
          price: Number(q.price),
          changePct: Number(q.changePct),
        };
      });

    let movers = [];
    try {
      const rows = await fetchTopMovers('up', 20);
      movers = (rows || []).slice(0, 8).map((r) => ({
        name: r.name,
        code: String(r.code).replace(/\D/g, '').slice(-6),
        market: r.market || (String(r.code || '').startsWith('6') ? 'SH' : 'SZ'),
        price: Number(r.price),
        changePct: Number(r.changePct),
      }));
    } catch {
      /* optional */
    }

    const seed = [...holdings, ...watchCands, ...movers, ...(book.positions || [])];
    const uniq = [];
    const seen = new Set();
    for (const row of seed) {
      if (!row?.code) continue;
      const item = toQuoteItem(row);
      const k = `${item.market}:${item.code}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(item);
    }

    let quoteMap = {};
    if (uniq.length) {
      try {
        quoteMap = await fetchQuotes(uniq);
      } catch (e) {
        console.error(e);
      }
    }

    const priceOf = (code, market) => {
      const q = quoteFromMap(quoteMap, code, market);
      return Number(q?.price) > 0 ? Number(q.price) : 0;
    };

    const holdingsLive = holdings.map((h) => ({
      ...h,
      price: priceOf(h.code, h.market) || h.price,
      changePct: Number(quoteFromMap(quoteMap, h.code, h.market)?.changePct ?? h.changePct),
    }));
    const candLive = [...watchCands, ...movers]
      .map((c) => ({
        ...c,
        price: priceOf(c.code, c.market) || c.price,
        changePct: Number(quoteFromMap(quoteMap, c.code, c.market)?.changePct ?? c.changePct),
      }))
      .filter((c) => c.code && c.price > 0)
      .slice(0, 16);

    if (!holdingsLive.length && !candLive.length) {
      throw new Error('没有可用行情（自选/涨幅榜都取不到价）。先在自选加几只股票，或稍后重试。');
    }

    const posMarked = (book.positions || []).map((p) => {
      const mark = priceOf(p.code, p.market) || Number(p.mark) || Number(p.avgCost);
      return { ...p, mark, unrealized: (mark - p.avgCost) * p.shares };
    });
    book = { ...book, positions: posMarked };

    const clock = marketClock();
    if (els.simNote) els.simNote.textContent = '正在调用 DeepSeek 决策…';
    const decision = await askSimOrders(
      apiKey,
      buildSimFacts({
        book,
        holdings: holdingsLive,
        candidates: candLive,
        tape: judgeTape(state.center)?.label || '',
        clock: clock.line,
      }),
      state.settings?.aiModel,
    );

    // AI 可能下了名单外的票：补拉现价后再成交
    const extra = [];
    for (const order of decision.orders || []) {
      if (priceOf(order.code, order.market) > 0) continue;
      extra.push(toQuoteItem(order));
    }
    if (extra.length) {
      try {
        const more = await fetchQuotes(extra);
        quoteMap = { ...quoteMap, ...more };
      } catch (e) {
        console.error(e);
      }
    }

    const beforeTrades = (book.trades || []).length;
    const next = applySimOrders(
      { ...book, note: decision.note || book.note },
      decision.orders || [],
      quoteMap,
    );
    const filled = (next.trades || []).length - beforeTrades;
    await persistSimBook(next);
    await markSimToMarket();

    if (!(decision.orders || []).length) {
      if (els.simNote) {
        els.simNote.textContent = `${decision.note || '今日空仓。'}（AI 未下单）`;
      }
    } else if (filled <= 0) {
      if (els.simNote) {
        els.simNote.textContent = `${decision.note || ''} 有意向但未成交：缺现价或现金不足。可点「刷新市值」后再试。`.trim();
      }
    } else if (els.simNote) {
      els.simNote.textContent = `${decision.note || ''}（成交 ${filled} 笔，含万五手续费）`.trim();
    }
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e || '操盘失败');
    if (els.simNote) els.simNote.textContent = msg;
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
  } finally {
    state.simRunning = false;
    renderSimView();
  }
}

async function resetSimBook() {
  const ok = await confirmDialog('重置模拟盘', '清空全部虚拟持仓与交易记录，本金恢复 10 万？');
  if (!ok) return;
  await persistSimBook(emptySimBook());
  renderSimView();
}

function openDialog({ title, bodyHtml }) {
  return new Promise((resolve) => {
    state.dialogResolve = resolve;
    state.dialogSnapshot = null;
    els.dialogTitle.textContent = title;
    els.dialogBody.innerHTML = bodyHtml;
    els.dialogRoot.classList.remove('hidden');
    els.dialogRoot.classList.add('flex');
    const focusEl = els.dialogBody.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea');
    focusEl?.focus?.();
  });
}
function snapshotDialogForm() {
  const snap = {};
  els.dialogBody.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!el.id && !el.name) return;
    const key = el.id || el.name;
    if (el.type === 'checkbox') snap[key] = !!el.checked;
    else if (el.type === 'radio') {
      if (el.checked) snap[key] = el.value;
    } else snap[key] = el.value;
  });
  state.dialogSnapshot = snap;
  return snap;
}
function closeDialog(result) {
  if (result) snapshotDialogForm();
  els.dialogRoot.classList.add('hidden');
  els.dialogRoot.classList.remove('flex');
  state.dialogResolve?.(result);
  state.dialogResolve = null;
}
function confirmDialog(title, message) {
  return openDialog({
    title,
    bodyHtml: `<p class="text-sm" style="color:var(--muted)">${esc(message)}</p>`,
  });
}

function checksLine(report) {
  const c = report?.checks;
  if (!c) return '';
  const em = c.emTime ? new Date(c.emTime).toLocaleString('zh-CN', { hour12: false }) : '—';
  const diff = Number(c.diffPct);
  const warn = Number.isFinite(diff) && Math.abs(diff) >= 0.3;
  const tx = c.txPrice ? ` · 腾讯 ${esc(String(c.txPrice))}${c.txTime ? ` ${esc(c.txTime)}` : ''}` : '';
  const gap = Number.isFinite(diff) ? ` · 偏差 ${diff.toFixed(2)}%` : '';
  return `<p class="mb-2 text-[10px] leading-snug" style="color:${warn ? 'var(--up)' : 'var(--muted)'}">东财 ${esc(String(c.emPrice ?? '—'))} · ${esc(em)}${tx}${gap}${warn ? ' · 两源不一致，以券商软件为准' : ''}</p>`;
}

function closeDetail() {
  state.detail = null;
  els.detailRoot.classList.add('hidden');
  els.detailRoot.classList.remove('flex');
  disposeChart(els.chartMain);
  disposeChart(els.chartStockFlow);
  if (els.aiAdviceBody) {
    els.aiAdviceBody.innerHTML = '点「分析」才会调用 DeepSeek。';
  }
}

function actionClass(action) {
  if (action === '买入' || action === '做多' || action === '跟') return 'text-up';
  if (action === '不买' || action === '今天不做' || action === '不跟') return 'text-down';
  return '';
}

function reportBlock(title, text) {
  if (!text) return '';
  return `<div class="mb-2"><div class="text-[11px] font-semibold">${esc(title)}</div><div class="mt-0.5 text-[12px] leading-relaxed">${esc(text)}</div></div>`;
}

function reportPoint(label, text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return `<div class="report-point"><b>${esc(label)}</b> ${esc(value)}</div>`;
}

function reportArticleHtml(report) {
  if (!report) return '';
  const when = report.generatedAt
    ? new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })
    : '';
  const cls = actionClass(report.action);
  const probs =
    report.kind === 'market' || report.kind === 'seat' || report.kind === 'lhb'
      ? ''
      : `<div class="mb-2 grid grid-cols-3 gap-1.5 text-center">
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">买入</div><div class="text-sm font-semibold text-up">${report.buyProb ?? 0}%</div></div>
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">继续等</div><div class="text-sm font-semibold">${report.waitProb ?? 0}%</div></div>
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">不买</div><div class="text-sm font-semibold text-down">${report.avoidProb ?? 0}%</div></div>
    </div>`;
  const points =
    report.kind === 'market'
      ? `${reportPoint('做', report.leaders)}${reportPoint('避开', report.avoid)}${reportPoint('节奏', report.rhythm || report.hold)}`
      : report.kind === 'seat' || report.kind === 'lhb'
        ? `${reportPoint('席位', report.read || report.summary)}${reportPoint('持仓', report.hold)}`
        : `${reportPoint('怎么处理', report.hold || report.position)}${reportPoint('卖 / 买点', report.exit || report.today)}${reportPoint('跟主力', report.follow)}`;
  const detail =
    report.kind === 'market'
      ? `${reportBlock('风险', report.risk)}${reportBlock('和前几天比', report.consistency)}`
      : report.kind === 'seat' || report.kind === 'lhb'
        ? `${reportBlock('容易看错的地方', report.risk)}`
        : `${checksLine(report)}${reportBlock('今天怎么做', report.today)}${reportBlock('板块', report.sector)}${reportBlock('持仓', report.position)}${reportBlock('主力', report.mainForce)}${reportBlock('量价', report.trend)}${reportBlock('消息', report.news)}${reportBlock('位置', report.valuation)}${reportBlock('大盘', report.market)}${reportBlock('仓位', report.plan)}${reportBlock('离场', report.exit)}${reportBlock('放弃', report.stop)}${reportBlock('风险', report.risk)}${reportBlock('和前几天比', report.consistency)}`;
  const title =
    report.title ||
    (report.kind === 'market'
      ? '今日大盘'
      : report.kind === 'seat'
        ? '期货席位'
        : report.kind === 'lhb'
          ? '龙虎榜'
          : '个股');
  return `
    <div class="mb-2">
      <div class="text-lg font-semibold ${cls}">${esc(report.action || '继续等')}</div>
      <div class="text-[11px]" style="color:var(--muted)">${esc(title)} · ${esc(when)}</div>
    </div>
    ${probs}
    <p class="report-lead">${esc(report.summary || '')}</p>
    <div class="report-points">${points}</div>
    <details class="report-more">
      <summary>展开依据</summary>
      ${detail || '<div class="text-[12px]" style="color:var(--muted)">没有更多依据。</div>'}
    </details>`;
}

function renderDeepseekReport(report) {
  if (!els.aiAdviceBody || !report) return;
  const when = formatAiTime(report.generatedAt);
  els.aiAdviceBody.innerHTML = `${reportArticleHtml(report)}${
    when
      ? `<p class="ai-advice-meta">分析时间 ${esc(when)} · 点「重新分析」只更新本弹窗，不会弹出报告抽屉</p>`
      : ''
  }`;
  if (els.aiAdviceRefresh) els.aiAdviceRefresh.textContent = '重新分析';
}

function visibleReports() {
  const { filter } = state.reportDrawer || {};
  return reportHistory().filter((r) => {
    if (!filter) return true;
    if (filter === 'market') return r.kind === 'market';
    return r.itemKey === filter;
  });
}

function reportCoreBadge(r) {
  const act = String(r?.action || '');
  const blocked = /不买|减仓|回避|空仓|今天不做|不跟/.test(act);
  const doable = /买入|加仓|可做|做多|参与/.test(act) && !blocked;
  if (r?.kind === 'market') {
    if (blocked || !/买入|做多|跟|可做|参与/.test(act)) return '';
    const raw = String(r.leaders || r.sector || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return '';
    return raw.replace(/[。；;].*$/, '').slice(0, 14);
  }
  if (!doable) return '';
  const sector = String(r.sector || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sector) return '';
  return sector.replace(/[。；;].*$/, '').slice(0, 12);
}

function renderReportDrawer() {
  const drawer = state.reportDrawer || {};
  els.reportDrawer?.classList.toggle('hidden', !drawer.open);
  els.reportBackdrop?.classList.toggle('hidden', !drawer.open);
  els.reportDrawer?.setAttribute('aria-hidden', drawer.open ? 'false' : 'true');
  if (!drawer.open || !els.reportDrawerBody) return;
  els.reportBack?.classList.toggle('hidden', !drawer.focusId);
  const focused = drawer.focusId ? reportHistory().find((r) => r.id === drawer.focusId) : null;
  if (els.reportDrawerTitle) {
    els.reportDrawerTitle.textContent = focused
      ? focused.title || '报告'
      : drawer.filter === 'market'
        ? '大盘报告'
        : drawer.filter
          ? '这只的报告'
          : '历史报告';
  }
  if (focused) {
    els.reportDrawerBody.innerHTML = reportArticleHtml(focused);
    return;
  }
  const rows = visibleReports();
  const pending = state.marketAiRunning
    ? '<div class="mb-2 text-[12px]" style="color:var(--muted)">正在看今天的指数、涨跌家数和板块…</div>'
    : '';
  if (!rows.length) {
    els.reportDrawerBody.innerHTML = `${pending}<div class="text-[12px] leading-relaxed" style="color:var(--muted)">还没有报告。点顶部 <b>大盘分析</b> 或个股里的「分析」。只保留近一周，避免占内存。</div>`;
    return;
  }
  const card = (r) => {
    const when = r.generatedAt
      ? new Date(r.generatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    const badge = reportCoreBadge(r);
    return `<button type="button" class="report-row${badge ? ' has-core' : ''}" data-report-id="${escAttr(r.id)}">
      ${badge ? `<span class="report-core" title="${escAttr(badge)}">${esc(badge)}</span>` : ''}
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[13px] font-semibold">${esc(r.title || r.code || '报告')}</span>
        <span class="shrink-0 text-[12px] font-semibold ${actionClass(r.action)}">${esc(r.action || '')}</span>
      </div>
      <div class="mt-0.5 text-[10px]" style="color:var(--muted)">${esc(when)}</div>
      <div class="mt-1 line-clamp-2 text-left text-[12px] leading-snug" style="color:var(--muted)">${esc(r.summary || '')}</div>
    </button>`;
  };
  const byDay = (list) => {
    const groups = [];
    for (const row of list) {
      const day = row.generatedAt
        ? new Date(row.generatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })
        : '更早';
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(row);
      else groups.push({ day, items: [row] });
    }
    if (!groups.length) return '<div class="text-[12px]" style="color:var(--muted)">还没有</div>';
    return groups
      .map(
        (g) =>
          `<div class="report-day"><div class="report-day-label">${esc(g.day)}</div>${g.items.map(card).join('')}</div>`,
      )
      .join('');
  };
  if (drawer.filter) {
    els.reportDrawerBody.innerHTML = pending + byDay(rows);
    return;
  }
  const market = rows.filter((r) => r.kind === 'market' || r.kind === 'seat' || r.kind === 'lhb');
  const stocks = rows.filter((r) => r.kind !== 'market' && r.kind !== 'seat' && r.kind !== 'lhb');
  els.reportDrawerBody.innerHTML = `${pending}<div class="report-split">
    <section><h3 class="report-col-title">大盘</h3>${byDay(market)}</section>
    <section><h3 class="report-col-title">股票</h3>${byDay(stocks)}</section>
  </div>`;
}

function openReportDrawer({ focusId = null, filter = null } = {}) {
  state.reportDrawer = { open: true, focusId, filter };
  renderReportDrawer();
}

function closeReportDrawer() {
  state.reportDrawer = { open: false, focusId: null, filter: null };
  renderReportDrawer();
}

function syncMarketAiBtn() {
  if (!els.marketAiBtn) return;
  // 每个 tab 最多一个 AI：盘况用页内按钮，其它页用顶栏「大盘分析」
  // 用占位隐藏而不是 display:none，避免顶栏右侧重排把中间 tab 挤歪
  const hideTop = state.view === 'pulse';
  els.marketAiBtn.classList.remove('hidden');
  els.marketAiBtn.classList.toggle('toolbar-slot-hide', hideTop);
  els.marketAiBtn.setAttribute('aria-hidden', hideTop ? 'true' : 'false');
  els.marketAiBtn.textContent = state.marketAiRunning ? '分析中' : '大盘分析';
  els.marketAiBtn.disabled = hideTop || !!state.marketAiRunning;
  els.marketAiBtn.title = hideTop
    ? '本页请用页内 AI 按钮'
    : '手动分析今天大盘与主线；只有你点才会调用 AI';
}

function formatAiTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ts);
}

async function openModelSettings() {
  const cur = state.settings?.aiModel === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  const has = !!String(state.settings?.deepseekApiKey || '').trim();
  const ok = await openDialog({
    title: '分析模型',
    bodyHtml: `<p class="mb-2 text-[12px] leading-relaxed" style="color:var(--muted)">同一把 DeepSeek 密钥可以换模型。Flash 快、一次大约不到一分；Pro 更细，大约贵 4 倍。密钥只留在这台设备，导出备份也不含它。</p>
      <label class="mb-1 block text-[11px]" style="color:var(--muted)">模型</label>
      <select id="dlg-ai-model" class="mb-3 w-full rounded-lg px-3 py-2 text-sm outline-none" style="background:var(--panel);border:1px solid var(--line)">
        <option value="deepseek-flash" ${cur === 'deepseek-flash' ? 'selected' : ''}>Flash · 推荐</option>
        <option value="deepseek-v4-pro" ${cur === 'deepseek-v4-pro' ? 'selected' : ''}>Pro · 更细</option>
      </select>
      <label class="mb-1 block text-[11px]" style="color:var(--muted)">API Key</label>
      <input id="dlg-ds-key" type="password" autocomplete="off" placeholder="${has ? '已保存，留空则不修改' : 'sk-...'}" class="w-full rounded-lg px-3 py-2 text-sm outline-none" style="background:var(--panel);border:1px solid var(--line)" />
      <p class="mt-2 text-[11px]" style="color:var(--muted)">在 <a class="text-accent underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com</a> 创建。不要把密钥发到聊天或提交到代码里。</p>`,
  });
  if (!ok) return String(state.settings?.deepseekApiKey || '').trim();
  const snap = state.dialogSnapshot || {};
  const model = snap['dlg-ai-model'] === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  const typed = String(snap['dlg-ds-key'] || '').trim();
  const patch = { aiModel: model };
  if (typed) patch.deepseekApiKey = typed;
  state.settings = await saveSettings(patch);
  return String(state.settings?.deepseekApiKey || '').trim();
}

async function ensureDeepseekKey() {
  const saved = String(state.settings?.deepseekApiKey || '').trim();
  if (saved) return saved;
  return openModelSettings();
}

async function runDeepseekForItem(item, opts = {}) {
  if (!item || item.kind === 'fund') return;
  const keyId = itemKey(item);
  if (state.aiRunning?.[keyId]) return;
  item = state.list.find((x) => itemKey(x) === keyId) || item;
  const apiKey = opts.apiKey || (await ensureDeepseekKey());
  if (!apiKey) return;
  state.aiRunning = { ...state.aiRunning, [keyId]: true };
  renderList();
  if (state.detail && itemKey(state.detail) === keyId && els.aiAdviceBody) {
    els.aiAdviceBody.innerHTML =
      '<div class="text-[12px]" style="color:var(--muted)">正在拉日K、近5日主力和这只股票的消息…</div>';
  }
  try {
    const secid = item.secid || toSecid(item.market, item.code, item.marketNo);
    const displayName = preferDisplayName(
      state.quotes[quoteKey(item)]?.name,
      item.name,
    );
    const [dayK, flow, flowDays, snapshot, headlines, announcements, news, tencent, lhb] = await Promise.all([
      fetchKline(secid, 101, 80).catch(() => null),
      fetchStockMoneyFlow(secid).catch(() => null),
      fetchStockFlowDays(secid, 8).catch(() => []),
      fetchStockSnapshot(secid).catch(() => null),
      fetchStockHeadlines(displayName, 6).catch(() => []),
      fetchStockAnnouncements(item.code, 3).catch(() => []),
      state.insightNews?.length ? Promise.resolve(state.insightNews) : fetchMarketNews(4).catch(() => []),
      fetchTencentStockQuote(item).catch(() => null),
      fetchDragonTiger(item.code).catch(() => ({ recent: [], note: '龙虎榜未取到' })),
    ]);
    const industry = await fetchIndustryMove(snapshot?.industry).catch(() => null);
    if (!state.center?.overview) await loadDataCenter().catch(() => {});
    const q = { ...(state.quotes[quoteKey(item)] || {}), ...(snapshot || {}) };
    const intent = analyzeMainForceIntent(flow?.summary || {});
    const facts = buildStockFacts({
      item,
      quote: { ...q, name: displayName },
      dayK,
      flow,
      flowDays,
      snapshot,
      headlines,
      announcements,
      news: news || [],
      indices: state.indices || [],
      intent,
      center: state.center,
      cross: tencent,
      industry,
      lhb,
      tape: judgeTape(state.center)?.label || '',
      prior: priorContext((r) => r.kind !== 'market' && r.itemKey === keyId),
    });
    const report = await askDeepseekReport(apiKey, facts, state.settings?.aiModel);
    const emPrice = Number(q.price);
    const txPrice = Number(tencent?.price);
    report.checks = {
      emPrice: Number.isFinite(emPrice) ? emPrice : null,
      emTime: q.updatedAt || null,
      txPrice: Number.isFinite(txPrice) && txPrice > 0 ? txPrice : null,
      txTime: tencent?.time || '',
      diffPct: emPrice > 0 && txPrice > 0 ? ((txPrice - emPrice) / emPrice) * 100 : null,
    };
    const saved = await pushReport({
      ...report,
      kind: 'stock',
      itemKey: keyId,
      code: item.code,
      title: displayName || item.name || item.code,
    });
    if (state.detail && itemKey(state.detail) === keyId) renderDeepseekReport(saved);
    // 详情弹窗内重新分析（quiet）只更新弹窗；列表外触发才开报告抽屉
    if (!opts.quiet && !(state.detail && itemKey(state.detail) === keyId)) {
      openReportDrawer({ focusId: saved.id });
    }
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    if (state.detail && itemKey(state.detail) === keyId && els.aiAdviceBody) {
      els.aiAdviceBody.innerHTML = `<div class="text-[12px]" style="color:var(--up)">${esc(msg || '分析失败')}</div>`;
    }
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
      state.scanStop = true;
    }
  } finally {
    const next = { ...state.aiRunning };
    delete next[keyId];
    state.aiRunning = next;
    // 无论 quiet 与否都刷新列表，保证概率与弹窗一致
    renderList();
  }
}

async function scanAllStocks() {
  if (state.scanRunning) return;
  const stocks = state.list.filter((x) => x.kind === 'stock');
  if (!stocks.length) return;
  const calls = Math.ceil(stocks.length / 12);
  const ok = await confirmDialog(
    '分析全部',
    `给 ${stocks.length} 只股票打买入、继续等、不买的概率，大约 ${calls} 次调用。确定开始？`,
  );
  if (!ok) return;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return;
  state.scanRunning = true;
  state.scanStop = false;
  const chunks = [];
  for (let i = 0; i < stocks.length; i += 12) chunks.push(stocks.slice(i, i + 12));
  state.scanProgress = { done: 0, total: stocks.length };
  renderList();
  const tape = judgeTape(state.center)?.label || '';
  try {
    for (const chunk of chunks) {
      if (state.scanStop) break;
      const rows = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunk.length) {
          const item = chunk[cursor];
          cursor += 1;
          const secid = item.secid || toSecid(item.market, item.code, item.marketNo);
          const dayK = await fetchKline(secid, 101, 30).catch(() => null);
          rows.push({ item, quote: state.quotes[quoteKey(item)] || {}, dayK });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, chunk.length) }, () => worker()));
      const scored = await askScanBatch(apiKey, buildScanFacts(rows, tape ? `今天环境：${tape}` : ''));
      const known = new Map(chunk.map((item) => [String(item.code).replace(/\D/g, '').slice(-6), item]));
      const aiScan = { ...(state.settings?.aiScan || {}) };
      const now = Date.now();
      for (const row of scored) {
        const item = known.get(row.code);
        if (!item) continue;
        aiScan[itemKey(item)] = { ...row, generatedAt: now };
      }
      state.settings = await saveSettings({ aiScan });
      state.scanProgress = {
        ...state.scanProgress,
        done: Math.min(stocks.length, (state.scanProgress?.done || 0) + chunk.length),
      };
      renderList();
    }
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
  } finally {
    state.scanRunning = false;
    renderList();
  }
}

async function loadDetailAiAdvice(force = false) {
  const item = state.detail;
  if (!item || item.kind === 'fund' || !els.aiAdviceBody) return;
  const saved = aiReportOf(item);
  if (saved && !force) {
    renderDeepseekReport(saved);
    return;
  }
  if (force) {
    await runDeepseekForItem(item, { quiet: true });
    return;
  }
  els.aiAdviceBody.innerHTML =
    '<div class="text-[12px] leading-relaxed" style="color:var(--muted)">还没有这份报告。点右上「分析」才会调用 DeepSeek（只更新本弹窗）。看持仓怎么处理，以及跟不跟主力。</div>';
  if (els.aiAdviceRefresh) els.aiAdviceRefresh.textContent = '分析';
}

async function runMarketAi() {
  if (state.marketAiRunning) return;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return;
  state.marketAiRunning = true;
  syncMarketAiBtn();
  openReportDrawer({ filter: 'market' });
  try {
    if (!state.center?.overview) await loadDataCenter().catch(() => {});
    if (!state.trend?.brief) await loadTrendSheet();
    const ready = (state.pulseBoards?.CN || []).filter((b) => Number.isFinite(Number(b.changePct)));
    if (ready.length < 3) await refreshPulse();
    const report = await askMarketReport(apiKey, marketFacts(), state.settings?.aiModel);
    const saved = await pushReport({
      ...report,
      kind: 'market',
      title: '今日大盘',
      itemKey: '',
      code: '',
    });
    openReportDrawer({ focusId: saved.id });
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    if (els.reportDrawerBody) {
      els.reportDrawerBody.innerHTML = `<div class="text-[12px]" style="color:var(--up)">${esc(msg || '大盘分析失败')}</div>`;
    }
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
  } finally {
    state.marketAiRunning = false;
    syncMarketAiBtn();
    renderStrategyDesk();
  }
}

function showAppAfterLogin() {
  els.loginRoot?.classList.add('hidden');
  els.appFrame?.classList.remove('hidden');
}

function showLoginGate() {
  els.appFrame?.classList.add('hidden');
  els.loginRoot?.classList.remove('hidden');
  if (els.loginError) {
    els.loginError.classList.add('hidden');
    els.loginError.textContent = '';
  }
  els.loginUser?.focus?.();
}

async function openDetail(item) {
  state.detail = item;
  state.period = 'intraday';
  syncPeriodTabs();
  const q = state.quotes[quoteKey(item)] || item;
  $('detail-name').textContent = preferDisplayName(q.name, item.name);
  $('detail-sub').textContent =
    item.kind === 'fund'
      ? `${item.code} · 场外基金`
      : `${item.code} · ${marketLabel(item.market) || item.label || ''}`;
  $('detail-price').textContent = fmtPrice(q.price ?? item.price, item.market);
  $('detail-pct').textContent = fmtPct(q.changePct ?? item.changePct);
  $('detail-pct').className = `text-sm font-semibold tabular-nums ${tone(q.changePct ?? item.changePct)}`;
  $('detail-price').className = `text-lg font-semibold tabular-nums ${tone(q.changePct ?? item.changePct)}`;

  els.detailRoot.classList.remove('hidden');
  els.detailRoot.classList.add('flex');

  if (item.kind === 'fund') {
    els.fundStats.classList.remove('hidden');
    els.stockChartWrap.classList.add('hidden');
    await ensureFundQuote(item);
    const fq = state.quotes[quoteKey(item)] || {};
    els.fundStats.innerHTML = [
      ['估算净值', fmtPrice(fq.estimate ?? fq.price, 'FUND')],
      ['单位净值', fmtPrice(fq.nav ?? fq.price, 'FUND')],
      ['涨跌幅', fmtPct(fq.changePct)],
      ['更新', fq.asOf || '—'],
    ]
      .map(
        ([k, v], i) => `<div class="glass rounded-lg px-2 py-1.5">
          <div class="text-[10px]" style="color:var(--muted)">${k}</div>
          <div class="text-sm font-semibold tabular-nums ${i === 2 ? tone(fq.changePct) : ''}">${v}</div>
        </div>`,
      )
      .join('');
    $('detail-price').textContent = fmtPrice(fq.estimate ?? fq.nav ?? fq.price, 'FUND');
    $('detail-pct').textContent = fmtPct(fq.changePct);
    $('detail-pct').className = `text-sm font-semibold tabular-nums ${tone(fq.changePct)}`;
    $('detail-price').className = `text-lg font-semibold tabular-nums ${tone(fq.changePct)}`;
    return;
  }

  els.fundStats.classList.add('hidden');
  els.stockChartWrap.classList.remove('hidden');
  els.chartMain.innerHTML =
    '<div class="flex h-full items-center justify-center text-sm" style="color:var(--muted)">加载中…</div>';
  els.chartStockFlow.innerHTML =
    '<div class="flex h-full items-center justify-center text-sm" style="color:var(--muted)">加载中…</div>';
  if (els.aiAdviceBody) {
    const saved = aiReportOf(item);
    if (saved) renderDeepseekReport(saved);
    else {
      els.aiAdviceBody.innerHTML =
        '<div class="text-[12px] leading-relaxed" style="color:var(--muted)">点右上「分析」才会调用 DeepSeek（不会弹出抽屉）。看持仓怎么处理，以及跟不跟主力。</div>';
      if (els.aiAdviceRefresh) els.aiAdviceRefresh.textContent = '分析';
    }
  }
  // 等弹窗完成布局后再画图，避免首次空白
  await waitFrames(3);
  await Promise.all([refreshDetailCharts(), loadDetailAiAdvice(false)]);
  await waitFrames(1);
  resizeAllCharts();
}

async function ensureFundQuote(item) {
  if (state.quotes[quoteKey(item)]?.nav != null || state.quotes[quoteKey(item)]?.price != null) return;
  try {
    const map = await fetchQuotes([item]);
    state.quotes = { ...state.quotes, ...map };
  } catch {
    /* ignore */
  }
}

function isForeignDetail(item) {
  const mk = Number(item?.marketNo);
  const sid = String(item?.secid || '');
  const head = sid.split('.')[0];
  return (
    item?.market === 'US' ||
    item?.market === 'HK' ||
    item?.market === 'KR' ||
    item?.market === 'JP' ||
    mk >= 100 ||
    ['100', '101', '105', '106', '107', '116', '177'].includes(head)
  );
}

function syncPeriodTabs() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    const on = btn.dataset.period === state.period;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
  const foreign = isForeignDetail(state.detail);
  const axisWrap = document.querySelector('#stock-chart-wrap .detail-axis-btn')?.parentElement;
  if (axisWrap) axisWrap.classList.toggle('hidden', foreign);
}

async function refreshDetailCharts() {
  const item = state.detail;
  if (!item || item.kind === 'fund') return;
  const secid = item.secid || toSecid(item.market, item.code, item.marketNo);
  try {
    const period = state.period;
    const foreign = isForeignDetail(item);
    // A 股五日：近 5 根日 K；海外五日：优先 5 日分钟分时（与日K区分开）
    const minute = period === 'intraday' || (foreign && period === 'fiveday');
    const kltMap = { fiveday: 101, day: 101, week: 102, month: 103 };
    const klineLimit = period === 'fiveday' ? 5 : period === 'month' ? 60 : 90;
    const mainFetch = async () => {
      if (!minute) return fetchKline(secid, kltMap[period] || 101, klineLimit);
      const intra = await fetchIntraday(secid, period === 'fiveday' ? 5 : 1);
      if (intra?.points?.length) return { ...intra, _chart: 'intra' };
      // 海外五日分钟失败时退回 5 根日 K，避免空白
      if (period === 'fiveday') {
        const k = await fetchKline(secid, 101, 5);
        if (k?.points?.length) return { ...k, _chart: 'kline' };
      }
      return intra;
    };
    const [mainRes, flowRes] = await Promise.allSettled([
      mainFetch(),
      foreign ? Promise.resolve(null) : fetchStockMoneyFlow(secid),
    ]);
    let mainData = mainRes.status === 'fulfilled' ? mainRes.value : null;
    const flow = flowRes.status === 'fulfilled' ? flowRes.value : null;
    if (mainRes.status === 'rejected') console.error(mainRes.reason);
    if (flowRes.status === 'rejected') console.error(flowRes.reason);
    const useMinute =
      minute && mainData?._chart !== 'kline' && Array.isArray(mainData?.points) && mainData.points[0]?.price != null;

    const axisMode = foreign ? 'live' : chartAxisMode();
    syncPeriodTabs();
    const prices = mainData?.points?.map((p) => p.price ?? p.high) || [];
    const intraHi = prices.reduce((m, v) => (Number(v) > m ? Number(v) : m), -Infinity);
    const intraLo = prices.reduce((m, v) => (Number(v) > 0 && Number(v) < m ? Number(v) : m), Infinity);
    const auto = useMinute ? {} : calcAutoLevels(mainData?.points || [], period === 'fiveday' ? 5 : 20);
    const base = Number(mainData?.preClose);
    const pctOf = (price) => {
      if (!(base > 0) || !(Number(price) > 0)) return '—';
      const pct = ((Number(price) - base) / base) * 100;
      return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
    };
    const markLine = buildLevelMarkLines({
      preClose: useMinute ? mainData?.preClose : null,
      resistance: useMinute ? (Number.isFinite(intraHi) ? intraHi : null) : auto.resistance,
      support: useMinute ? (Number.isFinite(intraLo) ? intraLo : null) : auto.support,
      resistanceName: useMinute ? `最高涨幅 ${pctOf(intraHi)}` : '压力',
      supportName: useMinute ? `最低涨幅 ${pctOf(intraLo)}` : '支撑',
    });

    // 清空占位后再渲染，保证容器已有尺寸
    els.chartMain.innerHTML = '';
    await waitFrames(1);

    if (useMinute) {
      const intra = mainData;
      if (intra?.points?.length) {
        renderIntradayChart(
          els.chartMain,
          {
            times: intra.points.map((p) => p.time),
            prices: intra.points.map((p) => p.price),
            avgs: intra.points.map((p) => p.avg),
            volumes: intra.points.map((p) => p.volume),
            preClose: intra.preClose,
            markLine: markLine,
          },
          { axisMode },
        );
        const last = intra.points[intra.points.length - 1];
        if (last?.price != null) {
          $('detail-price').textContent = fmtPrice(last.price, item.market);
          const pct = intra.preClose
            ? ((last.price - intra.preClose) / intra.preClose) * 100
            : item.changePct;
          $('detail-pct').textContent = fmtPct(pct);
          $('detail-pct').className = `text-sm font-semibold tabular-nums ${tone(pct)}`;
          $('detail-price').className = `text-lg font-semibold tabular-nums ${tone(pct)}`;
        }
      } else {
        els.chartMain.innerHTML =
          `<div class="flex h-full flex-col items-center justify-center gap-1 text-sm" style="color:var(--muted)"><span>暂无分时（闭盘也会显示当日走势）</span><span class="text-[11px]">可切换日K，或稍后重试</span></div>`;
      }
    } else if (mainData?.points?.length) {
      const title =
        period === 'fiveday' ? '五日K' : period === 'week' ? '周K' : period === 'month' ? '月K' : '日K';
      const points =
        period === 'fiveday' ? mainData.points.slice(-5) : mainData.points;
      renderKlineChart(els.chartMain, points, { markLine, title });
      const last = points[points.length - 1];
      if (last?.close != null) {
        $('detail-price').textContent = fmtPrice(last.close, item.market);
        const pct = last.changePct != null ? last.changePct : item.changePct;
        if (pct != null) {
          $('detail-pct').textContent = fmtPct(pct);
          $('detail-pct').className = `text-sm font-semibold tabular-nums ${tone(pct)}`;
          $('detail-price').className = `text-lg font-semibold tabular-nums ${tone(pct)}`;
        }
      }
    } else {
      const label =
        period === 'fiveday' ? '五日K' : period === 'week' ? '周K' : period === 'month' ? '月K' : '日K';
      els.chartMain.innerHTML =
        `<div class="flex h-full flex-col items-center justify-center gap-1 text-sm" style="color:var(--muted)"><span>暂无${esc(label)}（闭盘也应显示历史K线）</span><span class="text-[11px]">请稍后重试，或切回分时再切回来</span></div>`;
    }

    els.chartStockFlow.innerHTML = '';
    await waitFrames(1);
    if (flow?.times?.length) {
      const s = flow.summary;
      $('detail-flow-tip').textContent = `主力 ${fmtYi(s.main)} 亿`;
      els.detailFlowCards.innerHTML = [
        ['主力', s.main],
        ['超大', s.huge],
        ['大单', s.large],
        ['中单', s.mid],
        ['小单', s.small],
      ]
        .map(
          ([label, v]) => `<div class="rounded-md px-1 py-1 text-center ring-soft">
            <div class="text-[9px]" style="color:var(--muted)">${label}</div>
            <div class="text-[11px] font-semibold tabular-nums ${tone(v)}">${fmtYi(v)}</div>
          </div>`,
        )
        .join('');
      renderFlowChart(els.chartStockFlow, flow, {
        axisMode,
        legendNames: flowLegendNames(),
      });
    } else {
      els.detailFlowCards.innerHTML = '';
      els.chartStockFlow.innerHTML =
        '<div class="flex h-full items-center justify-center text-sm" style="color:var(--muted)">暂无资金流</div>';
    }
    resizeAllCharts();
  } catch (e) {
    console.error(e);
    els.chartMain.innerHTML =
      '<div class="flex h-full items-center justify-center text-sm" style="color:var(--muted)">加载失败，请重试</div>';
  }
}

/** 上证 / 韩国急涨急跌：短时涨跌幅突变时 toast + 简讯 */
const indexSpikeState = new Map();

function noteIndexSpike(row) {
  const code = String(row?.code || '');
  const key = row?.secid || code;
  if (!key || !/^(000001|KS11)$/i.test(code)) return null;
  const pct = Number(row.changePct);
  const price = Number(row.price);
  if (!Number.isFinite(pct) || !(price > 0)) return null;
  const now = Date.now();
  const prev = indexSpikeState.get(key);
  indexSpikeState.set(key, { pct, price, at: now });
  if (!prev || !(now - prev.at < 12 * 60 * 1000)) return null;
  const dPct = pct - prev.pct;
  const dPricePct = prev.price > 0 ? ((price - prev.price) / prev.price) * 100 : 0;
  const move = Math.abs(dPct) >= Math.abs(dPricePct) ? dPct : dPricePct;
  // 约 10 分钟内相对跳变 ≥ 0.45% 视为急拉/急跌
  if (Math.abs(move) < 0.45) return null;
  const name = /KS11/i.test(code) ? '韩国KOSPI' : '上证指数';
  const up = move > 0;
  const msg = `${name}${up ? '快速拉升' : '快速回落'} ${move > 0 ? '+' : ''}${move.toFixed(2)}%（现 ${fmtPct(pct)}）`;
  return {
    id: `spike-${key}-${Math.round(now / 60000)}`,
    title: msg,
    time: new Date(now).toISOString(),
    score: 8,
    source: 'index-spike',
    tone: up ? 'up' : 'down',
    major: true,
    impact: up
      ? '短时放量上行，留意能否站稳；已追高仓位注意回撤。'
      : '短时快速下挫，控制仓位、先看支撑与情绪是否扩散。',
  };
}

function pushSpikeAlert(alert) {
  if (!alert) return;
  try {
    const lastKey = `spikeToast:${alert.id}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(lastKey)) return;
    sessionStorage?.setItem?.(lastKey, '1');
  } catch {
    /* ignore storage */
  }
  flashStatus(alert.title);
  const list = [...(state.settings?.cachedNews || [])];
  if (list.some((n) => n.id === alert.id)) return;
  list.unshift(alert);
  state.settings = { ...state.settings, cachedNews: list.slice(0, 40) };
  state.insightNews = mergeMajorAlerts(list, {
    techLeaders: state.techLeaders || [],
    todayEvents: getTodayEvents(),
  });
  saveSettings({ cachedNews: state.settings.cachedNews }).catch(() => {});
  if (typeof syncBriefUnreadUi === 'function') syncBriefUnreadUi();
}

async function refreshIndices() {
  state.indices = await fetchIndices(state.settings.indices || []);
  for (const row of state.indices || []) {
    pushSpikeAlert(noteIndexSpike(row));
  }
  renderIndices();
}

const PULSE_MARKETS = [
  { id: 'CN', title: '大A', hint: '东财板块' },
  { id: 'US', title: '美股', hint: '成分等权' },
  { id: 'KR', title: '韩股', hint: '成分等权' },
];

function pulseSectorSkeleton(market) {
  if (market === 'CN') return CN_PULSE_BOARDS.map((b) => ({ name: b.name, changePct: null }));
  const sectors = market === 'KR' ? KR_PULSE_SECTORS : US_PULSE_SECTORS;
  return sectors.map((s) => ({ name: s.name, changePct: null }));
}

function nextPulseSort(mode) {
  if (mode === 'desc') return 'asc';
  if (mode === 'asc') return 'default';
  return 'desc';
}

function pulseSortLabel(mode) {
  if (mode === 'asc') return '涨↑';
  if (mode === 'default') return '默认';
  return '涨↓';
}

function orderedPulseBoards(market) {
  const list = state.pulseBoards?.[market]?.length ? state.pulseBoards[market] : pulseSectorSkeleton(market);
  const mode = state.pulseSort?.[market] || 'desc';
  if (mode === 'default') return list;
  return [...list].sort((a, b) => {
    const av = Number(a.changePct);
    const bv = Number(b.changePct);
    const aOk = Number.isFinite(av);
    const bOk = Number.isFinite(bv);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return mode === 'asc' ? av - bv : bv - av;
  });
}

function pulseChipHtml(b) {
  const pct = Number(b.changePct);
  const ok = Number.isFinite(pct);
  const bg = !ok
    ? ''
    : pct > 0
      ? 'background:color-mix(in oklab,var(--up) 12%,transparent)'
      : pct < 0
        ? 'background:color-mix(in oklab,var(--down) 12%,transparent)'
        : '';
  return `<div class="pulse-chip" style="${bg}">
    <div class="pulse-chip-name">${esc(b.name)}</div>
    <div class="pulse-chip-pct tabular-nums ${ok ? tone(pct) : ''}">${ok ? fmtPct(pct) : '…'}</div>
  </div>`;
}

function renderPulseBoards() {
  if (!els.pulseBoardsEl) return;
  els.pulseBoardsEl.innerHTML = PULSE_MARKETS.map((m) => {
    const session = getMarketSession(m.id);
    const mode = state.pulseSort?.[m.id] || 'desc';
    const boards = orderedPulseBoards(m.id);
    return `<section class="pulse-market-block">
      <div class="pulse-market-head">
        <span class="text-sm font-semibold">${m.title}</span>
        <span class="rounded-md px-2 py-0.5 text-[11px] font-semibold ring-soft" style="color:var(--accent)">${esc(session.label)}</span>
        <span class="text-[11px]" style="color:var(--muted)">${m.hint}</span>
        <button type="button" data-pulse-sort="${m.id}" class="pulse-sort-btn" title="涨幅排序">${pulseSortLabel(mode)}</button>
      </div>
      <div class="pulse-boards">${boards.map(pulseChipHtml).join('')}</div>
    </section>`;
  }).join('');
  els.pulseBoardsEl.querySelectorAll('[data-pulse-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-pulse-sort');
      state.pulseSort = { ...state.pulseSort, [id]: nextPulseSort(state.pulseSort?.[id] || 'desc') };
      renderPulseBoards();
    });
  });
}

async function loadMemberPulse(sectors) {
  const members = sectors.flatMap((s) => s.members);
  const quotes = await fetchMembersQuotes(members);
  const bySecid = new Map(quotes.map((q) => [q.secid, q]));
  return sectors.map((s) => {
    const built = buildSectorFromMembers(s, bySecid);
    return { name: s.name, changePct: built.changePct, count: built.count };
  });
}

async function loadCnPulse() {
  const quotes = await fetchMembersQuotes(
    CN_PULSE_BOARDS.map((b) => ({
      code: b.code,
      marketNo: b.marketNo,
      secid: b.secid,
      name: b.name,
    })),
  ).catch(() => []);
  const byCode = new Map(quotes.map((q) => [String(q.code), q]));
  const direct = CN_PULSE_BOARDS.map((b) => {
    const q = byCode.get(b.code);
    return {
      name: b.name,
      changePct: Number.isFinite(Number(q?.changePct)) ? Number(q.changePct) : null,
      code: b.code,
    };
  });
  if (direct.filter((row) => Number.isFinite(row.changePct)).length >= 8) return direct;
  const members = [];
  for (const board of CN_PULSE_BOARDS) {
    for (const code of CN_PULSE_PROXIES[board.name] || []) {
      members.push({ code, marketNo: /^(6|9)/.test(code) ? 1 : 0, name: code });
    }
  }
  const proxyQuotes = await fetchMembersQuotes(members).catch(() => []);
  const byProxy = new Map(proxyQuotes.map((q) => [String(q.code), q]));
  return CN_PULSE_BOARDS.map((board) => {
    const hit = direct.find((row) => row.name === board.name);
    if (Number.isFinite(hit?.changePct)) return hit;
    const vals = (CN_PULSE_PROXIES[board.name] || [])
      .map((code) => Number(byProxy.get(code)?.changePct))
      .filter((n) => Number.isFinite(n));
    return {
      name: board.name,
      code: board.code,
      changePct: vals.length ? vals.reduce((sum, n) => sum + n, 0) / vals.length : null,
    };
  });
}

async function refreshPulse() {
  const empty = !state.pulseBoards?.CN?.length && !state.pulseBoards?.US?.length;
  if (empty) {
    state.pulseBoards = {
      CN: pulseSectorSkeleton('CN'),
      US: pulseSectorSkeleton('US'),
      KR: pulseSectorSkeleton('KR'),
    };
    renderPulseBoards();
  }
  try {
    const [cn, us, kr] = await Promise.all([
      loadCnPulse(),
      loadMemberPulse(US_PULSE_SECTORS),
      loadMemberPulse(KR_PULSE_SECTORS),
    ]);
    state.pulseBoards = { CN: cn, US: us, KR: kr };
  } catch (e) {
    console.error(e);
  }
  renderPulseBoards();
}

function pctText(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return fmtPct(x);
}

function trendChanges() {
  const out = {};
  for (const item of state.list) {
    if (item.kind === 'fund') continue;
    const pct = Number(state.quotes[quoteKey(item)]?.changePct);
    if (Number.isFinite(pct)) out[itemKey(item)] = pct;
  }
  return out;
}

function highlightTrend(text) {
  return esc(text).replace(
    /不宜再追|退潮|跌家占优|资金在撤|价已走弱|一日游|今天少做|炸板|大涨了|回落|外盘降权/g,
    (m) => `<span class="trend-hot">${m}</span>`,
  );
}

function trendPlanHtml(plan) {
  const lines = String(plan || '')
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return '<p class="trend-empty">还没有可执行的方向。</p>';
  return lines.map((s) => `<p class="trend-summary-line">${highlightTrend(s)}</p>`).join('');
}

function trendCard(title, body, extra = '', cls = '') {
  return `<section class="trend-card${cls ? ` ${cls}` : ''}">
    <div class="trend-card-head">
      <div class="trend-card-title">${title}</div>
      ${extra}
    </div>
    <div class="trend-card-body">${body}</div>
  </section>`;
}

function renderTrend() {
  const sheet = state.trend;
  const loading = state.trendLoading && !sheet;
  if (els.trendStrip) {
    if (!sheet && !loading) els.trendStrip.classList.add('hidden');
    else {
      els.trendStrip.classList.remove('hidden');
      els.trendStrip.innerHTML = loading
        ? '顺势加载中…'
        : `<span class="trend-strip-label">顺势</span> ${highlightTrend(sheet.plan || '顺势')}`;
    }
  }
  if (!els.trendSheet) return;
  if (loading) {
    els.trendSheet.innerHTML = '<div class="text-[12px]" style="color:var(--muted)">正在对隔夜方向、主线、情绪和龙虎榜…</div>';
    return;
  }
  if (!sheet) {
    els.trendSheet.innerHTML = '<div class="text-[12px]" style="color:var(--muted)">顺势数据还没取到，点右上角刷新再试。</div>';
    return;
  }
  const clock = marketClock();
  const mood = sheet.mood || '—';
  const s = sheet.sentiment;
  const moodCls = mood === '主升' ? 'text-up' : mood === '退潮' ? 'text-down' : '';
  const tagCls = (tag) =>
    tag === '不宜再追' || tag === '一日游' || tag === '回落' || tag === '大涨了' || tag === '资金在撤' || tag === '价已走弱'
      ? 'text-down'
      : tag === '还在进' || tag === '跟上了' || tag === '避开了'
        ? 'text-up'
        : '';
  const overnight = (sheet.overnight || [])
    .map((row) => {
      const targets = (row.targets || [])
        .map(
          (t) =>
            `<div class="trend-sub"><span class="trend-sub-name">${esc(t.name)}</span><span>今${pctText(t.changePct)}</span><span>昨${pctText(t.prev)}</span><span class="${tagCls(t.tag)}">${esc(t.tag)}</span></div>`,
        )
        .join('');
      return `<div class="trend-item"><div class="trend-item-k">${esc(row.from)} ${pctText(row.overseas)}</div>${targets}</div>`;
    })
    .join('');
  const mains = (sheet.mains || [])
    .map((row) => {
      const hist = row.known ? `近5日 ${row.upDays} 天涨 · 合计 ${pctText(row.sum5)}` : '近几日K线未取到';
      const leader = row.leader ? `<span>中军 ${esc(row.leader)} ${pctText(row.leaderPct)}</span>` : '';
      return `<div class="trend-item">
        <div class="trend-item-k">${esc(row.name)} <span class="${tagCls(row.tag)}">${esc(row.tag)}</span></div>
        <div class="trend-sub"><span>${hist}</span><span>主力 ${Number(row.mainFlow).toFixed(1)} 亿</span>${leader}</div>
      </div>`;
    })
    .join('');
  const flowLine = (rows) =>
    (rows || [])
      .map((row) => `<span class="trend-chip">${esc(row.name)} <b class="${tone(row.mainFlow)}">${Number(row.mainFlow).toFixed(1)}亿</b> ${pctText(row.changePct)}</span>`)
      .join('');
  const themes = sheet.flows?.themes || [];
  const inflow = themes.filter((row) => row.mainFlow > 0).slice(0, 5);
  const outflow = [...themes].filter((row) => row.mainFlow < 0).sort((a, b) => a.mainFlow - b.mainFlow).slice(0, 3);
  const seats = (sheet.seats || [])
    .map(
      (row) =>
        `<div class="trend-item"><div class="trend-item-k">${row.tag ? `<b>${esc(row.tag)}</b> ` : ''}${esc(row.stock)}</div><div class="trend-sub"><span>${esc(row.name)}</span><b class="${tone(row.netYi)}">${row.netYi.toFixed(2)}亿</b></div></div>`,
    )
    .join('');
  const lhbAdviceHtml = state.lhbAiError
    ? `<p class="trend-hot">${esc(state.lhbAiError)}</p>`
    : state.lhbAdvice
      ? `<div class="trend-ai-box">${reportArticleHtml(state.lhbAdvice)}<p class="trend-hint">上次龙虎榜解读 ${esc(formatAiTime(state.lhbAdvice.generatedAt))}（已并入上方「AI 解读盘况」）</p></div>`
      : '';
  const reviewRows = (sheet.review?.rows || [])
    .map(
      (row) =>
        `<div class="trend-item"><div class="trend-item-k">${esc(row.name)}</div><div class="trend-sub"><span>${esc(row.action)}</span><span>${pctText(row.changePct)}</span><b class="${tagCls(row.verdict)}">${esc(row.verdict)}</b></div></div>`,
    )
    .join('');
  const fut = sheet.futures;
  const hand = (n, signed = false) => {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Math.round(Number(n));
    return signed ? `${v > 0 ? '+' : ''}${v}` : String(v);
  };
  const futCls = (stance) =>
    /偏多|多单加得更多/.test(stance) ? 'text-up' : /偏空|空单加得更多|多单在减/.test(stance) ? 'text-down' : '';
  const futLine = (row) =>
    `<div class="trend-item">
      <div class="trend-item-k">${esc(row.house)}${row.client ? ' · 代客' : ''} · ${esc(row.productName)} ${esc(row.contract)}</div>
      <div class="trend-sub">
        <span>多 ${hand(row.longPos)}（${hand(row.longAdd, true)}）</span>
        <span>空 ${hand(row.shortPos)}（${hand(row.shortAdd, true)}）</span>
        <b class="${futCls(row.stance)}">${esc(row.stance)}</b>
      </div>
      ${row.hint ? `<p class="trend-hint">${esc(row.hint)}</p>` : ''}
    </div>`;
  const futRows = [...(fut?.indexRows || []), ...(fut?.commodityRows || [])];
  const futHtml = futRows.map(futLine).join('');
  const advice = state.trendAdvice;
  const adviceHtml = state.trendAiRunning
    ? '<p class="trend-empty">正在根据本页事实调用 AI…</p>'
    : state.trendAiError
      ? `<p class="trend-hot">${esc(state.trendAiError)}</p>`
      : advice
        ? `<div class="trend-ai-box">${reportArticleHtml(advice)}<p class="trend-hint">分析时间 ${esc(formatAiTime(advice.generatedAt))} · 仅手动触发</p></div>`
        : '<p class="trend-empty">本页只有 1 个 AI 按钮。点右上「AI 解读盘况」才会调用；刷新页面不会自动分析。</p>';
  const cal = marketCalendarFacts(new Date(), { indices: state.indices || [], center: state.center });
  const lhbToday = clock.today;
  const lhbDate = sheet.seatDate || '';
  const lhbPending = !lhbDate || lhbDate < lhbToday;
  const lhbBanner = lhbPending
    ? `<p class="trend-banner warn">今日龙虎榜通常在收盘后晚些才披露${
        lhbDate ? `；当前仍是 <b>${esc(lhbDate)}</b> 的数据` : '；东财还没有给出名单'
      }。可点刷新再试，未出时不要当作成交依据。</p>`
    : `<p class="trend-banner">以下为 <b>${esc(lhbDate)}</b> 收盘后披露的营业部净买入（亿元）。机构/北向/游资标签来自席位名称粗分，不是官方分类。</p>`;
  const lhbActions = `<div class="trend-card-actions">
      <button type="button" data-lhb-refresh class="trend-refresh-btn" ${state.lhbRefreshing || state.trendAiRunning ? 'disabled' : ''}>${state.lhbRefreshing ? '刷新中' : '刷新龙虎榜'}</button>
    </div>`;
  const pulseAiBtn = `<button type="button" data-trend-ai class="trend-ai-btn" ${state.trendAiRunning ? 'disabled' : ''}>${
    state.trendAiRunning ? '分析中' : advice ? '重新解读盘况' : 'AI 解读盘况'
  }</button>`;
  els.trendSheet.innerHTML = `
    <div class="trend-head">
      <div>
        <div class="trend-head-title">盘况 · 顺势</div>
        <div class="trend-head-meta">北京 ${esc(clock.beijing)} · 下一交易日 ${esc(clock.next)} · 美东 ${esc(clock.eastern)}</div>
      </div>
      <div class="trend-head-tags">
        <span class="trend-mood ${moodCls}">${esc(mood)}</span>
        ${sheet.tapeWeak ? '<span class="trend-hot">跌家占优</span>' : ''}
        ${pulseAiBtn}
      </div>
    </div>
    ${trendCard(
      '① 今日怎么看',
      `${trendPlanHtml(sheet.plan)}
      ${cal.lines.map((line) => `<p class="trend-summary-line">${highlightTrend(line)}</p>`).join('')}
      <div class="trend-metrics">
        <div><span>高度</span><b>${s?.height ?? '—'}板</b></div>
        <div><span>炸板率</span><b>${s?.zbRate == null ? '—' : `${Math.round(s.zbRate * 100)}%`}</b></div>
        <div><span>昨涨停溢价</span><b class="${tone(s?.premium)}">${s?.premium == null ? '—' : pctText(s.premium)}</b></div>
        <div><span>首板晋级</span><b>${s?.promoRate == null ? '—' : `${Math.round(s.promoRate * 100)}%`}</b></div>
      </div>
      <p class="trend-hint">高度看连板；炸板率高说明封不住；溢价为负说明昨板今天亏。</p>
      ${adviceHtml}`,
      '',
      'trend-summary',
    )}
    ${trendCard(
      `② 方向与资金 · 外盘 ${esc(clock.eastern)} → 大A ${esc(clock.next)}`,
      `${overnight || '<p class="trend-empty">外盘没有明显强于 1% 的方向。</p>'}
      <div class="trend-flow-label">主线</div>
      ${mains || '<p class="trend-empty">没有还在进的主题。</p>'}
      <div class="trend-flow-label">主题资金净流入</div><div class="trend-chips">${flowLine(inflow) || '—'}</div>
      <div class="trend-flow-label">净流出</div><div class="trend-chips">${flowLine(outflow) || '—'}</div>
      <p class="trend-hint">外盘只是线索；已标「不宜再追」的不要接力。</p>`,
    )}
    ${trendCard(
      `③ 席位 · 龙虎榜${lhbDate ? ` ${esc(lhbDate)}` : ''}${fut?.date ? ` · 期货 ${esc(fut.date)}` : ''}`,
      `${lhbBanner}
      ${seats || '<p class="trend-empty">名单未出或未取到。</p>'}
      ${lhbAdviceHtml}
      <div class="trend-flow-label">期货席位增减（手）</div>
      ${futHtml || '<p class="trend-empty">这天的期货席位还没出来。</p>'}
      <p class="trend-hint">代客=客户单；多空一起加更像对冲，不要当成单边看多。</p>`,
      lhbActions,
    )}
    ${trendCard(
      `④ 报告对照 · ${esc(sheet.review?.day || '还没有')} → ${esc(clock.today)}`,
      `${sheet.review?.summary ? `<p class="trend-summary-line">${highlightTrend(sheet.review.summary)}</p>` : '<p class="trend-empty">还没有可对照的报告。</p>'}${reviewRows}`,
    )}
    <p class="trend-foot">公开数据粗判，不构成投资建议。AI 不会自动跑，只有你点「AI 解读盘况」或顶部「大盘分析」。</p>`;
}

function marketFacts(extra = '') {
  const clock = marketClock();
  const calendar = marketCalendarFacts(new Date(), {
    indices: state.indices || [],
    center: state.center,
  });
  return buildMarketFacts({
    indices: state.indices || [],
    center: state.center,
    boards: (state.pulseBoards?.CN || []).filter((b) => Number.isFinite(Number(b.changePct))),
    tape: judgeTape(state.center)?.label || '',
    prior: priorContext((r) => r.kind === 'market'),
    sheet: state.trend?.brief || '',
    clock: `${clock.line}${extra}`,
    calendar: calendar.text,
  });
}

function slotNote(slot) {
  if (!slot) return '';
  return `\n这一档是${slot.label}。开盘看开盘这段怎么走，盘中看上午的方向还在不在，尾盘看收盘前持仓过不过夜。`;
}

async function runTrendAi(opts = {}) {
  if (opts.auto) return false; // 禁止自动调用
  if (state.trendAiRunning) return false;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return false;
  if (!state.trend) await loadTrendSheet();
  state.trendAiRunning = true;
  state.trendAiError = '';
  renderTrend();
  try {
    // 解读前尽量刷新龙虎榜，未出则在 facts 里照实写
    await refreshLhbSeats().catch(() => false);
    const clock = marketClock();
    const lhbNote =
      state.trend?.seatDate && state.trend.seatDate < clock.today
        ? `\n龙虎榜说明：今日名单可能尚未披露，当前本机数据日期为 ${state.trend.seatDate}。`
        : state.trend?.seats?.length
          ? `\n龙虎榜本机已拉到 ${state.trend.seatDate}，共 ${state.trend.seats.length} 条营业部净买入。`
          : '\n龙虎榜：本机未取到名单。';
    const report = await askMarketReport(
      apiKey,
      marketFacts(`${slotNote(opts.slot)}${lhbNote}`),
      state.settings?.aiModel,
    );
    state.trendAdvice = await pushReport({
      ...report,
      kind: 'market',
      title: `盘况解读 ${clock.beijing}`,
      itemKey: '',
      code: '',
      sessionDay: clock.today,
    });
    return true;
  } catch (e) {
    console.error(e);
    state.trendAiError = String(e?.message || e || '分析失败');
    if (/401|invalid|api key|密钥/i.test(state.trendAiError)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
    return false;
  } finally {
    state.trendAiRunning = false;
    renderTrend();
  }
}

async function runFuturesAi(opts = {}) {
  if (state.futAiRunning) return false;
  const seats = state.trend?.futures;
  const rows = [...(seats?.indexRows || []), ...(seats?.commodityRows || [])];
  if (!rows.length) {
    if (!opts.auto) {
      state.futAiError = '席位还没取到，先点右上角刷新。';
      renderTrend();
    }
    return false;
  }
  const apiKey = opts.auto ? String(state.settings?.deepseekApiKey || '').trim() : await ensureDeepseekKey();
  if (!apiKey) return false;
  state.futAiRunning = true;
  state.futAiError = '';
  renderTrend();
  try {
    const clock = marketClock();
    const report = await askSeatReport(
      apiKey,
      buildSeatFacts({ seats, clock: `${clock.line}${slotNote(opts.slot)}` }),
      state.settings?.aiModel,
    );
    state.futAdvice = await pushReport({
      ...report,
      title: opts.slot ? `期货席位 ${opts.day} ${opts.slot.label}` : `期货席位 ${seats.date || clock.today} 手动`,
      itemKey: '',
      code: '',
      slot: opts.slot?.id || '',
      sessionDay: opts.day || clock.today,
    });
    return true;
  } catch (e) {
    console.error(e);
    state.futAiError = String(e?.message || e || '分析失败');
    if (/401|invalid|api key|密钥/i.test(state.futAiError)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
    return false;
  } finally {
    state.futAiRunning = false;
    renderTrend();
  }
}

/** 只刷新盘况龙虎榜席位（东财），不整页重算顺势 */
async function refreshLhbSeats() {
  if (state.lhbRefreshing) return false;
  state.lhbRefreshing = true;
  state.lhbAiError = '';
  renderTrend();
  try {
    const data = await fetchSeatHighlights(10);
    if (!state.trend) state.trend = {};
    state.trend.seats = data?.rows || [];
    state.trend.seatDate = data?.date || '';
    if (!(state.trend.seats || []).length) {
      state.lhbAiError = '东财还没给出这一天的龙虎榜席位。';
      return false;
    }
    return true;
  } catch (e) {
    console.error(e);
    state.lhbAiError = String(e?.message || e || '龙虎榜刷新失败');
    return false;
  } finally {
    state.lhbRefreshing = false;
    renderTrend();
  }
}

/** 先拉最新龙虎榜，再用 DeepSeek 解读本机事实 */
async function runLhbAi() {
  if (state.lhbAiRunning) return false;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return false;
  state.lhbAiRunning = true;
  state.lhbAiError = '';
  renderTrend();
  try {
    const ok = await refreshLhbSeats();
    const rows = state.trend?.seats || [];
    if (!ok || !rows.length) {
      if (!state.lhbAiError) state.lhbAiError = '没有龙虎榜数据，无法分析。';
      return false;
    }
    const clock = marketClock();
    const report = await askLhbReport(
      apiKey,
      buildLhbFacts({
        date: state.trend?.seatDate || '',
        rows,
        clock: clock.line,
      }),
      state.settings?.aiModel,
    );
    state.lhbAdvice = await pushReport({
      ...report,
      title: `龙虎榜 ${state.trend?.seatDate || clock.today} 手动`,
      itemKey: '',
      code: '',
      sessionDay: clock.today,
    });
    return true;
  } catch (e) {
    console.error(e);
    state.lhbAiError = String(e?.message || e || '分析失败');
    if (/401|invalid|api key|密钥/i.test(state.lhbAiError)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
    return false;
  } finally {
    state.lhbAiRunning = false;
    renderTrend();
  }
}

function hydrateSessionReports() {
  if (!state.trendAdvice) {
    const hit = reportHistory().find((r) => r.kind === 'market');
    if (hit) state.trendAdvice = hit;
  }
  if (!state.futAdvice) {
    const hit = reportHistory().find((r) => r.kind === 'seat');
    if (hit) state.futAdvice = hit;
  }
  if (!state.lhbAdvice) {
    const hit = reportHistory().find((r) => r.kind === 'lhb');
    if (hit) state.lhbAdvice = hit;
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function loadTrendSheet(force = false) {
  if (state.trendTask) return state.trendTask;
  if (!force && state.trend && Date.now() - state.trendAt < 90000) {
    renderTrend();
    return;
  }
  state.trendLoading = true;
  if (!state.trend) renderTrend();
  state.trendTask = (async () => {
  try {
    const alive = (list) => (list || []).some((b) => Math.abs(Number(b.changePct)) >= 0.05);
    if (!alive(state.pulseBoards?.CN) || !alive(state.pulseBoards?.US)) await refreshPulse();
    const [sentiment, themes, seats, futures] = await Promise.all([
      fetchLimitSentiment().catch(() => null),
      fetchTrackedFlows(CN_PULSE_BOARDS).catch(() => []),
      fetchSeatHighlights(6).catch(() => ({ date: '', rows: [] })),
      fetchFuturesSeatMoves().catch(() => ({ date: '', indexRows: [], commodityRows: [] })),
    ]);
    const cnByName = new Map((state.pulseBoards?.CN || []).filter((b) => b.code).map((b) => [b.name, b]));
    const today = shYmd();
    const abroadNames = new Set(
      [...(state.pulseBoards?.US || []), ...(state.pulseBoards?.KR || [])]
        .filter((b) => Number(b.changePct) >= 1)
        .map((b) => b.name),
    );
    const codes = new Map();
    const flowWatch = [...themes].sort((a, b) => Math.abs(b.mainFlow) - Math.abs(a.mainFlow)).slice(0, 8);
    const changeWatch = [...themes].sort((a, b) => Number(b.changePct) - Number(a.changePct)).slice(0, 4);
    for (const row of [...flowWatch, ...changeWatch]) {
      if (row.code) codes.set(row.code, row.name);
    }
    for (const [name, board] of cnByName) {
      const linked = OVERNIGHT_LINKS.some((item) => abroadNames.has(item.from) && item.to.includes(name));
      if (!linked || !board.code) continue;
      codes.set(board.code, name);
    }
    const codeList = [...codes.keys()].slice(0, 16);
    const klines = new Map();
    const bars = await mapPool(codeList, 2, async (code) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const data = await fetchKline(`90.${code}`, 101, 6).catch(() => null);
        if (data?.points?.length) return [code, data.points];
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return [code, []];
    });
    for (const pair of bars) {
      if (pair) klines.set(pair[0], pair[1]);
    }
    const overnight = buildOvernight(state.pulseBoards?.US, state.pulseBoards?.KR, cnByName, klines, today);
    const mains = scoreMainLines({ industry: themes, concept: [] }, klines, new Map(), today);
    await Promise.all(
      mains.map(async (row) => {
        const list = await fetchBoardLeaders(row.code, 1).catch(() => []);
        if (!list[0]) return;
        row.leader = list[0].name;
        row.leaderPct = list[0].changePct;
        row.leaderCode = list[0].code || '';
      }),
    );
    const tape = judgeTape(state.center);
    const tapeWeak = tape?.label === '宜等';
    const mood = moodLabel(sentiment);
    const review = reviewCalls(reportHistory(), trendChanges());
    const flows = { themes };
    const plan = planText({ tapeWeak, mood, overnight, mains });
    state.trend = {
      sentiment,
      mood,
      tapeWeak,
      overnight,
      mains,
      flows,
      seats: seats.rows,
      seatDate: seats.date,
      futures,
      review,
      plan,
      brief: sheetBrief({ tapeWeak, mood, overnight, mains, sentiment, flows, seats: futures }),
    };
    state.trendAt = Date.now();
  } catch (e) {
    console.error(e);
  } finally {
    state.trendLoading = false;
    state.trendTask = null;
    hydrateSessionReports();
    renderTrend();
    renderStrategyDesk();
  }
  })();
  return state.trendTask;
}

async function refreshQuotes() {
  if (!state.list.length) {
    state.quotes = {};
    renderList();
    return;
  }
  const stocks = state.list.filter((x) => x.kind === 'stock');
  const funds = state.list.filter((x) => x.kind === 'fund');

  // 股票先出结果，不被基金备用源拖慢
  if (stocks.length) {
    try {
      const stockMap = await fetchQuotes(stocks);
      state.quotes = { ...state.quotes, ...stockMap };
      state.lastUpdated = Date.now();
      renderList();
      renderStatus();
    } catch (e) {
      console.error(e);
    }
  }

  if (funds.length) {
    try {
      const fundMap = await fetchQuotes(funds);
      state.quotes = { ...state.quotes, ...fundMap };
      // 用正确编码的行情名修复本地已乱码的基金名
      let nameFixed = false;
      const nextList = state.list.map((item) => {
        if (item.kind !== 'fund') return item;
        const q = fundMap[`fund:FUND:${String(item.code).padStart(6, '0')}`];
        const good = preferDisplayName(q?.name, item.name);
        if (good && good !== item.name) {
          nameFixed = true;
          return { ...item, name: good };
        }
        return item;
      });
      if (nameFixed) {
        state.list = nextList;
        await setWatchlist(nextList);
      }
      state.lastUpdated = Date.now();
      renderList();
      renderStatus();
      if (state.briefOpen && state.briefTab === 'insight') renderBriefBody();
    } catch (e) {
      console.error(e);
    }
  } else if (state.briefOpen && state.briefTab === 'insight') {
    renderBriefBody();
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderEventBanner() {
  if (!els.eventBanner) return;
  const today = todayStr();
  if (state.settings?.eventBannerDismissDate === today) {
    els.eventBanner.classList.add('hidden');
  } else {
    const todays = getTodayEvents();
    if (todays.length) {
      els.eventBanner.classList.remove('hidden');
      els.eventBannerText.innerHTML = todays
        .map(
          (e) =>
            `<strong>${esc(e.title)}</strong> — ${esc(e.tip)}${e.impact ? `；影响：${esc(e.impact.slice(0, 48))}…` : ''}`,
        )
        .join(' · ');
    } else {
      const next = getUpcomingEvents(new Date(), 7)[0];
      if (next) {
        els.eventBanner.classList.remove('hidden');
        els.eventBannerText.innerHTML = `下一重要窗口 <strong>${esc(next.date)}</strong> ${esc(next.title)} — ${esc(next.tip)}`;
      } else {
        els.eventBanner.classList.add('hidden');
      }
    }
  }
  renderEventPanel();
}

function renderEventPanel() {
  if (!els.eventPanel) return;
  if (!state.eventPanelOpen) {
    els.eventPanel.classList.add('hidden');
    els.eventPanel.innerHTML = '';
    return;
  }
  const events = getMajorUpcomingEvents(new Date(), 21);
  const today = todayStr();
  els.eventPanel.classList.remove('hidden');
  els.eventPanel.innerHTML = `
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-sm font-semibold">近三周 · 重大日历</div>
      <button type="button" id="event-panel-close" class="rounded-md p-1" style="color:var(--muted)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="space-y-1.5">
      ${
        events.length
          ? events
              .map((e) => {
                const isToday = e.date === today;
                const typeColor =
                  e.type === 'cpi'
                    ? 'var(--up)'
                    : e.type === 'nfp'
                      ? '#b45309'
                      : 'var(--accent)';
                return `<div class="flex items-start gap-2 rounded-lg px-2 py-1.5 ${isToday ? 'ring-soft' : ''}" style="${isToday ? 'background:color-mix(in oklab,var(--accent) 8%,transparent)' : ''}">
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="color:${typeColor};background:color-mix(in oklab,${typeColor} 12%,transparent)">${e.type.toUpperCase()}</span>
                  <div class="min-w-0 flex-1">
                    <div class="text-[12px] font-semibold">${esc(e.date)} ${esc(e.title)}${isToday ? ' · 今日' : ''}</div>
                    <div class="text-[11px]" style="color:var(--muted)">${esc(e.tip)}</div>
                    ${e.impact ? `<div class="mt-0.5 text-[11px] leading-snug"><span class="font-semibold text-accent">影响：</span>${esc(e.impact)}</div>` : ''}
                  </div>
                </div>`;
              })
              .join('')
          : '<p class="text-[12px]" style="color:var(--muted)">近三周暂无预设事件</p>'
      }
    </div>
    <p class="mt-2 text-[10px]" style="color:var(--muted)">CPI 日期为常用区间近似，请以美国劳工部/美联储官网为准。仅供风控提示。</p>`;
  $('event-panel-close')?.addEventListener('click', () => {
    state.eventPanelOpen = false;
    renderEventPanel();
  });
}

async function refreshAll() {
  state.loading = true;
  renderStatus();
  els.refreshBtn.classList.add('animate-spin');
  try {
    const tasks = [refreshIndices(), refreshQuotes(), loadTrendSheet()];
    if (state.view === 'pulse') tasks.push(refreshPulse());
    await Promise.all(tasks);
    if (state.view === 'data') {
      await Promise.all([loadDataCenter(), loadBoards(), loadRank()]);
    }
    if (state.detail && state.period !== 'week' && state.period !== 'month') {
      if (state.detail.kind === 'fund') await openDetail(state.detail);
      else await refreshDetailCharts();
    }
  } catch (e) {
    console.error(e);
  } finally {
    state.loading = false;
    els.refreshBtn.classList.remove('animate-spin');
    renderStatus();
  }
}

async function applyImportedBundle(bundle) {
  const next = {
    ...bundle,
    groups: (bundle.groups || []).map((g) => ({
      ...g,
      name: GROUP_NAME_FIX[g.name] || g.name,
    })),
  };
  const result = await importUserBundle(next);
  state.list = result.list;
  state.settings = result.settings;
  return result;
}

async function setSort(sortBy) {
  state.settings = await saveSettings({ sortBy });
  renderList();
}

async function renameGroup(gid) {
  const g = (state.settings.groups || []).find((x) => x.id === gid);
  if (!g) return;
  const canDelete = gid !== 'other';
  const ok = await openDialog({
    title: '修改分组',
    bodyHtml: `<input id="dlg-group-name" class="glass w-full rounded-lg px-3 py-2 text-sm outline-none" value="${escAttr(g.name)}" />
      ${
        canDelete
          ? `<label class="mt-3 flex items-center gap-2 text-[12px]" style="color:var(--up)">
        <input id="dlg-group-del" type="checkbox" /> 删除此分组（勾选后点确定）
      </label>
      <p class="mt-1 text-[10px]" style="color:var(--muted)">删除后持仓将移到「其他」。</p>`
          : `<p class="mt-2 text-[10px]" style="color:var(--muted)">「其他」为默认分组，不可删除。</p>`
      }`,
  });
  if (!ok) return;
  const snap = state.dialogSnapshot || {};
  const shouldDelete = !!snap['dlg-group-del'];
  const name = String(snap['dlg-group-name'] || '').trim();
  if (shouldDelete) {
    await deleteGroup(gid, { skipConfirm: true });
    return;
  }
  if (!name || name === g.name) return;
  const groups = (state.settings.groups || []).map((x) => (x.id === gid ? { ...x, name } : x));
  state.settings = await saveSettings({ groups });
  renderGroupTabs();
  renderList();
}

async function addGroupDialog() {
  const ok = await openDialog({
    title: '新建分组',
    bodyHtml: `<input id="dlg-new-group" class="glass w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="分组名称" autofocus />
      <p class="mt-2 text-[10px]" style="color:var(--muted)">创建后可拖拽排序；双击标签可改名或删除。</p>`,
  });
  if (!ok) return;
  const name = String(state.dialogSnapshot?.['dlg-new-group'] || '').trim();
  if (!name) {
    els.statusText.textContent = '分组名不能为空';
    return;
  }
  if ((state.settings.groups || []).some((g) => g.name === name)) {
    els.statusText.textContent = '已有同名分组';
    return;
  }
  const id = `g_${Date.now().toString(36)}`;
  const groups = [...(state.settings.groups || []), { id, name }];
  state.settings = await saveSettings({ groups });
  state.secondaryGroup = id;
  rememberPlace();
  renderGroupTabs();
  renderList();
  els.statusText.textContent = `已创建分组「${name}」`;
}

async function deleteGroup(gid, { skipConfirm = false } = {}) {
  if (!gid || gid === 'other') return;
  const g = (state.settings.groups || []).find((x) => x.id === gid);
  if (!g) return;
  const count = state.list.filter((x) => (x.groupId || 'other') === gid).length;
  if (!skipConfirm) {
    const ok = await confirmDialog(
      '删除分组',
      count
        ? `「${displayGroupName(g.name)}」内有 ${count} 只，删除后将移到「其他」。继续？`
        : `确定删除「${displayGroupName(g.name)}」吗？`,
    );
    if (!ok) return;
  }
  let groups = (state.settings.groups || []).filter((x) => x.id !== gid);
  if (!groups.some((x) => x.id === 'other')) {
    groups.unshift({ id: 'other', name: '其他' });
  }
  const nextList = state.list.map((item) =>
    (item.groupId || 'other') === gid ? { ...item, groupId: 'other' } : item,
  );
  await setWatchlist(nextList);
  state.list = nextList;
  state.settings = await saveSettings({ groups });
  if (state.secondaryGroup === gid) state.secondaryGroup = 'all';
  rememberPlace();
  renderGroupTabs();
  renderList();
  els.statusText.textContent = `已删除分组「${displayGroupName(g.name)}」`;
}

async function moveItemGroup(item) {
  const groups = groupsForPrimary();
  const ok = await openDialog({
    title: `移动「${item.name || item.code}」`,
    bodyHtml: `<div class="group-pick">${groups
      .map(
        (g) => `<label class="group-pick-item">
        <input type="radio" name="move-gid" value="${escAttr(g.id)}" ${(item.groupId || 'other') === g.id ? 'checked' : ''} />
        <span>${esc(g.displayName)}</span>
      </label>`,
      )
      .join('')}</div>`,
  });
  if (!ok) return;
  const picked = els.dialogBody.querySelector('input[name="move-gid"]:checked')?.value;
  if (!picked) return;
  state.list = await updateItem(item, { groupId: picked });
  renderGroupTabs();
  renderList();
}

async function pickIndicesDialog() {
  const selected = new Set(
    (state.settings.indices || []).map((x) => x.secid || toSecid(x.market, x.code, x.marketNo)),
  );
  const groups = [
    { title: 'A股宽基', test: (p) => ['沪', '深', '京'].includes(p.label) && p.code !== '518880' },
    { title: '港股', test: (p) => p.label === '港' },
    { title: '美股', test: (p) => p.label === '美' },
    { title: '亚太', test: (p) => p.label === '日' || p.label === '韩' },
    { title: '商品', test: (p) => p.label === '期' },
  ];
  const body = groups
    .map((g) => {
      const rows = INDEX_PRESETS.filter(g.test);
      if (!rows.length) return '';
      return `<div class="mb-2">
        <div class="mb-1 text-[11px] font-semibold" style="color:var(--muted)">${esc(g.title)}</div>
        <div class="grid grid-cols-2 gap-1.5">
          ${rows
            .map((p) => {
              const sid = p.secid;
              return `<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-soft">
                <input type="checkbox" data-secid="${escAttr(sid)}" ${selected.has(sid) ? 'checked' : ''} />
                <span class="truncate">${esc(p.name)}</span>
              </label>`;
            })
            .join('')}
        </div>
      </div>`;
    })
    .join('');
  const ok = await openDialog({
    title: '勾选大盘指数',
    bodyHtml: `<div class="max-h-[min(420px,60vh)] overflow-auto pr-0.5">${body}</div>
    <p class="mt-2 text-[10px]" style="color:var(--muted)">仅可选宽基指数/商品，概念板块请到「盘况」查看</p>`,
  });
  if (!ok) return;
  const next = [];
  const seen = new Set();
  els.dialogBody.querySelectorAll('input[data-secid]').forEach((input) => {
    if (!input.checked) return;
    const sid = input.getAttribute('data-secid');
    if (!sid || seen.has(sid)) return;
    seen.add(sid);
    const preset = INDEX_PRESETS.find((p) => p.secid === sid);
    if (preset) next.push({ ...preset });
  });
  const order = (state.settings.indices || []).map(
    (x) => x.secid || toSecid(x.market, x.code, x.marketNo),
  );
  next.sort((a, b) => {
    const ai = order.indexOf(a.secid);
    const bi = order.indexOf(b.secid);
    if (ai < 0 && bi < 0) return 0;
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
  state.settings = await saveSettings({ indices: next });
  await refreshIndices();
}

function buildBriefInsightHtml() {
  const idx = state.indices || [];
  const sh = idx.find((x) => x.code === '000001');
  const sz = idx.find((x) => x.code === '399001');
  const cy = idx.find((x) => x.code === '399006');
  const ndx = idx.find((x) => /^NDX/i.test(x.code) || /纳斯达克/.test(x.name || ''));
  const ks = idx.find((x) => /^KS11/i.test(x.code) || /KOSPI|韩国/.test(x.name || ''));

  const marketBits = [];
  if (sh) marketBits.push(`上证 ${fmtPct(sh.changePct)}`);
  if (sz) marketBits.push(`深证 ${fmtPct(sz.changePct)}`);
  if (cy) marketBits.push(`创业板 ${fmtPct(cy.changePct)}`);
  if (ndx) marketBits.push(`纳指100 ${fmtPct(ndx.changePct)}`);
  if (ks) marketBits.push(`韩国 ${fmtPct(ks.changePct)}`);

  const zd = state.center?.updown;
  const ov = state.center?.overview;
  const upCnt = zd?.up ?? ov?.up ?? '—';
  const downCnt = zd?.down ?? ov?.down ?? '—';

  const news = state.insightNews || [];
  const tech = (state.techLeaders || []).filter((t) => Number.isFinite(Number(t.changePct)));
  const tips = [];
  const mktList = [sh, sz, cy].filter(Boolean);
  const mktAvg =
    mktList.reduce((s, x) => s + (Number(x.changePct) || 0), 0) / Math.max(1, mktList.length);

  if (mktAvg > 0.5) tips.push('主要指数偏强，风险偏好尚可，注意追高风险。');
  else if (mktAvg < -0.5) tips.push('主要指数偏弱，宜控制仓位、重视止损。');
  else tips.push('指数震荡，宜按计划分批，少追涨杀跌。');

  if (ndx && Number.isFinite(Number(ndx.changePct))) {
    if (ndx.changePct >= 1.2) tips.push(`纳斯达克100偏强（${fmtPct(ndx.changePct)}），隔夜情绪利好成长/科技联动。`);
    else if (ndx.changePct <= -1.2) tips.push(`纳斯达克100偏弱（${fmtPct(ndx.changePct)}），A 股科技开盘宜更谨慎。`);
  }
  if (ks && Number.isFinite(Number(ks.changePct))) {
    if (ks.changePct >= 1) tips.push(`韩国KOSPI偏强（${fmtPct(ks.changePct)}），留意半导体/存储链条情绪。`);
    else if (ks.changePct <= -1) tips.push(`韩国KOSPI偏弱（${fmtPct(ks.changePct)}），相关映射股注意波动。`);
  }

  const techStrong = [...tech].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
  if (techStrong.length) {
    const soft = techStrong.filter((t) => t.changePct <= -2).map((t) => t.name);
    const hot = techStrong.filter((t) => t.changePct >= 2).map((t) => t.name);
    if (hot.length) tips.push(`科技龙头偏强：${hot.join('、')}，相关主题可关注联动，忌追高。`);
    if (soft.length) tips.push(`科技龙头偏弱：${soft.join('、')}，留意风险偏好与估值波动。`);
  }
  if (news.some((n) => MACRO_HINT.test(n.title) || n.source === 'index-spike')) {
    tips.push('有宏观重磅或指数急拉急跌提醒，仓位宜更谨慎，等落地后再加大动作。');
  }

  const techHtml = tech.length
    ? `<div class="mb-2">
        <div class="mb-1 text-[11px] font-semibold" style="color:var(--muted)">科技龙头</div>
        <div class="flex flex-wrap gap-1.5 text-[11px]">
          ${tech
            .map(
              (t) =>
                `<span class="rounded-md px-1.5 py-0.5 ring-soft tabular-nums"><span style="opacity:.75">${esc(t.name)}</span> <span class="${tone(t.changePct)}">${fmtPct(t.changePct)}</span></span>`,
            )
            .join('')}
        </div>
      </div>`
    : '';

  const reports = Object.entries(state.settings?.aiReports || {})
    .map(([key, report]) => {
      const item = state.list.find((x) => itemKey(x) === key);
      if (!item || !report) return '';
      const cls = report.action === '买入' ? 'text-up' : report.action === '不买' ? 'text-down' : '';
      return `<div class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ring-soft">
        <span class="min-w-0 truncate text-[12px]">${esc(item.name || item.code)}</span>
        <span class="shrink-0 text-[12px] font-semibold ${cls}">${esc(report.action)} · 买${report.buyProb ?? 0}%</span>
      </div>`;
    })
    .filter(Boolean)
    .slice(0, 8)
    .join('');

  return `
    <div class="mb-2">
      <div class="text-sm font-semibold">今日操作台</div>
      <div class="text-[10px]" style="color:var(--muted)">${marketBits.join(' · ') || '大盘加载中'} · 个股结论以列表 AI 报告为准</div>
    </div>
    <div class="mb-2 rounded-lg px-2.5 py-2 text-[12px] leading-relaxed" style="background:color-mix(in oklab,var(--accent) 8%,transparent)">
      大A个人做法：只做主力净流入且估值不高的票；已大涨不追；单票轻仓；先写止损再买。列表点 <b>AI</b> 出报告，再点股票看买 / 不买 / 继续等。
    </div>
    ${
      reports
        ? `<div class="mb-2"><div class="mb-1 text-[11px] font-semibold" style="color:var(--muted)">已分析的自选</div><div class="grid gap-1">${reports}</div></div>`
        : `<p class="mb-2 text-[12px]" style="color:var(--muted)">还没有个股报告。回到自选，点股票右侧 AI。</p>`
    }
    <div class="mb-2 grid grid-cols-2 gap-1.5">
      <div class="rounded-lg px-2 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">全市场上涨</div><div class="text-sm font-semibold text-up">${upCnt}</div></div>
      <div class="rounded-lg px-2 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">全市场下跌</div><div class="text-sm font-semibold text-down">${downCnt}</div></div>
    </div>
    ${techHtml}
    <ul class="space-y-1 text-[12px] leading-relaxed">
      ${tips.map((t) => `<li class="pl-2" style="border-left:2px solid var(--accent)">${esc(t)}</li>`).join('')}
    </ul>
    <p class="mt-2 text-[10px]" style="color:var(--muted)">消息与行情仅供参考，不构成投资建议。板块涨跌见顶部「盘况」。</p>`;
}

function formatNewsTime(t) {
  if (!t) return '';
  const s = String(t).trim();
  const parsed = Date.parse(s.replace(/-/g, '/'));
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  }
  const m = s.match(/(\d{1,2})[-/月](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mm = String(m[1]).padStart(2, '0');
    const dd = String(m[2]).padStart(2, '0');
    const hh = m[3] != null ? String(m[3]).padStart(2, '0') : '00';
    const mi = m[4] != null ? m[4] : '00';
    return `${mm}-${dd} ${hh}:${mi}`;
  }
  return s.slice(0, 16);
}

function newsItemMajorClass(n) {
  if (n.major) return true;
  if (n.score != null && n.score >= 6) return true;
  const title = n.title || '';
  if (MACRO_HINT.test(title)) return true;
  if (/重磅|突发|紧急|暴跌|暴涨|熔断|制裁|关税/.test(title)) return true;
  return false;
}

function renderBriefNewsHtml() {
  const news = visibleNews();
  if (!news.length) {
    return '<p class="text-sm" style="color:var(--muted)">暂无重大消息</p>';
  }
  return news
    .map((n) => {
      const major = newsItemMajorClass(n);
      const tag =
        n.tone === 'up'
          ? '<span class="tag" style="background:color-mix(in oklab,var(--up) 14%,transparent);color:var(--up)">利好倾向</span>'
          : n.tone === 'down'
            ? '<span class="tag" style="background:color-mix(in oklab,var(--down) 14%,transparent);color:var(--down)">利空倾向</span>'
            : '<span class="tag" style="background:color-mix(in oklab,var(--muted) 14%,transparent);color:var(--muted)">关注</span>';
      const body = n.url
        ? `<a href="${escAttr(n.url)}" target="_blank" rel="noreferrer" class="hover:underline">${esc(n.title)}</a>`
        : esc(n.title);
      return `<div class="news-item${major ? ' major' : ''}" data-news-id="${escAttr(n.id)}">
        <div class="mb-1 flex items-start justify-between gap-1">
          <div class="min-w-0 flex-1">${tag}${body}</div>
          <button type="button" data-dismiss-news="${escAttr(n.id)}" class="shrink-0 rounded px-1 text-[11px]" style="color:var(--muted)" title="不再显示">×</button>
        </div>
        ${n.impact ? `<div class="mb-1 text-[11px] leading-snug" style="color:var(--muted)"><span class="font-semibold text-accent">影响：</span>${esc(n.impact)}</div>` : ''}
        ${n.time ? `<div class="text-[10px]" style="color:var(--muted)">${esc(formatNewsTime(n.time))}</div>` : ''}
      </div>`;
    })
    .join('');
}

function renderBriefCalendarHtml() {
  const events = getMajorUpcomingEvents(new Date(), 21);
  const today = todayStr();
  if (!events.length) {
    return '<p class="text-sm" style="color:var(--muted)">近三周暂无重大宏观事件</p>';
  }
  return `<div class="mb-1.5 text-[11px] font-semibold" style="color:var(--muted)">近三周 · 重大日历</div>
  <div class="space-y-1.5">
    ${events
      .map((e) => {
        const isToday = e.date === today || e.status === 'today';
        const released = e.status === 'released' || (e.date && e.date < today);
        const typeColor =
          e.type === 'cpi' ? 'var(--up)' : e.type === 'nfp' ? '#b45309' : 'var(--accent)';
        const statusLabel = released ? '已公布' : isToday ? '今日公布' : '待公布';
        const statusColor = released ? 'var(--muted)' : isToday ? 'var(--accent)' : 'var(--down)';
        return `<div class="flex items-start gap-2 rounded-lg px-2.5 py-2 ${isToday ? 'ring-soft' : ''}" style="${isToday ? 'background:color-mix(in oklab,var(--accent) 8%,transparent)' : ''}">
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="color:${typeColor};background:color-mix(in oklab,${typeColor} 12%,transparent)">${e.type.toUpperCase()}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[13px] font-semibold">${esc(e.date)} ${esc(e.title)}</span>
              <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold" style="color:${statusColor};background:color-mix(in oklab,${statusColor} 12%,transparent)">${statusLabel}</span>
            </div>
            <div class="text-[11px]" style="color:var(--muted)">${esc(e.tip)}</div>
            ${e.outcome ? `<div class="mt-0.5 text-[11px] leading-snug"><span class="font-semibold" style="color:${statusColor}">结果：</span>${esc(e.outcome)}</div>` : ''}
            ${e.impact ? `<div class="mt-0.5 text-[11px] leading-snug"><span class="font-semibold text-accent">影响：</span>${esc(e.impact)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}
  </div>
  <p class="mt-2 text-[10px]" style="color:var(--muted)">近三周重大窗口（非农 / CPI / FOMC）。已公布条目给出结果解读与影响；具体数字请以官网为准。</p>`;
}

function syncBriefTabButtons() {
  document.querySelectorAll('.brief-tab').forEach((btn) => {
    const on = btn.dataset.briefTab === state.briefTab;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
}

function renderBriefBody() {
  if (!els.briefBody) return;
  syncBriefTabButtons();
  if (state.briefTab === 'insight') {
    els.briefBody.innerHTML = buildBriefInsightHtml();
  } else if (state.briefTab === 'news') {
    els.briefBody.innerHTML = renderBriefNewsHtml();
    els.briefBody.querySelectorAll('[data-dismiss-news]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-dismiss-news');
        const dismissedNewsIds = [...new Set([...(state.settings.dismissedNewsIds || []), id])].slice(
          -40,
        );
        state.settings = await saveSettings({ dismissedNewsIds });
        renderBriefBody();
        syncBriefUnreadUi();
      });
    });
  } else {
    els.briefBody.innerHTML = renderBriefCalendarHtml();
  }
}

async function ensureBriefInsightData() {
  try {
    const [, tech] = await Promise.all([refreshIndices(), fetchTechLeaders()]);
    state.techLeaders = tech || [];
    if (!state.center?.updown) await loadDataCenter();
  } catch {
    /* use cached */
  }
}

async function openBrief(tab = 'insight') {
  state.briefOpen = true;
  state.briefTab = tab;
  state.insightOpen = tab === 'insight';
  state.eventPanelOpen = tab === 'calendar';
  els.briefRoot?.classList.remove('hidden');
  els.briefRoot?.classList.add('flex');
  await markNewsRead();
  syncBriefUnreadUi();
  if (tab === 'insight') {
    els.briefBody.innerHTML =
      '<div class="text-sm" style="color:var(--muted)">正在拉取大盘与科技龙头…</div>';
    await ensureBriefInsightData();
  }
  renderBriefBody();
  if (tab === 'news') refreshMajorNews(false);
}

function closeBrief() {
  state.briefOpen = false;
  state.insightOpen = false;
  state.eventPanelOpen = false;
  els.briefRoot?.classList.add('hidden');
  els.briefRoot?.classList.remove('flex');
}

function exportWatchlistJson() {
  const s = state.settings || {};
  const watchlist = (state.list || []).map((item) => {
    const q = state.quotes[quoteKey(item)] || {};
    const live = Number(q.price);
    const lots = parseLots(item.lots ?? item.markPrice);
    const { markPrice: _drop, ...rest } = item;
    return {
      ...rest,
      lots: lots ?? null,
      livePrice: Number.isFinite(live) ? live : item.livePrice ?? null,
    };
  });
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    groups: s.groups || [],
    watchlist,
    indices: s.indices || [],
    settings: {
      theme: s.theme,
      sortBy: s.sortBy,
      chartAxisMode: s.chartAxisMode,
      funFlowNames: s.funFlowNames,
      predictOpen: s.predictOpen,
      lastView: s.lastView,
      lastPrimary: s.lastPrimary,
      lastGroup: s.lastGroup,
      mobileGroupsExpanded: s.mobileGroupsExpanded,
      aiModel: s.aiModel,
      aiHistory: s.aiHistory || [],
      aiReports: s.aiReports || {},
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genius-trader-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function visibleNews() {
  const dismissed = new Set(state.settings?.dismissedNewsIds || []);
  return (state.insightNews || []).filter((n) => !dismissed.has(n.id));
}

function unreadNewsCount() {
  const read = new Set(state.settings?.readNewsIds || []);
  return visibleNews().filter((n) => !read.has(n.id)).length;
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function syncBriefUnreadUi() {
  const n = unreadNewsCount();
  const show = !state.briefOpen && n > 0;
  if (els.newsBadge) {
    if (show) {
      els.newsBadge.classList.remove('hidden');
      els.newsBadge.textContent = String(n > 9 ? '9+' : n);
    } else {
      els.newsBadge.classList.add('hidden');
    }
  }
  els.newsDot?.classList.toggle('hidden', !show);
}

async function markNewsRead() {
  const ids = visibleNews().map((n) => n.id);
  const readNewsIds = [...new Set([...(state.settings?.readNewsIds || []), ...ids])].slice(-80);
  state.settings = await saveSettings({ readNewsIds });
  syncBriefUnreadUi();
}

async function refreshMajorNews(force = false) {
  const now = Date.now();
  const last = state.settings?.lastNewsFetchAt || 0;
  if (!force && state.settings?.cachedNews?.length && now - last < NEWS_REFRESH_MS) {
    state.insightNews = state.settings.cachedNews;
    syncBriefUnreadUi();
    if (state.briefOpen && state.briefTab === 'news') renderBriefBody();
    return state.insightNews;
  }
  try {
    const [raw, tech] = await Promise.all([fetchMarketNews(12), fetchTechLeaders()]);
    state.techLeaders = tech || [];
    const news = mergeMajorAlerts(raw, {
      techLeaders: tech || [],
      todayEvents: getTodayEvents(),
    });
    state.insightNews = news;
    state.settings = await saveSettings({
      cachedNews: news,
      lastNewsFetchAt: now,
    });
  } catch (e) {
    console.error(e);
    state.insightNews = state.settings?.cachedNews || [];
  }
  syncBriefUnreadUi();
  if (state.briefOpen && state.briefTab === 'news') renderBriefBody();
  return state.insightNews;
}

/* events */
document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
});
els.trendStrip?.addEventListener('click', () => setView('pulse'));
els.trendSheet?.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-trend-ai]')) runTrendAi();
  if (e.target.closest?.('[data-lhb-refresh]')) refreshLhbSeats();
});

document.querySelectorAll('.primary-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.primaryKind = tab.dataset.primary;
    state.secondaryGroup = 'all';
    scrollPageTop();
    rememberPlace();
    renderPrimaryTabs();
    renderGroupTabs();
    renderList();
    renderStatus();
    renderStrategyDesk();
    if (state.briefOpen && state.briefTab === 'insight') renderBriefBody();
  });
});

els.briefOpenBtn?.addEventListener('click', () => openBrief('news'));
els.briefClose?.addEventListener('click', () => closeBrief());
els.briefMask?.addEventListener('click', () => closeBrief());
document.querySelectorAll('[data-brief-tab]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.briefTab || 'insight';
    state.briefTab = tab;
    if (tab === 'insight') await ensureBriefInsightData();
    if (tab === 'news') await refreshMajorNews(false);
    renderBriefBody();
  });
});

els.insightBtn?.addEventListener('click', () => openBrief('insight'));
els.newsOpenBtn?.addEventListener('click', () => openBrief('news'));
els.newsCloseBtn?.addEventListener('click', () => closeBrief());
els.calendarBtn?.addEventListener('click', () => openBrief('calendar'));
els.eventCalendarBtn?.addEventListener('click', () => openBrief('calendar'));

$('theme-toggle')?.addEventListener('click', async () => {
  const cur = state.settings?.theme || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  state.settings = await saveSettings({ theme: next });
  applyTheme(next);
  resizeAllCharts();
});

els.exportBtn?.addEventListener('click', () => exportWatchlistJson());
$('model-btn')?.addEventListener('click', () => openModelSettings());

els.predictToggle?.addEventListener('click', async () => {
  const curOpen = state.settings?.predictOpen !== false;
  state.settings = await saveSettings({ predictOpen: !curOpen });
  renderPredictCard();
});

els.funNamesBtn?.addEventListener('click', async () => {
  const next = !state.settings?.funFlowNames;
  state.settings = await saveSettings({ funFlowNames: next });
  if (els.funNamesBtn) {
    els.funNamesBtn.classList.toggle('bg-accent', next);
    els.funNamesBtn.classList.toggle('text-white', next);
  }
  if (state.view === 'data') await loadDataCenter();
  if (state.detail?.kind === 'stock') await refreshDetailCharts();
});

document.querySelectorAll('.axis-mode-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    state.settings = await saveSettings({ chartAxisMode: btn.dataset.axisMode || 'full' });
    syncAxisModeButtons();
    if (state.view === 'data') await loadDataCenter();
    if (state.detail?.kind === 'stock') await refreshDetailCharts();
  });
});

document.querySelectorAll('.detail-axis-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    state.settings = await saveSettings({ chartAxisMode: btn.dataset.detailAxis || 'full' });
    syncAxisModeButtons();
    if (state.view === 'data') await loadDataCenter();
    if (state.detail?.kind === 'stock') await refreshDetailCharts();
  });
});
els.eventDismissBtn?.addEventListener('click', async () => {
  state.settings = await saveSettings({ eventBannerDismissDate: todayStr() });
  renderEventBanner();
});
document.querySelectorAll('.board-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    // 资金页内切换行业/概念/地域，保持当前滚动位置
    state.boardType = tab.dataset.board;
    document.querySelectorAll('.board-tab').forEach((b) => {
      const on = b.dataset.board === state.boardType;
      b.classList.toggle('bg-accent', on);
      b.classList.toggle('text-white', on);
      b.style.color = on ? '#fff' : 'var(--muted)';
    });
    loadBoards();
  });
});

document.querySelectorAll('.rank-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    // 涨跌榜子 tab 同样不跳顶
    state.rank.dir = tab.dataset.rank;
    document.querySelectorAll('.rank-tab').forEach((b) => {
      const on = b.dataset.rank === state.rank.dir;
      b.classList.toggle('bg-accent', on);
      b.classList.toggle('text-white', on);
      b.style.color = on ? '#fff' : 'var(--muted)';
    });
    loadRank();
  });
});

els.rankSort.addEventListener('change', () => {
  state.rank.sort = els.rankSort.value;
  renderRank();
});

document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.period = btn.dataset.period;
    syncPeriodTabs();
    document.querySelector('#detail-panel .overflow-auto')?.scrollTo(0, 0);
    refreshDetailCharts();
  });
});

$('add-index-btn').addEventListener('click', () => pickIndicesDialog());

let searchTimer = null;
els.searchInput.addEventListener('input', () => {
  const value = els.searchInput.value;
  clearTimeout(searchTimer);
  if (!value.trim()) {
    state.searchResults = [];
    els.searchInput.placeholder = '添加股票 / 基金…';
    renderSearchResults();
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const found = await searchSymbols(value);
      const quotes = found.length ? await fetchQuotes(found.slice(0, 12)).catch(() => ({})) : {};
      state.searchResults = found.map((item) => {
        const q = quotes[quoteKey(item)] || {};
        return {
          ...item,
          changePct: q.changePct ?? item.changePct,
          price: q.price ?? item.price,
        };
      });
    } catch {
      state.searchResults = [];
    }
    renderSearchResults();
  }, 260);
});

$('more-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('more-panel')?.classList.toggle('hidden');
});
$('more-panel')?.addEventListener('click', () => {
  $('more-panel')?.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.more-menu')) $('more-panel')?.classList.add('hidden');
  if (e.target.closest('#search-wrap') || e.target.closest('[data-add-idx]')) return;
  if (!state.searchResults.length) return;
  state.searchResults = [];
  renderSearchResults();
});

els.refreshBtn.addEventListener('click', () => {
  state.trendAt = 0;
  refreshAll();
});
$('detail-close').addEventListener('click', closeDetail);
els.detailMask.addEventListener('click', closeDetail);
els.dialogCancel.addEventListener('click', () => closeDialog(false));
els.dialogOk.addEventListener('click', () => {
  // 先读表单再关，避免偶发清空
  closeDialog(true);
});
els.dialogMask.addEventListener('click', () => closeDialog(false));

$('import-btn')?.addEventListener('click', () => {
  const picker = $('import-file');
  if (picker) {
    picker.value = '';
    picker.click();
  }
});
$('import-file')?.addEventListener('change', async (e) => {
  const file = e.target?.files?.[0];
  if (!file) return;
  let bundle;
  try {
    bundle = JSON.parse(await file.text());
  } catch {
    els.statusText.textContent = '导入失败：不是有效的 JSON';
    return;
  }
  const ok = await confirmDialog(
    '导入备份',
    '将合并股票、基金、分组、成本和手数。已有代码会补上成本/手数，新代码会加进来。继续？',
  );
  if (!ok) return;
  const { added, updated } = await applyImportedBundle(bundle);
  applyTheme(state.settings?.theme);
  renderPrimaryTabs();
  renderGroupTabs();
  renderList();
  await refreshQuotes();
  const bits = [];
  if (added > 0) bits.push(`新增 ${added}`);
  if (updated > 0) bits.push(`更新 ${updated}`);
  els.statusText.textContent = bits.length ? `已导入（${bits.join('，')}）` : '没有可导入的数据';
});

window.addEventListener('resize', () => {
  resizeAllCharts();
  renderGroupTabs();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.dialogRoot.classList.contains('hidden')) closeDialog(false);
    else if (!els.detailRoot.classList.contains('hidden')) closeDetail();
    else if (state.briefOpen) closeBrief();
  }
});

els.loginForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const result = login(els.loginUser?.value, els.loginPass?.value);
  if (!result.ok) {
    if (els.loginError) {
      els.loginError.textContent = result.message || '登录失败';
      els.loginError.classList.remove('hidden');
    }
    return;
  }
  showAppAfterLogin();
  bootApp();
});

els.logoutBtn?.addEventListener('click', async () => {
  const ok = await confirmDialog('退出登录', '确定退出当前账号吗？');
  if (!ok) return;
  logout();
  closeDetail();
  closeBrief();
  closeReportDrawer();
  showLoginGate();
});

els.aiAdviceRefresh?.addEventListener('click', () => loadDetailAiAdvice(true));
els.aiAdviceHistory?.addEventListener('click', () => {
  if (!state.detail) return;
  openReportDrawer({ filter: itemKey(state.detail) });
});
els.reportOpenBtn?.addEventListener('click', () => openReportDrawer());
els.marketAiBtn?.addEventListener('click', () => runMarketAi());
els.lhbRefreshBtn?.addEventListener('click', () => void refreshLhbBoard(true));
els.lhbFilters?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-lhb-filter]');
  if (!btn || !els.lhbFilters.contains(btn)) return;
  const tag = btn.getAttribute('data-lhb-filter');
  if (!tag) return;
  if (lhbFilterOn.has(tag)) lhbFilterOn.delete(tag);
  else lhbFilterOn.add(tag);
  if (!lhbFilterOn.size) LHB_FILTERS.forEach((t) => lhbFilterOn.add(t));
  syncLhbFilterButtons();
  if (!lhbBoardCache) return;
  renderLhbBoard(lhbBoardCache);
  if (els.lhbMeta) els.lhbMeta.textContent = lhbMetaText(lhbBoardCache, true);
  const heuristic = {
    picks: pickLhbThree(visibleLhbRows()),
    note: '',
    source: 'local',
    generatedAt: Date.now(),
  };
  lhbAdviceCache = heuristic;
  lhbAdviceForDate = `${lhbBoardCache.date || ''}:${[...lhbFilterOn].sort().join(',')}`;
  renderLhbAdvice(heuristic);
  if (els.lhbAiMeta) els.lhbAiMeta.textContent = `建议买这三只 · ${lhbBoardCache.date || ''}`;
});
els.lhbBoard?.addEventListener('click', (e) => {
  const sortBtn = e.target.closest?.('[data-lhb-sort]');
  if (sortBtn && els.lhbBoard.contains(sortBtn)) {
    e.preventDefault();
    e.stopPropagation();
    setLhbSort(sortBtn.getAttribute('data-lhb-sort'));
    return;
  }
  const row = e.target.closest?.('[data-lhb-open]');
  if (!row || !els.lhbBoard.contains(row)) return;
  openLhbDetail(row.getAttribute('data-lhb-open'));
});
els.lhbBoard?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest?.('[data-lhb-open]');
  if (!row || !els.lhbBoard.contains(row)) return;
  e.preventDefault();
  openLhbDetail(row.getAttribute('data-lhb-open'));
});
els.lhbAiPicks?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-lhb-pick]');
  if (!btn || !els.lhbAiPicks.contains(btn)) return;
  const pick = lhbAdviceCache?.picks?.[Number(btn.getAttribute('data-lhb-pick'))];
  if (!pick) return;
  const row = lhbBoardCache?.rows?.find((r) => r.code === pick.code) || pick;
  const item = lhbRowToItem(row);
  if (item) void openDetail(item);
});

function openLhbHistCode(code) {
  const c = String(code || '').replace(/\D/g, '').slice(-6);
  if (!/^\d{6}$/.test(c)) return;
  const fromBoard = lhbBoardCache?.rows?.find((r) => r.code === c);
  if (fromBoard) {
    openLhbDetail(c);
    return;
  }
  const fromHist = lhbAiHistoryList()
    .flatMap((d) => d.picks || [])
    .find((p) => p.code === c);
  const item = lhbRowToItem({
    code: c,
    name: fromHist?.name || c,
    market: marketOfCode(c),
    changePct: fromHist?.changePct,
  });
  if (item) void openDetail(item);
}

els.lhbAiWeekTable?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-lhb-hist-code]');
  if (!btn || !els.lhbAiWeekTable.contains(btn)) return;
  openLhbHistCode(btn.getAttribute('data-lhb-hist-code'));
});
els.lhbAiGainTable?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-lhb-hist-code]');
  if (!btn || !els.lhbAiGainTable.contains(btn)) return;
  openLhbHistCode(btn.getAttribute('data-lhb-hist-code'));
});

els.strategyDesk?.addEventListener('click', (e) => {
  const t = e.target.closest('[data-strategy-pulse]');
  if (!t || !els.strategyDesk.contains(t)) return;
  setView('pulse');
});
els.reportDrawerClose?.addEventListener('click', () => closeReportDrawer());
els.reportBackdrop?.addEventListener('click', () => closeReportDrawer());
els.reportBack?.addEventListener('click', () => {
  const filter = state.reportDrawer?.filter || null;
  openReportDrawer({ filter, focusId: null });
});
els.reportDrawerBody?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-report-id]');
  if (!btn) return;
  openReportDrawer({
    filter: state.reportDrawer?.filter || null,
    focusId: btn.getAttribute('data-report-id'),
  });
});

async function boot() {
  if (!isLoggedIn()) {
    showLoginGate();
    return;
  }
  showAppAfterLogin();
  await bootApp();
}

async function bootApp() {
  state.settings = await getSettings();
  await ensureReportHistory();
  if (state.settings.theme !== 'light' && state.settings.theme !== 'dark') {
    state.settings = await saveSettings({ theme: 'light' });
  }
  state.list = await getWatchlist();
  // 规范化基金字段，避免行情 key 对不上
  {
    let fixed = false;
    const normalized = state.list.map((item) => {
      if (item.kind !== 'fund') return item;
      const code = String(item.code).padStart(6, '0');
      const next = {
        ...item,
        code,
        market: 'FUND',
        label: item.label || '基金',
      };
      if (item.code !== code || item.market !== 'FUND') fixed = true;
      return next;
    });
    if (fixed) {
      state.list = normalized;
      await setWatchlist(normalized);
    }
  }
  // 仅清理历史「未分组/默认」，不再按主题强制重分（避免分组来回变、删不掉）
  {
    const norm = normalizeGroups(state.settings.groups, state.list);
    if (norm.changed) {
      await setWatchlist(norm.list);
      state.list = norm.list;
      state.settings = await saveSettings({ groups: norm.groups });
    }
    const repaired = repairStockGroups(state.list, state.settings.groups);
    if (repaired.changed) {
      await setWatchlist(repaired.list);
      state.list = repaired.list;
      state.settings = await saveSettings({ groups: repaired.groups });
    }
  }
  if (state.settings.groups?.some((g) => GROUP_NAME_FIX[g.name])) {
    state.settings = await saveSettings({
      groups: state.settings.groups.map((g) => ({
        ...g,
        name: GROUP_NAME_FIX[g.name] || g.name,
      })),
    });
  }
  applyTheme(state.settings.theme);
  syncAxisModeButtons();
  if (state.settings?.funFlowNames && els.funNamesBtn) {
    els.funNamesBtn.classList.add('bg-accent', 'text-white');
  }
  const rawView = state.settings?.lastView === 'predict' ? 'lhb' : state.settings?.lastView;
  const savedView = ['watch', 'pulse', 'lhb', 'data', 'etf'].includes(rawView) ? rawView : 'watch';
  // 指数去重（黄金重复、纳斯达克命名）写回一次
  if (Array.isArray(state.settings?.indices)) {
    const cleaned = uniqueIndices(state.settings.indices);
    if (JSON.stringify(cleaned) !== JSON.stringify(state.settings.indices)) {
      state.settings = await saveSettings({ indices: cleaned });
    }
  }
  state.primaryKind = state.settings?.lastPrimary === 'fund' ? 'fund' : 'stock';
  const savedGroup = state.settings?.lastGroup || 'all';
  state.secondaryGroup =
    savedGroup === 'all' || (state.settings?.groups || []).some((g) => g.id === savedGroup)
      ? savedGroup
      : 'all';
  state.insightNews = state.settings.cachedNews || [];
  setView(savedView);
  renderPrimaryTabs();
  renderGroupTabs();
  renderList();
  renderStatus();
  syncBriefUnreadUi();
  renderEventBanner();
  if (currentUser()) els.statusText.textContent = `你好，${currentUser()}`;
  state.pulseBoards = {
    CN: pulseSectorSkeleton('CN'),
    US: pulseSectorSkeleton('US'),
    KR: pulseSectorSkeleton('KR'),
  };
  renderPulseBoards();
  await Promise.all([refreshAll(), refreshMajorNews(false), loadDataCenter()]);
  syncMarketAiBtn();
  // 不自动调用 AI：刷新 / 开盘定时器都不请求模型，只在用户点按钮时调用
  if (!state.timersStarted) {
    state.timersStarted = true;
    setInterval(refreshAll, REFRESH_MS);
    setInterval(() => refreshMajorNews(false), NEWS_REFRESH_MS);
  }
}

boot();
