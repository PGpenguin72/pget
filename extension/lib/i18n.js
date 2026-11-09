// Interface translations.
//
// By default the browser picks the language (_locales + ext.i18n.getMessage).
// The user can override it in the options page (settings.language). In that
// case the chosen _locales/<code>/messages.json is fetched from the extension
// itself (ext.runtime.getURL + fetch: no extra permission; the manifest CSP
// allows connect-src 'self' for this) and used first; any missing key falls
// back to ext.i18n.getMessage.
//
// localizePage() fills elements marked with data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-aria-label. Always sets text /
// attributes, never HTML.
import { ext } from './ext.js';
import { getSettings } from './settings.js';

/** Selectable languages ('auto' = follow the browser). Values are _locales folder names. */
export const LANGUAGES = Object.freeze(['auto', 'zh_TW', 'en', 'zh_CN', 'ja', 'ko']);

let messages = null;   // the chosen locale's messages.json, or null = follow the browser
let current = 'auto';
let loading = null;

/** Chrome-style message formatting: $NAME$ placeholders, $1..$9, $$. */
function format(entry, subs) {
  const args = subs == null ? [] : Array.isArray(subs) ? subs : [subs];
  const arg = (n) => (args[n - 1] == null ? '' : String(args[n - 1]));
  const expand = (s) => s.replace(/\$(\d)|\$\$/g, (m, n) => (n ? arg(Number(n)) : '$'));
  return entry.message.replace(/\$(\w+)\$|\$(\d)|\$\$/g, (m, name, n) => {
    if (name) {
      const ph = entry.placeholders?.[name.toLowerCase()];
      return ph ? expand(String(ph.content)) : m;
    }
    return n ? arg(Number(n)) : '$';
  });
}

export function t(key, subs) {
  const entry = messages && messages[key];
  if (entry && typeof entry.message === 'string') return format(entry, subs);
  return ext.i18n.getMessage(key, subs) || key;
}

async function load(lang) {
  if (!LANGUAGES.includes(lang) || lang === 'auto') {
    messages = null;
    current = 'auto';
    return current;
  }
  try {
    const res = await fetch(ext.runtime.getURL(`_locales/${lang}/messages.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    messages = await res.json();
    current = lang;
  } catch (e) {
    console.warn('PGet: could not load language', lang, e);
    messages = null;
    current = 'auto';
  }
  return current;
}

/** Load the language chosen in the settings. Safe to call many times. */
export function initI18n() {
  if (!loading) loading = getSettings().then((s) => load(s.language)).catch(() => load('auto'));
  return loading;
}

/** Switch to another language (after the setting changed). */
export function setLanguage(lang) {
  loading = load(lang);
  return loading;
}

/** Call fn(lang) after the language setting changes (from any extension page). */
export function onLanguageChanged(fn) {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.language) return;
    setLanguage(changes.language.newValue || 'auto').then(fn, () => {});
  });
}

/** BCP 47 tag of the language in use (for <html lang>). */
export function uiLanguage() {
  return current === 'auto' ? ext.i18n.getUILanguage() : current.replace('_', '-');
}

const ATTRS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-aria-label', 'aria-label'],
];

export function localizePage(root = document) {
  document.documentElement.lang = uiLanguage();
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const [dataAttr, attr] of ATTRS) {
    for (const el of root.querySelectorAll(`[${dataAttr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(dataAttr)));
    }
  }
}
