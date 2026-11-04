#!/usr/bin/env node
// Builds browser-specific copies of the extension from the one source tree.
//   node extension/scripts/build.mjs            -> chrome + firefox
//   node extension/scripts/build.mjs firefox    -> only firefox
// Output: dist/extension/<target>/ (repo root). Zip it with the CI workflow,
// or lint the Firefox copy with:  npx web-ext lint -s dist/extension/firefox
//
// The code is identical for every target; only manifest.json differs:
//   chrome  : manifest.json as is (background.service_worker).
//   firefox : background.scripts (Firefox has no extension service workers),
//             browser_specific_settings.gecko (add-on id, minimum version,
//             data_collection_permissions required by addons.mozilla.org),
//             no minimum_chrome_version.
// Dev-only files (scripts/, *.md, dotfiles) are not copied.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(SRC, '..', 'dist', 'extension');

export const GECKO_ID = 'pget@pg72.tw';
// 140 (ESR) is the first Firefox that understands data_collection_permissions;
// it also covers background type "module", storage.session and
// optional_host_permissions in MV3.
export const GECKO_MIN_VERSION = '140.0';

const TARGETS = {
  chrome: (m) => m,
  firefox: (m) => {
    const out = { ...m };
    delete out.minimum_chrome_version;
    const bg = out.background || {};
    out.background = { scripts: [bg.service_worker || 'background.js'] };
    if (bg.type) out.background.type = bg.type;
    out.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN_VERSION,
        // Nothing leaves the user's computer: data only goes to the PGet app on 127.0.0.1.
        data_collection_permissions: { required: ['none'] },
      },
    };
    return out;
  },
};

function skip(rel) {
  const first = rel.split(/[\\/]/)[0];
  const name = rel.split(/[\\/]/).pop();
  return first === 'scripts' || name.startsWith('.') || extname(name).toLowerCase() === '.md';
}

function copyTree(from, to, rel = '') {
  for (const name of readdirSync(join(from, rel))) {
    const r = rel ? join(rel, name) : name;
    if (skip(r) || r === 'manifest.json') continue;
    const p = join(from, r);
    if (statSync(p).isDirectory()) {
      mkdirSync(join(to, r), { recursive: true });
      copyTree(from, to, r);
    } else {
      copyFileSync(p, join(to, r));
    }
  }
}

export function build(target) {
  const transform = TARGETS[target];
  if (!transform) throw new Error(`unknown target "${target}" (use: ${Object.keys(TARGETS).join(', ')})`);
  const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
  const dir = join(OUT, target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyTree(SRC, dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(transform(manifest), null, 2) + '\n');
  return dir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const targets = args.length ? args : Object.keys(TARGETS);
  for (const t of targets) console.log(`${t}: ${build(t)}`);
}
