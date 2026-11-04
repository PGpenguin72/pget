import { ext } from './lib/ext.js';
import { localizePage, t } from './lib/i18n.js';
import { initTheme } from './lib/theme.js';
import { getSettings, setSettings, cookiesEnabled } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('statusHint');
const versionEl = $('version');
const pairBtn = $('pair');
const refreshBtn = $('refresh');
const pausedEl = $('paused');

const STATE_TEXT = {
  checking: 'statusChecking',
  connected: 'statusConnected',
  not_running: 'statusNotRunning',
  not_paired: 'statusNotPaired',
};

const PAIR_ERRORS = {
  denied: 'pairDenied',
  not_running: 'statusNotRunningHint',
};

function setState(state, version) {
  statusEl.className = `status ${state}`;
  statusEl.textContent = t(STATE_TEXT[state]);
  versionEl.textContent = version ? t('popupAppVersion', [version]) : '';
  hintEl.textContent = state === 'not_running' ? t('statusNotRunningHint')
    : state === 'not_paired' ? t('statusNotPairedHint') : '';
  pairBtn.hidden = state !== 'not_paired';
}

async function refresh(force = false) {
  refreshBtn.classList.add('spin');
  try {
    const st = await ext.runtime.sendMessage({ type: 'status', force });
    setState(st?.state || 'not_running', st?.version);
  } catch {
    setState('not_running');
  } finally {
    refreshBtn.classList.remove('spin');
  }
  await showPairing();
}

async function showPairing() {
  const { pairing } = await ext.storage.session.get('pairing');
  if (pairing) {
    pairBtn.hidden = false;
    pairBtn.disabled = true;
    pairBtn.textContent = t('pairWaiting');
    hintEl.textContent = t('pairWaitingHint');
  } else {
    pairBtn.disabled = false;
    pairBtn.textContent = t('popupPair');
  }
}

pairBtn.addEventListener('click', async () => {
  pairBtn.disabled = true;
  pairBtn.textContent = t('pairWaiting');
  hintEl.textContent = t('pairWaitingHint');
  const res = await ext.runtime.sendMessage({ type: 'pair' }).catch(() => null);
  await refresh(true);
  if (res && !res.ok) hintEl.textContent = t(PAIR_ERRORS[res.error] || 'pairFailed');
});

refreshBtn.addEventListener('click', () => refresh(true));

pausedEl.addEventListener('change', () => setSettings({ paused: pausedEl.checked }));

// Cookie forwarding is enabled from the options page: a permission prompt
// would close this popup before we could record the answer.
async function showCookieHint() {
  $('cookieHint').hidden = await cookiesEnabled();
}

$('cookieEnable').addEventListener('click', (e) => {
  e.preventDefault();
  ext.runtime.openOptionsPage();
  window.close();
});

$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  ext.runtime.openOptionsPage();
  window.close();
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.token) refresh(true);
  if (area === 'session' && changes.pairing) showPairing();
  if (area === 'sync' && changes.paused) pausedEl.checked = !!changes.paused.newValue;
  if (area === 'local' && changes.sendCookies) showCookieHint();
});

localizePage();
initTheme();
getSettings().then((s) => { pausedEl.checked = !!s.paused; });
showCookieHint();
refresh(false);
