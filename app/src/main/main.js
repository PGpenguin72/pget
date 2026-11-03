// PGet 主程序：視窗、系統匣、IPC、本機端點
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeTheme, nativeImage, Notification, session,
} = require('electron');

const { Settings, sanitize } = require('./settings');
const { I18n } = require('./i18n');
const { detectEngines } = require('./engines');
const { Manager } = require('./manager');
const { LocalServer } = require('./server');
const { checkForUpdate } = require('./updater');

const HOMEPAGE = 'https://pget.pg72.tw';
const REPO = 'https://github.com/PGpenguin72/pget';
const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const MAX_TORRENT_BYTES = 20 * 1024 * 1024;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let settings;
let i18n;
let manager;
let server;
let win = null;
let tray = null;
let quitting = false;
let lastSpeed = 0;
let updateInfo = null;
const t = (k, v) => i18n.t(k, v);

// ---------- 小工具 ----------

function formatSpeed(bps) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bps;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}/s`;
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: false });
  n.on('click', showWindow);
  n.show();
}

function applyTheme() {
  nativeTheme.themeSource = settings.get('theme');
}

function applyLoginItem() {
  if (process.platform === 'linux') return; // Linux 不支援，設定頁會說明
  try {
    app.setLoginItemSettings({ openAtLogin: settings.get('startAtLogin'), args: ['--hidden'] });
  } catch (err) {
    console.error('[login item]', err);
  }
}

// ---------- 視窗 ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'PGet',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });

  // 不准在視窗裡開任何外部網頁
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (!quitting && settings.get('minimizeToTray') && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('minimize', () => {
    if (settings.get('minimizeToTray') && tray && process.platform !== 'darwin') win.hide();
  });
  win.on('closed', () => { win = null; });
}

// ---------- 系統匣 ----------

function trayImage() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(ASSETS, file));
  return img.isEmpty() ? nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16, height: 16 }) : img;
}

let lastTrayLabel = '';
function buildTrayMenu(force = true) {
  if (!tray) return;
  const speedLabel = t('tray.speed', { speed: formatSpeed(lastSpeed) });
  // 選單開著時重建會被關掉，所以速度沒變就不重建
  if (!force && speedLabel === lastTrayLabel) return;
  lastTrayLabel = speedLabel;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: speedLabel, enabled: false },
    { type: 'separator' },
    { label: t('tray.show'), click: showWindow },
    { label: t('tray.pauseAll'), click: () => manager.pauseAll() },
    { label: t('tray.resumeAll'), click: () => manager.resumeAll() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]));
  tray.setToolTip(`PGet — ${speedLabel}`);
  if (process.platform === 'darwin') tray.setTitle(lastSpeed > 0 ? formatSpeed(lastSpeed) : '');
}

function createTray() {
  try {
    tray = new Tray(trayImage());
  } catch (err) {
    console.error('[tray]', err);
    tray = null;
    return;
  }
  tray.on('click', showWindow);
  buildTrayMenu();
}

// ---------- 擴充功能配對 ----------

async function confirmPair(client, signal) {
  showWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('pair.title'),
    message: t('pair.message'),
    detail: t('pair.detail', { client }),
    buttons: [t('pair.allow'), t('pair.deny')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    signal,
  });
  return response === 0 && !signal.aborted;
}

function addFromExtension(req) {
  const id = manager.add(req);
  if (settings.get('focusOnAdd')) {
    showWindow();
  } else {
    notify(t('notify.addedTitle'), req.filename || req.url);
  }
  return id;
}

// ---------- 從命令列／第二個實例收到的 magnet 或 .torrent ----------

function handleArgv(argv) {
  for (const a of argv.slice(1)) {
    if (/^magnet:/i.test(a)) {
      try { manager.add({ url: a, kind: 'magnet' }); } catch (e) { console.error(e); }
    } else if (/\.torrent$/i.test(a) && fs.existsSync(a)) {
      try { addTorrentFile({ torrentPath: a }); } catch (e) { console.error(e); }
    }
  }
}

function addTorrentFile(req) {
  const p = req.torrentPath;
  if (typeof p !== 'string' || !/\.torrent$/i.test(p) || !path.isAbsolute(p)) throw new Error(t('error.badTorrent'));
  const st = fs.statSync(p);
  if (!st.isFile() || st.size > MAX_TORRENT_BYTES) throw new Error(t('error.badTorrent'));
  const torrent = fs.readFileSync(p).toString('base64');
  return manager.add({ ...req, torrent, torrentName: path.basename(p).replace(/\.torrent$/i, ''), url: '' });
}

// ---------- IPC ----------

function initPayload() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    homepage: HOMEPAGE,
    locale: i18n.locale,
    dict: i18n.dict,
    settings: settings.publicView(),
    engines: manager.engineStatus(),
    tasks: manager.list(),
    serverPort: server?.port || 0,
    update: updateInfo,
  };
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));

  h('app:init', () => initPayload());

  h('tasks:add', (reqs) => {
    const ids = [];
    const errors = [];
    for (const r of Array.isArray(reqs) ? reqs.slice(0, 500) : []) {
      try {
        if (!r || typeof r !== 'object') continue;
        const clean = {
          url: typeof r.url === 'string' ? r.url.trim() : '',
          filename: r.filename, dir: r.dir, connections: r.connections, speedLimit: r.speedLimit,
          quality: typeof r.quality === 'string' ? r.quality : undefined,
          kind: typeof r.kind === 'string' ? r.kind : 'auto',
          referrer: r.referrer, userAgent: r.userAgent, cookies: r.cookies,
        };
        ids.push(r.torrentPath ? addTorrentFile({ ...clean, torrentPath: r.torrentPath }) : manager.add(clean));
      } catch (err) {
        errors.push({ url: r?.url || r?.torrentPath || '', error: err.message });
      }
    }
    return { ids, errors };
  });
  h('tasks:pause', (id) => manager.pause(id));
  h('tasks:resume', (id) => manager.resume(id));
  h('tasks:retry', (id) => manager.retry(id));
  h('tasks:remove', (id, del) => manager.remove(id, Boolean(del)));
  h('tasks:pauseAll', () => manager.pauseAll());
  h('tasks:resumeAll', () => manager.resumeAll());
  h('tasks:clearCompleted', () => manager.clearCompleted());
  h('tasks:openFile', async (id) => {
    const f = manager.mainFile(id);
    if (!f || !fs.existsSync(f)) return { ok: false, error: t('error.fileMissing') };
    const err = await shell.openPath(f);
    return { ok: !err, error: err };
  });
  h('tasks:openFolder', (id) => {
    const f = manager.mainFile(id);
    const task = manager.tasks.get(id);
    if (f && fs.existsSync(f)) shell.showItemInFolder(f);
    else if (task && fs.existsSync(task.dir)) shell.openPath(task.dir);
    else return { ok: false, error: t('error.fileMissing') };
    return { ok: true };
  });
  h('video:probe', (req) => manager.probeVideo({
    url: String(req?.url || ''), cookies: '', userAgent: '', referrer: '',
  }));

  h('dialog:pickFolder', async (current) => {
    const r = await dialog.showOpenDialog(win, {
      title: t('dialog.pickFolder'),
      defaultPath: typeof current === 'string' ? current : settings.get('downloadDir'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  h('dialog:pickTorrent', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: t('dialog.pickTorrent'),
      filters: [{ name: 'BitTorrent', extensions: ['torrent'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return r.canceled ? [] : r.filePaths;
  });

  h('settings:set', (patch) => {
    const p = sanitize(patch);
    delete p.pairedClients; // 配對清單只能由主程序修改
    settings.set(p);
    return settings.publicView();
  });
  h('settings:revoke', (id) => {
    settings.set({ pairedClients: settings.get('pairedClients').filter((c) => c.id !== id) });
    return settings.publicView();
  });
  h('update:check', () => runUpdateCheck(true));
  h('shell:openExternal', (url) => {
    // 只開本專案自己的網址
    if (typeof url === 'string' && (url.startsWith(`${HOMEPAGE}/`) || url === HOMEPAGE || url.startsWith(`${REPO}`))) {
      shell.openExternal(url);
    }
  });
}

function onSettingsChanged(changed) {
  if ('theme' in changed) applyTheme();
  if ('startAtLogin' in changed) applyLoginItem();
  if ('language' in changed) {
    i18n.setLanguage(settings.get('language'));
    buildTrayMenu();
    send('i18n:update', { locale: i18n.locale, dict: i18n.dict });
  }
  manager.applySettings(changed);
  send('settings:update', settings.publicView());
}

async function runUpdateCheck(manual) {
  try {
    updateInfo = await checkForUpdate(app.getVersion());
    if (updateInfo.available) send('update:available', updateInfo);
    return updateInfo;
  } catch (err) {
    if (manual) return { error: err.message };
    return null;
  }
}

// ---------- 啟動 ----------

app.on('second-instance', (_e, argv) => {
  showWindow();
  if (manager) handleArgv(argv);
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('tw.pg72.pget');

  settings = new Settings();
  i18n = new I18n(settings.get('language'));
  applyTheme();
  settings.onChange(onSettingsChanged);

  // 介面不需要任何權限（通知由主程序發）
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const engines = detectEngines();
  manager = new Manager({ settings, engines, t });
  manager.on('tasks', (list, speed) => {
    lastSpeed = speed;
    send('tasks:update', list, speed);
  });
  manager.on('engines', (st) => send('engines:update', st));
  manager.on('completed', (task) => {
    if (settings.get('notifyOnComplete')) notify(t('notify.doneTitle'), task.name);
  });
  manager.on('failed', (task) => {
    if (settings.get('notifyOnComplete')) notify(t('notify.failedTitle'), task.name);
  });

  registerIpc();
  createWindow();
  createTray();
  setInterval(() => buildTrayMenu(false), 2000);

  await manager.start();
  send('engines:update', manager.engineStatus());
  handleArgv(process.argv);

  server = new LocalServer({
    version: app.getVersion(),
    settings,
    confirmPair,
    onAdd: addFromExtension,
  });
  try {
    await server.start();
  } catch (err) {
    console.error('[server]', err);
  }

  if (settings.get('checkUpdates')) setTimeout(() => runUpdateCheck(false), 5000);
});

app.on('activate', showWindow);

app.on('window-all-closed', () => {
  // 有系統匣就繼續在背景跑
  if (!tray || !settings.get('minimizeToTray')) {
    quitting = true;
    app.quit();
  }
});

let cleanedUp = false;
app.on('before-quit', async (e) => {
  quitting = true;
  if (cleanedUp) return;
  e.preventDefault();
  cleanedUp = true;
  try {
    server?.stop();
    await manager?.stop();
    settings?.flush();
  } finally {
    tray?.destroy();
    app.quit();
  }
});
