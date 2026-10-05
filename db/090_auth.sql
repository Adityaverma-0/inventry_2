CREATE TABLE IF NOT EXISTS sanket.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 email text NOT NULL UNIQUE,
 mobile text NOT NULL DEFAULT '',
 role text NOT NULL CHECK(role IN ('owner','salesman')),
 active boolean NOT NULL DEFAULT true,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON sanket.users(lower(email));
CREATE TABLE IF NOT EXISTS sanket.sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES sanket.users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sanket.sessions(user_id);
CREATE TABLE IF NOT EXISTS sanket.auth_attempts (
 bucket text PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 0,
 window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sanket.team_requests (
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES sanket.users(id),
 payload_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
