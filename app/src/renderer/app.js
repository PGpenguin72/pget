// PGet 介面主程式（不用框架，直接操作 DOM）
import { hydrateIcons, iconSpan } from './icons.js';

const api = window.pget;
const $ = (sel) => document.querySelector(sel);

const state = {
  dict: {},
  locale: 'zh-TW',
  settings: {},
  engines: { aria2: { found: false }, ytdlp: { found: false }, ffmpeg: { found: false } },
  tasks: [],
  speed: 0,
  filter: 'all',
  version: '',
  platform: '',
  homepage: 'https://pget.pg72.tw',
  serverPort: 0,
  update: null,
};

// ---------- i18n ----------

function t(key, vars) {
  let s = state.dict[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

function applyI18n() {
  document.documentElement.lang = state.locale;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  fillQualitySelect($('#setQuality'), null, state.settings.videoQuality);
  renderTasks(true);
  renderSettings();
  renderEngines();
  renderUpdate();
}

// ---------- 格式化 ----------

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : 1)} ${u[i]}`;
}
const fmtSpeed = (n) => `${fmtBytes(n)}/s`;
function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  if (h > 99) return '∞';
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtDate(ms) {
  if (!ms) return t('settings.never');
  return new Date(ms).toLocaleString(state.locale);
}

// ---------- 主題 ----------

const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = state.settings.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
mq.addEventListener('change', applyTheme);

// ---------- 提示 ----------

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

// ---------- 任務清單 ----------

const FILTERS = {
  all: () => true,
  downloading: (x) => ['active', 'queued', 'paused'].includes(x.status),
  completed: (x) => x.status === 'completed',
  failed: (x) => x.status === 'error',
};
const KIND_ICON = { http: 'link', video: 'video', torrent: 'magnet', 'torrent-file': 'file', magnet: 'magnet' };
const rows = new Map(); // id → { el, refs }

function makeRow(task) {
  const el = document.createElement('div');
  el.className = 'task';
  el.setAttribute('role', 'listitem');
  const iconBox = document.createElement('div');
  iconBox.className = 'task-icon';
  const body = document.createElement('div');
  body.className = 'task-body';
  const name = document.createElement('div');
  name.className = 'task-name';
  const bar = document.createElement('div');
  bar.className = 'progress';
  const fill = document.createElement('div');
  bar.appendChild(fill);
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  body.append(name, bar, meta);
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  el.append(iconBox, body, actions);
  const refs = { iconBox, name, bar, fill, meta, actions, kind: null, actionsKey: '' };
  rows.set(task.id, { el, refs });
  return rows.get(task.id);
}

function actionButton(iconName, titleKey, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.title = t(titleKey);
  b.setAttribute('aria-label', t(titleKey));
  b.appendChild(iconSpan(iconName));
  b.addEventListener('click', onClick);
  return b;
}

function span(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function updateRow(row, task, force) {
  const { el, refs } = row;
  el.dataset.status = task.status;
  if (refs.kind !== task.kind || force) {
    refs.kind = task.kind;
    refs.iconBox.replaceChildren(iconSpan(KIND_ICON[task.kind] || 'link'));
  }
  if (refs.name.textContent !== task.name) {
    refs.name.textContent = task.name;
    refs.name.title = task.url || task.name;
  }

  const pct = task.totalLength > 0 ? Math.min(100, (task.completedLength / task.totalLength) * 100) : (task.status === 'completed' ? 100 : 0);
  refs.fill.style.width = `${pct.toFixed(1)}%`;
  refs.bar.classList.toggle('indeterminate', task.status === 'active' && !task.totalLength);

  // 資訊列
  const parts = [span(t(`status.${task.status}`), `badge ${task.status}`)];
  if (task.totalLength > 0) {
    parts.push(span(task.status === 'completed' ? fmtBytes(task.totalLength)
      : t('task.progress', { done: fmtBytes(task.completedLength), total: fmtBytes(task.totalLength), pct: pct.toFixed(1) })));
  } else if (task.completedLength > 0) {
    parts.push(span(fmtBytes(task.completedLength)));
  } else if (task.status !== 'completed') {
    parts.push(span(t('task.unknownSize')));
  }
  if (task.status === 'active') {
    parts.push(span(`↓ ${fmtSpeed(task.downloadSpeed)}`));
    const eta = task.downloadSpeed > 0 && task.totalLength ? (task.totalLength - task.completedLength) / task.downloadSpeed : NaN;
    parts.push(span(t('task.eta', { eta: fmtEta(eta) })));
    parts.push(span(t('task.connections', { n: task.connectionsNow || 0, max: task.connections })));
  }
  if (task.fallbackNote && task.status !== 'completed') parts.push(span(t('task.fallback', { n: task.fallbackNote }), 'note'));
  if (task.status === 'error' && task.error) {
    const e = span(task.error, 'err');
    e.title = task.error;
    parts.push(e);
  }
  refs.meta.replaceChildren(...parts);

  // 動作按鈕（狀態變了才重建，避免滑鼠移上去時閃爍）
  const key = `${task.status}|${force ? Math.random() : ''}`;
  if (refs.actionsKey !== key) {
    refs.actionsKey = key;
    const btns = [];
    const id = task.id;
    if (task.status === 'active' || task.status === 'queued') btns.push(actionButton('pause', 'action.pause', () => api.tasks.pause(id)));
    if (task.status === 'paused') btns.push(actionButton('play', 'action.resume', () => api.tasks.resume(id)));
    if (task.status === 'error') btns.push(actionButton('retry', 'action.retry', () => api.tasks.retry(id)));
    if (task.status === 'completed') btns.push(actionButton('open', 'action.openFile', () => openResult(api.tasks.openFile(id))));
    btns.push(actionButton('folder', 'action.openFolder', () => openResult(api.tasks.openFolder(id))));
    btns.push(actionButton('trash', 'action.remove', () => askRemove(task)));
    refs.actions.replaceChildren(...btns);
  }
}

async function openResult(p) {
  const r = await p;
  if (r && !r.ok) toast(r.error || t('error.fileMissing'), true);
}

function renderTasks(force = false) {
  const list = $('#taskList');
  const visible = state.tasks.filter(FILTERS[state.filter]).sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set(visible.map((x) => x.id));
  for (const [id, row] of rows) {
    if (!keep.has(id)) {
      row.el.remove();
      rows.delete(id);
    }
  }
  let prev = null;
  for (const task of visible) {
    const row = rows.get(task.id) || makeRow(task);
    updateRow(row, task, force);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== row.el) list.insertBefore(row.el, want);
    prev = row.el;
  }
  $('#emptyState').classList.toggle('hidden', visible.length > 0);
  list.classList.toggle('hidden', visible.length === 0);

  for (const [k, fn] of Object.entries(FILTERS)) {
    const n = state.tasks.filter(fn).length;
    const c = document.querySelector(`[data-count="${k}"]`);
    if (c) c.textContent = n ? String(n) : '';
  }
  $('#totalSpeed').textContent = fmtSpeed(state.speed);
}

// ---------- 引擎狀態 ----------

function renderEngines() {
  const e = state.engines;
  const missing = [];
  if (!e.aria2?.found) missing.push(t('engine.missingAria2'));
  if (!e.ytdlp?.found) missing.push(t('engine.missingYtdlp'));
  const banner = $('#engineBanner');
  if (missing.length || e.aria2Error) {
    banner.classList.remove('hidden');
    const lines = [...missing];
    if (e.aria2Error) lines.push(t('engine.aria2Error', { msg: e.aria2Error }));
    $('#engineBannerText').textContent = lines.join(' ');
  } else banner.classList.add('hidden');

  const ul = $('#engineList');
  ul.replaceChildren();
  const items = [
    ['aria2c', e.aria2, e.aria2?.found ? t('engine.maxConn', { n: e.aria2.maxConnections }) : ''],
    ['yt-dlp', e.ytdlp, ''],
    ['ffmpeg', e.ffmpeg, e.ffmpeg?.found ? '' : t('engine.ffmpegOptional')],
  ];
  for (const [name, info, extra] of items) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `dot${info?.found ? ' ok' : ''}`;
    const grow = document.createElement('div');
    grow.className = 'grow';
    const title = document.createElement('div');
    title.textContent = `${name} — ${info?.found ? t(info.source === 'system' ? 'engine.system' : 'engine.bundled') : t('engine.notFound')}`;
    grow.appendChild(title);
    if (info?.path) {
      const p = document.createElement('div');
      p.className = 'path';
      p.textContent = info.path;
      p.title = info.path;
      grow.appendChild(p);
    }
    if (extra) grow.appendChild(span(extra, 'hint'));
    li.append(dot, grow);
    ul.appendChild(li);
  }
  const max = e.maxConnections || 128;
  $('#setConn').max = String(max);
  $('#addConn').max = String(max);
  $('#connHint').textContent = e.aria2?.found && max < 128 ? t('settings.stockAria2Note', { n: max }) : t('settings.connectionsHint');
}

// ---------- 更新 ----------

function renderUpdate() {
  const u = state.update;
  const show = u && u.available && !sessionStorage.getItem(`dismiss-${u.latest}`);
  $('#updateBanner').classList.toggle('hidden', !show);
  if (show) $('#updateText').textContent = t('update.available', { version: u.latest });
}

// ---------- 設定頁 ----------

function renderSettings() {
  const s = state.settings;
  if (!s || !('connections' in s)) return;
  $('#setDir').value = s.downloadDir;
  $('#setDir').title = s.downloadDir;
  $('#setConn').value = String(s.connections);
  $('#setConnOut').textContent = String(Math.min(s.connections, state.engines.maxConnections || 128));
  $('#setConcurrent').value = String(s.maxConcurrent);
  $('#setSpeed').value = String(s.speedLimit);
  $('#setQuality').value = s.videoQuality;
  $('#setLang').value = s.language;
  $('#setLogin').checked = s.startAtLogin;
  $('#setTray').checked = s.minimizeToTray;
  $('#setNotify').checked = s.notifyOnComplete;
  $('#setFocus').checked = s.focusOnAdd;
  $('#setUpdates').checked = s.checkUpdates;
  for (const b of document.querySelectorAll('#setTheme button')) b.classList.toggle('on', b.dataset.value === s.theme);
  $('#loginHint').classList.toggle('hidden', state.platform !== 'linux');
  $('#setLogin').disabled = state.platform === 'linux';
  $('#aboutVersion').textContent = `v${state.version}`;
  $('#serverInfo').textContent = state.serverPort ? t('settings.serverPort', { port: state.serverPort }) : t('settings.serverOff');

  const ul = $('#clientList');
  ul.replaceChildren();
  if (!s.pairedClients?.length) {
    const li = document.createElement('li');
    li.appendChild(span(t('settings.noPaired'), 'muted'));
    ul.appendChild(li);
  }
  for (const c of s.pairedClients || []) {
    const li = document.createElement('li');
    const grow = document.createElement('div');
    grow.className = 'grow';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.client;
    grow.append(name, span(t('settings.pairedMeta', { created: fmtDate(c.createdAt), used: fmtDate(c.lastUsed) }), 'hint'));
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = t('settings.revoke');
    btn.addEventListener('click', async () => {
      state.settings = await api.revokeClient(c.id);
      renderSettings();
    });
    li.append(grow, btn);
    ul.appendChild(li);
  }
}

async function saveSetting(patch) {
  state.settings = await api.setSettings(patch);
  applyTheme();
  renderSettings();
}

function fillQualitySelect(sel, probed, value) {
  const opts = [['best', t('add.qualityBest')]];
  if (probed?.qualities?.length) {
    for (const q of probed.qualities) {
      opts.push([String(q.height), `${q.height}p${q.fps > 30 ? q.fps : ''}${q.size ? ` · ~${fmtBytes(q.size)}` : ''}`]);
    }
  } else {
    for (const h of [2160, 1440, 1080, 720, 480, 360]) opts.push([String(h), t('add.qualityUpTo', { h })]);
  }
  opts.push(['audio', t('add.qualityAudio')]);
  const cur = value ?? sel.value;
  sel.replaceChildren(...opts.map(([v, label]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    return o;
  }));
  sel.value = opts.some(([v]) => v === cur) ? cur : 'best';
}

function setupSettings() {
  $('#setDirBrowse').addEventListener('click', async (e) => {
    e.preventDefault();
    const dir = await api.pickFolder(state.settings.downloadDir);
    if (dir) saveSetting({ downloadDir: dir });
  });
  const conn = $('#setConn');
  conn.addEventListener('input', () => { $('#setConnOut').textContent = conn.value; });
  conn.addEventListener('change', () => saveSetting({ connections: Number(conn.value) }));
  $('#setConcurrent').addEventListener('change', (e) => saveSetting({ maxConcurrent: Number(e.target.value) }));
  $('#setSpeed').addEventListener('change', (e) => saveSetting({ speedLimit: Number(e.target.value) }));
  $('#setQuality').addEventListener('change', (e) => saveSetting({ videoQuality: e.target.value }));
  $('#setLang').addEventListener('change', (e) => saveSetting({ language: e.target.value }));
  $('#setLogin').addEventListener('change', (e) => saveSetting({ startAtLogin: e.target.checked }));
  $('#setTray').addEventListener('change', (e) => saveSetting({ minimizeToTray: e.target.checked }));
  $('#setNotify').addEventListener('change', (e) => saveSetting({ notifyOnComplete: e.target.checked }));
  $('#setFocus').addEventListener('change', (e) => saveSetting({ focusOnAdd: e.target.checked }));
  $('#setUpdates').addEventListener('change', (e) => saveSetting({ checkUpdates: e.target.checked }));
  for (const b of document.querySelectorAll('#setTheme button')) {
    b.addEventListener('click', () => saveSetting({ theme: b.dataset.value }));
  }
  $('#btnCheckNow').addEventListener('click', async () => {
    const out = $('#updateStatus');
    out.textContent = t('settings.checking');
    const r = await api.checkUpdate();
    if (!r || r.error) out.textContent = t('settings.updateError', { msg: r?.error || '' });
    else if (r.available) {
      out.textContent = t('update.available', { version: r.latest });
      state.update = r;
      renderUpdate();
    } else out.textContent = t('settings.upToDate', { version: state.version });
  });
  $('#linkHome').addEventListener('click', () => api.openExternal(state.homepage));
  $('#linkRepo').addEventListener('click', () => api.openExternal('https://github.com/PGpenguin72/pget'));
}

// ---------- 導覽 ----------

function showView(name) {
  $('#viewTasks').classList.toggle('hidden', name !== 'tasks');
  $('#viewSettings').classList.toggle('hidden', name !== 'settings');
  $('#openSettings').classList.toggle('active', name === 'settings');
  for (const b of document.querySelectorAll('#nav .nav-item')) {
    b.classList.toggle('active', name === 'tasks' && b.dataset.filter === state.filter);
  }
}

function setupNav() {
  for (const b of document.querySelectorAll('#nav .nav-item')) {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      showView('tasks');
      renderTasks();
    });
  }
  $('#openSettings').addEventListener('click', () => showView('settings'));
  $('#btnBack').addEventListener('click', () => showView('tasks'));
  $('#btnPauseAll').addEventListener('click', () => api.tasks.pauseAll());
  $('#btnResumeAll').addEventListener('click', () => api.tasks.resumeAll());
  $('#btnClear').addEventListener('click', () => api.tasks.clearCompleted());
  $('#updateView').addEventListener('click', () => state.update?.url && api.openExternal(state.update.url));
  $('#updateClose').addEventListener('click', () => {
    if (state.update) sessionStorage.setItem(`dismiss-${state.update.latest}`, '1');
    renderUpdate();
  });
}

// ---------- 新增下載 ----------

const add = { torrents: [], probed: null, probeUrl: '' };
const VIDEO_RE = /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|vimeo\.com|dailymotion\.com|twitch\.tv|twitter\.com|x\.com|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|nicovideo\.jp|nico\.ms|soundcloud\.com|reddit\.com|streamable\.com|bandcamp\.com|rumble\.com)\//i;

function parseUrls(text) {
  return text.split(/[\r\n]+|\s(?=(?:https?|ftp|magnet):)/i).map((s) => s.trim()).filter(Boolean);
}

function renderTorrentChips() {
  const box = $('#addTorrents');
  box.replaceChildren(...add.torrents.map((p, i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.title = p;
    const name = document.createElement('span');
    name.textContent = p.split(/[\\/]/).pop();
    const x = document.createElement('button');
    x.type = 'button';
    x.appendChild(iconSpan('x'));
    x.addEventListener('click', () => { add.torrents.splice(i, 1); renderTorrentChips(); });
    c.append(iconSpan('file'), name, x);
    return c;
  }));
}

function refreshVideoBox() {
  const urls = parseUrls($('#addUrls').value);
  const vids = urls.filter((u) => VIDEO_RE.test(u));
  $('#videoBox').classList.toggle('hidden', vids.length === 0);
  if (vids[0] !== add.probeUrl) {
    add.probed = null;
    add.probeUrl = vids[0] || '';
    $('#videoTitle').textContent = vids.length > 1 ? t('add.videoMany', { n: vids.length }) : t('add.videoDetected');
    fillQualitySelect($('#addQuality'), null, state.settings.videoQuality);
  }
  $('#btnProbe').classList.toggle('hidden', vids.length !== 1);
  // 檔名只在單一網址時有意義
  $('#addName').disabled = urls.length + add.torrents.length > 1;
}

function openAdd({ urls = [], torrents = [] } = {}) {
  const dlg = $('#addDialog');
  $('#addUrls').value = urls.join('\n');
  add.torrents = [...torrents];
  add.probeUrl = null;
  $('#addDir').value = state.settings.downloadDir || '';
  $('#addConn').value = String(Math.min(state.settings.connections, state.engines.maxConnections || 128));
  $('#addSpeed').value = '0';
  $('#addName').value = '';
  $('#addError').classList.add('hidden');
  renderTorrentChips();
  refreshVideoBox();
  if (!dlg.open) dlg.showModal();
  $('#addUrls').focus();
}

function setupAdd() {
  $('#btnAdd').addEventListener('click', () => openAdd());
  const pickTorrents = async () => {
    const files = await api.pickTorrent();
    if (!files.length) return;
    if ($('#addDialog').open) {
      add.torrents.push(...files);
      renderTorrentChips();
      refreshVideoBox();
    } else openAdd({ torrents: files });
  };
  $('#btnTorrent').addEventListener('click', pickTorrents);
  $('#addPickTorrent').addEventListener('click', pickTorrents);
  $('#addUrls').addEventListener('input', refreshVideoBox);
  $('#addCancel').addEventListener('click', () => $('#addDialog').close());
  $('#addDirBrowse').addEventListener('click', async () => {
    const d = await api.pickFolder($('#addDir').value);
    if (d) $('#addDir').value = d;
  });
  $('#btnProbe').addEventListener('click', async () => {
    const btn = $('#btnProbe');
    const url = add.probeUrl;
    btn.disabled = true;
    btn.textContent = t('add.probing');
    try {
      const info = await api.probeVideo({ url });
      if (url !== add.probeUrl) return;
      add.probed = info;
      $('#videoTitle').textContent = info.title;
      $('#videoTitle').title = info.title;
      fillQualitySelect($('#addQuality'), info, $('#addQuality').value);
    } catch (err) {
      toast(t('add.probeFailed', { msg: cleanErr(err) }), true);
    } finally {
      btn.disabled = false;
      btn.textContent = t('add.probe');
    }
  });

  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = parseUrls($('#addUrls').value);
    if (!urls.length && !add.torrents.length) {
      showAddError(t('add.nothing'));
      return;
    }
    const common = {
      dir: $('#addDir').value.trim(),
      connections: Number($('#addConn').value) || state.settings.connections,
      speedLimit: Number($('#addSpeed').value) || 0,
      quality: $('#addQuality').value,
    };
    const single = urls.length + add.torrents.length === 1;
    const filename = single ? $('#addName').value.trim() : '';
    const reqs = [
      ...urls.map((url) => ({ ...common, url, filename })),
      ...add.torrents.map((torrentPath) => ({ ...common, torrentPath })),
    ];
    const res = await api.tasks.add(reqs);
    if (res.errors.length) {
      showAddError(res.errors.map((x) => `${x.url}: ${x.error}`).join('\n'));
      if (!res.ids.length) return;
    } else {
      $('#addDialog').close();
    }
    if (res.ids.length) toast(t('toast.added', { n: res.ids.length }));
    state.filter = 'all';
    showView('tasks');
  });
}

function showAddError(msg) {
  const el = $('#addError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function cleanErr(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- 移除 ----------

let removing = null;
function askRemove(task) {
  removing = task;
  $('#removeMsg').textContent = t('remove.message', { name: task.name });
  $('#removeFiles').checked = false;
  $('#removeDialog').showModal();
}
function setupRemove() {
  $('#removeCancel').addEventListener('click', () => $('#removeDialog').close());
  $('#removeDialog').querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = removing;
    $('#removeDialog').close();
    if (task) await api.tasks.remove(task.id, $('#removeFiles').checked);
  });
}

// ---------- 拖放 ----------

function setupDrop() {
  let depth = 0;
  const overlay = $('#dropOverlay');
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    overlay.classList.remove('hidden');
  });
  window.addEventListener('dragleave', () => {
    depth -= 1;
    if (depth <= 0) { depth = 0; overlay.classList.add('hidden'); }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.add('hidden');
    const dt = e.dataTransfer;
    const torrents = [];
    for (const f of dt.files || []) {
      if (/\.torrent$/i.test(f.name)) {
        const p = api.pathForFile(f);
        if (p) torrents.push(p);
      }
    }
    let urls = [];
    if (!dt.files?.length) {
      const text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
      urls = parseUrls(text.split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n'))
        .filter((u) => /^(https?|ftp|magnet):/i.test(u));
    }
    if (!torrents.length && !urls.length) return;
    if ($('#addDialog').open) {
      const cur = $('#addUrls').value.trim();
      $('#addUrls').value = [cur, ...urls].filter(Boolean).join('\n');
      add.torrents.push(...torrents);
      renderTorrentChips();
      refreshVideoBox();
    } else openAdd({ urls, torrents });
  });
}

// ---------- 啟動 ----------

async function main() {
  hydrateIcons();
  const init = await api.init();
  Object.assign(state, {
    dict: init.dict,
    locale: init.locale,
    settings: init.settings,
    engines: init.engines,
    tasks: init.tasks,
    version: init.version,
    platform: init.platform,
    homepage: init.homepage,
    serverPort: init.serverPort,
    update: init.update,
  });
  applyTheme();
  setupNav();
  setupSettings();
  setupAdd();
  setupRemove();
  setupDrop();
  applyI18n();
  showView('tasks');

  api.onTasks((tasks, speed) => {
    state.tasks = tasks;
    state.speed = speed;
    renderTasks();
  });
  api.onEngines((engines) => {
    state.engines = engines;
    renderEngines();
  });
  api.onSettings((s) => {
    state.settings = s;
    applyTheme();
    renderSettings();
  });
  api.onI18n(({ locale, dict }) => {
    state.locale = locale;
    state.dict = dict;
    applyI18n();
  });
  api.onUpdate((u) => {
    state.update = u;
    renderUpdate();
  });
  // 伺服器埠號在啟動後才確定，重新抓一次
  setTimeout(async () => {
    const again = await api.init();
    state.serverPort = again.serverPort;
    state.engines = again.engines;
    renderEngines();
    renderSettings();
  }, 1500);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openAdd();
    }
  });
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `PGet failed to start: ${err.message}`;
});
