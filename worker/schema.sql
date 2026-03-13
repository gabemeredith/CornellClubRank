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

CREATE INDEX idx_clubs_group_type ON clubs(group_type);
CREATE INDEX idx_clubs_elo ON clubs(elo DESC);
CREATE INDEX idx_votes_created_at ON votes(created_at);
