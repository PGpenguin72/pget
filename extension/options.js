import { ext } from './lib/ext.js';
import { localizePage, t } from './lib/i18n.js';
import { initTheme, applyTheme } from './lib/theme.js';
import {
  getSettings, setSettings, normaliseSite, DEFAULT_SETTINGS,
  cookiesEnabled, setSendCookies, COOKIE_ORIGINS,
} from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('statusHint');
const pairBtn = $('pair');
const forgetBtn = $('forget');

let settings = { ...DEFAULT_SETTINGS };
let toastTimer = null;

function toast(key) {
  const el = $('toast');
  el.textContent = t(key);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await setSettings(patch);
  toast('optSaved');
}

// ------------------------------------------------------------ connection

const STATE_TEXT = {
  connected: 'statusConnected',
  not_running: 'statusNotRunning',
  not_paired: 'statusNotPaired',
};

async function refreshStatus(force = true) {
  let st;
  try { st = await ext.runtime.sendMessage({ type: 'status', force }); } catch { st = null; }
  const state = st?.state || 'not_running';
  statusEl.className = `status ${state}`;
  statusEl.textContent = t(STATE_TEXT[state]);
  hintEl.textContent = state === 'connected' ? t('popupAppVersion', [st.version || '?'])
    : state === 'not_running' ? t('statusNotRunningHint') : t('statusNotPairedHint');
  pairBtn.textContent = t(state === 'connected' ? 'optRepair' : 'popupPair');
  pairBtn.disabled = state === 'not_running';
  forgetBtn.disabled = state === 'not_paired';
  const { pairing } = await ext.storage.session.get('pairing');
  if (pairing) {
    pairBtn.disabled = true;
    pairBtn.textContent = t('pairWaiting');
    hintEl.textContent = t('pairWaitingHint');
  }
}

pairBtn.addEventListener('click', async () => {
  pairBtn.disabled = true;
  pairBtn.textContent = t('pairWaiting');
  hintEl.textContent = t('pairWaitingHint');
  const res = await ext.runtime.sendMessage({ type: 'pair' }).catch(() => null);
  await refreshStatus();
  if (res?.ok) toast('pairSuccess');
  else hintEl.textContent = t(res?.error === 'denied' ? 'pairDenied' : 'pairFailed');
});

forgetBtn.addEventListener('click', async () => {
  if (!confirm(t('optForgetConfirm'))) return;
  await ext.runtime.sendMessage({ type: 'forget' }).catch(() => null);
  await refreshStatus();
  toast('optForgotten');
});

// ------------------------------------------------------------ interception

$('paused').addEventListener('change', (e) => save({ paused: e.target.checked }));

$('minSize').addEventListener('change', (e) => {
  let v = Number(e.target.value);
  if (!Number.isFinite(v) || v < 0) v = DEFAULT_SETTINGS.minSizeMB;
  v = Math.min(10240, Math.round(v * 10) / 10);
  e.target.value = String(v);
  save({ minSizeMB: v });
});

function renderSites() {
  const list = $('siteList');
  list.replaceChildren();
  for (const site of settings.excludedSites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = t('optRemove');
    del.setAttribute('aria-label', `${t('optRemove')} ${site}`);
    del.addEventListener('click', () => {
      save({ excludedSites: settings.excludedSites.filter((s) => s !== site) }).then(renderSites);
    });
    li.append(name, del);
    list.append(li);
  }
  $('siteEmpty').hidden = settings.excludedSites.length > 0;
}

$('siteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('siteInput');
  const site = normaliseSite(input.value);
  if (!site) { toast('optInvalidSite'); return; }
  input.value = '';
  if (settings.excludedSites.includes(site)) return;
  await save({ excludedSites: [...settings.excludedSites, site].sort() });
  renderSites();
});

// ------------------------------------------------------------ cookies (optional)

const cookiesEl = $('sendCookies');

cookiesEl.addEventListener('change', () => {
  if (cookiesEl.checked) {
    // permissions.request must run directly inside the user gesture: no await before it.
    ext.permissions.request({ origins: [...COOKIE_ORIGINS] }).then(async (granted) => {
      if (!granted) {
        cookiesEl.checked = false;
        await setSendCookies(false);
        toast('optSendCookiesDenied');
        return;
      }
      await setSendCookies(true);
      toast('optSaved');
    }, () => {
      cookiesEl.checked = false;
      toast('optSendCookiesDenied');
    });
  } else {
    setSendCookies(false)
      .then(() => ext.permissions.remove({ origins: [...COOKIE_ORIGINS] }).catch(() => false))
      .then(() => toast('optSaved'));
  }
});

async function syncCookieSwitch() {
  cookiesEl.checked = await cookiesEnabled();
}

// ------------------------------------------------------------ appearance

$('notify').addEventListener('change', (e) => save({ notify: e.target.checked }));

for (const radio of document.querySelectorAll('input[name="theme"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    applyTheme(radio.value);
    save({ theme: radio.value });
  });
}

// ------------------------------------------------------------ init

async function init() {
  localizePage();
  await initTheme();
  settings = await getSettings();
  $('paused').checked = !!settings.paused;
  $('minSize').value = String(settings.minSizeMB);
  $('notify').checked = !!settings.notify;
  const radio = document.querySelector(`input[name="theme"][value="${settings.theme}"]`)
    || document.querySelector('input[name="theme"][value="system"]');
  radio.checked = true;
  $('extVersion').textContent = t('optVersion', [ext.runtime.getManifest().version]);
  renderSites();
  await syncCookieSwitch();
  refreshStatus(false);

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.token) refreshStatus();
    if (area === 'session' && changes.pairing) refreshStatus(false);
    if (area === 'sync' && changes.paused) $('paused').checked = !!changes.paused.newValue;
    if (area === 'local' && changes.sendCookies) syncCookieSwitch();
  });
  ext.permissions.onRemoved.addListener(syncCookieSwitch);
  ext.permissions.onAdded.addListener(syncCookieSwitch);
}

init();
