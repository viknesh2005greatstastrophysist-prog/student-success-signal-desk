"use client";

import type { PortalDefinition, PortalId } from "@aura/contracts";
import { useCallback, useEffect, useState } from "react";

type Person = { id: string; display_name: string; role: string; department_id: string | null };
type Activity = { id: string; type: string; resourceId: string; revision: number; payload: Record<string, unknown>; occurredAt: string };
type Offering = {
  id: string; code: string; title: string; status: string; revision: number; capacity: number; enrolment: number;
  department_code: string; faculty_person_id: string | null; faculty_name: string | null;
};
type CatalogueOffering = {
  id: string;
  code: string;
  title: string;
  status: string;
  capacity: number;
  enrolment: number;
  credits: number;
  faculty_name: string | null;
  registration_id: string | null;
  registration_status: string | null;
  prerequisites: string[];
  schedule: Array<{ weekday: number; startsAt: string; endsAt: string; room: string }>;
  eligible: boolean;
  reasons: string[];
};
type RosterStudent = { id: string; register_number: string; display_name: string; registered_at: string };
type AttendanceView = { code: string; title?: string; session_date: string; topic: string; status: string; revision?: number };
type MarkView = { code: string; title?: string; assessment: string; maximum_score: string; score: string; feedback: string; revision?: number };
type Classroom = {
  attendanceSession: { id: string; session_date: string; topic: string; status: string; revision: number } | null;
  assessment: { id: string; title: string; category: string; maximum_score: string; weight_percent: string; published: boolean; revision: number } | null;
};
type Snapshot = {
  actor: { role: PortalId; displayName: string; email: string };
  institutionRevision: number;
  offering: Offering | null;
  activity: Activity[];
  student?: { register_number: string; semester: number; department: string; fee_status: string; amount_paise: string; due_on: string };
  children?: Array<{ id: string; display_name: string; register_number: string; grants: string[] }>;
  availableFaculty?: Person[];
  departmentPeople?: Person[];
  assignableOffering?: Offering | null;
  registrationCatalogue?: CatalogueOffering[];
  roster?: RosterStudent[];
  classroom?: Classroom;
  academics?: { attendance: AttendanceView[]; marks: MarkView[] };
  childAcademics?: { studentId: string; grantedFields: string[]; attendance?: AttendanceView[]; marks?: MarkView[] };
  academicSummary?: { submitted_attendance: number; published_assessments: number };
};
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const navByPortal: Record<PortalId, string[]> = {
  student: ["Today", "Registration", "Academics", "Fees", "Support"],
  parent: ["Overview", "Children", "Fees", "Access"],
  faculty: ["Today", "Classrooms", "Gradebook", "Cases"],
  hod: ["Department", "Offerings", "People", "Cases"],
  governance: ["Operations", "Runs", "Evidence", "Simulation"],
};

function money(paise: string | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise ?? 0) / 100);
}

