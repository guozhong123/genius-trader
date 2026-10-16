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
  updateItem,
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
  renderIntradayChart,
  renderKlineChart,
  renderNorthboundChart,
  renderUpDownChart,
  resizeAllCharts,
} from './lib/charts.js';
import { getTodayEvents, getUpcomingEvents, getMajorUpcomingEvents, marketCalendarFacts } from './lib/calendar.js';
import { buildLevelMarkLines, calcAutoLevels } from './lib/levels.js';
import { normalizeGroups, repairStockGroups } from './lib/stock-groups.js';
import { analyzeMainForceIntent } from './lib/predict.js';
import { askDeepseekReport, askForceOutlook, askMarketReport, askScanBatch, askSeatReport, buildMarketFacts, buildScanFacts, buildSeatFacts, buildStockFacts, disciplineStop } from './lib/deepseek.js';
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
};

const NEWS_REFRESH_MS = 2 * 60 * 1000;
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

function setView(view) {
  state.view = view;
  scrollPageTop();
  ['watch', 'pulse', 'data', 'etf', 'force'].forEach((v) => {
    const el = $(`view-${v}`);
    if (!el) return;
    const on = v === view;
    el.classList.toggle('hidden', !on);
    if (on) {
      el.classList.remove('view-enter');
      // restart enter animation
      void el.offsetWidth;
      el.classList.add('view-enter');
    }
  });
  els.indicesBar?.classList.toggle('hidden', view !== 'watch');
  els.watchSubnav?.classList.toggle('hidden', view !== 'watch');
  document.querySelectorAll('.view-tab').forEach((tab) => {
    const on = tab.dataset.view === view;
    tab.classList.toggle('bg-accent', on);
    tab.classList.toggle('text-white', on);
    tab.style.color = on ? '#fff' : 'var(--muted)';
  });
  if (view === 'data') {
    loadDataCenter();
    loadBoards();
    loadRank();
  }
  if (view === 'pulse') {
    refreshPulse();
    loadTrendSheet();
  }
  if (view === 'force') loadForce();
  if (view === 'etf') ensureHeatmap();
  requestAnimationFrame(() => resizeAllCharts());
  rememberPlace();
}

function rememberPlace() {
  if (!state.settings) return;
  const lastView = ['watch', 'pulse', 'data', 'etf', 'force'].includes(state.view) ? state.view : 'watch';
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

async function pushReport(entry) {
  const row = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    generatedAt: entry.generatedAt || Date.now(),
  };
  const aiHistory = [row, ...reportHistory()].slice(0, 160);
  const patch = { aiHistory, aiHistoryMigrated: true };
  if (row.kind === 'stock' && row.itemKey) {
    patch.aiReports = { ...(state.settings?.aiReports || {}), [row.itemKey]: row };
  }
  state.settings = await saveSettings(patch);
  return row;
}

async function ensureReportHistory() {
  if (state.settings?.aiHistoryMigrated) return;
  if (reportHistory().length) {
    state.settings = await saveSettings({ aiHistoryMigrated: true });
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
  state.settings = await saveSettings({ aiHistory: seeded, aiHistoryMigrated: true });
}

const positionDrafts = new Map();

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
  const draft = positionDrafts.get(itemKey(item));
  if (draft && Object.prototype.hasOwnProperty.call(draft, field)) return draft[field];
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
  const market = item.kind === 'fund' ? 'FUND' : item.market || '';
  return `<div class="pos-fields" data-live="${Number.isFinite(live) ? live : ''}" data-market="${escAttr(market)}" data-kind="${escAttr(item.kind || '')}">
    <label class="pos-field"><input data-cost="${key}" inputmode="decimal" draggable="false" autocomplete="off" value="${escAttr(shownField(item, 'cost'))}" placeholder="成本" /></label>
    <label class="pos-field"><input data-lots="${key}" inputmode="decimal" draggable="false" autocomplete="off" value="${escAttr(shownField(item, 'lots'))}" placeholder="手数" title="A股1手=100股；基金填份额" /></label>
    <div class="pos-pnl">${pnlHtml(cost, live, lots, item)}${stopHtml(item, cost, live)}</div>
    <button type="button" data-clear-pos="${key}" class="pos-clear" title="清空成本和手数">清</button>
  </div>`;
}

function aiRowBtn(item) {
  if (item.kind === 'fund') return '';
  const key = itemKey(item);
  const running = !!state.aiRunning?.[key];
  const report = aiReportOf(item);
  const label = running ? '分析中' : report?.action || 'AI';
  const toneCls = report?.action === '买入' ? 'up' : report?.action === '不买' ? 'down' : '';
  return `<button type="button" data-ai="${escAttr(key)}" class="ai-row-btn ${toneCls}" title="${report ? '重新分析，点股票看报告' : 'DeepSeek 分析'}">${esc(label)}</button>`;
}

