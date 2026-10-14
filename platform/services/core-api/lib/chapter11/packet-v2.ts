import { z } from "zod";
import { actions, actionCodes, domainNames, type ActionCode, type DomainName } from "./catalogue";
import {
  COURSE_ALIAS,
  COURSE_VALUE_KEY,
  ROUNDING_TOLERANCE,
  TOOL_VALUE_KEY,
  metricOf,
  resolveCitation,
  scanForIdentifiers,
  type AliasMap,
  type GuardRoster,
} from "./egress";
import type { Diagnosis, Evidence, Packet, Policy, Risk, Signal } from "./engine";

/**
 * packet-v2 (Brief 11): the model writes cited rationale sentences and
 * per-action personalisation inside the approved catalogue. The summary,
 * labels, owner and canonical trigger citations stay server-derived, so v1
 * renderers and the four acceptance checks keep working unchanged.
 */
export const PACKET_V2 = "packet-v2" as const;
const citationTokens = z.array(z.string().min(2).max(120)).max(6);
export const packetV2Schema = z
  .object({
    schema: z.literal(PACKET_V2),
    specialist: z.enum(domainNames),
    summary: z.string().min(12).max(600),
    rationale: z
      .array(
        z
          .object({ text: z.string().min(12).max(320), citations: citationTokens })
          .strict(),
      )
      .min(2)
      .max(5),
    actions: z
      .array(
        z
          .object({
            code: z.enum(actionCodes),
            label: z.string().min(8).max(180),
            owner: z.enum(["assigned_faculty", "student"]),
            personalisation: z.string().min(12).max(400),
            talkingPoints: z.array(z.string().min(4).max(200)).min(1).max(4),
            dueInDays: z.number().int().min(1).max(14),
            citations: citationTokens,
          })
          .strict(),
      )
      .min(1)
      .max(4),
    citations: z
      .array(
        z
          .object({
            evidencePath: z.string(),
            statement: z.string().min(4).max(180),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    prohibited: z.array(z.string()).max(0),
  })
  .strict();
export type PacketV2 = z.infer<typeof packetV2Schema>;
export const isPacketV2 = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  (value as { schema?: unknown }).schema === PACKET_V2;

export const UNSAFE_LANGUAGE =
  /diagnos|depress|suicid|automatically contact|email the parent|send.*message|change.*mark|guarantee|will fail|punish|expel/i;

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
const ATTENDANCE_PATH = "evidence.academic.values.attendancePct";

export function courseCodesIn(evidence: Evidence): string[] {
  const codes = new Set<string>();
  for (const source of ["academic", "lms", "internship", "placement", "tools"] as const)
    for (const key of Object.keys(
      (evidence as unknown as Record<string, { values?: Record<string, unknown> }>)?.[source]?.values ?? {},
    )) {
      const m = key.match(COURSE_VALUE_KEY);
      if (m) codes.add(m[2]!);
      const t = key.match(TOOL_VALUE_KEY);
      if (t && t[2] === "course") codes.add(t[3]!);
    }
  return [...codes].sort((a, b) => b.length - a.length);
}

/* ----------------------------- template ------------------------------ */

function lowestCourse(evidence: Evidence, metric: string) {
  const values = evidence?.academic?.values ?? {};
  let best: { path: string; code: string; value: number } | undefined;
  for (const [key, value] of Object.entries(values)) {
    const m = key.match(COURSE_VALUE_KEY);
    if (!m || m[1] !== metric || typeof value !== "number") continue;
    if (!best || value < best.value)
      best = { path: `evidence.academic.values.${key}`, code: m[2]!, value };
  }
  return best;
}

function templateRationale(
  risk: Risk,
  evidence: Evidence,
  view: "full" | "triggering",
) {
  const sig = (code: string) => risk.signals.find((s) => s.code === code);
  const out: Array<{ text: string; citations: string[] }> = [];
  const attendance = sig("ATTENDANCE_LOW");
  if (attendance) {
    const course =
      view === "full" ? lowestCourse(evidence, "attendancePct") : undefined;
    out.push(
      course && course.value < attendance.threshold
        ? {
            text: `Attendance is ${fmt(attendance.value)}% overall against the ${attendance.threshold}% minimum in the approved policy, and lowest in ${course.code} at ${fmt(course.value)}%.`,
            citations: [attendance.path, course.path],
          }
        : {
            text: `Attendance is ${fmt(attendance.value)}% against the ${attendance.threshold}% minimum in the approved policy.`,
            citations: [attendance.path],
          },
    );
  }
  const mark = sig("MARK_LOW");
  if (mark)
    out.push({
      text: `The average mark is ${fmt(mark.value)}%, below the ${mark.threshold}% minimum in the approved policy.`,
      citations: [mark.path],
    });
  const inactive = sig("LMS_INACTIVE"),
    overdue = sig("ASSIGNMENT_OVERDUE");
  if (inactive && overdue)
    out.push({
      text: `There has been no LMS activity for ${fmt(inactive.value)} days, where the policy flags ${inactive.threshold} or more, and ${fmt(overdue.value)} learning activities are overdue.`,
      citations: [inactive.path, overdue.path],
    });
  else if (inactive)
    out.push({
      text: `There has been no LMS activity for ${fmt(inactive.value)} days, where the policy flags ${inactive.threshold} or more.`,
      citations: [inactive.path],
    });
  else if (overdue)
    out.push({
      text: `${fmt(overdue.value)} learning activities are overdue, where the policy flags ${overdue.threshold} or more.`,
      citations: [overdue.path],
    });
  const internship = sig("INTERNSHIP_MILESTONE"),
    placement = sig("PLACEMENT_ACTIVITY");
  const career = [internship, placement].filter((s): s is Signal => !!s);
  if (career.length)
    out.push({
      text: `Career preparation also needs attention: ${career
        .map((s) =>
          s.code === "INTERNSHIP_MILESTONE"
            ? `${fmt(s.value)} internship milestones missed`
            : `${fmt(s.value)} placement activities missed`,
        )
        .join(" and ")}.`,
      citations: career.map((s) => s.path),
    });
  const anchor = risk.signals[0]?.path ?? ATTENDANCE_PATH;
  if (!risk.signals.length)
    out.push({
      text: "No policy threshold was crossed in the current evidence; this is a routine review.",
      citations: [anchor],
    });
  if (out.length < 2)
    out.push({
      text: "The mentor should confirm this reading with the student before agreeing any step.",
      citations: [anchor],
    });
  return out.slice(0, 5);
}

function templateAction(code: ActionCode, risk: Risk) {
  const sig = (c: string) => risk.signals.find((s) => s.code === c);
  const all = risk.signals.map((s) => s.path);
  const anchor = all.length ? all : [ATTENDANCE_PATH];
  const mark = sig("MARK_LOW"),
    attendance = sig("ATTENDANCE_LOW"),
    overdue = sig("ASSIGNMENT_OVERDUE"),
    inactive = sig("LMS_INACTIVE"),
    internship = sig("INTERNSHIP_MILESTONE"),
    placement = sig("PLACEMENT_ACTIVITY");
  switch (code) {
    case "faculty-check-in":
      return {
        personalisation:
          "Go through the flagged indicators together and agree which one to tackle first.",
        talkingPoints: [
          "Which of these indicators does the student recognise, and what is behind them?",
          "What would make the next fortnight more manageable?",
        ],
        citations: anchor,
      };
    case "student-study-plan":
      return mark
        ? {
            personalisation: `Build the weekly plan around closing the mark gap: the average is ${fmt(mark.value)}% against the ${mark.threshold}% minimum.`,
            talkingPoints: [
              "Which topics or assessments feel hardest right now?",
              "What weekly study time is realistic alongside classes?",
            ],
            citations: [mark.path],
          }
        : {
            personalisation:
              "Build the weekly plan around regular attendance and steady coursework.",
            talkingPoints: ["What weekly study time is realistic alongside classes?"],
            citations: anchor,
          };
    case "attendance-review":
      return attendance
        ? {
            personalisation: `Talk through what is getting in the way of attending: attendance is ${fmt(attendance.value)}% against the ${attendance.threshold}% minimum.`,
            talkingPoints: [
              "Which classes are hardest to attend, and why?",
              "What would help the student attend consistently?",
            ],
            citations: [attendance.path],
          }
        : {
            personalisation:
              "Review the attendance record together and agree a simple plan.",
            talkingPoints: ["What would help the student attend consistently?"],
            citations: anchor,
          };
    case "lms-catch-up":
      return overdue
        ? {
            personalisation: `Agree dates for the ${fmt(overdue.value)} overdue learning activities, starting with the earliest.`,
            talkingPoints: [
              "Which overdue activity can be finished first?",
              "Is anything blocking access to the LMS?",
            ],
            citations: [overdue.path],
          }
        : inactive
          ? {
              personalisation: `Agree a short routine to get back into the LMS after ${fmt(inactive.value)} days without activity.`,
              talkingPoints: ["Is anything blocking access to the LMS?"],
              citations: [inactive.path],
            }
          : {
              personalisation:
                "Agree a catch-up routine for learning activities on the LMS.",
              talkingPoints: ["Is anything blocking access to the LMS?"],
              citations: anchor,
            };
    case "internship-review":
      return {
        personalisation: internship
          ? `Review the ${fmt(internship.value)} missed internship milestones and agree the next one to complete.`
          : "Review internship milestones and agree the next one to complete.",
        talkingPoints: [
          "What got in the way of the missed milestones?",
          "Who at the internship can help with the next step?",
        ],
        citations: internship ? [internship.path] : anchor,
      };
    case "placement-review":
      return {
        personalisation: placement
          ? `Review the ${fmt(placement.value)} missed placement activities and agree which to make up first.`
          : "Review placement preparation and agree which activity to make up first.",
        talkingPoints: [
          "Which placement activity matters most to the student?",
          "What support would help with preparation?",
        ],
        citations: placement ? [placement.path] : anchor,
      };
    case "wellbeing-referral":
      return {
        personalisation:
          "Ask openly, without assumptions, whether the student would like to hear about optional support services.",
        talkingPoints: [
          "Is anything outside coursework making this term harder?",
          "Would it help to hear about the optional support services the college offers?",
        ],
        citations: anchor,
      };
  }
}

/** Grounded baseline in packet-v2 form: the anchor the model drafts from and
 * the validators compare against. It is never published as a draft. */
export function templateV2(
  v1: Packet,
  risk: Risk,
  evidence: Evidence,
  specialist: DomainName,
  view: "full" | "triggering" = "full",
): PacketV2 {
  return {
    schema: PACKET_V2,
    specialist,
    summary: v1.summary,
    rationale: templateRationale(risk, evidence, view),
    actions: v1.actions.map((a) => ({
      code: a.code,
      label: a.label,
      owner: "assigned_faculty" as const,
      ...templateAction(a.code, risk),
      dueInDays: a.dueInDays,
    })),
    citations: v1.citations,
    prohibited: [],
  };
}

/** Turn the model's {rationale, actions} into a full candidate. Server fields
 * (summary, specialist, labels, owner, canonical citations) come from the
 * template; non-object output is returned as-is so validation reports it. */
export function assembleDraft(raw: unknown, baseline: PacketV2): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = raw as { rationale?: unknown; actions?: unknown };
  return {
    ...baseline,
    rationale: r.rationale,
    actions: Array.isArray(r.actions)
      ? r.actions.map((a: Record<string, unknown>) =>
          a && typeof a === "object"
            ? {
                code: a.code,
                label: actions[a.code as ActionCode] ?? String(a.code),
                owner: "assigned_faculty",
                personalisation: a.personalisation,
                talkingPoints: a.talkingPoints,
                dueInDays: a.dueInDays,
                citations: a.citations,
              }
            : a,
        )
      : r.actions,
  };
}

/** Strict JSON schema for the model output (no length keywords; the
 * validator enforces limits). Citation refs are constrained to the aliases. */
export function draftOutputJsonSchema(codes: string[], refs: string[]) {
  const cites = {
    type: "array",
    items: refs.length ? { type: "string", enum: refs } : { type: "string" },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["rationale", "actions"],
    properties: {
      rationale: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "citations"],
          properties: { text: { type: "string" }, citations: cites },
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "personalisation", "talkingPoints", "dueInDays", "citations"],
          properties: {
            code: { type: "string", enum: codes },
            personalisation: { type: "string" },
            talkingPoints: { type: "array", items: { type: "string" } },
            dueInDays: { type: "integer" },
            citations: cites,
          },
        },
      },
    },
  };
}

