// PGet extension background script (Chrome / Edge: service worker; Firefox:
// non-persistent background script, see scripts/build.mjs).
//
// Interception design (users must never lose a download):
//   1. A browser download starts (downloads.onCreated).
//   2. Cheap local checks decide whether it is a candidate (scheme, pause switch,
//      excluded sites, known size, paired). Non-candidates are never touched.
//   3. The candidate is PAUSED, not cancelled, while we talk to PGet.
//   4. Only after PGet answers /add with 200 is the browser download cancelled
//      and erased. On any failure the paused download is RESUMED; if it cannot
//      be resumed it is restarted with downloads.download().
//   5. Downloads started by this extension (byExtensionId === our id) are never
//      intercepted, so the fallback in step 4 cannot loop.
//
// Firefox has no downloads.onDeterminingFilename; this design never needed it,
// so interception works the same in every browser.

import { ext, IS_FIREFOX } from './lib/ext.js';
import {
  getSettings, getToken, hostMatches, clearToken,
  cookiesEnabled, getSendCookies, setSendCookies, hasCookiePermission, COOKIE_ORIGINS,
} from './lib/settings.js';
import { addDownload, getStatus, pair, forgetPort, PGetError } from './lib/pget-client.js';

const t = (key, subs) => ext.i18n.getMessage(key, subs) || key;
const inFlight = new Set();
const HTTP_RE = /^https?:/i;

