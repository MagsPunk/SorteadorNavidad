PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draws (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  participant_id INTEGER PRIMARY KEY REFERENCES participants(id),
  recipient_encrypted TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS draw_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules_encrypted TEXT NOT NULL
);
