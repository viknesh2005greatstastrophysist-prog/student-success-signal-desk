export type Role = "OPERATIONS" | "MENTOR" | "LEADERSHIP" | "STUDENT" | "PARENT";
export type CaseStatus = "AWAITING_MENTOR" | "DATA_BLOCKED" | "CLOSED";
export type Priority = "HIGH" | "MEDIUM" | "LOW" | "DATA BLOCKED";
export type InterventionStatus = "PLANNED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type Identity = {
  id: string;
  label: string;
  role: Role;
  mentorId?: string;
  studentRef?: string;
};

export type SourceRecord = {
  source: "Academic" | "LMS" | "Internship" | "Placement";
  state: "PRESENT" | "MISSING" | "STALE" | "NOT APPLICABLE";
  detail: string;
  observed: string;
};

export type StudentCase = {
  studentRef: string;
  section: string;
  mentorId: string;
  priority: Priority;
  concern: number;
  status: CaseStatus;
  signals: string[];
  recommendation: string;
  sources: SourceRecord[];
  closedReason?: string;
};

export type Intervention = {
  id: string;
  studentRef: string;
  ownerId: string;
  support: string;
  rationale: string;
  status: InterventionStatus;
  due: string;
  outcome: string;
};

export type AuditEvent = {
  seq: number;
  type: string;
  actor: string;
  subject: string;
  state: string;
  time: string;
  runId?: string;
  eventId?: string;
};

export type ViewerProfile = {
  role: Role;
  displayName: string;
  mentorId?: string;
  studentRef?: string;
  canPreview: boolean;
};

export type UserProfileSummary = {
  userId: string;
  role: Role;
  displayName: string;
  mentorId?: string;
  studentRef?: string;
};

export type LineageRecord = {
  caseId: string;
  runId: string;
  collectionRunId: string;
  snapshotId: string;
  policyVersionId: string;
  modelRunId?: string;
  artifactVersionId?: string;
  criticArtifactId?: string;
  repairArtifactId?: string;
  replayId: string;
  status: string;
};

export type ReplayReceipt = {
  replayId: string;
  runId: string;
  artifactsVerified: number;
  eventsReconstructed: number;
  verifiedAt: string;
};

export type StateSummary = {
  studentsMonitored: number;
  awaitingMentor: number;
  dataBlocked: number;
  interventions: number;
  activeSupports: number;
  eventCount: number;
  priorityCounts: { High: number; Medium: number; Low: number; Blocked: number };
};

export type DemoState = {
  cases: StudentCase[];
  interventions: Intervention[];
  events: AuditEvent[];
  runs: number;
  lastRun: string;
  version?: number;
  summary?: StateSummary;
  persistence?: "postgres";
  agentMode?: "governed-llm" | "governed-deterministic-fallback";
  modelId?: string;
  viewer?: ViewerProfile;
  activeIdentity?: Identity;
  availableIdentities?: Identity[];
  lineage?: LineageRecord[];
  latestRunId?: string;
  lastReplay?: ReplayReceipt;
  userProfiles?: UserProfileSummary[];
};

export const IDENTITIES: Identity[] = [
  { id: "operations", label: "AURA Operations", role: "OPERATIONS" },
  { id: "mentor-01", label: "Faculty Mentor 01", role: "MENTOR", mentorId: "mentor-01" },
  { id: "mentor-02", label: "Faculty Mentor 02", role: "MENTOR", mentorId: "mentor-02" },
  { id: "hod", label: "Head of Department", role: "LEADERSHIP" },
  { id: "dean", label: "Dean of Student Affairs", role: "LEADERSHIP" },
  { id: "student-01", label: "Synthetic Student 0001", role: "STUDENT", studentRef: "SYN-0001" },
  { id: "student-02", label: "Synthetic Student 0002", role: "STUDENT", studentRef: "SYN-0002" },
  { id: "parent-02", label: "Parent of Synthetic Student 0002", role: "PARENT", studentRef: "SYN-0002" },
];

const BASE_SOURCES: SourceRecord[] = [
  { source: "Academic", state: "PRESENT", detail: "CIE and credit record received", observed: "02 Sep 2026" },
  { source: "LMS", state: "PRESENT", detail: "Activity window received", observed: "01 Sep 2026" },
  { source: "Internship", state: "NOT APPLICABLE", detail: "No active internship window", observed: "Policy-defined" },
  { source: "Placement", state: "PRESENT", detail: "Readiness record received", observed: "30 Aug 2026" },
];

