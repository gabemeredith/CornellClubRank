-- Indexes for the paginated leaderboard query
-- (ORDER BY elo DESC, id ASC with an optional group_type filter).
-- Safe to run against an existing database; it only adds indexes.
DROP INDEX IF EXISTS idx_clubs_elo;
CREATE INDEX IF NOT EXISTS idx_clubs_elo ON clubs(elo DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_clubs_group_elo ON clubs(group_type, elo DESC, id ASC);
