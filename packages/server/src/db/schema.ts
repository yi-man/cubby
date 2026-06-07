export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  pid INTEGER,
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT,
  pid INTEGER,
  cols INTEGER DEFAULT 80,
  rows INTEGER DEFAULT 24,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS terminal_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  data TEXT NOT NULL,
  seq_start INTEGER,
  seq_end INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_outputs_session_id_id
  ON terminal_outputs(session_id, id);

CREATE TABLE IF NOT EXISTS terminal_snapshots (
  session_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  seq INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`;
