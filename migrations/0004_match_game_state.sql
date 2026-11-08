PRAGMA foreign_keys = ON;

-- Persistent match clock and Golden Snitch result.
-- Existing match and event data are preserved.
CREATE TABLE IF NOT EXISTS match_game_state (
  match_id INTEGER PRIMARY KEY,
  started_at TEXT,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  clock_running INTEGER NOT NULL DEFAULT 0 CHECK (clock_running IN (0,1)),
  snitch_caught_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (snitch_caught_by) REFERENCES teams(id)
);
