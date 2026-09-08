"use client";
import { useState } from "react";
import type {
  ExperienceOverview,
  ExperienceCourse,
  StudentDetail,
  Classroom,
} from "@aura/contracts";
import {
  Field,
  Why,
  formValues,
  str,
  num,
  type SaveChange,
} from "./experience";
import { PageTitle, Notice, Empty, usePortalApi, portalUrl } from "./workspace";
export function FacultyDirectory({
  data,
  save,
  pending,
}: {
  data: ExperienceOverview;
  save: SaveChange;
  pending: boolean;
}) {
  const [selected, setSelected] = useState("");
  const faculty = data.faculty.find((f) => f.id === selected);
  return (
    <>
      <PageTitle
        title="Faculty"
        description="Teaching assignments, mentee counts and faculty details."
      />
      {faculty ? (
        <>
          <button className="back-link" onClick={() => setSelected("")}>
            ← Back to faculty
          </button>
          <h2>{faculty.name}</h2>
          <p>{faculty.email}</p>
          <p>
            {faculty.course_count} courses · {faculty.mentee_count} mentees
          </p>
          <h3>Assigned courses</h3>
          <ul className="plain-list">
            {data.courses
              .filter((c) => c.faculty_id === faculty.id)
              .map((c) => (
                <li key={c.id}>
                  {c.code} · {c.title} · {c.section}
                </li>
              ))}
          </ul>
          <h3>Mentees</h3>
          <ul className="plain-list">
            {data.students
              .filter((s) => s.mentor_id === faculty.id)
              .map((s) => (
                <li key={s.id}>
                  {s.name} · {s.register_number}
                </li>
              ))}
          </ul>
          <details className="panel">
            <summary>Correct faculty name</summary>
            <form
              className="form-grid"
              onSubmit={async (e) => {
                const f = formValues(e);
                await save({
                  action: "save-person",
                  id: faculty.id,
                  expectedRevision: faculty.revision ?? 0,
                  name: str(f, "name"),
                  reason: str(f, "reason"),
                });
              }}
            >
              <Field label="Full name" name="name" value={faculty.name} />
              <Why />
              <button className="primary" disabled={pending}>
                Save name
              </button>
            </form>
          </details>
        </>
      ) : (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records table"
        >
          <table>
            <thead>
              <tr>
                <th>Faculty</th>
                <th>Courses</th>
                <th>Mentees</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.faculty.map((f) => (
                <tr key={f.id}>
                  <td>
                    <b>{f.name}</b>
                    <small>{f.email}</small>
                  </td>
                  <td>{f.course_count}</td>
                  <td>{f.mentee_count}</td>
                  <td>
                    <button onClick={() => setSelected(f.id)}>
                      View faculty
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
export function CourseManager({
  data,
  save,
  pending,
  openClass,
}: {
  data: ExperienceOverview;
  save: SaveChange;
  pending: boolean;
  openClass: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ExperienceCourse | null | undefined>(
    undefined,
  );
  return (
    <>
      <PageTitle
        title="Courses & timetables"
        description="Manage course details, teaching assignments, class times and registration."
        action={
          <button className="primary" onClick={() => setEditing(null)}>
            Add course
          </button>
        }
      />
      {editing !== undefined ? (
        <CourseForm
          key={editing?.id ?? "new"}
          course={editing}
          data={data}
          save={save}
          pending={pending}
          close={() => setEditing(undefined)}
        />
      ) : (
        <div className="item-list">
          {data.courses.map((c) => (
            <article className="list-item" key={c.id}>
              <div>
                <h2>
                  {c.code} · {c.title}
                </h2>
                <p>
                  {c.faculty_name ?? "No faculty assigned"} · {c.enrolled}/
                  {c.capacity} enrolled · {c.status}
                </p>
              </div>
              <div className="form-actions">
                <button onClick={() => setEditing(c)}>Edit course</button>
                <button onClick={() => openClass(c.id)}>
                  Attendance & marks
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <details className="panel">
        <summary>Registration dates</summary>
        {data.windows.map((w) => (
          <form
            key={`${w.id}-${w.revision}`}
            className="form-grid"
            onSubmit={async (e) => {
              const f = formValues(e);
              await save({
                action: "save-window",
                id: w.id,
                expectedRevision: w.revision,
                opensAt: localDate(str(f, "opens")),
                closesAt: localDate(str(f, "closes")),
                status: str(f, "status"),
                reason: str(f, "reason"),
              });
            }}
          >
            <h3>{data.terms.find((t) => t.id === w.term_id)?.name}</h3>
            <Field
              label="Opens · India time"
              name="opens"
              type="datetime-local"
              value={indiaDate(w.opens_at)}
            />
            <Field
              label="Closes · India time"
              name="closes"
              type="datetime-local"
              value={indiaDate(w.closes_at)}
            />
            <Field label="Status" name="status">
              <select name="status" defaultValue={w.status}>
                <option value="open">Open</option>
                <option value="scheduled">Scheduled</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <Why />
            <button className="primary" disabled={pending}>
              Save registration dates
            </button>
          </form>
        ))}
      </details>
      {data.grading ? (
        <details className="panel">
          <summary>Grade scale</summary>
          <p>
            Changes apply when a result is next published. Existing published
            grades keep their recorded points.
          </p>
          <form
            key={data.grading.revision}
            className="form-grid"
            onSubmit={async (e) => {
              const f = formValues(e);
              await save({
                action: "save-grading",
                expectedRevision: data.grading!.revision,
                label: str(f, "label"),
                bands: data.grading!.bands.map((_, i) => ({
                  minimum: num(f, `minimum-${i}`),
                  points: num(f, `points-${i}`),
                  letter: str(f, `letter-${i}`),
                })),
                reason: str(f, "reason"),
              });
            }}
          >
            <Field label="Scale name" name="label" value={data.grading.label} />
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Scrollable records table"
            >
              <table>
                <thead>
                  <tr>
                    <th>Minimum marks</th>
                    <th>Grade points</th>
                    <th>Letter</th>
                  </tr>
                </thead>
                <tbody>
                  {data.grading.bands.map((b, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Band ${i + 1} minimum marks`}
                          name={`minimum-${i}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          defaultValue={b.minimum}
                          required
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Band ${i + 1} grade points`}
                          name={`points-${i}`}
                          type="number"
                          min="0"
                          max="10"
                          step="0.01"
                          defaultValue={b.points}
                          required
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Band ${i + 1} letter`}
                          name={`letter-${i}`}
                          defaultValue={b.letter}
                          required
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Why />
            <button className="primary" disabled={pending}>
              Save grade scale
            </button>
          </form>
        </details>
      ) : null}
      <a
        className="button-link secondary"
        href={`${portalUrl("lms")}/api/session/login?account=hod.cse%40aura.invalid&returnTo=%2Fcourses`}
      >
        Manage LMS content
      </a>
    </>
  );
}
function indiaDate(value: string) {
  return new Date(new Date(value).getTime() + 330 * 60000)
    .toISOString()
    .slice(0, 16);
}
function localDate(value: string) {
  return new Date(`${value}:00+05:30`).toISOString();
}
function CourseForm({
  course,
  data,
  save,
  pending,
  close,
}: {
  course: ExperienceCourse | null;
  data: ExperienceOverview;
  save: SaveChange;
  pending: boolean;
  close: () => void;
}) {
  const [slots, setSlots] = useState(
    course?.slots.map((s) => ({
      weekday: s.weekday,
      startsAt: s.starts_at.slice(0, 5),
      endsAt: s.ends_at.slice(0, 5),
      room: s.room,
    })) ?? [{ weekday: 1, startsAt: "09:00", endsAt: "10:00", room: "" }],
  );
  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        const f = formValues(e);
        if (
          await save({
            action: "save-course",
            ...(course
              ? { id: course.id, expectedRevision: course.revision }
              : {}),
            termId: str(f, "term"),
            code: str(f, "code"),
            title: str(f, "title"),
            description: str(f, "description"),
            credits: num(f, "credits"),
            section: str(f, "section"),
            capacity: num(f, "capacity"),
            status: str(f, "status"),
            facultyId: str(f, "faculty"),
            slots,
            reason: str(f, "reason"),
          })
        )
          close();
      }}
    >
      <h2>{course ? "Edit course" : "Add course"}</h2>
      <div className="form-columns">
        <Field label="Course code" name="code" value={course?.code} />
        <Field label="Course title" name="title" value={course?.title} />
        <Field label="Semester" name="term">
          <select
            name="term"
            defaultValue={course?.term_id ?? data.terms[0]?.id}
          >
            {data.terms
              .filter((t) => !course || t.id === course.term_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Section" name="section" value={course?.section ?? "A"} />
        <Field
          label="Credits"
          name="credits"
          type="number"
          min="1"
          max="8"
          value={course?.credits ?? 3}
        />
        <Field
          label="Capacity"
          name="capacity"
          type="number"
          min="1"
          value={course?.capacity ?? 40}
        />
        <Field label="Faculty" name="faculty">
          <select
            name="faculty"
            defaultValue={course?.faculty_id ?? ""}
            required
          >
            <option value="" disabled>
              Select faculty
            </option>
            {data.faculty.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Availability" name="status">
          <select name="status" defaultValue={course?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
      </div>
      <label>
        Description
        <textarea name="description" defaultValue={course?.description ?? ""} />
      </label>
      <h3>Class times</h3>
      {slots.map((s, i) => (
        <div className="slot-editor" key={i}>
          <label>
            Day
            <select
              value={s.weekday}
              onChange={(e) =>
                setSlots(
                  slots.map((a, j) =>
                    j === i ? { ...a, weekday: Number(e.target.value) } : a,
                  ),
                )
              }
            >
              {[
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ].map((d, j) => (
                <option key={d} value={j + 1}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Starts
            <input
              type="time"
              value={s.startsAt}
              required
              onChange={(e) =>
                setSlots(
                  slots.map((a, j) =>
                    j === i ? { ...a, startsAt: e.target.value } : a,
                  ),
                )
              }
            />
          </label>
          <label>
            Ends
            <input
              type="time"
              value={s.endsAt}
              required
              onChange={(e) =>
                setSlots(
                  slots.map((a, j) =>
                    j === i ? { ...a, endsAt: e.target.value } : a,
                  ),
                )
              }
            />
          </label>
          <label>
            Room
            <input
              value={s.room}
              required
              onChange={(e) =>
                setSlots(
                  slots.map((a, j) =>
                    j === i ? { ...a, room: e.target.value } : a,
                  ),
                )
              }
            />
          </label>
          {slots.length > 1 ? (
            <button
              type="button"
              onClick={() => setSlots(slots.filter((_, j) => j !== i))}
            >
              Remove time
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setSlots([
            ...slots,
            { weekday: 1, startsAt: "09:00", endsAt: "10:00", room: "" },
          ])
        }
      >
        Add class time
      </button>
      <Why />
      <div className="form-actions">
        <button className="primary" disabled={pending}>
          Save course
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function StudentControls({
  record,
  data,
  save,
  pending,
}: {
  record: StudentDetail;
  data: ExperienceOverview;
  save: SaveChange;
  pending: boolean;
}) {
  return (
    <>
      <h2>Manage student record</h2>
      <form
        className="panel form-grid"
        onSubmit={async (e) => {
          const f = formValues(e);
          await save({
            action: "assign-mentor",
            studentId: record.student.id,
            facultyId: str(f, "faculty"),
            expectedRevision: record.student.mentor_id
              ? (record.student.mentor_revision ?? 0)
              : -1,
            reason: str(f, "reason"),
          });
        }}
      >
        <h3>Mentor assignment</h3>
        <Field label="Mentor" name="faculty">
          <select
            name="faculty"
            defaultValue={record.student.mentor_id ?? ""}
            required
          >
            <option value="" disabled>
              Select mentor
            </option>
            {data.faculty.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Why />
        <button className="primary" disabled={pending}>
          Assign mentor
        </button>
      </form>
      <h3>Course registration</h3>
      {record.registration.length ? (
        record.registration.map((r) => (
          <article className="panel" key={`${r.id}-${r.revision}`}>
            <p>
              {data.terms.find((t) => t.id === r.term_id)?.name} ·{" "}
              {r.status === "submitted" ? "Submitted" : "Open for changes"}
            </p>
            {r.status === "submitted" ? (
              <form
                className="form-grid"
                onSubmit={async (e) => {
                  const f = formValues(e);
                  await save({
                    action: "reopen-registration",
                    studentId: record.student.id,
                    termId: r.term_id,
                    expectedRevision: r.revision,
                    reason: str(f, "reason"),
                  });
                }}
              >
                <Why />
                <button disabled={pending}>Reopen course selection</button>
              </form>
            ) : (
              <p>
                The student can revise and submit their selection during the
                registration window.
              </p>
            )}
          </article>
        ))
      ) : (
        <p>This student has not submitted a course selection yet.</p>
      )}
      <details className="panel">
        <summary>Correct student name</summary>
        <form
          key={record.student.revision}
          className="form-grid"
          onSubmit={async (e) => {
            const f = formValues(e);
            await save({
              action: "save-person",
              id: record.student.person_id,
              expectedRevision: record.student.revision ?? 0,
              name: str(f, "name"),
              reason: str(f, "reason"),
            });
          }}
        >
          <Field label="Full name" name="name" value={record.student.name} />
          <Why />
          <button disabled={pending}>Save name</button>
        </form>
      </details>
      <h3>Change history</h3>
      {record.history.length ? (
        <div className="item-list">
          {record.history.map((h) => (
            <details className="panel" key={h.id}>
              <summary>
                {h.reason} · {h.actor}
              </summary>
              <pre>
                {JSON.stringify(
                  { previous: h.previous, updated: h.updated },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
        </div>
      ) : (
        <p>No corrections have been recorded.</p>
      )}
    </>
  );
}
export function ClassroomView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const api = usePortalApi<Classroom>(`/api/bff/experience/classrooms/${id}`);
  const [tab, setTab] = useState("Attendance");
  const [edit, setEdit] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const save: SaveChange = async (input) => {
    if (!(await api.command("/api/bff/experience/commands", input)))
      return false;
    await api.refresh();
    setMessage("Published. Student and parent records are up to date.");
    return true;
  };
  const data = api.data;
  return (
    <>
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {data ? (
        <>
          <PageTitle
            title={`${data.course.code} · ${data.course.title}`}
            description={`${data.roster.length} enrolled students · ${data.course.section}`}
          />
          <nav className="course-tabs" aria-label="Class records">
            {["Attendance", "Assessment marks", "Final results"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => {
                  setTab(t);
                  setEdit(undefined);
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          {!data.roster.length ? (
            <Empty title="No students enrolled">
              Students will appear after registering for this course.
            </Empty>
          ) : tab === "Final results" ? (
            <>
              <p>
                Publish the final course result after assessment. GPA uses these
                results and course credits.
              </p>
              {data.roster.map((s) => {
                const result = data.results.find((r) => r.student_id === s.id);
                return (
                  <details
                    className="panel"
                    key={`${s.id}-${result?.revision}`}
                  >
                    <summary>
                      {s.name} ·{" "}
                      {result?.published
                        ? `${result.percentage ?? "Not recorded"}/100`
                        : "Not published"}
                    </summary>
                    <form
                      className="form-grid"
                      onSubmit={async (e) => {
                        const f = formValues(e);
                        await save({
                          action: "publish-result",
                          studentId: s.id,
                          offeringId: id,
                          expectedRevision: result?.revision ?? -1,
                          percentage: num(f, "percentage"),
                          published: true,
                          reason: str(f, "reason"),
                        });
                      }}
                    >
                      <Field
                        label="Final marks out of 100"
                        name="percentage"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={result?.percentage}
                      />
                      <Why />
                      <button className="primary" disabled={api.pending}>
                        Publish final result
                      </button>
                    </form>
                  </details>
                );
              })}
            </>
          ) : (
            <>
              <button className="primary" onClick={() => setEdit(null)}>
                {tab === "Attendance"
                  ? "New attendance sheet"
                  : "New assessment"}
              </button>
              {edit !== undefined ? (
                <AcademicForm
                  key={`${tab}-${edit ?? "new"}`}
                  kind={tab === "Attendance" ? "attendance" : "marks"}
                  existingId={edit}
                  data={data}
                  save={save}
                  pending={api.pending}
                  close={() => setEdit(undefined)}
                />
              ) : (
                <div className="item-list">
                  {(tab === "Attendance"
                    ? data.sessions.map((s) => ({
                        id: s.id,
                        title: s.topic,
                        note: `${s.session_date} · ${s.status}`,
                      }))
                    : data.assessments.map((a) => ({
                        id: a.id,
                        title: a.title,
                        note: `${a.maximum_score} marks · ${a.published ? "Published" : "Draft"}`,
                      }))
                  ).map((item) => (
                    <article className="list-item" key={item.id}>
                      <div>
                        <h3>{item.title}</h3>
                        <p>{item.note}</p>
                      </div>
                      <button onClick={() => setEdit(item.id)}>
                        Open records
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          <a
            className="button-link secondary"
            href={`${portalUrl("lms")}/courses?course=${id}`}
          >
            Open course in LMS
          </a>
        </>
      ) : (
        <p role="status">Loading class records…</p>
      )}
    </>
  );
}
function AcademicForm({
  kind,
  existingId,
  data,
  save,
  pending,
  close,
}: {
  kind: "attendance" | "marks";
  existingId: string | null;
  data: Classroom;
  save: SaveChange;
  pending: boolean;
  close: () => void;
}) {
  const sheet = data.sessions.find((s) => s.id === existingId);
  const assessment = data.assessments.find((a) => a.id === existingId);
  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        const f = formValues(e);
        const common = {
          offeringId: data.course.id,
          ...(existingId
            ? {
                id: existingId,
                expectedRevision: sheet?.revision ?? assessment?.revision,
              }
            : {}),
          reason: str(f, "reason"),
        };
        const input =
          kind === "attendance"
            ? {
                ...common,
                action: "save-attendance",
                sessionDate: str(f, "date"),
                topic: str(f, "title"),
                records: data.roster.map((s) => ({
                  studentId: s.id,
                  status: str(f, s.id),
                })),
              }
            : {
                ...common,
                action: "save-marks",
                title: str(f, "title"),
                maximumScore: num(f, "maximum"),
                weightPercent: num(f, "weight"),
                marks: data.roster.map((s) => ({
                  studentId: s.id,
                  score: num(f, s.id),
                  feedback: str(f, `feedback-${s.id}`),
                })),
              };
        if (await save(input)) close();
      }}
    >
      <h2>{kind === "attendance" ? "Attendance sheet" : "Assessment marks"}</h2>
      <Field
        label={kind === "attendance" ? "Class topic" : "Assessment title"}
        name="title"
        value={sheet?.topic ?? assessment?.title}
      />
      {kind === "attendance" ? (
        <Field
          label="Class date"
          name="date"
          type="date"
          value={sheet?.session_date}
        />
      ) : (
        <div className="form-columns">
          <Field
            label="Maximum marks"
            name="maximum"
            type="number"
            min="1"
            value={assessment?.maximum_score ?? 100}
          />
          <Field
            label="Assessment weight (%)"
            name="weight"
            type="number"
            min="0"
            max="100"
            value={assessment?.weight_percent ?? 25}
          />
        </div>
      )}
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
              <th>{kind === "attendance" ? "Attendance" : "Marks"}</th>
              {kind === "marks" ? <th>Feedback</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.roster.map((s) => (
              <tr key={s.id}>
                <td>
                  <b>{s.name}</b>
                  <small>{s.register_number}</small>
                </td>
                <td>
                  {kind === "attendance" ? (
                    <select
                      name={s.id}
                      aria-label={`Attendance for ${s.name}`}
                      defaultValue={
                        sheet?.records.find((r) => r.student_id === s.id)
                          ?.status ?? ""
                      }
                      required
                    >
                      <option value="" disabled>
                        Select status
                      </option>
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="late">Late</option>
                      <option value="excused">Excused</option>
                    </select>
                  ) : (
                    <input
                      name={s.id}
                      aria-label={`Marks for ${s.name}`}
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        assessment?.marks.find((m) => m.student_id === s.id)
                          ?.score ?? ""
                      }
                      required
                    />
                  )}
                </td>
                {kind === "marks" ? (
                  <td>
                    <input
                      name={`feedback-${s.id}`}
                      aria-label={`Feedback for ${s.name}`}
                      defaultValue={
                        assessment?.marks.find((m) => m.student_id === s.id)
                          ?.feedback ?? ""
                      }
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Why
        value={
          existingId
            ? ""
            : kind === "attendance"
              ? "Publish class attendance"
              : "Publish assessment marks"
        }
      />
      <div className="form-actions">
        <button className="primary" disabled={pending}>
          {kind === "attendance" ? "Publish attendance" : "Publish marks"}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
