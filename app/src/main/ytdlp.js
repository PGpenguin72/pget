// yt-dlp：探測格式（-J）與下載（解析 --progress-template 輸出）
'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// 已知的影片網站（kind: auto 時判斷用），其他網址交給 aria2
const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'bilibili.com', 'b23.tv',
  'vimeo.com', 'dailymotion.com', 'twitch.tv', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch', 'nicovideo.jp',
  'nico.ms', 'soundcloud.com', 'reddit.com', 'v.redd.it', 'streamable.com',
  'bandcamp.com', 'mixcloud.com', 'vk.com', 'ok.ru', 'rumble.com', 'kick.com',
];

function isVideoUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// 把 "a=1; b=2" 轉成 Netscape cookie 檔，放在暫存資料夾，用完就刪
function writeCookieFile(url, cookieHeader) {
  if (!cookieHeader) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const secure = u.protocol === 'https:' ? 'TRUE' : 'FALSE';
  const lines = ['# Netscape HTTP Cookie File', '# PGet 暫存，下載結束後刪除'];
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || /[\t\r\n]/.test(name + value)) continue;
    // 前面加點 = 子網域也適用（yt-dlp 常會打 API 子網域）
    lines.push([`.${u.hostname.replace(/^www\./, '')}`, 'TRUE', '/', secure, expires, name, value].join('\t'));
  }
  const file = path.join(os.tmpdir(), `pget-cookies-${crypto.randomBytes(8).toString('hex')}.txt`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  return file;
}

function rmQuiet(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch { /* 不存在就算了 */ }
}

function commonArgs({ cookies, url, userAgent, referrer, ffmpeg }) {
  const args = ['--no-playlist', '--no-warnings', '--ignore-config', '--no-mtime'];
  if (userAgent) args.push('--user-agent', userAgent);
  if (referrer) args.push('--referer', referrer);
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  const cookieFile = writeCookieFile(url, cookies);
  if (cookieFile) args.push('--cookies', cookieFile);
  return { args, cookieFile };
}

// 畫質選項 → yt-dlp -f 格式字串
function formatSelector(quality, hasFfmpeg) {
  if (quality === 'audio') return 'ba/b';
  if (/^\d+$/.test(String(quality))) {
    const h = Number(quality);
    return hasFfmpeg ? `bv*[height<=${h}]+ba/b[height<=${h}]/b` : `b[height<=${h}]/b`;
  }
  return hasFfmpeg ? 'bv*+ba/b' : 'b';
}

