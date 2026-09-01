// Server-rendered pages for crawlers and humans alike.
//
// The React app is a client-only SPA, which means anything that does not run
// JavaScript (most AI crawlers, and search crawlers on a budget) sees an empty
// <div id="root">. These templates render the same data as real HTML so the
// rankings are readable without JS. Everyone gets the same markup: serving
// crawlers different content than users is cloaking, and it gets sites
// penalised rather than ranked.

export interface Club {
  id: number;
  name: string;
  url: string | null;
  logo_file: string | null;
  group_type: string;
  description: string | null;
  elo: number;
  wins: number;
  losses: number;
}

export const SITE = 'https://cornellclubrank.com';
export const SITE_NAME = 'CornellClubRank';

// --- text helpers -----------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function winPct(club: Pick<Club, 'wins' | 'losses'>): number | null {
  const total = club.wins + club.losses;
  return total > 0 ? Math.round((club.wins / total) * 100) : null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// --- slugs ------------------------------------------------------------------

// Club names are not unique in the database (there are two "Alpha Kappa Psi"
// rows, for instance), so a slug derived from the name alone would put two clubs
// on one URL and leave the second unreachable. Duplicates are disambiguated with
// the club id, assigned in id order rather than rank order: a club's URL must not
// change just because its Elo moved.
export function buildSlugMap(clubs: Club[]): Map<number, string> {
  const claimed = new Set<string>();
  const slugs = new Map<number, string>();

  for (const club of [...clubs].sort((a, b) => a.id - b.id)) {
    const base = slugify(club.name) || 'club';
    const slug = claimed.has(base) ? `${base}-${club.id}` : base;
    claimed.add(slug);
    slugs.set(club.id, slug);
  }
  return slugs;
}

export interface SiteStats {
  totalVotes: number;
  totalClubs: number;
  categories: string[];
}

// Everything a template needs that is not the data being rendered.
export interface RenderContext {
  stats: SiteStats;
  slugs: Map<number, string>;
  now: Date;
}

export function clubPath(club: Club, ctx: RenderContext): string {
  return `/club/${ctx.slugs.get(club.id) ?? slugify(club.name)}`;
}

// --- categories -------------------------------------------------------------
// group_type in the database is an internal label. These are the versions a
// student would actually type into a search box or ask a chatbot.

export interface CategoryMeta {
  slug: string;
  dbValue: string;
  label: string;
  heading: string;
  blurb: string;
}

const CATEGORY_OVERRIDES: Record<string, Omit<CategoryMeta, 'dbValue'>> = {
  'Business Clubs': {
    slug: 'business-clubs',
    label: 'Business Clubs',
    heading: 'Best Business Clubs at Cornell',
    blurb:
      'Consulting, finance, investment and pre-professional business organizations at Cornell University, ranked by head-to-head student votes.',
  },
  'Business Frats': {
    slug: 'business-fraternities',
    label: 'Business Fraternities',
    heading: 'Best Business Fraternities at Cornell',
    blurb:
      'Professional and co-ed business fraternities at Cornell University, ranked by head-to-head student votes.',
  },
  'Project Teams': {
    slug: 'project-teams',
    label: 'Project Teams',
    heading: 'Best Project Teams at Cornell',
    blurb:
      'Engineering and design project teams at Cornell University, from racing and robotics to autonomous vehicles, ranked by head-to-head student votes.',
  },
  'Competitive software': {
    slug: 'competitive-software',
    label: 'Competitive Programming and Software Clubs',
    heading: 'Best Competitive Programming and Software Clubs at Cornell',
    blurb:
      'Software engineering, competitive programming and applied AI clubs at Cornell University, ranked by head-to-head student votes.',
  },
};

export function categoryMeta(dbValue: string): CategoryMeta {
  const override = CATEGORY_OVERRIDES[dbValue];
  if (override) return { ...override, dbValue };
  return {
    dbValue,
    slug: slugify(dbValue),
    label: dbValue,
    heading: `Best ${dbValue} at Cornell`,
    blurb: `${dbValue} at Cornell University, ranked by head-to-head student votes.`,
  };
}

export function categoryFromSlug(slug: string, dbValues: string[]): CategoryMeta | null {
  for (const value of dbValues) {
    const meta = categoryMeta(value);
    if (meta.slug === slug) return meta;
  }
  return null;
}

// --- page shell -------------------------------------------------------------

