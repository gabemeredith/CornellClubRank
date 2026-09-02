DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS clubs;

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT,
  logo_url TEXT,
  logo_file TEXT,
  group_type TEXT NOT NULL,
  description TEXT,
  elo REAL NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  winner_id INTEGER NOT NULL REFERENCES clubs(id),
  loser_id INTEGER NOT NULL REFERENCES clubs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Running totals, so no read path has to COUNT(*) a growing table.
-- Keys in use: 'votes'.
CREATE TABLE IF NOT EXISTS site_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO site_counters (key, value) VALUES ('votes', 0);

CREATE INDEX idx_clubs_group_type ON clubs(group_type);
CREATE INDEX idx_clubs_elo ON clubs(elo DESC, id ASC);
-- Serves the paginated leaderboard when filtered by category
CREATE INDEX idx_clubs_group_elo ON clubs(group_type, elo DESC, id ASC);
CREATE INDEX idx_votes_created_at ON votes(created_at);
