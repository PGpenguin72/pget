// 重新計算 electron-updater 更新資訊檔（latest.yml／latest-mac.yml／latest-linux.yml）裡的雜湊。
//
// electron-builder 在檔案「剛產生」時就算好 sha512，之後若檔案又被改過
// （Windows 送 SignPath 簽章、macOS 的 dmg 被 notarize-dmg.js staple），yml 裡的雜湊就不對了，
// 自動更新下載完會因為 sha512 不符而失敗。這支腳本依照目前磁碟上的檔案重新填 sha512／size，
// 改過的檔案順便刪掉過期的 .blockmap（electron-updater 找不到 blockmap 會改成完整下載）。
//
//   node build/update-info.mjs <yml 路徑> [--create <檔名>...]
//
// yml 不存在時加上 --create 會用 package.json 的版本重新產生（格式照 electron-builder）。
// 只用 Node 內建模組＋ electron-builder 已經帶的 js-yaml。
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(APP, 'package.json'));
const yaml = require('js-yaml');

function sha512(file) {
  return new Promise((ok, fail) => {
    const h = createHash('sha512');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', fail).on('end', () => ok(h.digest('base64')));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const ymlPath = args[0];
  if (!ymlPath) {
    console.error('usage: node build/update-info.mjs <yml> [--create <file>...]');
    process.exit(2);
  }
  const dir = dirname(resolve(ymlPath));
  const ci = args.indexOf('--create');
  const createFiles = ci >= 0 ? args.slice(ci + 1) : [];

  let info;
  if (existsSync(ymlPath)) {
    info = yaml.load(readFileSync(ymlPath, 'utf8'));
  } else if (createFiles.length) {
    const version = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).version;
    info = { version, files: createFiles.map((f) => ({ url: basename(f) })) };
    console.log(`[update-info] ${ymlPath} 不存在，重新產生`);
  } else {
    console.log(`[update-info] ${ymlPath} 不存在，略過`);
    return;
  }
  if (!info || !Array.isArray(info.files) || !info.files.length) throw new Error(`${ymlPath}: 沒有 files`);

  const kept = [];
  for (const f of info.files) {
    const file = join(dir, f.url);
    if (!existsSync(file)) {
      console.warn(`[update-info] 找不到 ${f.url}，從 ${basename(ymlPath)} 移除`);
      continue;
    }
    const hash = await sha512(file);
    const size = statSync(file).size;
    if (hash !== f.sha512 || size !== f.size) {
      console.log(`[update-info] ${f.url}: 檔案已變更，更新雜湊（${size} bytes）`);
      f.sha512 = hash;
      f.size = size;
      delete f.blockMapSize;
      const bm = `${file}.blockmap`;
      if (existsSync(bm)) {
        rmSync(bm);
        console.log(`[update-info] 刪除過期的 ${basename(bm)}`);
      }
    } else {
      console.log(`[update-info] ${f.url}: 雜湊正確`);
    }
    kept.push(f);
  }
  if (!kept.length) throw new Error(`${ymlPath}: 列出的檔案都不存在`);
  info.files = kept;

  // 舊版相容欄位：path／sha512 指向第一個檔案（mac 是 zip，electron-builder 會把 zip 排第一）
  const first = kept.find((f) => f.url === info.path) || kept[0];
  info.path = first.url;
  info.sha512 = first.sha512;
  if (!info.releaseDate) info.releaseDate = new Date().toISOString();
  // 保持 electron-builder 的欄位順序
  const ordered = { version: info.version, files: info.files, path: info.path, sha512: info.sha512 };
  for (const [k, v] of Object.entries(info)) if (!(k in ordered)) ordered[k] = v;
  writeFileSync(ymlPath, yaml.dump(ordered, { lineWidth: 8000, noRefs: true }));
  console.log(`[update-info] 已寫入 ${ymlPath}`);
}

main().catch((err) => {
  console.error(`[update-info] ${err.message}`);
  process.exit(1);
});
