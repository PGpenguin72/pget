// Shared settings helpers (used by the service worker, popup and options page).
// User preferences live in ext.storage.sync; the pairing token is stored in
// ext.storage.local because it is only valid for the PGet app on this machine.
import { ext } from './ext.js';

export const DEFAULT_SETTINGS = Object.freeze({
  paused: false,          // global "pause interception" switch
  minSizeMB: 1,           // downloads with a known size below this go to the browser
  excludedSites: [],      // hostnames; subdomains are matched too
  notify: true,           // show a notification when a download is sent to PGet
  theme: 'system',        // 'system' | 'light' | 'dark'
  language: 'auto',       // 'auto' (follow the browser) | 'zh_TW' | 'en' | 'zh_CN' | 'ja' | 'ko'
});

export async function getSettings() {
  const stored = await ext.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function setSettings(patch) {
  return ext.storage.sync.set(patch);
}

export async function getToken() {
  const { token } = await ext.storage.local.get('token');
  return typeof token === 'string' && token ? token : null;
}

export function setToken(token) {
  return ext.storage.local.set({ token });
}

export function clearToken() {
  return ext.storage.local.remove('token');
}

// ---- optional cookie forwarding
// Off by default. Needs the optional host permission <all_urls>, which is only
// requested at runtime when the user turns the option on. The preference is
// kept in storage.local (not sync) because granted permissions are per browser.

export const COOKIE_ORIGINS = Object.freeze(['<all_urls>']);

export async function hasCookiePermission() {
  try {
    return await ext.permissions.contains({ origins: [...COOKIE_ORIGINS] });
  } catch {
    return false;
  }
}

export async function getSendCookies() {
  const { sendCookies } = await ext.storage.local.get('sendCookies');
  return sendCookies === true;
}

export function setSendCookies(on) {
  return ext.storage.local.set({ sendCookies: !!on });
}

/** True only when the user enabled the option AND the permission is granted. */
export async function cookiesEnabled() {
  return (await getSendCookies()) && (await hasCookiePermission());
}

/** Normalise user input such as "https://www.Example.com/path" into "www.example.com". */
export function normaliseSite(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
    const host = new URL(s).hostname.replace(/^\*\./, '').replace(/\.$/, '');
    return host;
  } catch {
    return '';
  }
}

/** True if hostname equals one of the sites or is a subdomain of one. */
export function hostMatches(hostname, sites) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return sites.some((site) => site && (h === site || h.endsWith('.' + site)));
}
