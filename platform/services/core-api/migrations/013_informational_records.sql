-- Informational records (additive, spec conformance P2-5). The lab manual's LMS,
-- internship and placement agents (11.4, agents 2 to 4) gather more than AURA scores:
-- quiz scores; internship registration, status and evaluation; placement readiness,
-- application activity and interview outcomes. These tables hold them. They are shown
-- to the people allowed to see the student and travel in the agents' evidence marked
-- informational, but no risk signal, threshold or flag reads them.
-- New tables only: no existing table or row is altered. `data_generation` is the label
-- of the data generation the values were made for and `origin` says which process wrote
-- the row (a data refresh or the informational backfill).

-- LMS quiz scores: one row per student, course and quiz (scores and times, never content).
CREATE TABLE IF NOT EXISTS lms_quiz_scores (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id),
  quiz_title text NOT NULL,
  score numeric NOT NULL CHECK (score >= 0),
  maximum_score numeric NOT NULL CHECK (maximum_score > 0),
  taken_at timestamptz NOT NULL,
  source_label text NOT NULL,
  data_generation text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score <= maximum_score),
  UNIQUE (generation_id, student_id, course_offering_id, quiz_title)
);
CREATE INDEX IF NOT EXISTS lms_quiz_scores_student ON lms_quiz_scores (generation_id, student_id, taken_at DESC);

-- Internship registration and evaluation: one row per student.
CREATE TABLE IF NOT EXISTS internship_records (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  status text NOT NULL CHECK (status IN ('not_registered', 'registered', 'ongoing', 'completed', 'withdrawn')),
  registered_on date,
  organisation text,
  role_title text,
  evaluation_grade text,
  evaluation_score numeric CHECK (evaluation_score IS NULL OR (evaluation_score >= 0 AND evaluation_score <= 100)),
  evaluated_on date,
  source_label text NOT NULL,
  recorded_on date NOT NULL,
  data_generation text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, student_id)
);

-- Placement readiness, application activity and interview outcomes: one row per student.
CREATE TABLE IF NOT EXISTS placement_records (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id),
  readiness_score integer CHECK (readiness_score IS NULL OR (readiness_score >= 0 AND readiness_score <= 100)),
  readiness_as_of date,
  applications integer NOT NULL DEFAULT 0 CHECK (applications >= 0),
  last_applied_on date,
  interviews integer NOT NULL DEFAULT 0 CHECK (interviews >= 0),
  offers integer NOT NULL DEFAULT 0 CHECK (offers >= 0),
  last_outcome text CHECK (last_outcome IS NULL OR last_outcome IN ('awaiting_result', 'next_round', 'not_selected', 'offer', 'offer_declined')),
  outcome_on date,
  source_label text NOT NULL,
  recorded_on date NOT NULL,
  data_generation text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (interviews <= applications AND offers <= interviews),
  UNIQUE (generation_id, student_id)
);
