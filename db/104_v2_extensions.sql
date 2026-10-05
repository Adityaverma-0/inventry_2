-- 1. Salesman login without email
ALTER TABLE sanket.users ADD COLUMN IF NOT EXISTS username text;
UPDATE sanket.users SET username = email WHERE username IS NULL;
ALTER TABLE sanket.users ALTER COLUMN username SET NOT NULL;
ALTER TABLE sanket.users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE sanket.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE sanket.users DROP CONSTRAINT IF EXISTS users_email_key;

-- 2. Vehicle Scheduling
CREATE TABLE IF NOT EXISTS sanket.vehicle_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES sanket.vehicles(id),
  weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  areas text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  off_day boolean NOT NULL DEFAULT false,
  configured_by uuid NOT NULL REFERENCES sanket.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vehicle_id, weekday)
);
CREATE TABLE IF NOT EXISTS sanket.vehicle_schedule_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES sanket.vehicles(id),
  day date NOT NULL,
  areas text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  off_day boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  configured_by uuid NOT NULL REFERENCES sanket.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vehicle_id, day)
);

-- 3. Daily Report Cash Breakdown
ALTER TABLE sanket.report_revisions ADD COLUMN IF NOT EXISTS cash_breakdown jsonb;
ALTER TABLE sanket.report_revisions ADD COLUMN IF NOT EXISTS cash_expected bigint;
ALTER TABLE sanket.report_revisions ADD COLUMN IF NOT EXISTS cash_actual bigint;
