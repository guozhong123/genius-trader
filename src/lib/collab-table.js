/**
 * 多人在线可编辑空白表：
 * - IndexedDB 本机持久化
 * - WebRTC 多人实时同步（同房间打开即可互相同步）
 * - WebSocket 兜底（可用时自动连）
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const COLS = 8;
const ROWS = 16;
const DEFAULT_HEADERS = ['代码', '名称', '方向', '逻辑', '仓位', '备注', '跟进', '结果'];
const ROOM = 'genius-trader-lhb-sheet-v1';
const WS_FALLBACKS = ['wss://demos.yjs.dev'];

function ensureGrid(ymap) {
  if (!ymap.has('headers')) {
    const headers = new Y.Array();
    headers.insert(0, DEFAULT_HEADERS.slice());
    ymap.set('headers', headers);
  }
  if (!ymap.has('cells')) {
    const cells = new Y.Array();
    for (let r = 0; r < ROWS; r += 1) {
      const row = new Y.Array();
      row.insert(0, Array.from({ length: COLS }, () => ''));
      cells.push([row]);
    }
    ymap.set('cells', cells);
  }
}

function cellKey(r, c) {
  return `${r}:${c}`;
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
  const ymap = doc.getMap('sheet');
  ensureGrid(ymap);

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

  const headers = () => ymap.get('headers');
  const cells = () => ymap.get('cells');

  const render = () => {
    if (destroyed || !root.isConnected) return;
    const h = headers();
    const grid = cells();
    if (!h || !grid) return;

    const headHtml = Array.from({ length: COLS }, (_, c) => {
      const val = h.get(c) ?? DEFAULT_HEADERS[c] ?? '';
      return `<th><input data-h="${c}" value="${escapeAttr(val)}" spellcheck="false" /></th>`;
    }).join('');

    const bodyHtml = Array.from({ length: Math.max(ROWS, grid.length) }, (_, r) => {
      const row = grid.get(r);
      const tds = Array.from({ length: COLS }, (_, c) => {
        const val = row?.get?.(c) ?? '';
        return `<td><input data-r="${r}" data-c="${c}" value="${escapeAttr(val)}" spellcheck="false" /></td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');

    const active = document.activeElement;
    const focusKey =
      active?.dataset?.r != null
        ? cellKey(active.dataset.r, active.dataset.c)
        : active?.dataset?.h != null
          ? `h:${active.dataset.h}`
          : null;
    const selStart = active?.selectionStart;
    const selEnd = active?.selectionEnd;

    root.innerHTML = `<div class="collab-table-wrap">
      <table class="collab-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;

    if (focusKey) {
      const el = focusKey.startsWith('h:')
        ? root.querySelector(`input[data-h="${focusKey.slice(2)}"]`)
        : root.querySelector(
            `input[data-r="${focusKey.split(':')[0]}"][data-c="${focusKey.split(':')[1]}"]`,
          );
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
    localEdit = true;
    if (t.dataset.h != null) {
      const c = Number(t.dataset.h);
      const h = headers();
      if (!h) return;
      doc.transact(() => {
        if (h.length <= c) h.insert(h.length, Array.from({ length: c - h.length + 1 }, () => ''));
        h.delete(c, 1);
        h.insert(c, [t.value]);
      });
    } else if (t.dataset.r != null && t.dataset.c != null) {
      const r = Number(t.dataset.r);
      const c = Number(t.dataset.c);
      const grid = cells();
      if (!grid) return;
      doc.transact(() => {
        while (grid.length <= r) {
          const row = new Y.Array();
          row.insert(0, Array.from({ length: COLS }, () => ''));
          grid.push([row]);
        }
        const row = grid.get(r);
        if (!row) return;
        while (row.length <= c) row.insert(row.length, ['']);
        row.delete(c, 1);
        row.insert(c, [t.value]);
      });
    }
    queueMicrotask(() => {
      localEdit = false;
    });
  };

  root.addEventListener('input', onInput);
  const observer = () => {
    if (localEdit) return;
    render();
  };
  ymap.observeDeep(observer);
  render();
  refreshPeers();

  return {
    destroy() {
      destroyed = true;
      root.removeEventListener('input', onInput);
      ymap.unobserveDeep(observer);
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
