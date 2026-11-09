// electron-builder afterAllArtifactBuild：把已簽章的 .dmg 送 Apple 公證並 staple。
// （裡面的 PGet.app 已經在 afterSign 的 notarize.js 公證過；這裡處理 dmg 這個外殼本身，
//   讓下載後打開 dmg 時 Gatekeeper 也能離線驗證。）
// staple 會改動 dmg 內容，但 latest-mac.yml 的雜湊在這之前就算好了，所以 release.yml 之後會跑
// build/update-info.mjs 依實際檔案重算 latest-mac.yml，並刪掉過期的 dmg .blockmap。
// （自動更新用的是 zip，zip 不會被這裡改動。）
// 需要 APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID；沒設就跳過。
'use strict';

const { execFileSync } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(label, fn, tries = 6, waitMs = 20000) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= tries) throw err;
      console.warn(`[notarize-dmg] ${label} 失敗（第 ${i} 次），${waitMs / 1000} 秒後重試`);
      await sleep(waitMs);
    }
  }
}

exports.default = async function notarizeDmgs(result) {
  const dmgs = result.artifactPaths.filter((p) => p.endsWith('.dmg'));
  if (!dmgs.length) return [];
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize-dmg] 沒有 Apple 公證憑證，略過');
    return [];
  }
  const auth = ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] 送出公證：${dmg}`);
    const res = await retry('notarytool submit', () =>
      JSON.parse(execFileSync('xcrun',
        ['notarytool', 'submit', dmg, ...auth, '--wait', '--output-format', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })), 3, 30000);
    console.log(`[notarize-dmg] id=${res.id} status=${res.status}`);
    if (res.status !== 'Accepted') {
      try { execFileSync('xcrun', ['notarytool', 'log', res.id, ...auth], { stdio: 'inherit' }); } catch {}
      throw new Error(`dmg 公證失敗：${res.status}`);
    }
    await retry('stapler staple', () => execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' }));
    await retry('stapler validate', () => execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'inherit' }));
  }
  console.log('[notarize-dmg] 完成');
  return [];
};