export function initialState(): DemoState {
  return {
    cases: [
      {
        studentRef: "SYN-0001", section: "A", mentorId: "mentor-01", priority: "HIGH", concern: 65,
        status: "AWAITING_MENTOR", signals: ["Attendance below policy threshold", "CIE trend requires review", "LMS activity declined"],
        recommendation: "Schedule a mentor check-in and agree a short academic recovery plan.",
        sources: BASE_SOURCES,
      },
      {
        studentRef: "SYN-0002", section: "A", mentorId: "mentor-01", priority: "HIGH", concern: 80,
        status: "AWAITING_MENTOR", signals: ["Attendance below policy threshold", "Two CIE components require review", "LMS inactivity", "Placement readiness incomplete"],
        recommendation: "Review evidence with the student before scheduling academic and wellbeing support.",
        sources: BASE_SOURCES,
      },
      {
        studentRef: "SYN-0003", section: "A", mentorId: "mentor-01", priority: "DATA BLOCKED", concern: 0,
        status: "DATA_BLOCKED", signals: [], recommendation: "No recommendation permitted until the academic record is supplied.",
        sources: BASE_SOURCES.map((source) => source.source === "Academic" ? { ...source, state: "MISSING", detail: "Required record unavailable", observed: "Not supplied" } : source),
      },
      {
        studentRef: "SYN-0004", section: "B", mentorId: "mentor-02", priority: "MEDIUM", concern: 30,
        status: "AWAITING_MENTOR", signals: ["Attendance nearing threshold", "LMS activity declined"],
        recommendation: "Confirm workload constraints and agree a low-intensity mentor follow-up.", sources: BASE_SOURCES,
      },
      {
        studentRef: "SYN-0005", section: "B", mentorId: "mentor-02", priority: "DATA BLOCKED", concern: 0,
        status: "DATA_BLOCKED", signals: [], recommendation: "No recommendation permitted until LMS freshness is restored.",
        sources: BASE_SOURCES.map((source) => source.source === "LMS" ? { ...source, state: "STALE", detail: "Record exceeds freshness window", observed: "12 Aug 2026" } : source),
      },
      {
        studentRef: "SYN-0006", section: "B", mentorId: "mentor-02", priority: "LOW", concern: 15,
        status: "AWAITING_MENTOR", signals: ["Placement readiness item incomplete"],
        recommendation: "Confirm whether the readiness item is relevant before taking any action.", sources: BASE_SOURCES,
      },
    ],
    interventions: [],
    events: [
      { seq: 4, type: "PACKET_VALIDATED", actor: "runtime/validator", subject: "SYN-0002", state: "AWAITING_MENTOR", time: "02 Sep · 20:29" },
      { seq: 3, type: "DATA_GATE_BLOCKED", actor: "runtime/coordinator", subject: "SYN-0003", state: "DATA_BLOCKED", time: "02 Sep · 20:29" },
      { seq: 2, type: "SOURCES_COLLECTED", actor: "runtime/collectors", subject: "CSE-AI-SYNTHETIC", state: "COMPLETED", time: "02 Sep · 20:28" },
      { seq: 1, type: "COHORT_RUN_STARTED", actor: "operations/coordinator", subject: "CSE-AI-SYNTHETIC", state: "RUNNING", time: "02 Sep · 20:28" },
    ],
    runs: 1,
    lastRun: "02 Sep 2026 · 20:29 IST",
  };
}

export function getIdentity(identityId: string | null): Identity {
  const identity = IDENTITIES.find((item) => item.id === identityId);
  if (!identity) throw new Error("Unknown demo identity");
  return identity;
}

export function summarize(state: DemoState): StateSummary {
  return {
    studentsMonitored: state.cases.length,
    awaitingMentor: state.cases.filter((item) => item.status === "AWAITING_MENTOR").length,
    dataBlocked: state.cases.filter((item) => item.status === "DATA_BLOCKED").length,
    interventions: state.interventions.length,
    activeSupports: state.interventions.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)).length,
    eventCount: state.events.length,
    priorityCounts: {
      High: state.cases.filter((item) => item.priority === "HIGH").length,
      Medium: state.cases.filter((item) => item.priority === "MEDIUM").length,
      Low: state.cases.filter((item) => item.priority === "LOW").length,
      Blocked: state.cases.filter((item) => item.status === "DATA_BLOCKED").length,
    },
  };
}

export function scopeState(state: DemoState, identity: Identity, version: number): DemoState {
  const summary = summarize(state);
  let cases = state.cases;
  let interventions = state.interventions;
  let events = state.events;

  if (identity.role === "MENTOR") {
    cases = cases.filter((item) => item.mentorId === identity.mentorId);
    const refs = new Set(cases.map((item) => item.studentRef));
    interventions = interventions.filter((item) => item.ownerId === identity.mentorId);
    events = events.filter((item) => refs.has(item.subject) || item.subject === "CSE-AI-SEM6");
  } else if (identity.role === "STUDENT" || identity.role === "PARENT") {
    cases = cases.filter((item) => item.studentRef === identity.studentRef);
    interventions = interventions.filter((item) => item.studentRef === identity.studentRef);
    events = [];
  } else if (identity.role === "LEADERSHIP") {
    cases = [];
    interventions = [];
    events = [];
  }

  return { ...state, cases, interventions, events, summary, version, persistence: "postgres" };
}

export function eventTime(): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export function appendEvent(state: DemoState, event: Omit<AuditEvent, "seq" | "time">): void {
  const seq = Math.max(0, ...state.events.map((item) => item.seq)) + 1;
  state.events.unshift({ ...event, seq, time: eventTime() });
  state.events = state.events.slice(0, 160);
}
