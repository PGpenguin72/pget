#!/usr/bin/env node
// 下載 PGet 用的下載引擎到 app/bin/<os>-<arch>/（<os> = win / mac / linux，跟 electron-builder 的 ${os} 一樣）
//
//   node scripts/fetch-engines.mjs                  # 依目前平台下載
//   node scripts/fetch-engines.mjs --aria2-url=URL  # mac／Linux：指定自己編的 aria2（tar.gz）
//   node scripts/fetch-engines.mjs --force          # 已存在也重新下載
//
// 環境變數（CI 用，見 .github/workflows/release.yml）：
//   ARIA2_URL             目前平台的 aria2 tar.gz
//   ARIA2_URL_X64         x64 版（macOS 會兩個架構都抓）
//   ARIA2_URL_ARM64       arm64 版
//   ARIA2_SHA256SUMS_URL  上面那些 tar.gz 的 SHA256SUMS，用來驗證
// tar.gz 裡的路徑是 aria2c-<platform>-<arch>/aria2c（例如 aria2c-linux-x64/aria2c）
//
// 只用 Node 內建模組，Node 18+ 可用（需要全域 fetch）。

// ---------- 固定版本（升級時改這裡） ----------
const YTDLP_VERSION = '2026.10.26';
const ARIA2_WIN_VERSION = '1.37.0';
const ARIA2_WIN_URL = `https://github.com/myfreeer/aria2-build-msys2/releases/download/${ARIA2_WIN_VERSION}/aria2c.7z`;
// myfreeer 沒有附雜湊檔，這是我們自己算的（x64）
const ARIA2_WIN_SHA256 = '8cdc461047f8b4c91c747378a1b9bcf60e04ec21859d244a589e66fcad07a14d';
// -------------------------------------------------

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'app', 'bin');
const PATCHED_MARKER = 'aria2-patched.txt'; // app/src/main/engines.js 看到這個檔才允許 >16 條連線

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : '';
};
const FORCE = flag('force');

const OS = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
if (!OS) {
  console.error(`不支援的平台：${process.platform}`);
  process.exit(1);
}
// macOS 的安裝檔同時打包 x64 與 arm64，所以兩個都要；其他平台只抓本機架構
const ARCHES = process.platform === 'darwin' ? ['x64', 'arm64'] : [process.arch];

const log = (...m) => console.log('[fetch-engines]', ...m);
const warn = (...m) => console.warn('[fetch-engines] ⚠', ...m);

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// GitHub 的 releases/download 偶爾會回 5xx（例如 504），網路錯誤和 5xx／429 就等一下重試；4xx 直接失敗
async function fetchRetry(url, tries = 6) {
  for (let i = 1; ; i++) {
    let res, err;
    try {
      res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'pget-fetch-engines' } });
      if (res.ok) return res;
      err = new Error(`HTTP ${res.status} ${url}`);
      if (res.status < 500 && res.status !== 429) throw err;
    } catch (e) {
      if (res && !res.ok && res.status < 500 && res.status !== 429) throw e;
      err = e;
    }
    if (i >= tries) throw err;
    const wait = Math.min(60, 5 * 2 ** (i - 1));
    warn(`${err.message}，${wait} 秒後重試（${i}/${tries - 1}）`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

async function download(url, dest) {
  log('下載', url);
  const res = await fetchRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

async function fetchText(url) {
  const res = await fetchRetry(url);
  return res.text();
}

// 解析 "hash  filename" 或 "hash *filename" 格式
function parseSums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) map.set(m[2].trim(), m[1].toLowerCase());
  }
  return map;
}

