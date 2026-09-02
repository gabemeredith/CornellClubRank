// One cached copy of the whole site, shared by every read path.
//
// Why this exists: D1 bills on rows read, and the free tier allows 5M a day. The
// site blew through that because almost every request ran a full table scan.
// SQLite keeps no stored row count, so `SELECT COUNT(*) FROM votes` reads every
// vote row, and that ran on each /api/stats call and on each server-rendered
// page. `ORDER BY RANDOM()` in /api/matchup scanned and sorted all 197 clubs on
// the most frequently hit endpoint. Neither had anything to do with how much
// data the caller actually wanted back.
//
// The whole clubs table is a couple of hundred rows and only changes when
// someone votes, so it is cheaper to read it once and keep it. Two tiers:
//
//   1. module memory, private to one Worker isolate, free and instant
//   2. the Cloudflare Cache API, shared by every isolate in a colo, also free
//      and not billed as D1 rows
//
// D1 is touched only when both miss, which is roughly once per colo per TTL.
// The cost is staleness: a vote takes up to SNAPSHOT_TTL_MS to show up in the
// rankings. That is fine here, and /api/vote returns the new Elo directly so
// the voter's own screen updates immediately.

import type { Club } from './seo';

export interface SiteSnapshot {
  /** Every club, already ordered by elo DESC, id ASC. */
  clubs: Club[];
  categories: string[];
  totalVotes: number;
  /** Epoch ms this snapshot was read from D1, used to age it out. */
  builtAt: number;
}

export const SNAPSHOT_TTL_MS = 60_000;

// A synthetic key. Nothing ever requests this URL; it is just the handle the
// Cache API stores the snapshot under.
const CACHE_KEY = 'https://cornellclubrank.internal/snapshot/v1';

let memo: SiteSnapshot | null = null;

type SnapshotEnv = { DB: D1Database };

export async function getSnapshot(
  env: SnapshotEnv,
  ctx?: ExecutionContext
): Promise<SiteSnapshot> {
  if (memo && !isStale(memo)) return memo;

  const cached = await readEdgeCache();
  if (cached) {
    memo = cached;
    return cached;
  }

  const fresh = await readDatabase(env);
  memo = fresh;
  const write = writeEdgeCache(fresh);
  if (ctx) ctx.waitUntil(write);
  return fresh;
}

function isStale(snapshot: SiteSnapshot): boolean {
  return Date.now() - snapshot.builtAt >= SNAPSHOT_TTL_MS;
}

async function readEdgeCache(): Promise<SiteSnapshot | null> {
  try {
    const hit = await caches.default.match(CACHE_KEY);
    if (!hit) return null;
    const snapshot = (await hit.json()) as SiteSnapshot;
    return isStale(snapshot) ? null : snapshot;
  } catch {
    // A cache miss must never be worse than a slow request.
    return null;
  }
}

async function writeEdgeCache(snapshot: SiteSnapshot): Promise<void> {
  try {
    await caches.default.put(
      CACHE_KEY,
      new Response(JSON.stringify(snapshot), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${Math.floor(SNAPSHOT_TTL_MS / 1000)}`,
        },
      })
    );
  } catch {
    // Nothing to do; the next request just re-reads from D1.
  }
}

async function readDatabase(env: SnapshotEnv): Promise<SiteSnapshot> {
  const clubsRes = await env.DB.prepare(
    `SELECT id, name, url, logo_file, group_type, description, elo, wins, losses
     FROM clubs ORDER BY elo DESC, id ASC`
  ).all();

  const clubs = (clubsRes.results ?? []) as unknown as Club[];

  const categories: string[] = [];
  for (const club of clubs) {
    if (!categories.includes(club.group_type)) categories.push(club.group_type);
  }
  categories.sort();

  return {
    clubs,
    categories,
    totalVotes: await readVoteTotal(env.DB),
    builtAt: Date.now(),
  };
}

// The running total lives in site_counters and is incremented alongside each
// vote, so this reads one row instead of the entire votes table. The fallback
// covers a deploy that lands before migrate_vote_counter.sql has been run: the
// site keeps working, it is just back to paying for a full scan.
async function readVoteTotal(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM site_counters WHERE key = 'votes'")
      .first<{ value: number }>();
    if (row) return row.value;
  } catch {
    // site_counters does not exist yet.
  }

  const row = await db
    .prepare('SELECT COUNT(*) as count FROM votes')
    .first<{ count: number }>();
  return row?.count ?? 0;
}
