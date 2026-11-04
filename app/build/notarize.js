// electron-builder afterSign：公證 macOS app 並 staple。
// 不用 electron-builder 內建的 notarize，因為它的 staple 只試一次，
// GitHub 的 macOS runner 連 Apple CloudKit 偶爾會斷線（stapler Error 68），整個 build 就失敗。
// 需要環境變數 APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID；沒設就跳過（未公證的本機／測試 build）。
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

async function retry(label, fn, tries = 6, waitMs = 20000) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= tries) throw err;
      console.warn(`[notarize] ${label} 失敗（第 ${i} 次），${waitMs / 1000} 秒後重試`);
      await sleep(waitMs);
    }
  }
}

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] 沒有 Apple 公證憑證，略過');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pget-notarize-'));
  const zip = path.join(tmp, 'app.zip');
  try {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
    console.log(`[notarize] 送出公證：${appPath}`);
    // notarytool submit 本身也是網路操作，一樣重試
    const auth = ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];
    const result = await retry('notarytool submit', () =>
      JSON.parse(execFileSync('xcrun',
        ['notarytool', 'submit', zip, ...auth, '--wait', '--output-format', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })), 3, 30000);
    console.log(`[notarize] id=${result.id} status=${result.status}`);
    if (result.status !== 'Accepted') {
      // 被拒時把 Apple 的詳細原因印出來
      try { run('xcrun', ['notarytool', 'log', result.id, ...auth]); } catch {}
      throw new Error(`公證失敗：${result.status}`);
    }
    await retry('stapler staple', () => run('xcrun', ['stapler', 'staple', appPath]));
    await retry('stapler validate', () => run('xcrun', ['stapler', 'validate', appPath]));
    console.log('[notarize] 完成');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
