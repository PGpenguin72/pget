// 尋找下載引擎（aria2c、yt-dlp、ffmpeg）
// 順序：app/bin/<os>-<arch>/ → 打包後的 resources/bin/ → 系統 PATH
// <os> 用 electron-builder 的命名：win / mac / linux
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const OS = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform] || process.platform;
const EXE = process.platform === 'win32' ? '.exe' : '';

// 每個引擎可能的檔名（yt-dlp 官方各平台檔名不同）
const NAMES = {
  aria2c: [`aria2c${EXE}`],
  'yt-dlp': process.platform === 'win32'
    ? ['yt-dlp.exe']
    : process.platform === 'darwin'
      ? ['yt-dlp_macos', 'yt-dlp']
      : ['yt-dlp_linux', 'yt-dlp_linux_aarch64', 'yt-dlp'],
  ffmpeg: [`ffmpeg${EXE}`],
};

// 解除 16 線上限的 aria2（Windows 用 myfreeer 版，mac／Linux 由 CI 編譯）
// fetch-engines.mjs 會在同一個資料夾放這個標記檔
const PATCHED_MARKER = 'aria2-patched.txt';
const STOCK_MAX_CONN = 16;
const PATCHED_MAX_CONN = 128;

function candidateDirs() {
  const dirs = [path.join(app.getAppPath(), 'bin', `${OS}-${process.arch}`)];
  if (app.isPackaged) dirs.push(path.join(process.resourcesPath, 'bin'));
  return dirs;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findOnPath(names) {
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir.replace(/^"|"$/g, ''), n);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function find(engine) {
  const names = NAMES[engine];
  for (const dir of candidateDirs()) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (isFile(p)) return { path: p, source: 'bundled' };
    }
  }
  const p = findOnPath(names);
  return p ? { path: p, source: 'system' } : null;
}

// 回傳所有引擎的狀態，介面用來顯示「找不到引擎」
function detectEngines() {
  const aria2 = find('aria2c');
  const ytdlp = find('yt-dlp');
  const ffmpeg = find('ffmpeg');
  let maxConnections = STOCK_MAX_CONN;
  if (aria2 && isFile(path.join(path.dirname(aria2.path), PATCHED_MARKER))) {
    maxConnections = PATCHED_MAX_CONN;
  }
  return {
    aria2: aria2 ? { found: true, ...aria2, maxConnections, patched: maxConnections > STOCK_MAX_CONN } : { found: false },
    ytdlp: ytdlp ? { found: true, ...ytdlp } : { found: false },
    ffmpeg: ffmpeg ? { found: true, ...ffmpeg } : { found: false },
  };
}

module.exports = { detectEngines, OS, PATCHED_MARKER, STOCK_MAX_CONN, PATCHED_MAX_CONN };
