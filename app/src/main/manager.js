// 任務管理：統一的任務模型、佇列排程、aria2 狀態同步、連線數自動降級
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app } = require('electron');

const { Aria2 } = require('./aria2');
const { JsonStore } = require('./settings');
const { VideoJob, probe, isVideoUrl, removeVideoFiles } = require('./ytdlp');

// 狀態：queued（排隊）、active（下載中）、paused、completed、error
const FINAL = new Set(['completed']);
// 連線數降級階梯
const FALLBACK_STEPS = [32, 16, 8, 4];
// 統計用：每幾次 tick（約幾秒）向 aria2 取樣一次各連線速度
const SAMPLE_EVERY = 3;

const newGid = () => crypto.randomBytes(8).toString('hex');
const newId = () => crypto.randomBytes(6).toString('hex');

function guessKind(url, kind) {
  if (kind && kind !== 'auto') return kind;
  if (/^magnet:/i.test(url)) return 'magnet';
  if (/\.torrent(\?|#|$)/i.test(url)) return 'torrent';
  if (isVideoUrl(url)) return 'video';
  return 'http';
}

function nameFromUrl(url) {
  try {
    if (/^magnet:/i.test(url)) {
      const dn = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn');
      return dn || 'magnet';
    }
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch {
    return url.slice(0, 80);
  }
}

// 檔名只留最後一段，去掉路徑字元，避免 ../ 之類的把檔案寫到別處
function safeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  const base = name.split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').trim();
  return base === '.' || base === '..' ? '' : base.slice(0, 240);
}

function isAllowedUrl(url) {
  return typeof url === 'string' && /^(https?|ftp|sftp|magnet):/i.test(url) && url.length < 65536;
}

class Manager extends EventEmitter {
  constructor({ settings, engines, t }) {
    super();
    this.settings = settings;
    this.engines = engines;
    this.t = t;
    this.store = new JsonStore('tasks.json');
    this.tasks = new Map();
    this.jobs = new Map(); // id → VideoJob
    this.aria2 = null;
    this.aria2Error = null;
    this.timer = null;
    this.speed = 0;
    this.tickCount = 0;
    this.lastTickAt = 0;
    this.sampling = false;
    for (const task of this.store.load() || []) {
      // 上次正在跑的影片程序已經不在了：回到排隊
      if (task.kind === 'video' && task.status === 'active') task.status = 'queued';
      task.downloadSpeed = 0;
      task.connectionsNow = 0;
      this.tasks.set(task.id, task);
    }
  }

  get maxConnections() {
    return this.engines.aria2.found ? this.engines.aria2.maxConnections : 128;
  }

  clampConn(n) {
    return Math.max(1, Math.min(this.maxConnections, Math.round(Number(n) || this.settings.get('connections'))));
  }

  async start() {
    if (this.engines.aria2.found) {
      this.aria2 = new Aria2({
        bin: this.engines.aria2.path,
        dataDir: app.getPath('userData'),
        downloadDir: this.settings.get('downloadDir'),
        connections: this.clampConn(this.settings.get('connections')),
        speedLimit: this.settings.get('speedLimit'),
      });
      this.aria2.on('fatal', (msg) => {
        this.aria2Error = msg;
        this.emitStatus();
      });
      this.aria2.on('ready', () => {
        this.aria2Error = null;
        this.emitStatus();
      });
      try {
        await this.aria2.start();
      } catch (err) {
        this.aria2Error = err.message;
      }
    }
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[tick]', e)), 1000);
    this.tick().catch(() => {});
  }

  async stop() {
    clearInterval(this.timer);
    for (const job of this.jobs.values()) job.stop();
    if (this.aria2) await this.aria2.stop();
    this.persist(true);
  }

  // ---------- 對外 API ----------

  list() {
    return [...this.tasks.values()].map((t) => {
      const { headers, stat, ...rest } = t; // cookie 與統計用的內部資料不送給介面
      return rest;
    });
  }

  engineStatus() {
    return {
      ...this.engines,
      aria2Running: Boolean(this.aria2 && this.aria2.ready),
      aria2Error: this.aria2Error,
      maxConnections: this.maxConnections,
    };
  }

  /**
   * 新增任務
   * @param {object} req { url, filename, dir, connections, speedLimit, referrer, cookies, userAgent, kind, quality, torrent(base64), size }
   */
  add(req) {
    const kind = req.torrent ? 'torrent-file' : guessKind(req.url, req.kind);
    if (kind !== 'torrent-file' && !isAllowedUrl(req.url)) throw new Error(this.t('error.badUrl'));
    if (kind === 'video' && !this.engines.ytdlp.found) throw new Error(this.t('error.noYtdlp'));
    if (kind !== 'video' && !this.engines.aria2.found) throw new Error(this.t('error.noAria2'));
    const dir = req.dir && path.isAbsolute(req.dir) ? req.dir : this.settings.get('downloadDir');
    const filename = safeFilename(req.filename);
    const task = {
      id: newId(),
      kind,
      url: req.url || '',
      name: filename || req.torrentName || nameFromUrl(req.url || ''),
      filename,
      dir,
      connections: this.clampConn(req.connections),
      speedLimit: Math.max(0, Math.round(Number(req.speedLimit) || 0)),
      status: 'queued',
      totalLength: Number(req.size) || 0,
      completedLength: 0,
      downloadSpeed: 0,
      connectionsNow: 0,
      error: '',
      createdAt: Date.now(),
      finishedAt: 0,
      gid: kind === 'video' ? null : newGid(),
      files: [],
      headers: {
        referrer: typeof req.referrer === 'string' ? req.referrer : '',
        cookies: typeof req.cookies === 'string' ? req.cookies : '',
        userAgent: typeof req.userAgent === 'string' ? req.userAgent : '',
      },
      video: kind === 'video' ? { quality: req.quality || this.settings.get('videoQuality') } : null,
      torrent: req.torrent || null, // .torrent 內容（base64），重新加入時要用
    };
    fs.mkdirSync(dir, { recursive: true });
    this.tasks.set(task.id, task);
    this.persist();
    this.tick().catch(() => {});
    return task.id;
  }

  async probeVideo(req) {
    if (!this.engines.ytdlp.found) throw new Error(this.t('error.noYtdlp'));
    if (!isAllowedUrl(req.url)) throw new Error(this.t('error.badUrl'));
    return probe(this.engines.ytdlp.path, { ...req, ffmpeg: this.engines.ffmpeg.found ? this.engines.ffmpeg.path : null });
  }

  async pause(id) {
    const task = this.tasks.get(id);
    if (!task || FINAL.has(task.status) || task.status === 'error') return;
    const wasActive = task.status === 'active';
    task.status = 'paused';
    task.downloadSpeed = 0;
    if (wasActive) {
      if (task.kind === 'video') this.jobs.get(id)?.stop();
      else await this.aria2Call('forcePause', task.gid).catch(() => {});
    }
    this.persist();
    this.emitTasks();
  }

  resume(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'paused') return;
    task.status = 'queued';
    this.persist();
    this.tick().catch(() => {});
  }

  async pauseAll() {
    for (const t of this.tasks.values()) if (t.status === 'active' || t.status === 'queued') await this.pause(t.id);
  }

  resumeAll() {
    for (const t of this.tasks.values()) if (t.status === 'paused') t.status = 'queued';
    this.persist();
    this.tick().catch(() => {});
  }

  async retry(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'error') return;
    if (task.gid) {
      await this.aria2Call('removeDownloadResult', task.gid).catch(() => {});
      task.gid = newGid();
    }
    task.connections = this.clampConn(task.connections);
    task.error = '';
    task.status = 'queued';
    this.persist();
    this.tick().catch(() => {});
  }

  async remove(id, deleteFiles) {
    const task = this.tasks.get(id);
    if (!task) return;
    this.tasks.delete(id);
    if (task.kind === 'video') {
      const job = this.jobs.get(id);
      if (job) {
        job.stop();
        await new Promise((r) => { job.once('stopped', r); setTimeout(r, 3000); });
      }
      if (deleteFiles) removeVideoFiles(task.dir, task.filePath || task.tmpName, task.filePath);
    } else if (task.gid) {
      await this.aria2Call('forceRemove', task.gid).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      await this.aria2Call('removeDownloadResult', task.gid).catch(() => {});
      if (deleteFiles) {
        for (const f of task.files || []) {
          const p = this.insideDir(task.dir, f);
          if (!p) continue;
          try { fs.rmSync(p, { force: true }); } catch {}
          try { fs.rmSync(`${p}.aria2`, { force: true }); } catch {}
        }
        // BT 任務的資料夾（只在空了的時候刪）
        if (task.btDir) {
          const d = this.insideDir(task.dir, task.btDir);
          if (d) try { fs.rmdirSync(d); } catch {}
        }
      }
    }
    this.persist();
    this.emitTasks();
  }

  clearCompleted() {
    for (const [id, t] of this.tasks) if (t.status === 'completed') this.tasks.delete(id);
    this.persist();
    this.emitTasks();
  }

  // 只接受在任務資料夾裡面的路徑
  insideDir(dir, p) {
    if (!p) return null;
    const abs = path.resolve(dir, p);
    const rel = path.relative(path.resolve(dir), abs);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? abs : null;
  }

  // 任務的主要檔案（開啟檔案用）
  mainFile(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (t.kind === 'video') return t.filePath || null;
    if (t.btDir) return this.insideDir(t.dir, t.btDir);
    return t.files?.[0] ? this.insideDir(t.dir, t.files[0]) : null;
  }

  applySettings(changed) {
    if ('speedLimit' in changed && this.aria2?.ready) {
      const v = changed.speedLimit > 0 ? `${changed.speedLimit}K` : '0';
      this.aria2.call('changeGlobalOption', { 'max-overall-download-limit': v }).catch(() => {});
    }
    if ('maxConcurrent' in changed) this.tick().catch(() => {});
  }

  // ---------- 內部 ----------

  aria2Call(method, ...params) {
    if (!this.aria2 || !this.aria2.ready) return Promise.reject(new Error('aria2 not ready'));
    return this.aria2.call(method, ...params);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.trackActiveTime();
      await this.syncAria2();
      await this.schedule();
      this.speed = [...this.tasks.values()].reduce((s, t) => s + (t.status === 'active' ? t.downloadSpeed || 0 : 0), 0);
      this.emitTasks();
      this.persist();
      this.tickCount += 1;
      if (this.tickCount % SAMPLE_EVERY === 0) this.sampleConnections();
    } finally {
      this.ticking = false;
    }
  }

  // ---------- 統計取樣 ----------

  statOf(task) {
    if (!task.stat) task.stat = { activeMs: 0, perConnSum: 0, perConnN: 0, connPeak: 0 };
    return task.stat;
  }

  // 累計每個任務實際在下載的時間（暫停、排隊不算）
  trackActiveTime() {
    const now = Date.now();
    const dt = this.lastTickAt ? Math.min(5000, Math.max(0, now - this.lastTickAt)) : 0;
    this.lastTickAt = now;
    if (!dt) return;
    for (const t of this.tasks.values()) {
      if (t.status !== 'active') continue;
      const st = this.statOf(t);
      st.activeMs += dt;
      if (t.connectionsNow > st.connPeak) st.connPeak = t.connectionsNow;
    }
  }

  // 用 aria2.getServers 取得每條 HTTP／FTP 連線的速度，記下「單一連線平均速度」，
  // 完成時拿來估算單線下載要花多久。取樣失敗或沒有資料就跳過，不影響下載。
  async sampleConnections() {
    if (this.sampling || !this.aria2?.ready) return;
    const list = [...this.tasks.values()].filter((t) => t.kind === 'http' && t.gid && t.status === 'active' && t.downloadSpeed > 0);
    if (!list.length) return;
    this.sampling = true;
    try {
      const results = await this.aria2.multicall(list.map((t) => ['getServers', t.gid])).catch(() => null);
      if (!results) return;
      list.forEach((task, i) => {
        const r = results[i];
        if (!Array.isArray(r)) return;
        let n = 0;
        let sum = 0;
        for (const file of r) {
          for (const sv of file?.servers || []) {
            const v = Number(sv.downloadSpeed) || 0;
            if (v > 0) { n += 1; sum += v; }
          }
        }
        if (!n) return;
        const st = this.statOf(task);
        st.perConnSum += sum / n;
        st.perConnN += 1;
        if (n > st.connPeak) st.connPeak = n;
      });
    } finally {
      this.sampling = false;
    }
  }

  async schedule() {
    const max = this.settings.get('maxConcurrent');
    let active = [...this.tasks.values()].filter((t) => t.status === 'active').length;
    const queued = [...this.tasks.values()].filter((t) => t.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const task of queued) {
      if (active >= max) break;
      if (task.kind === 'video') {
        this.startVideo(task);
        active += 1;
      } else if (this.aria2?.ready) {
        try {
          await this.startAria2(task);
          active += 1;
        } catch (err) {
          task.status = 'error';
          task.error = err.message;
        }
      }
    }
  }

  aria2Options(task) {
    const n = String(task.connections);
    const o = {
      gid: task.gid,
      dir: task.dir,
      split: n,
      'max-connection-per-server': n,
      pause: 'false',
    };
    if (task.filename && (task.kind === 'http')) o.out = task.filename;
    if (task.speedLimit > 0) o['max-download-limit'] = `${task.speedLimit}K`;
    const h = task.headers || {};
    if (h.referrer) o.referer = h.referrer;
    if (h.userAgent) o['user-agent'] = h.userAgent;
    if (h.cookies) o.header = [`Cookie: ${h.cookies}`];
    return o;
  }

  async startAria2(task) {
    task.status = 'active';
    task.startedAt = Date.now();
    task.error = '';
    let st = null;
    try {
      st = await this.aria2.call('tellStatus', task.gid, ['status']);
    } catch { /* 沒有這個 gid → 新增 */ }
    if (st) {
      if (st.status === 'paused') await this.aria2.call('unpause', task.gid);
      else if (st.status === 'error' || st.status === 'removed') {
        await this.aria2.call('removeDownloadResult', task.gid).catch(() => {});
        task.gid = newGid();
        st = null;
      } else return;
    }
    if (st) return;
    const opts = this.aria2Options(task);
    if (task.kind === 'torrent-file' && task.torrent) {
      await this.aria2.call('addTorrent', task.torrent, [], opts);
    } else {
      await this.aria2.call('addUri', [task.url], opts);
    }
  }

  startVideo(task) {
    task.status = 'active';
    task.startedAt = Date.now();
    task.error = '';
    const job = new VideoJob(this.engines.ytdlp.path, task, {
      ffmpeg: this.engines.ffmpeg.found ? this.engines.ffmpeg.path : null,
      connections: task.connections,
      speedLimit: task.speedLimit || this.settings.get('speedLimit'),
    });
    this.jobs.set(task.id, job);
    job.on('progress', (p) => {
      task.completedLength = p.completedLength;
      if (p.totalLength) task.totalLength = Math.max(p.totalLength, p.completedLength);
      task.downloadSpeed = p.downloadSpeed;
      task.connectionsNow = Math.min(16, task.connections);
    });
    job.on('name', (n) => {
      task.tmpName = n;
      task.name = path.basename(n);
    });
    job.on('file', (f) => {
      task.filePath = f;
      task.name = path.basename(f);
    });
    const end = () => {
      this.jobs.delete(task.id);
      task.downloadSpeed = 0;
      task.connectionsNow = 0;
    };
    job.on('done', () => {
      end();
      task.status = 'completed';
      task.finishedAt = Date.now();
      task.completedLength = task.totalLength || task.completedLength;
      if (task.headers) task.headers.cookies = ''; // 完成後不留 cookie
      this.emit('completed', task);
    });
    job.on('error', (msg) => {
      end();
      task.status = 'error';
      task.error = msg;
      this.emit('failed', task);
    });
    job.on('stopped', end);
    try {
      job.start();
    } catch (err) {
      end();
      task.status = 'error';
      task.error = err.message;
    }
  }

  async syncAria2() {
    if (!this.aria2?.ready) return;
    const tracked = [...this.tasks.values()].filter((t) => t.gid && t.kind !== 'video' && (t.status === 'active' || t.status === 'paused'));
    if (!tracked.length) return;
    const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'connections', 'errorCode', 'errorMessage', 'files', 'followedBy', 'bittorrent', 'dir'];
    const results = await this.aria2.multicall(tracked.map((t) => ['tellStatus', t.gid, keys])).catch(() => null);
    if (!results) return;
    for (let i = 0; i < tracked.length; i += 1) {
      const task = tracked[i];
      const s = results[i];
      if (!s || s.error) {
        // aria2 不認得這個 gid（例如 session 沒存到）：下載中的話重新排隊，讓排程重新加入
        if (task.status === 'active') task.status = 'queued';
        continue;
      }
      this.applyStatus(task, s);
    }
  }

  applyStatus(task, s) {
    task.totalLength = Number(s.totalLength) || task.totalLength;
    task.completedLength = Number(s.completedLength) || 0;
    task.downloadSpeed = task.status === 'active' ? Number(s.downloadSpeed) || 0 : 0;
    task.connectionsNow = Number(s.connections) || 0;
    const dir = s.dir || task.dir;
    const files = (s.files || []).map((f) => f.path).filter((p) => p && !p.startsWith('[METADATA]'));
    if (files.length) task.files = files.map((p) => path.relative(dir, p));
    if (s.bittorrent?.info?.name) {
      task.name = s.bittorrent.info.name;
      if (s.bittorrent.mode === 'multi') task.btDir = s.bittorrent.info.name;
    } else if (files.length === 1 && task.kind === 'http') {
      task.name = path.basename(files[0]);
    }

    switch (s.status) {
      case 'active':
      case 'waiting':
        break;
      case 'paused':
        // 使用者沒按暫停，但 aria2 是暫停（例如從 session 還原）→ 繼續
        if (task.status === 'active') this.aria2Call('unpause', task.gid).catch(() => {});
        break;
      case 'complete':
        if (s.followedBy?.length) {
          // 磁力連結抓完 metadata，或 .torrent 網址下載完：換成接續的任務
          this.aria2Call('removeDownloadResult', task.gid).catch(() => {});
          task.gid = s.followedBy[0];
          task.totalLength = 0;
          task.completedLength = 0;
          return;
        }
        task.status = 'completed';
        task.finishedAt = Date.now();
        task.downloadSpeed = 0;
        task.connectionsNow = 0;
        if (task.headers) task.headers.cookies = '';
        this.emit('completed', task);
        break;
      case 'error':
        this.handleAria2Error(task, s);
        break;
      case 'removed':
        if (task.status === 'active') task.status = 'queued';
        break;
      default:
        break;
    }
  }

  // 伺服器嫌連線太多（429／503）時，自動用更少連線重試：32→16→8→4。
  // aria2 每條被拒的連線都會把網址標成失敗，最後常常只回報「No URI available」（errorCode 29 或 1），
  // 而且可能下載到一半才發生，所以不限定剛開始。重新加入時 .aria2 控制檔還在，會從斷掉的地方接著下載。
  handleAria2Error(task, s) {
    const msg = `${s.errorMessage || ''}`;
    const overloaded = s.errorCode === '29' || /\b(503|429)\b|too many|service unavailable|no uri available/i.test(msg);
    if (overloaded && task.kind === 'http') {
      const next = FALLBACK_STEPS.find((n) => n < task.connections);
      const progressed = (Number(s.completedLength) || 0) > (task.lastFailedAt || 0);
      // 已經降到最少：有進度就再接著試，最多 3 次，避免卡在無限重試
      const retrySame = !next && progressed && (task.autoRetries || 0) < 3;
      if (next || retrySame) {
        this.aria2Call('removeDownloadResult', task.gid).catch(() => {});
        if (next) {
          task.connections = next;
          task.fallbackNote = next;
        } else {
          task.autoRetries = (task.autoRetries || 0) + 1;
        }
        task.lastFailedAt = Number(s.completedLength) || 0;
        task.gid = newGid();
        task.status = 'queued';
        return;
      }
    }
    task.status = 'error';
    task.error = msg || `aria2 error ${s.errorCode}`;
    task.downloadSpeed = 0;
    task.connectionsNow = 0;
    this.emit('failed', task);
  }

  persist(now = false) {
    this.store.saveSoon(() => [...this.tasks.values()], now ? 0 : 1500);
    if (now) this.store.flush();
  }

  emitTasks() {
    this.emit('tasks', this.list(), this.speed);
  }

  emitStatus() {
    this.emit('engines', this.engineStatus());
  }
}

module.exports = { Manager, guessKind, isAllowedUrl, safeFilename };
