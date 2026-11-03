// aria2c 子程序 + JSON-RPC 用戶端
'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'https://tracker.gbitt.info:443/announce',
];

// 本機有沒有公網 IPv6（2000::/3）。沒有的話 aria2 連到有 AAAA 紀錄的網站會直接
// 「unreachable network」失敗、不會退回 IPv4，所以要關掉 IPv6。
// 只看網卡，不連任何外部伺服器（隱私權政策承諾只連使用者要下載的網址）。
function hasGlobalIPv6() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv6' && !a.internal && /^[23]/i.test(a.address) && !a.address.toLowerCase().startsWith('2001:0:')) return true;
    }
  }
  return false;
}

class Aria2 extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.bin aria2c 路徑
   * @param {string} opts.dataDir 存 session 的資料夾
   * @param {string} opts.downloadDir 預設下載資料夾
   * @param {number} opts.connections 預設連線數（已依引擎上限夾住）
   * @param {number} opts.speedLimit 全域限速 KB/s
   */
  constructor(opts) {
    super();
    this.opts = opts;
    this.proc = null;
    this.port = 0;
    this.secret = crypto.randomBytes(24).toString('hex');
    this.ready = false;
    this.stopping = false;
    this.restarts = 0;
    this.lastStderr = '';
    this.seq = 0;
  }

  get sessionFile() {
    return path.join(this.opts.dataDir, 'aria2.session');
  }

  async start() {
    this.stopping = false;
    this.port = await freePort();
    // --input-file 指向不存在的檔案會讓 aria2 直接結束，先建一個空的
    fs.mkdirSync(this.opts.dataDir, { recursive: true });
    if (!fs.existsSync(this.sessionFile)) fs.writeFileSync(this.sessionFile, '');
    const c = String(this.opts.connections);
    const args = [
      '--enable-rpc',
      `--rpc-listen-port=${this.port}`,
      `--rpc-secret=${this.secret}`,
      '--rpc-listen-all=false',
      `--input-file=${this.sessionFile}`,
      `--save-session=${this.sessionFile}`,
      '--save-session-interval=30',
      `--dir=${this.opts.downloadDir}`,
      `--split=${c}`,
      `--max-connection-per-server=${c}`,
      '--min-split-size=1M',
      '--continue=true',
      // 佇列由 PGet 自己管，aria2 這邊不限制；啟動時從 session 還原的任務先暫停，交給排程決定
      '--max-concurrent-downloads=1000',
      '--pause=true',
      '--auto-file-renaming=true',
      '--allow-overwrite=false',
      '--file-allocation=none',
      '--max-tries=5',
      '--retry-wait=3',
      '--seed-time=0',
      '--bt-save-metadata=false',
      `--max-overall-download-limit=${this.opts.speedLimit > 0 ? `${this.opts.speedLimit}K` : '0'}`,
      `--stop-with-process=${process.pid}`,
      '--summary-interval=0',
      '--console-log-level=warn',
      '--disk-cache=32M',
      `--disable-ipv6=${hasGlobalIPv6() ? 'false' : 'true'}`,
      // 磁力連結靠 DHT 找人；第一次啟動時 DHT 表是空的，要給入口節點，表也存起來下次沿用
      '--enable-dht=true',
      `--dht-file-path=${path.join(this.opts.dataDir, 'dht.dat')}`,
      '--dht-entry-point=dht.transmissionbt.com:6881',
      '--bt-enable-lpd=true',
      // 很多磁力連結沒有 tracker、只靠 DHT 冷啟動常常找不到人；補一組公開 tracker（只有 BT 任務會用到）
      `--bt-tracker=${PUBLIC_TRACKERS.join(',')}`,
    ];
    this.proc = spawn(this.opts.bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => { this.lastStderr = String(d).slice(-2000); });
    this.proc.stderr.on('data', (d) => { this.lastStderr = String(d).slice(-2000); });
    const proc = this.proc;
    proc.on('error', (err) => {
      this.ready = false;
      this.emit('fatal', err.message);
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.ready = false;
      this.proc = null;
      if (this.stopping) return;
      // 意外結束：重試幾次
      if (this.restarts < 3) {
        this.restarts += 1;
        setTimeout(() => this.start().catch((e) => this.emit('fatal', e.message)), 1500);
      } else {
        this.emit('fatal', `aria2c exited (${code}) ${this.lastStderr.trim()}`);
      }
    });
    await this.waitReady();
    this.ready = true;
    this.emit('ready');
  }

  async waitReady() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error(`aria2c 無法啟動 ${this.lastStderr.trim()}`);
      try {
        await this.call('getVersion');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error('aria2c RPC 逾時');
  }

  // 呼叫 RPC；方法名稱不用加 aria2. 前綴（system.* 例外）
  call(method, ...params) {
    const full = method.includes('.') ? method : `aria2.${method}`;
    const p = full.startsWith('system.') ? params : [`token:${this.secret}`, ...params];
    return this.rpc({ jsonrpc: '2.0', id: String(++this.seq), method: full, params: p });
  }

  // 一次送多個呼叫：calls = [[method, ...params], ...]，回傳每個的結果（錯誤則為 { error }）
  async multicall(calls) {
    if (!calls.length) return [];
    const list = calls.map(([m, ...ps]) => ({ methodName: `aria2.${m}`, params: [`token:${this.secret}`, ...ps] }));
    const res = await this.call('system.multicall', list);
    return res.map((r) => (Array.isArray(r) ? r[0] : { error: r }));
  }

  rpc(body) {
    const data = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        path: '/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: 8000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json.error) {
              const e = new Error(json.error.message);
              e.code = json.error.code;
              reject(e);
            } else resolve(json.result);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('RPC timeout')));
      req.on('error', reject);
      req.end(data);
    });
  }

  async stop() {
    this.stopping = true;
    if (!this.proc) return;
    const proc = this.proc;
    try {
      await this.call('saveSession');
      await this.call('forceShutdown');
    } catch { /* 已經掛了就算了 */ }
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { proc.kill(); } catch {} resolve(); }, 3000);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
    this.proc = null;
    this.ready = false;
  }
}

module.exports = { Aria2 };
