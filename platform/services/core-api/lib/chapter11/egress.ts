import { createHash, randomBytes } from "node:crypto";
import type {
  Diagnosis,
  Evidence,
  GenerationContext,
  Policy,
} from "./engine";

/**
 * Privacy egress contract (Brief 11). This module is the only place that may
 * build or seal a payload for a non-loopback model endpoint. It works from an
 * allowlist: case alias, rounded numeric values, thresholds and weights,
 * per-run course and evidence aliases, relative time, catalogue codes/labels,
 * specialist instructions, anonymised prior-intervention action codes and
 * validator failure codes. Everything else stays on the server.
 */
export const METRIC_KEYS = [
  "attendancePct",
  "markPct",
  "inactivityDays",
  "overdueAssignments",
  "missedMilestones",
  "missedActivities",
] as const;
const SOURCE_ORDER = ["academic", "lms", "internship", "placement"] as const;
/** Per-course metrics live under `<metric>@<course code>` value keys. */
export const COURSE_VALUE_KEY = /^([A-Za-z]+)@([A-Za-z0-9_-]{1,40})$/;
export function courseValueKey(metric: string, courseCode: string) {
  return `${metric}@${courseCode.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}`;
}
export const COURSE_ALIAS = /\bcourse-(\d{1,3})\b/gi;
export const EVIDENCE_ALIAS = /^ev-\d{1,3}$/;
/** Declared numeric tolerance when model text rounds a cited value. */
export const ROUNDING_TOLERANCE = 0.5;

