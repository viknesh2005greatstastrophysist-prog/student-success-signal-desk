"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  LmsAssignment,
  LmsCourseDetail,
  LmsLesson,
  LmsOverview,
  LmsSubmission,
} from "@aura/contracts";
import {
  dateTime,
  Empty,
  Notice,
  PageTitle,
  PortalEntry,
  selectedFile,
  usePortalApi,
  Workspace,
} from "./workspace";

export function LmsPortal() {
  const api = usePortalApi<LmsOverview>("/api/bff/lms/overview");
  const [section, setSection] = useState("Home");
  const [course, setCourse] = useState<LmsCourseDetail | null>(null);
  const [tab, setTab] = useState("Lessons");
  const [lesson, setLesson] = useState<LmsLesson | null>(null);
  const [assignment, setAssignment] = useState<LmsAssignment | null>(null);
  const [editing, setEditing] = useState<"lesson" | "assignment" | null>(null);
  const [message, setMessage] = useState("");
  const detailRequest = useRef(0);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const { read, setError } = api;
  const loadCourse = useCallback(
    async (id: string) => {
      const version = ++detailRequest.current;
      setLoadingCourse(true);
      try {
        const detail = await read<LmsCourseDetail>(
          `/api/bff/lms/courses/${id}`,
        );
        if (version === detailRequest.current) {
          setCourse(detail);
          setSection("Courses");
          setError("");
        }
      } catch (e) {
        if (version === detailRequest.current)
          setError(
            e instanceof Error ? e.message : "Could not load this course",
          );
      } finally {
        if (version === detailRequest.current) setLoadingCourse(false);
      }
    },
    [read, setError],
  );
  useEffect(() => {
    const restore = () => {
      const id = new URL(window.location.href).searchParams.get("course");
      setLesson(null);
      setAssignment(null);
      setEditing(null);
      if (id) void loadCourse(id);
      else {
        detailRequest.current++;
        setCourse(null);
        setSection(
          window.location.pathname === "/courses" ? "Courses" : "Home",
        );
      }
    };
    const timer = setTimeout(restore, 0);
    window.addEventListener("popstate", restore);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", restore);
    };
  }, [loadCourse]);
  const navigate = (next: string) => {
    detailRequest.current++;
    setSection(next);
    setCourse(null);
    setLesson(null);
    setAssignment(null);
    setEditing(null);
    setMessage("");
    setLoadingCourse(false);
    window.history.pushState(
      {},
      "",
      next === "Home" ? "/dashboard" : "/courses",
    );
  };
  const openCourse = (id: string) => {
    setLesson(null);
    setAssignment(null);
    setEditing(null);
    setTab("Lessons");
    setMessage("");
    window.history.pushState(
      {},
      "",
      `/courses?course=${encodeURIComponent(id)}`,
    );
    void loadCourse(id);
  };
  const mutate = async (input: unknown, success: string) => {
    const result = await api.command<{ id: string; revision: number }>(
      "/api/bff/lms/commands",
      input,
    );
    if (result) {
      setMessage(success);
      if (course) await loadCourse(course.course.id);
      await api.refresh();
    }
    return result;
  };
  if (api.signedOut)
    return (
      <PortalEntry
        portal="lms"
        description="Read lessons, submit assignments and find your faculty's feedback."
      />
    );
  if (!api.data)
    return (
      <main className="workspace loading-page">
        {api.error ? (
          <>
            <Notice error>{api.error}</Notice>
            <button onClick={() => void api.refresh()}>Try again</button>
          </>
        ) : (
          <p role="status">Loading your courses…</p>
        )}
      </main>
    );
  const student = api.data.role === "student";
  const closeItem = () => {
    setLesson(null);
    setAssignment(null);
    setEditing(null);
  };
  return (
    <Workspace
      portal="lms"
      viewer={`${api.data.name} · ${api.data.role === "hod" ? "HoD" : api.data.role}`}
      sections={["Home", "Courses"]}
      current={section}
      onNavigate={navigate}
      onSignOut={() => void api.signOut()}
    >
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {section === "Home" ? (
        <>
          <PageTitle
            title={
              student
                ? "Your learning, at a glance"
                : "Your teaching, at a glance"
            }
            description={
              student
                ? "See your course work and find your next task."
                : "Prepare lessons, set assignments and give students feedback."
            }
          />
          <div className="summary-grid">
            <article>
              <span>Your courses</span>
              <strong>{api.data.courses.length}</strong>
            </article>
            <article>
              <span>
                {student
                  ? "Assignments to submit"
                  : "Assignments with work to review"}
              </span>
              <strong>
                {api.data.courses.reduce((n, c) => n + c.pending, 0)}
              </strong>
            </article>
          </div>
          <section className="next-step">
            <div>
              <h2>
                {student
                  ? "Continue with your courses"
                  : "Open your course workspace"}
              </h2>
              <p>
                {student
                  ? "Lessons, assignments and feedback are grouped by course."
                  : "Choose a course to manage its materials and student work."}
              </p>
            </div>
            <button className="primary" onClick={() => navigate("Courses")}>
              View courses
            </button>
          </section>
        </>
      ) : null}
      {section === "Courses" && !course && !loadingCourse ? (
        <>
          <PageTitle
            title="Your courses"
            description={
              student
                ? "Your registered courses appear here automatically."
                : "Courses assigned to you for this semester."
            }
          />
          {!api.data.courses.length ? (
            <Empty title="No courses yet">
              {student
                ? "Complete course registration in the student portal. Your courses will then appear here."
                : "Your HoD needs to assign a course before you can add teaching materials."}
            </Empty>
          ) : (
            <div className="course-grid">
              {api.data.courses.map((c) => (
                <article className="course-card" key={c.id}>
                  <p className="eyebrow">
                    {c.code} · Section {c.section}
                  </p>
                  <h2>{c.title}</h2>
                  <p>
                    {c.faculty_name}
                    {c.registration_status === "completed"
                      ? " · Completed course"
                      : ""}
                  </p>
                  <div className="course-meta">
                    <span>
                      {c.lessons} {c.lessons === 1 ? "lesson" : "lessons"}
                    </span>
                    <span>
                      {c.assignments}{" "}
                      {c.assignments === 1 ? "assignment" : "assignments"}
                    </span>
                    {c.pending ? (
                      <span className="badge">
                        {c.pending} to {student ? "submit" : "review"}
                      </span>
                    ) : null}
                  </div>
                  <button onClick={() => openCourse(c.id)}>Open course</button>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
      {loadingCourse ? <p role="status">Loading course…</p> : null}
      {course && !loadingCourse ? (
        <>
          <button className="back-link" onClick={() => navigate("Courses")}>
            ← All courses
          </button>
          <PageTitle
            title={course.course.title}
            description={`${course.course.code} · ${course.course.faculty_name}`}
          />
          <nav className="section-tabs" aria-label="Course sections">
            {[
              "Lessons",
              "Assignments",
              student ? "Feedback" : "Submissions",
            ].map((name) => (
              <button
                key={name}
                className={tab === name ? "tab-current" : ""}
                aria-current={tab === name ? "page" : undefined}
                onClick={() => {
                  setTab(name);
                  closeItem();
                }}
              >
                {name}
              </button>
            ))}
          </nav>
          {editing ? (
            <ContentEditor
              key={`${editing}-${lesson?.id ?? assignment?.id ?? "new"}`}
              kind={editing}
              lesson={lesson}
              assignment={assignment}
              offeringId={course.course.id}
              pending={api.pending}
              onCancel={closeItem}
              onError={setError}
              onSave={async (input) => {
                const result = await mutate(input, "Course content saved.");
                if (result) closeItem();
              }}
            />
          ) : null}
          {!editing && tab === "Lessons" ? (
            <>
              <div className="section-heading-simple">
                <h2>{lesson ? lesson.title : "Lessons & materials"}</h2>
                {course.canManage ? (
                  <button
                    className="primary"
                    onClick={() => {
                      setLesson(null);
                      setEditing("lesson");
                    }}
                  >
                    Add lesson
                  </button>
                ) : null}
              </div>
              {lesson ? (
                <article className="detail-card">
                  <button className="back-link" onClick={() => setLesson(null)}>
                    ← All lessons
                  </button>
                  <p className="preserve-lines">{lesson.body}</p>
                  {lesson.material_url ? (
                    <a
                      className="button-link"
                      href={lesson.material_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open learning resource
                    </a>
                  ) : null}
                  {lesson.attachment_name ? (
                    <a
                      className="button-link"
                      href={`/api/bff/lms/files/lessons/${lesson.id}`}
                      download
                    >
                      Download {lesson.attachment_name}
                    </a>
                  ) : null}
                  {course.canManage ? (
                    <button onClick={() => setEditing("lesson")}>
                      Edit lesson
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => {
                        setTab("Assignments");
                        setLesson(null);
                      }}
                    >
                      View assignments
                    </button>
                  )}
                </article>
              ) : course.lessons.length ? (
                <div className="item-list">
                  {course.lessons.map((item, index) => (
                    <article key={item.id}>
                      <div className="item-number">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="item-description">
                        <h3>{item.title}</h3>
                        <p>
                          {!item.published
                            ? "Draft · visible to faculty only"
                            : item.opened_at
                              ? `Last opened ${dateTime(item.opened_at)}`
                              : "Ready to read"}
                        </p>
                      </div>
                      <button
                        disabled={api.pending}
                        onClick={async () => {
                          if (student) {
                            const result = await mutate(
                              { action: "open-lesson", lessonId: item.id },
                              "",
                            );
                            if (!result) return;
                          }
                          setLesson(item);
                        }}
                      >
                        Open lesson
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="No lessons published yet">
                  {student
                    ? "Your faculty member will add course materials here."
                    : "Add your first lesson with text, a resource link or a file."}
                </Empty>
              )}
            </>
          ) : null}
          {!editing && tab === "Assignments" ? (
            <>
              <div className="section-heading-simple">
                <h2>{assignment ? assignment.title : "Assignments"}</h2>
                {course.canManage ? (
                  <button
                    className="primary"
                    onClick={() => {
                      setAssignment(null);
                      setEditing("assignment");
                    }}
                  >
                    Add assignment
                  </button>
                ) : null}
              </div>
              {assignment ? (
                <>
                  <button
                    className="back-link"
                    onClick={() => setAssignment(null)}
                  >
                    ← All assignments
                  </button>
                  <article className="detail-card">
                    <p className="eyebrow">
                      Due {dateTime(assignment.due_at)} ·{" "}
                      {assignment.maximum_score} marks
                    </p>
                    <p className="preserve-lines">{assignment.instructions}</p>
                    {assignment.attachment_name ? (
                      <a
                        className="button-link"
                        href={`/api/bff/lms/files/assignments/${assignment.id}`}
                        download
                      >
                        Download {assignment.attachment_name}
                      </a>
                    ) : null}
                    {course.canManage ? (
                      <button onClick={() => setEditing("assignment")}>
                        Edit assignment
                      </button>
                    ) : (
                      <SubmissionForm
                        key={assignment.id}
                        assignment={assignment}
                        existing={course.submissions.find(
                          (s) => s.assignment_id === assignment.id,
                        )}
                        pending={api.pending}
                        onError={setError}
                        onSubmit={async (input) => {
                          await mutate(
                            input,
                            "Your work has been submitted. You can see the saved version below.",
                          );
                        }}
                      />
                    )}
                  </article>
                </>
              ) : course.assignments.length ? (
                <div className="item-list">
                  {course.assignments.map((item) => {
                    const submitted = course.submissions.find(
                      (s) => s.assignment_id === item.id,
                    );
                    return (
                      <article key={item.id}>
                        <div className="item-description">
                          <h3>{item.title}</h3>
                          <p>
                            Due {dateTime(item.due_at)} · {item.maximum_score}{" "}
                            marks
                          </p>
                          <span className="badge">
                            {!item.published
                              ? "Draft"
                              : !student
                                ? `${item.submissions} submissions`
                                : submitted?.graded_at
                                  ? "Feedback available"
                                  : submitted
                                    ? "Submitted"
                                    : item.deadline_passed
                                      ? "Overdue"
                                      : "To submit"}
                          </span>
                        </div>
                        <button onClick={() => setAssignment(item)}>
                          View assignment
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty title="No assignments yet">
                  {student
                    ? "Your faculty member will post assignments here."
                    : "Create an assignment with clear instructions and a due date."}
                </Empty>
              )}
            </>
          ) : null}
          {!editing && ["Feedback", "Submissions"].includes(tab) ? (
            <>
              <div className="section-heading-simple">
                <div>
                  <h2>{student ? "Your feedback" : "Student submissions"}</h2>
                  <p className="muted">
                    {student
                      ? "Scores and comments published by your faculty."
                      : "Read the submitted work before publishing marks and feedback."}
                  </p>
                </div>
              </div>
              {course.submissions.length ? (
                <div className="submission-list">
                  {course.submissions.map((s) => (
                    <FeedbackCard
                      key={`${s.id}-${s.revision}`}
                      submission={s}
                      assignment={
                        course.assignments.find(
                          (a) => a.id === s.assignment_id,
                        )!
                      }
                      canManage={course.canManage}
                      pending={api.pending}
                      onPublish={(input) =>
                        mutate(
                          input,
                          "Feedback published. The student can now read it.",
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title={student ? "No feedback yet" : "No submissions yet"}
                >
                  {student
                    ? "Submit an assignment to receive feedback here."
                    : "Submitted work will appear here for you to review."}
                </Empty>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </Workspace>
  );
}

function ContentEditor({
  kind,
  lesson,
  assignment,
  offeringId,
  pending,
  onSave,
  onCancel,
  onError,
}: {
  kind: "lesson" | "assignment";
  lesson: LmsLesson | null;
  assignment: LmsAssignment | null;
  offeringId: string;
  pending: boolean;
  onSave: (input: unknown) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const item = kind === "lesson" ? lesson : assignment;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const file = form.get("file") as File;
      const attachment = await selectedFile(file?.size ? file : undefined);
      const shared = {
        action: `save-${kind}`,
        offeringId,
        ...(item ? { id: item.id, expectedRevision: item.revision } : {}),
        title: form.get("title"),
        published: form.get("published") === "on",
        ...(attachment ? { attachment } : {}),
      };
      await onSave(
        kind === "lesson"
          ? {
              ...shared,
              body: form.get("body"),
              materialUrl: form.get("materialUrl"),
              position: Number(form.get("position")),
            }
          : {
              ...shared,
              instructions: form.get("body"),
              dueAt: new Date(String(form.get("due"))).toISOString(),
              maximumScore: Number(form.get("maximum")),
              allowLate: form.get("allowLate") === "on",
            },
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not read this form");
    }
  };
  const localDate = (value: string) => {
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <form className="edit-form" onSubmit={(event) => void submit(event)}>
      <h2>
        {item ? "Edit" : "Add"} {kind}
      </h2>
      <label>
        Title
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={item?.title}
        />
      </label>
      <label>
        {kind === "lesson" ? "Lesson text" : "Instructions"}
        <textarea
          name="body"
          required={kind === "assignment"}
          minLength={kind === "assignment" ? 5 : undefined}
          rows={7}
          maxLength={40000}
          defaultValue={
            kind === "lesson" ? lesson?.body : assignment?.instructions
          }
        />
      </label>
      {kind === "lesson" ? (
        <div className="form-grid">
          <label>
            Resource link (optional)
            <input
              name="materialUrl"
              type="url"
              defaultValue={lesson?.material_url}
            />
          </label>
          <label>
            Lesson order
            <input
              name="position"
              type="number"
              min={1}
              max={1000}
              defaultValue={lesson?.position ?? 1}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Due date and time
              <input
                name="due"
                type="datetime-local"
                required
                defaultValue={assignment ? localDate(assignment.due_at) : ""}
              />
            </label>
            <label>
              Maximum marks
              <input
                name="maximum"
                type="number"
                min={1}
                max={1000}
                required
                defaultValue={assignment?.maximum_score ?? 20}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              name="allowLate"
              type="checkbox"
              defaultChecked={assignment?.allow_late ?? true}
            />
            Allow late submissions
          </label>
        </>
      )}
      <label>
        Attach a file (optional, up to 2 MB)
        <input name="file" type="file" />
      </label>
      {item?.attachment_name ? (
        <p className="muted">
          Current file: {item.attachment_name}. Choose another file to replace
          it.
        </p>
      ) : null}
      <label className="check-label">
        <input
          name="published"
          type="checkbox"
          defaultChecked={item?.published ?? true}
        />
        Publish to registered students
      </label>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={pending} type="submit">
          {pending ? "Saving…" : `Save ${kind}`}
        </button>
      </div>
    </form>
  );
}

function SubmissionForm({
  assignment,
  existing,
  pending,
  onSubmit,
  onError,
}: {
  assignment: LmsAssignment;
  existing?: LmsSubmission;
  pending: boolean;
  onSubmit: (input: unknown) => Promise<void>;
  onError: (message: string) => void;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const file = form.get("file") as File;
      const attachment = await selectedFile(file?.size ? file : undefined);
      await onSubmit({
        action: "submit-assignment",
        assignmentId: assignment.id,
        expectedRevision: existing?.revision ?? -1,
        answer: form.get("answer"),
        ...(attachment ? { attachment } : {}),
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not read your file");
    }
  };
  if (existing?.graded_at)
    return (
      <Notice>
        Feedback has been published. Open the Feedback tab to read it.
      </Notice>
    );
  const closed = !assignment.allow_late && assignment.deadline_passed;
  return (
    <>
      <h3>{existing ? "Your submitted work" : "Submit your work"}</h3>
      {existing ? (
        <div className="saved-submission">
          <p>Submitted {dateTime(existing.submitted_at)}</p>
          <p className="preserve-lines">{existing.answer}</p>
          {existing.attachment_name ? (
            <a href={`/api/bff/lms/files/submissions/${existing.id}`} download>
              Download {existing.attachment_name}
            </a>
          ) : null}
        </div>
      ) : null}
      {closed ? (
        <Notice>
          The deadline has passed. Contact your faculty member about a late
          submission.
        </Notice>
      ) : (
        <form className="edit-form" onSubmit={(event) => void submit(event)}>
          <label>
            Your answer
            <textarea
              name="answer"
              rows={6}
              maxLength={40000}
              defaultValue={existing?.answer}
            />
          </label>
          <label>
            Attach your work (optional, up to 2 MB)
            <input type="file" name="file" />
          </label>
          {existing ? (
            <p>
              Your next submission replaces the current answer and file. Earlier
              versions remain in the record.
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={pending}>
            {pending
              ? "Submitting…"
              : existing
                ? "Submit updated work"
                : "Submit assignment"}
          </button>
        </form>
      )}
    </>
  );
}
function FeedbackCard({
  submission: s,
  assignment,
  canManage,
  pending,
  onPublish,
}: {
  submission: LmsSubmission;
  assignment: LmsAssignment;
  canManage: boolean;
  pending: boolean;
  onPublish: (input: unknown) => Promise<unknown>;
}) {
  return (
    <article className="detail-card">
      <h2>{assignment?.title ?? "Assignment"}</h2>
      {canManage ? <h3>{s.student_name}</h3> : null}
      <p className="muted">Submitted {dateTime(s.submitted_at)}</p>
      <details>
        <summary>Read submitted work</summary>
        <p className="preserve-lines">{s.answer}</p>
        {s.attachment_name ? (
          <a href={`/api/bff/lms/files/submissions/${s.id}`} download>
            Download {s.attachment_name}
          </a>
        ) : null}
      </details>
      {s.graded_at ? (
        <div className="feedback-result">
          <strong>
            {s.score} / {assignment.maximum_score}
          </strong>
          <p className="preserve-lines">{s.feedback}</p>
          <small>Published {dateTime(s.graded_at)}</small>
        </div>
      ) : (
        <p>Waiting for faculty feedback.</p>
      )}
      {canManage ? (
        <form
          className="edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void onPublish({
              action: "publish-feedback",
              submissionId: s.id,
              expectedRevision: s.revision,
              score: Number(form.get("score")),
              feedback: form.get("feedback"),
            });
          }}
        >
          <label>
            Marks (out of {assignment.maximum_score})
            <input
              name="score"
              type="number"
              required
              min={0}
              max={assignment.maximum_score}
              step="0.5"
              defaultValue={s.score ?? ""}
            />
          </label>
          <label>
            Feedback for the student
            <textarea
              name="feedback"
              required
              minLength={3}
              maxLength={12000}
              rows={3}
              defaultValue={s.feedback}
            />
          </label>
          <button className="primary" type="submit" disabled={pending}>
            {pending
              ? "Publishing…"
              : s.graded_at
                ? "Publish corrected feedback"
                : "Publish feedback"}
          </button>
        </form>
      ) : null}
    </article>
  );
}
