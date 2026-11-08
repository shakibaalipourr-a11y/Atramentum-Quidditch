PRAGMA foreign_keys = ON;

-- ATRAMENTUM ADMIN AUTHENTICATION
-- Passwords are provisioned later; no credentials are stored in source control.

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'house_admin', 'referee')),
  team_id TEXT,
  password_hash TEXT,
  password_salt TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  CHECK (
    (role = 'house_admin' AND team_id IS NOT NULL) OR
    (role IN ('super_admin', 'referee') AND team_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  target_username TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_id);

INSERT OR IGNORE INTO admin_users (username, display_name, role, team_id)
VALUES
  ('ACAME_IX47', 'Acame', 'super_admin', NULL),
  ('serpentis', 'مدیر اسلیترین', 'house_admin', 'slytherin'),
  ('gryphon', 'مدیر گریفیندور', 'house_admin', 'gryffindor'),
  ('badger', 'مدیر هافلپاف', 'house_admin', 'hufflepuff'),
  ('corvus', 'مدیر ریونکلا', 'house_admin', 'ravenclaw'),
  ('arbiter01', 'داور اول', 'referee', NULL),
  ('arbiter02', 'داور دوم', 'referee', NULL),
  ('arbiter03', 'داور سوم', 'referee', NULL),
  ('arbiter04', 'داور چهارم', 'referee', NULL);