function verify(file, expected, label) {
  const got = sha256File(file);
  if (got !== expected.toLowerCase()) {
    fs.rmSync(file, { force: true });
    throw new Error(`${label} SHA-256 不符！預期 ${expected}，實際 ${got}（檔案已刪除）`);
  }
  log(`${label} SHA-256 驗證通過`);
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pget-engines-'));
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

function has(cmd, testArgs = ['--help']) {
  const r = spawnSync(cmd, testArgs, { stdio: 'ignore', shell: false });
  return !r.error;
}

// ---------- yt-dlp ----------

async function fetchYtdlp(arch) {
  const name = { win: 'yt-dlp.exe', mac: 'yt-dlp_macos', linux: arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux' }[OS];
  const outName = OS === 'win' ? 'yt-dlp.exe' : name;
  const dir = path.join(BIN, `${OS}-${arch}`);
  const dest = path.join(dir, outName);
  if (!FORCE && fs.existsSync(dest)) {
    log(`已存在，略過：${path.relative(ROOT, dest)}`);
    return;
  }
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`;
  const sums = parseSums(await fetchText(`${base}/SHA2-256SUMS`));
  const expected = sums.get(name);
  if (!expected) throw new Error(`SHA2-256SUMS 裡找不到 ${name}`);
  const tmp = path.join(tmpDir(), name);
  await download(`${base}/${name}`, tmp);
  verify(tmp, expected, `yt-dlp ${YTDLP_VERSION} (${name})`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(tmp, dest);
  if (OS !== 'win') fs.chmodSync(dest, 0o755);
  fs.writeFileSync(path.join(dir, 'yt-dlp-VERSION.txt'), `${YTDLP_VERSION}\nhttps://github.com/yt-dlp/yt-dlp (Unlicense)\n`);
  log(`完成：${path.relative(ROOT, dest)}`);
}

// ---------- aria2（Windows：myfreeer 強化版） ----------

function find7z() {
  const cands = [
    process.env.SEVENZIP,
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z', '7za', '7zr',
  ].filter(Boolean);
  for (const c of cands) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : has(c, ['i'])) return c;
  }
  return null;
}

