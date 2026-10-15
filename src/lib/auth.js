const AUTH_KEY = 'gt_auth_session_v1';

/** 本地登录账号（仅个人站简易门禁，非安全鉴权） */
export const AUTH_USER = '大A是泡屎';
export const AUTH_PASS = '666666';

export function isLoggedIn() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data?.user === AUTH_USER && data?.ok === true;
  } catch {
    return false;
  }
}

export function login(user, pass) {
  const u = String(user || '').trim();
  const p = String(pass || '');
  if (u === AUTH_USER && p === AUTH_PASS) {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ ok: true, user: AUTH_USER, at: Date.now() }),
    );
    return { ok: true };
  }
  return { ok: false, message: '账号或密码错误' };
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function currentUser() {
  if (!isLoggedIn()) return null;
  return AUTH_USER;
}
