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
app.get('/api/matchup', async (c) => {
  const category = c.req.query('category');
  const exclude = c.req.query('exclude'); // comma-separated IDs to avoid repeats

  const excludeIds = exclude ? exclude.split(',').map(Number).filter(Boolean) : [];
  const placeholders = excludeIds.map(() => '?').join(',');

  let query: string;
  let params: (string | number)[] = [];

  if (category && excludeIds.length > 0) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      WHERE group_type = ? AND id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [category, ...excludeIds];
  } else if (category) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      WHERE group_type = ?
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [category];
  } else if (excludeIds.length > 0) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      WHERE id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [...excludeIds];
  } else {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      ORDER BY RANDOM()
      LIMIT 2
    `;
  }

  const result = await c.env.DB.prepare(query).bind(...params).all();

  if (!result.results || result.results.length < 2) {
    // Fall back without exclusion if not enough clubs
    const fallback = category
      ? await c.env.DB.prepare('SELECT id, name, logo_file, group_type, elo, wins, losses, description FROM clubs WHERE group_type = ? ORDER BY RANDOM() LIMIT 2').bind(category).all()
      : await c.env.DB.prepare('SELECT id, name, logo_file, group_type, elo, wins, losses, description FROM clubs ORDER BY RANDOM() LIMIT 2').all();
    if (!fallback.results || fallback.results.length < 2) {
      return c.json({ error: 'Not enough clubs found' }, 404);
    }
    const fbClubs = fallback.results as { id: number }[];
    const fbToken = await createMatchupToken(fbClubs[0].id, fbClubs[1].id);
    return c.json({ clubs: fallback.results, token: fbToken });
  }

  const clubs = result.results as { id: number }[];
  const token = await createMatchupToken(clubs[0].id, clubs[1].id);
  return c.json({ clubs: result.results, token });
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

  // Get current Elo ratings
  const winner = await c.env.DB.prepare('SELECT elo FROM clubs WHERE id = ?').bind(winnerId).first();
  const loser = await c.env.DB.prepare('SELECT elo FROM clubs WHERE id = ?').bind(loserId).first();

  if (!winner || !loser) {
    return c.json({ error: 'Club not found' }, 404);
  }

  // Elo calculation (K=32)
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, ((loser.elo as number) - (winner.elo as number)) / 400));
  const expectedLoser = 1 - expectedWinner;

  const newWinnerElo = (winner.elo as number) + K * (1 - expectedWinner);
  const newLoserElo = (loser.elo as number) + K * (0 - expectedLoser);

  // Execute all updates in a batch
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE clubs SET elo = ?, wins = wins + 1 WHERE id = ?').bind(newWinnerElo, winnerId),
    c.env.DB.prepare('UPDATE clubs SET elo = ?, losses = losses + 1 WHERE id = ?').bind(newLoserElo, loserId),
    c.env.DB.prepare('INSERT INTO votes (winner_id, loser_id) VALUES (?, ?)').bind(winnerId, loserId),
  ]);

  return c.json({ success: true, newElo: { winner: newWinnerElo, loser: newLoserElo } });
});

// Leaderboard (paginated)
const LEADERBOARD_DEFAULT_LIMIT = 25;
const LEADERBOARD_MAX_LIMIT = 100;

// Escape LIKE wildcards so a search for "50%" doesn't match everything
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

app.get('/api/leaderboard', async (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search')?.trim();

  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), LEADERBOARD_MAX_LIMIT)
    : LEADERBOARD_DEFAULT_LIMIT;

  const rawOffset = Number(c.req.query('offset'));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  const conditions: string[] = [];
  const filterParams: (string | number)[] = [];

  if (category) {
    conditions.push('group_type = ?');
    filterParams.push(category);
  }
  if (search) {
    conditions.push("name LIKE ? ESCAPE '\\'");
    filterParams.push(`%${escapeLike(search)}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // elo alone is not unique (every club starts at 1200), so tie-break on id
  // to keep the ordering stable across pages.
  const pageStmt = c.env.DB.prepare(`
    SELECT id, name, logo_file, group_type, elo, wins, losses, description
    FROM clubs
    ${where}
    ORDER BY elo DESC, id ASC
    LIMIT ? OFFSET ?
  `).bind(...filterParams, limit, offset);

  const countStmt = c.env.DB.prepare(`SELECT COUNT(*) as count FROM clubs ${where}`)
    .bind(...filterParams);

  const [page, count] = await c.env.DB.batch([pageStmt, countStmt]);

  const clubs = page.results ?? [];
  const total = ((count.results?.[0] as { count: number } | undefined)?.count) ?? 0;

  return c.json({
    clubs,
    total,
    limit,
    offset,
    hasMore: offset + clubs.length < total,
  });
});

// Stats
app.get('/api/stats', async (c) => {
  const totalVotes = await c.env.DB.prepare('SELECT COUNT(*) as count FROM votes').first();
  const totalClubs = await c.env.DB.prepare('SELECT COUNT(*) as count FROM clubs').first();
  const topClub = await c.env.DB.prepare('SELECT name, elo FROM clubs ORDER BY elo DESC LIMIT 1').first();
  const categories = await c.env.DB.prepare('SELECT DISTINCT group_type FROM clubs ORDER BY group_type').all();

  return c.json({
    totalVotes: totalVotes?.count ?? 0,
    totalClubs: totalClubs?.count ?? 0,
    topClub: topClub ?? null,
    categories: categories.results?.map((r) => r.group_type) ?? [],
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

// One trip to the database serves any of the pages below. The club table is small
// (a couple of hundred rows), so ranking and filtering in JS is cheaper than
// issuing a separate ranked query per page, and it keeps slug lookup simple:
// slugs are derived from names rather than stored, so there is no column to index.
async function loadSite(c: {
  env: Bindings;
}): Promise<{ clubs: SeoClub[]; ctx: RenderContext }> {
  const [clubsRes, votesRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, name, url, logo_file, group_type, description, elo, wins, losses
       FROM clubs ORDER BY elo DESC, id ASC`
    ),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM votes'),
  ]);

  const clubs = (clubsRes.results ?? []) as unknown as SeoClub[];
  const totalVotes =
    ((votesRes.results?.[0] as { count: number } | undefined)?.count) ?? 0;

  const categories: string[] = [];
  for (const club of clubs) {
    if (!categories.includes(club.group_type)) categories.push(club.group_type);
  }
  categories.sort();

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