// ---------------------------------------------------------------- helpers

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function basename(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function nameFromUrl(url) {
  try { return decodeURIComponent(basename(new URL(url).pathname)); } catch { return ''; }
}

/**
 * Firefox only: the cookie store (container tab) a download belongs to.
 * Chrome's DownloadItem has no cookieStoreId, so this is undefined there.
 */
function cookieStoreOf(item) {
  const id = item && item.cookieStoreId;
  return IS_FIREFOX && typeof id === 'string' && id ? id : undefined;
}

async function cookieHeaderFor(url, storeId) {
  if (!HTTP_RE.test(url)) return '';
  // Optional feature: only when the user turned it on AND granted the
  // optional host permission. Otherwise the download is sent without cookies.
  if (!(await cookiesEnabled())) return '';
  // Only the cookies the browser would send to this exact URL
  // (in Firefox: from the same container as the download).
  const query = storeId ? { url, storeId } : { url };
  let cookies;
  try {
    cookies = await ext.cookies.getAll(query);
  } catch {
    // Firefox with first-party isolation (privacy.firstparty.isolate) rejects
    // queries without firstPartyDomain; null matches every first-party domain.
    if (!IS_FIREFOX) return '';
    try {
      cookies = await ext.cookies.getAll({ ...query, firstPartyDomain: null });
    } catch {
      return '';
    }
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function notify(id, titleKey, messageKey, subs) {
  const options = {
    type: 'basic',
    iconUrl: ext.runtime.getURL('icons/icon-128.png'),
    title: t(titleKey),
    message: t(messageKey, subs),
  };
  try {
    // No id: let the browser generate one (Firefox and Chrome both do).
    await (id ? ext.notifications.create(id, options) : ext.notifications.create(options));
  } catch { /* notifications are best effort */ }
}

let badgeTimer = null;
async function flashBadge(text, color, sticky = false) {
  try {
    await ext.action.setBadgeBackgroundColor({ color });
    await ext.action.setBadgeText({ text });
    clearTimeout(badgeTimer);
    if (!sticky) {
      badgeTimer = setTimeout(() => ext.action.setBadgeText({ text: '' }).catch(() => {}), 4000);
    }
  } catch { /* ignore */ }
}

async function onSent(name) {
  flashBadge('✓', '#1f9d6b');
  const { notify: show } = await getSettings();
  if (show) notify('', 'notifySentTitle', 'notifySentBody', [name || t('notifyUnnamedFile')]);
}

async function onFailure(err, userInitiated) {
  const code = err instanceof PGetError ? err.code : 'network';
  if (code === 'unauthorized' || code === 'not_paired') {
    flashBadge('!', '#d97706', true);
    notify('pget-pair', 'notifyPairTitle', 'notifyPairBody');
    return;
  }
  if (userInitiated) {
    notify('', 'notifyErrorTitle', code === 'not_running' ? 'notifyNotRunningBody' : 'notifyErrorBody');
  }
}

/** Give a paused download back to the browser. */
async function giveBack(item) {
  try {
    await ext.downloads.resume(item.id);
    return;
  } catch { /* cannot resume: restart below */ }
  try {
    const [current] = await ext.downloads.search({ id: item.id });
    if (current && current.state === 'complete') return;
    if (current && current.state === 'in_progress') {
      await ext.downloads.cancel(item.id).catch(() => {});
    }
    // byExtensionId on the new item will be ours, so onCreated skips it.
    // Firefox: restart in the same container so the site sees the same cookies.
    const storeId = cookieStoreOf(item);
    await ext.downloads.download(storeId ? { url: item.url, cookieStoreId: storeId } : { url: item.url });
  } catch (e) {
    console.warn('PGet: could not hand the download back to the browser', e);
  }
}

// ---------------------------------------------------------------- interception

async function isCandidate(item, settings) {
  if (item.byExtensionId && item.byExtensionId === ext.runtime.id) return false;
  if (item.incognito) return false;              // never touch private-window downloads
  if (item.state !== 'in_progress') return false;
  const url = item.finalUrl || item.url;
  if (!HTTP_RE.test(url) || !HTTP_RE.test(item.url)) return false; // blob:, data:, file:, etc.
  if (settings.paused) return false;
  const sites = settings.excludedSites || [];
  if ([item.url, url, item.referrer].some((u) => hostMatches(hostOf(u), sites))) return false;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : 0;
  const min = Math.max(0, Number(settings.minSizeMB) || 0) * 1024 * 1024;
  if (size > 0 && size < min) return false;
  if (!(await getToken())) return false;         // not paired: leave it to the browser
  return true;
}

async function intercept(item) {
  if (inFlight.has(item.id)) return;
  const settings = await getSettings();
  if (!(await isCandidate(item, settings))) return;

  inFlight.add(item.id);
  try {
    try {
      await ext.downloads.pause(item.id);
    } catch {
      return; // already finished or failed: nothing to take over
    }

    let current = item;
    try {
      const [fresh] = await ext.downloads.search({ id: item.id });
      if (fresh) current = fresh;
    } catch { /* keep original */ }

    const url = current.finalUrl || current.url;
    const name = basename(current.filename);
    const payload = {
      url,
      filename: name || undefined,
      referrer: current.referrer || undefined,
      cookies: (await cookieHeaderFor(url, cookieStoreOf(current))) || undefined,
      userAgent: navigator.userAgent,
      size: current.totalBytes > 0 ? current.totalBytes : 0,
      mime: current.mime || undefined,
      kind: 'auto',
    };

    try {
      await addDownload(payload);
    } catch (err) {
      await giveBack(current);
      await onFailure(err, false);
      return;
    }

    // PGet confirmed: remove the browser copy.
    try { await ext.downloads.cancel(item.id); } catch { /* ignore */ }
    try { await ext.downloads.erase({ id: item.id }); } catch { /* ignore */ }
    await onSent(name || nameFromUrl(url));
  } finally {
    inFlight.delete(item.id);
  }
}

ext.downloads.onCreated.addListener((item) => {
  intercept(item).catch((e) => console.warn('PGet: intercept error', e));
});

// ---------------------------------------------------------------- context menus

const MENU_LINK = 'pget-link';
const MENU_MEDIA = 'pget-media';
const MENU_PAGE_VIDEO = 'pget-page-video';

async function createMenus() {
  // Promise style only: Firefox's browser.* rejects callback arguments.
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({ id: MENU_LINK, title: t('menuDownloadLink'), contexts: ['link'] });
  ext.contextMenus.create({ id: MENU_MEDIA, title: t('menuDownloadMedia'), contexts: ['video', 'audio'] });
  ext.contextMenus.create({
    id: MENU_PAGE_VIDEO,
    title: t('menuDownloadPageVideo'),
    contexts: ['page', 'frame'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
}

const createMenusSafe = () => { createMenus().catch((e) => console.warn('PGet: menu setup error', e)); };
ext.runtime.onInstalled.addListener(createMenusSafe);
ext.runtime.onStartup.addListener(createMenusSafe);

// ---------------------------------------------------------------- optional cookie permission

/** Turn the cookie option off if its permission is no longer granted. */
async function syncCookiePermission() {
  if ((await getSendCookies()) && !(await hasCookiePermission())) await setSendCookies(false);
}

ext.runtime.onInstalled.addListener(() => { syncCookiePermission().catch(() => {}); });
ext.runtime.onStartup.addListener(() => { syncCookiePermission().catch(() => {}); });
ext.permissions.onRemoved.addListener((removed) => {
  if ((removed.origins || []).some((o) => COOKIE_ORIGINS.includes(o))) {
    setSendCookies(false).catch(() => {});
  } else {
    syncCookiePermission().catch(() => {});
  }
});

async function sendFromMenu({ url, referrer, kind, fallbackToBrowser, storeId }) {
  try {
    await addDownload({
      url,
      referrer: referrer || undefined,
      cookies: (await cookieHeaderFor(url, storeId)) || undefined,
      userAgent: navigator.userAgent,
      size: 0,
      kind,
    });
    await onSent((HTTP_RE.test(url) && kind !== 'video' && nameFromUrl(url)) || url.slice(0, 80));
  } catch (err) {
    // An explicit "download this link" should still work when PGet is unavailable.
    if (fallbackToBrowser && HTTP_RE.test(url)) {
      try {
        await ext.downloads.download(storeId ? { url, cookieStoreId: storeId } : { url });
      } catch { /* ignore */ }
    }
    await onFailure(err, true);
  }
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  // info.pageUrl / frameUrl are provided by contextMenus without any host permission.
  const pageUrl = info.frameUrl || info.pageUrl || '';
  let job = null;

  if (info.menuItemId === MENU_LINK) {
    const url = info.linkUrl || '';
    if (/^magnet:/i.test(url)) job = { url, kind: 'magnet' };
    else if (HTTP_RE.test(url)) job = { url, referrer: pageUrl, kind: 'auto', fallbackToBrowser: true };
  } else if (info.menuItemId === MENU_MEDIA) {
    const src = info.srcUrl || '';
    // Streams (blob:/MSE) cannot be fetched directly: let PGet extract from the page.
    if (HTTP_RE.test(src)) job = { url: src, referrer: pageUrl, kind: 'auto', fallbackToBrowser: true };
    else if (HTTP_RE.test(pageUrl)) job = { url: pageUrl, kind: 'video' };
  } else if (info.menuItemId === MENU_PAGE_VIDEO) {
    if (HTTP_RE.test(pageUrl)) job = { url: pageUrl, kind: 'video' };
  }

  if (!job) {
    notify('', 'notifyErrorTitle', 'notifyUnsupportedBody');
    return;
  }
  // Firefox: use the container (cookie store) of the tab the menu was opened in.
  job.storeId = cookieStoreOf(tab);
  sendFromMenu(job).catch((e) => console.warn('PGet: menu error', e));
});

ext.notifications.onClicked.addListener((id) => {
  if (id === 'pget-pair') ext.runtime.openOptionsPage();
  ext.notifications.clear(id);
});

// ---------------------------------------------------------------- popup / options API

let pairing = null;
// A service-worker restart abandons any pending pair request.
ext.storage.session.set({ pairing: false }).catch(() => {});

async function doPair() {
  if (!pairing) {
    pairing = (async () => {
      await ext.storage.session.set({ pairing: true });
      try {
        await pair();
        ext.action.setBadgeText({ text: '' }).catch(() => {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof PGetError ? err.code : 'network' };
      } finally {
        await ext.storage.session.set({ pairing: false });
        pairing = null;
      }
    })();
  }
  return pairing;
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const handlers = {
    status: () => getStatus({ force: !!msg.force }),
    pair: () => doPair(),
    forget: async () => { await clearToken(); forgetPort(); return { ok: true }; },
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.code || e) }));
  return true;
});
