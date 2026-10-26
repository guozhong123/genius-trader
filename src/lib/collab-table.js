/**
 * 多人在线空白表：
 * - 无表头
 * - 第一列永远自动填最近 30 个自然日（北京时间）
 * - 其余格子可多人编辑（IndexedDB + WebRTC，日期键持久化）
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const COLS = 6;
const DAYS = 30;
const ROOM = 'genius-trader-lhb-sheet-v2';
const WS_FALLBACKS = ['wss://demos.yjs.dev'];

function shanghaiYmd(offsetDays) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  const utc = Date.UTC(y, m - 1, d - offsetDays);
  return fmt.format(new Date(utc));
}

function lastMonthDates() {
  return Array.from({ length: DAYS }, (_, i) => shanghaiYmd(i));
}

function weekdayLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 4)).getUTCDay();
  return ['日', '一', '二', '三', '四', '五', '六'][wd] || '';
}

function displayDate(ymd) {
  const [, m, d] = String(ymd).split('-');
  return `${m}-${d} 周${weekdayLabel(ymd)}`;
}

function emptyRow() {
  return Array.from({ length: COLS }, () => '');
}

function ensureRow(notes, date) {
  if (notes.has(date)) return notes.get(date);
  const row = new Y.Array();
  row.insert(0, emptyRow());
  notes.set(date, row);
  return row;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {HTMLElement} root
 * @param {{ onStatus?: (s: { synced: boolean; peers: number; error?: string; mode?: string }) => void }} [opts]
 */
export function mountCollabTable(root, opts = {}) {
  if (!root) return { destroy() {} };

  const doc = new Y.Doc();
  const notes = doc.getMap('notes');

  let webrtc = null;
  let websocket = null;
  let idb = null;
  let destroyed = false;
  let peers = 0;
  let mode = 'local';

  const emit = (patch = {}) => {
    opts.onStatus?.({
      synced: mode !== 'local' || !!idb,
      peers,
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
    emit();
  };

  try {
    idb = new IndexeddbPersistence(ROOM, doc);
    idb.on('synced', () => emit({ mode }));
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
      if (connected) mode = 'webrtc';
      emit();
    });
  } catch (e) {
    console.warn('collab webrtc', e);
  }

  for (const url of WS_FALLBACKS) {
    try {
      websocket = new WebsocketProvider(url, ROOM, doc, { connect: true });
      websocket.on('status', ({ status }) => {
        if (status === 'connected') {
          mode = 'websocket';
          emit();
        }
      });
      websocket.on('sync', (synced) => {
        if (synced) emit();
      });
      websocket.awareness.on('change', refreshPeers);
      break;
    } catch (e) {
      console.warn('collab ws', url, e);
      websocket = null;
    }
  }

  emit();

  const render = () => {
    if (destroyed || !root.isConnected) return;
    const dates = lastMonthDates();
    const bodyHtml = dates
      .map((date, r) => {
        const row = notes.get(date);
        const dateCell = `<td class="collab-date">${escapeAttr(displayDate(date))}</td>`;
        const tds = Array.from({ length: COLS }, (_, c) => {
          const val = row?.get?.(c) ?? '';
          return `<td><input data-date="${escapeAttr(date)}" data-r="${r}" data-c="${c}" value="${escapeAttr(val)}" spellcheck="false" /></td>`;
        }).join('');
        return `<tr>${dateCell}${tds}</tr>`;
      })
      .join('');

    const active = document.activeElement;
    const focusDate = active?.dataset?.date;
    const focusCol = active?.dataset?.c;
    const selStart = active?.selectionStart;
    const selEnd = active?.selectionEnd;

    root.innerHTML = `<div class="collab-table-wrap">
      <table class="collab-table collab-table-dates">
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;

    if (focusDate != null && focusCol != null) {
      const el = root.querySelector(`input[data-date="${focusDate}"][data-c="${focusCol}"]`);
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

  let localEdit = false;
  const onInput = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const date = t.dataset.date;
    const c = Number(t.dataset.c);
    if (!date || Number.isNaN(c)) return;
    localEdit = true;
    doc.transact(() => {
      const row = ensureRow(notes, date);
      while (row.length <= c) row.insert(row.length, ['']);
      row.delete(c, 1);
      row.insert(c, [t.value]);
    });
    queueMicrotask(() => {
      localEdit = false;
    });
  };

  root.addEventListener('input', onInput);
  const observer = () => {
    if (localEdit) return;
    render();
  };
  notes.observeDeep(observer);
  render();
  refreshPeers();

  return {
    destroy() {
      destroyed = true;
      root.removeEventListener('input', onInput);
      notes.unobserveDeep(observer);
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
