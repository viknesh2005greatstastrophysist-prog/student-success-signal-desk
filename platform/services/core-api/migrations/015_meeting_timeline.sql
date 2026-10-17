-- The meeting timeline starts at the AI report (owner decision, 17 Oct): when a draft
-- reaches the mentor gate, one check-in is created for that support case, before any
-- plan exists, and the mentor can record the meeting while the draft is still at the
-- gate. The deadline (report date plus 14 days) is derived from support_cases.opened_at,
-- so no date column is added.
-- Additive only: two new nullable columns, a relaxed NOT NULL and new indexes. No
-- existing row is changed. Rows written before this migration keep their plan link
-- (support_plan_id) and are found through support_plans.support_case_id.
ALTER TABLE support_followups ADD COLUMN IF NOT EXISTS support_case_id uuid REFERENCES support_cases(id);
CREATE INDEX IF NOT EXISTS support_followups_case ON support_followups (generation_id, support_case_id);
ALTER TABLE support_meetings ADD COLUMN IF NOT EXISTS support_case_id uuid REFERENCES support_cases(id);
-- A meeting recorded while the draft is at the gate has a case but no plan yet.
ALTER TABLE support_meetings ALTER COLUMN support_plan_id DROP NOT NULL;
ALTER TABLE support_meetings ADD CONSTRAINT support_meetings_case_or_plan
  CHECK (support_case_id IS NOT NULL OR support_plan_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS support_meetings_case ON support_meetings (generation_id, support_case_id);
