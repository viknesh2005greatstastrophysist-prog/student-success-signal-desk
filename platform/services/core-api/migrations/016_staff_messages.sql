-- Messages from the department head to a mentor (owner decision, 17 Oct): when the
-- conversation with a student about the AI report is not submitted 14 days after the
-- report, the department head can ask the mentor why, from inside the app. Nothing is
-- sent automatically; each message is written by the send-message command (audited in
-- record_changes and the command ledger) and read_at is set once by the recipient's
-- mark-message-read command. New table only: no existing table or row is altered.
CREATE TABLE IF NOT EXISTS staff_messages (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  from_person_id uuid NOT NULL REFERENCES people(id),
  to_person_id uuid NOT NULL REFERENCES people(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  support_case_id uuid REFERENCES support_cases(id),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS staff_messages_recipient ON staff_messages (generation_id, to_person_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS staff_messages_case ON staff_messages (generation_id, support_case_id, sent_at DESC);
