
PRAGMA foreign_keys = ON;

-- =========================================
-- ATRAMENTUM QUIDDITCH DATABASE
-- Initial Migration
-- =========================================

-- 1. TEAMS

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    emblem TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO teams (id, name, display_name, emblem)
VALUES
('gryffindor', 'Gryffindor', 'گریفیندور', '🦁'),
('slytherin', 'Slytherin', 'اسلیترین', '🐍'),
('hufflepuff', 'Hufflepuff', 'هافلپاف', '🦡'),
('ravenclaw', 'Ravenclaw', 'ریونکلا', '🦅');


-- 2. PLAYERS

CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    team_id TEXT NOT NULL,
    player_number INTEGER NOT NULL,
    position TEXT NOT NULL,
    player_code_hash TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE (team_id, player_number)
);

-- Test player: Enzo
-- SHA-256 hash of ENZO001

INSERT OR IGNORE INTO players (
    id,
    name,
    team_id,
    player_number,
    position,
    player_code_hash,
    active
)
VALUES (
    1,
    'Enzo',
    'slytherin',
    1,
    'Chaser',
    '837baad78f4ed036c3446faa5886a85bf34da32df0513cf83fd6a1b0ea5a3dba',
    1
);


-- 3. SESSIONS

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
);


-- 4. MATCHES

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team_id TEXT NOT NULL,
    away_team_id TEXT NOT NULL,
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    winner_team_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (home_team_id) REFERENCES teams(id),
    FOREIGN KEY (away_team_id) REFERENCES teams(id),
    FOREIGN KEY (winner_team_id) REFERENCES teams(id)
);


-- 5. MATCH EVENTS

CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    player_id INTEGER,
    team_id TEXT,
    event_type TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
);


-- 6. PLAYER MATCH STATS

CREATE TABLE IF NOT EXISTS player_match_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    goals INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    catches INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE (match_id, player_id)
);


-- 7. MATCH TEAM RESULTS

CREATE TABLE IF NOT EXISTS match_team_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    team_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE (match_id, team_id)
);


-- 8. OFFICIALS

CREATE TABLE IF NOT EXISTS officials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 9. AUDIT LOGS

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES players(id)
);


-- 10. INDEXES

CREATE INDEX IF NOT EXISTS idx_players_team
ON players(team_id);

CREATE INDEX IF NOT EXISTS idx_sessions_player
ON sessions(player_id);

CREATE INDEX IF NOT EXISTS idx_sessions_token
ON sessions(token);

CREATE INDEX IF NOT EXISTS idx_matches_status
ON matches(status);

CREATE INDEX IF NOT EXISTS idx_match_events_match
ON match_events(match_id);

CREATE INDEX IF NOT EXISTS idx_player_stats_player
ON player_match_stats(player_id);