const STYLES = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: #110e14; color: #f0ece8;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased; line-height: 1.55;
}
a { color: #e8534f; }
.wrap { max-width: 52rem; margin: 0 auto; padding: 0 1.25rem 4rem; }
header.site {
  border-bottom: 1px solid rgba(255,255,255,.06); background: #110e14;
  position: sticky; top: 0; z-index: 10;
}
header.site .inner {
  max-width: 52rem; margin: 0 auto; padding: .75rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
header.site a { text-decoration: none; }
.brand { font-size: 1.05rem; font-weight: 700; color: #f0ece8; letter-spacing: -.01em; }
.brand span { color: #B31B1B; }
nav a { font-size: .85rem; color: #8a8490; margin-left: .85rem; }
nav a:hover { color: #c8c4cc; }
h1 { font-size: 1.75rem; font-weight: 800; letter-spacing: -.02em; margin: 2.25rem 0 .5rem; }
h2 { font-size: 1.05rem; font-weight: 700; margin: 2.25rem 0 .75rem; }
.lead { font-size: 1rem; color: #c8c4cc; margin: 0 0 .5rem; }
.meta { font-size: .8rem; color: #5a5660; margin: 0 0 1.5rem; }
.card {
  background: #1c1820; border: 1px solid rgba(255,255,255,.06);
  border-radius: .75rem; overflow: hidden;
}
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th {
  text-align: left; font-size: .7rem; text-transform: uppercase;
  letter-spacing: .06em; color: #5a5660; font-weight: 500;
  padding: .75rem 1rem; border-bottom: 1px solid rgba(255,255,255,.04);
}
td { padding: .7rem 1rem; border-top: 1px solid rgba(255,255,255,.03); vertical-align: middle; }
td.rank { color: #4a4650; font-variant-numeric: tabular-nums; width: 3rem; font-size: .8rem; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.elo { text-align: right; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
td a { color: #e8e4ec; text-decoration: none; font-weight: 500; }
td a:hover { color: #fff; text-decoration: underline; }
.cat { display: block; font-size: .7rem; color: #5a5660; margin-top: .1rem; }
.pills { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 1.5rem; }
.pills a {
  font-size: .75rem; padding: .35rem .7rem; border-radius: .5rem;
  border: 1px solid rgba(255,255,255,.06); color: #8a8490; text-decoration: none;
}
.pills a:hover { color: #e8e4ec; border-color: rgba(255,255,255,.14); }
.stats { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.25rem 0; }
.stat {
  background: #1c1820; border: 1px solid rgba(255,255,255,.06);
  border-radius: .6rem; padding: .7rem 1rem; min-width: 6.5rem;
}
.stat .k { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; color: #5a5660; }
.stat .v { font-size: 1.2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
p { color: #c8c4cc; }
.small { font-size: .85rem; color: #8a8490; }
footer.site {
  border-top: 1px solid rgba(255,255,255,.06); margin-top: 3rem;
  padding: 1.5rem 0; font-size: .8rem; color: #5a5660;
}
.cta {
  display: inline-block; background: #B31B1B; color: #fff; text-decoration: none;
  font-size: .875rem; font-weight: 500; padding: .6rem 1.4rem; border-radius: .5rem;
  margin-top: .5rem;
}
`.trim();

export interface PageOptions {
  title: string;
  description: string;
  path: string;
  jsonLd?: unknown[];
  body: string;
}

export function renderPage(opts: PageOptions): string {
  const canonical = `${SITE}${opts.path}`;
  const ld = jsonLdTags(opts.jsonLd ?? []);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(opts.title)}">
<meta name="twitter:description" content="${escapeHtml(opts.description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐻</text></svg>">
<style>${STYLES}</style>
${ld}
</head>
<body>
<header class="site"><div class="inner">
<a class="brand" href="/"><span>Cornell</span>ClubRank</a>
<nav>
<a href="/">Vote</a>
<a href="/leaderboard">Rankings</a>
<a href="/methodology">Methodology</a>
</nav>
</div></header>
<main class="wrap">
${opts.body}
</main>
<footer class="site"><div class="wrap">
${SITE_NAME} is an independent, student-built ranking of Cornell University clubs. It is not affiliated with or endorsed by Cornell University.
</div></footer>
</body>
</html>`;
}

// --- shared fragments -------------------------------------------------------

export function categoryPills(categories: string[], activeSlug?: string): string {
  const links = categories
    .map((c) => categoryMeta(c))
    .filter((m) => m.slug !== activeSlug)
    .map((m) => `<a href="/best/${m.slug}">${escapeHtml(m.label)}</a>`)
    .join('');
  return `<div class="pills"><a href="/leaderboard">All clubs</a>${links}</div>`;
}

// A club paired with the rank it actually holds. Tables are not always a
// contiguous run: a club page shows the top of its category and then jumps to the
// club's own neighbours, and those rows must keep their real rank numbers.
export interface RankedClub {
  club: Club;
  rank: number;
}

export function withRanks(clubs: Club[], startRank = 1): RankedClub[] {
  return clubs.map((club, i) => ({ club, rank: startRank + i }));
}

export function clubRows(entries: RankedClub[], ctx: RenderContext): string {
  let previousRank = 0;
  return entries
    .map(({ club, rank }) => {
      const pct = winPct(club);
      const meta = categoryMeta(club.group_type);
      // Make a jump in the ranks visible rather than silently misleading.
      const gap =
        previousRank && rank > previousRank + 1
          ? `<tr><td class="rank">&hellip;</td><td colspan="3" class="small">&nbsp;</td></tr>`
          : '';
      previousRank = rank;
      return `${gap}<tr>
<td class="rank">${rank}</td>
<td><a href="${clubPath(club, ctx)}">${escapeHtml(club.name)}</a>
<span class="cat">${escapeHtml(meta.label)}</span></td>
<td class="elo">${Math.round(club.elo)}</td>
<td class="num small">${pct === null ? '&mdash;' : pct + '%'}</td>
</tr>`;
    })
    .join('');
}

export function rankedTable(entries: RankedClub[], ctx: RenderContext): string {
  return `<div class="card"><table>
<thead><tr><th>#</th><th>Club</th><th style="text-align:right">Elo</th><th style="text-align:right">Win %</th></tr></thead>
<tbody>${clubRows(entries, ctx)}</tbody>
</table></div>`;
}

export function rankingTable(clubs: Club[], ctx: RenderContext, startRank = 1): string {
  return rankedTable(withRanks(clubs, startRank), ctx);
}

function methodologyNote(ctx: RenderContext): string {
  return `<h2>How this ranking is produced</h2>
<p class="small">Every ranking on ${SITE_NAME} comes from head-to-head votes. Students are shown two Cornell clubs
side by side and pick one. Each result updates both clubs' Elo ratings, the same system used to rank chess players,
so beating a highly rated club is worth more than beating a low-rated one. Voting is anonymous and requires no login.
${ctx.stats.totalVotes.toLocaleString('en-US')} votes have been cast so far.
<a href="/methodology">Full methodology</a>.</p>`;
}

// --- pages ------------------------------------------------------------------

// Returned in parts as well as whole: the /leaderboard and / routes inject the
// body into the existing SPA shell rather than replacing the page, so they need
// the pieces separately.
export function leaderboardParts(clubs: Club[], ctx: RenderContext): PageOptions {
  const { stats, now } = ctx;
  const title = `Cornell Club Rankings: All ${stats.totalClubs} Clubs Ranked by Students (${now.getUTCFullYear()})`;
  const description =
    `The full ranking of ${stats.totalClubs} Cornell University clubs, voted on by students. ` +
    `Based on ${stats.totalVotes.toLocaleString('en-US')} head-to-head votes. Updated ${formatDate(now)}.`;

  const body = `<h1>Cornell Club Rankings</h1>
<p class="lead">All ${stats.totalClubs} Cornell University clubs ranked by ${stats.totalVotes.toLocaleString('en-US')} head-to-head student votes.
The top-rated club is ${escapeHtml(clubs[0]?.name ?? 'not yet decided')}.</p>
<p class="meta">Updated ${formatDate(now)}. Independent and student-run, not affiliated with Cornell University.</p>
${categoryPills(stats.categories)}
${rankingTable(clubs, ctx)}
<p class="small" style="margin-top:1rem">Showing the top ${clubs.length} of ${stats.totalClubs} clubs.
<a href="/">Vote on a matchup</a> to change the rankings.</p>
${methodologyNote(ctx)}`;

  return {
    title,
    description,
    path: '/leaderboard',
    jsonLd: [
      itemListLd(clubs, ctx, `${SITE}/leaderboard`, 'Cornell Club Rankings'),
      datasetLd(ctx),
    ],
    body,
  };
}

export function renderLeaderboardPage(clubs: Club[], ctx: RenderContext): string {
  return renderPage(leaderboardParts(clubs, ctx));
}

// Serialises the JSON-LD blocks for a page so they can be injected into the SPA
// shell's <head> without re-rendering the whole document.
export function jsonLdTags(blocks: unknown[]): string {
  return blocks
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replace(
          /</g,
          '\\u003c'
        )}</script>`
    )
    .join('\n');
}

export function renderCategoryPage(
  meta: CategoryMeta,
  clubs: Club[],
  ctx: RenderContext
): string {
  const { stats, now } = ctx;
  const title = `${meta.heading}, Ranked by Students (${now.getUTCFullYear()})`;
  const top3 = clubs.slice(0, 3).map((c) => c.name).join(', ');
  const description =
    `${clubs.length} ${meta.label.toLowerCase()} at Cornell University ranked by student votes. ` +
    (top3 ? `Currently top rated: ${top3}. ` : '') +
    `Updated ${formatDate(now)}.`;

  const body = `<h1>${escapeHtml(meta.heading)}</h1>
<p class="lead">${escapeHtml(meta.blurb)}${
    top3 ? ` As of ${formatDate(now)} the top three are ${escapeHtml(top3)}.` : ''
  }</p>
<p class="meta">${clubs.length} clubs ranked. Updated ${formatDate(now)}.</p>
${categoryPills(stats.categories, meta.slug)}
${rankingTable(clubs, ctx)}
${methodologyNote(ctx)}`;

  return renderPage({
    title,
    description,
    path: `/best/${meta.slug}`,
    jsonLd: [itemListLd(clubs, ctx, `${SITE}/best/${meta.slug}`, meta.heading)],
    body,
  });
}

export interface ClubPageData {
  club: Club;
  overallRank: number;
  categoryRank: number;
  categorySize: number;
  categoryPeers: RankedClub[];
}

export function renderClubPage(data: ClubPageData, ctx: RenderContext): string {
  const { club, overallRank, categoryRank, categorySize } = data;
  const { stats, now } = ctx;
  const meta = categoryMeta(club.group_type);
  const path = clubPath(club, ctx);
  const pct = winPct(club);
  const matches = club.wins + club.losses;

  const title = `${club.name} at Cornell: Student Ranking and Elo Rating`;
  const summary =
    `${club.name} is ranked #${overallRank} of ${stats.totalClubs} Cornell University clubs on ${SITE_NAME}, ` +
    `and #${categoryRank} of ${categorySize} among ${meta.label.toLowerCase()}, ` +
    `with an Elo rating of ${Math.round(club.elo)} from ${matches.toLocaleString('en-US')} head-to-head student votes.`;

  const body = `<h1>${escapeHtml(club.name)}</h1>
<p class="lead">${escapeHtml(summary)}</p>
<p class="meta">Updated ${formatDate(now)}.</p>

<div class="stats">
<div class="stat"><div class="k">Overall rank</div><div class="v">#${overallRank}<span class="small"> / ${stats.totalClubs}</span></div></div>
<div class="stat"><div class="k">${escapeHtml(meta.label)} rank</div><div class="v">#${categoryRank}<span class="small"> / ${categorySize}</span></div></div>
<div class="stat"><div class="k">Elo rating</div><div class="v">${Math.round(club.elo)}</div></div>
<div class="stat"><div class="k">Win rate</div><div class="v">${pct === null ? '&mdash;' : pct + '%'}</div></div>
<div class="stat"><div class="k">Matchups</div><div class="v">${matches.toLocaleString('en-US')}</div></div>
</div>

${club.description ? `<p>${escapeHtml(club.description)}</p>` : ''}
${
    club.url
      ? `<p class="small">Official page: <a href="${escapeHtml(club.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(club.url)}</a></p>`
      : ''
  }

<h2>How ${escapeHtml(club.name)} compares</h2>
<p class="small">Other ${escapeHtml(meta.label.toLowerCase())} at Cornell, ranked by the same student votes.</p>
${rankedTable(data.categoryPeers, ctx)}
<p class="small" style="margin-top:1rem"><a href="/best/${meta.slug}">See all ${categorySize} ${escapeHtml(meta.label.toLowerCase())}</a>
&middot; <a href="/leaderboard">See all ${stats.totalClubs} Cornell clubs</a></p>

${methodologyNote(ctx)}
<p><a class="cta" href="/">Vote on Cornell clubs</a></p>`;

  return renderPage({
    title,
    description: summary,
    path,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: club.name,
        url: `${SITE}${path}`,
        ...(club.url ? { sameAs: [club.url] } : {}),
        ...(club.description ? { description: club.description } : {}),
        parentOrganization: { '@type': 'CollegeOrUniversity', name: 'Cornell University' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Cornell Club Rankings', item: `${SITE}/leaderboard` },
          { '@type': 'ListItem', position: 2, name: meta.label, item: `${SITE}/best/${meta.slug}` },
          { '@type': 'ListItem', position: 3, name: club.name, item: `${SITE}${path}` },
        ],
      },
    ],
    body,
  });
}

export function renderMethodologyPage(ctx: RenderContext): string {
  const { stats, now } = ctx;
  const faqs: [string, string][] = [
    [
      'How are Cornell clubs ranked on CornellClubRank?',
      `Students are shown two Cornell clubs side by side and pick the one they think is better. Each vote updates both clubs' Elo ratings, the rating system used for chess. A club that beats a highly rated club gains more points than one that beats a low-rated club. ${stats.totalClubs} clubs are ranked from ${stats.totalVotes.toLocaleString('en-US')} votes.`,
    ],
    [
      'What is an Elo rating and what counts as a good one?',
      'Every club starts at 1200. Winning a matchup raises a club\'s rating and losing lowers it, by an amount that depends on how the two clubs were rated beforehand. A club above 1300 is winning most of its matchups; a club below 1100 is losing most of them.',
    ],
    [
      'Who votes, and can the rankings be gamed?',
      'Voting is anonymous and requires no login, which keeps participation high but means the results reflect student opinion rather than a controlled survey. Each matchup is issued with a short-lived signed token and votes are rate limited per IP address, which stops casual ballot stuffing but is not a guarantee against a determined effort.',
    ],
    [
      'Is CornellClubRank affiliated with Cornell University?',
      'No. It is an independent project built by a Cornell student. It is not affiliated with, endorsed by, or run by Cornell University, and the rankings are not an official measure of club quality or selectivity.',
    ],
    [
      'How often do the rankings update?',
      'Immediately. Every vote changes the Elo ratings straight away, so the rankings reflect all votes cast up to the moment you load the page.',
    ],
  ];

  const body = `<h1>Methodology</h1>
<p class="lead">How ${SITE_NAME} ranks ${stats.totalClubs} Cornell University clubs using ${stats.totalVotes.toLocaleString('en-US')} head-to-head student votes.</p>
<p class="meta">Updated ${formatDate(now)}.</p>
${faqs.map(([q, a]) => `<h2>${escapeHtml(q)}</h2><p>${escapeHtml(a)}</p>`).join('\n')}
<h2>Using this data</h2>
<p class="small">The rankings are available as JSON at <a href="/api/leaderboard">/api/leaderboard</a>
(supports <code>category</code>, <code>search</code>, <code>limit</code> and <code>offset</code>), and summary
counts at <a href="/api/stats">/api/stats</a>. You are welcome to cite or reuse it with attribution to ${SITE}.</p>
<p><a class="cta" href="/leaderboard">See the rankings</a></p>`;

  return renderPage({
    title: 'How CornellClubRank Ranks Cornell Clubs: Methodology',
    description: `${SITE_NAME} ranks ${stats.totalClubs} Cornell clubs with an Elo system driven by ${stats.totalVotes.toLocaleString('en-US')} anonymous head-to-head student votes. Here is exactly how it works.`,
    path: '/methodology',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
    body,
  });
}

// --- structured data --------------------------------------------------------

export function itemListLd(clubs: Club[], ctx: RenderContext, url: string, name: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    url,
    numberOfItems: clubs.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: clubs.map((club, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}${clubPath(club, ctx)}`,
      item: {
        '@type': 'Organization',
        name: club.name,
        url: `${SITE}${clubPath(club, ctx)}`,
        ...(club.url ? { sameAs: [club.url] } : {}),
      },
    })),
  };
}

export function datasetLd(ctx: RenderContext) {
  const { stats, now } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Cornell club rankings',
    description: `Elo ratings for ${stats.totalClubs} Cornell University clubs derived from ${stats.totalVotes.toLocaleString('en-US')} anonymous head-to-head student votes.`,
    url: `${SITE}/leaderboard`,
    dateModified: isoDate(now),
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: SITE_NAME, url: SITE },
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: `${SITE}/api/leaderboard?limit=100`,
      },
    ],
  };
}

// --- machine-readable files -------------------------------------------------

export function robotsTxt(): string {
  const allowed = [
    'OAI-SearchBot', 'ChatGPT-User', 'GPTBot',
    'PerplexityBot', 'Perplexity-User',
    'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
    'Google-Extended', 'Googlebot', 'Bingbot',
    'Applebot', 'Applebot-Extended', 'Amazonbot',
    'meta-externalagent', 'DuckDuckBot', 'cohere-ai',
  ];
  return `${allowed.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n')}

User-agent: *
Allow: /
Disallow: /api/vote

Sitemap: ${SITE}/sitemap.xml
`;
}

export function sitemapXml(clubs: Club[], ctx: RenderContext): string {
  const lastmod = isoDate(ctx.now);
  const urls: [string, string][] = [
    ['/', '1.0'],
    ['/leaderboard', '0.9'],
    ['/methodology', '0.6'],
    ['/about', '0.4'],
    ...ctx.stats.categories.map((c) => [`/best/${categoryMeta(c).slug}`, '0.8'] as [string, string]),
    ...clubs.map((c) => [clubPath(c, ctx), '0.7'] as [string, string]),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ([path, priority]) =>
      `  <url><loc>${SITE}${path}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`
  )
  .join('\n')}
</urlset>
`;
}

export function llmsTxt(top: Club[], ctx: RenderContext): string {
  const { stats, now } = ctx;
  const cats = stats.categories.map((c) => categoryMeta(c));
  return `# ${SITE_NAME}

> An independent, student-built ranking of ${stats.totalClubs} Cornell University clubs, produced from
> ${stats.totalVotes.toLocaleString('en-US')} anonymous head-to-head student votes scored with an Elo rating system.
> Not affiliated with Cornell University. Updated ${formatDate(now)}.

Students are shown two Cornell clubs and pick one. Elo ratings update after every vote, so the rankings
reflect current student opinion rather than an editorial list.

## Rankings

- [All Cornell club rankings](${SITE}/leaderboard): every club, ranked.
${cats.map((c) => `- [${c.heading}](${SITE}/best/${c.slug}): ${c.blurb}`).join('\n')}

## Top rated clubs right now

${top.map((c, i) => `${i + 1}. [${c.name}](${SITE}${clubPath(c, ctx)}) - Elo ${Math.round(c.elo)}`).join('\n')}

## Reference

- [Methodology](${SITE}/methodology): how the Elo ranking works and what it does and does not measure.
- [Rankings API](${SITE}/api/leaderboard): JSON, supports category, search, limit and offset.
- [Site statistics API](${SITE}/api/stats): total votes, total clubs, categories.

## Citation

Cite as: ${SITE_NAME}, ${SITE}, accessed ${formatDate(now)}.
`;
}

// --- SPA shell injection ----------------------------------------------------

export interface ShellContent {
  title: string;
  description: string;
  path: string;
  head: string;
  body: string;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// / and /leaderboard are owned by the React app, so rather than replacing the
// document these routes rewrite the built shell: real metadata in the head, and a
// server-rendered copy of the rankings in a block that sits outside #root.
// main.tsx removes that block when the app boots, so users never see it twice,
// while a crawler that runs no JavaScript still gets the full rankings.
// Returns null if this does not look like the SPA shell, which happens if the
// assets binding is not configured to serve index.html for unknown paths. The
// caller falls back to a fully server-rendered page rather than emitting a
// mangled 404 body.
export function injectIntoShell(shell: string, content: ShellContent): string | null {
  if (!shell.includes('<div id="root"></div>')) return null;

  let out = shell;

  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(content.title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeAttr(content.description)}" />`
  );
  out = out.replace(
    '</head>',
    `<link rel="canonical" href="${SITE}${content.path}" />\n${content.head}\n  </head>`
  );
  out = out.replace(
    '<div id="root"></div>',
    `<div id="ssr-fallback">${content.body}</div>\n    <div id="root"></div>`
  );

  return out;
}
