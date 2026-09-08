"use client";
import {
  useEffect,
  useState,
  useMemo,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  experienceViewRoutes,
  type PortalId,
  type ExperienceOverview,
  type StudentDetail,
  type ExperienceCourse,
  type Followup,
} from "@aura/contracts";
import {
  Workspace,
  PageTitle,
  Notice,
  Empty,
  PortalEntry,
  usePortalApi,
  portalUrl,
  dateTime,
} from "./workspace";
import {
  CourseManager,
  ClassroomView,
  FacultyDirectory,
  StudentControls,
} from "./management";
import { AiWorkspace, SupportReviews } from "./reviews";
type EverydayPortal = Exclude<PortalId, "lms">;
export type SaveChange = (input: unknown) => Promise<boolean>;
export function Field({
  label,
  name,
  value,
  type = "text",
  required = true,
  children,
  ...props
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  children?: ReactNode;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}) {
  return (
    <label>
      {label}
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={value ?? ""}
          required={required}
          {...props}
        />
      )}
    </label>
  );
}
export function Why({ value = "" }: { value?: string }) {
  return <Field label="Reason for this change" name="reason" value={value} />;
}
export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
export function str(f: FormData, key: string) {
  return String(f.get(key) ?? "");
}
export function num(f: FormData, key: string) {
  return Number(f.get(key));
}
export function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}
export function day(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
const weekdays = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export function Timetable({ courses }: { courses: ExperienceCourse[] }) {
  const slots = courses
    .flatMap((c) =>
      c.slots.map((s) => ({ ...s, code: c.code, title: c.title })),
    )
    .sort(
      (a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at),
    );
  return slots.length ? (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Scrollable records table"
    >
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Time</th>
            <th>Course</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td>{weekdays[s.weekday]}</td>
              <td>
                {s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)}
              </td>
              <td>
                <b>{s.code}</b>
                <small>{s.title}</small>
              </td>
              <td>{s.room}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No classes scheduled">
      Your timetable will appear when courses and class times are assigned.
    </Empty>
  );
}
export function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function Jump({
  title,
  children,
  onClick,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="jump-card" onClick={onClick}>
      <b>{title}</b>
      <span>{children}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}
export function SupportText({ plan }: { plan: Record<string, unknown> }) {
  return (
    <div className="prose">
      <p>
        {typeof plan.summary === "string"
          ? plan.summary
          : "Your mentor has shared the following support steps."}
      </p>
      {Array.isArray(plan.actions) ? (
        <ol>
          {plan.actions.map((action, i) => {
            const a =
              typeof action === "object" && action !== null
                ? (action as Record<string, unknown>)
                : {};
            return (
              <li key={i}>
                <b>
                  {String(
                    a.label ?? a.title ?? a.action ?? a.type ?? "Support step",
                  )}
                </b>
                {typeof a.description === "string" ? (
                  <p>{a.description}</p>
                ) : null}
                {typeof a.owner === "string" ? (
                  <small>
                    With:{" "}
                    {a.owner === "assigned_faculty" ? "Your mentor" : a.owner}
                  </small>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

export function ExperiencePortal({ portal }: { portal: EverydayPortal }) {
  const api = usePortalApi<ExperienceOverview>("/api/bff/experience/overview");
  const routes = experienceViewRoutes[portal] as Record<string, string>;
  const sections = useMemo(() => Object.keys(routes), [routes]);
  const [section, setSection] = useState(sections[0]!);
  const [selected, setSelected] = useState("");
  const [classId, setClassId] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const sync = () => {
      setSection(
        Object.keys(routes).find(
          (key) => routes[key] === window.location.pathname,
        ) ?? sections[0]!,
      );
      setSelected(
        new URLSearchParams(window.location.search).get("student") ?? "",
      );
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", sync);
    };
  }, [routes, sections]);
  const navigate = (next: string, student = "") => {
    setSection(next);
    setSelected(student);
    setClassId("");
    setMessage("");
    void api.refresh();
    window.history.pushState(
      {},
      "",
      `${routes[next]}${student ? `?student=${encodeURIComponent(student)}` : ""}`,
    );
  };
  const save: SaveChange = async (input) => {
    const result = await api.command("/api/bff/experience/commands", input);
    if (!result) return false;
    setMessage("Saved. The connected records are up to date.");
    await api.refresh();
    return true;
  };
  if (api.signedOut)
    return (
      <PortalEntry
        portal={portal}
        description={
          portal === "faculty"
            ? "See your classes, find students who need help, and record the next step."
            : portal === "hod"
              ? "Manage your department, courses and mentoring in one place."
              : portal === "parent"
                ? "Check attendance, results, fees and updates shared by your child’s mentor."
                : portal === "governance"
                  ? "Follow each student review and see what the agents have done."
                  : "Register for courses, see your timetable and keep track of your progress."
        }
      />
    );
  const data = api.data;
  if (!data)
    return (
      <main className="loading-page">
        {api.error ? (
          <>
            <Notice error>{api.error}</Notice>
            <button onClick={() => void api.refresh()}>Try again</button>
          </>
        ) : (
          <p role="status">Loading your portal…</p>
        )}
      </main>
    );
  const studentId =
    portal === "student"
      ? data.actor.student_id
      : portal === "parent"
        ? selected || data.children[0]?.id
        : selected;
  let content: ReactNode;
  if (portal === "governance")
    content = <AiWorkspace section={section} actorRole={data.actor.role} />;
  else if (portal === "student" && section === "Course registration")
    content = (
      <Registration
        key={data.registration.map((r) => `${r.id}-${r.revision}`).join(",")}
        data={data}
        save={save}
        pending={api.pending}
      />
    );
  else if (portal === "student" && section === "Timetable")
    content = (
      <>
        <PageTitle
          title="Timetable"
          description="Your registered classes for the current semester."
        />
        <Timetable
          courses={data.courses.filter(
            (c) => c.registration_status === "registered",
          )}
        />
        <a className="button-link secondary" href={portalUrl("lms")}>
          Open LMS
        </a>
      </>
    );
  else if (portal === "student" || portal === "parent")
    content = studentId ? (
      <StudentRecord
        key={studentId}
        id={studentId}
        section={section}
        data={data}
        portal={portal}
        navigate={navigate}
      />
    ) : (
      <Empty title="No linked student">
        An active student profile or parent link is needed to show records.
      </Empty>
    );
  else if (classId)
    content = <ClassroomView id={classId} onBack={() => setClassId("")} />;
  else if (portal === "faculty" && section === "My timetable")
    content = (
      <>
        <PageTitle
          title="My timetable"
          description="Your assigned teaching schedule and class records."
        />
        <Timetable courses={data.courses} />
        <h2>Class records</h2>
        <CourseLinks courses={data.courses} open={setClassId} />
      </>
    );
  else if (
    (portal === "faculty" && section === "My students") ||
    (portal === "hod" && section === "Students")
  )
    content = studentId ? (
      <>
        <button className="back-link" onClick={() => navigate(section)}>
          ← Back to students
        </button>
        <StudentRecord
          key={studentId}
          id={studentId}
          section="Profile"
          data={data}
          portal={portal}
          navigate={navigate}
        />
      </>
    ) : (
      <StudentDirectory data={data} open={(id) => navigate(section, id)} />
    );
  else if (portal === "faculty" && section === "Support & follow-ups")
    content = <SupportReviews data={data} onRefresh={api.refresh} />;
  else if (portal === "hod" && section === "Faculty")
    content = (
      <FacultyDirectory data={data} save={save} pending={api.pending} />
    );
  else if (portal === "hod" && section === "Courses & timetables")
    content = (
      <CourseManager
        data={data}
        save={save}
        pending={api.pending}
        openClass={setClassId}
      />
    );
  else if (portal === "hod" && section === "AI activity")
    content = (
      <>
        <PageTitle
          title="AI activity"
          description="Department reviews and controls."
        />
        <AiWorkspace section="Reviews" actorRole="hod" embedded />
        <details className="panel">
          <summary>Support suggestions and outcomes</summary>
          <SupportReviews data={data} onRefresh={api.refresh} />
        </details>
      </>
    );
  else
    content = (
      <>
        <PageTitle
          title={portal === "hod" ? "Department overview" : "Your day"}
          description={
            portal === "hod"
              ? data.department
              : "Start with your classes or your mentees."
          }
        />
        <div className="stats-row">
          {portal === "hod" ? (
            <>
              <Metric label="Students" value={data.counts.students} />
              <Metric label="Faculty" value={data.counts.faculty} />
              <Metric label="Courses" value={data.counts.courses} />
            </>
          ) : (
            <>
              <Metric label="Mentees" value={data.students.length} />
              <Metric
                label="Teaching assignments"
                value={data.courses.length}
              />
            </>
          )}
          <Metric
            label="Reviews awaiting a decision"
            value={data.counts.pending_reviews}
          />
        </div>
        <h2>Next steps</h2>
        <div className="jump-grid">
          {portal === "hod" ? (
            <>
              <Jump title="Faculty" onClick={() => navigate("Faculty")}>
                Check teaching and mentoring workload.
              </Jump>
              <Jump title="Students" onClick={() => navigate("Students")}>
                Open student records and mentor assignments.
              </Jump>
              <Jump
                title="Courses & timetables"
                onClick={() => navigate("Courses & timetables")}
              >
                {data.counts.draft_courses} courses waiting to be published.
              </Jump>
              <Jump title="AI activity" onClick={() => navigate("AI activity")}>
                {data.counts.failed_reviews} reviews need attention.
              </Jump>
            </>
          ) : (
            <>
              <Jump
                title="My timetable"
                onClick={() => navigate("My timetable")}
              >
                See classes and enter attendance or marks.
              </Jump>
              <Jump title="My students" onClick={() => navigate("My students")}>
                See your mentees and their progress.
              </Jump>
              <Jump
                title="Support & follow-ups"
                onClick={() => navigate("Support & follow-ups")}
              >
                {data.counts.overdue_followups} follow-ups are overdue.
              </Jump>
            </>
          )}
        </div>
      </>
    );
  return (
    <Workspace
      portal={portal}
      sections={sections}
      current={section}
      onNavigate={navigate}
      onSignOut={() => void api.signOut()}
      viewer={`${data.actor.name} · ${data.actor.role === "hod" ? "HoD" : data.actor.role}`}
    >
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {portal === "parent" && data.children.length > 1 ? (
        <label className="child-picker">
          Viewing
          <select
            value={studentId ?? ""}
            onChange={(e) => navigate(section, e.target.value)}
          >
            {data.children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {content}
    </Workspace>
  );
}
export function CourseLinks({
  courses,
  open,
}: {
  courses: ExperienceCourse[];
  open: (id: string) => void;
}) {
  return courses.length ? (
    <div className="item-list">
      {courses.map((c) => (
        <article className="list-item" key={c.id}>
          <div>
            <h3>
              {c.code} · {c.title}
            </h3>
            <p>
              {c.section} · {c.enrolled} enrolled · {c.status}
            </p>
          </div>
          <button onClick={() => open(c.id)}>Open class</button>
        </article>
      ))}
    </div>
  ) : (
    <Empty title="No assigned courses">
      Course assignments from the HoD will appear here.
    </Empty>
  );
}
function StudentDirectory({
  data,
  open,
}: {
  data: ExperienceOverview;
  open: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = data.students.filter((s) =>
    `${s.name} ${s.register_number}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title={data.actor.role === "hod" ? "Students" : "My students"}
        description={
          data.actor.role === "hod"
            ? "Find a student to view or correct their records."
            : "Your assigned mentees. Students with open support cases appear first."
        }
      />
      <label className="search-field">
        Find a student
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or register number"
        />
      </label>
      {filtered.length ? (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records table"
        >
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Mentor</th>
                <th>Open support cases</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <small>
                      {s.register_number} · Semester {s.semester}
                    </small>
                  </td>
                  <td>{s.mentor_name ?? "Not assigned"}</td>
                  <td>{s.attention_count ?? 0}</td>
                  <td>
                    <button onClick={() => open(s.id)}>View student</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No students found">
          Try another name or check mentor assignments.
        </Empty>
      )}
    </>
  );
}
function Registration({
  data,
  save,
  pending,
}: {
  data: ExperienceOverview;
  save: SaveChange;
  pending: boolean;
}) {
  const terms = data.terms.filter((t) => t.active);
  const [term, setTerm] = useState(terms[0]?.id ?? "");
  const submission = data.registration.find((r) => r.term_id === term);
  const courses = data.courses.filter(
    (c) => c.term_id === term && c.registration_status !== "completed",
  );
  const locked = submission?.status === "submitted";
  const [chosen, setChosen] = useState<string[]>(
    courses
      .filter((c) => c.registration_status === "registered")
      .map((c) => c.id),
  );
  const [review, setReview] = useState(false);
  const selected = courses.filter((c) => chosen.includes(c.id));
  return (
    <>
      <PageTitle
        title="Course registration"
        description={
          locked
            ? "Your course selection has been submitted. Contact your HoD if it needs a correction."
            : "Choose your courses, review the timetable, then submit your selection once."
        }
      />
      {terms.length > 1 ? (
        <Field label="Semester" name="term">
          <select
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setChosen(
                data.courses
                  .filter(
                    (c) =>
                      c.term_id === e.target.value &&
                      c.registration_status === "registered",
                  )
                  .map((c) => c.id),
              );
              setReview(false);
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {locked ? (
        <>
          <Notice>Submitted {dateTime(submission.submitted_at)}</Notice>
          <CourseSelection
            courses={courses.filter(
              (c) => c.registration_status === "registered",
            )}
          />
          <a className="button-link primary" href={portalUrl("lms")}>
            Go to LMS
          </a>
        </>
      ) : review ? (
        <>
          <h2>Check your selection</h2>
          <p>
            {selected.length} {selected.length === 1 ? "course" : "courses"} ·{" "}
            {selected.reduce((sum, c) => sum + c.credits, 0)} credits
          </p>
          <CourseSelection courses={selected} />
          <Timetable courses={selected} />
          <p>
            After you submit, your HoD must reopen registration before you can
            change these courses.
          </p>
          <div className="form-actions">
            <button
              className="primary"
              disabled={pending}
              onClick={async () => {
                if (
                  await save({
                    action: "submit-registration",
                    termId: term,
                    offeringIds: chosen,
                    expectedRevision: submission?.revision ?? -1,
                  })
                )
                  setReview(false);
              }}
            >
              {pending ? "Submitting…" : "Submit course selection"}
            </button>
            <button disabled={pending} onClick={() => setReview(false)}>
              Change selection
            </button>
          </div>
        </>
      ) : (
        <>
          {courses.length ? (
            <div className="item-list">
              {courses.map((c) => (
                <label className="course-choice" key={c.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.id)}
                    disabled={c.status !== "published"}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, c.id]
                          : chosen.filter((id) => id !== c.id),
                      )
                    }
                  />
                  <span>
                    <b>
                      {c.code} · {c.title}
                    </b>
                    <small>
                      {c.credits} credits · {c.enrolled}/{c.capacity} seats
                      filled · {c.faculty_name ?? "Faculty not assigned"}
                    </small>
                    <small>
                      {c.slots
                        .map(
                          (s) =>
                            `${weekdays[s.weekday]} ${s.starts_at.slice(0, 5)}–${s.ends_at.slice(0, 5)}`,
                        )
                        .join(" · ")}
                    </small>
                    {c.prerequisites.length ? (
                      <small>Prerequisites: {c.prerequisites.join(", ")}</small>
                    ) : null}
                    <small>
                      Registration {c.window_status ?? "not opened"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <Empty title="No courses available">
              Published courses for this semester will appear here.
            </Empty>
          )}
          <div className="form-actions">
            <button
              className="primary"
              disabled={!chosen.length || pending}
              onClick={() => setReview(true)}
            >
              Review selection
            </button>
          </div>
        </>
      )}
    </>
  );
}
function CourseSelection({ courses }: { courses: ExperienceCourse[] }) {
  return (
    <ul className="plain-list">
      {courses.map((c) => (
        <li key={c.id}>
          <b>
            {c.code} · {c.title}
          </b>
          <span>{c.credits} credits</span>
        </li>
      ))}
    </ul>
  );
}
export function StudentRecord({
  id,
  section,
  data,
  portal,
  navigate,
}: {
  id: string;
  section: string;
  data: ExperienceOverview;
  portal: Exclude<PortalId, "lms" | "governance">;
  navigate: (section: string, student?: string) => void;
}) {
  const api = usePortalApi<StudentDetail>(`/api/bff/experience/students/${id}`);
  const [tab, setTab] = useState("Progress");
  const [message, setMessage] = useState("");
  const [followup, setFollowup] = useState<Followup | null | undefined>(
    undefined,
  );
  const save: SaveChange = async (input) => {
    if (!(await api.command("/api/bff/experience/commands", input)))
      return false;
    await api.refresh();
    setMessage("Saved.");
    return true;
  };
  if (!api.data)
    return (
      <>
        {api.error ? (
          <Notice error>{api.error}</Notice>
        ) : (
          <p role="status">Loading student records…</p>
        )}
      </>
    );
  const record = api.data;
  const staff = portal === "faculty" || portal === "hod";
  const activeSection = staff ? tab : section;
  const progress = ["My progress", "Marks & results", "Progress"].includes(
    activeSection,
  );
  const support = ["My support plan", "Mentor updates", "Support"].includes(
    activeSection,
  );
  const fees = ["Fees & receipts", "Fees"].includes(activeSection);
  return (
    <>
      {staff ? (
        <PageTitle
          title={record.student.name}
          description={`${record.student.register_number} · Semester ${record.student.semester} · Mentor: ${record.mentor?.name ?? "Not assigned"}`}
        />
      ) : (
        <PageTitle
          title={
            section === "Home"
              ? portal === "parent"
                ? `${record.student.name} at a glance`
                : "Your semester"
              : section
          }
          description={
            section === "Home"
              ? "Choose an area to see the details."
              : portal === "parent"
                ? `${record.student.name} · ${record.student.register_number}`
                : undefined
          }
        />
      )}
      {staff ? (
        <nav className="course-tabs" aria-label="Student record sections">
          {[
            "Progress",
            "LMS & career",
            "Fees",
            "Support",
            ...(portal === "hod" ? ["Manage record"] : []),
          ].map((t) => (
            <button
              key={t}
              aria-current={t === tab ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      ) : null}
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {activeSection === "Home" ? (
        <>
          <div className="stats-row">
            <Metric
              label="Registered courses"
              value={
                record.courses.filter(
                  (c) => c.registration_status === "registered",
                ).length
              }
            />
            {record.grants.includes("marks") ? (
              <Metric
                label="CGPA · published results"
                value={record.gpa.cgpa?.toFixed(2) ?? "Not published"}
              />
            ) : null}
            {record.grants.includes("support") ? (
              <Metric
                label="Upcoming follow-ups"
                value={
                  record.followups.filter((f) => f.status !== "completed")
                    .length
                }
              />
            ) : null}
          </div>
          <div className="jump-grid">
            {portal === "student" ? (
              <>
                <Jump
                  title="Course registration"
                  onClick={() => navigate("Course registration")}
                >
                  Choose and confirm your semester courses.
                </Jump>
                <Jump title="Timetable" onClick={() => navigate("Timetable")}>
                  See when and where your classes meet.
                </Jump>
                <Jump
                  title="My progress"
                  onClick={() => navigate("My progress")}
                >
                  Check attendance, marks and published results.
                </Jump>
                <Jump
                  title="My support plan"
                  onClick={() => navigate("My support plan")}
                >
                  See the next steps agreed with your mentor.
                </Jump>
              </>
            ) : (
              <>
                <Jump
                  title="Attendance"
                  onClick={() => navigate("Attendance", id)}
                >
                  Check attendance in each course.
                </Jump>
                <Jump
                  title="Marks & results"
                  onClick={() => navigate("Marks & results", id)}
                >
                  See published marks and semester results.
                </Jump>
                <Jump
                  title="Fees & receipts"
                  onClick={() => navigate("Fees & receipts", id)}
                >
                  Check dues and download demo receipts.
                </Jump>
                <Jump
                  title="Mentor updates"
                  onClick={() => navigate("Mentor updates", id)}
                >
                  Read shared support plans and follow-ups.
                </Jump>
              </>
            )}
          </div>
          {portal === "student" ? (
            <a className="button-link primary" href={portalUrl("lms")}>
              Open LMS
            </a>
          ) : null}
        </>
      ) : null}
      {progress || activeSection === "Attendance" ? (
        <>
          {record.grants.includes("attendance") &&
          activeSection !== "Marks & results" ? (
            <Attendance record={record} />
          ) : null}
          {progress && record.grants.includes("marks") ? (
            <Results record={record} />
          ) : null}
          {!record.grants.includes(
            activeSection === "Attendance" ? "attendance" : "marks",
          ) ? (
            <Empty title="This information is not shared">
              This account does not have access to this part of the student
              record.
            </Empty>
          ) : null}
        </>
      ) : null}
      {fees ? (
        <>
          {record.grants.includes("fees") ? (
            <>
              <h2>Fees & receipts</h2>
              <Notice>Demo payments only. No money is charged.</Notice>
              {record.invoices.length ? (
                record.invoices.map((invoice) => (
                  <article className="panel" key={invoice.id}>
                    <div className="panel-heading">
                      <div>
                        <h3>{invoice.description}</h3>
                        <p>
                          {invoice.invoice_number} · Due {day(invoice.due_on)}
                        </p>
                      </div>
                      <span className="status-badge">{invoice.status}</span>
                    </div>
                    <div className="stats-row">
                      <Metric
                        label="Total"
                        value={money(invoice.amount_paise)}
                      />
                      <Metric label="Paid" value={money(invoice.paid_paise)} />
                      <Metric
                        label="Outstanding"
                        value={money(invoice.amount_paise - invoice.paid_paise)}
                      />
                    </div>
                    {portal === "parent" &&
                    ["due", "partial"].includes(invoice.status) ? (
                      <button
                        className="primary"
                        disabled={api.pending}
                        onClick={async () => {
                          const result = await api.command(
                            `/api/bff/fees/invoices/${invoice.id}/payment-attempts`,
                            {
                              expectedRevision: invoice.revision,
                              scenario: "success",
                            },
                          );
                          if (result) {
                            await api.refresh();
                            setMessage(
                              "Demo payment recorded. Your receipt is ready.",
                            );
                          }
                        }}
                      >
                        Record demo payment of{" "}
                        {money(invoice.amount_paise - invoice.paid_paise)}
                      </button>
                    ) : null}
                    {invoice.transactions.length ? (
                      <ul className="plain-list">
                        {invoice.transactions.map((t) => (
                          <li key={t.id}>
                            <span>
                              {money(t.amount_paise)} · {dateTime(t.created_at)}{" "}
                              · {t.status}
                            </span>
                            {portal === "parent" && t.status === "captured" ? (
                              <a
                                href={`/api/bff/receipts/${t.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download demo receipt
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))
              ) : (
                <Empty title="No fee invoices">
                  Any issued invoices and recorded payments will appear here.
                </Empty>
              )}
            </>
          ) : (
            <Empty title="Fees are not shared">
              This account does not have access to fee information.
            </Empty>
          )}
        </>
      ) : null}
      {support ? (
        <>
          {record.grants.includes("support") ? (
            <>
              {record.mentor ? (
                <article className="panel">
                  <h2>Your mentor</h2>
                  <p>
                    <b>{record.mentor.name}</b>
                  </p>
                  <p>{record.mentor.email}</p>
                  <small>This is a demonstration contact address.</small>
                </article>
              ) : null}
              <h2>Confirmed support plans</h2>
              {record.support.length ? (
                record.support.map((p) => (
                  <article className="panel" key={p.id}>
                    <p className="eyebrow">
                      {p.visible ? "Shared with student" : "Withdrawn"} ·{" "}
                      {day(p.created_at)}
                    </p>
                    <SupportText plan={p.plan} />
                  </article>
                ))
              ) : (
                <Empty title="No confirmed plan yet">
                  A suggested plan appears here after a mentor confirms it.
                </Empty>
              )}
              <div className="section-heading">
                <h2>Follow-ups</h2>
                {staff ? (
                  <button onClick={() => setFollowup(null)}>
                    Add follow-up
                  </button>
                ) : null}
              </div>
              {followup !== undefined ? (
                <FollowupForm
                  key={followup?.id ?? "new"}
                  studentId={id}
                  existing={followup}
                  save={save}
                  pending={api.pending}
                  close={() => setFollowup(undefined)}
                />
              ) : null}
              {record.followups.length ? (
                <div className="item-list">
                  {record.followups.map((f) => (
                    <article key={f.id} className="list-item">
                      <div>
                        <h3>{f.note}</h3>
                        <p>
                          {day(f.due_on)} · {f.status.replaceAll("_", " ")}
                          {f.overdue ? " · Overdue" : ""}
                          {staff
                            ? f.shared
                              ? " · Shared"
                              : " · Mentor only"
                            : ""}
                        </p>
                        {f.outcome ? <p>{f.outcome}</p> : null}
                      </div>
                      {staff ? (
                        <button onClick={() => setFollowup(f)}>
                          Update follow-up
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p>No follow-ups have been recorded.</p>
              )}
            </>
          ) : (
            <Empty title="Mentor updates are not shared">
              This account does not have access to support information.
            </Empty>
          )}
        </>
      ) : null}
      {activeSection === "LMS & career" ? (
        <>
          <h2>Activity and career records</h2>
          <p>
            Lesson access shows that a student opened material. It does not
            prove they understood it.
          </p>
          {record.sources.length ? (
            record.sources.map((s) => (
              <article className="panel" key={s.source}>
                <h3>
                  {s.source === "lms"
                    ? "LMS activity"
                    : s.source === "internship"
                      ? "Internship"
                      : "Placement"}
                </h3>
                <p>
                  {s.state === "not_applicable"
                    ? "Not applicable to this student"
                    : s.state === "missing"
                      ? "No records available"
                      : `Updated ${dateTime(s.observed_at)}`}
                </p>
                {s.state === "present" ? (
                  <dl className="record-fields">
                    {Object.entries(s.values).map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          {(
                            {
                              inactivityDays: "Days since last activity",
                              overdueAssignments: "Overdue assignments",
                              registeredCourses: "Registered courses",
                              neverActive: "No activity recorded yet",
                              missedMilestones: "Missed milestones",
                              missedActivities: "Missed activities",
                            } as Record<string, string>
                          )[key] ?? key.replace(/([A-Z])/g, " $1")}
                        </dt>
                        <dd>
                          {typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "No"
                            : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </article>
            ))
          ) : (
            <Empty title="No activity records">
              Activity will appear as the student uses the LMS and career
              records are added.
            </Empty>
          )}
        </>
      ) : null}
      {activeSection === "Manage record" ? (
        <StudentControls
          record={record}
          data={data}
          save={save}
          pending={api.pending}
        />
      ) : null}
    </>
  );
}
function Attendance({ record }: { record: StudentDetail }) {
  return (
    <section>
      <h2>Attendance by course</h2>
      <p>
        Present and late count as attended. Excused sessions are excluded from
        the percentage.
      </p>
      {record.courses.length ? (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records table"
        >
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Attended</th>
                <th>Missed</th>
                <th>Excused</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {record.courses.map((c) => (
                <tr key={c.offering_id}>
                  <td>
                    <b>{c.code}</b>
                    <small>{c.title}</small>
                  </td>
                  <td>{c.present + c.late}</td>
                  <td>{c.absent}</td>
                  <td>{c.excused}</td>
                  <td>
                    {c.percentage === null ? "No records" : `${c.percentage}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No registered courses yet.</p>
      )}
      <details className="panel">
        <summary>View attendance records</summary>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records table"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Class</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {record.attendance.map((a) => (
                <tr key={a.id}>
                  <td>{day(a.session_date)}</td>
                  <td>{a.code}</td>
                  <td>{a.topic}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function Results({ record }: { record: StudentDetail }) {
  return (
    <section>
      <h2>Published results</h2>
      <p>{record.gpa.label}</p>
      <div className="stats-row">
        <Metric
          label="CGPA"
          value={record.gpa.cgpa?.toFixed(2) ?? "Not published"}
        />
        {record.gpa.terms.map((t) => (
          <Metric
            key={t.id}
            label={`${t.name} SGPA · ${t.graded_courses}/${t.registered_courses} courses graded`}
            value={t.sgpa.toFixed(2)}
          />
        ))}
      </div>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Scrollable records table"
      >
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Credits</th>
              <th>Final marks</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {record.courses.map((c) => (
              <tr key={c.offering_id}>
                <td>
                  <b>{c.code}</b>
                  <small>{c.title}</small>
                </td>
                <td>{c.credits}</td>
                <td>
                  {c.result_published
                    ? c.result_percentage === null
                      ? "Not recorded"
                      : `${c.result_percentage}/100`
                    : "Not published"}
                </td>
                <td>
                  {c.result_published
                    ? `${c.letter} · ${c.grade_point}/10`
                    : "Not published"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Assessment marks</h2>
      {record.marks.length ? (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records table"
        >
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Assessment</th>
                <th>Marks</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {record.marks.map((m) => (
                <tr key={m.id}>
                  <td>{m.code}</td>
                  <td>{m.assessment}</td>
                  <td>
                    {m.score}/{m.maximum_score}
                  </td>
                  <td>{m.feedback || "No written feedback"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No assessment marks have been published.</p>
      )}
    </section>
  );
}
export function FollowupForm({
  studentId,
  existing,
  save,
  pending,
  close,
}: {
  studentId: string;
  existing: Followup | null;
  save: SaveChange;
  pending: boolean;
  close: () => void;
}) {
  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        const f = formValues(e);
        if (
          await save({
            action: "save-followup",
            ...(existing
              ? { id: existing.id, expectedRevision: existing.revision }
              : {}),
            studentId,
            dueOn: str(f, "due"),
            note: str(f, "note"),
            shared: f.get("shared") === "on",
            status: str(f, "status"),
            outcome: str(f, "outcome"),
            reason: str(f, "reason"),
          })
        )
          close();
      }}
    >
      <h3>{existing ? "Update follow-up" : "Add follow-up"}</h3>
      <Field label="Next step" name="note" value={existing?.note} />
      <Field label="Due date" name="due" type="date" value={existing?.due_on} />
      <Field label="Status" name="status">
        <select name="status" defaultValue={existing?.status ?? "planned"}>
          <option value="planned">Planned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </Field>
      <label>
        What happened?
        <textarea name="outcome" defaultValue={existing?.outcome ?? ""} />
      </label>
      <label className="checkbox-label">
        <input
          name="shared"
          type="checkbox"
          defaultChecked={existing?.shared ?? false}
        />
        Share with the student and linked parents who have support access
      </label>
      <Why value={existing ? "" : "Schedule the next mentor follow-up"} />
      <div className="form-actions">
        <button className="primary" disabled={pending}>
          Save follow-up
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
