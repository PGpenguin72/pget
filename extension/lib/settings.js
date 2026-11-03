// Shared settings helpers (used by the service worker, popup and options page).
// User preferences live in chrome.storage.sync; the pairing token is stored in
// chrome.storage.local because it is only valid for the PGet app on this machine.

export const DEFAULT_SETTINGS = Object.freeze({
  paused: false,          // global "pause interception" switch
  minSizeMB: 1,           // downloads with a known size below this go to the browser
  excludedSites: [],      // hostnames; subdomains are matched too
  notify: true,           // show a notification when a download is sent to PGet
  theme: 'system',        // 'system' | 'light' | 'dark'
});

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function setSettings(patch) {
  return chrome.storage.sync.set(patch);
}

export async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return typeof token === 'string' && token ? token : null;
}

export function setToken(token) {
  return chrome.storage.local.set({ token });
}

export function clearToken() {
  return chrome.storage.local.remove('token');
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
