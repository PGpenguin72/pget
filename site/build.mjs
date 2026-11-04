// 用 src/locales/*.mjs 的翻譯產生 public/ 底下所有語言的頁面。
// node build.mjs
import { mkdirSync, writeFileSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'public');
const SITE = 'https://pget.pg72.tw';
const REPO = 'https://github.com/PGpenguin72/pget';
const EMAIL = 'developer@pg72.tw';
const UPDATED = '2026-11-04';

// 第一個是預設語言，放在網站根目錄
const LOCALES = ['zh-TW', 'en', 'zh-CN', 'ja', 'ko'];
const dir = (code) => (code === LOCALES[0] ? '' : code.toLowerCase() + '/');
const pages = ['', 'privacy/', 'terms/', 'code-signing/'];

const t = {};
for (const code of LOCALES) t[code] = (await import(`./src/locales/${code}.mjs`)).default;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fill = (s) => s.replaceAll('{email}', `<a href="mailto:${EMAIL}">${EMAIL}</a>`).replaceAll('{issues}', `<a href="${REPO}/issues">GitHub Issues</a>`).replaceAll('{repo}', REPO).replaceAll('{updated}', UPDATED);

function layout(code, page, title, desc, body) {
  const L = t[code];
  const base = '/' + dir(code);
  const alternates = LOCALES.map((c) => `<link rel="alternate" hreflang="${c}" href="${SITE}/${dir(c)}${page}">`).join('\n  ');
  const langMenu = LOCALES.map((c) => `<a href="/${dir(c)}${page}" lang="${c}"${c === code ? ' aria-current="true"' : ''}>${t[c].langName}</a>`).join('');
  return `<!doctype html>
<html lang="${code}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${SITE}/${dir(code)}${page}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${SITE}/${page}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${SITE}/${dir(code)}${page}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PGet">
  <meta property="og:locale" content="${code.replace('-', '_')}">
  <meta property="og:image" content="${SITE}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="PGet">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${SITE}/og.png">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f7f9fc" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">
  <script>try{var m=localStorage.getItem("theme");if(m==="light"||m==="dark")document.documentElement.dataset.theme=m}catch(e){}</script>
  <script src="/theme.js" defer></script>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="${base}"><img src="/favicon.svg" alt="" width="28" height="28">PGet</a>
    <nav>
      <a href="${base}#features">${L.nav.features}</a>
      <a href="${base}#download">${L.nav.download}</a>
      <a href="${REPO}">GitHub</a>
      <details class="lang">
        <summary aria-label="Language">🌐 ${L.langName}</summary>
        <div>${langMenu}</div>
      </details>
      <button class="theme" type="button" aria-label="${esc(L.theme.label)}" title="${esc(L.theme.label)}" data-light="${esc(L.theme.light)}" data-dark="${esc(L.theme.dark)}" data-system="${esc(L.theme.system)}"><span aria-hidden="true" class="theme-ico"></span><span class="theme-txt">${L.theme.system}</span></button>
    </nav>
  </header>
  <main>
${body}
  </main>
  <footer>
    <nav>
      <a href="${base}privacy/">${L.nav.privacy}</a>
      <a href="${base}terms/">${L.nav.terms}</a>
      <a href="${base}code-signing/">${L.nav.signing}</a>
      <a href="${REPO}">${L.nav.source}</a>
      <a href="mailto:${EMAIL}">${EMAIL}</a>
    </nav>
    <p>${L.footer}</p>
  </footer>
</body>
</html>
`;
}

function home(code) {
  const L = t[code].home;
  const features = L.features.map(([icon, h, p]) => `      <li><span class="ico">${icon}</span><h3>${h}</h3><p>${p}</p></li>`).join('\n');
  const nots = L.nots.map((x) => `<li>${x}</li>`).join('');
  const dl = [
    ['Windows', 'win', '🪟'],
    ['macOS', 'mac', '🍎'],
    ['Linux', 'linux', '🐧'],
  ].map(([name, k, ico]) => `      <a class="dl" href="${REPO}/releases/latest"><span>${ico}</span><b>${name}</b><small>${L.dl[k]}</small></a>`).join('\n');
  return `    <section class="hero">
      <h1>${L.title}</h1>
      <p class="lead">${L.lead}</p>
      <div class="cta">
        <a class="btn" href="#download">${L.cta}</a>
        <a class="btn ghost" href="${REPO}">${L.ctaSource}</a>
      </div>
    </section>
    <section id="features">
      <h2>${L.featuresTitle}</h2>
      <ul class="grid">
${features}
      </ul>
    </section>
    <section class="nots">
      <h2>${L.notsTitle}</h2>
      <ul>${nots}</ul>
    </section>
    <section id="download">
      <h2>${L.dlTitle}</h2>
      <div class="dls">
${dl}
      </div>
      <p class="note">${L.dlNote}</p>
      <p class="note">Windows: free code signing provided by <a href="https://about.signpath.io">SignPath.io</a>, certificate by <a href="https://signpath.org">SignPath Foundation</a> · <a href="code-signing/">${t[code].nav.signing}</a></p>
    </section>
    <section class="why">
      <h2>${L.whyTitle}</h2>
      <p>${L.why}</p>
    </section>`;
}

function doc(code, key) {
  const D = t[code][key];
  const sections = D.sections.map(([h, html]) => `      <h2>${h}</h2>\n      ${fill(html)}`).join('\n');
  const notice = code === LOCALES[0] ? '' : `\n      <p class="note">${t[code].translationNotice}</p>`;
  return `    <article class="doc">
      <h1>${D.title}</h1>
      <p class="meta">${fill(t[code].updatedLabel)}</p>${notice}
${sections}
    </article>`;
}

if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (!f.includes('.') || f.endsWith('.html')) rmSync(join(OUT, f), { recursive: true, force: true });

for (const code of LOCALES) {
  const L = t[code];
  const files = {
    '': layout(code, '', L.home.metaTitle, L.home.metaDesc, home(code)),
    'privacy/': layout(code, 'privacy/', `${L.privacy.title} · PGet`, L.privacy.desc, doc(code, 'privacy')),
    'terms/': layout(code, 'terms/', `${L.terms.title} · PGet`, L.terms.desc, doc(code, 'terms')),
    'code-signing/': layout(code, 'code-signing/', `${L.signing.title} · PGet`, L.signing.desc, doc(code, 'signing')),
  };
  for (const [page, html] of Object.entries(files)) {
    const p = join(OUT, dir(code), page, 'index.html');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, html);
  }
}

// 404 用預設語言
writeFileSync(join(OUT, '404.html'), layout(LOCALES[0], '', '404 · PGet', '', `    <section class="hero"><h1>404</h1><p class="lead">${LOCALES.map((c) => t[c].notFound).join('<br>')}</p><div class="cta"><a class="btn" href="/">PGet</a></div></section>`));

const urls = LOCALES.flatMap((c) => pages.map((p) => `${SITE}/${dir(c)}${p}`));
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}
</urlset>
`);

for (const f of readdirSync(join(ROOT, 'src', 'static'), { recursive: true, withFileTypes: true })) {
  if (!f.isFile()) continue;
  const rel = join(f.parentPath ?? f.path, f.name).slice(join(ROOT, 'src', 'static').length + 1);
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  copyFileSync(join(ROOT, 'src', 'static', rel), join(OUT, rel));
}

console.log(`產生 ${urls.length} 頁 → ${OUT}`);
