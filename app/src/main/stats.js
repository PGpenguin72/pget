// 下載統計：只記在本機（userData/stats.json），不會上傳。
// 每筆只存：完成時間、大小、類型、來源網域（不存完整網址）、花費時間、平均速度、連線數、估算省下的時間。
'use strict';

const { EventEmitter } = require('node:events');
const { JsonStore } = require('./settings');

const MAX_RECORDS = 20000; // 超過就丟掉最舊的
const KINDS = ['http', 'video', 'torrent', 'magnet'];
const DAYS = 30;

function normKind(kind) {
  if (kind === 'torrent-file') return 'torrent';
  return KINDS.includes(kind) ? kind : 'http';
}

// 只留網域，去掉 www.；磁力連結、本機種子檔沒有網域
function domainOf(url) {
  try {
    if (!/^(https?|ftp|sftp):/i.test(url || '')) return null;
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h || null;
  } catch {
    return null;
  }
}

function localDay(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

function valid(r) {
  return r && typeof r === 'object' && Number.isFinite(r.t) && KINDS.includes(r.kind);
}

/**
 * 依下載時的取樣估算「單一連線要花多久」，算出省下的時間。
 * 只有一般 HTTP／FTP 多線路下載才算；取樣太少、時間太短就不算（回傳 null）。
 * 上限：單線時間最多是實際時間 × 用到的連線數（理想情況下 n 條連線最多快 n 倍）。
 */
function estimateSaved({ kind, size, ms, stat }) {
  if (kind !== 'http' || !stat) return null;
  const n = stat.perConnN || 0;
  if (n < 2 || ms < 3000 || size <= 0) return null;
  const perConn = stat.perConnSum / n; // bytes/s
  const peak = Math.max(1, stat.connPeak || 1);
  if (!(perConn > 0)) return null;
  if (peak <= 1) return 0;
  const single = Math.min((size / perConn) * 1000, ms * peak);
  return Math.max(0, Math.round(single - ms));
}

class Stats extends EventEmitter {
  constructor() {
    super();
    this.store = new JsonStore('stats.json');
    const data = this.store.load();
    this.records = Array.isArray(data?.records) ? data.records.filter(valid) : [];
  }

  // task 是 Manager 的任務物件（剛完成）
  record(task) {
    try {
      const now = Date.now();
      const kind = normKind(task.kind);
      const size = num(Number(task.totalLength) || Number(task.completedLength) || 0);
      const stat = task.stat || {};
      let ms = num(stat.activeMs);
      if (ms < 1000 && task.startedAt) ms = Math.max(ms, num((task.finishedAt || now) - task.startedAt));
      ms = Math.round(ms);
      const rec = {
        t: task.finishedAt || now,
        size,
        kind,
        domain: kind === 'magnet' ? null : domainOf(task.url),
        ms,
        speed: ms > 0 ? Math.round(size / (ms / 1000)) : 0,
        conns: Math.max(1, Math.round(stat.connPeak || task.connections || 1)),
        saved: estimateSaved({ kind, size, ms, stat }),
      };
      this.records.push(rec);
      if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
      this.save();
      this.emit('change');
    } catch (err) {
      console.error('[stats]', err);
    }
  }

  clear() {
    this.records = [];
    this.save();
    this.emit('change');
  }

  save() {
    this.store.saveSoon(() => ({ version: 1, records: this.records }), 2000);
  }

  flush() {
    this.store.flush();
  }

  summary(now = Date.now()) {
    const totals = { count: 0, bytes: 0, ms: 0, saved: 0, savedCount: 0, speedBytes: 0, speedMs: 0 };
    const byKind = Object.fromEntries(KINDS.map((k) => [k, { count: 0, bytes: 0 }]));
    const domains = new Map();
    const days = new Map();
    for (let i = DAYS - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.set(localDay(d.getTime()), { date: localDay(d.getTime()), count: 0, bytes: 0 });
    }
    for (const r of this.records) {
      totals.count += 1;
      totals.bytes += num(r.size);
      totals.ms += num(r.ms);
      if (r.ms > 0 && r.size > 0) { totals.speedBytes += r.size; totals.speedMs += r.ms; }
      if (r.saved != null) { totals.saved += num(r.saved); totals.savedCount += 1; }
      byKind[r.kind].count += 1;
      byKind[r.kind].bytes += num(r.size);
      if (r.domain) {
        const d = domains.get(r.domain) || { domain: r.domain, count: 0, bytes: 0 };
        d.count += 1;
        d.bytes += num(r.size);
        domains.set(r.domain, d);
      }
      const day = days.get(localDay(r.t));
      if (day) { day.count += 1; day.bytes += num(r.size); }
    }
    return {
      count: totals.count,
      bytes: totals.bytes,
      ms: totals.ms,
      saved: totals.saved,
      savedCount: totals.savedCount,
      avgSpeed: totals.speedMs > 0 ? totals.speedBytes / (totals.speedMs / 1000) : 0,
      since: this.records.length ? this.records[0].t : 0, // 依完成順序附加，第一筆最舊
      byKind,
      topDomains: [...domains.values()].sort((a, b) => b.count - a.count || b.bytes - a.bytes).slice(0, 8),
      daily: [...days.values()],
    };
  }
}

module.exports = { Stats, estimateSaved, domainOf };
