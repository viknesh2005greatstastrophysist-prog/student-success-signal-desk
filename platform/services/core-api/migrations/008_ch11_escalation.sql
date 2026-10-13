ALTER TABLE ch11_jobs ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE ch11_jobs ADD COLUMN IF NOT EXISTS failure_diagnosis jsonb NOT NULL DEFAULT '{}'::jsonb;
