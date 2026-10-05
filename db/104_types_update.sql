-- 104_types_update.sql
-- Relax email constraint
ALTER TABLE sanket.users ALTER COLUMN email DROP NOT NULL;
DROP INDEX IF EXISTS sanket.users_email_lower_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON sanket.users(lower(email)) WHERE email IS NOT NULL;

-- Add vehicle scheduling fields
ALTER TABLE sanket.vehicles
  ADD COLUMN IF NOT EXISTS schedule text,
  ADD COLUMN IF NOT EXISTS maintenance_date date;

-- Add daily report cash fields
ALTER TABLE sanket.daily_reports
  ADD COLUMN IF NOT EXISTS cash_breakdown jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cash_collected numeric(18,2) DEFAULT 0;
