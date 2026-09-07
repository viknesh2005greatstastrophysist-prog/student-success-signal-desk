"use client";
import { useCallback, useEffect, useState } from "react";

type Policy = { version: string; attendanceMinimum: number; markMinimum: number; inactivityMaximum: number; mediumScore: number; highScore: number; freshnessDays: number };
type PlanInput = { request: string; studentIds?: string[]; domain?: string; policyId?: string; feedback: string; mode: string };
type Plan = { id: string; status: string; revision: number; body: PlanInput & { questions: string[]; steps: string[] } };
type Overview = {
  students: Array<{ id: string; department_id: string; register_number: string; display_name: string }>;
  policies: Array<{ id: string; department_id: string; policy: Policy; created_at: string }>;
  plans: Plan[];
  jobs: Array<{ id: string; plan_id: string; student_id: string; status: string; stage: string; error_code: string | null; mode: string | null; risk: { score: number; band: string; signals: Array<{ code: string; explanation: string }> } | null; validation: { valid: boolean; providerError?: string } | null }>;
  trends?: Array<{ day: string; reviewed: number; flagged: number; blocked: number; approved: number; completed: number; withdrawn: number }>;
  demoPolicy: Policy; modelConfigured: boolean;
};
type ReviewPacket = { summary: string; actions: Array<{ code: string; label: string; owner: string; dueInDays: number }>; citations: Array<{ evidencePath: string; statement: string }>; prohibited: string[] };
type Review = { drafts: Array<{ id: string; revision: number; artifact_id: string; recommendation: ReviewPacket; display_name: string }>; plans: Array<{ id: string; revision: number; status: string; outcome: string; display_name: string; visible_to_student: boolean }> };

