import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  buildSlugMap,
  injectIntoShell,
  renderPage,
  categoryFromSlug,
  jsonLdTags,
  leaderboardParts,
  llmsTxt,
  renderCategoryPage,
  renderClubPage,
  renderMethodologyPage,
  robotsTxt,
  sitemapXml,
  withRanks,
  type Club as SeoClub,
  type RenderContext,
  type ShellContent,
} from './seo';
import { getSnapshot } from './snapshot';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

// --- Anti-bot: matchup tokens (HMAC-signed) ---
const TOKEN_SECRET = 'cornellclubmash-token-secret-2024';
const TOKEN_MAX_AGE_MS = 60_000; // token valid for 60 seconds

async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function createMatchupToken(clubA: number, clubB: number): Promise<string> {
  const ids = [clubA, clubB].sort((a, b) => a - b);
  const timestamp = Date.now();
  const payload = `${ids[0]}:${ids[1]}:${timestamp}`;
  const sig = await hmacSign(payload);
  return btoa(JSON.stringify({ p: payload, s: sig }));
}

async function verifyMatchupToken(
  token: string,
  winnerId: number,
  loserId: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    const { p: payload, s: sig } = JSON.parse(atob(token));
    const expectedSig = await hmacSign(payload);
    if (sig !== expectedSig) return { valid: false, error: 'Invalid token signature' };

    const [idA, idB, tsStr] = payload.split(':');
    const ids = [Number(idA), Number(idB)];
    const voteIds = [winnerId, loserId].sort((a, b) => a - b);
    if (ids[0] !== voteIds[0] || ids[1] !== voteIds[1]) {
      return { valid: false, error: 'Token does not match voted clubs' };
    }

    const age = Date.now() - Number(tsStr);
    if (age > TOKEN_MAX_AGE_MS) return { valid: false, error: 'Token expired' };

    return { valid: true };
  } catch {
    return { valid: false, error: 'Malformed token' };
  }
}

// --- Anti-bot: IP rate limiting ---
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_VOTES = 20;
const voteCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = voteCounts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_MAX_VOTES) return false;
    entry.count++;
  } else {
    voteCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  }
  // Cleanup old entries periodically
  if (voteCounts.size > 10_000) {
    for (const [key, val] of voteCounts) {
      if (now >= val.resetAt) voteCounts.delete(key);
    }
  }
  return true;
}

// Get two random clubs for a matchup
//
// This used to be `ORDER BY RANDOM() LIMIT 2`, which makes SQLite read and sort
// every club row to hand back two of them, on the busiest endpoint on the site.
// The cached snapshot already holds every club, so the pick is free.
function pickTwo<T>(pool: T[]): [T, T] {
  const first = Math.floor(Math.random() * pool.length);
  // Draw the second from the remaining pool, then shift past the first, so the
  // two are never the same club and every pair is equally likely.
  let second = Math.floor(Math.random() * (pool.length - 1));
  if (second >= first) second++;
  return [pool[first], pool[second]];
}

app.get('/api/matchup', async (c) => {
  const category = c.req.query('category');
  const exclude = c.req.query('exclude'); // comma-separated IDs to avoid repeats
  const excludeIds = new Set(
    exclude ? exclude.split(',').map(Number).filter(Boolean) : []
  );

  const { clubs } = await getSnapshot(c.env, c.executionCtx);
  const inScope = category
    ? clubs.filter((club) => club.group_type === category)
    : clubs;

  // Exclusion is a nicety, not a requirement: near the end of a category it can
  // leave fewer than two clubs, and a repeat beats a dead end.
  let pool = inScope.filter((club) => !excludeIds.has(club.id));
  if (pool.length < 2) pool = inScope;
  if (pool.length < 2) return c.json({ error: 'Not enough clubs found' }, 404);

  const pair = pickTwo(pool);
  const token = await createMatchupToken(pair[0].id, pair[1].id);
  return c.json({ clubs: pair, token });
});

