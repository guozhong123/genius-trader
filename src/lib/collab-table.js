/**
 * 协作选股表：
 * - 3 行股票（可输入或从龙虎榜下拉搜索）
 * - 第一列股票名称，表头近 30 天日期
 * - 格子自动填每日涨幅
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const PICKS = 3;
const DAYS = 30;
const ROOM = 'genius-trader-lhb-sheet-v3';
const WS_SERVERS = ['wss://demos.yjs.dev/ws'];

function shanghaiParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  return {
    y: Number(parts.find((p) => p.type === 'year')?.value),
    m: Number(parts.find((p) => p.type === 'month')?.value),
    d: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

function shanghaiYmd(offsetDays) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const { y, m, d } = shanghaiParts();
  return fmt.format(new Date(Date.UTC(y, m - 1, d - offsetDays)));
}

function lastMonthDates() {
  return Array.from({ length: DAYS }, (_, i) => shanghaiYmd(DAYS - 1 - i));
}

function displayDate(ymd) {
  const [, m, d] = String(ymd).split('-');
  return `${m}-${d}`;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function toneClass(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'text-up' : 'text-down';
}

function slotKey(i) {
  return String(i);
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   onStatus?: (s: { synced: boolean; peers: number; error?: string; mode?: string }) => void,
 *   getOptions?: () => { code: string, name: string, market?: string }[],
 *   loadDayChanges?: (stock: { code: string, name: string, market?: string }) => Promise<Record<string, number>>,
 * }} [opts]
 */
