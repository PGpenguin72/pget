// 更新：支援的安裝方式用 electron-updater 在背景下載新版，下載好問使用者要不要重新啟動；
// 不支援的（Windows 免安裝版、Linux .deb、開發模式）退回舊做法：只查 GitHub 最新版本號並通知。
// 兩種方式都只連到 GitHub，不送出任何使用者資料。
'use strict';

const { EventEmitter } = require('node:events');
const { app, net } = require('electron');

const OWNER = 'PGpenguin72';
const REPO = 'pget';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const RECHECK_MS = 6 * 60 * 60 * 1000; // 開著的話每 6 小時再查一次

function parseVer(v) {
  return String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

function newer(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

// 舊做法：只查詢 GitHub 最新 release 的版本號
async function checkForUpdate(currentVersion) {
  const res = await net.fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PGet/${currentVersion}` },
    credentials: 'omit',
    cache: 'no-store',
  });
  if (res.status === 404) return { available: false, latest: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const latest = j.tag_name || j.name || '';
  // 只接受指向本專案的網址
  const url = typeof j.html_url === 'string' && j.html_url.startsWith(`https://github.com/${OWNER}/${REPO}/`)
    ? j.html_url : RELEASES;
  return { available: newer(latest, currentVersion), latest: latest.replace(/^v/i, ''), url };
}

// 這個安裝方式能不能自動更新
function autoUpdateSupport() {
  if (!app.isPackaged) return { supported: false, reason: 'dev' };
  switch (process.platform) {
    case 'win32':
      // electron-builder 的免安裝版會設這兩個環境變數；免安裝版沒有安裝程式可以替換
      if (process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) return { supported: false, reason: 'portable' };
      return { supported: true };
    case 'darwin':
      return { supported: true };
    case 'linux':
      // 只有 AppImage 可以自己換掉自己；.deb 要用套件管理員（需要 root），不自動更新
      if (process.env.APPIMAGE) return { supported: true };
      return { supported: false, reason: 'package' };
    default:
      return { supported: false, reason: 'platform' };
  }
}

/**
 * 事件：
 *   'state'      (info)  介面要顯示的更新狀態
 *   'available'  (info)  手動模式找到新版（通知用，同一版只發一次）
 *   'downloaded' (info)  新版已下載好，可以重新啟動安裝
 * info = { available, latest, url, mode: 'auto'|'manual', stage: 'downloading'|'ready'|'available', percent }
 */
class Updater extends EventEmitter {
  constructor({ isEnabled }) {
    super();
    this.isEnabled = isEnabled;
    this.support = autoUpdateSupport();
    this.au = null;          // electron-updater（需要時才載入）
    this.autoBroken = false; // 自動更新出錯過：這次執行改用舊做法
    this.info = null;
    this.timer = null;
    this.notified = new Set();
    this.lastPercent = -1;
  }

  get mode() {
    return this.support.supported && !this.autoBroken ? 'auto' : 'manual';
  }

  start() {
    if (!app.isPackaged) return; // 開發模式不檢查
    const run = () => { if (this.isEnabled()) this.check(false).catch(() => {}); };
    setTimeout(run, 5000);
    this.timer = setInterval(run, RECHECK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  setInfo(patch) {
    this.info = { ...(this.info || {}), ...patch };
    this.emit('state', this.info);
    return this.info;
  }

  loadAutoUpdater() {
    if (this.au) return this.au;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // 沒按「重新啟動」的話，下次結束程式時安裝
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = { info() {}, debug() {}, warn: (m) => console.warn('[updater]', m), error: (m) => console.error('[updater]', m) };

    autoUpdater.on('update-available', (u) => {
      this.lastPercent = -1;
      this.setInfo({ available: true, latest: u.version, url: RELEASES, mode: 'auto', stage: 'downloading', percent: 0 });
    });
    autoUpdater.on('download-progress', (p) => {
      const pct = Math.floor(p.percent || 0);
      if (pct === this.lastPercent) return; // 只在整數百分比變動時更新介面
      this.lastPercent = pct;
      if (this.info?.stage === 'downloading') this.setInfo({ percent: pct });
    });
    autoUpdater.on('update-downloaded', (u) => {
      const info = this.setInfo({ available: true, latest: u.version, url: RELEASES, mode: 'auto', stage: 'ready', percent: 100 });
      this.emit('downloaded', info);
    });
    autoUpdater.on('error', (err) => {
      console.error('[updater]', err?.message || err);
      // 下載到一半壞掉（網路、雜湊不符、mac 從唯讀位置執行等）：退回「前往下載」
      if (this.info?.stage === 'downloading') {
        this.autoBroken = true;
        this.setInfo({ mode: 'manual', stage: 'available' });
        this.notifyOnce(this.info);
      }
    });
    this.au = autoUpdater;
    return autoUpdater;
  }

  notifyOnce(info) {
    if (!info?.latest || this.notified.has(info.latest)) return;
    this.notified.add(info.latest);
    this.emit('available', info);
  }

  async checkAuto() {
    const au = this.loadAutoUpdater();
    if (this.info?.stage === 'ready' || this.info?.stage === 'downloading') return this.info; // 已在處理
    const r = await au.checkForUpdates();
    if (!r || !r.isUpdateAvailable) {
      return { available: false, latest: r?.updateInfo?.version || app.getVersion(), mode: 'auto' };
    }
    // 下載失敗會由 'error' 事件處理；這裡吞掉，避免 unhandled rejection
    r.downloadPromise?.catch(() => {});
    return this.info || { available: true, latest: r.updateInfo.version, url: RELEASES, mode: 'auto', stage: 'downloading', percent: 0 };
  }

  async checkManual() {
    const r = await checkForUpdate(app.getVersion());
    if (r.available) {
      const info = this.setInfo({ ...r, mode: 'manual', stage: 'available' });
      this.notifyOnce(info);
      return info;
    }
    return { ...r, mode: 'manual' };
  }

  // manual = 使用者按了「立即檢查」
  async check(manual) {
    if (!app.isPackaged && !manual) return null;
    if (this.mode === 'auto') {
      try {
        return await this.checkAuto();
      } catch (err) {
        // 例如舊版 release 沒有 latest.yml：這次執行改用舊做法
        console.error('[updater] auto check failed, falling back', err?.message || err);
        this.autoBroken = true;
      }
    }
    try {
      return await this.checkManual();
    } catch (err) {
      if (manual) return { error: err.message };
      return null;
    }
  }

  // 呼叫前主程序要先把 aria2、設定等收好
  installNow() {
    if (this.info?.stage !== 'ready' || !this.au) return false;
    if (process.platform === 'darwin') this.au.quitAndInstall();
    else this.au.quitAndInstall(true, true); // 安靜安裝，裝完自動開啟
    return true;
  }
}

module.exports = { Updater, checkForUpdate, newer, autoUpdateSupport };
