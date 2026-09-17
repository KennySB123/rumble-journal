// Static site builder for Vulcanic's RUMBLE journal.
// Usage:  node build.js            -> builds ./dist
//         node build.js --serve    -> builds, then serves ./dist at http://localhost:4321 and rebuilds on change
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(ROOT, 'content');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// ---------------------------------------------------------------- config
const site = JSON.parse(read(path.join(CONTENT, 'site.json')));
const BASE_PATH = (process.env.BASE_PATH ?? site.basePath ?? '').replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL ?? site.url ?? 'http://localhost:4321').replace(/\/$/, '');
const url = (p) => `${BASE_PATH}${p}`;          // site-relative link
const abs = (p) => `${SITE_URL}${p}`;            // absolute link (feed, canonical)
const porcLabel = site.porc?.label ?? 'PORC rank';
// Tiers listed top (best) to bottom in site.json; internally the bottom tier is 0 so "up" on the chart means better.
const TIERS_TOP_DOWN = (site.porc?.tiers ?? ['meteorite', 'mithril', 'adamantium', 'platinum', 'gold', 'silver', 'iron', 'stone']).map((t) => String(t).toLowerCase());
const TIERS = [...TIERS_TOP_DOWN].reverse();
const tierIndex = (name) => (name == null ? null : TIERS.indexOf(String(name).trim().toLowerCase()));
const tierName = (i) => (i == null || i < 0 || i >= TIERS.length ? null : TIERS[i][0].toUpperCase() + TIERS[i].slice(1));

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNum = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const fmtHours = (h) => (h == null ? '—' : `${fmtNum(h)} h`);
const fmtPorc = (p) => {
  if (p == null || p === '') return '—';
  const i = tierIndex(p);
  if (i >= 0) return tierName(i);
  console.warn(`unknown PORC tier "${p}" (expected one of: ${TIERS_TOP_DOWN.join(', ')})`);
  return esc(p);
};
const fmtDate = (d) => {
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const rfcDate = (d) => new Date(`${d}T12:00:00Z`).toUTCString();
const SEP = ' <span class="sep">&middot;</span> ';

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (v !== '' && !Number.isNaN(Number(v))) v = Number(v);
    data[k] = v;
  }
  return { data, body: m[2] };
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const r = rough / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, step, ticks };
}

function copyDir(from, to) {
  if (!exists(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}
function write(rel, html) {
  const p = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}
function groupBy(list, keyFn) {
  const m = new Map();
  for (const item of list) { const k = keyFn(item); if (!m.has(k)) m.set(k, []); m.get(k).push(item); }
  return m;
}

// ---------------------------------------------------------------- content: stats
const stats = JSON.parse(read(path.join(CONTENT, 'stats.json')))
  .filter((s) => s.date && s.hours != null)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hours - b.hours));
const latest = stats[stats.length - 1] ?? null;

/** The most recent checkpoint on or before `date`. */
function statsAt(date) {
  let found = null;
  for (const s of stats) if (s.date <= date) found = s; else break;
  return found;
}

