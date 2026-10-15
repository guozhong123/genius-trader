import './lib/chrome-polyfill.js';
import './styles.css';
import {
  addItem,
  getSettings,
  getWatchlist,
  importShenqiBundle,
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
  fetchTechLeaders,
  fetchTopMovers,
  fetchUpDownDistribution,
  marketLabel,
  searchSymbols,
  toSecid,
} from './lib/api.js';
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
import { getTodayEvents, getUpcomingEvents } from './lib/calendar.js';
import { buildLevelMarkLines } from './lib/levels.js';
import { normalizeGroups } from './lib/stock-groups.js';
import { analyzeMainForceIntent } from './lib/predict.js';
import { calcValuationBias } from './lib/valuation.js';

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
  briefOpen: false,
  briefTab: 'insight',
  insightOpen: false,
  insightNews: [],
  techLeaders: [],
  eventPanelOpen: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  list: $('list'),
  empty: $('empty'),
  indices: $('indices'),
  indicesBar: $('indices-bar'),
  indicesMobile: $('indices-mobile'),
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
  valuationToggle: $('valuation-toggle'),
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
  document.documentElement.setAttribute('data-theme', theme || 'light');
  renderThemePicker();
}

function renderThemePicker() {
  const cur = state.settings?.theme || 'light';
  els.themePicker.innerHTML = THEMES.map(
    (t) => `
    <button data-theme-id="${t.id}" title="${esc(t.label)}"
      class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition ${cur === t.id ? 'bg-accent text-white' : ''}"
      style="${cur === t.id ? '' : 'color:var(--muted)'}">
      <span class="theme-dot" style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]})"></span>
      <span class="hidden sm:inline">${esc(t.label)}</span>
    </button>`,
  ).join('');
  els.themePicker.querySelectorAll('[data-theme-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.settings = await saveSettings({ theme: btn.dataset.themeId });
      applyTheme(state.settings.theme);
      resizeAllCharts();
    });
  });
}

