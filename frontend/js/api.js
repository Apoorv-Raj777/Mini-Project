// /js/api.js
const DEFAULT_API_BASE = '/'; // can be overridden by window.__API_URL__ (e.g. 'http://localhost:5000')
const API_BASE = (window.__API_URL__ && window.__API_URL__.replace(/\/$/,'')) || DEFAULT_API_BASE;
const DEFAULT_TIMEOUT = 30000; // ms

async function maybeAttachAuth(headers = {}) {
  try {
    if (typeof getIdToken === 'function') {
      const token = await getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (e) {
    // silent - proceed without auth header
    console.warn('getIdToken error', e);
  }
  return headers;
}

function buildUrl(path, params) {
  const base = path.startsWith('/') ? `${API_BASE.replace(/\/$/, '')}${path}` : (API_BASE + path);
  if (!params || Object.keys(params).length === 0) return base;
  const u = new URL(base, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    u.searchParams.set(k, v);
  });
  return u.toString();
}

async function request(path, { method = 'GET', params = null, body = null, auth = true, headers = {} } = {}) {
  const url = buildUrl(path, params);
  headers = await maybeAttachAuth(headers);

  const opts = { method, headers };

  if (body) {
    if (body instanceof FormData) {
      // leave as is
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
      opts.body = JSON.stringify(body);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  opts.signal = controller.signal;

  const res = await fetch(url, opts).finally(() => clearTimeout(timer));

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error(`API error ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export default {
  get: (path, opts = {}) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' })
};
