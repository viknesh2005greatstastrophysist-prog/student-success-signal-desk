-- Meeting records (owner request, 17 Oct): proof that the mentor spoke to the student
-- after a support plan, not a recheck of the figures. One record per check-in
-- (support_followups), linked to the support plan: the day they met, the reasons the
-- student gave from a fixed list, a note, what was agreed next, and who recorded it.
-- New table only: no existing table or row is altered. Records are append-only, like
-- the other evidence of a decision; a correction is a new check-in with its own record.
CREATE TABLE IF NOT EXISTS support_meetings (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  followup_id uuid NOT NULL UNIQUE REFERENCES support_followups(id),
  support_plan_id uuid NOT NULL REFERENCES support_plans(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  met_on date NOT NULL,
  reasons text[] NOT NULL CHECK (
    cardinality(reasons) >= 1
    AND reasons <@ ARRAY[
      'Health', 'Family responsibilities', 'Financial pressure', 'Transport or distance',
      'Course difficulty', 'Lost motivation or interest', 'Part-time work',
      'Personal or mental-health concern', 'Timetable clash', 'Other'
    ]::text[]
  ),
  note text NOT NULL DEFAULT '',
  agreed_next_step text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES people(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- "Other" needs a note saying what it was.
  CHECK (NOT ('Other' = ANY(reasons)) OR length(btrim(note)) > 0)
);
CREATE INDEX IF NOT EXISTS support_meetings_plan ON support_meetings (generation_id, support_plan_id, met_on DESC);
CREATE INDEX IF NOT EXISTS support_meetings_student ON support_meetings (generation_id, student_id);
CREATE INDEX IF NOT EXISTS support_followups_plan ON support_followups (generation_id, support_plan_id);
CREATE OR REPLACE TRIGGER support_meetings_append_only BEFORE UPDATE OR DELETE ON support_meetings
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
