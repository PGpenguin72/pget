// 設定與任務的 JSON 存檔（放在 app.getPath('userData')）
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 原子寫入：先寫暫存檔再改名，避免寫到一半當機把檔案弄壞
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const DEFAULTS = {
  downloadDir: '',          // 空字串 = 系統的「下載」資料夾
  connections: 32,          // 每個檔案的連線數（1–128）
  maxConcurrent: 3,         // 同時下載數
  speedLimit: 0,            // 全域限速 KB/s，0 = 不限
  theme: 'system',          // system | light | dark
  language: 'auto',         // auto | zh-TW | en | zh-CN | ja | ko
  startAtLogin: false,
  minimizeToTray: true,     // 關閉／最小化時收到系統匣
  checkUpdates: true,       // 只查詢 GitHub 最新版本，不送出任何資料
  notifyOnComplete: true,
  focusOnAdd: true,         // 擴充功能送來下載時把視窗帶到前景（否則跳通知）
  videoQuality: 'best',     // 擴充功能送來影片時的預設畫質
  pairedClients: [],        // [{ id, client, tokenHash, createdAt, lastUsed }]
};

class JsonStore {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name);
    this.defaults = defaults;
    this.timer = null;
  }
  load() {
    return readJson(this.file, null);
  }
  // 延遲寫入，避免進度更新時每秒狂寫硬碟
  saveSoon(data, delay = 1000) {
    this.pending = data;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), delay);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending === undefined) return;
    try {
      writeJsonAtomic(this.file, typeof this.pending === 'function' ? this.pending() : this.pending);
    } catch (err) {
      console.error('[store] 寫入失敗', this.file, err);
    }
    this.pending = undefined;
  }
}

class Settings {
  constructor() {
    this.store = new JsonStore('settings.json');
    this.data = { ...DEFAULTS, ...(this.store.load() || {}) };
    if (!this.data.downloadDir) this.data.downloadDir = app.getPath('downloads');
    this.listeners = new Set();
  }
  get(key) {
    return this.data[key];
  }
  all() {
    return { ...this.data };
  }
  // 給介面看的版本：不含 token 雜湊
  publicView() {
    const { pairedClients, ...rest } = this.data;
    return {
      ...rest,
      pairedClients: pairedClients.map(({ id, client, createdAt, lastUsed }) => ({ id, client, createdAt, lastUsed })),
    };
  }
  set(patch) {
    const clean = sanitize(patch);
    Object.assign(this.data, clean);
    this.store.saveSoon(() => this.data, 200);
    for (const fn of this.listeners) fn(clean, this.data);
    return this.data;
  }
  onChange(fn) {
    this.listeners.add(fn);
  }
  flush() {
    this.store.saveSoon(() => this.data, 0);
    this.store.flush();
  }
}

// 只接受已知欄位與合理範圍，介面傳來的東西不能完全相信
function sanitize(patch) {
  const out = {};
  const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  for (const [k, v] of Object.entries(patch || {})) {
    switch (k) {
      case 'downloadDir': if (typeof v === 'string' && path.isAbsolute(v)) out[k] = v; break;
      case 'connections': out[k] = int(v, 1, 128); break;
      case 'maxConcurrent': out[k] = int(v, 1, 20); break;
      case 'speedLimit': out[k] = int(v, 0, 10_000_000); break;
      case 'theme': if (['system', 'light', 'dark'].includes(v)) out[k] = v; break;
      case 'language': if (['auto', 'zh-TW', 'en', 'zh-CN', 'ja', 'ko'].includes(v)) out[k] = v; break;
      case 'videoQuality': if (typeof v === 'string' && /^(best|audio|\d{3,4})$/.test(v)) out[k] = v; break;
      case 'startAtLogin': case 'minimizeToTray': case 'checkUpdates':
      case 'notifyOnComplete': case 'focusOnAdd':
        out[k] = Boolean(v); break;
      case 'pairedClients': if (Array.isArray(v)) out[k] = v; break; // 只有主程序內部會設定
      default: break;
    }
  }
  return out;
}

module.exports = { Settings, JsonStore, writeJsonAtomic, readJson, sanitize };
