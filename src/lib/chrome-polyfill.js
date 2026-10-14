/**
 * 网页端兼容：无 Chrome 扩展环境时用 localStorage 模拟 storage，
 * 并用相对路径替代 chrome.runtime.getURL
 */
(function installChromePolyfill() {
  if (typeof globalThis.chrome?.storage?.local?.get === 'function') return;

  const mem = {};
  const read = (key) => {
    try {
      const raw = localStorage.getItem(`gt:${key}`);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return mem[key];
    }
  };
  const write = (key, value) => {
    mem[key] = value;
    try {
      localStorage.setItem(`gt:${key}`, JSON.stringify(value));
    } catch {
      /* quota */
    }
  };

  const local = {
    async get(keys) {
      if (keys == null) return { ...mem };
      if (typeof keys === 'string') return { [keys]: read(keys) };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = read(k);
        return out;
      }
      const out = { ...keys };
      for (const k of Object.keys(keys)) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items || {})) write(k, v);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        delete mem[k];
        localStorage.removeItem(`gt:${k}`);
      }
    },
  };

  globalThis.chrome = {
    storage: { local },
    runtime: {
      getURL(path) {
        const base = import.meta.env.BASE_URL || './';
        return new URL(path.replace(/^\//, ''), new URL(base, location.href)).href;
      },
      id: 'web',
    },
  };
})();