function ActivityRail({ activity }: { activity: Activity[] }) {
  const eventLabel: Record<string, string> = {
    "offering.published": "Offering published and faculty assigned",
    "registration.created": "Student registered and roster updated",
    "registration.withdrawn": "Student withdrew and seat was released",
    "attendance.submitted": "Faculty submitted the attendance register",
    "marks.published": "Faculty published assessed marks",
  };
  return (
    <aside className="activity-rail" aria-label="Causal activity">
      <div className="section-heading"><span>Live ledger</span><b>{activity.length}</b></div>
      {activity.length ? activity.map((event) => (
        <article className="activity-item" key={event.id}>
          <span className="event-node" aria-hidden="true" />
          <p>{eventLabel[event.type] ?? event.type.replaceAll(".", " ")}</p>
          <small>revision {event.revision} · {new Date(event.occurredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
          <code>{event.id.slice(0, 8)}</code>
        </article>
      )) : <p className="empty-copy">No cross-portal consequences yet. The ledger is quiet, not broken.</p>}
    </aside>
  );
}

function PortalMasthead({ portal, snapshot, refresh, signOut, refreshing, activeView, navigate }: {
  portal: PortalDefinition; snapshot: Snapshot; refresh: () => void; signOut: () => void; refreshing: boolean; activeView: string; navigate: (view: string) => void;
}) {
  const enabledViews: Partial<Record<PortalId, string[]>> = {
    student: ["Today", "Registration", "Academics"],
    parent: ["Overview", "Children"],
    faculty: ["Today", "Classrooms", "Gradebook"],
    hod: ["Department", "Offerings"],
  };
  return (
    <>
      <header className="portal-masthead">
        <div className="brand-lockup"><span className="brand-mark">A</span><span><b>AURA</b><small>{portal.name}</small></span></div>
        <nav aria-label="Portal sections">{navByPortal[portal.id].map((item) => enabledViews[portal.id]?.includes(item)
          ? <button type="button" className={activeView === item ? "active-nav" : ""} onClick={() => navigate(item)} key={item} data-action-id={`${portal.id}-open-${item.toLowerCase()}`}>{item}</button>
          : <span key={item}>{item}</span>)}</nav>
        <div className="session-tools">
          <button className="icon-button" type="button" onClick={refresh} disabled={refreshing} data-action-id={`${portal.id}-refresh`} aria-label="Refresh portal data">↻</button>
          <button className="profile-button" type="button" onClick={signOut} data-action-id={`${portal.id}-sign-out`} title="Sign out">
            <span>{snapshot.actor.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
            <span><b>{snapshot.actor.displayName}</b><small>Sign out</small></span>
          </button>
        </div>
      </header>
      <div className="revision-strip"><span>Institution revision</span><b>{String(snapshot.institutionRevision).padStart(3, "0")}</b><i>synthetic · live core</i></div>
    </>
  );
}

function StudentSurface({ snapshot }: { snapshot: Snapshot }) {
  const offering = snapshot.offering;
  return (
    <section className="role-surface student-surface">
      <div className="hero-copy"><p className="kicker">Thursday · semester {snapshot.student?.semester}</p><h1>Good morning,<br />Ananya.</h1><p>Your academic day, without the administrative archaeology.</p></div>
      <div className="metric-ribbon">
        <article><small>Next class</small><strong>09:00</strong><span>Machine Learning Foundations</span></article>
        <article><small>Fee status</small><strong>{snapshot.student?.fee_status ?? "clear"}</strong><span>{money(snapshot.student?.amount_paise)} due</span></article>
        <article><small>New offering</small><strong>{offering?.status ?? "pending"}</strong><span>{offering?.code} · {offering?.title}</span></article>
      </div>
      <article className="feature-card offering-card">
        <div><p className="kicker">Registration watch</p><h2>{offering?.code} / {offering?.title}</h2><p>{offering?.status === "published" ? "The HOD has published this offering. Registration can now open." : "This offering is still being prepared by the department."}</p></div>
        <span className={`status-stamp status-${offering?.status}`}>{offering?.status}</span>
      </article>
    </section>
  );
}

function StudentRegistrationSurface({ snapshot, refresh }: { snapshot: Snapshot; refresh: () => Promise<void> | void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const catalogue = snapshot.registrationCatalogue ?? [];
  const weekday = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  async function mutate(item: CatalogueOffering, action: "register" | "withdraw") {
    setPendingId(item.id); setMessage("");
    const endpoint = action === "register" ? "/api/bff/registrations" : `/api/bff/registrations/${item.registration_id}/withdraw`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: action === "register" ? JSON.stringify({ offeringId: item.id }) : "{}",
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) {
      setMessage(`${action === "register" ? "Registered" : "Withdrawn"}. Receipt ${result.data.receipt.eventId.slice(0, 8)} committed to the institutional ledger.`);
      setConfirmId(null);
      await refresh();
    } else setMessage(result.error.message);
    setPendingId(null);
  }

  return (
    <section className="role-surface registration-surface">
      <div className="registration-heading"><div><p className="kicker">Semester 7 / registration sheet</p><h1>Build your term.</h1></div><p>Eligibility is calculated by the Core. Published status, registration window, prerequisites, capacity, and timetable are checked again when you commit.</p></div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
      <div className="course-register" role="list">
        {catalogue.map((item) => {
          const registered = item.registration_status === "registered";
          const slot = item.schedule[0];
          return <article className="register-row" role="listitem" key={item.id} data-course={item.code}>
            <div className="register-code"><b>{item.code}</b><span>{item.credits} credits</span></div>
            <div className="register-course"><h2>{item.title}</h2><p>{item.faculty_name ?? "Faculty assignment pending"}</p><small>{slot ? `${weekday[slot.weekday]} ${slot.startsAt.slice(0, 5)} · ${slot.room}` : "Schedule pending"}</small></div>
            <div className="register-capacity"><span>{item.enrolment}/{item.capacity}</span><small>seats</small></div>
            <div className="register-decision">
              {registered ? <button type="button" onClick={() => void mutate(item, "withdraw")} disabled={pendingId === item.id} data-action-id="student-withdraw-registration">{pendingId === item.id ? "Withdrawing…" : "Withdraw"}</button>
                : confirmId === item.id ? <div className="confirm-actions"><button type="button" onClick={() => setConfirmId(null)} data-action-id="student-cancel-registration">Cancel</button><button type="button" onClick={() => void mutate(item, "register")} disabled={pendingId === item.id} data-action-id="student-confirm-registration">{pendingId === item.id ? "Registering…" : "Confirm"}</button></div>
                  : <button type="button" onClick={() => setConfirmId(item.id)} disabled={!item.eligible} data-action-id="student-start-registration">Register</button>}
              {!registered && item.reasons.length ? <small>{item.reasons.join(" · ")}</small> : <small className="eligible-copy">{registered ? "Active registration" : "Eligible to register"}</small>}
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}

function StudentAcademicsSurface({ snapshot }: { snapshot: Snapshot }) {
  const academics = snapshot.academics ?? { attendance: [], marks: [] };
  return (
    <section className="role-surface academic-surface">
      <div className="registration-heading"><div><p className="kicker">Published academic record</p><h1>Your work, in view.</h1></div><p>Attendance appears after faculty submission. Marks appear only after publication. Drafts and internal notes remain outside this portal.</p></div>
      <div className="academic-columns">
        <section><div className="section-heading"><span>Attendance record</span><b>{academics.attendance.length}</b></div>{academics.attendance.length ? academics.attendance.map((item) => <article key={`${item.code}-${item.session_date}`}><div><b>{item.code}</b><small>{item.topic}</small></div><time>{new Date(item.session_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</time><span className={`academic-status status-${item.status}`}>{item.status}</span></article>) : <p>No submitted attendance yet.</p>}</section>
        <section><div className="section-heading"><span>Published marks</span><b>{academics.marks.length}</b></div>{academics.marks.length ? academics.marks.map((item) => <article key={`${item.code}-${item.assessment}`}><div><b>{item.code}</b><small>{item.assessment}</small></div><strong>{item.score}<i>/{item.maximum_score}</i></strong><p>{item.feedback}</p></article>) : <p>No marks have been published yet.</p>}</section>
      </div>
    </section>
  );
}

function ParentSurface({ snapshot }: { snapshot: Snapshot }) {
  const child = snapshot.children?.[0];
  return (
    <section className="role-surface parent-surface">
      <div className="hero-copy"><p className="kicker">Family academic view</p><h1>What needs<br />your attention.</h1><p>Only the fields Ananya has permitted. No surveillance theatre.</p></div>
      <article className="child-card"><span className="portrait-token">AR</span><div><small>Linked student</small><h2>{child?.display_name ?? "No active link"}</h2><p>{child?.register_number}</p></div><span className="grant-count">{child?.grants.length ?? 0}<small>active grants</small></span></article>
      <div className="grant-grid">{child?.grants.map((grant) => <span key={grant}><i aria-hidden="true">✓</i>{grant}</span>)}</div>
    </section>
  );
}

function ParentAcademicsSurface({ snapshot }: { snapshot: Snapshot }) {
  const child = snapshot.children?.[0];
  const academics = snapshot.childAcademics;
  return (
    <section className="role-surface parent-record-surface">
      <div className="registration-heading"><div><p className="kicker">Granted child record</p><h1>{child?.display_name ?? "No active link"}</h1></div><p>This view is assembled from the active parent link on every request. Revoking a field removes it on the next refresh.</p></div>
      <div className="grant-grid parent-record-grants">{academics?.grantedFields.map((grant) => <span key={grant}><i aria-hidden="true">✓</i>{grant}</span>)}</div>
      <div className="academic-columns">
        {academics?.attendance ? <section><div className="section-heading"><span>Granted attendance</span><b>{academics.attendance.length}</b></div>{academics.attendance.map((item) => <article key={`${item.code}-${item.session_date}`}><div><b>{item.code}</b><small>{item.topic}</small></div><time>{new Date(item.session_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</time><span className={`academic-status status-${item.status}`}>{item.status}</span></article>)}</section> : <section className="revoked-panel"><p>Attendance access is not granted.</p></section>}
        {academics?.marks ? <section><div className="section-heading"><span>Granted marks</span><b>{academics.marks.length}</b></div>{academics.marks.map((item) => <article key={`${item.code}-${item.assessment}`}><div><b>{item.code}</b><small>{item.assessment}</small></div><strong>{item.score}<i>/{item.maximum_score}</i></strong><p>{item.feedback}</p></article>)}</section> : <section className="revoked-panel"><p>Marks access is not granted.</p></section>}
      </div>
    </section>
  );
}

function FacultySurface({ snapshot, activeView, refresh }: { snapshot: Snapshot; activeView: string; refresh: () => Promise<void> | void }) {
  const offering = snapshot.assignableOffering;
  const roster = snapshot.roster ?? [];
  const attendanceSession = snapshot.classroom?.attendanceSession;
  const assessment = snapshot.classroom?.assessment;
  const [attendance, setAttendance] = useState<Record<string, "present" | "absent" | "late" | "excused">>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"attendance" | "marks" | null>(null);
  const [message, setMessage] = useState("");

  async function submitRegister() {
    if (!attendanceSession || !roster.length) return;
    setPending("attendance"); setMessage("");
    const response = await fetch(`/api/bff/attendance-sessions/${attendanceSession.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: attendanceSession.revision, records: roster.map((student) => ({ studentId: student.id, status: attendance[student.id] ?? "present" })) }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) { setMessage(`Attendance submitted. Receipt ${result.data.receipt.eventId.slice(0, 8)}.`); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  async function submitMarks() {
    if (!assessment || !roster.length) return;
    setPending("marks"); setMessage("");
    const response = await fetch(`/api/bff/assessments/${assessment.id}/marks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: assessment.revision, marks: roster.map((student) => ({ studentId: student.id, score: Number(scores[student.id] ?? 82), feedback: "Clear reasoning and a well-bounded design." })) }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) { setMessage(`Marks published. Receipt ${result.data.receipt.eventId.slice(0, 8)}.`); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  return (
    <section className="role-surface faculty-surface">
      <div className="hero-copy"><p className="kicker">Faculty operations / 03 Sep</p><h1>Teaching desk.</h1><p>Assigned work only. Everything else stays behind the Core boundary.</p></div>
      <div className="faculty-board">
        <article><small>09:00 · assigned section</small><h2>{offering ? `${offering.code} ${offering.title}` : "Awaiting HOD assignment"}</h2><p>{offering ? `${offering.enrolment} students · CSE-401` : "The CS401 publication event will place the section here."}</p><span className={offering ? "signal-live" : "signal-waiting"}>{offering ? "ready" : "waiting"}</span></article>
        <article className="queue-card"><small>Registered students</small><strong>{String(roster.length).padStart(2, "0")}</strong><p>{offering ? "Live from the authoritative registration ledger." : "Nothing can be marked before assignment."}</p></article>
      </div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
      {activeView === "Classrooms" && offering ? <section className="roster-register attendance-register"><div className="section-heading"><span>{offering.code} / {attendanceSession?.topic ?? "attendance sheet"}</span><b>v{attendanceSession?.revision ?? 0}</b></div>{roster.length ? roster.map((student, index) => <article key={student.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{student.display_name}</b><code>{student.register_number}</code></div><label><span className="sr-only">Attendance for {student.display_name}</span><select value={attendance[student.id] ?? "present"} onChange={(event) => setAttendance((current) => ({ ...current, [student.id]: event.target.value as "present" | "absent" | "late" | "excused" }))} data-action-id="faculty-set-attendance"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></label><small>{attendanceSession?.status ?? "open"}</small></article>) : <p>No students have registered yet.</p>}<div className="register-toolbar"><p>Submitting increments the sheet version and publishes the result to authorized views.</p><button type="button" onClick={() => void submitRegister()} disabled={!roster.length || !attendanceSession || pending === "attendance"} data-action-id="faculty-submit-attendance">{pending === "attendance" ? "Submitting…" : attendanceSession?.status === "submitted" ? "Submit correction" : "Submit attendance"}</button></div></section> : null}
      {activeView === "Gradebook" && offering ? <section className="roster-register gradebook-register"><div className="section-heading"><span>{assessment?.title ?? "gradebook"} / maximum {assessment?.maximum_score ?? 0}</span><b>v{assessment?.revision ?? 0}</b></div>{roster.length ? roster.map((student, index) => <article key={student.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{student.display_name}</b><code>{student.register_number}</code></div><label><span className="sr-only">Score for {student.display_name}</span><input type="number" min="0" max={assessment?.maximum_score} value={scores[student.id] ?? "82"} onChange={(event) => setScores((current) => ({ ...current, [student.id]: event.target.value }))} data-action-id="faculty-enter-mark" /></label><small>{assessment?.published ? "published" : "draft"}</small></article>) : <p>No students have registered yet.</p>}<div className="register-toolbar"><p>Publishing makes these marks visible to the student and to parents with an active marks grant.</p><button type="button" onClick={() => void submitMarks()} disabled={!roster.length || !assessment || pending === "marks"} data-action-id="faculty-publish-marks">{pending === "marks" ? "Publishing…" : assessment?.published ? "Publish correction" : "Publish marks"}</button></div></section> : null}
    </section>
  );
}

function HodSurface({ snapshot, refresh }: { snapshot: Snapshot; refresh: () => Promise<void> | void }) {
  const offering = snapshot.offering;
  const faculty = snapshot.availableFaculty ?? [];
  const [facultyId, setFacultyId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selected = facultyId || faculty[0]?.id || "";

  async function publish() {
    if (!offering || !selected) return;
    setPending(true); setMessage("");
    const response = await fetch(`/api/bff/offerings/${offering.id}/publish-and-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ facultyPersonId: selected, expectedRevision: offering.revision }),
    });
    const result = await response.json() as ApiResult<unknown>;
    if (result.ok) { setMessage("Published. Every authorized portal now reads the same event."); await refresh(); }
    else setMessage(result.error.message);
    setPending(false);
  }

  return (
    <section className="role-surface hod-surface">
      <div className="hero-copy"><p className="kicker">CSE / department command</p><h1>Shape the<br />semester.</h1><p>Publish once. Let the consequences travel.</p></div>
      <article className="hod-command-card">
        <div className="course-monogram"><span>{offering?.code.slice(0, 2)}</span><b>{offering?.code.slice(2)}</b></div>
        <div className="course-copy"><small>Draft offering · section A</small><h2>{offering?.title}</h2><p>Capacity {offering?.capacity} · {offering?.enrolment} enrolled · revision {offering?.revision}</p></div>
        <div className="command-form">
          <label htmlFor="faculty-assignment">Assign faculty</label>
          <select id="faculty-assignment" value={selected} onChange={(event) => setFacultyId(event.target.value)} disabled={offering?.status === "published"} data-action-id="hod-select-faculty">
            {faculty.map((person) => <option value={person.id} key={person.id}>{person.display_name}</option>)}
          </select>
          <button type="button" onClick={publish} disabled={pending || offering?.status === "published" || !selected} data-action-id="hod-publish-and-assign">
            {pending ? "Publishing…" : offering?.status === "published" ? "Published" : "Publish + assign"}<span aria-hidden="true">→</span>
          </button>
        </div>
      </article>
      <div className="hod-academic-strip"><article><small>Submitted attendance sheets</small><strong>{snapshot.academicSummary?.submitted_attendance ?? 0}</strong></article><article><small>Published assessments</small><strong>{snapshot.academicSummary?.published_assessments ?? 0}</strong></article><article><small>Current enrolment</small><strong>{offering?.enrolment ?? 0}</strong></article></div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
    </section>
  );
}

function GovernanceSurface({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="role-surface governance-surface">
      <div className="hero-copy"><p className="kicker">AURA control plane</p><h1>Evidence,<br />not theatre.</h1><p>Observe lineage and replay. Academic authority lives elsewhere.</p></div>
      <div className="governance-console">
        <div className="console-head"><span>system / integrity</span><i>connected</i></div>
        <div className="console-grid"><article><small>Institution revision</small><strong>{String(snapshot.institutionRevision).padStart(3, "0")}</strong></article><article><small>Observed events</small><strong>{String(snapshot.activity.length).padStart(2, "0")}</strong></article><article><small>Mutation authority</small><strong>NONE</strong></article></div>
        <pre>{snapshot.activity[0] ? `event ${snapshot.activity[0].id}\nstatus observed\nhash pending-agent-slice` : "> waiting for first academic event_"}</pre>
      </div>
    </section>
  );
}

export function PortalHome({ portal }: { portal: PortalDefinition }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "guest" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [activeView, setActiveView] = useState(navByPortal[portal.id][0]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/bff/dashboard", { cache: "no-store" });
      const result = await response.json() as ApiResult<Snapshot>;
      if (response.status === 401) { setStatus("guest"); setSnapshot(null); }
      else if (!result.ok) { setError(result.error.message); setStatus("error"); }
      else if (result.data.actor.role !== portal.id) { setError("This identity belongs to a different portal."); setStatus("error"); }
      else { setSnapshot(result.data); setStatus("ready"); setError(""); }
    } catch { setError("The portal could not reach its Core service."); setStatus("error"); }
    finally { setRefreshing(false); }
  }, [portal.id]);

  // The session is held in an HTTP-only cookie, so the first client render must probe the same-origin BFF.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);

  async function signOut() {
    await fetch("/api/session/logout", { method: "POST" });
    setSnapshot(null); setStatus("guest");
  }

  return (
    <main className={`portal-shell portal-${portal.id}`} data-portal={portal.id}>
      {status === "loading" ? <div className="portal-loader"><span>AURA</span><i /></div> : null}
      {status === "guest" ? (
        <section className="guest-gate">
          <div className="gate-brand"><span className="brand-mark">A</span><b>AURA</b></div>
          <p className="kicker">Independent {portal.name}</p>
          <h1>{portal.purpose}</h1>
          <p>Authenticate at the central identity boundary. Your session remains local to this website.</p>
          <a href="/api/session/login" data-action-id={`${portal.id}-sign-in`}>Enter as {portal.actor}<span aria-hidden="true">↗</span></a>
          <small>Synthetic institutional simulation · no real student data</small>
        </section>
      ) : null}
      {status === "error" ? <section className="error-state"><p className="kicker">Boundary response</p><h1>Access stopped.</h1><p>{error}</p><button type="button" onClick={() => void load()} data-action-id={`${portal.id}-retry`}>Retry</button></section> : null}
      {status === "ready" && snapshot ? (
        <>
          <PortalMasthead portal={portal} snapshot={snapshot} refresh={() => void load()} signOut={() => void signOut()} refreshing={refreshing} activeView={activeView} navigate={setActiveView} />
          <div className="portal-workspace">
            {portal.id === "student" && activeView === "Today" ? <StudentSurface snapshot={snapshot} /> : null}
            {portal.id === "student" && activeView === "Registration" ? <StudentRegistrationSurface snapshot={snapshot} refresh={load} /> : null}
            {portal.id === "student" && activeView === "Academics" ? <StudentAcademicsSurface snapshot={snapshot} /> : null}
            {portal.id === "parent" && activeView === "Overview" ? <ParentSurface snapshot={snapshot} /> : null}
            {portal.id === "parent" && activeView === "Children" ? <ParentAcademicsSurface snapshot={snapshot} /> : null}
            {portal.id === "faculty" ? <FacultySurface snapshot={snapshot} activeView={activeView} refresh={load} /> : null}
            {portal.id === "hod" ? <HodSurface snapshot={snapshot} refresh={load} /> : null}
            {portal.id === "governance" ? <GovernanceSurface snapshot={snapshot} /> : null}
            <ActivityRail activity={snapshot.activity} />
          </div>
          <footer className="portal-footer"><span>AURA Institute of Technology</span><span>Synthetic ecosystem / {portal.id}</span></footer>
        </>
      ) : null}
    </main>
  );
}
