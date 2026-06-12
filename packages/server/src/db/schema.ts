export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  model TEXT,
  yolo INTEGER NOT NULL DEFAULT 1,
  baseline_git_head TEXT,
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

CREATE TABLE IF NOT EXISTS session_reviews (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  baseline_git_head TEXT,
  current_git_head TEXT,
  changed_files_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  last_output TEXT NOT NULL,
  exit_code INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS session_supervisors (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS supervisor_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  objective TEXT,
  created_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  terminal_tail TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_reviews_session_id_created_at
  ON supervisor_reviews(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_login_blocks (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);
`;
