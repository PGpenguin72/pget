// 主程序的多國語言：跟介面共用 src/renderer/i18n/*.json
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const LOCALES = ['zh-TW', 'en', 'zh-CN', 'ja', 'ko'];
const FALLBACK = 'zh-TW';
const DIR = path.join(__dirname, '..', 'renderer', 'i18n');

const cache = new Map();
function loadDict(locale) {
  if (!cache.has(locale)) {
    try {
      cache.set(locale, JSON.parse(fs.readFileSync(path.join(DIR, `${locale}.json`), 'utf8')));
    } catch {
      cache.set(locale, {});
    }
  }
  return cache.get(locale);
}

// 依作業系統語言挑一個：繁中（台港澳）→ zh-TW、簡中 → zh-CN、日、韓、其他 → en
function detectLocale() {
  const prefs = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages() : [];
  const list = [...prefs, app.getLocale()].filter(Boolean);
  for (const raw of list) {
    const l = raw.toLowerCase();
    if (l.startsWith('zh')) {
      if (/hant|tw|hk|mo/.test(l)) return 'zh-TW';
      return 'zh-CN';
    }
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('en')) return 'en';
  }
  return list.length ? 'en' : FALLBACK;
}

class I18n {
  constructor(setting) {
    this.setLanguage(setting);
  }
  setLanguage(setting) {
    this.locale = LOCALES.includes(setting) ? setting : detectLocale();
    this.dict = { ...loadDict(FALLBACK), ...loadDict(this.locale) };
  }
  t(key, vars) {
    let s = this.dict[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }
}

module.exports = { I18n, LOCALES, detectLocale };