export function Chapter11Workbench({ role, csrfToken, refresh }: { role: "faculty" | "governance" | "hod"; csrfToken: string; refresh: () => Promise<void> }) {
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [request, setRequest] = useState("Review students who may need academic support");
  const [selected, setSelected] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [mode, setMode] = useState("deterministic");
  const [editing, setEditing] = useState<Plan | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [rationale, setRationale] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, ReviewPacket>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, { status: string; outcome: string }>>({});
  const action = (name: string) => `${role}-ch11-${name}`;
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bff/chapter11/overview", { cache: "no-store" });
      const envelope = await response.json();
      if (!envelope.ok) throw new Error(envelope.error?.message ?? "Could not load worklet");
      setData(envelope.data); setPolicy(previous => previous ?? envelope.data.demoPolicy);
      if (role === "faculty") {
        const reviewResponse = await fetch("/api/bff/chapter11/review", { cache: "no-store" });
        const reviewEnvelope = await reviewResponse.json();
        if (!reviewEnvelope.ok) throw new Error(reviewEnvelope.error?.message ?? "Could not load mentor review");
        setReview(reviewEnvelope.data);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load worklet"); }
  }, [role]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const command = async (path: string, body: unknown) => {
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/bff/chapter11/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const envelope = await response.json();
      if (!envelope.ok) throw new Error(envelope.error?.message ?? "The operation failed");
      setMessage("Saved. The worklet state has been refreshed.");
      await load(); await refresh();
      return envelope.data;
    } catch (error) { setMessage(error instanceof Error ? error.message : "The operation failed"); }
    finally { setPending(false); }
  };
  const submit = async () => {
    const input = { request, ...(selected.length ? { studentIds: selected } : {}), ...(domain ? { domain } : {}), ...(policyId ? { policyId } : {}), feedback, mode };
    const result = editing ? await command(`plans/${editing.id}/revise`, { expectedRevision: editing.revision, input }) : await command("plans", input);
    if (result) setEditing(result);
  };
  const edit = (plan: Plan) => { setEditing(plan); setRequest(plan.body.request); setSelected(plan.body.studentIds ?? []); setDomain(plan.body.domain ?? ""); setPolicyId(plan.body.policyId ?? ""); setFeedback(plan.body.feedback); setMode(plan.body.mode); };
  const activePolicy = data?.policies.find(p => p.id === policyId);
  const students = data?.students.filter(s => !activePolicy || s.department_id === activePolicy.department_id) ?? [];

  return <section className="ch11-workbench" aria-label="Chapter 11 student support worklet">
    <header><p className="kicker">Chapter 11 · Student Success & Early Warning</p><h2>Plan a review. Follow the evidence.</h2><p>Four sources, transparent thresholds, checked recommendations, and a mentor’s final decision. This environment uses synthetic records.</p></header>
    {message ? <p role="status" className="ch11-message">{message}</p> : null}
    {!data ? <button data-action-id={action("refresh")} onClick={() => void load()}>Load worklet</button> : <>
      {role === "faculty" && policy ? <details className="ch11-card"><summary data-action-id={action("policy-open")}>Approve demonstration thresholds</summary><p>These values become a versioned policy under your synthetic mentor identity. They are not approval from a real faculty member.</p><p>Scoring weights: attendance 20, marks 20, LMS inactivity 20, overdue assignments 10, internship 15, placement 15. A score triggers mentor review, not a prediction of failure.</p><div className="ch11-fields">
        {(Object.keys(policy) as Array<keyof Policy>).map(key => <label key={key}>{({ version: "Policy version", attendanceMinimum: "Minimum attendance %", markMinimum: "Minimum mark %", inactivityMaximum: "LMS inactivity days", mediumScore: "Medium concern score", highScore: "High concern score", freshnessDays: "Maximum source age in days" })[key]}<input data-action-id={action("policy-field")} type={key === "version" ? "text" : "number"} value={policy[key]} onChange={e => setPolicy({ ...policy, [key]: key === "version" ? e.target.value : Number(e.target.value) })} /></label>)}
      </div><label>Reason for approving these thresholds<input data-action-id={action("policy-reason")} value={rationale} onChange={e => setRationale(e.target.value)} /></label><button data-action-id={action("policy-approve")} disabled={pending || rationale.trim().length < 12} onClick={() => void command("policies", { policy, rationale })}>Approve policy</button></details> : null}
      {role === "governance" ? <div className="ch11-card"><p>Link the supplied LMS, internship, and placement fixtures. Existing records are preserved; missing academic records remain blocked until faculty publishes them.</p><button data-action-id={action("seed")} disabled={pending} onClick={() => void command("sources/seed", {})}>Link synthetic source fixtures</button></div> : null}
      {role !== "hod" ? <div className="ch11-card"><h3>{editing ? "Revise review plan" : "Create review plan"}</h3>
        <label>Review request<textarea data-action-id={action("request")} value={request} onChange={e => setRequest(e.target.value)} /></label>
        <div className="ch11-fields"><label>Focus<select data-action-id={action("domain")} value={domain} onChange={e => setDomain(e.target.value)}><option value="">Choose a focus</option><option value="academic">Academic support</option><option value="attendance">Attendance support</option><option value="wellbeing-referral">Optional wellbeing referral</option></select></label>
        <label>Mentor-approved policy<select data-action-id={action("policy")} value={policyId} onChange={e => { setPolicyId(e.target.value); setSelected([]); }}><option value="">Choose an approved policy</option>{data.policies.map(p => <option key={p.id} value={p.id}>{p.policy.version} · {p.id.slice(0, 8)}</option>)}</select></label>
        <label>Recommendation mode<select data-action-id={action("mode")} value={mode} onChange={e => setMode(e.target.value)}><option value="deterministic">Rule-based baseline</option><option value="model">Live model with checked fallback</option></select></label></div>
        {mode === "model" && !data.modelConfigured ? <p>No live model is configured. Execution will explicitly report a rule-based fallback.</p> : null}
        <fieldset><legend>Students in scope</legend><div className="ch11-students">{students.map(s => <label key={s.id}><input type="checkbox" data-action-id={action("student")} checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />{s.display_name} <small>{s.register_number}</small></label>)}</div></fieldset>
        <label>Revision feedback<input data-action-id={action("feedback")} value={feedback} onChange={e => setFeedback(e.target.value)} /></label>
        <div className="ch11-buttons"><button data-action-id={action("save")} disabled={pending || request.trim().length < 3 || editing?.status === "locked"} onClick={() => void submit()}>{editing ? "Save revised plan" : "Ask coordinator to plan"}</button>{editing ? <button data-action-id={action("new")} onClick={() => setEditing(null)}>Start a new plan</button> : null}</div>
        {editing?.body.questions.length ? <div className="ch11-questions"><h4>The coordinator needs these answers</h4><ol>{editing.body.questions.map(q => <li key={q}>{q}</li>)}</ol></div> : null}
      </div> : null}
      {role === "hod" ? <div className="ch11-card"><h3>Department support trends</h3><p>Counts refer to review executions, so the same student can appear in successive cycles. Outcomes are mentor-recorded observations.</p>{data.trends?.length ? data.trends.map(t => <article className="ch11-plan" key={t.day}><h4>{t.day}</h4><p>{t.reviewed} reviews · {t.flagged} flagged · {t.blocked} blocked by evidence</p><p>{t.approved} mentor approvals · {t.completed} completed interventions · {t.withdrawn} withdrawn publications</p></article>) : <p>No review cycles recorded yet.</p>}</div> : null}
      <div className="ch11-card"><h3>Review plans and execution</h3><p>Each request processes up to four students. Run again to continue a larger cohort or resume interrupted work.</p>{!data.plans.length ? <p>No review plans yet.</p> : data.plans.map(plan => <article className="ch11-plan" key={plan.id}><h4>{plan.body.request}</h4><p>{plan.status.replaceAll("_", " ")} · revision {plan.revision} · {plan.body.studentIds?.length ?? 0} students</p>{plan.body.questions.length ? <ul>{plan.body.questions.map(q => <li key={q}>{q}</li>)}</ul> : <ol>{plan.body.steps.map(s => <li key={s}>{s}</li>)}</ol>}<div className="ch11-buttons">
        {role !== "hod" && plan.status !== "locked" ? <button data-action-id={action("revise")} onClick={() => edit(plan)}>Revise</button> : null}
        {role !== "hod" && plan.status === "ready" ? <button data-action-id={action("lock")} disabled={pending} onClick={() => void command(`plans/${plan.id}/lock`, { expectedRevision: plan.revision })}>Lock plan</button> : null}
        {role !== "hod" && plan.status === "locked" ? <button data-action-id={action("execute")} disabled={pending} onClick={() => void command(`plans/${plan.id}/execute`, {})}>{pending ? "Working…" : "Run or resume review"}</button> : null}
        <a data-action-id={action("export")} href={`/api/bff/chapter11/plans/${plan.id}/export`} download>Export evidence</a></div>
        <div className="ch11-jobs">{data.jobs.filter(j => j.plan_id === plan.id).map(job => <article key={job.id}><strong>{data.students.find(s => s.id === job.student_id)?.display_name ?? "Scoped student"}</strong><p>{job.status.replaceAll("_", " ")} · stage {job.stage}{job.risk ? ` · concern ${job.risk.score}/100 (${job.risk.band})` : ""}</p>{job.error_code ? <p>Stopped: {job.error_code}. Check source records, then resume.</p> : null}{job.risk?.signals.map(s => <p key={s.code}>{s.explanation}</p>)}{job.mode ? <small>Actual execution: {job.mode}. Validation: {String(job.validation?.valid ?? false)}. {job.validation?.providerError ?? ""}</small> : null}</article>)}</div>
      </article>)}</div>
      {role === "faculty" && review ? <div className="ch11-card"><h3>Mentor edits and intervention follow-up</h3><p>Save edits for validation, then approve the refreshed case above. A rollback withdraws the published support plan from the student and parent; the audit history remains.</p>
        {review.drafts.map(draft => { const packet = draftEdits[draft.id] ?? draft.recommendation; return <details key={draft.id}><summary>{draft.display_name}: edit pending recommendation</summary><label>Recommendation summary (original summary or an exact evidence explanation)<textarea data-action-id={action("edit-summary")} value={packet.summary} onChange={e => setDraftEdits({ ...draftEdits, [draft.id]: { ...packet, summary: e.target.value } })} /></label>{packet.actions.map((a, index) => <label key={a.code}>{a.label}: due in days<input data-action-id={action("edit-due")} type="number" min={1} max={14} value={a.dueInDays} onChange={e => setDraftEdits({ ...draftEdits, [draft.id]: { ...packet, actions: packet.actions.map((item, i) => i === index ? { ...item, dueInDays: Number(e.target.value) } : item) } })} /></label>)}<label>Reason for edit<input data-action-id={action("edit-reason")} value={reviewReasons[draft.id] ?? ""} onChange={e => setReviewReasons({ ...reviewReasons, [draft.id]: e.target.value })} /></label><button data-action-id={action("edit-save")} disabled={pending || (reviewReasons[draft.id] ?? "").trim().length < 12} onClick={() => void command(`cases/${draft.id}/edit`, { expectedRevision: draft.revision, artifactId: draft.artifact_id, packet, rationale: reviewReasons[draft.id] })}>Validate and save new draft version</button></details>; })}
        {review.plans.map(plan => { const outcome = outcomes[plan.id] ?? { status: plan.status, outcome: plan.outcome }; return <article className="ch11-plan" key={plan.id}><h4>{plan.display_name}: approved support</h4><p>{plan.visible_to_student ? "Published to authorized viewers" : "Withdrawn from viewers"} · revision {plan.revision}</p><label>Intervention status<select data-action-id={action("outcome-status")} value={outcome.status} onChange={e => setOutcomes({ ...outcomes, [plan.id]: { ...outcome, status: e.target.value } })}><option value="planned">Planned / restore approved plan</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="withdrawn">Roll back published plan</option></select></label><label>Observed outcome or reason<input data-action-id={action("outcome-note")} value={outcome.outcome} onChange={e => setOutcomes({ ...outcomes, [plan.id]: { ...outcome, outcome: e.target.value } })} /></label><button data-action-id={action("outcome-save")} disabled={pending || outcome.outcome.trim().length < 12} onClick={() => void command(`interventions/${plan.id}/outcome`, { expectedRevision: plan.revision, ...outcome })}>Record outcome / apply rollback</button></article>; })}
      </div> : null}
    </>}
  </section>;
}
