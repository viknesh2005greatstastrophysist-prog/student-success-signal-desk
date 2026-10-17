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
  support_plan_id?: string | null;
  /** Staff only: the plan this check-in belongs to was computed on earlier figures. */
  plan_stale?: boolean;
};
/** The conversation the mentor (or the department head) recorded with the student about the AI report. */
export type MeetingRecord = {
  id: string;
  followup_id: string;
  met_on: string;
  /** From the fixed list (Health, Family responsibilities, ... Other). Staff only. */
  reasons: string[];
  note: string;
  agreed_next_step: string;
  recorded_by: string;
  recorded_at: string;
};
/**
 * Where the conversation about an AI report stands (calendar days in India): "due"
 * before day 7, "meet_now" on days 7 to 14, "past_deadline" after day 14 (the
 * department head sees it), "met" once submitted.
 */
export type MeetingStage = "due" | "meet_now" | "past_deadline" | "met";
export type MeetingTimeline = {
  /** The day of the AI report: the draft reached the mentor gate. */
  report_on: string;
  /** Meet the student by this day (report plus 7 days). */
  meet_by: string;
  /** Submit the conversation by this day (report plus 14 days). */
  deadline: string;
  days_since: number;
  stage: MeetingStage;
  /** Days left until meet_by while "due". */
  days_left: number | null;
  /** Days past meet_by once "meet_now" or "past_deadline". */
  days_overdue: number | null;
};
/** One student's current AI report (at the gate or approved) and the conversation about it. */
export type MeetingStatus = MeetingTimeline & {
  case_id: string;
  /** The approved plan, or null while the draft is at the gate. */
  plan_id: string | null;
  case_status: "awaiting_faculty" | "approved";
  student_id: string;
  student_name: string;
  register_number: string;
  mentor_id: string | null;
  mentor_name: string | null;
  meeting: MeetingRecord | null;
  checkin: { id: string; due_on: string; status: string } | null;
  /** The latest reminder the department head sent the mentor about this report. */
  reminder?: { sent_at: string; read_at: string | null; from_name: string } | null;
};
/** A message from the department head to a mentor about a conversation not submitted. */
export type StaffMessage = {
  id: string;
  from_name: string;
  to_name: string;
  student_id: string;
  student_name: string;
  support_case_id: string | null;
  body: string;
  sent_at: string;
  read_at: string | null;
};
export type SupportPlan = {
  id: string;
  case_id: string;
  reason: string;
  risk_band: string;
  visible: boolean;
  created_at: string;
  plan: Record<string, unknown>;
  /** Data generation the plan's evidence was captured on, and whether it is the current one. */
  evidence_generation?: string;
  evidence_current?: boolean;
  evidence_captured_at?: string | null;
  /** Status and outcome of the plan's intervention (staff only). */
  intervention_status?: string | null;
  intervention_outcome?: string | null;
  /** Model that drafted the plan, as recorded on its agent run (null for retired rule-based drafts). */
  model_id?: string | null;
  /** Staff only: the conversation about this plan's AI report, and where it stands. */
  meeting?: MeetingRecord | null;
  meeting_due?: MeetingTimeline | null;
  /** Student and parent: only the day the mentor met the student, never the reasons. */
  met_on?: string | null;
};
export type Invoice = {
  payment_simulation_allowed?: boolean;
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
/** Informational records (lab manual 11.4, agents 2 to 4): shown for context with
 * their source and date, never scored. */
export type QuizScore = {
  course: string;
  title: string;
  score: number;
  maximum_score: number;
  taken_at: string;
  source: string;
};
export type InternshipRecord = {
  status: string;
  registered_on: string | null;
  organisation: string | null;
  role_title: string | null;
  evaluation_grade: string | null;
  evaluation_score: number | null;
  evaluated_on: string | null;
  source: string;
  recorded_on: string;
};
export type PlacementRecord = {
  readiness_score: number | null;
  readiness_as_of: string | null;
  applications: number;
  last_applied_on: string | null;
  interviews: number;
  offers: number;
  last_outcome: string | null;
  outcome_on: string | null;
  source: string;
  recorded_on: string;
};
export type InformationalRecords = {
  scored: false;
  /** "For context, not scored" */
  note: string;
  /** Quiz scores follow the marks grant; null when not shared with this account. */
  quizzes: QuizScore[] | null;
  /** Internship and placement records follow the support grant. */
  career_shared: boolean;
  internship: InternshipRecord | null;
  placement: PlacementRecord | null;
};
export type StudentDetail = {
  student: PersonSummary;
  grants: string[];
  courses: CourseProgress[];
  marks: AcademicMark[];
  attendance: AttendanceEntry[];
  /** Attendance this term as the risk check and the plan compute it: every recorded
   * session of the active term pooled, excused sessions left out. Null without the
   * attendance grant or before any session is recorded. */
  attendance_overall?: number | null;
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
  /** Set for a student or parent when a plan is held back because its evidence predates the current data. */
  support_notice?: string | null;
  followups: Followup[];
  /** Staff: the student's current AI report and the conversation about it. */
  meeting?: MeetingStatus | null;
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
  /** Quiz scores, internship and placement records, within this account's grants. */
  informational?: InformationalRecords;
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
  /** Mentor and department head: each student's current AI report and the conversation about it. */
  meetings?: MeetingStatus[];
  /** Mentor: the messages from the department head, newest first. */
  messages?: StaffMessage[];
  counts: {
    students: number;
    faculty: number;
    courses: number;
    pending_reviews: number;
    failed_reviews: number;
    overdue_followups: number;
    draft_courses: number;
    /** Current AI reports whose conversation is not submitted yet. */
    meetings_pending?: number;
    /** Of those, the ones past the 14-day deadline. */
    meetings_past_deadline?: number;
    /** Mentor: messages from the department head not yet marked as read. */
    unread_messages?: number;
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