/* ----------------------------- validator ----------------------------- */

const POLICY_THRESHOLD: Record<string, keyof Policy> = {
  attendancePct: "attendanceMinimum",
  markPct: "markMinimum",
  inactivityDays: "inactivityMaximum",
  overdueAssignments: "overdueMinimum",
  missedMilestones: "internshipMinimum",
  missedActivities: "placementMinimum",
};
const NUMBER = /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;

export type V2Options = {
  codes: ActionCode[];
  specialist: DomainName;
  canonical: Map<string, string>;
  aliases?: AliasMap;
  roster?: GuardRoster;
  policy?: Policy;
  /** extra language rule for a specialist pack (Brief 15) */
  language?: RegExp;
  /** evidence paths this pack may cite (triggering-only packs) */
  scope?: string[];
};

/** Claim-level validation of a packet-v2 candidate (alias or restored form). */
export function validatePacketV2(
  candidate: unknown,
  evidence: Evidence,
  risk: Risk,
  o: V2Options,
): { valid: boolean; failures: Diagnosis[] } {
  const parsed = packetV2Schema.safeParse(candidate);
  if (!parsed.success) {
    const fields = new Set(["summary", "rationale", "actions", "citations", "prohibited", "schema", "specialist"]);
    const failures: Diagnosis[] =
      typeof candidate !== "object" || candidate === null || Array.isArray(candidate)
        ? (["rationale", "actions"] as const).map((field) => ({ field, code: "SCHEMA_INVALID" }))
        : parsed.error.issues.map((i) => ({
            field: (fields.has(String(i.path[0])) ? i.path[0] : "summary") as Diagnosis["field"],
            code: i.code === "too_big" || i.code === "too_small" ? "LENGTH_LIMIT" : "SCHEMA_INVALID",
            ...(i.path.length > 1 && fields.has(String(i.path[0])) ? { path: pathOf(i.path) } : {}),
          }));
    return { valid: false, failures: dedupe(failures) };
  }
  const p = parsed.data;
  const failures: Diagnosis[] = [];
  // `path` names the failing item (for example rationale[1]) so a repair can
  // regenerate that sentence or action only; field-level faults carry none.
  const fail = (field: Diagnosis["field"], code: string, path?: string) =>
    failures.push(path ? { field, code, path } : { field, code });
  if (p.specialist !== o.specialist) fail("specialist", "SPECIALIST_MISMATCH");
  p.actions.forEach((a, index) => {
    if (!o.codes.includes(a.code) || a.label !== actions[a.code] || a.owner !== "assigned_faculty")
      fail("actions", "CATALOGUE_OR_DOMAIN_MISMATCH", `actions[${index}]`);
  });
  // Server-derived trigger citations: the v1 rule applies unchanged.
  p.citations.forEach((c, index) => {
    const value = valueAt(evidence, c.evidencePath);
    if (value === undefined || o.canonical.get(c.evidencePath) !== c.statement)
      fail("citations", "UNSUPPORTED_CITATION", `citations[${index}]`);
  });
  if (risk.signals.some((s) => !p.citations.some((c) => c.evidencePath === s.path)))
    fail("citations", "MISSING_TRIGGER_COVERAGE");
  if (UNSAFE_LANGUAGE.test(p.summary)) fail("summary", "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS");
  const strip = courseCodesIn(evidence);
  const claims: Array<{ field: "rationale" | "actions"; path: string; texts: string[]; citations: string[]; extra: number[] }> = [
    ...p.rationale.map((r, index) => ({ field: "rationale" as const, path: `rationale[${index}]`, texts: [r.text], citations: r.citations, extra: [] })),
    ...p.actions.map((a, index) => ({
      field: "actions" as const,
      path: `actions[${index}]`,
      texts: [a.personalisation, ...a.talkingPoints],
      citations: a.citations,
      extra: [a.dueInDays, ...numbersIn(actions[a.code] ?? "", [])],
    })),
  ];
  const cited = new Set<string>();
  for (const claim of claims) {
    if (!claim.citations.length) fail(claim.field, "UNCITED_CLAIM", claim.path);
    const paths = claim.citations.map((t) => resolveCitation(t, o.aliases));
    const allowed: number[] = [...claim.extra];
    for (const path of paths) {
      const value = valueAt(evidence, path);
      if (value === undefined) {
        fail(claim.field, "UNSUPPORTED_CITATION", claim.path);
        continue;
      }
      if (o.scope && !o.scope.includes(path)) fail(claim.field, "SPECIALIST_SCOPE", claim.path);
      cited.add(path);
      allowed.push(value);
      const metric = metricOf(path).metric;
      for (const s of risk.signals)
        if (s.path === path || metricOf(s.path).metric === metric) allowed.push(s.threshold);
      const key = POLICY_THRESHOLD[metric];
      if (o.policy && key) allowed.push(Number(o.policy[key]));
    }
    for (const text of claim.texts) {
      for (const n of numbersIn(text, strip))
        if (!allowed.some((a) => Math.abs(a - n) <= ROUNDING_TOLERANCE)) {
          fail(claim.field, "UNSUPPORTED_NUMBER", claim.path);
          break;
        }
      for (const m of text.matchAll(new RegExp(COURSE_ALIAS.source, "gi")))
        if (!o.aliases?.courses[`course-${Number(m[1])}`]) fail(claim.field, "UNKNOWN_COURSE_ALIAS", claim.path);
      if (UNSAFE_LANGUAGE.test(text)) fail(claim.field, "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS", claim.path);
      if (o.language?.test(text)) fail(claim.field, "SPECIALIST_LANGUAGE", claim.path);
      let scrubbed = text;
      for (const code of strip) scrubbed = scrubbed.split(code).join(" ");
      if (scanForIdentifiers(scrubbed, o.roster)) fail(claim.field, "OUTPUT_PII", claim.path);
    }
  }
  if (risk.signals.some((s) => !cited.has(s.path))) fail("rationale", "MISSING_TRIGGER_COVERAGE");
  // Summary numbers must come from the frozen evidence, as in v1.
  const permitted = risk.signals.flatMap((s) => [s.value, s.threshold]);
  if (numbersIn(p.summary, strip).some((n) => !permitted.some((a) => Math.abs(a - n) <= ROUNDING_TOLERANCE)))
    fail("summary", "UNSUPPORTED_NUMBER");
  const deduped = dedupe(failures);
  return { valid: deduped.length === 0, failures: deduped };
}

function valueAt(evidence: Evidence, path: string): number | undefined {
  const parts = path.split(".");
  if (parts.length !== 4 || parts[0] !== "evidence" || parts[2] !== "values") return undefined;
  const record = evidence?.[parts[1] as keyof Evidence];
  if (!record || record.state !== "present") return undefined;
  const value = record.values?.[parts[3]!];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function numbersIn(text: string, strip: string[]): number[] {
  let t = text.replace(new RegExp(COURSE_ALIAS.source, "gi"), " ").replace(/\bev-\d+\b/gi, " ");
  for (const code of strip) t = t.split(code).join(" ");
  return [...t.matchAll(NUMBER)].map((m) => Number(m[0]));
}
/** Zod issue path to a readable location, e.g. rationale[0].text. */
function pathOf(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>(
    (out, part) =>
      typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part),
    "",
  );
}
function dedupe(failures: Diagnosis[]) {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.field}:${f.code}:${f.path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
