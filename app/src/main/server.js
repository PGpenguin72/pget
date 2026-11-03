// 給瀏覽器擴充功能用的本機 HTTP 端點（協定見 docs/protocol.md）
// 只綁 127.0.0.1；只接受 chrome-extension:// 來源；/add 需要 token
'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const PORTS = [17890, 17891, 17892, 17893, 17894, 17895, 17896, 17897, 17898, 17899];
const PROTOCOL = 1;
const MAX_BODY = 256 * 1024;
const PAIR_TIMEOUT_MS = 60_000;
const KINDS = new Set(['auto', 'http', 'video', 'torrent', 'magnet']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class LocalServer {
  /**
   * @param {object} o
   * @param {string} o.version
   * @param {import('./settings').Settings} o.settings
   * @param {(client: string, signal: AbortSignal) => Promise<boolean>} o.confirmPair 跳確認視窗
   * @param {(req: object) => string} o.onAdd 新增任務，回傳 id
   */
  constructor(o) {
    this.o = o;
    this.server = null;
    this.port = 0;
    this.pairing = false;
  }

  async start() {
    for (const port of PORTS) {
      try {
        await this.listen(port);
        this.port = port;
        return port;
      } catch (err) {
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      }
    }
    throw new Error('ports 17890-17899 are all in use');
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res).catch((err) => {
        console.error('[server]', err);
        this.send(res, 500, { error: 'internal' });
      }));
      srv.requestTimeout = 90_000; // 配對要等使用者按，給多一點時間
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        srv.removeListener('error', reject);
        this.server = srv;
        resolve();
      });
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  send(res, code, body, origin) {
    if (res.headersSent) return;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    res.writeHead(code, headers);
    res.end(JSON.stringify(body));
  }

  async handle(req, res) {
    const origin = req.headers.origin || '';
    // 擋 DNS rebinding：Host 必須是本機
    const host = String(req.headers.host || '').toLowerCase();
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${this.port}$`).test(host)) {
      return this.send(res, 403, { error: 'forbidden' });
    }
    // 有 Origin 就只允許擴充功能（Chrome／Edge 都是 chrome-extension://）。
    // 擴充功能對有主機權限的網址發 GET 時，瀏覽器會當成特權請求、不帶 Origin，所以沒有 Origin 也放行；
    // 網頁的跨來源請求一定會帶 Origin，會在這裡被擋，/add 另外還要 token。
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      return this.send(res, 403, { error: 'forbidden' });
    }

    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

    if (req.method === 'OPTIONS') {
      const h = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-PGet-Token',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      };
      if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';
      res.writeHead(204, h);
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/ping') {
      return this.send(res, 200, { app: 'PGet', version: this.o.version, protocol: PROTOCOL }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/pair') {
      const body = await this.readBody(req).catch(() => null);
      if (!body) return this.send(res, 400, { error: 'bad request' }, origin);
      // 同時只處理一個配對請求，避免被狂跳視窗
      if (this.pairing) return this.send(res, 403, { error: 'denied' }, origin);
      this.pairing = true;
      const client = String(body.client || 'Unknown extension').replace(/[\x00-\x1f]/g, ' ').slice(0, 120);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PAIR_TIMEOUT_MS);
      let ok = false;
      try {
        ok = await this.o.confirmPair(client, ac.signal);
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
        this.pairing = false;
      }
      if (!ok || ac.signal.aborted) return this.send(res, 403, { error: 'denied' }, origin);
      const token = crypto.randomBytes(32).toString('hex');
      const list = this.o.settings.get('pairedClients').slice();
      list.push({ id: crypto.randomBytes(6).toString('hex'), client, origin, tokenHash: sha256(token), createdAt: Date.now(), lastUsed: 0 });
      this.o.settings.set({ pairedClients: list });
      return this.send(res, 200, { token }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/add') {
      const entry = this.checkToken(req.headers['x-pget-token']);
      if (!entry) return this.send(res, 401, { error: 'unauthorized' }, origin);
      const body = await this.readBody(req).catch(() => null);
      if (!body || typeof body.url !== 'string') return this.send(res, 400, { error: 'bad request' }, origin);
      const kind = KINDS.has(body.kind) ? body.kind : 'auto';
      try {
        const id = await this.o.onAdd({
          url: body.url,
          filename: typeof body.filename === 'string' ? body.filename : '',
          referrer: typeof body.referrer === 'string' ? body.referrer : '',
          cookies: typeof body.cookies === 'string' ? body.cookies : '',
          userAgent: typeof body.userAgent === 'string' ? body.userAgent : '',
          size: Number(body.size) || 0,
          mime: typeof body.mime === 'string' ? body.mime : '',
          kind,
        });
        entry.lastUsed = Date.now();
        this.o.settings.set({ pairedClients: this.o.settings.get('pairedClients') });
        return this.send(res, 200, { id }, origin);
      } catch (err) {
        return this.send(res, 400, { error: String(err.message || err) }, origin);
      }
    }

    return this.send(res, 404, { error: 'not found' }, origin);
  }

  checkToken(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
    const h = Buffer.from(sha256(token), 'hex');
    for (const c of this.o.settings.get('pairedClients')) {
      const ch = Buffer.from(c.tokenHash || '', 'hex');
      if (ch.length === h.length && crypto.timingSafeEqual(ch, h)) return c;
    }
    return null;
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const json = text ? JSON.parse(text) : {};
          resolve(json && typeof json === 'object' ? json : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
}

module.exports = { LocalServer, PORTS };
