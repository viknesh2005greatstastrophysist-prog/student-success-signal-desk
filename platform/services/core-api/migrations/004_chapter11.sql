-- Additive Chapter 11 state. Existing academic records and generations are preserved.
CREATE TABLE ch11_policies (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, department_id uuid NOT NULL REFERENCES departments(id),
  faculty_person_id uuid NOT NULL REFERENCES people(id), policy jsonb NOT NULL,
  rationale text NOT NULL, synthetic boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch11_sources (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  source text NOT NULL CHECK (source IN ('lms','internship','placement')),
  record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, student_id, source)
);
CREATE TABLE ch11_plans (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES people(id),
  department_id uuid NOT NULL REFERENCES departments(id), revision integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('clarifying','ready','locked')),
  body jsonb NOT NULL, plan_hash text, created_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz
);
CREATE TABLE ch11_jobs (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, plan_id uuid NOT NULL REFERENCES ch11_plans(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id), faculty_person_id uuid NOT NULL REFERENCES people(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','blocked','failed','awaiting_faculty','not_flagged')),
  stage text NOT NULL DEFAULT 'collect', checkpoint jsonb NOT NULL DEFAULT '{}',
  lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0,
  support_case_id uuid REFERENCES support_cases(id), error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, plan_id, student_id)
);
CREATE TABLE ch11_events (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, subject_id uuid NOT NULL,
  actor_person_id uuid NOT NULL REFERENCES people(id), event_type text NOT NULL,
  input_hash text NOT NULL, output_hash text NOT NULL, detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ch11_events_append_only BEFORE UPDATE OR DELETE ON ch11_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER ch11_policies_append_only BEFORE UPDATE OR DELETE ON ch11_policies
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TABLE ch11_interventions (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, support_plan_id uuid NOT NULL REFERENCES support_plans(id),
  faculty_person_id uuid NOT NULL REFERENCES people(id), status text NOT NULL CHECK (status IN ('planned','in_progress','completed','withdrawn')),
  outcome text NOT NULL, revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, support_plan_id)
);
CREATE INDEX ch11_jobs_plan ON ch11_jobs(generation_id, plan_id);
CREATE INDEX ch11_events_subject ON ch11_events(generation_id, subject_id, created_at);
