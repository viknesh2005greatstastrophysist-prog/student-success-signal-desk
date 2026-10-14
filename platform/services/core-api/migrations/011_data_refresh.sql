-- Data refresh (additive). Generated project records can be replaced by a new data
-- generation without deleting anything: the previous row images stay in the
-- append-only record_changes table, and a case whose draft was computed on the
-- previous data can be retired as "superseded" (no row is deleted).
ALTER TABLE support_cases DROP CONSTRAINT IF EXISTS support_cases_status_check;
ALTER TABLE support_cases ADD CONSTRAINT support_cases_status_check
  CHECK (status IN ('open', 'processing', 'awaiting_faculty', 'approved', 'rejected', 'failed', 'superseded'));

-- One row per applied data generation. The latest row is the current one.
CREATE TABLE data_generations (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  label text NOT NULL,
  seed text NOT NULL,
  as_of timestamptz NOT NULL,
  supersedes_label text,
  summary jsonb NOT NULL,
  created_by uuid REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, label)
);
CREATE TRIGGER data_generations_append_only BEFORE UPDATE OR DELETE ON data_generations
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
