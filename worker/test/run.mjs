// Tests for the server-rendered pages in ../src/seo.ts.
//
//   node worker/test/run.mjs
//
// No test framework and no node_modules: it compiles seo.ts with npx esbuild,
// builds a fixture of all 197 clubs straight out of seed.sql, and asserts on the
// rendered HTML. Run it after touching seo.ts. It has already caught duplicate
// club names colliding onto one URL, slugs that moved when Elo changed, and a
// comparison table that renumbered clubs from 1.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'ccr-test-'));

let fails = 0;
let checks = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) {
    fails++;
    console.log('  FAIL: ' + label);
  }
};

// --- fixture: every club in seed.sql, with deterministic ratings -------------

// Seeded so runs are reproducible; the real Elo values live in D1.
function lcg(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function loadClubs() {
  const sql = readFileSync(join(root, 'worker', 'seed.sql'), 'utf8');
  const rand = lcg(7);
  const clubs = [];

  for (const line of sql.split('\n')) {
    const m = line.match(
      /^INSERT INTO clubs \(name, url, logo_url, logo_file, group_type\) VALUES \((.*)\);\s*$/
    );
    if (!m) continue;
    const parts = [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((p) => p[1].replaceAll("''", "'"));
    if (parts.length !== 5) continue;

    const [name, url, , logo_file, group_type] = parts;
    clubs.push({
      id: clubs.length + 1,
      name,
      url,
      logo_file,
      group_type,
      description: null,
      elo: 1200 + Math.round((rand() - 0.5) * 400),
      wins: Math.floor(rand() * 40),
      losses: Math.floor(rand() * 40),
    });
  }

  clubs.sort((a, b) => b.elo - a.elo || a.id - b.id);
  return clubs;
}

// --- shared page assertions --------------------------------------------------

function checkPage(seo, html, label, mustContain = []) {
  ok(html.startsWith('<!doctype html>'), `${label}: doctype`);
  ok(/<title>.+<\/title>/.test(html), `${label}: has title`);
  ok(/<meta name="description" content=".{50,}"/.test(html), `${label}: description >= 50 chars`);
  ok(/<link rel="canonical" href="https:\/\/cornellclubrank\.com/.test(html), `${label}: canonical`);
  ok(html.includes('og:image'), `${label}: og:image`);
  ok(html.includes('summary_large_image'), `${label}: large twitter card`);

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  ok(blocks.length > 0, `${label}: has JSON-LD`);
  for (const [, json] of blocks) {
    try {
      ok(!!JSON.parse(json)['@context'], `${label}: JSON-LD @context`);
    } catch (e) {
      fails++;
      checks++;
      console.log(`  FAIL: ${label}: invalid JSON-LD: ${e.message}`);
    }
  }

  const body = html.slice(html.indexOf('<main'));
  ok(!/<script(?! type="application)/.test(body), `${label}: no stray script in body`);
  for (const needle of mustContain) ok(html.includes(needle), `${label}: contains ${JSON.stringify(needle)}`);
}

// --- run ---------------------------------------------------------------------

try {
  const bundle = join(tmp, 'seo.mjs');
  execFileSync(
    'npx',
    ['--yes', 'esbuild', join(root, 'worker', 'src', 'seo.ts'), '--format=esm', `--outfile=${bundle}`, '--log-level=warning'],
    { stdio: 'inherit' }
  );
  const seo = await import(pathToFileURL(bundle).href);

  const clubs = loadClubs();
  const now = new Date('2026-09-01T00:00:00Z');
  const categories = [...new Set(clubs.map((c) => c.group_type))].sort();
  const ctx = {
    stats: { totalVotes: 43912, totalClubs: clubs.length, categories },
    slugs: seo.buildSlugMap(clubs),
    now,
  };

  // Slugs address /club/:slug, so a collision makes one club unreachable.
  const seen = new Map();
  for (const club of clubs) {
    const slug = ctx.slugs.get(club.id);
    ok(!!slug && /^[a-z0-9-]+$/.test(slug), `slug is clean for "${club.name}" (got ${slug})`);
    if (seen.has(slug)) {
      fails++;
      checks++;
      console.log(`  FAIL: slug collision "${slug}": "${seen.get(slug)}" vs "${club.name}"`);
    }
    seen.set(slug, club.name);
  }
  console.log(`slugs: ${seen.size} unique of ${clubs.length} clubs`);

  // Slugs must not move when Elo changes, or every URL churns on every vote.
  const reordered = [...clubs].reverse();
  const afterReorder = seo.buildSlugMap(reordered);
  for (const club of clubs)
    ok(afterReorder.get(club.id) === ctx.slugs.get(club.id), `slug for "${club.name}" is rank-independent`);

  const lb = seo.renderLeaderboardPage(clubs.slice(0, 100), ctx);
  checkPage(seo, lb, 'leaderboard', ['Cornell Club Rankings', '43,912', 'September 1, 2026']);
  ok((lb.match(/<td class="rank">/g) || []).length === 100, 'leaderboard: 100 rows');

  for (const cat of categories) {
    const meta = seo.categoryMeta(cat);
    const inCat = clubs.filter((c) => c.group_type === cat);
    const page = seo.renderCategoryPage(meta, inCat, ctx);
    checkPage(seo, page, `category:${meta.slug}`, [meta.heading, `/best/${meta.slug}`]);
    ok((page.match(/<td class="rank">/g) || []).length === inCat.length, `category:${meta.slug}: ${inCat.length} rows`);
    ok(seo.categoryFromSlug(meta.slug, categories)?.dbValue === cat, `category:${meta.slug}: slug round-trips`);
  }
  ok(seo.categoryFromSlug('nope-not-real', categories) === null, 'unknown category slug returns null');

  // Includes names with apostrophes, ampersands, commas and parentheses.
  const sample = [clubs[0], clubs[1], clubs.at(-1), ...clubs.filter((c) => /['&@,()]/.test(c.name)).slice(0, 4)];
  for (const club of sample) {
    const index = clubs.indexOf(club);
    const inCat = clubs.filter((p) => p.group_type === club.group_type);
    const catRank = inCat.indexOf(club) + 1;
    const peers = seo.withRanks(inCat.slice(0, 5));
    if (catRank > 5) {
      const from = Math.max(5, catRank - 2);
      peers.push(...seo.withRanks(inCat.slice(from, catRank + 1), from + 1));
    }
    const slug = ctx.slugs.get(club.id);
    const page = seo.renderClubPage(
      { club, overallRank: index + 1, categoryRank: catRank, categorySize: inCat.length, categoryPeers: peers },
      ctx
    );
    checkPage(seo, page, `club:${slug}`, [`#${index + 1} of 197`, `/club/${slug}`]);
    ok(page.includes(seo.escapeHtml(club.name)), `club:${slug}: name rendered`);
    // the club's own row keeps its real rank rather than restarting at 1
    ok(page.includes(`<td class="rank">${catRank}</td>`), `club:${slug}: shows real category rank ${catRank}`);
  }

  checkPage(seo, seo.renderMethodologyPage(ctx), 'methodology', ['FAQPage', 'Elo', 'not affiliated with']);

  const robots = seo.robotsTxt();
  for (const ua of ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'PerplexityBot', 'ClaudeBot', 'Googlebot'])
    ok(robots.includes(`User-agent: ${ua}`), `robots: allows ${ua}`);
  ok(robots.includes('Sitemap: https://cornellclubrank.com/sitemap.xml'), 'robots: sitemap line');

  const sitemap = seo.sitemapXml(clubs, ctx);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(locs.length === clubs.length + categories.length + 4, `sitemap: ${locs.length} urls`);
  ok(new Set(locs).size === locs.length, 'sitemap: no duplicate urls');
  for (const loc of locs) ok(/^https:\/\/cornellclubrank\.com\/[a-z0-9/-]*$/.test(loc), `sitemap: clean url ${loc}`);
  ok(!/&(?!amp;)/.test(sitemap), 'sitemap: no unescaped ampersands');

  const llms = seo.llmsTxt(clubs.slice(0, 15), ctx);
  ok(llms.includes('# CornellClubRank'), 'llms.txt: heading');
  ok((llms.match(/^\d+\. \[/gm) || []).length === 15, 'llms.txt: 15 top clubs');

  // The SPA shell is rewritten in place, so test against the real shipped file.
  const shell = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
  const parts = seo.leaderboardParts(clubs.slice(0, 100), ctx);
  const out = seo.injectIntoShell(shell, {
    title: parts.title,
    description: parts.description,
    path: '/leaderboard',
    head: seo.jsonLdTags(parts.jsonLd ?? []),
    body: parts.body,
  });

  ok(out !== null, 'shell: injection succeeded on the real index.html');
  ok(out.includes(`<title>${parts.title}</title>`), 'shell: title replaced');
  ok((out.match(/<title>/g) || []).length === 1, 'shell: exactly one title');
  ok((out.match(/<meta name="description"/g) || []).length === 1, 'shell: exactly one description');
  ok(out.includes('<link rel="canonical" href="https://cornellclubrank.com/leaderboard" />'), 'shell: canonical');
  ok(out.indexOf('<div id="ssr-fallback">') < out.indexOf('<div id="root">'), 'shell: fallback precedes #root');
  ok(out.includes('<script type="module" src="/src/main.tsx"></script>'), 'shell: app script preserved');
  ok((out.match(/<td class="rank">/g) || []).length === 100, 'shell: 100 ranked rows visible without JS');
  ok(out.indexOf('<link rel="canonical"') < out.indexOf('</head>'), 'shell: canonical inside head');
  ok(
    seo.injectIntoShell('<!doctype html><html><body>404 Not Found</body></html>', {
      title: 't', description: 'd', path: '/leaderboard', head: '', body: '<p>x</p>',
    }) === null,
    'shell: non-shell input returns null so the route can fall back'
  );

  console.log(`\n${checks - fails}/${checks} checks passed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(fails ? 1 : 0);
