import { Hono } from 'hono';
import { cors } from 'hono/cors';

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

// Leaderboard
app.get('/api/leaderboard', async (c) => {
  const category = c.req.query('category');

  let query: string;
  let params: string[] = [];

  if (category) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      WHERE group_type = ?
      ORDER BY elo DESC
    `;
    params = [category];
  } else {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses, description
      FROM clubs
      ORDER BY elo DESC
    `;
  }

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ clubs: result.results });
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

// Serve frontend assets for all non-API routes
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