function probSnapshot(item) {
  const key = itemKey(item);
  const scan = state.settings?.aiScan?.[key];
  const report = aiReportOf(item);
  if (scan && (!report || (scan.generatedAt || 0) >= (report.generatedAt || 0))) return scan;
  return report;
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
  return `<div class="ai-probs" title="买入 / 继续等 / 不买">
    ${line('买入', report.buyProb, report.action === '买入', false)}
    ${line('继续等', report.waitProb, report.action === '继续等', false)}
    ${line('不买', report.avoidProb, report.action === '不买', true)}
  </div>`;
}

function scanBarHtml() {
  if (state.primaryKind !== 'stock') return '';
  const label = state.scanRunning
    ? `分析中 ${state.scanProgress?.done || 0}/${state.scanProgress?.total || 0}`
    : '分析全部';
  const dis = state.scanRunning ? 'disabled' : '';
  return `<div class="scan-bar">
    <button type="button" data-scan-all ${dis} class="scan-btn">${esc(label)}</button>
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
        ${aiRowBtn(item)}
      </div>
      <div class="col-num live-price text-[13px] font-semibold leading-none ${tone(pct)}">${priceLabel}</div>
      ${costLineHtml(item, price)}
      ${aiProbCell(item)}
      <div class="col-actions">
        <button data-move-group="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--muted)" title="改分组">组</button>
        <button data-pin="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--muted)">${item.pinned ? '取消' : '顶'}</button>
        <button data-remove="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--up)">删</button>
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
      <div class="pos-clear-h"></div>
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

  const active = document.activeElement;
  const focusAttr = active?.hasAttribute?.('data-cost')
    ? 'data-cost'
    : active?.hasAttribute?.('data-lots')
      ? 'data-lots'
      : '';
  const focusVal = focusAttr ? active.getAttribute(focusAttr) : '';
  const caret = focusAttr ? active.selectionStart : null;

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
  if (focusAttr && focusVal) {
    const el = els.list.querySelector(`input[${focusAttr}="${CSS.escape(focusVal)}"]`);
    if (el) {
      el.focus();
      const pos = Math.min(caret ?? el.value.length, el.value.length);
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* number-like inputs */
      }
    }
  }
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
      if (e.target.closest('button, input, .pos-fields')) return;
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
      if (item.kind === 'fund') {
        const ok = await confirmDialog('删除基金', `确定删除「${item.name || item.code}」吗？`);
        if (!ok) return;
      }
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

  els.list.querySelectorAll('[data-ai]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = state.list.find((x) => itemKey(x) === btn.getAttribute('data-ai'));
      if (item) await runDeepseekForItem(item);
    });
  });

  const refreshPosPnl = (line, item) => {
    if (!line) return;
    const live = Number(line.getAttribute('data-live'));
    const cost = parseUserPrice(line.querySelector('[data-cost]')?.value);
    const lots = parseLots(line.querySelector('[data-lots]')?.value);
    const box = line.querySelector('.pos-pnl') || line;
    let pnl = box.querySelector('.pnl');
    const parts = pnlParts(cost, live, lots, item || { market: line.getAttribute('data-market'), kind: line.getAttribute('data-kind') });
    if (!parts) pnl?.remove();
    else {
      if (!pnl) {
        pnl = document.createElement('span');
        const stopEl = box.querySelector('.stop-tag');
        if (stopEl) box.insertBefore(pnl, stopEl);
        else box.appendChild(pnl);
      }
      const moneyText = parts.money != null ? fmtMoney(parts.money) : fmtMoney(parts.perShare);
      pnl.className = `pnl ${tone(parts.pct)}`;
      pnl.innerHTML = `<span class="pnl-diff">${moneyText}</span><span class="pnl-pct">${fmtPct(parts.pct)}</span>`;
    }
    let tag = box.querySelector('.stop-tag');
    if (item?.kind === 'fund') {
      tag?.remove();
      return;
    }
    const stop = disciplineStop(item, cost);
    if (!stop) {
      tag?.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'stop-tag';
      box.appendChild(tag);
    }
    const broken = live > 0 && live <= stop.price;
    tag.className = `stop-tag ${broken ? 'text-down' : ''}`;
    tag.title = `成本下方 ${(stop.gap * 100).toFixed(0)}%`;
    tag.textContent = `止损 ${stop.price.toFixed(2)}${broken ? '·已破' : ''}`;
  };

  const bindPosInput = (el, field) => {
    const attr = field === 'cost' ? 'data-cost' : 'data-lots';
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('input', () => {
      const key = el.getAttribute(attr);
      const prev = positionDrafts.get(key) || {};
      positionDrafts.set(key, { ...prev, [field]: el.value });
      const item = state.list.find((x) => itemKey(x) === key);
      refreshPosPnl(el.closest('.pos-fields'), item);
    });
    el.addEventListener('blur', async () => {
      const key = el.getAttribute(attr);
      const item = state.list.find((x) => itemKey(x) === key);
      if (!item) return;
      const parsed = field === 'cost' ? parseUserPrice(el.value) : parseLots(el.value);
      el.value = parsed == null ? '' : String(parsed);
      const draft = { ...(positionDrafts.get(key) || {}) };
      delete draft[field];
      if (draft.cost == null && draft.lots == null) positionDrafts.delete(key);
      else positionDrafts.set(key, draft);
      const prevVal =
        field === 'cost'
          ? (item.cost ?? null)
          : (item.lots ?? item.markPrice ?? null);
      if (prevVal === parsed) return;
      const patch =
        field === 'cost'
          ? { cost: parsed }
          : { lots: parsed, markPrice: null };
      const idx = state.list.findIndex((x) => itemKey(x) === key);
      if (idx >= 0) state.list[idx] = { ...state.list[idx], ...patch };
      state.list = await updateItem(state.list[idx] || item, patch);
      renderList();
    });
  };
  els.list.querySelectorAll('[data-cost]').forEach((el) => bindPosInput(el, 'cost'));
  els.list.querySelectorAll('[data-lots]').forEach((el) => bindPosInput(el, 'lots'));
  els.list.querySelectorAll('[data-clear-pos]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.getAttribute('data-clear-pos');
      const item = state.list.find((x) => itemKey(x) === key);
      if (!item) return;
      positionDrafts.delete(key);
      const patch = { cost: null, lots: null, markPrice: null };
      const idx = state.list.findIndex((x) => itemKey(x) === key);
      if (idx >= 0) state.list[idx] = { ...state.list[idx], ...patch };
      state.list = await updateItem(state.list[idx] || item, patch);
      renderList();
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
  if (flowTitle) flowTitle.textContent = day ? day : '';
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
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `今天${tape.label} · ${tape.detail}`;
  el.title = tape.tip;
  el.style.color = tape.label === '宜等' ? 'var(--down)' : tape.label === '可找买点' ? 'var(--up)' : 'var(--muted)';
}

function renderPredictCard() {
  if (!els.predictCard || !els.predictBody) return;
  const open = state.settings?.predictOpen !== false;
  els.predictBody.classList.toggle('hidden', !open);
  if (els.predictToggle) els.predictToggle.textContent = open ? '关闭' : '展开';
  if (!open) return;
  const s = state.center.flow?.summary;
  if (!s) {
    els.predictBody.textContent = '暂无主力资金数据';
    return;
  }
  const intent = analyzeMainForceIntent(s);
  els.predictBody.innerHTML = `
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-sm font-semibold text-accent">${esc(intent.label)}</span>
      <span class="text-[11px] tabular-nums" style="color:var(--muted)">置信 ${Math.round(intent.probability * 100)}%</span>
    </div>
    <p class="mt-1">${esc(intent.detail)}</p>`;
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
    state.center = { flow, updown, northbound, overview };
    renderFlowSummary();
    const axisOpts = { axisMode: chartAxisMode(), legendNames: flowLegendNames() };
    if (flow) renderFlowChart($('chart-market-flow'), flow, axisOpts);
    if (updown) renderUpDownChart($('chart-updown'), updown);
    if (northbound) renderNorthboundChart($('chart-northbound'), northbound);
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

const FORCE_NAMES = ['煤炭', '传媒', '半导体', 'CPO', '光模块', '电网', '电力', '创新药'];

function boardHit(name) {
  const rows = [...(state.forceConcept || []), ...(state.forceIndustry || [])];
  return rows.find((b) => String(b.name || '').includes(name)) || null;
}

function renderForce() {
  const btn = $('force-run');
  if (btn) {
    btn.disabled = !!state.forceRunning;
    btn.textContent = state.forceRunning ? '看盘中…' : '看今天';
  }
  const cal = $('force-cal');
  if (cal) {
    const facts = marketCalendarFacts(new Date(), { center: state.center });
    cal.textContent = (facts.lines || []).slice(0, 3).join('');
  }
  const body = $('force-body');
  if (body) {
    const saved = state.settings?.forceOutlook;
    if (state.forceRunning) {
      body.innerHTML = '<div style="color:var(--muted)">正在看今天的资金、板块和日历…</div>';
    } else if (saved?.now) {
      const when = saved.generatedAt
        ? new Date(saved.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
      const chips = (saved.watch || []).map((x) => `<span class="force-chip">${esc(x)}</span>`).join('');
      const soft = (saved.soft || [])
        .map((row) => `<div class="force-line"><b>${esc(row.name)}</b> ${esc(row.why)}</div>`)
        .join('');
      body.innerHTML = `
        <div class="text-[11px]" style="color:var(--muted)">${esc(when)} · 盘中倾向，不是买卖指令</div>
        <div class="force-now">${esc(saved.now)}</div>
        <div class="mt-1">${esc(saved.later || '')}</div>
        ${saved.turn ? `<div class="mt-1 text-down">${esc(saved.turn)}</div>` : ''}
        ${chips ? `<div class="force-chips">${chips}</div>` : ''}
        ${soft}`;
    } else {
      body.innerHTML = '<div style="color:var(--muted)">点「看今天」。根据此刻的资金、涨跌和日历，判断下午会不会转弱。</div>';
    }
  }
  const boards = $('force-boards');
  if (boards) {
    const watched = FORCE_NAMES.map((name) => {
      const hit = boardHit(name);
      const pct = hit?.changePct;
      return `<div class="force-line"><span>${esc(hit?.name || name)}</span><b class="${tone(pct)}">${fmtPct(pct)}</b></div>`;
    }).join('');
    const weak = [...(state.forceIndustry || [])]
      .filter((b) => Number.isFinite(Number(b.changePct)))
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, 6)
      .map((b) => `<div class="force-line"><span>${esc(b.name)}</span><b class="${tone(b.changePct)}">${fmtPct(b.changePct)}</b></div>`)
      .join('');
    boards.innerHTML = `
      <div class="force-sub">常看的方向</div>
      ${watched}
      <div class="force-sub">今天行业里偏弱的</div>
      ${weak || '<div class="text-[12px]" style="color:var(--muted)">正在取板块…</div>'}`;
  }
}

function buildForceFacts() {
  const cal = marketCalendarFacts(new Date(), { center: state.center });
  const s = state.center.flow?.summary;
  const zd = state.center.updown;
  const flow = s
    ? `主力 ${fmtYi(s.main)} 亿，超大单 ${fmtYi(s.huge)} 亿，大单 ${fmtYi(s.large)} 亿。涨 ${zd?.up ?? '—'} 跌 ${zd?.down ?? '—'} 涨停 ${zd?.limitUp ?? '—'} 跌停 ${zd?.limitDown ?? '—'}。`
    : '资金未取到。';
  const line = (rows) =>
    (rows || [])
      .filter((b) => Number.isFinite(Number(b.changePct)))
      .slice(0, 8)
      .map((b) => `${b.name} ${fmtPct(b.changePct)}`)
      .join('，');
  const industry = [...(state.forceIndustry || [])].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  const watched = FORCE_NAMES.map((name) => {
    const hit = boardHit(name);
    return hit ? `${hit.name} ${fmtPct(hit.changePct)}` : `${name} 无行情`;
  }).join('，');
  return [cal.text, flow, `行业涨得多：${line(industry) || '无'}`, `行业跌得多：${line([...industry].reverse()) || '无'}`, `指定方向：${watched}`].join('\n');
}

async function loadForce() {
  renderForce();
  try {
    await loadDataCenter();
    const [industry, concept] = await Promise.all([
      fetchBoards('industry').catch(() => state.forceIndustry || []),
      fetchBoards('concept').catch(() => state.forceConcept || []),
    ]);
    state.forceIndustry = industry;
    state.forceConcept = concept;
  } catch (e) {
    console.error(e);
  }
  renderForce();
}

async function runForce() {
  if (state.forceRunning) return;
  const apiKey = await ensureDeepseekKey();
  if (!apiKey) return;
  state.forceRunning = true;
  renderForce();
  try {
    if (!state.forceIndustry?.length) await loadForce();
    const report = await askForceOutlook(apiKey, buildForceFacts());
    state.settings = await saveSettings({ forceOutlook: { ...report, generatedAt: Date.now() } });
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    if (/401|invalid|api key|密钥/i.test(msg)) {
      state.settings = await saveSettings({ deepseekApiKey: '' });
    }
  } finally {
    state.forceRunning = false;
    renderForce();
  }
}

function ensureHeatmap() {
  const frame = $('etf-frame');
  if (!frame || frame.dataset.ready === '1') return;
  frame.dataset.ready = '1';
  frame.src = 'https://52etf.site/';
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
    report.kind === 'market' || report.kind === 'seat'
      ? ''
      : `<div class="mb-2 grid grid-cols-3 gap-1.5 text-center">
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">买入</div><div class="text-sm font-semibold text-up">${report.buyProb ?? 0}%</div></div>
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">继续等</div><div class="text-sm font-semibold">${report.waitProb ?? 0}%</div></div>
      <div class="rounded-lg px-1 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">不买</div><div class="text-sm font-semibold text-down">${report.avoidProb ?? 0}%</div></div>
    </div>`;
  const points =
    report.kind === 'market'
      ? `${reportPoint('做', report.leaders)}${reportPoint('避开', report.avoid)}${reportPoint('节奏', report.rhythm || report.hold)}`
      : report.kind === 'seat'
        ? `${reportPoint('席位', report.read || report.summary)}${reportPoint('持仓', report.hold)}`
        : `${reportPoint('怎么处理', report.hold || report.position)}${reportPoint('卖 / 买点', report.exit || report.today)}${reportPoint('跟主力', report.follow)}`;
  const detail =
    report.kind === 'market'
      ? `${reportBlock('风险', report.risk)}${reportBlock('和前几天比', report.consistency)}`
      : report.kind === 'seat'
        ? `${reportBlock('容易看错的地方', report.risk)}`
        : `${checksLine(report)}${reportBlock('今天怎么做', report.today)}${reportBlock('板块', report.sector)}${reportBlock('持仓', report.position)}${reportBlock('主力', report.mainForce)}${reportBlock('量价', report.trend)}${reportBlock('消息', report.news)}${reportBlock('位置', report.valuation)}${reportBlock('大盘', report.market)}${reportBlock('仓位', report.plan)}${reportBlock('离场', report.exit)}${reportBlock('放弃', report.stop)}${reportBlock('风险', report.risk)}${reportBlock('和前几天比', report.consistency)}`;
  const title = report.title || (report.kind === 'market' ? '今日大盘' : report.kind === 'seat' ? '期货席位' : '个股');
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
  els.aiAdviceBody.innerHTML = reportArticleHtml(report);
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
    els.reportDrawerBody.innerHTML = `${pending}<div class="text-[12px] leading-relaxed" style="color:var(--muted)">还没有报告。点顶部 <b>AI盘</b> 看今天哪些板块适合短线，或在自选里点股票旁边的 AI。生成过的都会留在这里，新的在最上面。</div>`;
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
  const market = rows.filter((r) => r.kind === 'market' || r.kind === 'seat');
  const stocks = rows.filter((r) => r.kind !== 'market' && r.kind !== 'seat');
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
  els.marketAiBtn.textContent = state.marketAiRunning ? '分析中' : 'AI盘';
  els.marketAiBtn.disabled = !!state.marketAiRunning;
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
  const draft = positionDrafts.get(keyId);
  if (draft && (draft.cost != null || draft.lots != null)) {
    const patch = {};
    if (draft.cost != null) patch.cost = parseUserPrice(draft.cost);
    if (draft.lots != null) {
      patch.lots = parseLots(draft.lots);
      patch.markPrice = null;
    }
    state.list = await updateItem(item, patch);
    positionDrafts.delete(keyId);
  }
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
    if (!opts.quiet) openReportDrawer({ focusId: saved.id });
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
    if (!opts.quiet) renderList();
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
    await runDeepseekForItem(item);
    return;
  }
  els.aiAdviceBody.innerHTML =
    '<div class="text-[12px] leading-relaxed" style="color:var(--muted)">还没有这份报告。点「分析」才会调用 DeepSeek。看的是持仓怎么处理，以及跟不跟主力。</div>';
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
        '<div class="text-[12px] leading-relaxed" style="color:var(--muted)">点右上角「分析」才会调用 DeepSeek。这里看两件事：你这只票的持仓怎么处理，以及跟不跟它的主力。</div>';
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

function syncPeriodTabs() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    const on = btn.dataset.period === state.period;
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('text-white', on);
    btn.style.color = on ? '#fff' : 'var(--muted)';
  });
}

async function refreshDetailCharts() {
  const item = state.detail;
  if (!item || item.kind === 'fund') return;
  const secid = item.secid || toSecid(item.market, item.code, item.marketNo);
  try {
    const period = state.period;
    const minute = period === 'intraday' || period === 'fiveday';
    const kltMap = { day: 101, week: 102, month: 103 };
    const [mainRes, flowRes] = await Promise.allSettled([
      minute
        ? fetchIntraday(secid, period === 'fiveday' ? 5 : 1)
        : fetchKline(secid, kltMap[period] || 101, period === 'month' ? 60 : 90),
      fetchStockMoneyFlow(secid),
    ]);
    const mainData = mainRes.status === 'fulfilled' ? mainRes.value : null;
    const flow = flowRes.status === 'fulfilled' ? flowRes.value : null;
    if (mainRes.status === 'rejected') console.error(mainRes.reason);
    if (flowRes.status === 'rejected') console.error(flowRes.reason);

    const axisMode = chartAxisMode();
    const prices = mainData?.points?.map((p) => p.price ?? p.high) || [];
    const intraHi = prices.reduce((m, v) => (Number(v) > m ? Number(v) : m), -Infinity);
    const intraLo = prices.reduce((m, v) => (Number(v) > 0 && Number(v) < m ? Number(v) : m), Infinity);
    const auto = minute ? {} : calcAutoLevels(mainData?.points || [], 20);
    const base = Number(mainData?.preClose);
    const pctOf = (price) => {
      if (!(base > 0) || !(Number(price) > 0)) return '—';
      const pct = ((Number(price) - base) / base) * 100;
      return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
    };
    const markLine = buildLevelMarkLines({
      preClose: minute ? mainData?.preClose : null,
      resistance: minute ? (Number.isFinite(intraHi) ? intraHi : null) : auto.resistance,
      support: minute ? (Number.isFinite(intraLo) ? intraLo : null) : auto.support,
      resistanceName: minute ? `最高涨幅 ${pctOf(intraHi)}` : '压力',
      supportName: minute ? `最低涨幅 ${pctOf(intraLo)}` : '支撑',
    });

    // 清空占位后再渲染，保证容器已有尺寸
    els.chartMain.innerHTML = '';
    await waitFrames(1);

    if (minute) {
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
          { axisMode: period === 'fiveday' ? 'live' : axisMode },
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
          `<div class="flex h-full flex-col items-center justify-center gap-1 text-sm" style="color:var(--muted)"><span>${period === 'fiveday' ? '暂无五日分时' : '暂无分时（闭盘也会显示当日走势）'}</span><span class="text-[11px]">可切换日K，或稍后重试</span></div>`;
      }
    } else if (mainData?.points?.length) {
      const title = period === 'week' ? '周K' : period === 'month' ? '月K' : '日K';
      renderKlineChart(els.chartMain, mainData.points, { markLine, title });
    } else {
      els.chartMain.innerHTML =
        '<div class="flex h-full items-center justify-center text-sm" style="color:var(--muted)">暂无K线</div>';
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

async function refreshIndices() {
  state.indices = await fetchIndices(state.settings.indices || []);
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
  const futAdviceHtml = state.futAiRunning
    ? '<p class="trend-empty">正在看这些席位是偏多、偏空，还是对冲…</p>'
    : state.futAiError
      ? `<p class="trend-hot">${esc(state.futAiError)}</p>`
      : state.futAdvice
        ? `<div class="trend-ai-box">${reportArticleHtml(state.futAdvice)}</div>`
        : '<p class="trend-empty">席位结论还没有。保存过密钥的话，开盘、盘中、尾盘各自动写一次。</p>';
  const advice = state.trendAdvice;
  const adviceHtml = state.trendAiRunning
    ? '<p class="trend-empty">正在调用模型，只根据上面这张纸…</p>'
    : state.trendAiError
      ? `<p class="trend-hot">${esc(state.trendAiError)}</p>`
      : advice
        ? `<div class="trend-ai-box">${reportArticleHtml(advice)}</div>`
        : '<p class="trend-empty">模型结论还没有。保存过密钥的话，开盘、盘中、尾盘各自动写一次。</p>';
  const aiBtn = (attr, running, has) =>
    `<button type="button" ${attr} class="trend-ai-btn" ${running ? 'disabled' : ''}>${running ? '分析中' : has ? '重新分析' : '用 AI 出结论'}</button>`;
  els.trendSheet.innerHTML = `
    <div class="trend-head">
      <div>
        <div class="trend-head-title">顺势</div>
        <div class="trend-head-meta">北京 ${esc(clock.beijing)} · 下一交易日 ${esc(clock.next)} · 美东 ${esc(clock.eastern)}</div>
      </div>
      <div class="trend-head-tags">
        <span class="trend-mood ${moodCls}">${esc(mood)}</span>
        ${sheet.tapeWeak ? '<span class="trend-hot">跌家占优，外盘降权</span>' : ''}
      </div>
    </div>
    ${trendCard('总结', trendPlanHtml(sheet.plan), '', 'trend-summary')}
    ${(() => {
      const cal = marketCalendarFacts(new Date(), { indices: state.indices || [], center: state.center });
      return trendCard(
        '日历',
        cal.lines.map((line) => `<p class="trend-summary-line">${highlightTrend(line)}</p>`).join(''),
      );
    })()}
    ${trendCard(
      '情绪',
      `<div class="trend-metrics">
        <div><span>高度</span><b>${s?.height ?? '—'}板</b></div>
        <div><span>炸板率</span><b>${s?.zbRate == null ? '—' : `${Math.round(s.zbRate * 100)}%`}</b></div>
        <div><span>昨涨停溢价</span><b class="${tone(s?.premium)}">${s?.premium == null ? '—' : pctText(s.premium)}</b></div>
        <div><span>首板晋级</span><b>${s?.promoRate == null ? '—' : `${Math.round(s.promoRate * 100)}%`}</b></div>
      </div>
      <p class="trend-hint">高度看连板。炸板率高说明封不住。溢价为负说明昨板今天亏。晋级低就不宜追新板。</p>`,
    )}
    ${trendCard(
      `隔夜映射 · 美东 ${esc(clock.eastern)} → 大A ${esc(clock.next)}`,
      `${overnight || '<p class="trend-empty">外盘没有明显强于 1% 的方向。</p>'}
      <p class="trend-hint">外盘涨了，对照大A可能被带着看的板块。已经大涨就标不宜再追。</p>`,
    )}
    ${trendCard('主线', mains || '<p class="trend-empty">没有还在进的主题。</p>')}
    ${trendCard(
      '主题资金',
      `<div class="trend-flow-label">净流入</div><div class="trend-chips">${flowLine(inflow) || '—'}</div>
      <div class="trend-flow-label">净流出</div><div class="trend-chips">${flowLine(outflow) || '—'}</div>`,
    )}
    ${trendCard(
      `龙虎榜${sheet.seatDate ? ` · ${esc(sheet.seatDate)}` : ''}`,
      seats || '<p class="trend-empty">这天的席位还没出来。</p>',
    )}
    ${trendCard(
      `期货席位${fut?.date ? ` · 持仓日 ${esc(fut.date)}` : ''}`,
      `${futHtml || '<p class="trend-empty">这天的期货席位还没出来。</p>'}
      <p class="trend-hint">括号是当日增减手数。代客是客户的单。多空一起加更像对冲。</p>
      ${futAdviceHtml}`,
      aiBtn('data-fut-ai', state.futAiRunning, !!state.futAdvice),
    )}
    ${trendCard(
      `报告对照 · ${esc(sheet.review?.day || '还没有')} → ${esc(clock.today)}`,
      `${sheet.review?.summary ? `<p class="trend-summary-line">${highlightTrend(sheet.review.summary)}</p>` : '<p class="trend-empty">还没有可对照的报告。</p>'}${reviewRows}`,
    )}
    ${trendCard(
      `最终建议 · 对着大A ${esc(clock.next)}`,
      adviceHtml,
      aiBtn('data-trend-ai', state.trendAiRunning, !!advice),
    )}
    <p class="trend-foot">外盘、连板和席位是公开数据的粗判，不是机构底仓。不构成买卖承诺。</p>`;
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
  if (state.trendAiRunning) return false;
  const apiKey = opts.auto ? String(state.settings?.deepseekApiKey || '').trim() : await ensureDeepseekKey();
  if (!apiKey) return false;
  if (!state.trend) await loadTrendSheet();
  state.trendAiRunning = true;
  state.trendAiError = '';
  renderTrend();
  try {
    const clock = marketClock();
    const report = await askMarketReport(apiKey, marketFacts(slotNote(opts.slot)), state.settings?.aiModel);
    state.trendAdvice = await pushReport({
      ...report,
      kind: 'market',
      title: opts.slot ? `顺势 ${opts.day} ${opts.slot.label}` : `顺势 ${clock.beijing} 手动`,
      itemKey: '',
      code: '',
      slot: opts.slot?.id || '',
      sessionDay: opts.day || clock.today,
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

function hydrateSessionReports() {
  if (!state.trendAdvice) {
    const hit = reportHistory().find((r) => r.kind === 'market');
    if (hit) state.trendAdvice = hit;
  }
  if (!state.futAdvice) {
    const hit = reportHistory().find((r) => r.kind === 'seat');
    if (hit) state.futAdvice = hit;
  }
}

async function markAutoSlot(key) {
  const aiAutoDone = [key, ...(state.settings?.aiAutoDone || []).filter((item) => item !== key)].slice(0, 24);
  state.settings = await saveSettings({ aiAutoDone });
}

/** 顺势和期货席位：开盘、盘中、尾盘各一次。没有密钥不弹窗。失败等 20 分钟再试。 */
async function maybeAutoSessionAi() {
  if (state.autoSessionRunning) return;
  const slot = tradingSlot();
  if (!slot) return;
  if (!String(state.settings?.deepseekApiKey || '').trim()) return;
  const done = new Set(state.settings?.aiAutoDone || []);
  const trendKey = `${slot.day}|${slot.id}|trend`;
  const seatKey = `${slot.day}|${slot.id}|seat`;
  const needTrend = !done.has(trendKey);
  const needSeat = !done.has(seatKey);
  if (!needTrend && !needSeat) return;
  if (state.autoSessionFailAt && Date.now() - state.autoSessionFailAt < 20 * 60 * 1000) return;
  state.autoSessionRunning = true;
  try {
    if (!state.trend || Date.now() - (state.trendAt || 0) > 3 * 60 * 1000) await loadTrendSheet(true);
    hydrateSessionReports();
    renderTrend();
    const seatRows = [...(state.trend?.futures?.indexRows || []), ...(state.trend?.futures?.commodityRows || [])];
    if (needSeat) {
      if (!seatRows.length) state.autoSessionFailAt = Date.now();
      else if (await runFuturesAi({ auto: true, slot, day: slot.day })) await markAutoSlot(seatKey);
      else state.autoSessionFailAt = Date.now();
    }
    if (needTrend) {
      if (await runTrendAi({ auto: true, slot, day: slot.day })) await markAutoSlot(trendKey);
      else state.autoSessionFailAt = Date.now();
    }
  } finally {
    state.autoSessionRunning = false;
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
    if (state.view === 'force') await loadForce();
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

  const marketBits = [];
  if (sh) marketBits.push(`上证 ${fmtPct(sh.changePct)}`);
  if (sz) marketBits.push(`深证 ${fmtPct(sz.changePct)}`);
  if (cy) marketBits.push(`创业板 ${fmtPct(cy.changePct)}`);

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

  const techStrong = [...tech].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
  if (techStrong.length) {
    const soft = techStrong.filter((t) => t.changePct <= -2).map((t) => t.name);
    const hot = techStrong.filter((t) => t.changePct >= 2).map((t) => t.name);
    if (hot.length) tips.push(`科技龙头偏强：${hot.join('、')}，相关主题可关注联动，忌追高。`);
    if (soft.length) tips.push(`科技龙头偏弱：${soft.join('、')}，留意风险偏好与估值波动。`);
  }
  if (news.some((n) => MACRO_HINT.test(n.title))) {
    tips.push('有宏观重磅（如 CPI/非农/美联储），仓位宜更谨慎，等落地后再加大动作。');
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
        const isToday = e.date === today;
        const typeColor =
          e.type === 'cpi' ? 'var(--up)' : e.type === 'nfp' ? '#b45309' : 'var(--accent)';
        return `<div class="flex items-start gap-2 rounded-lg px-2.5 py-2 ${isToday ? 'ring-soft' : ''}" style="${isToday ? 'background:color-mix(in oklab,var(--accent) 8%,transparent)' : ''}">
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="color:${typeColor};background:color-mix(in oklab,${typeColor} 12%,transparent)">${e.type.toUpperCase()}</span>
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-semibold">${esc(e.date)} ${esc(e.title)}${isToday ? ' · 今日' : ''}</div>
            <div class="text-[11px]" style="color:var(--muted)">${esc(e.tip)}</div>
            ${e.impact ? `<div class="mt-0.5 text-[11px] leading-snug"><span class="font-semibold text-accent">影响：</span>${esc(e.impact)}</div>` : ''}
            ${e.result ? `<div class="mt-0.5 text-[10px]" style="color:var(--muted)">状态：${esc(e.result)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}
  </div>
  <p class="mt-2 text-[10px]" style="color:var(--muted)">滚动近三周重大窗口（非农 / CPI / FOMC）；CPI 关注窗可多日出现，状态随日期更新。请以官网为准。</p>`;
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
  if (e.target.closest?.('[data-fut-ai]')) runFuturesAi();
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
    scrollPageTop();
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
    scrollPageTop();
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
$('force-run')?.addEventListener('click', () => runForce());

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
  const savedView = ['watch', 'pulse', 'data', 'etf'].includes(state.settings?.lastView)
    ? state.settings.lastView
    : 'watch';
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
  void maybeAutoSessionAi();
  if (!state.timersStarted) {
    state.timersStarted = true;
    setInterval(refreshAll, REFRESH_MS);
    setInterval(() => refreshMajorNews(false), NEWS_REFRESH_MS);
    setInterval(() => {
      void maybeAutoSessionAi();
    }, 60 * 1000);
  }
}

boot();
