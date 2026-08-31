export const POSTGRES_INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  display_name text,
  role text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);

CREATE TABLE IF NOT EXISTS memberships (
  user_id text NOT NULL,
  site_id text NOT NULL,
  site_role text NOT NULL DEFAULT 'observatory_member',
  imaging_approved_at timestamptz,
  imaging_rejected_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE IF NOT EXISTS site_policies (
  site_id text PRIMARY KEY,
  guest_access text NOT NULL DEFAULT 'closed',
  member_project_duration_limit_hours double precision NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL
);
ALTER TABLE site_policies ADD COLUMN IF NOT EXISTS member_project_duration_limit_hours double precision NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS guest_site_access (
  user_id text NOT NULL,
  site_id text NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL,
  decided_by_user_id text,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE IF NOT EXISTS imaging_requests (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  status text NOT NULL,
  user_id text,
  target text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  document jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS imaging_requests_site_status_idx ON imaging_requests (site_id, status);

CREATE TABLE IF NOT EXISTS imaging_request_payloads (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  nina_sequence_json text
);

CREATE TABLE IF NOT EXISTS imaging_projects (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  status text NOT NULL,
  user_id text,
  target text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  document jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS imaging_projects_site_idx ON imaging_projects (site_id);

CREATE TABLE IF NOT EXISTS session_board (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  status text NOT NULL,
  user_id text,
  updated_at timestamptz NOT NULL,
  document jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  detail jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_site_at_idx ON audit_log (site_id, at);

CREATE TABLE IF NOT EXISTS gallery_submissions (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  document jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS imaging_equipment (
  site_id text PRIMARY KEY,
  rigs jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_closed_windows (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  start_iso timestamptz NOT NULL,
  end_iso timestamptz NOT NULL,
  document jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS r2_object_map (
  queue_id text NOT NULL,
  kind text NOT NULL,
  site_id text NOT NULL,
  object_key text NOT NULL,
  PRIMARY KEY (kind, queue_id)
);

CREATE TABLE IF NOT EXISTS member_saved_sessions (
  id text NOT NULL,
  user_id text NOT NULL,
  site_id text NOT NULL,
  name text NOT NULL,
  updated_at timestamptz NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS member_session_history (
  id text NOT NULL,
  user_id text NOT NULL,
  site_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY (user_id, id)
);
`
