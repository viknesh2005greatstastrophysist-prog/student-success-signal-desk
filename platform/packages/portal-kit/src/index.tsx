"use client";

import { portalViewRoutes, type PortalDefinition, type PortalId } from "@aura/contracts";
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
type FeeTransaction = { id: string; amountPaise: number; providerReference: string; status: "captured" | "failed"; createdAt: string; receiptId: string | null };
type FeeInvoice = {
  id: string; invoice_number: string; description: string; amount_paise: string; paid_paise: string;
  remaining_paise: string; due_on: string; status: string; revision: number; transactions: FeeTransaction[];
};
type SupportRecommendation = {
  summary: string;
  actions: Array<{ code: string; label: string; owner: string; dueInDays: number }>;
  citations: Array<{ evidencePath: string; statement: string }>;
};
type SupportPlanView = { id: string; case_id: string; reason: string; risk_band: string; status: string; plan: SupportRecommendation; created_at: string };
type SupportCaseView = {
  id: string; student_id: string; status: string; risk_band: string; reason: string; revision: number;
  register_number: string; display_name: string; artifact_id: string; content_hash: string;
  recommendation: SupportRecommendation; validation: { valid: boolean; repairAttempted: boolean; fallbackUsed: boolean; policyVersion: string }; created_at: string;
};
type ProcessableEvent = { id: string; event_type: string; institution_revision: string; occurred_at: string; payload: Record<string, unknown>; attempts: number };
type GovernanceRun = {
  id: string; mode: string; status: string; started_at: string; completed_at: string; support_case_id: string;
  case_status: string; risk_band: string; student_name: string; input_hash: string; artifact_id: string;
  content_hash: string; recommendation: SupportRecommendation; validation: Record<string, unknown>; replay_count: number;
};
type DepartmentStudent = {
  id: string; register_number: string; semester: number; display_name: string; active_registrations: number;
  submitted_attendance_records: number; published_marks: number; outstanding_paise: string;
};
type DepartmentFaculty = {
  id: string; display_name: string; assigned_offerings: number; submitted_attendance_sheets: number; published_assessments: number;
};
type Snapshot = {
  actor: { role: PortalId; displayName: string; email: string };
  institutionRevision: number;
  offering: Offering | null;
  activity: Activity[];
  student?: {
    register_number: string; semester: number; department: string; fee_invoice_id: string | null; invoice_number: string | null;
    fee_description: string | null; fee_status: string; amount_paise: string; paid_paise: string; remaining_paise: string;
    due_on: string; receipt_id: string | null;
  };
  children?: Array<{ id: string; display_name: string; register_number: string; grants: string[] }>;
  selectedChildId?: string | null;
  availableFaculty?: Person[];
  departmentPeople?: Person[];
  departmentStudents?: DepartmentStudent[];
  departmentFaculty?: DepartmentFaculty[];
  assignableOffering?: Offering | null;
  registrationCatalogue?: CatalogueOffering[];
  roster?: RosterStudent[];
  classroom?: Classroom;
  academics?: { attendance: AttendanceView[]; marks: MarkView[] };
  childAcademics?: { studentId: string; grantedFields: string[]; attendance?: AttendanceView[]; marks?: MarkView[] };
  childFinance?: { studentId: string; granted: true; invoices: FeeInvoice[] };
  parentAccess?: Array<{ id: string; field_group: string; granted: boolean; revision: number; parent_name: string; relationship: string; linked_at: string }>;
  academicSummary?: { submitted_attendance: number; published_assessments: number };
  financeSummary?: { due_invoices: number; outstanding_paise: string; captured_payments: number };
  supportSummary?: Record<string, number>;
  supportPlans?: SupportPlanView[];
  childSupportPlans?: SupportPlanView[];
  supportCases?: SupportCaseView[];
  processableEvents?: ProcessableEvent[];
  governanceRuns?: GovernanceRun[];
};
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const navByPortal: Record<PortalId, string[]> = {
  student: ["Today", "Registration", "Academics", "Fees", "Support", "Account"],
  parent: ["Overview", "Children", "Fees", "Access"],
  faculty: ["Today", "Classrooms", "Gradebook", "Cases"],
  hod: ["Department", "Offerings", "People", "Cases"],
  governance: ["Operations", "Runs", "Evidence", "Simulation"],
};

function routeForView(portal: PortalId, view: string) {
  return (portalViewRoutes[portal] as Record<string, string>)[view] ?? "/dashboard";
}

function viewForPath(portal: PortalId, path: string) {
  const routes = portalViewRoutes[portal] as Record<string, string>;
  return Object.entries(routes).find(([, route]) => route === path)?.[0] ?? navByPortal[portal][0];
}

const consequenceViews: Record<string, Partial<Record<PortalId, string>>> = {
  "offering.published": { student: "Registration", faculty: "Today", hod: "Offerings", governance: "Operations" },
  "registration.created": { student: "Registration", faculty: "Classrooms", hod: "Department", governance: "Operations" },
  "registration.withdrawn": { student: "Registration", faculty: "Classrooms", hod: "Department", governance: "Operations" },
  "attendance.submitted": { student: "Academics", parent: "Children", faculty: "Classrooms", hod: "Department", governance: "Operations" },
  "marks.published": { student: "Academics", parent: "Children", faculty: "Gradebook", hod: "Department", governance: "Operations" },
  "payment.captured": { student: "Fees", parent: "Fees", hod: "Department", governance: "Operations" },
  "payment.failed": { parent: "Fees", hod: "Department", governance: "Operations" },
  "parent_grant.revoked": { student: "Account", parent: "Access", governance: "Operations" },
  "support.proposed": { faculty: "Cases", hod: "Cases", governance: "Runs" },
  "support.approved": { student: "Support", parent: "Children", faculty: "Cases", hod: "Cases", governance: "Runs" },
  "support.rejected": { faculty: "Cases", hod: "Cases", governance: "Runs" },
  "agent.replayed": { governance: "Runs" },
};

function money(paise: string | number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise ?? 0) / 100);
}

