-- ═══════════════════════════════════════════════════════════════════════════
-- Shade — initial schema
--
-- Design rule that shapes every table below:
--
--   PostgreSQL stores  → identity, ownership, metadata, status, timestamps and
--                        *references* to bytes.
--   Object storage     → raw uploads, generated Markdown, generated JSON,
--                        extracted images and every future artifact.
--
-- Nothing here holds a document body. `documents.storage_key` and
-- `artifacts.storage_key` are pointers, and they are never returned to a
-- browser — every read is mediated by the API so ownership can be checked.
--
-- Idempotent: safe to re-run. Applied by `npm run db:migrate` and, on a fresh
-- Docker volume, by the postgres entrypoint.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keeps `updated_at` honest without every write path having to remember it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── users ──────────────────────────────────────────────────────────────────
-- Email is stored already-lowercased by the application so a plain UNIQUE
-- index gives case-insensitive behaviour without the citext extension.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── sessions ───────────────────────────────────────────────────────────────
-- One table serves both principal kinds. An anonymous session is a real,
-- server-issued row with a usage quota — not a client-side flag — so the
-- pre-auth limit cannot be reset by clearing browser storage.
--
-- Only the SHA-256 of the session token is stored, so a database read does not
-- hand an attacker a usable cookie.

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  jobs_used    INTEGER NOT NULL DEFAULT 0 CHECK (jobs_used >= 0),
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessions_kind_valid CHECK (kind IN ('USER', 'ANONYMOUS')),
  -- A USER session must have an owner; an ANONYMOUS one must not.
  CONSTRAINT sessions_owner_matches_kind CHECK ((kind = 'USER') = (user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);


-- ── projects ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  summary    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_id_updated_at_idx
  ON projects (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── documents ──────────────────────────────────────────────────────────────
-- Ownership is exactly one of: a user (authenticated) or a session
-- (anonymous first use). When an anonymous visitor signs up, their documents
-- are re-parented onto the new user, so the work they already did is not lost.

CREATE TABLE IF NOT EXISTS documents (
  id               TEXT PRIMARY KEY,
  project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
  owner_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  owner_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL CHECK (size_bytes >= 0),
  page_count       INTEGER CHECK (page_count IS NULL OR page_count > 0),
  status           TEXT NOT NULL DEFAULT 'UPLOADED',
  summary          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_status_valid CHECK (
    status IN ('UPLOADING', 'UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED')
  ),
  -- Exactly one owner. Guards against the classic "client sent a user id that
  -- is not theirs" bug becoming a data-integrity bug as well.
  CONSTRAINT documents_single_owner CHECK (
    num_nonnulls(owner_user_id, owner_session_id) = 1
  )
);

CREATE INDEX IF NOT EXISTS documents_owner_user_idx
  ON documents (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_owner_session_idx
  ON documents (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_project_idx
  ON documents (project_id, created_at DESC);

DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── processing_jobs ────────────────────────────────────────────────────────
-- `metrics` holds small summary counters only (chunk/asset/table counts) so a
-- list view can render without touching an artifact. Extracted text is never
-- stored here.

CREATE TABLE IF NOT EXISTS processing_jobs (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'QUEUED',
  progress     SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stage        TEXT,
  input        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        JSONB,
  metrics      JSONB,
  engine       TEXT,
  attempts     SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT processing_jobs_operation_valid CHECK (operation IN ('PARSE', 'EXTRACT', 'SPLIT')),
  CONSTRAINT processing_jobs_status_valid CHECK (
    status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS processing_jobs_document_idx
  ON processing_jobs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS processing_jobs_status_idx
  ON processing_jobs (status, created_at)
  WHERE status IN ('QUEUED', 'PROCESSING');


-- ── artifacts ──────────────────────────────────────────────────────────────
-- Storage keys are deterministic (`artifacts/{docId}/{op}/document.md`), which
-- makes the UNIQUE constraint below meaningful: job delivery is at-least-once,
-- so a redelivered job must upsert its artifacts rather than duplicate them.

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  job_id      TEXT REFERENCES processing_jobs(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_type_valid CHECK (type IN ('MARKDOWN', 'JSON', 'ASSET'))
);

CREATE INDEX IF NOT EXISTS artifacts_document_type_idx
  ON artifacts (document_id, type);
CREATE INDEX IF NOT EXISTS artifacts_job_idx ON artifacts (job_id);


-- ── activities ─────────────────────────────────────────────────────────────
-- The history feed. `message` is denormalised at write time so rendering a
-- page of history never joins across four tables.

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  job_id      TEXT REFERENCES processing_jobs(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activities_type_valid CHECK (
    type IN (
      'PROJECT_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_PARSED',
      'DOCUMENT_EXTRACTED', 'DOCUMENT_SPLIT', 'JOB_FAILED'
    )
  )
);

-- Cursor pagination walks (created_at, id) descending, so the index matches.
CREATE INDEX IF NOT EXISTS activities_user_created_idx
  ON activities (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activities_project_created_idx
  ON activities (project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activities_document_idx ON activities (document_id);


-- ── extraction_schemas ─────────────────────────────────────────────────────
-- Saved Extract schemas. `fields` is the SchemaField[] tree from the shared
-- contracts — small, structured, and legitimately relational data.

CREATE TABLE IF NOT EXISTS extraction_schemas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  fields      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_schemas_user_idx
  ON extraction_schemas (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS extraction_schemas_set_updated_at ON extraction_schemas;
CREATE TRIGGER extraction_schemas_set_updated_at
  BEFORE UPDATE ON extraction_schemas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── upload_tickets ─────────────────────────────────────────────────────────
-- Issued by POST /api/uploads/presign. The server decides the storage key and
-- records the declared size/content-type; the direct upload endpoint validates
-- the real bytes against this row before accepting them. A ticket is
-- single-use (`consumed_at`) and short-lived (`expires_at`).

CREATE TABLE IF NOT EXISTS upload_tickets (
  id               TEXT PRIMARY KEY,
  owner_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  owner_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  storage_key      TEXT NOT NULL,
  filename         TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  declared_bytes   BIGINT NOT NULL CHECK (declared_bytes > 0),
  consumed_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT upload_tickets_single_owner CHECK (
    num_nonnulls(owner_user_id, owner_session_id) = 1
  )
);

CREATE INDEX IF NOT EXISTS upload_tickets_expires_at_idx ON upload_tickets (expires_at);
CREATE INDEX IF NOT EXISTS upload_tickets_session_idx ON upload_tickets (owner_session_id);


-- ── record this migration ──────────────────────────────────────────────────

INSERT INTO schema_migrations (version) VALUES ('001_init')
ON CONFLICT (version) DO NOTHING;
