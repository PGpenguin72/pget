// Client side of the PGet extension <-> desktop protocol v1 (docs/protocol.md).
// The ONLY network destination of this extension is http://127.0.0.1:17890-17899.
import { getToken, setToken, clearToken } from './settings.js';

export const PORT_FIRST = 17890;
export const PORT_LAST = 17899;
export const PROTOCOL_VERSION = 1;

const PING_TIMEOUT_MS = 800;
const ADD_TIMEOUT_MS = 10000;
const PAIR_TIMEOUT_MS = 75000;      // desktop waits up to 60 s for the user
const PORT_CACHE_MS = 30000;

export class PGetError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'not_running' | 'not_paired' | 'unauthorized' | 'denied' | 'bad_response' | 'network'
  }
}

let cached = { port: null, info: null, at: 0 };

function base(port) {
  return `http://127.0.0.1:${port}`;
}

async function fetchJson(url, { timeout, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function pingPort(port) {
  const { status, body } = await fetchJson(`${base(port)}/ping`, { timeout: PING_TIMEOUT_MS });
  if (status === 200 && body && body.app === 'PGet' && body.protocol === PROTOCOL_VERSION) {
    return { port, info: body };
  }
  throw new PGetError('bad_response');
}

/**
 * Find the running PGet app. Tries the cached port first, then probes
 * 17890-17899 in parallel and takes the lowest port that answers correctly.
 * Resolves to { port, info } or null when PGet is not running.
 */
export async function discover({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached.port && now - cached.at < PORT_CACHE_MS) return { port: cached.port, info: cached.info };
  if (cached.port) {
    try {
      const hit = await pingPort(cached.port);
      cached = { ...hit, at: Date.now() };
      return hit;
    } catch { /* fall through to full probe */ }
  }
  const ports = [];
  for (let p = PORT_FIRST; p <= PORT_LAST; p++) ports.push(p);
  const results = await Promise.allSettled(ports.map(pingPort));
  const hit = results.find((r) => r.status === 'fulfilled');
  if (!hit) {
    cached = { port: null, info: null, at: 0 };
    return null;
  }
  cached = { ...hit.value, at: Date.now() };
  return hit.value;
}

export function forgetPort() {
  cached = { port: null, info: null, at: 0 };
}

/** 'connected' | 'not_running' | 'not_paired', plus app info when reachable. */
export async function getStatus({ force = false } = {}) {
  const found = await discover({ force });
  if (!found) return { state: 'not_running' };
  const token = await getToken();
  return { state: token ? 'connected' : 'not_paired', version: found.info.version, port: found.port };
}

export function clientName() {
  const version = chrome.runtime.getManifest().version;
  const ua = navigator.userAgent;
  let browser = 'Chromium';
  const brands = navigator.userAgentData?.brands || [];
  const named = brands.find((b) => /Edge|Chrome|Opera|Brave|Vivaldi/i.test(b.brand) && !/Not/i.test(b.brand));
  if (named) browser = `${named.brand.replace(/^Microsoft /, '').replace(/^Google /, '')} ${named.version}`;
  else {
    const m = ua.match(/Edg\/(\d+)/) || ua.match(/Chrome\/(\d+)/);
    if (m) browser = `${/Edg\//.test(ua) ? 'Edge' : 'Chrome'} ${m[1]}`;
  }
  return `${browser} / PGet Extension ${version}`;
}

/** POST /pair. Resolves when the user approves in the desktop app. */
export async function pair() {
  const found = await discover({ force: true });
  if (!found) throw new PGetError('not_running');
  let res;
  try {
    res = await fetchJson(`${base(found.port)}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: clientName() }),
      timeout: PAIR_TIMEOUT_MS,
    });
  } catch {
    throw new PGetError('network');
  }
  if (res.status === 200 && res.body && typeof res.body.token === 'string' && /^[0-9a-f]{16,}$/i.test(res.body.token)) {
    await setToken(res.body.token);
    return true;
  }
  if (res.status === 403) throw new PGetError('denied');
  throw new PGetError('bad_response');
}

async function postAdd(port, token, payload) {
  return fetchJson(`${base(port)}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PGet-Token': token },
    body: JSON.stringify(payload),
    timeout: ADD_TIMEOUT_MS,
  });
}

/**
 * POST /add. Resolves to the task id. Throws PGetError on any failure so the
 * caller can fall back to the browser. A 401 clears the stored token.
 */
export async function addDownload(payload) {
  const token = await getToken();
  if (!token) throw new PGetError('not_paired');
  let found = await discover();
  if (!found) throw new PGetError('not_running');
  let res;
  try {
    res = await postAdd(found.port, token, payload);
  } catch {
    // The app may have restarted on a different port: probe once more.
    forgetPort();
    found = await discover({ force: true });
    if (!found) throw new PGetError('not_running');
    try {
      res = await postAdd(found.port, token, payload);
    } catch {
      throw new PGetError('network');
    }
  }
  if (res.status === 401) {
    await clearToken();
    throw new PGetError('unauthorized');
  }
  if (res.status === 200 && res.body && res.body.id != null) return String(res.body.id);
  throw new PGetError('bad_response');
}
