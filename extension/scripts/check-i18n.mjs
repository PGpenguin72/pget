#!/usr/bin/env node
// Validates the extension's manifest and translations.
//   node extension/scripts/check-i18n.mjs
// Checks:
//   - manifest.json is valid JSON and default_locale exists
//   - every _locales/*/messages.json is valid JSON
//   - every key used in manifest (__MSG_x__), HTML (data-i18n*) and JS
//     (t('x'), getMessage('x'), and message-key string literals) exists in ALL locales
//   - every locale has exactly the same keys and placeholders as the default locale
//   - extName <= 75 chars, extDescription <= 132 chars (Chrome Web Store limits)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_LOCALES = ['zh_TW', 'en', 'zh_CN', 'ja', 'ko'];
const KEY_PREFIX = /^(ext|action|menu|notify|status|popup|pair|opt|options)[A-Z]\w*$/;

const errors = [];
const warn = [];
const err = (m) => errors.push(m);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(`${path}: invalid JSON (${e.message})`);
    return null;
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '_locales' || name === 'scripts' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---- manifest
const manifest = readJson(join(ROOT, 'manifest.json'));
const defaultLocale = manifest?.default_locale;
if (manifest && manifest.manifest_version !== 3) err('manifest_version must be 3');

// ---- locales
const locales = {};
for (const loc of readdirSync(join(ROOT, '_locales'))) {
  const data = readJson(join(ROOT, '_locales', loc, 'messages.json'));
  if (data) locales[loc] = data;
}
for (const loc of REQUIRED_LOCALES) if (!locales[loc]) err(`missing locale ${loc}`);
if (defaultLocale && !locales[defaultLocale]) err(`default_locale ${defaultLocale} has no messages.json`);

// ---- collect used keys
const used = new Map(); // key -> first place used
const use = (key, where) => { if (!used.has(key)) used.set(key, where); };

const manifestText = readFileSync(join(ROOT, 'manifest.json'), 'utf8');
for (const m of manifestText.matchAll(/__MSG_(\w+)__/g)) use(m[1], 'manifest.json');

for (const file of walk(ROOT)) {
  const ext = extname(file);
  if (!['.html', '.js', '.mjs'].includes(ext)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);
  for (const m of text.matchAll(/__MSG_(\w+)__/g)) use(m[1], rel);
  if (ext === '.html') {
    for (const m of text.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) use(m[1], rel);
  } else {
    for (const m of text.matchAll(/\b(?:t|getMessage)\(\s*['"`](\w+)['"`]/g)) use(m[1], rel);
    // String literals that look like message keys (skip element ids passed to $() / getElementById()).
    for (const m of text.matchAll(/(?<!\$\(|getElementById\()['"](\w+)['"]/g)) if (KEY_PREFIX.test(m[1])) use(m[1], rel);
    // Dynamic keys we cannot see statically.
    for (const m of text.matchAll(/\b(?:t|getMessage)\(\s*([A-Za-z_$][\w.$[\]]*)\s*[,)]/g)) {
      if (!/^(key|titleKey|messageKey)$/.test(m[1]) && !m[1].includes('[')) {
        warn.push(`${rel}: dynamic i18n key "${m[1]}" (make sure its values are literals)`);
      }
    }
  }
}

// ---- verify
const base = locales[defaultLocale] || locales.zh_TW || {};
for (const [key, where] of used) {
  for (const loc of REQUIRED_LOCALES) {
    if (locales[loc] && !locales[loc][key]) err(`key "${key}" (used in ${where}) missing in ${loc}`);
  }
}
for (const loc of REQUIRED_LOCALES) {
  const data = locales[loc];
  if (!data) continue;
  for (const key of Object.keys(base)) if (!data[key]) err(`${loc}: missing key "${key}" present in ${defaultLocale}`);
  for (const key of Object.keys(data)) {
    if (!base[key]) err(`${loc}: extra key "${key}" not in ${defaultLocale}`);
    const msg = data[key]?.message;
    if (typeof msg !== 'string' || !msg.trim()) err(`${loc}: "${key}" has an empty message`);
    const ph = Object.keys(data[key]?.placeholders || {}).sort().join(',');
    const bph = Object.keys(base[key]?.placeholders || {}).sort().join(',');
    if (base[key] && ph !== bph) err(`${loc}: "${key}" placeholders differ from ${defaultLocale}`);
    for (const m of String(msg).matchAll(/\$(\w+)\$/g)) {
      if (!data[key].placeholders?.[m[1].toLowerCase()]) err(`${loc}: "${key}" uses $${m[1]}$ without a placeholder`);
    }
  }
  if (data.extName && data.extName.message.length > 75) err(`${loc}: extName longer than 75 chars`);
  if (data.extDescription && data.extDescription.message.length > 132) err(`${loc}: extDescription longer than 132 chars`);
}
for (const key of Object.keys(base)) if (!used.has(key)) warn.push(`unused key "${key}"`);

for (const w of warn) console.warn('warn:', w);
if (errors.length) {
  for (const e of errors) console.error('error:', e);
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`OK: manifest valid, ${used.size} keys used, ${Object.keys(base).length} keys x ${REQUIRED_LOCALES.length} locales.`);
