import type { ActorRole } from "./index";
export type TimetableSlot = {
  id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  room: string;
  code?: string;
  title?: string;
};
export type ExperienceCourse = {
  id: string;
  course_id: string;
  term_id: string;
  code: string;
  title: string;
  description: string;
  credits: number;
  section: string;
  capacity: number;
  status: string;
  revision: number;
  term_name: string;
  term_active: boolean;
  faculty_id: string | null;
  faculty_name: string | null;
  enrolled: number;
  slots: TimetableSlot[];
  registration_id?: string | null;
  registration_status?: string | null;
  prerequisites: string[];
  window_status: string | null;
  opens_at: string | null;
  closes_at: string | null;
};
export type PersonSummary = {
  id: string;
  name: string;
  email: string;
  revision?: number;
  person_id?: string;
  register_number?: string;
  semester?: number;
  mentor_id?: string | null;
  mentor_name?: string | null;
  mentor_revision?: number;
  mentee_count?: number;
  course_count?: number;
  active_registrations?: number;
  attention_count?: number;
};
export type RegistrationSubmission = {
  id: string;
  term_id: string;
  status: string;
  revision: number;
  submitted_at: string | null;
};
export type GradeBand = { minimum: number; points: number; letter: string };
export type GradingScale = {
  id: string;
  label: string;
  bands: GradeBand[];
  revision: number;
};
export type CourseProgress = {
  offering_id: string;
  code: string;
  title: string;
  credits: number;
  term_id: string;
  term_name: string;
  registration_status: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number | null;
  result_id: string | null;
  result_percentage: number | null;
  grade_point: number | null;
  letter: string | null;
  result_revision: number | null;
  result_published: boolean | null;
};
export type AcademicMark = {
  id: string;
  offering_id: string;
  code: string;
  assessment_id: string;
  assessment: string;
  maximum_score: number;
  score: number;
  feedback: string;
  revision: number;
};
export type AttendanceEntry = {
  id: string;
  offering_id: string;
  code: string;
  session_id: string;
  session_date: string;
  topic: string;
  status: string;
  revision: number;
};
export type Followup = {
  id: string;
  student_id: string;
  student_name: string;
  mentor_name: string;
  due_on: string;
  note: string;
  shared: boolean;
  status: string;
  outcome: string;
  revision: number;
  overdue: boolean;
};
export type SupportPlan = {
  id: string;
  case_id: string;
  reason: string;
  risk_band: string;
  visible: boolean;
  created_at: string;
  plan: Record<string, unknown>;
};
export type Invoice = {
  id: string;
  invoice_number: string;
  description: string;
  amount_paise: number;
  paid_paise: number;
  due_on: string;
  status: string;
  revision: number;
  transactions: {
    id: string;
    amount_paise: number;
    created_at: string;
    status: string;
  }[];
};
export type StudentDetail = {
  student: PersonSummary;
  grants: string[];
  courses: CourseProgress[];
  marks: AcademicMark[];
  attendance: AttendanceEntry[];
  gpa: {
    cgpa: number | null;
    terms: {
      id: string;
      name: string;
      sgpa: number;
      credits: number;
      graded_courses: number;
      registered_courses: number;
    }[];
    label: string;
  };
  mentor: { name: string; email: string } | null;
  invoices: Invoice[];
  support: SupportPlan[];
  followups: Followup[];
  sources: {
    source: string;
    state: string;
    observed_at: string;
    values: Record<string, string | number | boolean>;
  }[];
  history: {
    id: string;
    resource_type: string;
    reason: string;
    actor: string;
    occurred_at: string;
    previous: Record<string, unknown> | null;
    updated: Record<string, unknown>;
  }[];
  registration: RegistrationSubmission[];
};
export type ExperienceOverview = {
  actor: {
    role: ActorRole;
    name: string;
    email: string;
    student_id: string | null;
  };
  department: string;
  courses: ExperienceCourse[];
  students: PersonSummary[];
  faculty: PersonSummary[];
  children: PersonSummary[];
  registration: RegistrationSubmission[];
  terms: { id: string; name: string; active: boolean }[];
  grading: GradingScale | null;
  followups: Followup[];
  counts: {
    students: number;
    faculty: number;
    courses: number;
    pending_reviews: number;
    failed_reviews: number;
    overdue_followups: number;
    draft_courses: number;
  };
  windows: {
    id: string;
    term_id: string;
    opens_at: string;
    closes_at: string;
    status: string;
    revision: number;
  }[];
};
export type Classroom = {
  results: {
    student_id: string;
    percentage: number;
    revision: number;
    published: boolean;
  }[];
  course: ExperienceCourse;
  roster: PersonSummary[];
  sessions: {
    id: string;
    session_date: string;
    topic: string;
    status: string;
    revision: number;
    records: { student_id: string; status: string }[];
  }[];
  assessments: {
    id: string;
    title: string;
    maximum_score: number;
    weight_percent: number;
    published: boolean;
    revision: number;
    marks: { student_id: string; score: number; feedback: string }[];
  }[];
};
