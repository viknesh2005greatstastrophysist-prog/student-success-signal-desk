CREATE TABLE lms_lessons (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  title text NOT NULL, body text NOT NULL DEFAULT '', material_url text NOT NULL DEFAULT '', attachment jsonb,
  published boolean NOT NULL DEFAULT false, position integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 0, created_by uuid NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lms_assignments (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  title text NOT NULL, instructions text NOT NULL, due_at timestamptz NOT NULL, maximum_score numeric NOT NULL CHECK(maximum_score > 0),
  attachment jsonb, published boolean NOT NULL DEFAULT false, allow_late boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 0, created_by uuid NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lms_submissions (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, assignment_id uuid NOT NULL REFERENCES lms_assignments(id),
  student_id uuid NOT NULL REFERENCES student_profiles(id), answer text NOT NULL DEFAULT '', attachment jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL DEFAULT 0,
  score numeric CHECK(score >= 0), feedback text NOT NULL DEFAULT '', graded_by uuid REFERENCES people(id),
  graded_at timestamptz, UNIQUE(generation_id, assignment_id, student_id)
);
CREATE TABLE lms_activity (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id), resource_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('lesson_opened','assignment_submitted')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lms_versions (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, resource_type text NOT NULL,
  resource_id uuid NOT NULL, revision integer NOT NULL, record jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES people(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_id,resource_type,resource_id,revision)
);
CREATE INDEX lms_lessons_course ON lms_lessons(generation_id,course_offering_id);
CREATE INDEX lms_assignments_course ON lms_assignments(generation_id,course_offering_id);
CREATE INDEX lms_activity_student ON lms_activity(generation_id,student_id,occurred_at DESC);
CREATE TRIGGER lms_activity_append_only BEFORE UPDATE OR DELETE ON lms_activity
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER lms_versions_append_only BEFORE UPDATE OR DELETE ON lms_versions
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
