PRAGMA foreign_keys = ON;

-- Live 3D match state. Existing match, player, and result records are preserved.
CREATE TABLE IF NOT EXISTS match_live_state (
  match_id INTEGER PRIMARY KEY,
  positions_json TEXT NOT NULL DEFAULT '[]',
  balls_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_match_live_state_updated
ON match_live_state(updated_at);
