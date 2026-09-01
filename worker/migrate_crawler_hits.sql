-- Counts visits from AI and search crawlers, one row per bot per day.
--
-- This is the leading indicator for whether the site is being indexed: a hit
-- from OAI-SearchBot means ChatGPT is crawling, and a hit from ChatGPT-User
-- means a real person asked a question and ChatGPT fetched a page to answer it.
-- Referral traffic shows up weeks later, so this is what to watch first.
CREATE TABLE IF NOT EXISTS crawler_hits (
  day TEXT NOT NULL,
  bot TEXT NOT NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (day, bot, path)
);

CREATE INDEX IF NOT EXISTS idx_crawler_hits_day ON crawler_hits(day DESC, bot);