// Submit a vote
app.post('/api/vote', async (c) => {
  // Rate limit by IP
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Too many votes, slow down' }, 429);
  }

  const body = await c.req.json<{ winnerId: number; loserId: number; token: string }>();
  const { winnerId, loserId, token } = body;

  if (!winnerId || !loserId || winnerId === loserId) {
    return c.json({ error: 'Invalid vote' }, 400);
  }

  // Verify matchup token
  if (!token) {
    return c.json({ error: 'Missing matchup token' }, 403);
  }
  const tokenResult = await verifyMatchupToken(token, winnerId, loserId);
  if (!tokenResult.valid) {
    return c.json({ error: tokenResult.error }, 403);
  }

  // Get current Elo ratings. Read fresh rather than from the cached snapshot:
  // the snapshot can be up to a minute behind, and scoring a vote against a
  // stale Elo would quietly lose whatever happened in between.
  const eloRows = await c.env.DB
    .prepare('SELECT id, elo FROM clubs WHERE id IN (?, ?)')
    .bind(winnerId, loserId)
    .all();
  const eloById = new Map(
    (eloRows.results as { id: number; elo: number }[] | undefined ?? []).map(
      (row) => [row.id, row.elo]
    )
  );
  const winnerElo = eloById.get(winnerId);
  const loserElo = eloById.get(loserId);

  if (winnerElo === undefined || loserElo === undefined) {
    return c.json({ error: 'Club not found' }, 404);
  }

  // Elo calculation (K=32)
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 - expectedWinner;

  const newWinnerElo = winnerElo + K * (1 - expectedWinner);
  const newLoserElo = loserElo + K * (0 - expectedLoser);

  // Execute all updates in a batch. The counter bump rides along here so the
  // total can never drift from the votes table; it is what lets every read path
  // skip COUNT(*). Requires migrate_vote_counter.sql to have been run.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE clubs SET elo = ?, wins = wins + 1 WHERE id = ?').bind(newWinnerElo, winnerId),
    c.env.DB.prepare('UPDATE clubs SET elo = ?, losses = losses + 1 WHERE id = ?').bind(newLoserElo, loserId),
    c.env.DB.prepare('INSERT INTO votes (winner_id, loser_id) VALUES (?, ?)').bind(winnerId, loserId),
    c.env.DB.prepare(
      `INSERT INTO site_counters (key, value) VALUES ('votes', 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1`
    ),
  ]);

  return c.json({ success: true, newElo: { winner: newWinnerElo, loser: newLoserElo } });
});

// Leaderboard (paginated)
//
// Served entirely from the cached snapshot. The clubs table is small enough that
// filtering and slicing it in JS is instant, and it avoids the part that was
// actually expensive: `SELECT COUNT(*)` for the total, which SQLite answers by
// reading every matching row, on every page of every scroll.
const LEADERBOARD_DEFAULT_LIMIT = 25;
const LEADERBOARD_MAX_LIMIT = 100;

app.get('/api/leaderboard', async (c) => {
  const category = c.req.query('category');
  // SQLite's LIKE was case-insensitive for ASCII, so lowercase both sides to
  // keep search behaving the way it did.
  const search = c.req.query('search')?.trim().toLowerCase();

  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), LEADERBOARD_MAX_LIMIT)
    : LEADERBOARD_DEFAULT_LIMIT;

  const rawOffset = Number(c.req.query('offset'));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  // The snapshot is already ordered by elo DESC, id ASC. elo alone is not unique
  // (every club starts at 1200), so that id tie-break is what keeps paging
  // stable across requests.
  const { clubs } = await getSnapshot(c.env, c.executionCtx);

  let matches = clubs;
  if (category) matches = matches.filter((club) => club.group_type === category);
  if (search) {
    matches = matches.filter((club) => club.name.toLowerCase().includes(search));
  }

  const page = matches.slice(offset, offset + limit);

  return c.json({
    clubs: page,
    total: matches.length,
    limit,
    offset,
    hasMore: offset + page.length < matches.length,
  });
});