function setView(view) {
  state.view = view;
  ['watch', 'data', 'etf'].forEach((v) => {
    const el = $(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== view);
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
  requestAnimationFrame(() => resizeAllCharts());
}

function groupsForPrimary() {
  const kind = state.primaryKind;
  const counts = new Map();
  for (const item of state.list) {
    if (item.kind !== kind) continue;
    const gid = item.groupId || 'other';
    counts.set(gid, (counts.get(gid) || 0) + 1);
  }
  const groups = state.settings?.groups || [];
  // 有持仓的分组 + 空分组（方便新建后拖入）
  return groups.map((g) => ({
    ...g,
    count: counts.get(g.id) || 0,
    displayName: displayGroupName(g.name),
  }));
}

function sortedList() {
  let rows = state.list.filter((x) => x.kind === state.primaryKind);
  if (state.secondaryGroup !== 'all') {
    rows = rows.filter((x) => (x.groupId || 'other') === state.secondaryGroup);
  }
  const sortBy = state.settings?.sortBy || 'manual';
  const q = (item) => state.quotes[quoteKey(item)] || {};
  rows.sort((a, b) => {
    if (!!b.pinned - !!a.pinned) return !!b.pinned - !!a.pinned;
    if (sortBy === 'pct') return (q(b).changePct || 0) - (q(a).changePct || 0);
    if (sortBy === 'pctAsc') return (q(a).changePct || 0) - (q(b).changePct || 0);
    if (sortBy === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
    if (sortBy === 'price') return (q(b).price || 0) - (q(a).price || 0);
    return (a.order ?? 0) - (b.order ?? 0);
  });
  return rows;
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
  const mobile = isMobileLayout();
  const expanded = !mobile || state.settings?.mobileGroupsExpanded === true;

  const allBtn = `<button data-group="all" class="rounded-md px-2 py-0.5 text-[11px] font-semibold ${active === 'all' ? 'bg-accent text-white' : 'ring-soft'}" style="${active === 'all' ? '' : 'color:var(--muted)'}">全部</button>`;
  const groupBtns = secs.map(
    (g) =>
      `<button type="button" draggable="${expanded ? 'true' : 'false'}" data-group="${escAttr(g.id)}" data-group-drag="${escAttr(g.id)}" title="单击切换 · 双击改名/删除 · 拖拽排序" class="group-chip rounded-md px-2 py-0.5 text-[11px] font-semibold ${active === g.id ? 'bg-accent text-white' : 'ring-soft'}" style="${active === g.id ? '' : 'color:var(--muted)'}">${esc(g.displayName)} <span style="opacity:.7">${g.count}</span></button>`,
  );
  const addBtn = `<button type="button" id="add-group-btn" class="group-add-btn" title="新建分组">+</button>`;

  if (mobile) {
    const foldLabel = expanded
      ? '收起分组'
      : `分组 · ${esc(activeGroupLabel(secs, active))}`;
    const foldBtn = `<button type="button" id="groups-fold-btn" class="groups-fold-btn" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${foldLabel}</button>`;
    if (expanded) {
      els.groupTabs.innerHTML = [foldBtn, allBtn, ...groupBtns, addBtn].join('');
    } else {
      const current =
        active === 'all'
          ? allBtn
          : groupBtns[secs.findIndex((g) => g.id === active)] || allBtn;
      els.groupTabs.innerHTML = [foldBtn, current, addBtn].join('');
    }
  } else {
    els.groupTabs.innerHTML = [allBtn, ...groupBtns, addBtn].join('');
  }

  $('add-group-btn')?.addEventListener('click', () => addGroupDialog());
  $('groups-fold-btn')?.addEventListener('click', async () => {
    const next = !(state.settings?.mobileGroupsExpanded === true);
    state.settings = await saveSettings({ mobileGroupsExpanded: next });
    renderGroupTabs();
  });

  els.groupTabs.querySelectorAll('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.secondaryGroup = btn.dataset.group;
      renderGroupTabs();
      renderList();
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

function valuationBadgeHtml(item, q) {
  if (state.settings?.showValuationBias === false) return '';
  if (item.kind === 'fund') return '';
  const bias = calcValuationBias(q);
  if (!bias.label) return '';
  const style =
    bias.label === '偏高'
      ? 'background:color-mix(in oklab,var(--up) 14%,transparent);color:var(--up)'
      : bias.label === '偏低'
        ? 'background:color-mix(in oklab,var(--down) 14%,transparent);color:var(--down)'
        : 'background:color-mix(in oklab,var(--muted) 12%,transparent);color:var(--muted)';
  return `<span class="shrink-0 rounded px-1 text-[9px] font-semibold" style="${style}" title="${escAttr(bias.tip)}">${bias.label}</span>`;
}

function syncValuationToggle() {
  const on = state.settings?.showValuationBias !== false;
  const btn = els.valuationToggle;
  if (!btn) return;
  btn.classList.toggle('bg-accent', on);
  btn.classList.toggle('text-white', on);
  btn.style.color = on ? '#fff' : 'var(--muted)';
  btn.textContent = on ? '估值·开' : '估值·关';
}

function rowHtml(item) {
  const q = state.quotes[quoteKey(item)] || {};
  const name = q.name || item.name;
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
  return `
    <article data-open="${escAttr(itemKey(item))}" draggable="${state.settings.sortBy === 'manual'}"
      class="list-row row-compact glass group cursor-pointer rounded-lg">
      <div class="col-name-block">
        <div class="meta min-w-0 overflow-hidden">
        <div class="flex min-w-0 items-center gap-1">
            ${item.pinned ? '<span class="shrink-0 text-[9px] text-accent">顶</span>' : ''}
            <h3 class="truncate text-[13px] font-medium leading-none">${esc(name)}</h3>
            ${valuationBadgeHtml(item, q)}
            ${gname ? `<span class="shrink-0 rounded px-1 text-[9px]" style="background:color-mix(in oklab,var(--muted) 12%,transparent);color:var(--muted)">${esc(gname)}</span>` : ''}
        </div>
          <p class="mt-0.5 truncate text-[10px] leading-none" style="color:var(--muted)">${esc(item.code)}${isFund && q.asOf ? ` · ${esc(q.asOf)}` : ''}</p>
        </div>
        <span class="pct-chip shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums" style="${chip(pct)}">${fmtPct(pct)}</span>
      </div>
      <div class="col-num text-[13px] font-semibold leading-none">${priceLabel}</div>
      <div class="col-actions">
        <button data-move-group="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--muted)" title="改分组">组</button>
        <button data-pin="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--muted)">${item.pinned ? '取消' : '顶'}</button>
        <button data-remove="${escAttr(itemKey(item))}" class="rounded px-1 text-[10px] ring-soft" style="color:var(--up)">删</button>
      </div>
    </article>`;
}

function listHeaderHtml() {
  const sortBy = state.settings?.sortBy || 'manual';
  return `
    <div class="list-head mb-0.5">
      <div class="col-name">
        <span>名称</span>
        <span class="col-sort">
          <button type="button" data-sort-cycle class="active" title="点击切换：不排 → 涨↓ → 跌↑">${sortCycleLabel(sortBy)}</button>
        </span>
      </div>
      <div class="col-num">${state.primaryKind === 'fund' ? '净值/估值' : '现价'}</div>
      <div class="text-right text-[11px]" style="color:var(--muted)">操作</div>
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

  // 「全部」扁平列表，不按主题分组；表头可点排序
  els.list.innerHTML = `
    ${listHeaderHtml()}
    <div class="grid gap-0.5">${rows.map(rowHtml).join('')}</div>`;
  bindListEvents();
}

function bindListEvents() {
  els.list.querySelector('[data-sort-cycle]')?.addEventListener('click', async () => {
    const cur = state.settings?.sortBy || 'manual';
    await setSort(nextSortCycle(cur));
  });

  els.list.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
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
}

function renderSearchResults() {
  if (!state.searchResults.length) {
    els.searchResults.classList.add('hidden');
    els.searchResults.innerHTML = '';
    return;
  }
  els.searchResults.classList.remove('hidden');
  els.searchResults.innerHTML = state.searchResults
    .map((item) => {
      const exists = state.list.some((x) => itemKey(x) === itemKey(item));
      return `<button data-add='${escAttr(JSON.stringify(item))}' class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${exists ? 'opacity-40' : ''}" ${exists ? 'disabled' : ''}>
        <span class="rounded px-1 text-[10px]" style="background:color-mix(in oklab,var(--muted) 12%,transparent);color:var(--muted)">${esc(item.label || marketLabel(item.market))}</span>
        <span class="min-w-0 flex-1 truncate font-medium">${esc(item.name)}</span>
        <span class="font-mono text-[11px]" style="color:var(--muted)">${esc(item.code)}</span>
        <span class="text-[11px] font-semibold text-accent">${exists ? '已有' : '添加'}</span>
      </button>`;
    })
    .join('');

  els.searchResults.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = JSON.parse(btn.getAttribute('data-add'));
      const groupId =
        state.secondaryGroup !== 'all'
          ? state.secondaryGroup
          : state.primaryKind === 'fund'
            ? groupsForPrimary()[0]?.id || 'other'
            : 'other';
      state.list = await addItem({ ...item, groupId });
      if (item.kind === 'stock' || item.kind === 'fund') state.primaryKind = item.kind;
      setView('watch');
      renderPrimaryTabs();
      renderGroupTabs();
      renderList();
      refreshQuotes();
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
  const cards = [
    { label: '两市成交', value: ov?.amountYi, unit: '亿' },
    { label: '主力', value: s?.main, unit: '亿' },
    { label: '超大单', value: s?.huge, unit: '亿' },
    { label: '大单', value: s?.large, unit: '亿' },
    { label: '上涨', value: zd?.up ?? ov?.up, unit: '' },
    { label: '下跌', value: zd?.down ?? ov?.down, unit: '' },
    { label: '北向', value: nb?.last, unit: '亿' },
  ];
  els.flowSummary.innerHTML = cards
    .map((c) => {
      const isCnt = !c.unit;
      const cls = isCnt ? (c.label === '上涨' ? 'text-up' : 'text-down') : tone(c.value);
      const val = isCnt ? String(c.value ?? '—') : fmtYi(c.value);
      return `<div class="glass rounded-lg px-2 py-1">
        <div class="truncate text-[9px]" style="color:var(--muted)">${c.label}${c.unit ? `(${c.unit})` : ''}</div>
        <div class="text-sm font-semibold tabular-nums ${cls}">${val}</div>
      </div>`;
    })
    .join('');
  if (zd) {
    $('zd-summary').innerHTML = `涨 <span class="text-up font-semibold">${zd.up}</span> / 跌 <span class="text-down font-semibold">${zd.down}</span>`;
  }
  if (nb) $('nb-summary').innerHTML = `净流入 <span class="font-semibold ${tone(nb.last)}">${fmtYi(nb.last)} 亿</span>`;
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
    const [flow, updown, northbound, overview] = await Promise.all([
      fetchMarketMoneyFlow(),
      fetchUpDownDistribution(),
      fetchNorthbound(),
      fetchMarketOverview(),
    ]);
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
    <div class="flex items-center gap-2 border-b px-2.5 py-1 text-[10px] font-semibold" style="border-color:var(--line);color:var(--muted)">
      <div class="w-6 shrink-0">#</div>
      <div class="min-w-0 flex-1">名称</div>
      <div class="w-[72px] shrink-0 text-right">现价</div>
      <div class="w-[62px] shrink-0 text-right">涨跌</div>
    </div>
    <div class="max-h-[68vh] overflow-auto">
      ${rows
        .map(
          (r, i) => `<button data-rank-open="${i}" class="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] hover:opacity-80" style="border-bottom:1px solid color-mix(in oklab,var(--line) 55%,transparent)">
            <div class="w-6 shrink-0 text-[10px]" style="color:var(--muted)">${i + 1}</div>
            <div class="min-w-0 flex-1 overflow-hidden">
              <div class="truncate font-medium leading-none">${esc(r.name)}</div>
              <div class="mt-0.5 truncate text-[9px] leading-none" style="color:var(--muted)">${esc(r.code)}</div>
            </div>
            <div class="w-[72px] shrink-0 text-right tabular-nums">${fmtPrice(r.price, r.market)}</div>
            <div class="w-[62px] shrink-0 text-right tabular-nums font-semibold ${tone(r.changePct)}">${fmtPct(r.changePct)}</div>
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

function closeDetail() {
  state.detail = null;
  els.detailRoot.classList.add('hidden');
  els.detailRoot.classList.remove('flex');
  disposeChart(els.chartMain);
  disposeChart(els.chartStockFlow);
}

async function openDetail(item) {
  state.detail = item;
  state.period = 'intraday';
  syncPeriodTabs();
  const q = state.quotes[quoteKey(item)] || item;
  $('detail-name').textContent = q.name || item.name;
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
  // 等弹窗完成布局后再画图，避免首次空白
  await waitFrames(3);
  await refreshDetailCharts();
  await waitFrames(1);
  resizeAllCharts();
}

function currentMarkLine(preClose) {
  return buildLevelMarkLines({ preClose });
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
    const kltMap = { day: 101, week: 102, month: 103, year: 106 };
    const tasks = [
      period === 'intraday'
        ? fetchIntraday(secid)
        : fetchKline(secid, kltMap[period] || 101, period === 'year' ? 40 : 90),
      fetchStockMoneyFlow(secid),
    ];
    const [mainData, flow] = await Promise.all(tasks);

    const axisMode = chartAxisMode();
    const markLine = currentMarkLine(mainData?.preClose);

    // 清空占位后再渲染，保证容器已有尺寸
    els.chartMain.innerHTML = '';
    await waitFrames(1);

    if (period === 'intraday') {
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
            markLine: currentMarkLine(item, auto, intra.preClose),
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
          '<div class="flex h-full flex-col items-center justify-center gap-1 text-sm" style="color:var(--muted)"><span>暂无分时（闭盘也会显示当日走势）</span><span class="text-[11px]">可切换日K，或稍后重试</span></div>';
      }
    } else if (mainData?.points?.length) {
      renderKlineChart(els.chartMain, mainData.points, { markLine });
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
  const events = getUpcomingEvents(new Date(), 21);
  const today = todayStr();
  els.eventPanel.classList.remove('hidden');
  els.eventPanel.innerHTML = `
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-sm font-semibold">近三周宏观事件</div>
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
    await Promise.all([refreshIndices(), refreshQuotes()]);
    if (state.view === 'data') {
      await Promise.all([loadDataCenter(), loadBoards(), loadRank()]);
    }
    if (state.detail) {
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

async function importShenqiData(force = false) {
  if (!force && state.settings?.importedShenqi) return 0;
  try {
    const importUrl = chrome.runtime.getURL('import-shenqi.json');
    const res = await fetch(importUrl);
    if (!res.ok) return 0;
    const bundle = await res.json();
    // fix display names in groups
    bundle.groups = (bundle.groups || []).map((g) => ({
      ...g,
      name: GROUP_NAME_FIX[g.name] || g.name,
    }));
    const result = await importShenqiBundle(bundle);
    state.list = result.list;
    state.settings = result.settings;
    return result.added;
  } catch (e) {
    console.error(e);
    return 0;
  }
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
  renderGroupTabs();
  renderList();
  els.statusText.textContent = `已删除分组「${displayGroupName(g.name)}」`;
}

async function moveItemGroup(item) {
  const groups = state.settings.groups || [];
  const ok = await openDialog({
    title: `移动「${item.name || item.code}」`,
    bodyHtml: `<div class="space-y-1">${groups
      .map(
        (g) => `<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 ring-soft">
        <input type="radio" name="move-gid" value="${escAttr(g.id)}" ${(item.groupId || 'other') === g.id ? 'checked' : ''} />
        <span class="text-sm">${esc(displayGroupName(g.name))}</span>
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
  const ok = await openDialog({
    title: '勾选大盘指数',
    bodyHtml: `<div class="grid max-h-72 grid-cols-2 gap-1.5 overflow-auto">
      ${INDEX_PRESETS.map((p) => {
        const sid = p.secid;
        return `<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-soft">
          <input type="checkbox" data-secid="${escAttr(sid)}" ${selected.has(sid) ? 'checked' : ''} />
          <span class="truncate">${esc(p.name)}</span>
        </label>`;
      }).join('')}
    </div>
    <p class="mt-2 text-[10px]" style="color:var(--muted)">大盘仅在「自选」页显示</p>`,
  });
  if (!ok) return;
  const next = [];
  els.dialogBody.querySelectorAll('input[data-secid]').forEach((input) => {
    if (!input.checked) return;
    const preset = INDEX_PRESETS.find((p) => p.secid === input.getAttribute('data-secid'));
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
  state.settings = await saveSettings({ indices: next.length ? next : [INDEX_PRESETS[0]] });
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

  return `
    <div class="mb-2">
      <div class="text-sm font-semibold">实时简析</div>
      <div class="text-[10px]" style="color:var(--muted)">${marketBits.join(' · ') || '大盘加载中'}</div>
    </div>
    <div class="mb-2 grid grid-cols-2 gap-1.5">
      <div class="rounded-lg px-2 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">全市场上涨</div><div class="text-sm font-semibold text-up">${upCnt}</div></div>
      <div class="rounded-lg px-2 py-1.5 ring-soft"><div class="text-[10px]" style="color:var(--muted)">全市场下跌</div><div class="text-sm font-semibold text-down">${downCnt}</div></div>
    </div>
    ${techHtml}
    <ul class="space-y-1 text-[12px] leading-relaxed">
      ${tips.map((t) => `<li class="pl-2" style="border-left:2px solid var(--accent)">${esc(t)}</li>`).join('')}
    </ul>
    <p class="mt-2 text-[10px]" style="color:var(--muted)">消息与行情仅供参考，不构成投资建议。</p>`;
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
  return n.tone === 'up' || n.tone === 'down';
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
  const events = getUpcomingEvents(new Date(), 21);
  const today = todayStr();
  if (!events.length) {
    return '<p class="text-sm" style="color:var(--muted)">近三周暂无预设事件</p>';
  }
  return `<div class="space-y-1.5">
    ${events
      .map((e) => {
        const isToday = e.date === today;
        const typeColor =
          e.type === 'cpi' ? 'var(--up)' : e.type === 'nfp' ? '#b45309' : 'var(--accent)';
        return `<div class="flex items-start gap-2 rounded-lg px-2 py-1.5 ${isToday ? 'ring-soft' : ''}" style="${isToday ? 'background:color-mix(in oklab,var(--accent) 8%,transparent)' : ''}">
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="color:${typeColor};background:color-mix(in oklab,${typeColor} 12%,transparent)">${e.type.toUpperCase()}</span>
          <div class="min-w-0 flex-1">
            <div class="text-[12px] font-semibold">${esc(e.date)} ${esc(e.title)}${isToday ? ' · 今日' : ''}</div>
            <div class="text-[11px]" style="color:var(--muted)">${esc(e.tip)}</div>
            ${e.impact ? `<div class="mt-0.5 text-[11px] leading-snug"><span class="font-semibold text-accent">影响：</span>${esc(e.impact)}</div>` : ''}
            ${e.result ? `<div class="mt-0.5 text-[10px]" style="color:var(--muted)">状态：${esc(e.result)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}
  </div>
  <p class="mt-2 text-[10px]" style="color:var(--muted)">CPI 日期为常用区间近似，请以美国劳工部/美联储官网为准。仅供风控提示。</p>`;
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
  const payload = {
    groups: state.settings?.groups || [],
    watchlist: state.list,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'genius-trader-export.json';
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
    const [raw, tech] = await Promise.all([fetchMarketNews(6), fetchTechLeaders()]);
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

document.querySelectorAll('.primary-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.primaryKind = tab.dataset.primary;
    state.secondaryGroup = 'all';
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

els.exportBtn?.addEventListener('click', () => exportWatchlistJson());

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
els.valuationToggle?.addEventListener('click', async () => {
  const next = state.settings?.showValuationBias === false;
  state.settings = await saveSettings({ showValuationBias: next });
  syncValuationToggle();
  renderList();
});

document.querySelectorAll('.board-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
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
      state.searchResults = await searchSymbols(value);
    } catch {
      state.searchResults = [];
    }
    renderSearchResults();
  }, 260);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-wrap')) {
    state.searchResults = [];
    renderSearchResults();
  }
});

els.refreshBtn.addEventListener('click', () => refreshAll());
$('detail-close').addEventListener('click', closeDetail);
els.detailMask.addEventListener('click', closeDetail);
els.dialogCancel.addEventListener('click', () => closeDialog(false));
els.dialogOk.addEventListener('click', () => {
  // 先读表单再关，避免偶发清空
  closeDialog(true);
});
els.dialogMask.addEventListener('click', () => closeDialog(false));

$('import-btn')?.addEventListener('click', async () => {
  const ok = await confirmDialog('导入神器自选', '将合并导入股票/基金与分组（已有代码不重复）。继续？');
  if (!ok) return;
  const added = await importShenqiData(true);
  renderPrimaryTabs();
  renderGroupTabs();
  renderList();
  await refreshQuotes();
  els.statusText.textContent = added > 0 ? `新导入 ${added} 只` : '没有新增（可能已全部导入）';
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

async function boot() {
  state.settings = await getSettings();
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
  const added = await importShenqiData(false);
  // 仅清理历史「未分组/默认」，不再按主题强制重分（避免分组来回变、删不掉）
  {
    const norm = normalizeGroups(state.settings.groups, state.list);
    if (norm.changed) {
      await setWatchlist(norm.list);
      state.list = norm.list;
      state.settings = await saveSettings({ groups: norm.groups });
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
  syncValuationToggle();
  if (state.settings?.funFlowNames && els.funNamesBtn) {
    els.funNamesBtn.classList.add('bg-accent', 'text-white');
  }
  state.primaryKind = 'stock';
  state.insightNews = state.settings.cachedNews || [];
  setView('watch');
  renderPrimaryTabs();
  renderGroupTabs();
  renderList();
  renderStatus();
  syncBriefUnreadUi();
  renderEventBanner();
  if (added > 0) els.statusText.textContent = `已导入神器自选 ${added} 只`;
  await Promise.all([refreshAll(), refreshMajorNews(false)]);
  setInterval(refreshAll, REFRESH_MS);
  setInterval(() => refreshMajorNews(false), NEWS_REFRESH_MS);
}

boot();
