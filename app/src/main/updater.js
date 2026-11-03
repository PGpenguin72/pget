// 檢查更新：只查詢 GitHub 最新 release 的版本號，不送出任何使用者資料，也不會自動下載
'use strict';

const { net } = require('electron');

const API = 'https://api.github.com/repos/PGpenguin72/pget/releases/latest';

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
  const url = typeof j.html_url === 'string' && j.html_url.startsWith('https://github.com/PGpenguin72/pget/')
    ? j.html_url : 'https://github.com/PGpenguin72/pget/releases/latest';
  return { available: newer(latest, currentVersion), latest: latest.replace(/^v/i, ''), url };
}

module.exports = { checkForUpdate, newer };