async function fetchAria2Windows(arch) {
  if (arch !== 'x64') {
    warn(`myfreeer 的 aria2 只抓 x64 版，${arch} 請自行準備 aria2c.exe 放到 app/bin/win-${arch}/`);
    return;
  }
  const dir = path.join(BIN, `win-${arch}`);
  const dest = path.join(dir, 'aria2c.exe');
  if (!FORCE && fs.existsSync(dest)) {
    log(`已存在，略過：${path.relative(ROOT, dest)}`);
    return;
  }
  const work = tmpDir();
  const archive = path.join(work, 'aria2c.7z');
  await download(ARIA2_WIN_URL, archive);
  verify(archive, ARIA2_WIN_SHA256, `aria2 ${ARIA2_WIN_VERSION} (myfreeer)`);
  const sevenZip = find7z();
  if (!sevenZip) {
    const keep = path.join(dir, 'aria2c.7z');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(archive, keep);
    warn('找不到 7-Zip，沒辦法自動解壓縮。');
    warn(`請安裝 7-Zip（https://www.7-zip.org/），或手動把 ${path.relative(ROOT, keep)} 裡的 aria2c.exe 解壓到 ${path.relative(ROOT, dir)}，再重新執行這個腳本。`);
    return;
  }
  const out = path.join(work, 'x');
  const r = spawnSync(sevenZip, ['x', '-y', `-o${out}`, archive], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('7-Zip 解壓縮失敗');
  const exe = findFile(out, 'aria2c.exe');
  if (!exe) throw new Error('壓縮檔裡找不到 aria2c.exe');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(exe, dest);
  fs.writeFileSync(path.join(dir, PATCHED_MARKER),
    `aria2 ${ARIA2_WIN_VERSION}, myfreeer/aria2-build-msys2 (GPL-2.0-or-later)\n${ARIA2_WIN_URL}\nmax-connection-per-server up to 128\n`);
  fs.rmSync(path.join(dir, 'aria2c.7z'), { force: true });
  log(`完成：${path.relative(ROOT, dest)}`);
}

// ---------- aria2（macOS／Linux：CI 編的強化版 tar.gz） ----------

function aria2UrlFor(arch) {
  const cli = opt('aria2-url');
  const perArch = process.env[`ARIA2_URL_${arch.toUpperCase()}`];
  if (perArch) return perArch;
  if (arch === process.arch) return cli || process.env.ARIA2_URL || '';
  return '';
}

async function fetchAria2Unix(arch, sums) {
  const dir = path.join(BIN, `${OS}-${arch}`);
  const dest = path.join(dir, 'aria2c');
  if (!FORCE && fs.existsSync(dest)) {
    log(`已存在，略過：${path.relative(ROOT, dest)}`);
    return true;
  }
  const url = aria2UrlFor(arch);
  if (!url) return false;
  const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const work = tmpDir();
  const archive = path.join(work, file);
  await download(url, archive);
  if (sums) {
    const expected = sums.get(file);
    if (!expected) throw new Error(`SHA256SUMS 裡找不到 ${file}`);
    verify(archive, expected, `aria2 (${file})`);
  } else {
    warn(`沒有設定 ARIA2_SHA256SUMS_URL，${file} 沒有驗證雜湊`);
  }
  const out = path.join(work, 'x');
  fs.mkdirSync(out);
  const r = spawnSync('tar', ['-xzf', archive, '-C', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar 解壓縮失敗');
  // 預期路徑 aria2c-<platform>-<arch>/aria2c；找不到就整個搜尋
  const platformName = OS === 'mac' ? 'macos' : 'linux';
  let bin = path.join(out, `aria2c-${platformName}-${arch}`, 'aria2c');
  if (!fs.existsSync(bin)) bin = findFile(out, 'aria2c');
  if (!bin) throw new Error(`${file} 裡找不到 aria2c`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(bin, dest);
  fs.chmodSync(dest, 0o755);
  const copying = path.join(path.dirname(bin), 'COPYING');
  if (fs.existsSync(copying)) fs.copyFileSync(copying, path.join(dir, 'aria2-COPYING.txt'));
  // CI 編的版本有套 aria2-max-connection.patch，允許 128 條
  fs.writeFileSync(path.join(dir, PATCHED_MARKER), `aria2 patched build for PGet (GPL-2.0-or-later)\n${url}\nmax-connection-per-server up to 128\n`);
  log(`完成：${path.relative(ROOT, dest)}`);
  return true;
}

function printAria2Instructions() {
  warn('沒有指定強化版 aria2 的下載網址（ARIA2_URL 或 --aria2-url=）。');
  if (OS === 'mac') warn('可以先用系統的 aria2：brew install aria2');
  else warn('可以先用系統的 aria2：sudo apt install aria2（或你的發行版的套件管理員）');
  warn('PGet 會自動找 PATH 上的 aria2c，但原版每台伺服器最多 16 條連線，設定頁會顯示這個限制。');
}

// ---------- 主程式 ----------

async function main() {
  log(`平台 ${OS}，架構 ${ARCHES.join(', ')}，輸出到 ${path.relative(ROOT, BIN)}/`);
  let failed = false;

  for (const arch of ARCHES) {
    try {
      await fetchYtdlp(arch);
    } catch (err) {
      failed = true;
      console.error('[fetch-engines] yt-dlp 失敗：', err.message);
    }
  }

  if (OS === 'win') {
    for (const arch of ARCHES) {
      try {
        await fetchAria2Windows(arch);
      } catch (err) {
        failed = true;
        console.error('[fetch-engines] aria2 失敗：', err.message);
      }
    }
  } else {
    let sums = null;
    if (process.env.ARIA2_SHA256SUMS_URL) {
      try {
        sums = parseSums(await fetchText(process.env.ARIA2_SHA256SUMS_URL));
      } catch (err) {
        failed = true;
        console.error('[fetch-engines] 讀不到 ARIA2_SHA256SUMS_URL：', err.message);
      }
    }
    let any = false;
    for (const arch of ARCHES) {
      try {
        if (await fetchAria2Unix(arch, sums)) any = true;
        else if (aria2UrlFor(arch) === '' && (process.env.ARIA2_URL || opt('aria2-url'))) {
          warn(`沒有 ${arch} 版的 aria2 網址（ARIA2_URL_${arch.toUpperCase()}），略過`);
        }
      } catch (err) {
        failed = true;
        console.error(`[fetch-engines] aria2 (${arch}) 失敗：`, err.message);
      }
    }
    if (!any) printAria2Instructions();
  }

  log('ffmpeg 沒有自動下載：合併影片＋音訊需要 ffmpeg，請自行安裝或放到 app/bin/<os>-<arch>/。');
  if (failed) process.exit(1);
  log('全部完成 ✔');
}

main().catch((err) => {
  console.error('[fetch-engines]', err);
  process.exit(1);
});
