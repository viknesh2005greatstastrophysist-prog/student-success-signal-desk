CREATE TABLE institutions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, code)
);

CREATE TABLE departments (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id),
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, code)
);

CREATE TABLE people (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  external_subject text NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, external_subject),
  UNIQUE (generation_id, email)
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES people(id),
  role text NOT NULL CHECK (role IN ('student', 'parent', 'faculty', 'hod', 'governance')),
  department_id uuid REFERENCES departments(id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (generation_id, person_id, role)
);

CREATE TABLE faculty_assignments (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  faculty_person_id uuid NOT NULL REFERENCES people(id),
  course_offering_id uuid NOT NULL,
  assigned_by_person_id uuid NOT NULL REFERENCES people(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (generation_id, faculty_person_id, course_offering_id)
);

CREATE TABLE student_profiles (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES people(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  register_number text NOT NULL,
  cohort_year integer NOT NULL,
  semester integer NOT NULL CHECK (semester BETWEEN 1 AND 12),
  completed_course_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (generation_id, person_id),
  UNIQUE (generation_id, register_number)
);

CREATE TABLE parent_links (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  parent_person_id uuid NOT NULL REFERENCES people(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  relationship text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (generation_id, parent_person_id, student_id)
);

CREATE TABLE parent_field_grants (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  parent_link_id uuid NOT NULL REFERENCES parent_links(id),
  field_group text NOT NULL CHECK (field_group IN ('attendance', 'marks', 'fees', 'support')),
  granted boolean NOT NULL DEFAULT true,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, parent_link_id, field_group)
);

CREATE TABLE terms (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id),
  code text NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (generation_id, code)
);

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id),
  code text NOT NULL,
  title text NOT NULL,
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 8),
  description text NOT NULL,
  UNIQUE (generation_id, code)
);

CREATE TABLE course_prerequisites (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES courses(id),
  prerequisite_course_id uuid NOT NULL REFERENCES courses(id),
  minimum_grade text NOT NULL DEFAULT 'C',
  UNIQUE (generation_id, course_id, prerequisite_course_id),
  CHECK (course_id <> prerequisite_course_id)
);

CREATE TABLE course_offerings (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES courses(id),
  term_id uuid NOT NULL REFERENCES terms(id),
  section text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'closed')),
  revision integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  UNIQUE (generation_id, course_id, term_id, section)
);

ALTER TABLE faculty_assignments
  ADD CONSTRAINT faculty_assignments_offering_fk
  FOREIGN KEY (course_offering_id) REFERENCES course_offerings(id);

CREATE TABLE registration_windows (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  term_id uuid NOT NULL REFERENCES terms(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'open', 'closed')),
  CHECK (closes_at > opens_at),
  UNIQUE (generation_id, term_id, department_id)
);

CREATE TABLE registrations (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  status text NOT NULL CHECK (status IN ('registered', 'waitlisted', 'withdrawn', 'completed')),
  grade text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, student_id, course_offering_id)
);

CREATE TABLE timetable_slots (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  room text NOT NULL,
  CHECK (ends_at > starts_at),
  UNIQUE (generation_id, course_offering_id, weekday, starts_at)
);

CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  session_date date NOT NULL,
  topic text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'submitted', 'locked')),
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (generation_id, course_offering_id, session_date)
);

CREATE TABLE attendance_records (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  attendance_session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  recorded_by_person_id uuid NOT NULL REFERENCES people(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (generation_id, attendance_session_id, student_id)
);

CREATE TABLE assessments (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  title text NOT NULL,
  category text NOT NULL,
  maximum_score numeric(7,2) NOT NULL CHECK (maximum_score > 0),
  weight_percent numeric(5,2) NOT NULL CHECK (weight_percent BETWEEN 0 AND 100),
  published boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (generation_id, course_offering_id, title)
);

CREATE TABLE marks (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  score numeric(7,2) NOT NULL CHECK (score >= 0),
  feedback text NOT NULL DEFAULT '',
  recorded_by_person_id uuid NOT NULL REFERENCES people(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (generation_id, assessment_id, student_id)
);

CREATE TABLE fee_invoices (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  term_id uuid NOT NULL REFERENCES terms(id),
  invoice_number text NOT NULL,
  description text NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  paid_paise bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  due_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('due', 'partial', 'paid', 'void')),
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (generation_id, invoice_number),
  CHECK (paid_paise <= amount_paise)
);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES fee_invoices(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  provider text NOT NULL DEFAULT 'sandbox',
  provider_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'refunded')),
  paid_by_person_id uuid NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, provider_reference)
);

