// Syntax-check every JavaScript file in the repo (no linting, no deps).
//   node ci/check-syntax.mjs
//
// Why not just `node --check file.js`? For a .js file containing ES module
// syntax, Node's module auto-detection makes `--check` exit 0 even when the
// module has a syntax error. So module-looking .js files are copied to a temp
// .mjs and checked there, which forces a real ESM parse.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'public', '.wrangler', 'bin', '.engines-dl']);
const EXTS = new Set(['.js', '.mjs', '.cjs']);

function listFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.js', '*.mjs', '*.cjs'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).filter((f) => !f.split('/').some((p) => SKIP_DIRS.has(p)));
  } catch {
    // Not a git checkout: walk the tree.
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (EXTS.has(extname(name))) files.push(relative(ROOT, p));
      }
    };
    walk(ROOT);
    return files;
  }
}

function packageType(file) {
  let dir = dirname(join(ROOT, file));
  while (dir.startsWith(ROOT)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try { return JSON.parse(readFileSync(pkg, 'utf8')).type || 'commonjs'; } catch { return 'commonjs'; }
    }
    if (dir === ROOT) break;
    dir = dirname(dir);
  }
  return 'commonjs';
}

const looksLikeModule = (src) => /^\s*(import\s*[\w{*'"]|export\s)/m.test(src);

const tmp = mkdtempSync(join(tmpdir(), 'pget-syntax-'));
let failed = 0;
const files = listFiles();
for (const file of files) {
  const abs = join(ROOT, file);
  let target = abs;
  if (extname(file) === '.js' && (packageType(file) === 'module' || looksLikeModule(readFileSync(abs, 'utf8')))) {
    target = join(tmp, file.replace(/[\\/]/g, '__') + '.mjs');
    copyFileSync(abs, target);
  }
  const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${file}\n${(r.stderr || '').replaceAll(target, file)}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