function commandHeaders(csrfToken: string) {
  return { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-CSRF-Token": csrfToken };
}

function ActivityRail({ activity, portal, navigate }: { activity: Activity[]; portal: PortalId; navigate: (view: string) => void }) {
  const eventLabel: Record<string, string> = {
    "offering.published": "Offering published and faculty assigned",
    "registration.created": "Student registered and roster updated",
    "registration.withdrawn": "Student withdrew and seat was released",
    "attendance.submitted": "Faculty submitted the attendance register",
    "marks.published": "Faculty published assessed marks",
    "payment.captured": "Parent completed a sandbox payment",
    "payment.failed": "Sandbox payment attempt was declined",
    "parent_grant.revoked": "Student revoked a parent field grant",
    "support.proposed": "Governance produced a bounded support proposal",
    "support.approved": "Assigned faculty approved the exact support artifact",
    "support.rejected": "Assigned faculty rejected the support artifact",
  };
  return (
    <aside className="activity-rail" aria-label="Causal activity">
      <div className="section-heading"><span>Live ledger</span><b>{activity.length}</b></div>
      {activity.length ? activity.map((event) => (
        <button type="button" className="activity-item" key={event.id} onClick={() => navigate(consequenceViews[event.type]?.[portal] ?? navByPortal[portal][0])} data-action-id={`${portal}-open-activity-consequence`} aria-label={`Open consequence: ${eventLabel[event.type] ?? event.type.replaceAll(".", " ")}`}>
          <span className="event-node" aria-hidden="true" />
          <p>{eventLabel[event.type] ?? event.type.replaceAll(".", " ")}</p>
          <small>revision {event.revision} · {new Date(event.occurredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
          <code>{event.id.slice(0, 8)}</code>
        </button>
      )) : <p className="empty-copy">No cross-portal consequences yet. The ledger is quiet, not broken.</p>}
    </aside>
  );
}

function PortalMasthead({ portal, snapshot, refresh, signOut, refreshing, activeView, navigate }: {
  portal: PortalDefinition; snapshot: Snapshot; refresh: () => void; signOut: () => void; refreshing: boolean; activeView: string; navigate: (view: string) => void;
}) {
  const enabledViews: Partial<Record<PortalId, string[]>> = {
    student: ["Today", "Registration", "Academics", "Fees", "Support", "Account"],
    parent: ["Overview", "Children", "Fees", "Access"],
    faculty: ["Today", "Classrooms", "Gradebook", "Cases"],
    hod: ["Department", "Offerings", "People", "Cases"],
    governance: ["Operations", "Runs", "Evidence", "Simulation"],
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

function StudentRegistrationSurface({ snapshot, refresh, csrfToken }: { snapshot: Snapshot; refresh: () => Promise<void> | void; csrfToken: string }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "eligible" | "registered" | "blocked">("all");
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const catalogue = snapshot.registrationCatalogue ?? [];
  const weekday = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCatalogue = catalogue.filter((item) => {
    const matchesQuery = !normalizedQuery || `${item.code} ${item.title} ${item.faculty_name ?? ""}`.toLowerCase().includes(normalizedQuery);
    const registered = item.registration_status === "registered";
    const matchesFilter = filter === "all" || (filter === "registered" && registered) || (filter === "eligible" && item.eligible && !registered) || (filter === "blocked" && !item.eligible && !registered);
    return matchesQuery && matchesFilter;
  });

  async function mutate(item: CatalogueOffering, action: "register" | "withdraw") {
    setPendingId(item.id); setMessage("");
    const endpoint = action === "register" ? "/api/bff/registrations" : `/api/bff/registrations/${item.registration_id}/withdraw`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: commandHeaders(csrfToken),
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
      <div className="surface-toolbar" aria-label="Registration catalogue controls">
        <label><span>Find course</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, title, or faculty" data-action-id="student-search-registration" /></label>
        <label><span>Eligibility</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} data-action-id="student-filter-registration"><option value="all">All offerings</option><option value="eligible">Eligible</option><option value="registered">Registered</option><option value="blocked">Unavailable</option></select></label>
        <p><b>{visibleCatalogue.length}</b> of {catalogue.length} offerings</p>
      </div>
      <div className="course-register" role="list">
        {visibleCatalogue.map((item) => {
          const registered = item.registration_status === "registered";
          const slot = item.schedule[0];
          return <article className="register-row" role="listitem" key={item.id} data-course={item.code}>
            <div className="register-code"><b>{item.code}</b><span>{item.credits} credits</span></div>
            <div className="register-course"><h2>{item.title}</h2><p>{item.faculty_name ?? "Faculty assignment pending"}</p><small>{slot ? `${weekday[slot.weekday]} ${slot.startsAt.slice(0, 5)} · ${slot.room}` : "Schedule pending"}</small><button type="button" className="inline-inspect" onClick={() => setInspectedId((current) => current === item.id ? null : item.id)} data-action-id="student-inspect-course">{inspectedId === item.id ? "Close details" : "Inspect course"}</button></div>
            <div className="register-capacity"><span>{item.enrolment}/{item.capacity}</span><small>seats</small></div>
            <div className="register-decision">
              {registered ? <button type="button" onClick={() => void mutate(item, "withdraw")} disabled={pendingId === item.id} data-action-id="student-withdraw-registration">{pendingId === item.id ? "Withdrawing…" : "Withdraw"}</button>
                : confirmId === item.id ? <div className="confirm-actions"><button type="button" onClick={() => setConfirmId(null)} data-action-id="student-cancel-registration">Cancel</button><button type="button" onClick={() => void mutate(item, "register")} disabled={pendingId === item.id} data-action-id="student-confirm-registration">{pendingId === item.id ? "Registering…" : "Confirm"}</button></div>
                  : <button type="button" onClick={() => setConfirmId(item.id)} disabled={!item.eligible} data-action-id="student-start-registration">Register</button>}
              {!registered && item.reasons.length ? <small>{item.reasons.join(" · ")}</small> : <small className="eligible-copy">{registered ? "Active registration" : "Eligible to register"}</small>}
            </div>
            {inspectedId === item.id ? <div className="inline-detail course-detail"><span><small>Status</small><b>{item.status}</b></span><span><small>Prerequisites</small><b>{item.prerequisites.length ? item.prerequisites.join(", ") : "None"}</b></span><span><small>Schedule</small><b>{item.schedule.length ? item.schedule.map((entry) => `${weekday[entry.weekday]} ${entry.startsAt.slice(0, 5)}–${entry.endsAt.slice(0, 5)} · ${entry.room}`).join(" / ") : "Pending"}</b></span></div> : null}
          </article>;
        })}
        {!visibleCatalogue.length ? <p className="filter-empty">No offering matches these filters.</p> : null}
      </div>
    </section>
  );
}

function StudentAcademicsSurface({ snapshot }: { snapshot: Snapshot }) {
  const academics = snapshot.academics ?? { attendance: [], marks: [] };
  const [course, setCourse] = useState("all");
  const [inspected, setInspected] = useState("");
  const courses = [...new Set([...academics.attendance, ...academics.marks].map((item) => item.code))];
  const attendance = course === "all" ? academics.attendance : academics.attendance.filter((item) => item.code === course);
  const marks = course === "all" ? academics.marks : academics.marks.filter((item) => item.code === course);
  return (
    <section className="role-surface academic-surface">
      <div className="registration-heading"><div><p className="kicker">Published academic record</p><h1>Your work, in view.</h1></div><p>Attendance appears after faculty submission. Marks appear only after publication. Drafts and internal notes remain outside this portal.</p></div>
      <div className="surface-toolbar compact-toolbar"><label><span>Course</span><select value={course} onChange={(event) => setCourse(event.target.value)} data-action-id="student-filter-academics"><option value="all">All published courses</option>{courses.map((code) => <option value={code} key={code}>{code}</option>)}</select></label><p><b>{attendance.length + marks.length}</b> published records</p></div>
      <div className="academic-columns">
        <section><div className="section-heading"><span>Attendance record</span><b>{attendance.length}</b></div>{attendance.length ? attendance.map((item) => { const key = `attendance-${item.code}-${item.session_date}`; return <article key={key}><div><b>{item.code}</b><small>{item.topic}</small><button type="button" className="inline-inspect" onClick={() => setInspected((current) => current === key ? "" : key)} data-action-id="student-inspect-academic-record">{inspected === key ? "Close" : "Inspect"}</button>{inspected === key ? <em>Submitted record · revision {item.revision ?? "current"}</em> : null}</div><time>{new Date(item.session_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</time><span className={`academic-status status-${item.status}`}>{item.status}</span></article>; }) : <p>No submitted attendance yet.</p>}</section>
        <section><div className="section-heading"><span>Published marks</span><b>{marks.length}</b></div>{marks.length ? marks.map((item) => { const key = `mark-${item.code}-${item.assessment}`; return <article key={key}><div><b>{item.code}</b><small>{item.assessment}</small><button type="button" className="inline-inspect" onClick={() => setInspected((current) => current === key ? "" : key)} data-action-id="student-inspect-academic-record">{inspected === key ? "Close" : "Inspect"}</button></div><strong>{item.score}<i>/{item.maximum_score}</i></strong><p>{item.feedback}{inspected === key ? ` Published at revision ${item.revision ?? "current"}.` : ""}</p></article>; }) : <p>No marks have been published yet.</p>}</section>
      </div>
    </section>
  );
}

function StudentFeesSurface({ snapshot }: { snapshot: Snapshot }) {
  const fee = snapshot.student;
  const settled = fee?.fee_status === "paid";
  const [showInvoice, setShowInvoice] = useState(false);
  return (
    <section className="role-surface student-fees-surface">
      <div className="registration-heading"><div><p className="kicker">Semester account</p><h1>{settled ? "All settled." : "Fees, clearly."}</h1></div><p>This is a read-only student view. Payments can be completed only by an actively linked parent with a current fees grant.</p></div>
      <div className="fee-statement">
        <article><small>Invoice amount</small><strong>{money(fee?.amount_paise)}</strong></article>
        <article><small>Paid</small><strong>{money(fee?.paid_paise)}</strong></article>
        <article><small>Balance</small><strong>{money(fee?.remaining_paise)}</strong></article>
        <article><small>Status</small><strong className={`fee-state fee-${fee?.fee_status}`}>{fee?.fee_status ?? "clear"}</strong></article>
      </div>
      <div className="surface-actions">
        <button type="button" onClick={() => setShowInvoice((visible) => !visible)} data-action-id="student-inspect-invoice">{showInvoice ? "Close invoice details" : "Inspect invoice"}</button>
        {fee?.receipt_id ? <a href={`/api/bff/receipts/${fee.receipt_id}`} download data-action-id="student-download-receipt">Download existing receipt</a> : <span>Receipt becomes available after a captured sandbox payment.</span>}
      </div>
      {showInvoice ? <article className="inline-detail invoice-detail"><span><small>Invoice</small><b>{fee?.invoice_number ?? "No current invoice"}</b></span><span><small>Description</small><b>{fee?.fee_description ?? "Not applicable"}</b></span><span><small>Due</small><b>{fee?.due_on ? new Date(fee.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "Not applicable"}</b></span></article> : null}
      <p className="sandbox-notice">Synthetic account. No real charges, money movement, or payment credentials exist in this simulation.</p>
    </section>
  );
}

function StudentAccountSurface({ snapshot, refresh, csrfToken }: { snapshot: Snapshot; refresh: () => Promise<void> | void; csrfToken: string }) {
  const grants = snapshot.parentAccess ?? [];
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  async function revoke(grant: NonNullable<Snapshot["parentAccess"]>[number]) {
    setPendingId(grant.id); setMessage("");
    const response = await fetch(`/api/bff/parent-grants/${grant.id}/revoke`, {
      method: "POST",
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({ expectedRevision: grant.revision }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) {
      setMessage(`${grant.field_group} access revoked. Receipt ${result.data.receipt.eventId.slice(0, 8)} committed.`);
      setConfirmId(null);
      await refresh();
    } else setMessage(result.error.message);
    setPendingId(null);
  }

  return (
    <section className="role-surface student-account-surface">
      <div className="registration-heading"><div><p className="kicker">Account / parent access</p><h1>Your record. Your boundary.</h1></div><p>Revocation is enforced at Core on the parent&apos;s next request. It does not rewrite historical audit events.</p></div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
      <div className="student-grant-ledger">{grants.length ? grants.map((grant) => <article key={grant.id} data-grant={grant.field_group}><div><small>{grant.parent_name} · {grant.relationship}</small><h2>{grant.field_group}</h2><button type="button" className="inline-inspect" onClick={() => setInspectedId((current) => current === grant.id ? null : grant.id)} data-action-id="student-inspect-parent-grant">{inspectedId === grant.id ? "Close boundary" : "Inspect boundary"}</button></div><span className={`fee-state ${grant.granted ? "fee-paid" : ""}`}>{grant.granted ? "granted" : "revoked"}</span>{grant.granted ? confirmId === grant.id ? <div className="grant-confirm"><p>Remove {grant.field_group} from the parent&apos;s next authorized response?</p><button type="button" onClick={() => setConfirmId(null)} data-action-id="student-cancel-grant-revocation">Cancel</button><button type="button" onClick={() => void revoke(grant)} disabled={pendingId === grant.id} data-action-id="student-confirm-grant-revocation">{pendingId === grant.id ? "Revoking…" : "Confirm revoke"}</button></div> : <button type="button" onClick={() => setConfirmId(grant.id)} data-action-id="student-start-grant-revocation">Revoke access</button> : <small className="revoked-copy">No data returned to parent</small>}{inspectedId === grant.id ? <div className="inline-detail grant-detail"><span><small>Field</small><b>{grant.field_group}</b></span><span><small>Relationship</small><b>{grant.relationship}</b></span><span><small>Enforcement</small><b>{grant.granted ? "Core returns this field after every request-time check" : "Core omits this field"}</b></span></div> : null}</article>) : <p>No active parent relationship exists.</p>}</div>
    </section>
  );
}

function SupportPlanSurface({ plans, audience }: { plans: SupportPlanView[] | undefined; audience: "student" | "parent" }) {
  const plan = plans?.[0];
  const [showProvenance, setShowProvenance] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section className={`role-surface support-plan-surface support-plan-${audience}`}>
      <div className="registration-heading"><div><p className="kicker">Approved support</p><h1>{plan ? "A plan, not a label." : "No active plan."}</h1></div><p>Only a faculty-approved artifact appears here. Governance can propose; it cannot approve or alter the academic record.</p></div>
      {plan ? <article className="support-plan-card">
        <header><span className={`risk-chip risk-${plan.risk_band}`}>{plan.risk_band} context</span><time>{new Date(plan.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</time></header>
        <h2>{plan.plan.summary}</h2>
        <ol>{plan.plan.actions.map((action) => <li key={action.code}><span>{action.owner.replaceAll("_", " ")}</span><b>{action.label}</b><small>within {action.dueInDays} days</small></li>)}</ol>
        <p>{plan.reason}</p>
        <div className="surface-actions support-actions">
          {audience === "student" ? <button type="button" onClick={() => setShowProvenance((visible) => !visible)} data-action-id="student-inspect-support-plan">{showProvenance ? "Hide plan provenance" : "Inspect plan provenance"}</button> : <button type="button" onClick={() => setShowProvenance((visible) => !visible)} data-action-id="parent-inspect-support-plan">{showProvenance ? "Hide plan provenance" : "Inspect plan provenance"}</button>}
          {audience === "student" ? <button type="button" onClick={() => setAcknowledged(true)} disabled={acknowledged} data-action-id="student-acknowledge-support">{acknowledged ? "Update acknowledged" : "Acknowledge update"}</button> : null}
        </div>
        {showProvenance ? <div className="inline-detail"><span><small>Case</small><b>{plan.case_id.slice(0, 8)}</b></span><span><small>Decision</small><b>{plan.status.replaceAll("_", " ")}</b></span><span><small>Visibility</small><b>{audience === "student" ? "Student approved" : "Parent grant checked"}</b></span></div> : null}
      </article> : <div className="empty-support"><span>0</span><p>There is no approved support plan in the current synthetic generation.</p></div>}
    </section>
  );
}

function ParentSurface({ snapshot, chooseChild }: { snapshot: Snapshot; chooseChild: (childId: string) => void }) {
  const child = snapshot.children?.find((item) => item.id === snapshot.selectedChildId) ?? snapshot.children?.[0];
  const [selectedGrant, setSelectedGrant] = useState("");
  return (
    <section className="role-surface parent-surface">
      <div className="hero-copy"><p className="kicker">Family academic view</p><h1>What needs<br />your attention.</h1><p>Only the fields {child?.display_name ?? "the linked student"} has permitted. No surveillance theatre.</p></div>
      {snapshot.children && snapshot.children.length > 1 ? <label className="child-switcher">Linked student<select aria-label="Linked student" value={child?.id} onChange={(event) => { setSelectedGrant(""); chooseChild(event.target.value); }} data-action-id="parent-switch-child">{snapshot.children.map((item) => <option value={item.id} key={item.id}>{item.display_name} · {item.register_number}</option>)}</select></label> : null}
      <article className="child-card"><span className="portrait-token">{child?.display_name.split(" ").map((part) => part[0]).slice(0, 2).join("") ?? "--"}</span><div><small>Linked student</small><h2>{child?.display_name ?? "No active link"}</h2><p>{child?.register_number}</p></div><span className="grant-count">{child?.grants.length ?? 0}<small>active grants</small></span></article>
      <div className="grant-grid interactive-grants">{child?.grants.map((grant) => <button type="button" key={grant} onClick={() => setSelectedGrant((current) => current === grant ? "" : grant)} data-action-id="parent-inspect-grant"><i aria-hidden="true">✓</i>{grant}</button>)}</div>
      {selectedGrant ? <p className="grant-explainer" role="status"><b>{selectedGrant}</b> is granted for {child?.display_name}. Core rechecks this field on every request; it is not a browser-only permission.</p> : null}
    </section>
  );
}

function ParentAcademicsSurface({ snapshot }: { snapshot: Snapshot }) {
  const child = snapshot.children?.find((item) => item.id === snapshot.selectedChildId) ?? snapshot.children?.[0];
  const academics = snapshot.childAcademics;
  const [course, setCourse] = useState("all");
  const [inspected, setInspected] = useState("");
  const courses = [...new Set([...(academics?.attendance ?? []), ...(academics?.marks ?? [])].map((item) => item.code))];
  const attendance = course === "all" ? academics?.attendance : academics?.attendance?.filter((item) => item.code === course);
  const marks = course === "all" ? academics?.marks : academics?.marks?.filter((item) => item.code === course);
  return (
    <section className="role-surface parent-record-surface">
      <div className="registration-heading"><div><p className="kicker">Granted child record</p><h1>{child?.display_name ?? "No active link"}</h1></div><p>This view is assembled from the active parent link on every request. Revoking a field removes it on the next refresh.</p></div>
      <div className="grant-grid parent-record-grants">{academics?.grantedFields.map((grant) => <span key={grant}><i aria-hidden="true">✓</i>{grant}</span>)}</div>
      <div className="surface-toolbar compact-toolbar"><label><span>Course</span><select value={course} onChange={(event) => setCourse(event.target.value)} data-action-id="parent-filter-academics"><option value="all">All granted courses</option>{courses.map((code) => <option value={code} key={code}>{code}</option>)}</select></label><p>Filtering never expands the active field grants.</p></div>
      <div className="academic-columns">
        {attendance ? <section><div className="section-heading"><span>Granted attendance</span><b>{attendance.length}</b></div>{attendance.map((item) => { const key = `attendance-${item.code}-${item.session_date}`; return <article key={key}><div><b>{item.code}</b><small>{item.topic}</small><button type="button" className="inline-inspect" onClick={() => setInspected((current) => current === key ? "" : key)} data-action-id="parent-inspect-academic-record">{inspected === key ? "Close" : "Inspect"}</button>{inspected === key ? <em>Granted attendance event. Internal faculty notes are excluded.</em> : null}</div><time>{new Date(item.session_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</time><span className={`academic-status status-${item.status}`}>{item.status}</span></article>; })}</section> : <section className="revoked-panel"><p>Attendance access is not granted.</p></section>}
        {marks ? <section><div className="section-heading"><span>Granted marks</span><b>{marks.length}</b></div>{marks.map((item) => { const key = `mark-${item.code}-${item.assessment}`; return <article key={key}><div><b>{item.code}</b><small>{item.assessment}</small><button type="button" className="inline-inspect" onClick={() => setInspected((current) => current === key ? "" : key)} data-action-id="parent-inspect-academic-record">{inspected === key ? "Close" : "Inspect"}</button></div><strong>{item.score}<i>/{item.maximum_score}</i></strong><p>{item.feedback}{inspected === key ? " Published result; drafts are excluded." : ""}</p></article>; })}</section> : <section className="revoked-panel"><p>Marks access is not granted.</p></section>}
      </div>
      {snapshot.childSupportPlans ? <div className="embedded-support"><SupportPlanSurface plans={snapshot.childSupportPlans} audience="parent" /></div> : <div className="embedded-support revoked-panel"><p>Support access is not granted.</p></div>}
    </section>
  );
}

function ParentFeesSurface({ snapshot, refresh, csrfToken }: { snapshot: Snapshot; refresh: () => Promise<void> | void; csrfToken: string }) {
  const invoice = snapshot.childFinance?.invoices[0];
  const [scenario, setScenario] = useState<"success" | "decline">("success");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const captured = invoice?.transactions.find((transaction) => transaction.status === "captured");

  async function pay() {
    if (!invoice) return;
    setPending(true); setMessage("");
    const response = await fetch(`/api/bff/fees/invoices/${invoice.id}/payment-attempts`, {
      method: "POST",
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({ expectedRevision: invoice.revision, scenario }),
    });
    const result = await response.json() as ApiResult<{ transaction: FeeTransaction; receipt: { eventId: string } }>;
    if (result.ok) {
      setMessage(result.data.transaction.status === "captured"
        ? `Payment captured in the sandbox. Receipt ${result.data.receipt.eventId.slice(0, 8)} committed.`
        : `Payment declined by the sandbox. Attempt ${result.data.receipt.eventId.slice(0, 8)} was audited; the balance did not change.`);
      setConfirming(false);
      await refresh();
    } else setMessage(result.error.message);
    setPending(false);
  }

  if (!snapshot.childFinance) return <section className="role-surface revoked-fee-surface"><p className="kicker">Fees access</p><h1>Not granted.</h1><p>The linked student has not granted fee access. No invoice data was returned by Core.</p></section>;
  if (!invoice) return <section className="role-surface revoked-fee-surface"><p className="kicker">Fees access</p><h1>No invoices.</h1><p>This student has no synthetic invoice for the current term.</p></section>;
  const paid = invoice.status === "paid";
  return (
    <section className="role-surface parent-fees-surface">
      <div className="registration-heading"><div><p className="kicker">Household ledger / sandbox</p><h1>{paid ? "Paid in full." : "One clear balance."}</h1></div><p>Payment is simulated. The server rechecks your active link, fees grant, invoice version, and outstanding balance before recording anything.</p></div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
      <article className="invoice-card">
        <header><div><small>Invoice</small><b>{invoice.invoice_number}</b></div><span className={`fee-state fee-${invoice.status}`}>{invoice.status}</span></header>
        <h2>{invoice.description}</h2>
        <div className="invoice-total"><span>Outstanding</span><strong>{money(invoice.remaining_paise)}</strong><small>Due {new Date(invoice.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</small></div>
        {!paid ? <div className="sandbox-checkout">
          <label htmlFor="payment-scenario">Sandbox outcome</label>
          <select id="payment-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as "success" | "decline")} data-action-id="parent-select-payment-scenario"><option value="success">Simulate success</option><option value="decline">Simulate decline</option></select>
          {!confirming ? <button type="button" onClick={() => setConfirming(true)} data-action-id="parent-start-payment">Pay {money(invoice.remaining_paise)}</button>
            : <div className="payment-confirm"><p>Record a <b>{scenario}</b> sandbox attempt for {money(invoice.remaining_paise)}?</p><button type="button" onClick={() => setConfirming(false)} data-action-id="parent-cancel-payment">Cancel</button><button type="button" onClick={() => void pay()} disabled={pending} data-action-id="parent-confirm-payment">{pending ? "Recording…" : "Confirm sandbox payment"}</button></div>}
        </div> : captured?.receiptId ? <a className="receipt-download" href={`/api/bff/receipts/${captured.receiptId}`} download data-action-id="parent-download-receipt">Download verified receipt <span aria-hidden="true">↓</span></a> : null}
      </article>
      <div className="payment-history"><div className="section-heading"><span>Payment attempts</span><b>{invoice.transactions.length}</b></div>{invoice.transactions.length ? invoice.transactions.map((transaction) => <article key={transaction.id}><span className={`attempt-dot attempt-${transaction.status}`} /><div><b>{transaction.status}</b><small>{transaction.providerReference}</small></div><strong>{money(transaction.amountPaise)}</strong><time>{new Date(transaction.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></article>) : <p>No attempts recorded.</p>}</div>
      <p className="sandbox-notice">Simulation only. No card form exists because collecting payment credentials would be dishonest and unnecessary here.</p>
    </section>
  );
}

function ParentAccessSurface({ snapshot }: { snapshot: Snapshot }) {
  const child = snapshot.children?.find((item) => item.id === snapshot.selectedChildId) ?? snapshot.children?.[0];
  const fields = ["attendance", "marks", "fees", "support"];
  return (
    <section className="role-surface parent-access-surface">
      <div className="registration-heading"><div><p className="kicker">Consent boundary</p><h1>Access, named.</h1></div><p>Every request rechecks the active relationship and field-level grants. A missing grant means Core omits the field, not merely hides it in the browser.</p></div>
      <div className="access-ledger">{fields.map((field) => { const granted = child?.grants.includes(field); return <article key={field}><span>{field}</span><b>{granted ? "Granted" : "Not granted"}</b><small>{granted ? "Available on the next authorized request" : "No data returned by Core"}</small></article>; })}</div>
    </section>
  );
}

function FacultySurface({ snapshot, activeView, refresh, csrfToken, navigate }: { snapshot: Snapshot; activeView: string; refresh: () => Promise<void> | void; csrfToken: string; navigate: (view: string) => void }) {
  const offering = snapshot.assignableOffering;
  const roster = snapshot.roster ?? [];
  const attendanceSession = snapshot.classroom?.attendanceSession;
  const assessment = snapshot.classroom?.assessment;
  const [attendance, setAttendance] = useState<Record<string, "present" | "absent" | "late" | "excused">>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const supportCase = snapshot.supportCases?.[0];
  const [pending, setPending] = useState<"attendance" | "marks" | "decision" | null>(null);
  const [message, setMessage] = useState("");
  const [rationale, setRationale] = useState("The proposed steps are proportionate, student-visible, and grounded in the cited academic evidence.");
  const [rosterQuery, setRosterQuery] = useState("");
  const [inspectedStudentId, setInspectedStudentId] = useState("");
  const normalizedRosterQuery = rosterQuery.trim().toLowerCase();
  const visibleRoster = roster.filter((student) => !normalizedRosterQuery || `${student.display_name} ${student.register_number}`.toLowerCase().includes(normalizedRosterQuery));

  async function submitRegister() {
    if (!attendanceSession || !roster.length) return;
    setPending("attendance"); setMessage("");
    const response = await fetch(`/api/bff/attendance-sessions/${attendanceSession.id}/submit`, {
      method: "POST",
      headers: commandHeaders(csrfToken),
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
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({ expectedRevision: assessment.revision, marks: roster.map((student) => ({ studentId: student.id, score: Number(scores[student.id] ?? 82), feedback: "Clear reasoning and a well-bounded design." })) }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) { setMessage(`Marks published. Receipt ${result.data.receipt.eventId.slice(0, 8)}.`); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  async function decide(decision: "approved" | "rejected") {
    if (!supportCase) return;
    setPending("decision"); setMessage("");
    const response = await fetch(`/api/bff/support/cases/${supportCase.id}/decisions`, {
      method: "POST",
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({
        artifactId: supportCase.artifact_id,
        contentHash: supportCase.content_hash,
        expectedRevision: supportCase.revision,
        decision,
        rationale,
      }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) { setMessage(`Support artifact ${decision}. Receipt ${result.data.receipt.eventId.slice(0, 8)}.`); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  return (
    <section className="role-surface faculty-surface">
      <div className="hero-copy"><p className="kicker">Faculty operations / 03 Sep</p><h1>Teaching desk.</h1><p>Assigned work only. Everything else stays behind the Core boundary.</p></div>
      <div className="faculty-board">
        <article><small>09:00 · assigned section</small><h2>{offering ? `${offering.code} ${offering.title}` : "Awaiting HOD assignment"}</h2><p>{offering ? `${offering.enrolment} students · CSE-401` : "The CS401 publication event will place the section here."}</p><span className={offering ? "signal-live" : "signal-waiting"}>{offering ? "ready" : "waiting"}</span>{activeView === "Today" ? <button type="button" className="board-action" onClick={() => navigate("Classrooms")} disabled={!offering} data-action-id="faculty-open-classroom-task">Open classroom</button> : null}</article>
        <article className="queue-card"><small>Registered students</small><strong>{String(roster.length).padStart(2, "0")}</strong><p>{offering ? "Live from the authoritative registration ledger." : "Nothing can be marked before assignment."}</p>{activeView === "Today" ? <button type="button" className="board-action" onClick={() => navigate("Cases")} data-action-id="faculty-open-case-task">Open case queue</button> : null}</article>
      </div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
      {(activeView === "Classrooms" || activeView === "Gradebook") && offering ? <div className="surface-toolbar compact-toolbar faculty-roster-toolbar"><label><span>Find student</span><input type="search" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder="Name or register number" data-action-id="faculty-search-roster" /></label><p><b>{visibleRoster.length}</b> of {roster.length} assigned students</p></div> : null}
      {activeView === "Classrooms" && offering ? <section className="roster-register attendance-register"><div className="section-heading"><span>{offering.code} / {attendanceSession?.topic ?? "attendance sheet"}</span><b>v{attendanceSession?.revision ?? 0}</b></div>{visibleRoster.length ? visibleRoster.map((student) => { const index = roster.findIndex((entry) => entry.id === student.id); return <article key={student.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{student.display_name}</b><code>{student.register_number}</code><button type="button" className="inline-inspect" onClick={() => setInspectedStudentId((current) => current === student.id ? "" : student.id)} data-action-id="faculty-inspect-student">{inspectedStudentId === student.id ? "Close" : "Inspect"}</button>{inspectedStudentId === student.id ? <em>Registered {new Date(student.registered_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}. Visible because this faculty member is assigned to the section.</em> : null}</div><label><span className="sr-only">Attendance for {student.display_name}</span><select value={attendance[student.id] ?? "present"} onChange={(event) => setAttendance((current) => ({ ...current, [student.id]: event.target.value as "present" | "absent" | "late" | "excused" }))} data-action-id="faculty-set-attendance"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></label><small>{attendanceSession?.status ?? "open"}</small></article>; }) : <p>No assigned student matches this search.</p>}<div className="register-toolbar"><p>Submitting increments the sheet version and publishes the result to authorized views.</p><button type="button" onClick={() => void submitRegister()} disabled={!roster.length || !attendanceSession || pending === "attendance"} data-action-id="faculty-submit-attendance">{pending === "attendance" ? "Submitting…" : attendanceSession?.status === "submitted" ? "Submit correction" : "Submit attendance"}</button></div></section> : null}
      {activeView === "Gradebook" && offering ? <section className="roster-register gradebook-register"><div className="section-heading"><span>{assessment?.title ?? "gradebook"} / maximum {assessment?.maximum_score ?? 0}</span><b>v{assessment?.revision ?? 0}</b></div>{visibleRoster.length ? visibleRoster.map((student) => { const index = roster.findIndex((entry) => entry.id === student.id); return <article key={student.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{student.display_name}</b><code>{student.register_number}</code><button type="button" className="inline-inspect" onClick={() => setInspectedStudentId((current) => current === student.id ? "" : student.id)} data-action-id="faculty-inspect-student">{inspectedStudentId === student.id ? "Close" : "Inspect"}</button>{inspectedStudentId === student.id ? <em>Assigned-section student. No parent, fee, or unrelated-course fields are returned.</em> : null}</div><label><span className="sr-only">Score for {student.display_name}</span><input type="number" min="0" max={assessment?.maximum_score} value={scores[student.id] ?? "82"} onChange={(event) => setScores((current) => ({ ...current, [student.id]: event.target.value }))} data-action-id="faculty-enter-mark" /></label><small>{assessment?.published ? "published" : "draft"}</small></article>; }) : <p>No assigned student matches this search.</p>}<div className="register-toolbar"><p>Publishing makes these marks visible to the student and to parents with an active marks grant.</p><button type="button" onClick={() => void submitMarks()} disabled={!roster.length || !assessment || pending === "marks"} data-action-id="faculty-publish-marks">{pending === "marks" ? "Publishing…" : assessment?.published ? "Publish correction" : "Publish marks"}</button></div></section> : null}
      {activeView === "Cases" ? <section className="faculty-case-desk">
        <div className="section-heading"><span>Assigned support case</span><b>{snapshot.supportCases?.length ?? 0}</b></div>
        {supportCase ? <article className="artifact-review">
          <header><div><small>{supportCase.register_number} · {supportCase.risk_band} context</small><h2>{supportCase.display_name}</h2></div><span className={`case-state case-${supportCase.status}`}>{supportCase.status.replaceAll("_", " ")}</span></header>
          <p>{supportCase.reason}</p>
          <blockquote>{supportCase.recommendation.summary}</blockquote>
          <ol>{supportCase.recommendation.actions.map((action) => <li key={action.code}><b>{action.label}</b><small>{action.owner.replaceAll("_", " ")} · {action.dueInDays} days</small></li>)}</ol>
          <div className="artifact-integrity"><span>Artifact</span><code>{supportCase.content_hash}</code><span>Validation</span><b>{supportCase.validation.valid ? "VALID" : "BLOCKED"} · {supportCase.validation.policyVersion}</b></div>
          {supportCase.status === "awaiting_faculty" ? <div className="decision-panel"><label htmlFor="faculty-rationale">Decision rationale</label><textarea id="faculty-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} data-action-id="faculty-enter-support-rationale" /><div><button type="button" onClick={() => void decide("rejected")} disabled={pending === "decision"} data-action-id="faculty-reject-support-artifact">Reject artifact</button><button type="button" onClick={() => void decide("approved")} disabled={pending === "decision"} data-action-id="faculty-approve-support-artifact">{pending === "decision" ? "Committing…" : "Approve exact artifact"}</button></div></div> : <p className="decision-complete">Decision committed. This artifact is immutable.</p>}
        </article> : <div className="empty-support"><span>0</span><p>No governance artifact is assigned to this faculty identity.</p></div>}
      </section> : null}
    </section>
  );
}

function HodCasesSurface({ snapshot }: { snapshot: Snapshot }) {
  const cases = snapshot.supportCases ?? [];
  return (
    <section className="role-surface hod-cases-surface">
      <div className="registration-heading"><div><p className="kicker">Department / support disposition</p><h1>Decisions in view.</h1></div><p>This is departmental oversight, not approval authority. Exact-artifact decisions remain with the assigned faculty member.</p></div>
      <div className="hod-case-summary"><article><small>Awaiting faculty</small><strong>{snapshot.supportSummary?.awaiting_faculty ?? 0}</strong></article><article><small>Approved</small><strong>{snapshot.supportSummary?.approved ?? 0}</strong></article><article><small>Rejected</small><strong>{snapshot.supportSummary?.rejected ?? 0}</strong></article></div>
      <div className="hod-case-ledger">{cases.length ? cases.map((item) => <article key={item.id}><div><b>{item.display_name}</b><small>{item.register_number}</small></div><p>{item.reason}</p><span className={`case-state case-${item.status}`}>{item.status.replaceAll("_", " ")}</span></article>) : <p>No support cases have entered the department ledger.</p>}</div>
    </section>
  );
}

function HodDepartmentSurface({ snapshot }: { snapshot: Snapshot }) {
  const students = snapshot.departmentStudents ?? [];
  const faculty = snapshot.departmentFaculty ?? [];
  const activeRegistrations = students.reduce((total, item) => total + Number(item.active_registrations), 0);
  return (
    <section className="role-surface hod-department-surface">
      <div className="hero-copy"><p className="kicker">CSE / operating picture</p><h1>One department.<br />One ledger.</h1><p>Academic, staffing, support, and fee signals. Department-scoped and current to revision {snapshot.institutionRevision}.</p></div>
      <div className="surface-toolbar compact-toolbar term-toolbar"><label><span>Academic term</span><select value="2026-ODD" disabled data-action-id="hod-change-term" aria-describedby="term-constraint"><option value="2026-ODD">2026 odd semester</option></select></label><p id="term-constraint">This deterministic simulation seeds one active term. The control is intentionally locked because no second valid term exists.</p></div>
      <div className="department-scoreboard">
        <article><small>Active students</small><strong>{students.length}</strong><span>{activeRegistrations} current registrations</span></article>
        <article><small>Faculty</small><strong>{faculty.length}</strong><span>{faculty.reduce((total, item) => total + Number(item.assigned_offerings), 0)} assigned offerings</span></article>
        <article><small>Academic outputs</small><strong>{Number(snapshot.academicSummary?.submitted_attendance ?? 0) + Number(snapshot.academicSummary?.published_assessments ?? 0)}</strong><span>submitted sheets + published assessments</span></article>
        <article><small>Open obligations</small><strong>{money(snapshot.financeSummary?.outstanding_paise)}</strong><span>{snapshot.financeSummary?.due_invoices ?? 0} due or partial invoices</span></article>
      </div>
      <div className="department-brief"><div><p className="kicker">Current teaching line</p><h2>{snapshot.offering?.code} / {snapshot.offering?.title}</h2><p>{snapshot.offering?.faculty_name ?? "Faculty assignment pending"} · {snapshot.offering?.enrolment ?? 0} enrolled · {snapshot.offering?.status}</p></div><span className={`status-stamp status-${snapshot.offering?.status}`}>{snapshot.offering?.status}</span></div>
    </section>
  );
}

function HodPeopleSurface({ snapshot }: { snapshot: Snapshot }) {
  const students = snapshot.departmentStudents ?? [];
  const faculty = snapshot.departmentFaculty ?? [];
  const [query, setQuery] = useState("");
  const [cohort, setCohort] = useState<"all" | "students" | "faculty">("all");
  const [inspectedId, setInspectedId] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleStudents = cohort === "faculty" ? [] : students.filter((student) => !normalizedQuery || `${student.display_name} ${student.register_number}`.toLowerCase().includes(normalizedQuery));
  const visibleFaculty = cohort === "students" ? [] : faculty.filter((person) => !normalizedQuery || person.display_name.toLowerCase().includes(normalizedQuery));
  return (
    <section className="role-surface hod-people-surface">
      <div className="registration-heading"><div><p className="kicker">CSE / authorized directory</p><h1>People, in context.</h1></div><p>Operational records for this department only. Parent identities, credentials, and other departments remain outside the HOD boundary.</p></div>
      <div className="surface-toolbar people-toolbar"><label><span>Find person</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or register number" data-action-id="hod-search-people" /></label><label><span>Cohort</span><select value={cohort} onChange={(event) => setCohort(event.target.value as typeof cohort)} data-action-id="hod-filter-people"><option value="all">Students and faculty</option><option value="students">Students</option><option value="faculty">Faculty</option></select></label><p><b>{visibleStudents.length + visibleFaculty.length}</b> scoped records</p></div>
      {cohort !== "faculty" ? <section className="people-ledger"><div className="section-heading"><span>Students</span><b>{visibleStudents.length}</b></div>{visibleStudents.map((student) => <article key={student.id}><div><b>{student.display_name}</b><code>{student.register_number} · semester {student.semester}</code><button type="button" className="inline-inspect" onClick={() => setInspectedId((current) => current === student.id ? "" : student.id)} data-action-id="hod-inspect-profile">{inspectedId === student.id ? "Close profile" : "Inspect profile"}</button>{inspectedId === student.id ? <em>Department-scoped academic summary. Parent details and credentials are excluded.</em> : null}</div><span><b>{student.active_registrations}</b><small>courses</small></span><span><b>{student.submitted_attendance_records}</b><small>attendance</small></span><span><b>{student.published_marks}</b><small>marks</small></span><span className="money-cell"><b>{money(student.outstanding_paise)}</b><small>outstanding</small></span></article>)}{!visibleStudents.length ? <p className="filter-empty">No student matches this directory filter.</p> : null}</section> : null}
      {cohort !== "students" ? <section className="people-ledger faculty-directory"><div className="section-heading"><span>Faculty</span><b>{visibleFaculty.length}</b></div>{visibleFaculty.map((person) => <article key={person.id}><div><b>{person.display_name}</b><code>CSE faculty</code><button type="button" className="inline-inspect" onClick={() => setInspectedId((current) => current === person.id ? "" : person.id)} data-action-id="hod-inspect-profile">{inspectedId === person.id ? "Close profile" : "Inspect profile"}</button>{inspectedId === person.id ? <em>Teaching workload for this department only.</em> : null}</div><span><b>{person.assigned_offerings}</b><small>offerings</small></span><span><b>{person.submitted_attendance_sheets}</b><small>sheets</small></span><span><b>{person.published_assessments}</b><small>assessments</small></span></article>)}{!visibleFaculty.length ? <p className="filter-empty">No faculty member matches this directory filter.</p> : null}</section> : null}
    </section>
  );
}

function HodSurface({ snapshot, refresh, activeView, csrfToken }: { snapshot: Snapshot; refresh: () => Promise<void> | void; activeView: string; csrfToken: string }) {
  const offering = snapshot.offering;
  const faculty = snapshot.availableFaculty ?? [];
  const [facultyId, setFacultyId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [showEnrolment, setShowEnrolment] = useState(false);
  const selected = facultyId || faculty[0]?.id || "";

  async function publish() {
    if (!offering || !selected) return;
    setPending(true); setMessage("");
    const response = await fetch(`/api/bff/offerings/${offering.id}/publish-and-assign`, {
      method: "POST",
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({ facultyPersonId: selected, expectedRevision: offering.revision }),
    });
    const result = await response.json() as ApiResult<unknown>;
    if (result.ok) { setMessage("Published. Every authorized portal now reads the same event."); await refresh(); }
    else setMessage(result.error.message);
    setPending(false);
  }

  if (activeView === "Department") return <HodDepartmentSurface snapshot={snapshot} />;
  if (activeView === "People") return <HodPeopleSurface snapshot={snapshot} />;
  if (activeView === "Cases") return <HodCasesSurface snapshot={snapshot} />;

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
      <div className="surface-actions offering-actions"><button type="button" onClick={() => setShowEnrolment((visible) => !visible)} data-action-id="hod-inspect-enrolment">{showEnrolment ? "Close enrolment detail" : "Inspect enrolment"}</button><span>{offering ? `${offering.enrolment} of ${offering.capacity} seats currently occupied` : "No offering is available"}</span></div>
      {showEnrolment && offering ? <div className="inline-detail"><span><small>Current enrolment</small><b>{offering.enrolment}</b></span><span><small>Capacity</small><b>{offering.capacity}</b></span><span><small>Available</small><b>{Math.max(0, offering.capacity - offering.enrolment)}</b></span></div> : null}
      <div className="hod-academic-strip"><article><small>Submitted attendance sheets</small><strong>{snapshot.academicSummary?.submitted_attendance ?? 0}</strong></article><article><small>Published assessments</small><strong>{snapshot.academicSummary?.published_assessments ?? 0}</strong></article><article><small>Current enrolment</small><strong>{offering?.enrolment ?? 0}</strong></article><article><small>Outstanding fees</small><strong>{money(snapshot.financeSummary?.outstanding_paise)}</strong></article></div>
      {message ? <p className="command-message" role="status">{message}</p> : null}
    </section>
  );
}

function GovernanceSurface({ snapshot, activeView, refresh, csrfToken, navigate }: { snapshot: Snapshot; activeView: string; refresh: () => Promise<void> | void; csrfToken: string; navigate: (view: string) => void }) {
  const event = snapshot.processableEvents?.[0];
  const run = snapshot.governanceRuns?.[0];
  const previousRun = snapshot.governanceRuns?.[1];
  const [pending, setPending] = useState<"process" | "replay" | "reset" | null>(null);
  const [message, setMessage] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [showStages, setShowStages] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [showResetPreview, setShowResetPreview] = useState(false);
  const normalizedEvidenceQuery = evidenceQuery.trim().toLowerCase();
  const visibleCitations = run?.recommendation.citations.filter((citation) => !normalizedEvidenceQuery || `${citation.evidencePath} ${citation.statement}`.toLowerCase().includes(normalizedEvidenceQuery)) ?? [];

  async function processEvent() {
    if (!event) return;
    setPending("process"); setMessage("");
    const response = await fetch("/api/bff/governance/runs", {
      method: "POST",
      headers: commandHeaders(csrfToken),
      body: JSON.stringify({ eventId: event.id }),
    });
    const result = await response.json() as ApiResult<{ receipt: { eventId: string } }>;
    if (result.ok) { setMessage(`Evidence frozen and artifact validated. Receipt ${result.data.receipt.eventId.slice(0, 8)}.`); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  async function replay() {
    if (!run) return;
    setPending("replay"); setMessage("");
    const response = await fetch(`/api/bff/governance/runs/${run.id}/replay`, {
      method: "POST", headers: commandHeaders(csrfToken), body: "{}",
    });
    const result = await response.json() as ApiResult<{ replay: { matched: boolean; id: string } }>;
    if (result.ok) { setMessage(result.data.replay.matched ? `Replay verified. Receipt ${result.data.replay.id.slice(0, 8)}; zero domain mutations.` : "Replay hash mismatch. Release is blocked."); await refresh(); }
    else setMessage(result.error.message);
    setPending(null);
  }

  async function resetSimulation() {
    if (resetConfirmation !== "AURA-SYNTHETIC-SEED-V1") return;
    setPending("reset"); setMessage("");
    const response = await fetch("/api/bff/governance/simulation/reset", {
      method: "POST", headers: commandHeaders(csrfToken),
      body: JSON.stringify({ confirmation: resetConfirmation }),
    });
    const result = await response.json() as ApiResult<{ manifest: { generationId: string; seedVersion: string } }>;
    if (result.ok) {
      setMessage(`New synthetic generation active: ${result.data.manifest.generationId.slice(0, 8)}. Previous evidence remains retained.`);
      setResetConfirmation("");
      await refresh();
    } else setMessage(result.error.message);
    setPending(null);
  }

  return (
    <section className="role-surface governance-surface">
      <div className="hero-copy"><p className="kicker">AURA control plane</p><h1>Evidence,<br />not theatre.</h1><p>Observe lineage and replay. Academic authority lives elsewhere.</p></div>
      {message ? <p className="governance-message" role="status">{message}</p> : null}
      {activeView === "Operations" ? <>
        <div className="governance-console">
          <div className="console-head"><span>system / integrity</span><i>connected</i></div>
          <div className="console-grid"><article><small>Institution revision</small><strong>{String(snapshot.institutionRevision).padStart(3, "0")}</strong></article><article><small>Processable events</small><strong>{String(snapshot.processableEvents?.length ?? 0).padStart(2, "0")}</strong></article><article><small>Academic mutation</small><strong>NONE</strong></article></div>
          <pre>{event ? `event ${event.id}\ntype ${event.event_type}\nstate awaiting evidence freeze` : "> academic event queue clear_"}</pre>
        </div>
        <div className="governance-queue"><div className="section-heading"><span>Academic event queue</span><b>{snapshot.processableEvents?.length ?? 0}</b></div>{event ? <article><div><small>revision {event.institution_revision}</small><h2>{event.event_type.replaceAll(".", " / ")}</h2><code>{event.id}</code></div><button type="button" onClick={() => void processEvent()} disabled={pending === "process"} data-action-id="governance-process-academic-event">{pending === "process" ? "Processing…" : "Freeze evidence + process"}</button></article> : <p>No attendance or marks event is waiting.</p>}</div>
        {run ? <div className="surface-actions governance-dashboard-action"><button type="button" onClick={() => navigate("Runs")} data-action-id="governance-open-run">Open latest governed run</button><span>{run.id.slice(0, 8)} · {run.status}</span></div> : null}
      </> : null}
      {activeView === "Runs" ? <div className="run-workbench"><div className="section-heading"><span>Validated deterministic runs</span><b>{snapshot.governanceRuns?.length ?? 0}</b></div>{run ? <article><header><div><small>{run.student_name} · {run.risk_band} context</small><h2>{run.recommendation.summary}</h2></div><span className={`case-state case-${run.case_status}`}>{run.case_status.replaceAll("_", " ")}</span></header><div className="run-metrics"><span>mode <b>{run.mode}</b></span><span>validation <b>{String(run.validation.valid ?? false).toUpperCase()}</b></span><span>replays <b>{run.replay_count}</b></span></div><div className="run-inspection-actions"><button type="button" onClick={() => setShowStages((visible) => !visible)} data-action-id="governance-inspect-stage">{showStages ? "Hide run stages" : "Inspect run stages"}</button><button type="button" onClick={() => setShowValidation((visible) => !visible)} data-action-id="governance-inspect-validation">{showValidation ? "Hide validation" : "Inspect validation"}</button><button type="button" onClick={() => setShowComparison((visible) => !visible)} disabled={!previousRun} aria-describedby={!previousRun ? "comparison-constraint" : undefined} data-action-id="governance-compare-runs">{showComparison ? "Close comparison" : "Compare latest runs"}</button></div>{!previousRun ? <small id="comparison-constraint" className="control-constraint">A second completed run is required before version comparison becomes valid.</small> : null}{showStages ? <div className="run-stage-grid"><span><b>01</b> Event authorized</span><span><b>02</b> Evidence frozen</span><span><b>03</b> Policy evaluated</span><span><b>04</b> Artifact validated</span><span><b>05</b> Faculty interrupt created</span></div> : null}{showValidation ? <div className="validation-detail"><code>{JSON.stringify(run.validation, null, 2)}</code></div> : null}{showComparison && previousRun ? <div className="run-comparison"><article><small>Latest</small><b>{run.id.slice(0, 8)}</b><span>{run.content_hash.slice(0, 12)}</span></article><article><small>Previous</small><b>{previousRun.id.slice(0, 8)}</b><span>{previousRun.content_hash.slice(0, 12)}</span></article></div> : null}<ol>{run.recommendation.actions.map((action) => <li key={action.code}>{action.label}</li>)}</ol><div className="run-actions"><button type="button" onClick={() => void replay()} disabled={pending === "replay"} data-action-id="governance-replay-run">{pending === "replay" ? "Replaying…" : "Replay + verify hashes"}</button><a href={`/api/bff/governance/runs/${run.id}`} download data-action-id="governance-download-evidence">Download evidence JSON <span aria-hidden="true">↓</span></a></div></article> : <div className="empty-support"><span>0</span><p>Process one academic event to create a governed run.</p></div>}</div> : null}
      {activeView === "Evidence" ? <div className="evidence-workbench"><div className="section-heading"><span>Frozen lineage</span><b>{run ? 1 : 0}</b></div>{run ? <article><div><small>Input SHA-256</small><code>{run.input_hash}</code></div><div><small>Artifact SHA-256</small><code>{run.content_hash}</code></div><div><small>Policy result</small><b>{String(run.validation.valid ?? false).toUpperCase()} · deterministic</b></div><div className="surface-toolbar compact-toolbar evidence-filter"><label><span>Filter cited evidence</span><input type="search" value={evidenceQuery} onChange={(event) => setEvidenceQuery(event.target.value)} placeholder="Path or statement" data-action-id="governance-filter-evidence" /></label><p><b>{visibleCitations.length}</b> of {run.recommendation.citations.length} citations</p></div><h2>Cited evidence</h2>{visibleCitations.map((citation) => <p key={citation.evidencePath}><code>{citation.evidencePath}</code>{citation.statement}</p>)}{!visibleCitations.length ? <p className="filter-empty">No citation matches this evidence filter.</p> : null}<a href={`/api/bff/governance/runs/${run.id}`} download data-action-id="governance-download-evidence">Export immutable evidence package <span aria-hidden="true">↓</span></a></article> : <div className="empty-support"><span>0</span><p>No frozen evidence exists in this generation.</p></div>}</div> : null}
      {activeView === "Simulation" ? <div className="simulation-workbench"><div className="section-heading"><span>Synthetic generation control</span><b>destructive</b></div><article><p className="kicker">Explicit operator boundary</p><h2>Start a clean institutional generation.</h2><p>This switches every portal to a deterministic fresh seed. The current generation becomes inactive but remains in the audit database. This cannot affect a real student because the ecosystem contains synthetic records only.</p><button type="button" className="reset-preview-trigger" onClick={() => setShowResetPreview((visible) => !visible)} data-action-id="governance-preview-reset">{showResetPreview ? "Close reset preview" : "Preview reset effects"}</button>{showResetPreview ? <div className="reset-preview"><b>Reset will</b><ul><li>deactivate the current synthetic generation</li><li>seed 12 students, 9 parents, 4 faculty, 2 HODs, and 6 offerings</li><li>preserve prior audit and evidence rows</li><li>change no real institution or person data</li></ul></div> : null}<label htmlFor="simulation-confirmation">Type <code>AURA-SYNTHETIC-SEED-V1</code> to confirm</label><input id="simulation-confirmation" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} autoComplete="off" spellCheck={false} data-action-id="governance-enter-reset-confirmation" /><button type="button" onClick={() => void resetSimulation()} disabled={pending === "reset" || resetConfirmation !== "AURA-SYNTHETIC-SEED-V1"} data-action-id="governance-reset-simulation">{pending === "reset" ? "Creating generation…" : "Reset synthetic ecosystem"}</button><small>Authentication, governance role, exact confirmation, and database transaction are all required.</small></article></div> : null}
    </section>
  );
}

export function PortalHome({ portal, release, initialPath = "/dashboard" }: { portal: PortalDefinition; release?: string; initialPath?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "guest" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [activeView, setActiveView] = useState(viewForPath(portal.id, initialPath));
  const [selectedChildId, setSelectedChildId] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = portal.id === "parent" && selectedChildId ? `?childId=${encodeURIComponent(selectedChildId)}` : "";
      const response = await fetch(`/api/bff/dashboard${query}`, { cache: "no-store" });
      const result = await response.json() as ApiResult<Snapshot>;
      if (response.status === 401) { setStatus("guest"); setSnapshot(null); }
      else if (!result.ok) { setError(result.error.message); setStatus("error"); }
      else if (!response.headers.get("x-csrf-token")) { setError("The session security token is missing."); setStatus("error"); }
      else if (result.data.actor.role !== portal.id) { setError("This identity belongs to a different portal."); setStatus("error"); }
      else {
        setCsrfToken(response.headers.get("x-csrf-token")!);
        setSnapshot(result.data); setStatus("ready"); setError("");
        if (portal.id === "parent" && !selectedChildId && result.data.selectedChildId) setSelectedChildId(result.data.selectedChildId);
      }
    } catch { setError("The portal could not reach its Core service."); setStatus("error"); }
    finally { setRefreshing(false); }
  }, [portal.id, selectedChildId]);

  // The session is held in an HTTP-only cookie, so the first client render must probe the same-origin BFF.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);
  useEffect(() => {
    const restoreView = () => setActiveView(viewForPath(portal.id, window.location.pathname));
    restoreView();
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, [portal.id]);

  const navigate = useCallback((view: string) => {
    setActiveView(view);
    const route = routeForView(portal.id, view);
    if (window.location.pathname !== route) window.history.pushState({}, "", route);
  }, [portal.id]);

  async function signOut() {
    try {
      const response = await fetch("/api/session/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
      if (!response.ok) { setError("Sign-out was rejected. Refresh the session and try again."); setStatus("error"); return; }
      setSnapshot(null); setCsrfToken(""); setStatus("guest");
    } catch { setError("The identity service could not complete sign-out."); setStatus("error"); }
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
          <a href={`/api/session/login?returnTo=${encodeURIComponent(routeForView(portal.id, activeView))}`} data-action-id={`${portal.id}-sign-in`}>Enter as {portal.actor}<span aria-hidden="true">↗</span></a>
          <small>Synthetic institutional simulation · no real student data</small>
        </section>
      ) : null}
      {status === "error" ? <section className="error-state"><p className="kicker">Boundary response</p><h1>Access stopped.</h1><p>{error}</p><button type="button" onClick={() => void load()} data-action-id={`${portal.id}-retry`}>Retry</button></section> : null}
      {status === "ready" && snapshot ? (
        <>
          <PortalMasthead portal={portal} snapshot={snapshot} refresh={() => void load()} signOut={() => void signOut()} refreshing={refreshing} activeView={activeView} navigate={navigate} />
          <div className="portal-workspace">
            {portal.id === "student" && activeView === "Today" ? <StudentSurface snapshot={snapshot} /> : null}
            {portal.id === "student" && activeView === "Registration" ? <StudentRegistrationSurface snapshot={snapshot} refresh={load} csrfToken={csrfToken} /> : null}
            {portal.id === "student" && activeView === "Academics" ? <StudentAcademicsSurface snapshot={snapshot} /> : null}
            {portal.id === "student" && activeView === "Fees" ? <StudentFeesSurface snapshot={snapshot} /> : null}
            {portal.id === "student" && activeView === "Support" ? <SupportPlanSurface plans={snapshot.supportPlans} audience="student" /> : null}
            {portal.id === "student" && activeView === "Account" ? <StudentAccountSurface snapshot={snapshot} refresh={load} csrfToken={csrfToken} /> : null}
            {portal.id === "parent" && activeView === "Overview" ? <ParentSurface snapshot={snapshot} chooseChild={setSelectedChildId} /> : null}
            {portal.id === "parent" && activeView === "Children" ? <ParentAcademicsSurface snapshot={snapshot} /> : null}
            {portal.id === "parent" && activeView === "Fees" ? <ParentFeesSurface snapshot={snapshot} refresh={load} csrfToken={csrfToken} /> : null}
            {portal.id === "parent" && activeView === "Access" ? <ParentAccessSurface snapshot={snapshot} /> : null}
            {portal.id === "faculty" ? <FacultySurface snapshot={snapshot} activeView={activeView} refresh={load} csrfToken={csrfToken} navigate={navigate} /> : null}
            {portal.id === "hod" ? <HodSurface snapshot={snapshot} refresh={load} activeView={activeView} csrfToken={csrfToken} /> : null}
            {portal.id === "governance" ? <GovernanceSurface snapshot={snapshot} activeView={activeView} refresh={load} csrfToken={csrfToken} navigate={navigate} /> : null}
            <ActivityRail activity={snapshot.activity} portal={portal.id} navigate={navigate} />
          </div>
          <footer className="portal-footer"><span>AURA Institute of Technology</span><span>Synthetic ecosystem / {portal.id} / build {(release ?? "local").slice(0, 8)}</span></footer>
        </>
      ) : null}
    </main>
  );
}