export function mountCollabTable(root, opts = {}) {
  if (!root) return { destroy() {}, setOptions() {} };

  const doc = new Y.Doc();
  const picks = doc.getMap('slots');

  let webrtc = null;
  let websocket = null;
  let idb = null;
  let destroyed = false;
  let peers = 0;
  let mode = 'local';
  let remoteLive = false;
  let menuRow = null;
  let menuQuery = '';
  let options = [];
  const changeCache = new Map();
  const loading = new Set();

  const emit = (patch = {}) => {
    opts.onStatus?.({
      synced: remoteLive,
      peers: Math.max(remoteLive ? peers : 1, peers),
      mode,
      ...patch,
    });
  };

  const refreshPeers = () => {
    const set = new Set();
    try {
      for (const id of webrtc?.awareness?.getStates()?.keys?.() || []) set.add(id);
    } catch {
      /* ignore */
    }
    try {
      for (const id of websocket?.awareness?.getStates()?.keys?.() || []) set.add(id);
    } catch {
      /* ignore */
    }
    peers = Math.max(1, set.size);
    if (set.size > 1) remoteLive = true;
    emit();
  };

  try {
    idb = new IndexeddbPersistence(ROOM, doc);
    idb.on('synced', () => {
      emit({ mode });
      render();
      void hydrateChanges();
    });
  } catch (e) {
    console.warn('collab idb', e);
  }

  try {
    webrtc = new WebrtcProvider(ROOM, doc, {
      password: null,
      signaling: [
        'wss://signaling.yjs.dev',
        'wss://y-webrtc-signaling-eu.herokuapp.com',
        'wss://y-webrtc-signaling-us.herokuapp.com',
      ],
      maxConns: 20,
      filterBcConns: true,
    });
    mode = 'webrtc';
    webrtc.awareness.setLocalStateField('user', {
      name: `访客${Math.floor(Math.random() * 900 + 100)}`,
      at: Date.now(),
    });
    webrtc.awareness.on('change', refreshPeers);
    webrtc.on('peers', refreshPeers);
    webrtc.on('status', ({ connected }) => {
      if (connected) {
        mode = 'webrtc';
        remoteLive = true;
      }
      emit();
    });
  } catch (e) {
    console.warn('collab webrtc', e);
  }

  for (const url of WS_SERVERS) {
    try {
      websocket = new WebsocketProvider(url, ROOM, doc, { connect: true });
      websocket.on('status', ({ status }) => {
        if (status === 'connected') {
          mode = 'websocket';
          remoteLive = true;
          emit();
        }
      });
      websocket.on('sync', (synced) => {
        if (synced) {
          remoteLive = true;
          render();
          void hydrateChanges();
          emit();
        }
      });
      websocket.awareness.on('change', refreshPeers);
      break;
    } catch (e) {
      console.warn('collab ws', url, e);
      websocket = null;
    }
  }

  emit();

  function readPick(i) {
    const m = picks.get(slotKey(i));
    return {
      code: String(m?.get?.('code') || ''),
      name: String(m?.get?.('name') || ''),
    };
  }

  function writePick(i, patch) {
    doc.transact(() => {
      let m = picks.get(slotKey(i));
      if (!(m instanceof Y.Map)) {
        m = new Y.Map();
        picks.set(slotKey(i), m);
      }
      if (patch.code != null) m.set('code', String(patch.code));
      if (patch.name != null) m.set('name', String(patch.name));
    });
  }

  function filterOptions(q) {
    const list = typeof opts.getOptions === 'function' ? opts.getOptions() : options;
    const s = String(q || '').trim().toLowerCase();
    const rows = list || [];
    if (!s) return rows.slice(0, 20);
    return rows
      .filter((x) => `${x.name} ${x.code}`.toLowerCase().includes(s))
      .slice(0, 20);
  }

  async function loadChanges(code, name) {
    if (!code || !opts.loadDayChanges) return;
    if (changeCache.has(code) || loading.has(code)) return;
    loading.add(code);
    try {
      const map = await opts.loadDayChanges({ code, name });
      changeCache.set(code, map || {});
      render();
    } catch (e) {
      console.warn('collab kline', e);
      changeCache.set(code, {});
    } finally {
      loading.delete(code);
    }
  }

  async function hydrateChanges() {
    for (let i = 0; i < PICKS; i += 1) {
      const p = readPick(i);
      if (p.code) void loadChanges(p.code, p.name);
    }
  }

  const render = () => {
    if (destroyed || !root.isConnected) return;
    const dates = lastMonthDates();
    const head = `<th class="collab-name-h">名称</th>${dates
      .map((d) => `<th class="collab-date-h">${escapeHtml(displayDate(d))}</th>`)
      .join('')}`;

    const body = Array.from({ length: PICKS }, (_, r) => {
      const pick = readPick(r);
      const shown =
        menuRow === r ? menuQuery : pick.name || pick.code || '';
      const days = pick.code ? changeCache.get(pick.code) || {} : {};
      const tds = dates
        .map((d) => {
          const pct = days[d];
          const pending = pick.code && loading.has(pick.code) && pct == null;
          return `<td class="collab-pct tabular-nums ${toneClass(pct)}">${
            pending ? '…' : escapeHtml(fmtPct(pct))
          }</td>`;
        })
        .join('');
      const open = menuRow === r;
      const hits = open ? filterOptions(menuQuery) : [];
      const menu = open
        ? `<div class="collab-menu" data-menu="${r}">${
            hits.length
              ? hits
                  .map(
                    (h) =>
                      `<button type="button" class="collab-menu-item" data-pick-row="${r}" data-pick-code="${escapeAttr(h.code)}" data-pick-name="${escapeAttr(h.name)}"><b>${escapeHtml(h.name)}</b><span>${escapeHtml(h.code)}</span></button>`,
                  )
                  .join('')
              : `<div class="collab-menu-empty">没有匹配的龙虎榜股票</div>`
          }</div>`
        : '';
      return `<tr>
        <td class="collab-name-cell">
          <input class="collab-name-input" data-pick="${r}" value="${escapeAttr(shown)}" placeholder="输入或搜索股票" spellcheck="false" autocomplete="off" />
          ${menu}
        </td>
        ${tds}
      </tr>`;
    }).join('');

    const active = document.activeElement;
    const focusRow = active?.dataset?.pick;
    const selStart = active?.selectionStart;
    const selEnd = active?.selectionEnd;

    root.innerHTML = `<div class="collab-table-wrap">
      <table class="collab-table collab-table-sheet">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

    if (focusRow != null) {
      const el = root.querySelector(`input[data-pick="${focusRow}"]`);
      if (el) {
        el.focus();
        if (typeof selStart === 'number' && typeof selEnd === 'number') {
          try {
            el.setSelectionRange(selStart, selEnd);
          } catch {
            /* ignore */
          }
        }
      }
    }
  };

  const applyChoice = (row, code, name) => {
    writePick(row, { code, name });
    menuRow = null;
    menuQuery = '';
    if (code) void loadChanges(code, name);
    render();
  };

  function paintMenu(row) {
    const cell = root.querySelector(`input[data-pick="${row}"]`)?.closest('.collab-name-cell');
    if (!cell) return;
    cell.querySelector('.collab-menu')?.remove();
    const hits = filterOptions(menuQuery);
    const menu = document.createElement('div');
    menu.className = 'collab-menu';
    menu.dataset.menu = String(row);
    if (!hits.length) {
      menu.innerHTML = '<div class="collab-menu-empty">没有匹配的龙虎榜股票</div>';
    } else {
      menu.innerHTML = hits
        .map(
          (h) =>
            `<button type="button" class="collab-menu-item" data-pick-row="${row}" data-pick-code="${escapeAttr(h.code)}" data-pick-name="${escapeAttr(h.name)}"><b>${escapeHtml(h.name)}</b><span>${escapeHtml(h.code)}</span></button>`,
        )
        .join('');
    }
    cell.appendChild(menu);
  }

  const onInput = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.dataset.pick == null) return;
    const row = Number(t.dataset.pick);
    menuRow = row;
    menuQuery = t.value;
    paintMenu(row);
  };

  const onFocusIn = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.dataset.pick == null) return;
    menuRow = Number(t.dataset.pick);
    menuQuery = t.value;
    paintMenu(menuRow);
  };

  const onFocusOut = (e) => {
    const next = e.relatedTarget;
    if (next && root.contains(next) && next.closest?.('.collab-menu')) return;
    setTimeout(() => {
      if (destroyed) return;
      const active = document.activeElement;
      if (active && root.contains(active) && (active.dataset.pick != null || active.closest?.('.collab-menu'))) {
        return;
      }
      if (menuRow == null) return;
      const row = menuRow;
      const q = String(menuQuery || '').trim();
      const hits = filterOptions(q);
      const exact = hits.find((h) => h.code === q || h.name === q);
      if (exact) applyChoice(row, exact.code, exact.name);
      else if (q) writePick(row, { code: readPick(row).code, name: q });
      menuRow = null;
      menuQuery = '';
      render();
    }, 120);
  };

  const onPickMouseDown = (e) => {
    const btn = e.target.closest?.('[data-pick-code]');
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    applyChoice(
      Number(btn.getAttribute('data-pick-row')),
      btn.getAttribute('data-pick-code') || '',
      btn.getAttribute('data-pick-name') || '',
    );
  };

  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.dataset.pick == null) return;
    if (e.key === 'Escape') {
      menuRow = null;
      menuQuery = '';
      render();
      return;
    }
    const row = Number(t.dataset.pick);
    const hits = filterOptions(t.value);
    if (hits[0]) applyChoice(row, hits[0].code, hits[0].name);
  };

  root.addEventListener('input', onInput);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('mousedown', onPickMouseDown);
  root.addEventListener('keydown', onKey);

  const observer = () => {
    if (menuRow != null) return;
    render();
    void hydrateChanges();
  };
  picks.observeDeep(observer);
  render();
  refreshPeers();
  void hydrateChanges();

  return {
    setOptions(list) {
      options = Array.isArray(list) ? list : [];
      if (menuRow != null) render();
    },
    refreshChanges() {
      changeCache.clear();
      void hydrateChanges();
    },
    destroy() {
      destroyed = true;
      root.removeEventListener('input', onInput);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('mousedown', onPickMouseDown);
      root.removeEventListener('keydown', onKey);
      picks.unobserveDeep(observer);
      try {
        webrtc?.destroy();
      } catch {
        /* ignore */
      }
      try {
        websocket?.destroy();
      } catch {
        /* ignore */
      }
      try {
        idb?.destroy?.();
      } catch {
        /* ignore */
      }
      doc.destroy();
      root.innerHTML = '';
    },
  };
}
