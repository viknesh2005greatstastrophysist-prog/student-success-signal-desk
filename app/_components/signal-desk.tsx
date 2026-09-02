"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  FileCheck2,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Network,
  Play,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Role = "OPERATIONS" | "MENTOR" | "LEADERSHIP" | "STUDENT" | "PARENT";
type PageId =
  | "ecosystem"
  | "command"
  | "mentor"
  | "interventions"
  | "student"
  | "parent"
  | "leadership"
  | "operations"
  | "governance";
type CaseStatus = "AWAITING_MENTOR" | "DATA_BLOCKED" | "CLOSED";
type Priority = "HIGH" | "MEDIUM" | "LOW" | "DATA BLOCKED";
type InterventionStatus = "PLANNED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

type Identity = {
  id: string;
  label: string;
  role: Role;
  mentorId?: string;
  studentRef?: string;
};

type SourceRecord = {
  source: "Academic" | "LMS" | "Internship" | "Placement";
  state: "PRESENT" | "MISSING" | "STALE" | "NOT APPLICABLE";
  detail: string;
  observed: string;
};

type StudentCase = {
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

type Intervention = {
  id: string;
  studentRef: string;
  ownerId: string;
  support: string;
  rationale: string;
  status: InterventionStatus;
  due: string;
  outcome: string;
};

type AuditEvent = {
  seq: number;
  type: string;
  actor: string;
  subject: string;
  state: string;
  time: string;
  runId?: string;
  eventId?: string;
};

type ViewerProfile = { role: Role; displayName: string; mentorId?: string; studentRef?: string; canPreview: boolean };
type LineageRecord = {
  caseId: string; runId: string; collectionRunId: string; snapshotId: string; policyVersionId: string;
  modelRunId?: string; artifactVersionId?: string; criticArtifactId?: string; repairArtifactId?: string;
  replayId: string; status: string;
};
type UserProfileSummary = { userId: string; role: Role; displayName: string; mentorId?: string; studentRef?: string };
type ReplayReceipt = { replayId: string; runId: string; artifactsVerified: number; eventsReconstructed: number; verifiedAt: string };

type StateSummary = {
  studentsMonitored: number;
  awaitingMentor: number;
  dataBlocked: number;
  interventions: number;
  activeSupports: number;
  eventCount: number;
  priorityCounts: { High: number; Medium: number; Low: number; Blocked: number };
};

type DemoState = {
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

const IDENTITIES: Identity[] = [
  { id: "operations", label: "AURA Operations", role: "OPERATIONS" },
  { id: "mentor-01", label: "Faculty Mentor 01", role: "MENTOR", mentorId: "mentor-01" },
  { id: "mentor-02", label: "Faculty Mentor 02", role: "MENTOR", mentorId: "mentor-02" },
  { id: "hod", label: "Head of Department", role: "LEADERSHIP" },
  { id: "dean", label: "Dean of Student Affairs", role: "LEADERSHIP" },
  { id: "student-01", label: "Synthetic Student 0001", role: "STUDENT", studentRef: "SYN-0001" },
  { id: "student-02", label: "Synthetic Student 0002", role: "STUDENT", studentRef: "SYN-0002" },
  { id: "parent-02", label: "Parent of Synthetic Student 0002", role: "PARENT", studentRef: "SYN-0002" },
];

const PAGE_LABELS: Record<PageId, string> = {
  ecosystem: "Ecosystem Map",
  command: "Command Centre",
  mentor: "Mentor Workspace",
  interventions: "Interventions",
  student: "Student Portal",
  parent: "Parent Portal",
  leadership: "Leadership Cockpit",
  operations: "Agent Operations",
  governance: "Governance",
};

const ROLE_PAGES: Record<Role, PageId[]> = {
  OPERATIONS: ["ecosystem", "command", "operations", "governance"],
  MENTOR: ["ecosystem", "command", "mentor", "interventions"],
  LEADERSHIP: ["ecosystem", "leadership", "governance"],
  STUDENT: ["student"],
  PARENT: ["parent"],
};

const PAGE_ICONS: Record<PageId, typeof LayoutDashboard> = {
  ecosystem: Network,
  command: LayoutDashboard,
  mentor: UserRoundCheck,
  interventions: HeartHandshake,
  student: GraduationCap,
  parent: UsersRound,
  leadership: Activity,
  operations: Bot,
  governance: ShieldCheck,
};

const BASE_SOURCES: SourceRecord[] = [
  { source: "Academic", state: "PRESENT", detail: "CIE and credit record received", observed: "02 Sep 2026" },
  { source: "LMS", state: "PRESENT", detail: "Activity window received", observed: "01 Sep 2026" },
  { source: "Internship", state: "NOT APPLICABLE", detail: "No active internship window", observed: "Policy-defined" },
  { source: "Placement", state: "PRESENT", detail: "Readiness record received", observed: "30 Aug 2026" },
];

const INITIAL_STATE: DemoState = {
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
      sources: BASE_SOURCES.map((s) => s.source === "Academic" ? { ...s, state: "MISSING", detail: "Required record unavailable", observed: "Not supplied" } : s),
    },
    {
      studentRef: "SYN-0004", section: "B", mentorId: "mentor-02", priority: "MEDIUM", concern: 30,
      status: "AWAITING_MENTOR", signals: ["Attendance nearing threshold", "LMS activity declined"],
      recommendation: "Confirm workload constraints and agree a low-intensity mentor follow-up.", sources: BASE_SOURCES,
    },
    {
      studentRef: "SYN-0005", section: "B", mentorId: "mentor-02", priority: "DATA BLOCKED", concern: 0,
      status: "DATA_BLOCKED", signals: [], recommendation: "No recommendation permitted until LMS freshness is restored.",
      sources: BASE_SOURCES.map((s) => s.source === "LMS" ? { ...s, state: "STALE", detail: "Record exceeds freshness window", observed: "12 Aug 2026" } : s),
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

const PIPELINE = [
  ["01", "Authorised intake", "gate"], ["02", "Four collectors", "agent"],
  ["03", "Policy analysis", "agent"], ["04", "Packet composer", "agent"],
  ["05", "Validate + repair", "agent"], ["06", "Mentor decision", "human"],
  ["07", "Support ledger", "human"],
];

function summarize(state: DemoState): StateSummary {
  return state.summary ?? {
    studentsMonitored: state.cases.length,
    awaitingMentor: state.cases.filter(c => c.status === "AWAITING_MENTOR").length,
    dataBlocked: state.cases.filter(c => c.status === "DATA_BLOCKED").length,
    interventions: state.interventions.length,
    activeSupports: state.interventions.filter(i => !["COMPLETED", "CANCELLED"].includes(i.status)).length,
    eventCount: state.events.length,
    priorityCounts: {
      High: state.cases.filter(c => c.priority === "HIGH").length,
      Medium: state.cases.filter(c => c.priority === "MEDIUM").length,
      Low: state.cases.filter(c => c.priority === "LOW").length,
      Blocked: state.cases.filter(c => c.status === "DATA_BLOCKED").length,
    },
  };
}

function Metric({ label, value, note, tone = "ink" }: { label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function PageHeader({ eyebrow, title, copy, identity }: { eyebrow: string; title: string; copy: string; identity: Identity }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><div className="red-rule" /><p className="lede">{copy}</p></div>
      <div className="identity-stamp"><span>Viewing as</span><strong>{identity.label}</strong><small>{identity.role}</small></div>
    </header>
  );
}

function Pipeline() {
  return (
    <div className="pipeline" aria-label="Agentic workflow">
      {PIPELINE.map(([number, label, kind], index) => (
        <div className="pipeline-pair" key={number}>
          <div className={`pipeline-node ${kind}`}><span>{number}</span><strong>{label}</strong></div>
          {index < PIPELINE.length - 1 && <ArrowRight aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone = value.includes("BLOCK") || value === "HIGH" || value === "MISSING" || value === "STALE" ? "danger"
    : value === "CLOSED" || value === "PRESENT" || value === "COMPLETED" ? "good" : "neutral";
  return <span className={`status-pill ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

function Bar({ label, value, max = 6, coral = false }: { label: string; value: number; max?: number; coral?: boolean }) {
  return <div className="bar-row"><span>{label}</span><div className="bar-track"><div className={coral ? "bar coral" : "bar"} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div><b>{value}</b></div>;
}

function EcosystemView({ state, identity }: { state: DemoState; identity: Identity }) {
  const summary = summarize(state);
  return <>
    <PageHeader eyebrow="KLE TECH · STUDENT SUCCESS OPERATING SYSTEM" title="Evidence before intervention." copy="A governed ecosystem joins fragmented academic signals, agentic case preparation, human decisions, support delivery, and accountable oversight." identity={identity} />
    <div className="metrics-grid">
      <Metric label="Students monitored" value={String(summary.studentsMonitored).padStart(2, "0")} note="shared synthetic cohort" />
      <Metric label="Awaiting mentor" value={summary.awaitingMentor} note="human gate" tone="red" />
      <Metric label="Data blocked" value={summary.dataBlocked} note="no inference allowed" tone="amber" />
      <Metric label="Interventions" value={summary.interventions} note="approved only" tone="green" />
    </div>
    <section className="section"><div className="section-heading"><span>01</span><div><p>OPERATING MODEL</p><h2>The agent works. The mentor decides.</h2></div></div><Pipeline /></section>
    <div className="surface-grid">
      {[
        ["Faculty", "Mentor workspace", "Inspect source evidence, edit recommendations, approve or reject, then own delivery."],
        ["Students", "Private support portal", "See only approved support and source status. No peer ranking or predictive label."],
        ["Parents", "Ward support view", "See attendance and approved support context without confidential mentor notes."],
        ["HoD / Dean", "Leadership cockpit", "See aggregate workload, quality, and outcomes without student-level drill-down."],
      ].map(([kicker, title, copy]) => <article className="surface-card" key={kicker}><p>{kicker}</p><h3>{title}</h3><span>{copy}</span><ChevronRight /></article>)}
    </div>
    <div className="truth-boundary"><ShieldCheck /><div><strong>Reality boundary</strong><p>All identities, records, connectors, thresholds, and outcomes are synthetic. Authentication, server role enforcement, shared Postgres persistence, and the bounded model workflow are real. This is not connected to KLE or Contineo.</p></div></div>
  </>;
}

function CommandView({ state, identity, cases }: { state: DemoState; identity: Identity; cases: StudentCase[] }) {
  const active = state.interventions.filter(i => i.status !== "COMPLETED" && i.status !== "CANCELLED").length;
  return <>
    <PageHeader eyebrow="ODD TERM 2026 · LIVE COHORT SNAPSHOT" title="See the work before it becomes late." copy="Prioritise faculty review without pretending a policy index is a prediction. Every row resolves to source evidence and a human-owned action." identity={identity} />
    <div className="metrics-grid">
      <Metric label="Students in scope" value={cases.length} note="latest case per student" />
      <Metric label="High priority" value={cases.filter(c => c.priority === "HIGH").length} note="fictional policy" tone="red" />
      <Metric label="Awaiting review" value={cases.filter(c => c.status === "AWAITING_MENTOR").length} note="decision required" tone="amber" />
      <Metric label="Active supports" value={active} note="approved ledger items" tone="green" />
    </div>
    <div className="split-layout section">
      <div className="panel"><div className="panel-head"><div><p>PRIORITY WORKLIST</p><h2>Current cases</h2></div><ScanLine /></div>
        <div className="table-wrap"><table><thead><tr><th>Student</th><th>Section</th><th>Priority</th><th>Index</th><th>Signals</th><th>Workflow</th></tr></thead><tbody>
          {cases.map(c => <tr key={c.studentRef}><td><b>{c.studentRef}</b></td><td>{c.section}</td><td><StatusPill value={c.priority} /></td><td className="index-cell">{String(c.concern).padStart(2, "0")}</td><td>{c.signals.length}</td><td><StatusPill value={c.status} /></td></tr>)}
        </tbody></table></div>
      </div>
      <div className="panel"><div className="panel-head"><div><p>SIGNAL LOAD</p><h2>By source</h2></div><Activity /></div>
        <Bar label="Academic" value={4} coral /><Bar label="LMS" value={3} coral /><Bar label="Internship" value={1} coral /><Bar label="Placement" value={2} coral />
        <div className="info-box"><b>Concern index</b><p>15 points per signal plus a 20-point critical bonus, capped at 100. A sorting aid, not failure probability.</p></div>
      </div>
    </div>
  </>;
}

function MentorView({ state, identity, canAct, onApprove, onReject, onCorrect }: { state: DemoState; identity: Identity; canAct: boolean; onApprove: (ref: string) => void; onReject: (ref: string) => void; onCorrect: (ref: string) => void }) {
  const assigned = state.cases.filter(c => c.mentorId === identity.mentorId);
  const [selectedRef, setSelectedRef] = useState(assigned[0]?.studentRef ?? "");
  const selected = assigned.find(c => c.studentRef === selectedRef) ?? assigned[0];
  if (!selected) return null;
  return <>
    <PageHeader eyebrow="FACULTY MENTOR PORTAL" title="Review the evidence. Own the decision." copy="The agent may collect, compose, challenge, and repair. It cannot approve support, contact a student, or conceal missing evidence." identity={identity} />
    <div className="student-strip"><div className="avatar">{selected.studentRef.slice(-2)}</div><div><span>SYNTHETIC STUDENT</span><strong>{selected.studentRef}</strong></div><div><span>SECTION</span><strong>{selected.section}</strong></div><div><span>MENTOR</span><strong>{selected.mentorId}</strong></div><select value={selected.studentRef} onChange={e => setSelectedRef(e.target.value)} aria-label="Select assigned case">{assigned.map(c => <option key={c.studentRef}>{c.studentRef}</option>)}</select></div>
    <div className="metrics-grid compact"><Metric label="Priority" value={selected.priority} note="fictional policy" tone="red" /><Metric label="Concern index" value={String(selected.concern).padStart(2, "0")} note="not probability" /><Metric label="Signals" value={selected.signals.length} note="source-grounded" /><Metric label="State" value={selected.status.replaceAll("_", " ")} note="durable workflow" tone="green" /></div>
    <section className="section"><div className="section-heading"><span>01</span><div><p>SOURCE ENVELOPES</p><h2>Evidence gate</h2></div></div>
      <div className="source-grid">{selected.sources.map(source => <article className={`source-card ${source.state === "MISSING" || source.state === "STALE" ? "bad" : ""}`} key={source.source}><div><Database /><b>{source.source}</b></div><StatusPill value={source.state} /><p>{source.detail}</p><small>{source.observed}</small></article>)}</div>
    </section>
    <div className="split-layout section">
      <div className="panel"><div className="panel-head"><div><p>AGENT PACKET</p><h2>Evidence and recommendation</h2></div><FileCheck2 /></div>
        {selected.signals.length ? <ul className="signal-list">{selected.signals.map((s, i) => <li key={s}><span>{String(i + 1).padStart(2, "0")}</span>{s}</li>)}</ul> : <div className="blocked-message"><CircleAlert /> Drafting blocked because required evidence is unusable.</div>}
        <div className="recommendation"><p>PROPOSED SUPPORT</p><strong>{selected.recommendation}</strong><small>Generated from approved catalogue items. No diagnosis. No direct contact.</small></div>
      </div>
      <div className="panel decision-panel"><div className="panel-head"><div><p>HUMAN AUTHORITY</p><h2>Mentor decision</h2></div><ClipboardCheck /></div>
        <div className="validator"><CheckCircle2 /><div><strong>{selected.status === "DATA_BLOCKED" ? "Data gate active" : "Deterministic validation passed"}</strong><span>{selected.status === "DATA_BLOCKED" ? "No recommendation may proceed." : "Claims, citations, catalogue and prohibitions checked."}</span></div></div>
        {!canAct && <div className="info-box"><b>Read-only Operations preview</b><p>Server authorization prevents Operations from exercising mentor authority.</p></div>}
        {selected.status === "AWAITING_MENTOR" && <><label className="field-label" htmlFor="rationale">Decision rationale</label><textarea id="rationale" defaultValue="Evidence and uncertainty reviewed against the fictional policy." disabled={!canAct} /><div className="button-row"><button className="primary-button" disabled={!canAct} onClick={() => onApprove(selected.studentRef)}><Check />Approve support</button><button className="ghost-button" disabled={!canAct} onClick={() => onReject(selected.studentRef)}><X />Reject</button></div></>}
        {selected.status === "DATA_BLOCKED" && <button className="primary-button wide" disabled={!canAct} onClick={() => onCorrect(selected.studentRef)}><RefreshCcw />Submit synthetic correction</button>}
        {selected.status === "CLOSED" && <div className="closed-box"><CheckCircle2 /><div><strong>Case closed</strong><p>{selected.closedReason}</p></div></div>}
      </div>
    </div>
  </>;
}

function InterventionView({ state, identity, canAct, onAdvance, onCancel, onExport }: { state: DemoState; identity: Identity; canAct: boolean; onAdvance: (id: string) => void; onCancel: (id: string) => void; onExport: () => void }) {
  const items = state.interventions.filter(i => i.ownerId === identity.mentorId);
  return <>
    <PageHeader eyebrow="APPROVED SUPPORT LEDGER" title="Approval is the start, not the finish." copy="Track delivery and outcomes of mentor-approved support. This ledger records work; it does not contact students." identity={identity} />
    <div className="metrics-grid"><Metric label="All items" value={items.length} note="approved catalogue actions" /><Metric label="Planned" value={items.filter(i => i.status === "PLANNED").length} note="not scheduled" tone="amber" /><Metric label="In motion" value={items.filter(i => ["SCHEDULED", "IN_PROGRESS"].includes(i.status)).length} note="scheduled or active" tone="red" /><Metric label="Completed" value={items.filter(i => i.status === "COMPLETED").length} note="outcome logged" tone="green" /></div>
    <section className="panel section"><div className="panel-head"><div><p>INTERVENTION TRACKER</p><h2>Mentor-owned actions</h2></div><button className="ghost-button small" onClick={onExport}><Download />Export CSV</button></div>
      {!canAct && <div className="info-box"><b>Read-only Operations preview</b><p>Only the assigned authenticated mentor may change an intervention.</p></div>}
      {items.length === 0 ? <div className="empty-state"><HeartHandshake /><h3>No approved support yet</h3><p>Approve a case in the Mentor Workspace to create an intervention.</p></div> : <div className="intervention-grid">{items.map(item => <article className="intervention-card" key={item.id}><div className="intervention-top"><span>{item.id}</span><StatusPill value={item.status} /></div><h3>{item.support}</h3><p>{item.rationale}</p><dl><div><dt>Student</dt><dd>{item.studentRef}</dd></div><div><dt>Due</dt><dd>{item.due}</dd></div><div><dt>Outcome</dt><dd>{item.outcome}</dd></div></dl><div className="button-row"><button className="primary-button" disabled={!canAct || ["COMPLETED", "CANCELLED"].includes(item.status)} onClick={() => onAdvance(item.id)}><Play />Advance state</button><button className="ghost-button" disabled={!canAct || ["COMPLETED", "CANCELLED"].includes(item.status)} onClick={() => onCancel(item.id)}><XCircle />Cancel</button></div></article>)}</div>}
    </section>
  </>;
}

function StudentView({ state, identity }: { state: DemoState; identity: Identity }) {
  const record = state.cases.find(c => c.studentRef === identity.studentRef)!;
  const supports = state.interventions.filter(i => i.studentRef === identity.studentRef);
  const friendlyState = record.status === "CLOSED" ? "Support plan active" : record.status === "AWAITING_MENTOR" ? "Faculty review pending" : "Source update required";
  return <>
    <PageHeader eyebrow="STUDENT PORTAL · ODD TERM 2026" title="Your academic support space." copy="A private view of source freshness and faculty-approved support. This page never displays peer rankings or a predictive risk label." identity={identity} />
    <div className="student-strip portal"><div className="avatar">{record.studentRef.slice(-2)}</div><div><span>STUDENT REFERENCE</span><strong>{record.studentRef}</strong></div><div><span>DEPARTMENT</span><strong>CS (Artificial Intelligence)</strong></div><div><span>SEMESTER</span><strong>Semester 7</strong></div><div className="credit-badge"><span>REGISTERED</span><strong>15.00</strong><small>CREDITS</small></div></div>
    <div className="metrics-grid"><Metric label="Review status" value={friendlyState} note="private to this identity" tone="green" /><Metric label="Registered credits" value="15.00" note="synthetic academic record" /><Metric label="Attendance" value="Below policy line" note="illustrative status" tone="red" /><Metric label="Approved supports" value={supports.length} note="mentor-authorised only" tone="amber" /></div>
    <div className="split-layout section"><div className="panel"><div className="panel-head"><div><p>DATA TRANSPARENCY</p><h2>What the system received</h2></div><Eye /></div><div className="source-list">{record.sources.map(s => <div key={s.source}><span>{s.source}</span><StatusPill value={s.state} /><small>{s.observed}</small></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><p>SUPPORT PLAN</p><h2>Approved help</h2></div><HeartHandshake /></div>{supports.length ? supports.map(s => <div className="support-item" key={s.id}><CheckCircle2 /><div><strong>{s.support}</strong><p>{s.status.replaceAll("_", " ")} · due {s.due}</p></div></div>) : <div className="empty-state compact"><LockKeyhole /><p>No support action is visible until a faculty mentor approves it.</p></div>}</div>
    </div>
  </>;
}

function ParentView({ state, identity }: { state: DemoState; identity: Identity }) {
  const record = state.cases.find(c => c.studentRef === identity.studentRef)!;
  const supports = state.interventions.filter(i => i.studentRef === identity.studentRef);
  return <>
    <PageHeader eyebrow="PARENT PORTAL · ODD TERM 2026" title="Academic visibility, with privacy intact." copy="Attendance, marks, registration, and approved support status for one synthetic ward. Confidential mentor notes remain restricted." identity={identity} />
    <div className="metrics-grid"><Metric label="Ward" value={record.studentRef} note="synthetic identity" /><Metric label="Registered credits" value="15.00" note="five course selections" tone="green" /><Metric label="Attendance" value="Attention" note="below illustrative threshold" tone="red" /><Metric label="Fee status" value="Paid" note="synthetic record" tone="green" /></div>
    <div className="split-layout section"><div className="panel"><div className="panel-head"><div><p>ACADEMIC SNAPSHOT</p><h2>Course standing</h2></div><GraduationCap /></div><div className="course-list">{["Senior Design Project", "Constitution of India", "Agentic AI", "Cryptography and Network Security"].map((course, i) => <div key={course}><span><b>{course}</b><small>{i % 2 ? "CIE recorded" : "Attendance attention"}</small></span><StatusPill value={i % 2 ? "PRESENT" : "ATTENTION"} /></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><p>STUDENT SUPPORT</p><h2>Approved status</h2></div><HeartHandshake /></div>{supports.length ? supports.map(s => <div className="support-item" key={s.id}><CheckCircle2 /><div><strong>{s.support}</strong><p>{s.status.replaceAll("_", " ")} · due {s.due}</p></div></div>) : <div className="info-box"><b>Faculty review in progress</b><p>No intervention or sensitive note is shared before mentor approval.</p></div>}<div className="privacy-note"><LockKeyhole /> Parents do not see faculty free-text notes, peer comparisons, or a risk score.</div></div>
    </div>
  </>;
}

function LeadershipView({ state, identity }: { state: DemoState; identity: Identity }) {
  const summary = summarize(state);
  const priorityCounts = summary.priorityCounts;
  return <>
    <PageHeader eyebrow="DEPARTMENT LEADERSHIP · AGGREGATE ONLY" title="See the system. Not the student file." copy="Department-level workload, signal patterns, data quality, and intervention delivery without personal identifiers or mentor notes." identity={identity} />
    <div className="metrics-grid"><Metric label="Cohort coverage" value="100%" note={`${summary.studentsMonitored} synthetic records`} tone="green" /><Metric label="Awaiting mentor" value={summary.awaitingMentor} note="faculty workload" tone="red" /><Metric label="Blocked records" value={priorityCounts.Blocked} note="quality remediation" tone="amber" /><Metric label="Supports active" value={summary.activeSupports} note="approved actions" /></div>
    <div className="split-layout section"><div className="panel"><div className="panel-head"><div><p>CONCERN DISTRIBUTION</p><h2>Latest cohort state</h2></div><Activity /></div>{Object.entries(priorityCounts).map(([label, value]) => <Bar key={label} label={label} value={value} max={3} coral={label === "High" || label === "Blocked"} />)}</div>
      <div className="panel"><div className="panel-head"><div><p>CONNECTOR QUALITY</p><h2>Coverage and attention</h2></div><Database /></div><div className="quality-grid">{[["Academic", "83%", "1 missing"], ["LMS", "83%", "1 stale"], ["Internship", "100%", "N/A respected"], ["Placement", "100%", "Current"]].map(([name, coverage, note]) => <div key={name}><span>{name}</span><b>{coverage}</b><small>{note}</small></div>)}</div></div></div>
    <div className="truth-boundary"><LockKeyhole /><div><strong>Leadership privacy control</strong><p>This surface contains no student references, case identifiers, evidence text, or mentor notes.</p></div></div>
  </>;
}

function OperationsView({ state, identity, onRun, onReplay, onAssign, running }: { state: DemoState; identity: Identity; onRun: () => void; onReplay: () => void; onAssign: (userId: string, role: Role, mentorId?: string, studentRef?: string) => void; running: boolean }) {
  return <>
    <PageHeader eyebrow="AURA CONTROL ROOM" title="Observe every agent. Trust none blindly." copy="Inspect the orchestration graph, connector health, retries, blocked work, and immutable run evidence." identity={identity} />
    <div className="operations-hero"><div><p>LAST SYNTHETIC COHORT RUN</p><h2>{state.lastRun}</h2><span>{state.runs} durable run record{state.runs === 1 ? "" : "s"} · Postgres version {state.version ?? 0} · {state.agentMode === "governed-llm" ? `bounded LLM ${state.modelId}` : "deterministic fallback"}</span></div><div className="button-row"><button className="ghost-button light" onClick={onReplay} disabled={running || !state.latestRunId}><RefreshCcw />Verify replay</button><button className="primary-button" onClick={onRun} disabled={running}>{running ? <RefreshCcw className="spin" /> : <Play />}{running ? "Agents running" : "Run synthetic cycle"}</button></div></div>
    <section className="section"><div className="section-heading"><span>01</span><div><p>AGENT GRAPH</p><h2>Bounded autonomy</h2></div></div><Pipeline /></section>
    <div className="split-layout section"><div className="panel"><div className="panel-head"><div><p>CONNECTOR HEALTH</p><h2>Simulated sources</h2></div><Database /></div><div className="connector-grid">{[["Contineo Academic", "5/6", "1 missing"], ["Learning Management", "5/6", "1 stale"], ["Internship Cell", "6/6", "healthy"], ["Placement Cell", "6/6", "healthy"]].map(([name, count, note], i) => <div key={name}><span className={i < 2 ? "dot amber" : "dot"} /><div><b>{name}</b><small>Simulated connector</small></div><strong>{count}</strong><em>{note}</em></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><p>EVENT REPLAY</p><h2>Recent audit trail</h2></div><ClipboardCheck /></div>{state.lastReplay && <div className="validator"><CheckCircle2 /><div><strong>{state.lastReplay.artifactsVerified} artifacts verified</strong><span>{state.lastReplay.replayId} · model was not rerun</span></div></div>}<div className="timeline">{state.events.slice(0, 7).map(event => <div className="event" key={`${event.seq}-${event.time}`}><span>#{String(event.seq).padStart(2, "0")}</span><div><b>{event.type.replaceAll("_", " ")}</b><small>{event.actor} · {event.subject}</small></div><StatusPill value={event.state} /></div>)}</div></div></div>
    <section className="panel section"><div className="panel-head"><div><p>TRACEABLE LINEAGE</p><h2>Latest run identifiers</h2></div><FileCheck2 /></div><div className="lineage-grid">{(state.lineage ?? []).map(item => <article key={item.caseId}><b>{item.caseId}</b><span>{item.status.replaceAll("_", " ")}</span><code>{item.collectionRunId}</code><code>{item.snapshotId}</code><code>{item.policyVersionId}</code><code>{item.modelRunId ?? "MODEL-BLOCKED"}</code><code>{item.artifactVersionId ?? "ARTIFACT-BLOCKED"}</code><code>{item.replayId}</code></article>)}</div></section>
    <section className="panel section"><div className="panel-head"><div><p>SERVER ROLE PROVISIONING</p><h2>Authenticated prototype accounts</h2></div><LockKeyhole /></div><p className="muted-copy">A new account starts as Student. Operations may assign a synthetic role after that account signs in once. Every change is appended to the audit ledger.</p><div className="profile-grid">{(state.userProfiles ?? []).map(profile => <article key={profile.userId}><div><b>{profile.displayName}</b><code>{profile.userId.slice(0, 10)}…</code></div><StatusPill value={profile.role} />{profile.role !== "OPERATIONS" && <div className="role-buttons"><button onClick={() => onAssign(profile.userId, "MENTOR", "mentor-01")}>Mentor 01</button><button onClick={() => onAssign(profile.userId, "STUDENT", undefined, "SYN-0002")}>Student 02</button><button onClick={() => onAssign(profile.userId, "PARENT", undefined, "SYN-0002")}>Parent 02</button><button onClick={() => onAssign(profile.userId, "LEADERSHIP")}>Leadership</button></div>}</article>)}</div></section>
  </>;
}

function GovernanceView({ state, identity, onExport }: { state: DemoState; identity: Identity; onExport: () => void }) {
  const summary = summarize(state);
  const controls = [
    ["Deterministic policy", "priority + reason codes", "ENFORCED"], ["Evidence citations", "field-level provenance", "ENFORCED"],
    ["Validation loop", "one bounded repair", "ENFORCED"], ["Mentor interrupt", "approval before action", "ENFORCED"],
    ["Direct contact", "agent cannot message students", "PROHIBITED"], ["Diagnosis", "no medical or predictive claims", "PROHIBITED"],
  ];
  return <>
    <PageHeader eyebrow="POLICY · PERMISSIONS · AUDIT" title="Governance is part of the runtime." copy="The system exposes what the model may do, what it cannot do, who has authority, and what can be replayed after a decision." identity={identity} />
    <div className="governance-banner"><ShieldCheck /><div><p>ACTIVE POLICY</p><h2>demo-policy-v1</h2><span>Synthetic scope · mentor required · direct student contact disabled</span></div><button className="ghost-button light" onClick={onExport}><Download />Download audit package</button></div>
    <section className="section"><div className="control-grid">{controls.map(([title, copy, status]) => <article key={title}><div><b>{title}</b><p>{copy}</p></div><StatusPill value={status} /></article>)}</div></section>
    <div className="split-layout section"><div className="panel"><div className="panel-head"><div><p>ROLE MATRIX</p><h2>Effective permissions</h2></div><LockKeyhole /></div><div className="table-wrap"><table><thead><tr><th>Role</th><th>Student detail</th><th>Decision</th><th>Aggregate</th></tr></thead><tbody><tr><td>Student</td><td>Own only</td><td>None</td><td>None</td></tr><tr><td>Parent</td><td>Ward summary</td><td>None</td><td>None</td></tr><tr><td>Mentor</td><td>Assigned</td><td>Approve / reject</td><td>Own workload</td></tr><tr><td>Leadership</td><td>None</td><td>None</td><td>Department</td></tr><tr><td>Coordinator</td><td>Operations</td><td>None</td><td>Cohort</td></tr></tbody></table></div></div>
      <div className="panel"><div className="panel-head"><div><p>MODEL BOUNDARY</p><h2>What “agentic” means here</h2></div><Bot /></div><ol className="boundary-list"><li><span>01</span>Collectors run independently over authorised synthetic sources.</li><li><span>02</span>Policy evaluation is deterministic and versioned.</li><li><span>03</span>The model composes only evidence-bound case language.</li><li><span>04</span>Validators reject unsupported or prohibited content.</li><li><span>05</span>A faculty mentor remains the sole decision authority.</li></ol></div></div>
    <p className="record-count">Current shared demonstration ledger: {summary.eventCount} append-only events · {summary.interventions} interventions · {state.runs} cohort runs · Postgres version {state.version ?? 0} · {state.agentMode === "governed-llm" ? `model ${state.modelId}` : "model fallback active"}.</p>
  </>;
}

export function SignalDesk() {
  const { user } = useUser();
  const [identityId, setIdentityId] = useState("operations");
  const [page, setPage] = useState<PageId>("ecosystem");
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Connecting to the shared ecosystem ledger…");
  const [mobileNav, setMobileNav] = useState(false);

  const identity = state.activeIdentity ?? IDENTITIES.find(item => item.id === identityId) ?? IDENTITIES[0];
  const allowedPages = ROLE_PAGES[identity.role];
  const scopedCases = useMemo(() => identity.role === "MENTOR" ? state.cases.filter(c => c.mentorId === identity.mentorId) : state.cases, [identity, state.cases]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ecosystem?view=${encodeURIComponent(identityId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The ecosystem ledger could not be loaded");
        return body as DemoState;
      })
      .then(nextState => {
        setState(nextState);
        if (nextState.activeIdentity) {
          setIdentityId(nextState.activeIdentity.id);
          setPage(current => ROLE_PAGES[nextState.activeIdentity!.role].includes(current) ? current : ROLE_PAGES[nextState.activeIdentity!.role][0]);
        }
        setHydrated(true);
        setMessage(`Shared Postgres state loaded · version ${nextState.version ?? 0}`);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHydrated(true);
        setMessage(error instanceof Error ? error.message : "The ecosystem ledger could not be loaded");
      });
    return () => controller.abort();
  }, [identityId]);

  function switchIdentity(id: string) {
    const next = (state.availableIdentities ?? IDENTITIES).find(item => item.id === id) ?? IDENTITIES[0];
    setHydrated(false);
    setIdentityId(id); setPage(ROLE_PAGES[next.role][0]); setMobileNav(false);
    setMessage(`Loading the server-authorised ${next.label} view…`);
  }

  async function mutate(action: string, subject?: string, rationale?: string) {
    const response = await fetch("/api/ecosystem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestedIdentityId: identityId, subject, rationale, idempotencyKey: `${action}:${crypto.randomUUID()}` }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The server rejected this action");
    setState(body as DemoState);
    return body as DemoState;
  }

  async function approveCase(ref: string) {
    try {
      await mutate("approve", ref, "Evidence and uncertainty reviewed against the fictional policy.");
      setMessage(`${ref} approved. Support plan committed atomically to Postgres.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Approval failed"); }
  }

  async function rejectCase(ref: string) {
    try {
      await mutate("reject", ref);
      setMessage(`${ref} rejected. No intervention was created.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rejection failed"); }
  }

  async function correctCase(ref: string) {
    try {
      await mutate("correct", ref);
      setMessage(`${ref} corrected, versioned, and returned to mentor review.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Correction failed"); }
  }

  async function advanceIntervention(id: string) {
    try { await mutate("advance", id); setMessage(`${id} advanced in the shared support ledger.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Status update failed"); }
  }
  async function cancelIntervention(id: string) {
    try { await mutate("cancel", id); setMessage(`${id} cancelled with a durable audit event.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation failed"); }
  }

  async function runCycle() {
    setRunning(true); setMessage("Server agents are collecting, normalising, evaluating, composing, validating, and opening human interrupts…");
    try {
      const nextState = await mutate("run_cycle");
      setMessage(`Agent cycle committed · run ${nextState.runs} · ${nextState.summary?.dataBlocked ?? 0} records blocked safely.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Agent cycle failed"); }
    finally { setRunning(false); }
  }

  async function verifyReplay() {
    setRunning(true); setMessage("Reconstructing the latest run from immutable artifacts without rerunning the model…");
    try {
      const nextState = await mutate("replay");
      setMessage(`Replay verified · ${nextState.lastReplay?.artifactsVerified ?? 0} artifact hashes · ${nextState.lastReplay?.eventsReconstructed ?? 0} events.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Replay failed"); }
    finally { setRunning(false); }
  }

  async function assignAccountRole(userId: string, role: Role, mentorId?: string, studentRef?: string) {
    setRunning(true);
    try {
      const response = await fetch("/api/ecosystem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_role", requestedIdentityId: identityId, targetUserId: userId, role, mentorId, studentRef, rationale: "Operations-approved synthetic prototype assignment", idempotencyKey: `assign:${crypto.randomUUID()}` }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Role assignment failed");
      setState(body as DemoState);
      setMessage(`${role} role assigned server-side and written to the append-only role ledger.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Role assignment failed"); }
    finally { setRunning(false); }
  }

  function download(name: string, content: string, type: string) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  function exportAudit() { download("aura-synthetic-audit.json", JSON.stringify(state, null, 2), "application/json"); setMessage("Synthetic audit package exported."); }
  function exportInterventions() { const rows = ["id,student_ref,owner,status,due,outcome", ...state.interventions.map(i => [i.id, i.studentRef, i.ownerId, i.status, i.due, i.outcome].join(","))]; download("aura-interventions.csv", rows.join("\n"), "text/csv"); setMessage("Intervention ledger exported."); }
  async function resetDemo() {
    setRunning(true);
    try { await mutate("reset"); setMessage("Shared synthetic state reset and audit event committed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Reset failed"); }
    finally { setRunning(false); }
  }

  const content = page === "ecosystem" ? <EcosystemView state={state} identity={identity} />
    : page === "command" ? <CommandView state={state} identity={identity} cases={scopedCases} />
    : page === "mentor" ? <MentorView state={state} identity={identity} canAct={state.viewer?.role === "MENTOR" && state.viewer.mentorId === identity.mentorId} onApprove={approveCase} onReject={rejectCase} onCorrect={correctCase} />
    : page === "interventions" ? <InterventionView state={state} identity={identity} canAct={state.viewer?.role === "MENTOR" && state.viewer.mentorId === identity.mentorId} onAdvance={advanceIntervention} onCancel={cancelIntervention} onExport={exportInterventions} />
    : page === "student" ? <StudentView state={state} identity={identity} />
    : page === "parent" ? <ParentView state={state} identity={identity} />
    : page === "leadership" ? <LeadershipView state={state} identity={identity} />
    : page === "operations" ? <OperationsView state={state} identity={identity} onRun={runCycle} onReplay={verifyReplay} onAssign={assignAccountRole} running={running} />
    : <GovernanceView state={state} identity={identity} onExport={exportAudit} />;

  return (
    <div className="app-shell">
      <aside className={mobileNav ? "sidebar open" : "sidebar"}>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X /></button>
        <div className="brand"><div className="brand-mark">KT</div><div><strong>KLE TECH</strong><span>Student Success Lab</span></div></div>
        <div className="prototype-tag"><span /> Authenticated prototype</div>
        {state.viewer?.canPreview ? <label className="role-select"><span>READ-ONLY SURFACE PREVIEW</span><select value={identityId} onChange={e => switchIdentity(e.target.value)}>{(state.availableIdentities ?? IDENTITIES).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select><small>Operations may inspect any projection. Mentor actions remain server-blocked.</small></label> : <div className="role-select"><span>SERVER-ASSIGNED ROLE</span><strong>{state.viewer?.role ?? identity.role}</strong><small>Changing the browser cannot elevate this account.</small></div>}
        <nav>{allowedPages.map(item => { const Icon = PAGE_ICONS[item]; return <button key={item} className={page === item ? "active" : ""} onClick={() => { setPage(item); setMobileNav(false); }}><Icon /><span>{PAGE_LABELS[item]}</span><ChevronRight /></button>; })}</nav>
        <div className="sidebar-bottom">{state.viewer?.role === "OPERATIONS" && <button onClick={resetDemo} disabled={running}><RefreshCcw />Reset synthetic demo</button>}<div><LockKeyhole /><span>Real Clerk session<br /><b>Server role · shared Postgres</b></span></div></div>
      </aside>
      <div className="workspace">
        <header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu /></button><div className="breadcrumb"><span>AURA</span><ChevronRight /><b>{PAGE_LABELS[page]}</b></div><div className="session"><span><i />SECURE SESSION</span><div><strong>{user?.firstName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Prototype user"}</strong><small>Clerk authenticated</small></div><UserButton /></div></header>
        <div className="notice-strip"><CircleAlert /><span>Synthetic academic demonstration · Not an official KLE Technological University service</span><b>{message}</b></div>
        <main className="content">{!hydrated && <div className="loading-ledger"><RefreshCcw className="spin" />Loading the shared ecosystem ledger…</div>}{hydrated && content}</main>
        <footer className="app-footer"><span>Copyright © AURA Student Success Prototype</span><span>Policy v1 · Synthetic data · Human authority retained</span></footer>
      </div>
    </div>
  );
}