export type AliasMap = {
  caseAlias: string;
  /** alias (ev-N) -> evidence path in the frozen snapshot */
  evidence: Record<string, string>;
  /** alias (course-N) -> real course code */
  courses: Record<string, string>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const invert = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

export function metricOf(path: string): {
  source: string;
  key: string;
  metric: string;
  course?: string;
} {
  const [, source = "", , key = ""] = path.split(".");
  const match = key.match(COURSE_VALUE_KEY);
  return match
    ? { source, key, metric: match[1]!, course: match[2]! }
    : { source, key, metric: key };
}

/** Fresh aliases for one run of one case. Course order is salted per run. */
export function buildAliases(
  evidence: Evidence,
  salt: string = randomBytes(4).toString("hex"),
): AliasMap {
  const paths: string[] = [];
  const codes = new Set<string>();
  for (const source of SOURCE_ORDER) {
    const record = evidence?.[source];
    if (!record || record.state !== "present") continue;
    for (const key of Object.keys(record.values ?? {}).sort()) {
      const value = record.values[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const match = key.match(COURSE_VALUE_KEY);
      const metric = match ? match[1]! : key;
      if (!(METRIC_KEYS as readonly string[]).includes(metric)) continue;
      if (match) codes.add(match[2]!);
      paths.push(`evidence.${source}.values.${key}`);
    }
  }
  const order = (code: string) =>
    createHash("sha256").update(`${salt}:${code}`).digest("hex");
  return {
    caseAlias: `case-${salt.slice(0, 4)}`,
    evidence: Object.fromEntries(paths.map((p, i) => [`ev-${i + 1}`, p])),
    courses: Object.fromEntries(
      [...codes]
        .sort((a, b) => order(a).localeCompare(order(b)))
        .map((code, i) => [`course-${i + 1}`, code]),
    ),
  };
}

function relativeDays(observedAt: string | undefined, now: number) {
  const at = Date.parse(observedAt ?? "");
  if (!Number.isFinite(at)) return "unknown";
  const days = Math.max(0, Math.round((now - at) / 86400000));
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

export type EgressOptions = {
  aliases: AliasMap;
  pack: string;
  instruction: string;
  catalogue: Array<{ code: string; label: string }>;
  /** server-constant guidance text keyed by library reference id */
  library?: Record<string, string>;
  failing?: Diagnosis[];
  now?: number;
};

/** The allowlisted drafting payload. Only fields built here may leave. */
export function serializeDraftRequest(
  context: GenerationContext,
  options: EgressOptions,
) {
  const now = options.now ?? Date.now();
  const pathToAlias = invert(options.aliases.evidence);
  const codeToCourse = invert(options.aliases.courses);
  const catalogueCodes = new Set(options.catalogue.map((c) => c.code));
  const evidence = Object.entries(options.aliases.evidence).map(
    ([ref, path]) => {
      const m = metricOf(path);
      const record = context.evidence[m.source as keyof Evidence];
      return {
        ref,
        source: m.source,
        metric: m.metric,
        value: round1(Number(record.values[m.key])),
        ...(m.course ? { course: codeToCourse[m.course] ?? "course-?" } : {}),
        observed: relativeDays(record.observedAt, now),
      };
    },
  );
  const signals = context.risk.signals
    .filter((s) => pathToAlias[s.path])
    .map((s) => ({
      code: s.code,
      evidence: pathToAlias[s.path]!,
      value: round1(s.value),
      threshold: s.threshold,
      direction: s.value < s.threshold ? "below" : "at_or_above",
      points: s.points,
    }));
  const policy: Policy | undefined = context.policy;
  const payload = {
    case: options.aliases.caseAlias,
    specialist: { pack: options.pack, instruction: options.instruction },
    risk: { score: context.risk.score, band: context.risk.band },
    signals,
    evidence,
    ...(policy
      ? {
          policy: {
            thresholds: {
              attendanceMinimum: policy.attendanceMinimum,
              markMinimum: policy.markMinimum,
              inactivityMaximum: policy.inactivityMaximum,
              overdueMinimum: policy.overdueMinimum,
              internshipMinimum: policy.internshipMinimum,
              placementMinimum: policy.placementMinimum,
              mediumScore: policy.mediumScore,
              highScore: policy.highScore,
            },
            weights: {
              attendance: policy.attendanceWeight,
              mark: policy.markWeight,
              inactivity: policy.inactivityWeight,
              overdue: policy.overdueWeight,
              internship: policy.internshipWeight,
              placement: policy.placementWeight,
            },
          },
        }
      : {}),
    catalogue: options.catalogue.map((c) => ({ code: c.code, label: c.label })),
    guidance: context.references
      .map((r) => options.library?.[r.id])
      .filter((t): t is string => !!t),
    priorInterventions: context.references
      .filter((r) => !options.library?.[r.id] && r.actionCodes?.length)
      .map((r) => ({
        actions: (r.actionCodes ?? []).filter((c) => catalogueCodes.has(c)),
        similarity: round2(r.similarity),
      }))
      .filter((r) => r.actions.length),
    failing: (options.failing ?? []).map((f) => `${f.field}:${f.code}`),
  };
  return { payload, fields: fieldList(payload) };
}

/** Flattened key paths (array positions collapsed) for the audit row. */
export function fieldList(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    const nested = new Set<string>();
    for (const item of value)
      for (const f of fieldList(item, `${prefix}[]`)) nested.add(f);
    return nested.size ? [...nested] : [`${prefix}[]`];
  }
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      fieldList(v, prefix ? `${prefix}.${k}` : k),
    );
  return [prefix];
}

export type GuardRoster = {
  /** person names: the full name and each name part are blocked */
  names: string[];
  /** organisation names (department, college): blocked as whole phrases */
  phrases?: string[];
  registers?: string[];
  emails?: string[];
};
export type EgressCategory =
  | "register_number"
  | "email"
  | "phone"
  | "uuid"
  | "date"
  | "roster_name";
export type EgressAudit = {
  provider: string;
  model: string;
  payloadHash: string;
  fields: string[];
  bytes: number;
  outcome: "sent" | "blocked";
  category?: EgressCategory;
};
export class EgressBlocked extends Error {
  override name = "EgressBlocked";
  constructor(
    readonly category: EgressCategory,
    readonly audit?: EgressAudit,
  ) {
    super("EGRESS_BLOCKED");
  }
}

const PATTERNS: Array<[EgressCategory, RegExp]> = [
  ["uuid", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i],
  // Cohort register format, e.g. 01FE24BCI047, then any other 8-16 character
  // token mixing at least two letters and two digits.
  [
    "register_number",
    /(?<![A-Za-z0-9])\d{1,2}[A-Z]{2,4}\d{2}[A-Z]{2,4}\d{2,4}(?![A-Za-z0-9])/i,
  ],
  [
    "register_number",
    /(?<![A-Za-z0-9])(?=[A-Za-z0-9]{8,16}(?![A-Za-z0-9]))(?=(?:[A-Za-z]*\d){2})(?=(?:\d*[A-Za-z]){2})[A-Za-z0-9]+/,
  ],
  [
    "date",
    /(?<!\d)(?:(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2})(?!\d)/,
  ],
  ["phone", /(?<![\d.])\+?\d(?:[ -]?\d){9,13}(?![\d.])/],
];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_STOPWORDS = new Set(["and", "the", "for", "with", "van", "von", "der", "del", "bin"]);
function rosterPattern(roster: GuardRoster | undefined) {
  const tokens = new Set<string>();
  for (const name of roster?.names ?? []) {
    const clean = name.normalize("NFKC").trim();
    if (clean.length >= 3) tokens.add(clean);
    for (const part of clean.split(/[^\p{L}\p{M}'-]+/u))
      if ([...part].length >= 3 && !NAME_STOPWORDS.has(part.toLowerCase()))
        tokens.add(part);
  }
  for (const phrase of roster?.phrases ?? []) {
    const clean = phrase.normalize("NFKC").trim();
    if (clean.length >= 4) tokens.add(clean);
  }
  if (!tokens.size) return undefined;
  return new RegExp(
    `(?<![\\p{L}\\p{M}])(?:${[...tokens].map(escape).join("|")})(?![\\p{L}\\p{M}])`,
    "iu",
  );
}

/** Returns the first matched category, never the matched value. */
export function scanForIdentifiers(
  serialized: string,
  roster?: GuardRoster,
): EgressCategory | undefined {
  const text = serialized.normalize("NFKC");
  for (const [category, pattern] of PATTERNS)
    if (pattern.test(text)) return category;
  const lower = text.toLowerCase();
  for (const register of roster?.registers ?? [])
    if (register.length >= 4 && lower.includes(register.toLowerCase()))
      return "register_number";
  for (const email of roster?.emails ?? [])
    if (email.length >= 4 && lower.includes(email.toLowerCase()))
      return "email";
  if (rosterPattern(roster)?.test(text)) return "roster_name";
  return undefined;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/**
 * Seal the exact bytes that will leave the server: guard, then audit. A send to
 * any non-loopback model must use `serialized` from this function.
 */
export function sealOutbound(
  body: Record<string, unknown>,
  options: {
    provider: string;
    model: string;
    fields: string[];
    roster?: GuardRoster;
  },
): { serialized: string; audit: EgressAudit } {
  const serialized = JSON.stringify(body);
  const category = scanForIdentifiers(serialized, options.roster);
  const audit: EgressAudit = {
    provider: options.provider,
    model: options.model,
    payloadHash: sha256(serialized),
    fields: options.fields,
    bytes: Buffer.byteLength(serialized),
    outcome: category ? "blocked" : "sent",
    ...(category ? { category } : {}),
  };
  if (category) throw new EgressBlocked(category, audit);
  return { serialized, audit };
}

function restoreText(text: string, aliases: AliasMap) {
  return text
    .replace(COURSE_ALIAS, (whole, n: string) => {
      const code = aliases.courses[`course-${Number(n)}`];
      return code ?? whole;
    })
    .replaceAll(aliases.caseAlias, "the student");
}
/**
 * Server-side restoration after validation: evidence aliases become frozen
 * snapshot paths and course aliases become real course codes. Unknown aliases
 * are left untouched so validation still rejects them.
 */
export function restoreAliases<T>(value: T, aliases: AliasMap): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v))
      return v.map((item) =>
        key === "citations" && typeof item === "string"
          ? (aliases.evidence[item] ?? item)
          : walk(item),
      );
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, k)]),
      );
    if (typeof v === "string" && key !== "code" && key !== "schema")
      return restoreText(v, aliases);
    return v;
  };
  return walk(value) as T;
}

/** Evidence paths a citation token may stand for (alias or real path). */
export function resolveCitation(
  token: string,
  aliases: AliasMap | undefined,
): string {
  return (aliases && aliases.evidence[token]) || token;
}
