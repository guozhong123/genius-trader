/**
 * 云端自选同步：GitHub sync/bundle.json 为唯一数据源。
 * - 读：公开 raw（加密），登录密码解密
 * - 写：GitHub Contents API（需 fine-grained PAT）；令牌可加密后随 bundle 下发到其它设备
 * 本机不再把 watchlist/settings 当权威存储。
 */

import { AUTH_PASS } from './auth.js';

export const SYNC_OWNER = 'guozhong123';
export const SYNC_REPO = 'genius-trader';
export const SYNC_PATH = 'sync/bundle.json';
export const SYNC_BRANCH = 'main';

const RAW_URLS = [
  () =>
    `https://raw.githubusercontent.com/${SYNC_OWNER}/${SYNC_REPO}/${SYNC_BRANCH}/${SYNC_PATH}?_=${Date.now()}`,
  () =>
    `https://cdn.jsdelivr.net/gh/${SYNC_OWNER}/${SYNC_REPO}@${SYNC_BRANCH}/${SYNC_PATH}?_=${Date.now()}`,
];

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload(obj, password = AUTH_PASS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    v: 1,
    updatedAt: obj.updatedAt || Date.now(),
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(cipher),
  };
}

export async function decryptPayload(envelope, password = AUTH_PASS) {
  if (!envelope?.ciphertext || !envelope?.salt || !envelope?.iv) return null;
  const salt = fromB64(envelope.salt);
  const iv = fromB64(envelope.iv);
  const key = await deriveKey(password, salt);
  const cipher = fromB64(envelope.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function pullCloudBundle() {
  let lastErr = null;
  for (const makeUrl of RAW_URLS) {
    try {
      const res = await fetch(makeUrl(), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (res.status === 404) return { empty: true, envelope: null, payload: null };
      if (!res.ok) {
        lastErr = new Error(`pull ${res.status}`);
        continue;
      }
      const text = (await res.text()).trim();
      if (!text || text === '{}') return { empty: true, envelope: null, payload: null };
      const envelope = JSON.parse(text);
      if (!envelope.ciphertext) return { empty: true, envelope, payload: null };
      const payload = await decryptPayload(envelope);
      return { empty: false, envelope, payload };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('云端拉取失败');
}

async function getRemoteMeta(token) {
  const res = await fetch(
    `https://api.github.com/repos/${SYNC_OWNER}/${SYNC_REPO}/contents/${SYNC_PATH}?ref=${SYNC_BRANCH}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (res.status === 404) return { sha: null };
  if (!res.ok) throw new Error(`读云端元数据失败 ${res.status}`);
  const json = await res.json();
  return { sha: json.sha || null };
}

export async function pushCloudBundle(payload, token) {
  const key = String(token || '').trim();
  if (!key) throw new Error('缺少同步令牌，无法写入云端');
  const body = {
    ...payload,
    updatedAt: Date.now(),
  };
  const envelope = await encryptPayload(body);
  const meta = await getRemoteMeta(key);
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(envelope, null, 2))));
  const res = await fetch(
    `https://api.github.com/repos/${SYNC_OWNER}/${SYNC_REPO}/contents/${SYNC_PATH}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${key}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `sync: user bundle ${new Date().toISOString()}`,
        content,
        branch: SYNC_BRANCH,
        ...(meta.sha ? { sha: meta.sha } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`云端写入失败 ${res.status}: ${text.slice(0, 180)}`);
  }
  return body.updatedAt;
}

/** 可上云的设置字段（不含密钥与本机缓存） */
export const CLOUD_SETTING_KEYS = [
  'theme',
  'viewMode',
  'sortBy',
  'activeGroup',
  'groups',
  'indices',
  'chartAxisMode',
  'funFlowNames',
  'predictOpen',
  'aiModel',
  'aiReports',
  'aiHistory',
  'aiHistoryMigrated',
  'aiAutoDone',
  'mobileGroupsExpanded',
  'lastView',
  'lastPrimary',
  'lastGroup',
  'planPool',
  'predictPack',
  'simBook',
  'eventBannerDismissDate',
  'stopBannerDismissed',
  'briefModalTab',
  'newsSidebarOpen',
];

export function pickCloudSettings(settings) {
  const out = {};
  for (const k of CLOUD_SETTING_KEYS) {
    if (settings && settings[k] !== undefined) out[k] = settings[k];
  }
  return out;
}