// Stats
app.get('/api/stats', async (c) => {
  const { clubs, categories, totalVotes } = await getSnapshot(c.env, c.executionCtx);
  const top = clubs[0];

  return c.json({
    totalVotes,
    totalClubs: clubs.length,
    topClub: top ? { name: top.name, elo: top.elo } : null,
    categories,
  });
});

// --- Crawler visibility -----------------------------------------------------

// Which bots we care about knowing visited. OAI-SearchBot builds the index that
// ChatGPT searches; ChatGPT-User is a live fetch triggered by someone's actual
// question, which is the signal worth watching.
const TRACKED_BOTS = [
  'OAI-SearchBot', 'ChatGPT-User', 'GPTBot',
  'PerplexityBot', 'Perplexity-User',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'Googlebot', 'Google-Extended', 'bingbot',
  'Applebot', 'Amazonbot', 'meta-externalagent', 'DuckDuckBot',
];

function identifyBot(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  return TRACKED_BOTS.find((bot) => ua.includes(bot.toLowerCase())) ?? null;
}

// Recorded after the response is sent, and deliberately swallowing errors: this
// is analytics, and it must never be the reason a page fails to render. If the
// migration has not been run yet the insert throws and the site carries on.
async function recordCrawlerHit(env: Bindings, bot: string, path: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO crawler_hits (day, bot, path, hits, last_seen)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(day, bot, path)
       DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen`
    )
      .bind(now.slice(0, 10), bot, path, now)
      .run();
  } catch {
    // table missing or write failed; nothing here is worth breaking a page over
  }
}

app.use('*', async (c, next) => {
  const bot = identifyBot(c.req.header('user-agent') ?? '');
  if (bot) {
    const path = new URL(c.req.url).pathname;
    console.log(JSON.stringify({ event: 'crawler_hit', bot, path }));
    c.executionCtx.waitUntil(recordCrawlerHit(c.env, bot, path));
  }
  await next();
});

// A quick read of who has been crawling, so this is checkable without opening a
// database console: /api/crawlers?days=14
app.get('/api/crawlers', async (c) => {
  const rawDays = Number(c.req.query('days'));
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 90) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  try {
    const rows = await c.env.DB.prepare(
      `SELECT bot, SUM(hits) AS hits, COUNT(DISTINCT path) AS paths, MAX(last_seen) AS last_seen
       FROM crawler_hits WHERE day >= ?
       GROUP BY bot ORDER BY hits DESC`
    )
      .bind(since)
      .all();
    return c.json({ since, days, bots: rows.results ?? [] });
  } catch {
    return c.json(
      { since, days, bots: [], note: 'crawler_hits table not created yet; run migrate_crawler_hits.sql' },
      200
    );
  }
});

// --- Server-rendered pages ---------------------------------------------------
//
// The React app is client-only, so a crawler that does not run JavaScript sees an
// empty <div id="root">. These routes render the same data as plain HTML. Everyone
// gets identical markup regardless of user agent: showing crawlers something
// different from users is cloaking and gets sites penalised.

const PAGE_CACHE = 'public, max-age=300, stale-while-revalidate=600';

// Every page below reads the same cached snapshot, so a burst of crawler traffic
// costs no database reads at all. The club table is small (a couple of hundred
// rows), so ranking and filtering in JS is cheaper than issuing a separate
// ranked query per page, and it keeps slug lookup simple: slugs are derived from
// names rather than stored, so there is no column to index.
async function loadSite(c: {
  env: Bindings;
  executionCtx: ExecutionContext;
}): Promise<{ clubs: SeoClub[]; ctx: RenderContext }> {
  const { clubs, categories, totalVotes } = await getSnapshot(c.env, c.executionCtx);

  return {
    clubs,
    ctx: {
      stats: { totalVotes, totalClubs: clubs.length, categories },
      slugs: buildSlugMap(clubs),
      now: new Date(),
    },
  };
}

function html(body: string, cache = PAGE_CACHE): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache },
  });
}

function text(body: string, type: string, cache = PAGE_CACHE): Response {
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': cache },
  });
}

// Fetches the built SPA shell and rewrites it for this route. The rewriting
// itself lives in seo.ts so it can be tested without a Worker runtime.
async function renderShell(
  c: { env: Bindings; req: { raw: Request } },
  content: ShellContent,
  fallback: () => string
): Promise<Response> {
  const assetRes = await c.env.ASSETS.fetch(c.req.raw);
  const injected = injectIntoShell(await assetRes.text(), content);
  return html(injected ?? fallback());
}

app.get('/robots.txt', (c) => text(robotsTxt(), 'text/plain; charset=utf-8'));

app.get('/sitemap.xml', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  return text(sitemapXml(clubs, ctx), 'application/xml; charset=utf-8');
});

app.get('/llms.txt', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  return text(llmsTxt(clubs.slice(0, 15), ctx), 'text/plain; charset=utf-8');
});

app.get('/methodology', async (c) => {
  const { ctx } = await loadSite(c);
  return html(renderMethodologyPage(ctx));
});

app.get('/best/:slug', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  const meta = categoryFromSlug(c.req.param('slug'), ctx.stats.categories);
  if (!meta) return c.notFound();

  const inCategory = clubs.filter((club) => club.group_type === meta.dbValue);
  return html(renderCategoryPage(meta, inCategory, ctx));
});

app.get('/club/:slug', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  const slug = c.req.param('slug');
  const index = clubs.findIndex((club) => ctx.slugs.get(club.id) === slug);
  if (index === -1) return c.notFound();

  const club = clubs[index];
  const inCategory = clubs.filter((peer) => peer.group_type === club.group_type);
  const categoryRank = inCategory.findIndex((peer) => peer.id === club.id) + 1;

  // Show the club in context: the top of its category, and then the club's own
  // neighbours if it ranks below that. Ranks are carried explicitly so the second
  // group keeps its real numbers instead of restarting at 1.
  const peers = withRanks(inCategory.slice(0, 5));
  if (categoryRank > 5) {
    const from = Math.max(5, categoryRank - 2);
    peers.push(...withRanks(inCategory.slice(from, categoryRank + 1), from + 1));
  }

  return html(
    renderClubPage(
      {
        club,
        overallRank: index + 1,
        categoryRank,
        categorySize: inCategory.length,
        categoryPeers: peers,
      },
      ctx
    )
  );
});

app.get('/leaderboard', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  const parts = leaderboardParts(clubs.slice(0, 100), ctx);
  return renderShell(
    c,
    {
      title: parts.title,
      description: parts.description,
      path: '/leaderboard',
      head: jsonLdTags(parts.jsonLd ?? []),
      body: parts.body,
    },
    () => renderPage(parts)
  );
});

app.get('/', async (c) => {
  const { clubs, ctx } = await loadSite(c);
  const parts = leaderboardParts(clubs.slice(0, 25), ctx);
  const content = {
    title: 'Cornell Club Rankings: Vote on the Best Clubs at Cornell',
    description:
      `Which Cornell club is better? Vote head to head and see ${ctx.stats.totalClubs} Cornell ` +
      `University clubs ranked by ${ctx.stats.totalVotes.toLocaleString('en-US')} student votes.`,
    path: '/',
    head: jsonLdTags(parts.jsonLd ?? []),
    body: parts.body,
  };
  return renderShell(c, content, () =>
    renderPage({ ...content, jsonLd: parts.jsonLd, body: parts.body })
  );
});

// Serve frontend assets for all non-API routes
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
