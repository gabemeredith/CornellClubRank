-- A running total of votes, so nothing has to run COUNT(*) on the votes table.
--
-- SQLite stores no row count, so COUNT(*) reads every row. That query ran on
-- every /api/stats call and on every server-rendered page, and the votes table
-- only grows, so the daily D1 rows_read bill grew with it. One counter row
-- replaces the whole scan.
--
-- RUN THIS BEFORE DEPLOYING. /api/vote increments this row inside the same
-- batch as the vote insert, so if the table is missing, voting fails.
--
--   npx wrangler d1 execute <DB_NAME> --remote --file=worker/migrate_vote_counter.sql
--
-- Safe to run more than once: it creates nothing that exists and the seed is
-- INSERT OR IGNORE, so re-running will not double-count.

CREATE TABLE IF NOT EXISTS site_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- One last full scan to seed the counter with the votes already recorded.
INSERT OR IGNORE INTO site_counters (key, value)
SELECT 'votes', COUNT(*) FROM votes;
