import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

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
      SELECT id, name, logo_file, group_type, elo, wins, losses
      FROM clubs
      WHERE group_type = ? AND id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [category, ...excludeIds];
  } else if (category) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses
      FROM clubs
      WHERE group_type = ?
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [category];
  } else if (excludeIds.length > 0) {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses
      FROM clubs
      WHERE id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT 2
    `;
    params = [...excludeIds];
  } else {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses
      FROM clubs
      ORDER BY RANDOM()
      LIMIT 2
    `;
  }

  const result = await c.env.DB.prepare(query).bind(...params).all();

  if (!result.results || result.results.length < 2) {
    // Fall back without exclusion if not enough clubs
    const fallback = category
      ? await c.env.DB.prepare('SELECT id, name, logo_file, group_type, elo, wins, losses FROM clubs WHERE group_type = ? ORDER BY RANDOM() LIMIT 2').bind(category).all()
      : await c.env.DB.prepare('SELECT id, name, logo_file, group_type, elo, wins, losses FROM clubs ORDER BY RANDOM() LIMIT 2').all();
    if (!fallback.results || fallback.results.length < 2) {
      return c.json({ error: 'Not enough clubs found' }, 404);
    }
    return c.json({ clubs: fallback.results });
  }

  return c.json({ clubs: result.results });
});

// Submit a vote
app.post('/api/vote', async (c) => {
  const body = await c.req.json<{ winnerId: number; loserId: number }>();
  const { winnerId, loserId } = body;

  if (!winnerId || !loserId || winnerId === loserId) {
    return c.json({ error: 'Invalid vote' }, 400);
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
      SELECT id, name, logo_file, group_type, elo, wins, losses
      FROM clubs
      WHERE group_type = ?
      ORDER BY elo DESC
    `;
    params = [category];
  } else {
    query = `
      SELECT id, name, logo_file, group_type, elo, wins, losses
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

export default app;
