ALTER TABLE sanket.daily_reports
  ADD COLUMN IF NOT EXISTS upi_collected numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_collected numeric(18,2) DEFAULT 0;
