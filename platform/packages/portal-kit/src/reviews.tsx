"use client";
import { useEffect, useState } from "react";
import type { ActorRole, ExperienceOverview } from "@aura/contracts";
import {
  PageTitle,
  Notice,
  Empty,
  usePortalApi,
  dateTime,
  portalUrl,
} from "./workspace";
import {
  Metric,
  SupportText,
  Field,
  Why,
  formValues,
  str,
  num,
  FollowupForm,
  type SaveChange,
} from "./experience";
type Policy = {
  version: string;
  attendanceMinimum: number;
  markMinimum: number;
  inactivityMaximum: number;
  mediumScore: number;
  highScore: number;
  freshnessDays: number;
};
type ReviewPlan = {
  id: string;
  revision: number;
  status: string;
  paused: boolean;
  created_at: string;
  body: {
    request: string;
    studentIds?: string[];
    policyId?: string;
    domain?: string;
    mode: string;
    questions: string[];
  };
};
type ReviewJob = {
  id: string;
  plan_id: string;
  student_id: string;
  faculty_person_id: string;
  status: string;
  stage: string;
  error_code: string | null;
  failure_reasons:string[];
  updated_at: string;
  created_at: string;
  mode: string | null;
  risk: {
    band: string;
    score: number;
    signals: { code: string; explanation: string }[];
  } | null;
};
type AiData = {
  students: {
    id: string;
    display_name: string;
    register_number: string;
    mentor_id: string | null;
    mentor_name: string | null;
  }[];
  policies: { id: string; faculty_person_id: string; policy: Policy }[];
  plans: ReviewPlan[];
  jobs: ReviewJob[];
  demoPolicy: Policy;
  modelConfigured: boolean;
};
const statusText: Record<string, string> = {
  queued: "Waiting to start",
  running: "Review in progress",
  blocked: "Missing or outdated records",
  failed: "Review stopped",
  awaiting_faculty: "Waiting for mentor",
  not_flagged: "No concern found",
  approved: "Support confirmed",
  rejected: "Suggestion dismissed",
};
const stageText: Record<string, string> = {
  collect: "Collect and check records",
  risk: "Identify concerns",
  recommend: "Prepare and check support",
  publish: "Save suggestion for the mentor",
  complete: "Review finished",
};
const errorText: Record<string, string> = {
  DATA_BLOCKED:
    "Required records are missing or outdated. Check the student’s attendance, marks and activity before retrying.",
  MODEL_NOT_CONFIGURED:
    "A language model is not configured for this environment.",
  EXECUTION_FAILED:
    "The review stopped unexpectedly. Its saved work is available for retry.",
  PLAN_PAUSED: "The review is paused before its next stage.",
  INJECTED_STOP: "This review was stopped during a recovery test.",
};
function reviewStatus(plan:ReviewPlan,jobs:ReviewJob[]){
 if(plan.paused)return "Paused";
 if(plan.status!=="locked")return "Needs review details";
 const work=jobs.filter(j=>j.plan_id===plan.id);
 if(!work.length)return "Ready to start";
 if(work.some(j=>j.status==="running" || j.status==="queued"))return "In progress";
 if(work.some(j=>j.status==="blocked" || j.status==="failed"))return "Needs attention";
 if(work.some(j=>j.status==="awaiting_faculty"))return "Waiting for mentor";
 return "Reviewed";
}
export function AiWorkspace({
  section,
  actorRole,
  embedded = false,
}: {
  section: string;
  actorRole: ActorRole;
  embedded?: boolean;
}) {
  const api = usePortalApi<AiData>("/api/bff/chapter11/overview");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState<unknown>(null);
  const d = api.data;
  const refresh = api.refresh;
  useEffect(() => {
    if (!d?.jobs.some((j) => j.status === "running")) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [d, refresh]);
  const run = async (id: string) => {
    for (let batch = 0; batch < 14; batch++) {
      const result = await api.command<{
        results: { id: string; error?: string }[];
      }>(`/api/bff/chapter11/plans/${id}/execute`, {});
      await api.refresh();
      if (!result) return;
      if (result.results.some((r) => r.error)) {
        setMessage(
          "The review needs attention. Open its details to see what stopped.",
        );
        return;
      }
      if (result.results.length < 4) {
        setMessage(
          "Review finished. Any suggested support is waiting for a mentor’s decision.",
        );
        return;
      }
    }
  };
  const start = async (raw: {
    studentIds: string[];
    domain: string;
    mode: string;
    request: string;
    policy: Policy;
    facultyId?: string;
  }) => {
    const policy = await api.command<{ id: string }>(
      "/api/bff/chapter11/policies",
      {
        policy: raw.policy,
        ...(raw.facultyId ? { facultyId: raw.facultyId } : {}),
        rationale: "Use these thresholds for this student-support review.",
      },
    );
    if (!policy) return;
    const plan = await api.command<ReviewPlan>("/api/bff/chapter11/plans", {
      studentIds: raw.studentIds,
      domain: raw.domain,
      mode: raw.mode,
      request: raw.request,
      policyId: policy.id,
    });
    if (!plan) return;
    setSelected(plan.id);
    setCreating(false);
    await api.refresh();
    const locked = await api.command(
      `/api/bff/chapter11/plans/${plan.id}/lock`,
      { expectedRevision: plan.revision },
    );
    if (locked) await run(plan.id);
  };
  if (!d)
    return (
      <>
        {api.error ? (
          <Notice error>{api.error}</Notice>
        ) : (
          <p role="status">Loading review activity…</p>
        )}
      </>
    );
  const plan = d.plans.find((p) => p.id === selected);
  const jobs = plan ? d.jobs.filter((j) => j.plan_id === plan.id) : [];
  const canStart = ["faculty", "hod"].includes(actorRole);
  return (
    <>
      {!embedded ? (
        <PageTitle
          title={
            section === "Overview"
              ? "AI activity"
              : section === "History"
                ? "Review history"
                : "Student reviews"
          }
          description="See which records were checked, what needs attention, and what happens next."
          action={
            canStart ? (
              <button
                className="primary"
                onClick={() => {
                  setCreating(true);
                  setSelected("");
                }}
              >
                Start student review
              </button>
            ) : (
              <button onClick={() => void api.refresh()}>
                Refresh activity
              </button>
            )
          }
        />
      ) : canStart ? (
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setSelected("");
          }}
        >
          Start student review
        </button>
      ) : null}
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {creating ? (
        <StartReview
          data={d}
          role={actorRole}
          pending={api.pending}
          start={start}
          close={() => setCreating(false)}
        />
      ) : plan ? (
        <>
          <button
            className="back-link"
            onClick={() => {
              setSelected("");
              setEvidence(null);
            }}
          >
            ← Back to reviews
          </button>
          <h2>{plan.body.request}</h2>
          <p>
            Created {dateTime(plan.created_at)} ·{" "}
            {reviewStatus(plan,d.jobs)}
          </p>
          <div className="form-actions">
            {plan.status === "locked" ? (
              <>
                <button
                  disabled={api.pending || plan.paused}
                  className="primary"
                  onClick={() => void run(plan.id)}
                >
                  {jobs.some((j) => ["failed", "blocked"].includes(j.status))
                    ? "Retry unfinished reviews"
                    : "Continue review"}
                </button>
                <button
                  onClick={async () => {
                    const result = await api.command(
                      `/api/bff/chapter11/plans/${plan.id}/pause`,
                      {
                        expectedRevision: plan.revision,
                        paused: !plan.paused,
                        reason: plan.paused
                          ? "Resume the student review"
                          : "Pause before the next review stage",
                      },
                      true,
                    );
                    if (result) await api.refresh();
                  }}
                >
                  {plan.paused ? "Resume review" : "Pause review"}
                </button>
              </>
            ) : plan.status === "ready" ? (
              <button
                disabled={api.pending}
                onClick={async () => {
                  if (
                    await api.command(
                      `/api/bff/chapter11/plans/${plan.id}/lock`,
                      { expectedRevision: plan.revision },
                    )
                  )
                    await run(plan.id);
                }}
              >
                Start saved review
              </button>
            ) : (
              <p>{plan.body.questions.join(" ")}</p>
            )}
            <button
              onClick={async () => {
                try {
                  setEvidence(
                    await api.read(
                      `/api/bff/chapter11/plans/${plan.id}/export`,
                    ),
                  );
                } catch (e) {
                  api.setError(
                    e instanceof Error
                      ? e.message
                      : "Could not load review evidence",
                  );
                }
              }}
            >
              View recorded evidence
            </button>
          </div>
          <p>
            Pausing takes effect before the next stage. Work already saved
            remains available.
          </p>
          {jobs.map((job) => (
            <article className="panel" key={job.id}>
              <div className="panel-heading">
                <h3>
                  {d.students.find((s) => s.id === job.student_id)
                    ?.display_name ?? "Student review"}
                </h3>
                <span className="status-badge">
                  {statusText[job.status] ?? job.status}
                </span>
              </div>
              <p>
                {stageText[job.stage] ?? job.stage} · Updated{" "}
                {dateTime(job.updated_at)}
              </p>
              <ol className="review-stages">
                {["collect", "risk", "recommend", "publish", "complete"].map(
                  (stage) => (
                    <li
                      key={stage}
                      className={job.stage === stage ? "current-stage" : ""}
                    >
                      {stageText[stage]}
                    </li>
                  ),
                )}
              </ol>
              <p>
                <b>Suggestion method:</b>{" "}
                {job.mode === "model"
                  ? "Language model with validation"
                  : job.mode === "deterministic"
                    ? "Rules with validation"
                    : "Not generated yet"}
              </p>
              {job.error_code ? (
                <Notice error>
                  {errorText[job.error_code] ?? job.error_code}{job.failure_reasons?.length?<ul>{job.failure_reasons.map(reason=><li key={reason}>{reason.replace("academic: stale or future evidence","Academic records have an outdated or future date. Correct the attendance or marks record, then retry.")}</li>)}</ul>:null}
                </Notice>
              ) : null}
              {job.risk ? (
                <>
                  <p>
                    Priority: {job.risk.band} · Score {job.risk.score}/100
                  </p>
                  <ul>
                    {job.risk.signals.map((s) => (
                      <li key={s.code}>{s.explanation}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          ))}
          {evidence ? (
            <details open className="panel">
              <summary>Recorded evidence and execution history</summary>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(evidence, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `aura-review-${plan.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download review record
              </button>
              <pre>{JSON.stringify(evidence, null, 2)}</pre>
            </details>
          ) : null}
        </>
      ) : (
        <>
          {section === "Overview" ? (
            <>
              <div className="stats-row">
                <Metric
                  label="Reviews in progress"
                  value={
                    d.jobs.filter((j) =>
                      ["running", "queued"].includes(j.status),
                    ).length
                  }
                />
                <Metric
                  label="Waiting for mentor"
                  value={
                    d.jobs.filter((j) => j.status === "awaiting_faculty").length
                  }
                />
                <Metric
                  label="Need attention"
                  value={
                    d.jobs.filter((j) =>
                      ["blocked", "failed"].includes(j.status),
                    ).length
                  }
                />
              </div>
              <details className="panel">
                <summary>What the agents do</summary>
                <ol>
                  <li>
                    Source workers collect academic, LMS, internship and
                    placement records.
                  </li>
                  <li>
                    The coordinator checks that the records are complete and
                    recent.
                  </li>
                  <li>
                    A risk worker identifies concerns using the selected
                    thresholds.
                  </li>
                  <li>
                    A support worker drafts steps and a validator checks them.
                  </li>
                  <li>
                    The mentor reviews the suggestion and decides what to share.
                  </li>
                </ol>
              </details>
              <h2>Recent reviews</h2>
            </>
          ) : null}
          {d.plans.length ? (
            <div className="item-list">
              {(section === "Overview" ? d.plans.slice(0, 5) : d.plans).map(
                (p) => (
                  <article className="list-item" key={p.id}>
                    <div>
                      <h3>{p.body.request}</h3>
                      <p>
                        {p.body.studentIds?.length ?? 0} {(p.body.studentIds?.length??0)===1?"student":"students"} ·{" "}
                        {dateTime(p.created_at)} ·{" "}
                        {reviewStatus(p,d.jobs)}
                      </p>
                    </div>
                    <button onClick={() => setSelected(p.id)}>
                      View review
                    </button>
                  </article>
                ),
              )}
            </div>
          ) : (
            <Empty title="No student reviews yet">
              A mentor or HoD can start a review using the current student
              records.
            </Empty>
          )}
          {actorRole === "governance" ? (
            <p>
              To manage department settings,{" "}
              <a
                href={`${portalUrl("governance")}/api/session/login?account=hod.cse%40aura.invalid&returnTo=%2Freviews`}
              >
                continue as the demo HoD
              </a>
              .
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
function StartReview({
  data,
  role,
  pending,
  start,
  close,
}: {
  data: AiData;
  role: ActorRole;
  pending: boolean;
  start: (input: {
    studentIds: string[];
    domain: string;
    mode: string;
    request: string;
    policy: Policy;
    facultyId?: string;
  }) => Promise<void>;
  close: () => void;
}) {
  const [formError, setFormError] = useState("");
  const [mentor, setMentor] = useState(
    data.students.find((s) => s.mentor_id)?.mentor_id ?? "",
  );
  const students =
    role === "hod"
      ? data.students.filter((s) => s.mentor_id === mentor)
      : data.students;
  const mentors = [
    ...new Set(
      data.students.map((s) => s.mentor_id).filter((id): id is string => !!id),
    ),
  ];
  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        const f = formValues(e);
        if (!f.getAll("students").length) {
          setFormError("Choose at least one student to review.");
          return;
        }
        setFormError("");
        await start({
          studentIds: f.getAll("students").map(String),
          domain: str(f, "domain"),
          request: str(f, "request"),
          mode: str(f, "mode"),
          ...(role === "hod" ? { facultyId: mentor } : {}),
          policy: {
            version: `REVIEW-${new Date().toISOString().slice(0, 10)}`,
            attendanceMinimum: num(f, "attendanceMinimum"),
            markMinimum: num(f, "markMinimum"),
            inactivityMaximum: num(f, "inactivityMaximum"),
            mediumScore: num(f, "mediumScore"),
            highScore: num(f, "highScore"),
            freshnessDays: num(f, "freshnessDays"),
          },
        });
      }}
    >
      <h2>Start a student review</h2>
      {formError ? <Notice error>{formError}</Notice> : null}
      <Field
        label="Review name"
        name="request"
        value="Check student progress and plan the next support step"
      />
      {role === "hod" ? (
        <label>
          Mentor group
          <select value={mentor} onChange={(e) => setMentor(e.target.value)}>
            {mentors.map((id, i) => (
              <option key={id} value={id}>
                {data.students.find((s) => s.mentor_id === id)?.mentor_name ??
                  `Mentor ${i + 1}`}{" "}
                · {data.students.filter((s) => s.mentor_id === id).length}{" "}
                students
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset>
        <legend>Students to review</legend>
        {students.map((s) => (
          <label className="checkbox-label" key={s.id}>
            <input type="checkbox" name="students" value={s.id} />
            {s.display_name} · {s.register_number}
          </label>
        ))}
        {!students.length ? (
          <p>No students are assigned to this mentor.</p>
        ) : null}
      </fieldset>
      <Field label="Review focus" name="domain">
        <select name="domain">
          <option value="academic">Academic progress</option>
          <option value="attendance">Attendance</option>
          <option value="wellbeing-referral">Optional support referral</option>
        </select>
      </Field>
      <Field label="Suggestion method" name="mode">
        <select name="mode">
          <option value="deterministic">Rules with validation</option>
          {data.modelConfigured ? (
            <option value="model">Language model with validation</option>
          ) : null}
        </select>
      </Field>
      <details>
        <summary>Review thresholds</summary>
        <p>
          These are demonstration thresholds, not an official college policy.
        </p>
        <div className="form-columns">
          {(
            [
              ["attendanceMinimum", "Attendance below (%)"],
              ["markMinimum", "Marks below (%)"],
              ["inactivityMaximum", "Days without LMS activity"],
              ["mediumScore", "Medium priority score"],
              ["highScore", "High priority score"],
              ["freshnessDays", "Maximum record age (days)"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              name={key}
              type="number"
              min="0"
              value={data.demoPolicy[key]}
            />
          ))}
        </div>
      </details>
      <p>
        The review gathers records and prepares suggestions. A mentor must
        confirm a support plan before it is shared.
      </p>
      <div className="form-actions">
        <button className="primary" disabled={pending || !students.length}>
          {pending ? "Working…" : "Start review"}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Packet = {
  summary: string;
  actions: { code: string; label: string; owner: string; dueInDays: number }[];
  citations: { evidencePath: string; statement: string }[];
  prohibited: string[];
};
type Queue = {
  drafts: {
    id: string;
    student_id: string;
    revision: number;
    artifact_id: string;
    content_hash: string;
    display_name: string;
    recommendation: Packet;
  }[];
  plans: {
    id: string;
    student_id: string;
    display_name: string;
    plan: Packet;
    status: string;
    revision: number;
    outcome: string;
    visible_to_student: boolean;
  }[];
};
export function SupportReviews({
  data,
  onRefresh,
}: {
  data: ExperienceOverview;
  onRefresh?: () => Promise<void>;
}) {
  const api = usePortalApi<Queue>("/api/bff/chapter11/review");
  const [tab, setTab] = useState("Suggestions");
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [followup, setFollowup] = useState<string | null>(null);
  const save: SaveChange = async (input) => {
    if (!(await api.command("/api/bff/experience/commands", input)))
      return false;
    setMessage("Follow-up saved.");
    await onRefresh?.();
    return true;
  };
  const draft = api.data?.drafts.find((d) => d.id === selected);
  return (
    <>
      <PageTitle
        title="Support & follow-ups"
        description="Read the concern, decide the support, then record what happened."
      />
      <nav className="course-tabs" aria-label="Support sections">
        {["Suggestions", "Confirmed plans", "Follow-ups", "Start review"].map(
          (t) => (
            <button
              key={t}
              aria-current={t === tab ? "page" : undefined}
              onClick={() => {
                setTab(t);
                setSelected("");
                void api.refresh();
              }}
            >
              {t}
            </button>
          ),
        )}
      </nav>
      {api.error ? <Notice error>{api.error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}
      {tab === "Start review" ? (
        <AiWorkspace section="Reviews" actorRole={data.actor.role} embedded />
      ) : tab === "Follow-ups" ? (
        <>
          {followup ? (
            <FollowupForm
              studentId={followup}
              existing={data.followups.find((f) => f.id === selected) ?? null}
              save={save}
              pending={api.pending}
              close={() => {
                setFollowup(null);
                setSelected("");
              }}
            />
          ) : null}
          <label>
            Schedule a follow-up
            <select value="" onChange={(e) => setFollowup(e.target.value)}>
              <option value="" disabled>
                Choose a mentee
              </option>
              {data.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {data.followups.map((f) => (
            <article className="list-item" key={f.id}>
              <div>
                <h3>{f.student_name}</h3>
                <p>{f.note}</p>
                <p>
                  {f.due_on} · {f.status.replaceAll("_", " ")}
                  {f.overdue ? " · Overdue" : ""}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelected(f.id);
                  setFollowup(f.student_id);
                }}
              >
                Update follow-up
              </button>
            </article>
          ))}
        </>
      ) : tab === "Suggestions" ? (
        draft ? (
          <>
            <button
              className="back-link"
              onClick={() => {
                setSelected("");
                setEditing(false);
              }}
            >
              ← Back to suggestions
            </button>
            <h2>{draft.display_name}</h2>
            <h3>Why this student was flagged</h3>
            <ul>
              {draft.recommendation.citations.map((c, i) => (
                <li key={i}>{c.statement}</li>
              ))}
            </ul>
            {editing ? (
              <form
                className="panel form-grid"
                onSubmit={async (e) => {
                  const f = formValues(e);
                  const packet = {
                    ...draft.recommendation,
                    summary: str(f, "summary"),
                    actions: draft.recommendation.actions.map((a, i) => ({
                      ...a,
                      label: str(f, `label-${i}`),
                      owner: str(f, `owner-${i}`),
                      dueInDays: num(f, `days-${i}`),
                    })),
                  };
                  if (
                    await api.command(
                      `/api/bff/chapter11/cases/${draft.id}/edit`,
                      {
                        expectedRevision: draft.revision,
                        artifactId: draft.artifact_id,
                        packet,
                        rationale: str(f, "reason"),
                      },
                    )
                  ) {
                    await api.refresh();
                    setEditing(false);
                    setMessage(
                      "Suggestion updated. Read it before confirming.",
                    );
                  }
                }}
              >
                <label>
                  Support summary
                  <textarea
                    name="summary"
                    defaultValue={draft.recommendation.summary}
                    required
                  />
                </label>
                {draft.recommendation.actions.map((a, i) => (
                  <fieldset key={a.code}>
                    <legend>Step {i + 1}</legend>
                    <Field label="Action" name={`label-${i}`} value={a.label} />
                    <Field label="Who will do it?" name={`owner-${i}`}>
                      <select name={`owner-${i}`} defaultValue={a.owner}>
                        <option value="assigned_faculty">Mentor</option>
                        <option value="student">Student</option>
                      </select>
                    </Field>
                    <Field
                      label="Due in days"
                      name={`days-${i}`}
                      type="number"
                      min="1"
                      max="14"
                      value={a.dueInDays}
                    />
                  </fieldset>
                ))}
                <Why />
                <button className="primary" disabled={api.pending}>
                  Save changed suggestion
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <h3>Suggested support</h3>
                <SupportText plan={draft.recommendation} />
                <button onClick={() => setEditing(true)}>Change plan</button>
                {data.actor.role === "faculty" ? (
                  <form
                    className="panel form-grid"
                    onSubmit={async (e) => {
                      const f = formValues(e);
                      const decision = str(f, "decision");
                      const result = await api.command(
                        `/api/bff/support/cases/${draft.id}/decisions`,
                        {
                          expectedRevision: draft.revision,
                          artifactId: draft.artifact_id,
                          contentHash: draft.content_hash,
                          decision,
                          rationale: str(f, "reason"),
                        },
                      );
                      if (result) {
                        await api.refresh();
                        setSelected("");
                        setMessage(
                          decision === "approved"
                            ? "Support plan confirmed and shared with the student."
                            : "Suggestion dismissed. Your reason has been recorded.",
                        );
                      }
                    }}
                  >
                    <Field label="Decision" name="decision">
                      <select name="decision">
                        <option value="approved">Confirm support plan</option>
                        <option value="rejected">Dismiss suggestion</option>
                      </select>
                    </Field>
                    <Why />
                    <button className="primary" disabled={api.pending}>
                      Save decision
                    </button>
                  </form>
                ) : (
                  <p>
                    The assigned mentor confirms or dismisses this suggestion.
                  </p>
                )}
              </>
            )}
          </>
        ) : api.data?.drafts.length ? (
          <div className="item-list">
            {api.data.drafts.map((d) => (
              <article className="list-item" key={d.id}>
                <div>
                  <h2>{d.display_name}</h2>
                  <p>{d.recommendation.summary}</p>
                </div>
                <button onClick={() => setSelected(d.id)}>
                  Review suggestion
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No suggestions waiting">
            Start a student review to check the latest records.
          </Empty>
        )
      ) : (
        <>
          {api.data?.plans.length ? (
            api.data.plans.map((p) => (
              <details className="panel" key={`${p.id}-${p.revision}`}>
                <summary>
                  {p.display_name} · {p.status.replaceAll("_", " ")}
                </summary>
                <SupportText plan={p.plan} />
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    const f = formValues(e);
                    if (
                      await api.command(
                        `/api/bff/chapter11/interventions/${p.id}/outcome`,
                        {
                          expectedRevision: p.revision,
                          status: str(f, "status"),
                          outcome: str(f, "outcome"),
                        },
                      )
                    ) {
                      await api.refresh();
                      setMessage("Support outcome updated.");
                    }
                  }}
                >
                  <Field label="Progress" name="status">
                    <select name="status" defaultValue={p.status}>
                      <option value="planned">Planned / reopen</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="withdrawn">Withdraw shared plan</option>
                    </select>
                  </Field>
                  <label>
                    What happened, or why are you changing it?
                    <textarea
                      name="outcome"
                      defaultValue={p.outcome}
                      minLength={12}
                      required
                    />
                  </label>
                  <button className="primary" disabled={api.pending}>
                    Save support outcome
                  </button>
                </form>
              </details>
            ))
          ) : (
            <Empty title="No confirmed support plans">
              Plans appear here after a mentor confirms them.
            </Empty>
          )}
        </>
      )}
      <p className="muted">
        Detailed agent activity is available in the{" "}
        <a href={portalUrl("governance")}>AI portal</a>.
      </p>
    </>
  );
}