/** 探測：回傳 { title, duration, thumbnail, qualities: [{ id, height, ext, size }] } */
function probe(bin, info) {
  return new Promise((resolve, reject) => {
    const { args, cookieFile } = commonArgs(info);
    const proc = spawn(bin, [...args, '-J', '--', info.url], { windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => proc.kill(), 60_000);
    proc.on('error', (e) => { clearTimeout(timer); rmQuiet(cookieFile); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      rmQuiet(cookieFile);
      if (code !== 0) return reject(new Error(lastError(err) || `yt-dlp exited ${code}`));
      try {
        const j = JSON.parse(Buffer.concat(out).toString('utf8'));
        const heights = new Map();
        for (const f of j.formats || []) {
          if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
          const size = f.filesize || f.filesize_approx || 0;
          const prev = heights.get(f.height);
          if (!prev || size > prev.size) heights.set(f.height, { id: String(f.height), height: f.height, ext: f.ext, size, fps: f.fps || 0 });
        }
        resolve({
          title: j.title || j.id || info.url,
          duration: j.duration || 0,
          uploader: j.uploader || '',
          qualities: [...heights.values()].sort((a, b) => b.height - a.height),
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function lastError(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.startsWith('ERROR'));
  return (lines.pop() || '').replace(/^ERROR:\s*/, '').slice(0, 500);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 一個 yt-dlp 下載程序。事件：progress、name、done、error
 */
class VideoJob extends EventEmitter {
  constructor(bin, task, { ffmpeg, connections, speedLimit }) {
    super();
    this.bin = bin;
    this.task = task;
    this.ffmpeg = ffmpeg;
    this.connections = connections;
    this.speedLimit = speedLimit;
    this.proc = null;
    this.killed = false;
    this.part = 0;
    this.lastDownloaded = 0;
    this.doneBefore = 0; // 前面已完成的分段（影片＋音訊分開下載時）
  }

  start() {
    const t = this.task;
    const { args, cookieFile } = commonArgs({ ...t.headers, url: t.url, ffmpeg: this.ffmpeg });
    this.cookieFile = cookieFile;
    const template = t.filename ? t.filename.replace(/[\\/]/g, '_') : '%(title).180B [%(id)s].%(ext)s';
    args.push(
      '-f', formatSelector(t.video?.quality || 'best', Boolean(this.ffmpeg)),
      '-P', t.dir,
      '-o', template,
      '--newline', '--progress',
      '--progress-template', 'download:PGETP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s',
      '--print', 'before_dl:PGETN|%(filename)s',
      '--print', 'after_move:PGETF|%(filepath)s',
      '--concurrent-fragments', String(Math.max(1, Math.min(16, this.connections))),
      '--retries', '10',
      '--continue',
    );
    // 存成到處都能播的 MP4：優先 H.264 畫面＋AAC 聲音（AV1／VP9＋Opus 很多播放器播不了）。
    // 畫質上限仍由 -f 的 height 篩選決定；只有 VP9／AV1 的影片也會照樣封裝成 MP4。
    args.push('-S', 'vcodec:h264,acodec:aac');
    if (this.ffmpeg && t.video?.quality !== 'audio') args.push('--merge-output-format', 'mp4');
    if (this.speedLimit > 0) args.push('--limit-rate', `${this.speedLimit}K`);
    args.push('--', t.url);

    let errText = '';
    this.proc = spawn(this.bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const onLine = (line) => this.parse(line);
    let bufOut = '';
    let bufErr = '';
    this.proc.stdout.on('data', (d) => {
      bufOut += d;
      const lines = bufOut.split(/\r?\n/);
      bufOut = lines.pop();
      lines.forEach(onLine);
    });
    this.proc.stderr.on('data', (d) => {
      bufErr += d;
      const lines = bufErr.split(/\r?\n/);
      bufErr = lines.pop();
      for (const l of lines) {
        if (l.startsWith('PGET')) onLine(l);
        else errText = (errText + l + '\n').slice(-4000);
      }
    });
    this.proc.on('error', (e) => this.finish(e.message));
    this.proc.on('close', (code) => {
      if (bufOut) onLine(bufOut);
      if (this.killed) return this.finish(null, true);
      if (code === 0) return this.finish(null);
      this.finish(lastError(errText) || `yt-dlp exited ${code}`);
    });
  }

  parse(line) {
    if (line.startsWith('PGETP|')) {
      const [, status, dl, total, est, speed] = line.split('|');
      const downloaded = num(dl);
      // 下載量突然變小 = 換到下一個分段（例如先影片後音訊）
      if (downloaded + 1024 < this.lastDownloaded) {
        this.doneBefore += this.lastDownloaded;
        this.part += 1;
      }
      this.lastDownloaded = downloaded;
      const size = num(total) || num(est);
      this.emit('progress', {
        completedLength: this.doneBefore + downloaded,
        totalLength: size ? this.doneBefore + size : 0,
        downloadSpeed: status === 'finished' ? 0 : num(speed),
        part: this.part,
      });
    } else if (line.startsWith('PGETN|')) {
      this.emit('name', line.slice(6).trim());
    } else if (line.startsWith('PGETF|')) {
      this.emit('file', line.slice(6).trim());
    }
  }

  finish(error, stopped = false) {
    if (this.finished) return;
    this.finished = true;
    rmQuiet(this.cookieFile);
    if (stopped) this.emit('stopped');
    else if (error) this.emit('error', error);
    else this.emit('done');
  }

  stop() {
    if (!this.proc || this.finished) return;
    this.killed = true;
    try { this.proc.kill(); } catch { /* ignore */ }
  }
}

// 刪除 yt-dlp 的成品與暫存檔（只刪同資料夾、同主檔名開頭的檔案）
function removeVideoFiles(dir, filename, filepath) {
  if (filepath) rmQuiet(filepath);
  if (!filename) return;
  const base = path.basename(filename);
  const stem = base.replace(/\.[^.]+$/, '');
  if (stem.length < 3) return;
  let list = [];
  try { list = fs.readdirSync(dir); } catch { return; }
  for (const f of list) {
    if (!f.startsWith(`${stem}.`)) continue;
    if (f === base || /\.(part|ytdl|temp)$/.test(f) || /\.f\d+\./.test(f) || /\.part-Frag\d+/.test(f)) {
      rmQuiet(path.join(dir, f));
    }
  }
}

module.exports = { probe, VideoJob, isVideoUrl, removeVideoFiles, formatSelector };
