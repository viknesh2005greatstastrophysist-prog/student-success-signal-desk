CREATE TABLE mentor_assignments (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  faculty_person_id uuid NOT NULL REFERENCES people(id), assigned_by uuid NOT NULL REFERENCES people(id),
  revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_id,student_id)
);
CREATE TABLE registration_submissions (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  term_id uuid NOT NULL REFERENCES terms(id), status text NOT NULL CHECK(status IN ('open','submitted')),
  revision integer NOT NULL DEFAULT 0, submitted_at timestamptz,
  UNIQUE(generation_id,student_id,term_id)
);
CREATE TABLE grading_scales (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, department_id uuid NOT NULL REFERENCES departments(id),
  label text NOT NULL DEFAULT 'Demonstration 10-point scale', bands jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0, UNIQUE(generation_id,department_id)
);
CREATE TABLE course_results (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id), percentage numeric CHECK(percentage BETWEEN 0 AND 100),
  grade_point numeric NOT NULL CHECK(grade_point BETWEEN 0 AND 10), letter text NOT NULL,
  scale_revision integer NOT NULL, published boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
  recorded_by uuid REFERENCES people(id), recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_id,student_id,course_offering_id)
);
CREATE TABLE support_followups (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_profiles(id),
  support_plan_id uuid REFERENCES support_plans(id), mentor_person_id uuid NOT NULL REFERENCES people(id),
  due_on date NOT NULL, note text NOT NULL, shared boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK(status IN ('planned','in_progress','completed')), outcome text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE record_changes (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES people(id),
  resource_type text NOT NULL, resource_id uuid NOT NULL, reason text NOT NULL,
  previous jsonb, updated jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER record_changes_append_only BEFORE UPDATE OR DELETE ON record_changes
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE INDEX support_followups_student ON support_followups(generation_id,student_id);
ALTER TABLE ch11_plans ADD COLUMN paused boolean NOT NULL DEFAULT false;

INSERT INTO mentor_assignments(id,generation_id,student_id,faculty_person_id,assigned_by)
SELECT gen_random_uuid(),sp.generation_id,sp.id,f.person_id,h.person_id FROM student_profiles sp
JOIN institution_revisions ir ON ir.current_generation_id=sp.generation_id AND ir.singleton
JOIN LATERAL(SELECT r.person_id FROM role_assignments r JOIN people p ON p.id=r.person_id WHERE r.generation_id=sp.generation_id AND r.department_id=sp.department_id AND r.role='faculty' AND r.active ORDER BY p.email LIMIT 1) f ON true
JOIN LATERAL(SELECT r.person_id FROM role_assignments r WHERE r.generation_id=sp.generation_id AND r.department_id=sp.department_id AND r.role='hod' AND r.active ORDER BY r.person_id LIMIT 1) h ON true;
INSERT INTO grading_scales(id,generation_id,department_id,bands)
SELECT gen_random_uuid(),d.generation_id,d.id,'[{"minimum":90,"points":10,"letter":"O"},{"minimum":80,"points":9,"letter":"A+"},{"minimum":70,"points":8,"letter":"A"},{"minimum":60,"points":7,"letter":"B+"},{"minimum":50,"points":6,"letter":"B"},{"minimum":40,"points":5,"letter":"C"},{"minimum":0,"points":0,"letter":"F"}]'::jsonb
FROM departments d JOIN institution_revisions ir ON ir.current_generation_id=d.generation_id AND ir.singleton;
INSERT INTO course_results(id,generation_id,student_id,course_offering_id,grade_point,letter,scale_revision,published)
SELECT gen_random_uuid(),r.generation_id,r.student_id,r.course_offering_id,8,'A',0,true FROM registrations r
JOIN institution_revisions ir ON ir.current_generation_id=r.generation_id AND ir.singleton WHERE r.status='completed' AND r.grade='A';
ALTER TABLE registration_windows ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN revision integer NOT NULL DEFAULT 0;