CREATE TABLE support_cases (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'processing', 'awaiting_faculty', 'approved', 'rejected', 'failed')),
  risk_band text NOT NULL CHECK (risk_band IN ('low', 'medium', 'high')),
  reason text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0
);

CREATE TABLE evidence_snapshots (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  support_case_id uuid NOT NULL REFERENCES support_cases(id),
  institution_revision bigint NOT NULL,
  input_hash text NOT NULL,
  evidence jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, support_case_id, institution_revision)
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  support_case_id uuid NOT NULL REFERENCES support_cases(id),
  evidence_snapshot_id uuid NOT NULL REFERENCES evidence_snapshots(id),
  mode text NOT NULL CHECK (mode IN ('deterministic', 'model')),
  model_id text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'validated', 'repaired', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text
);

CREATE TABLE agent_artifacts (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
  artifact_version integer NOT NULL,
  content_hash text NOT NULL,
  recommendation jsonb NOT NULL,
  validation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, agent_run_id, artifact_version)
);

CREATE TABLE faculty_decisions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  support_case_id uuid NOT NULL REFERENCES support_cases(id),
  agent_artifact_id uuid NOT NULL REFERENCES agent_artifacts(id),
  faculty_person_id uuid NOT NULL REFERENCES people(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  rationale text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, support_case_id)
);

CREATE TABLE support_plans (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  support_case_id uuid NOT NULL REFERENCES support_cases(id),
  faculty_decision_id uuid NOT NULL REFERENCES faculty_decisions(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  plan jsonb NOT NULL,
  visible_to_student boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, support_case_id)
);

CREATE TABLE replay_receipts (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  original_agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
  replay_agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
  requested_by_person_id uuid NOT NULL REFERENCES people(id),
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  matched boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  command_id uuid NOT NULL,
  actor_person_id uuid NOT NULL REFERENCES people(id),
  institution_revision bigint NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_items (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  domain_event_id uuid NOT NULL REFERENCES domain_events(id),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  event_id uuid REFERENCES domain_events(id),
  actor_person_id uuid NOT NULL REFERENCES people(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'failed')),
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE command_receipts (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES domain_events(id),
  audit_id uuid NOT NULL REFERENCES audit_events(id),
  institution_revision bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, command_id)
);

CREATE TABLE institution_revisions (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  current_generation_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE simulation_resets (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL UNIQUE,
  seed_version text NOT NULL,
  confirmation text NOT NULL,
  requested_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  manifest jsonb
);

CREATE INDEX role_assignments_person_idx ON role_assignments (generation_id, person_id) WHERE active;
CREATE INDEX registrations_student_idx ON registrations (generation_id, student_id, status);
CREATE INDEX registrations_offering_idx ON registrations (generation_id, course_offering_id, status);
CREATE INDEX attendance_records_student_idx ON attendance_records (generation_id, student_id);
CREATE INDEX marks_student_idx ON marks (generation_id, student_id);
CREATE INDEX support_cases_student_idx ON support_cases (generation_id, student_id, status);
CREATE INDEX audit_events_command_idx ON audit_events (generation_id, command_id);
CREATE INDEX domain_events_aggregate_idx ON domain_events (generation_id, aggregate_type, aggregate_id);

CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_transactions_append_only BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER evidence_snapshots_append_only BEFORE UPDATE OR DELETE ON evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER agent_artifacts_append_only BEFORE UPDATE OR DELETE ON agent_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER faculty_decisions_append_only BEFORE UPDATE OR DELETE ON faculty_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER replay_receipts_append_only BEFORE UPDATE OR DELETE ON replay_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER command_receipts_append_only BEFORE UPDATE OR DELETE ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