// ---------------------------------------------------------------- content: posts
function loadPosts() {
  const dir = path.join(CONTENT, 'posts');
  if (!exists(dir)) return [];
  const posts = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const { data, body } = parseFrontmatter(read(path.join(dir, file)));
    if (data.draft === true) continue;
    const dateFromName = file.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    const date = String(data.date ?? dateFromName ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.warn(`skip ${file}: needs a date (YYYY-MM-DD)`); continue; }
    const slug = String(data.slug ?? file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''));
    const at = statsAt(date);
    const journey = {
      hours: data.hours ?? at?.hours ?? null,
      bp: data.bp ?? at?.bp ?? null,
      porc: data.porc ?? at?.porc ?? null,
      fromCheckpoint: at?.date ?? null,
    };
    const tags = data.tags ? String(data.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
    posts.push({
      slug, date, title: String(data.title ?? slug), summary: String(data.summary ?? ''),
      tags, journey, html: marked.parse(body), path: `/blog/${slug}/`,
    });
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
const posts = loadPosts();

// ---------------------------------------------------------------- content: tips (Sun Tzu style)
function loadTips() {
  const file = path.join(CONTENT, 'tips.md');
  if (!exists(file)) return { title: 'Tips', intro: '', chapters: [] };
  const { data, body } = parseFrontmatter(read(file));
  const tokens = marked.lexer(body);
  const chapters = [];
  let cur = null;
  const introTokens = [];
  for (const tok of tokens) {
    if (tok.type === 'heading' && tok.depth <= 2) {
      cur = { title: marked.parseInline(tok.text), sayings: [], introTokens: [] };
      chapters.push(cur);
    } else if (tok.type === 'list' && cur) {
      for (const item of tok.items) {
        const [first, ...rest] = item.tokens;
        const text = first?.type === 'text' || first?.type === 'paragraph' ? first.text : item.text;
        cur.sayings.push({ text: marked.parseInline(text), commentary: rest.length ? marked.parser(rest) : '' });
      }
    } else if (cur) cur.introTokens.push(tok);
    else introTokens.push(tok);
  }
  const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'][n - 1] ?? String(n);
  chapters.forEach((c, i) => {
    c.n = i + 1; c.numeral = roman(i + 1); c.id = `chapter-${i + 1}`;
    c.intro = marked.parser(c.introTokens);
    c.sayings.forEach((s, j) => { s.n = j + 1; s.id = `${c.numeral}-${j + 1}`.toLowerCase(); s.ref = `${c.numeral}.${j + 1}`; });
  });
  return { title: data.title ?? 'The Art of Rumble', intro: marked.parser(introTokens), chapters };
}
const tips = loadTips();
const allSayings = tips.chapters.flatMap((c) => c.sayings.map((s) => ({ ref: s.ref, text: s.text, href: url(`/tips/#${s.id}`) })));

// ---------------------------------------------------------------- charts (build-time SVG, hover added by main.js)
function lineChart({ id, points, yLabel, xLabel = 'Hours played', markers = [], fmtY = fmtNum, yTicks = null, yLabels = null, step = false, area: wantArea = true }) {
  const W = 720, H = 340, L = yLabels ? 96 : 60, R = 20, T = 20, B = 48;
  const pw = W - L - R, ph = H - T - B;
  if (points.length === 0) return `<p class="muted">No checkpoints yet.</p>`;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xt = niceTicks(0, Math.max(...xs) * 1.02 || 1, 6);
  // Categorical y (tiers): fixed ticks with a half-step of padding. Numeric y: nice ticks from zero.
  const yt = yTicks
    ? { lo: Math.min(...yTicks) - 0.5, hi: Math.max(...yTicks) + 0.5, ticks: yTicks }
    : niceTicks(0, Math.max(...ys), 5);
  const sx = (x) => L + ((x - xt.lo) / (xt.hi - xt.lo || 1)) * pw;
  const sy = (y) => T + ph - ((y - yt.lo) / (yt.hi - yt.lo || 1)) * ph;
  const line = points.map((p, i) => {
    if (!i) return `M${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
    return step
      ? `H${sx(p.x).toFixed(1)} V${sy(p.y).toFixed(1)}`
      : `L${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
  }).join(' ');
  const base = T + ph;
  const area = `${line} L${sx(points.at(-1).x).toFixed(1)} ${base} L${sx(points[0].x).toFixed(1)} ${base} Z`;
  const grid = yt.ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="grid"/>`).join('');
  const tickLabel = (v) => (yLabels ? esc(yLabels[v] ?? v) : fmtY(v));
  const yAxis = yt.ticks.map((v) => `<text x="${L - 8}" y="${sy(v).toFixed(1)}" dy="0.35em" text-anchor="end" class="tick">${tickLabel(v)}</text>`).join('');
  const xAxis = xt.ticks.map((v) => `<text x="${sx(v).toFixed(1)}" y="${T + ph + 18}" text-anchor="middle" class="tick">${fmtNum(v)}</text>`).join('');
  const dots = points.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" class="dot"/>`).join('');
  const marks = markers.map((m) => `<a href="${m.href}" class="marker"><title>${esc(m.title)}</title><circle cx="${sx(m.x).toFixed(1)}" cy="${sy(m.y).toFixed(1)}" r="7"/></a>`).join('');
  const data = esc(JSON.stringify({
    L, R, T, B, W, H, xlo: xt.lo, xhi: xt.hi, ylo: yt.lo, yhi: yt.hi, yLabel, xLabel, yLabels,
    points: points.map((p) => ({ x: p.x, y: p.y, date: p.date, note: p.note ?? '' })),
  }));
  return `<figure class="chart" id="${id}">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t" data-chart="${data}">
    <title id="${id}-t">${esc(yLabel)} against ${esc(xLabel.toLowerCase())}</title>
    ${grid}
    <line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" class="axis"/>
    ${yAxis}${xAxis}
    <text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" class="axis-label">${esc(xLabel)}</text>
    <text transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle" class="axis-label">${esc(yLabel)}</text>
    ${wantArea ? `<path d="${area}" class="area"/>` : ''}
    <path d="${line}" class="line"/>
    ${dots}${marks}
    <g class="hover" hidden><line class="crosshair" y1="${T}" y2="${T + ph}"/><circle r="6" class="hover-dot"/></g>
  </svg>
  <div class="tooltip" hidden></div>
</figure>`;
}

function statsTable() {
  if (!stats.length) return '';
  const postByCheckpoint = groupBy(posts.filter((p) => p.journey.fromCheckpoint), (p) => p.journey.fromCheckpoint);
  const rows = stats.map((s) => `<tr id="h${Math.round(s.hours)}"><td>${fmtDate(s.date)}</td><td class="num">${fmtHours(s.hours)}</td><td class="num">${fmtNum(s.bp)}</td><td class="num">${fmtPorc(s.porc)}</td><td>${esc(s.note ?? '')}${(postByCheckpoint.get(s.date) ?? []).map((p) => ` <a href="${url(p.path)}">${esc(p.title)}</a>`).join('')}</td></tr>`).join('\n');
  return `<details class="table-view"><summary>Show all checkpoints as a table</summary>
<table><thead><tr><th>Date</th><th class="num">Hours</th><th class="num">BP</th><th class="num">${esc(porcLabel)}</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

// ---------------------------------------------------------------- page pieces
const wordmark = exists(path.join(SRC, 'img/wordmark.svg')) ? read(path.join(SRC, 'img/wordmark.svg')) : `<span>${esc(site.name)}</span>`;

function journeyBadge(j, { link = true } = {}) {
  if (j.hours == null && j.bp == null && j.porc == null) return `<span class="journey muted">before tracking began</span>`;
  const parts = [];
  if (j.hours != null) parts.push(`Hour ${fmtNum(j.hours)}`);
  if (j.bp != null) parts.push(`${fmtNum(j.bp)} BP`);
  if (j.porc != null) parts.push(`${porcLabel} ${fmtPorc(j.porc)}`);
  const inner = parts.join(SEP);
  return link && j.hours != null
    ? `<a class="journey" href="${url('/tracker/')}#h${Math.round(j.hours)}" title="Where I was in the journey at this post">${inner}</a>`
    : `<span class="journey">${inner}</span>`;
}

function tiles() {
  if (!latest) return '';
  return `<div class="tiles">
  <div class="tile"><div class="tile-label">Hours played</div><div class="tile-value">${fmtNum(latest.hours)}</div></div>
  <div class="tile"><div class="tile-label">Battle points</div><div class="tile-value">${fmtNum(latest.bp)}</div></div>
  <div class="tile"><div class="tile-label">${esc(porcLabel)}</div><div class="tile-value">${fmtPorc(latest.porc)}</div></div>
</div>
<p class="muted small">Last checkpoint ${fmtDate(latest.date)}${latest.note ? ` &mdash; ${esc(latest.note)}` : ''}.</p>`;
}

function layout({ title, description = site.description ?? '', body, page = '', canonical = '/' }) {
  const nav = [['/blog/', 'Blog'], ['/tracker/', 'Tracker'], ['/tips/', 'Tips'], ['/about/', 'About']]
    .map(([p, l]) => `<a href="${url(p)}"${page === l.toLowerCase() ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  const social = [['youtube', 'YouTube'], ['twitch', 'Twitch']]
    .filter(([k]) => site.links?.[k]).map(([k, l]) => `<a href="${esc(site.links[k])}" rel="me noopener" target="_blank">${l}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${title === site.name ? '' : ` &middot; ${esc(site.name)}`}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="${url('/feed.xml')}">
<link rel="icon" href="${url('/assets/img/favicon.svg')}" type="image/svg+xml">
<script>(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})()</script>
<link rel="stylesheet" href="${url('/assets/css/style.css')}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <a class="brand" href="${url('/')}" aria-label="${esc(site.name)} home">${wordmark}</a>
  <nav class="site-nav" aria-label="Site">${nav}</nav>
  <div class="site-tools">
    ${social}
    <button class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode"><span class="sun">&#9788;</span><span class="moon">&#9790;</span></button>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="site-footer wrap">
  <p>${esc(site.name)}${SEP}${esc(site.tagline)}${social ? SEP + social : ''}${SEP}<a href="${url('/feed.xml')}">RSS</a></p>
  <p class="small muted">Set in <a href="https://github.com/edwardtufte/et-book" rel="noopener">ET Book</a>. Wordmark drawn with Chinese Rocks by Typodermic Fonts.</p>
</footer>
<script src="${url('/assets/js/main.js')}" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------- pages
function postCard(p) {
  return `<article class="post-card">
  <div class="post-meta"><time datetime="${p.date}">${fmtDate(p.date)}</time> ${journeyBadge(p.journey)}</div>
  <h3><a href="${url(p.path)}">${esc(p.title)}</a></h3>
  ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
</article>`;
}

function homePage() {
  const recent = posts.slice(0, 3).map(postCard).join('\n');
  const chart = lineChart({ id: 'home-bp', points: stats.map((s) => ({ x: s.hours, y: s.bp, date: s.date, note: s.note })), yLabel: 'Battle points' });
  const saying = allSayings.length ? `<section class="saying" data-sayings="${esc(JSON.stringify(allSayings))}">
  <blockquote><p>${allSayings[0].text}</p><footer><a href="${allSayings[0].href}">${allSayings[0].ref}</a></footer></blockquote>
</section>` : '';
  return layout({
    title: site.name, page: 'home', canonical: '/',
    body: `<section class="hero">
  <h1 class="visually-hidden">${esc(site.name)}</h1>
  <p class="tagline">${esc(site.tagline)}</p>
  ${site.intro ? `<div class="intro">${marked.parse(site.intro)}</div>` : ''}
</section>
${tiles()}
${saying}
<section>
  <h2>Latest posts</h2>
  ${recent || '<p class="muted">No posts yet.</p>'}
  <p><a href="${url('/blog/')}">All posts &rarr;</a></p>
</section>
${stats.length ? `<section>
  <h2>The climb so far</h2>
  ${chart}
  <p><a href="${url('/tracker/')}">Full tracker &rarr;</a></p>
</section>` : ''}`,
  });
}

function blogIndex() {
  const byYear = groupBy(posts, (p) => p.date.slice(0, 4));
  const groups = [...byYear].map(([y, ps]) => `<h2 class="year">${y}</h2>\n${ps.map(postCard).join('\n')}`).join('\n');
  return layout({
    title: 'Blog', page: 'blog', canonical: '/blog/',
    body: `<h1>Blog</h1>
<p class="muted">Each post carries a stamp of where I was in the journey when I wrote it: hours played, battle points, and ${esc(porcLabel)}. Click a stamp to see it on the tracker.</p>
${groups || '<p class="muted">No posts yet.</p>'}`,
  });
}

function postPage(p, i) {
  const prev = posts[i + 1], next = posts[i - 1];
  const pager = `<nav class="pager" aria-label="Post navigation">
  ${prev ? `<a class="prev" href="${url(prev.path)}">&larr; ${esc(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a class="next" href="${url(next.path)}">${esc(next.title)} &rarr;</a>` : '<span></span>'}
</nav>`;
  return layout({
    title: p.title, description: p.summary || site.description, page: 'blog', canonical: p.path,
    body: `<article class="post">
  <header>
    <h1>${esc(p.title)}</h1>
    <p class="post-meta"><time datetime="${p.date}">${fmtDate(p.date)}</time> ${journeyBadge(p.journey)}</p>
    ${p.tags.length ? `<p class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</p>` : ''}
  </header>
  ${p.html}
</article>
${pager}`,
  });
}

function trackerPage() {
  const bpChart = lineChart({
    id: 'bp-chart', yLabel: 'Battle points',
    points: stats.map((s) => ({ x: s.hours, y: s.bp, date: s.date, note: s.note })),
    markers: posts.filter((p) => p.journey.hours != null && p.journey.bp != null).map((p) => ({ x: p.journey.hours, y: p.journey.bp, href: url(p.path), title: `${p.title} (${fmtDate(p.date)})` })),
  });
  const porcPoints = stats.filter((s) => tierIndex(s.porc) >= 0).map((s) => ({ x: s.hours, y: tierIndex(s.porc), date: s.date, note: s.note }));
  const porcChart = porcPoints.length ? lineChart({
    id: 'porc-chart', yLabel: porcLabel, step: true, area: false,
    yTicks: TIERS.map((_, i) => i), yLabels: TIERS.map((_, i) => tierName(i)),
    points: porcPoints,
    markers: posts.filter((p) => p.journey.hours != null && tierIndex(p.journey.porc) >= 0).map((p) => ({ x: p.journey.hours, y: tierIndex(p.journey.porc), href: url(p.path), title: `${p.title} (${fmtDate(p.date)})` })),
  }) : '';
  const ladder = `<p class="muted small">The ${esc(porcLabel)} ladder, top to bottom: ${TIERS_TOP_DOWN.map((t) => tierName(TIERS.indexOf(t))).join(', ')}.</p>`;
  const empty = `<p class="muted">Nothing logged yet. The first checkpoint will appear here.</p>`;
  return layout({
    title: 'Tracker', page: 'tracker', canonical: '/tracker/',
    body: `<h1>Tracker</h1>
<p class="muted">Battle points and ${esc(porcLabel)} plotted against hours played. Rings mark blog posts; click one to read what I was thinking at that point.</p>
${stats.length ? `${tiles()}
<h2>Battle points</h2>
${bpChart}
${porcChart ? `<h2>${esc(porcLabel)}</h2>
${ladder}
${porcChart}` : ''}
${statsTable()}` : empty + ladder}`,
  });
}

function tipsPage() {
  const toc = tips.chapters.map((c) => `<li><a href="#${c.id}">${c.numeral}. ${c.title}</a></li>`).join('');
  const chapters = tips.chapters.map((c) => `<section class="chapter" id="${c.id}">
  <h2><span class="numeral">${c.numeral}.</span> ${c.title}</h2>
  ${c.intro}
  <ol class="sayings">
    ${c.sayings.map((s) => `<li id="${s.id}"><a class="ref" href="#${s.id}">${s.ref}</a><p class="saying-text">${s.text}</p>${s.commentary ? `<div class="commentary">${s.commentary}</div>` : ''}</li>`).join('\n    ')}
  </ol>
</section>`).join('\n');
  return layout({
    title: tips.title, page: 'tips', canonical: '/tips/',
    body: `<h1>${esc(tips.title)}</h1>
${tips.intro}
${toc ? `<ol class="toc">${toc}</ol>` : ''}
${chapters || '<p class="muted">No sayings yet. Add chapters and sayings to <code>content/tips.md</code>.</p>'}`,
  });
}

function aboutPage() {
  const file = path.join(CONTENT, 'about.md');
  const { data, body } = exists(file) ? parseFrontmatter(read(file)) : { data: {}, body: '' };
  return layout({ title: data.title ?? 'About', page: 'about', canonical: '/about/', body: `<article class="post"><h1>${esc(data.title ?? 'About')}</h1>${marked.parse(body)}</article>` });
}

function notFound() {
  return layout({ title: 'Not found', body: `<h1>Not found</h1><p>That page doesn't exist. <a href="${url('/')}">Back home.</a></p>` });
}

function feed() {
  const items = posts.slice(0, 20).map((p) => `<item>
  <title>${esc(p.title)}</title>
  <link>${abs(p.path)}</link>
  <guid isPermaLink="true">${abs(p.path)}</guid>
  <pubDate>${rfcDate(p.date)}</pubDate>
  <description>${esc(p.summary)}</description>
  <content:encoded><![CDATA[${p.html.replace(/]]>/g, ']]&gt;')}]]></content:encoded>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${esc(site.name)}</title>
  <link>${abs('/')}</link>
  <atom:link href="${abs('/feed.xml')}" rel="self" type="application/rss+xml"/>
  <description>${esc(site.description ?? site.tagline)}</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
}

// ---------------------------------------------------------------- build
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  copyDir(path.join(SRC, 'css'), path.join(DIST, 'assets/css'));
  copyDir(path.join(SRC, 'js'), path.join(DIST, 'assets/js'));
  copyDir(path.join(SRC, 'fonts'), path.join(DIST, 'assets/fonts'));
  copyDir(path.join(SRC, 'img'), path.join(DIST, 'assets/img'));
  copyDir(path.join(CONTENT, 'media'), path.join(DIST, 'media'));
  write('index.html', homePage());
  write('blog/index.html', blogIndex());
  posts.forEach((p, i) => write(`blog/${p.slug}/index.html`, postPage(p, i)));
  write('tracker/index.html', trackerPage());
  write('tips/index.html', tipsPage());
  write('about/index.html', aboutPage());
  write('404.html', notFound());
  write('feed.xml', feed());
  write('.nojekyll', '');
  console.log(`built ${posts.length} posts, ${stats.length} checkpoints, ${allSayings.length} sayings -> dist/  (base "${BASE_PATH || '/'}", url ${SITE_URL})`);
}

build();

// ---------------------------------------------------------------- dev server
if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain' };
  const port = Number(process.env.PORT ?? 4321);
  http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length) || '/';
    else if (BASE_PATH) { res.writeHead(302, { Location: BASE_PATH + '/' }); return res.end(); }
    let file = path.join(DIST, p);
    if (exists(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!exists(file)) { file = path.join(DIST, '404.html'); res.statusCode = 404; }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`serving http://localhost:${port}${BASE_PATH}/`));
  let timer;
  for (const dir of [CONTENT, SRC]) fs.watch(dir, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => { try { build(); } catch (e) { console.error(e); } }, 150); });
}
