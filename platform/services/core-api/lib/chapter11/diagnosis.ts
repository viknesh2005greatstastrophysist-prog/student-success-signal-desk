import { actionCodes, domainNames, type DomainName } from "./catalogue";
import {
  EVIDENCE_ALIAS,
  resolveCitation,
  scanForIdentifiers,
  type AliasMap,
  type GuardRoster,
} from "./egress";
import type { Diagnosis, Risk } from "./engine";
import { specialistRegistry } from "./specialists";

/**
 * Brief 16-lite: deterministic diagnosis in the repair loop. Every validator
 * failure (a code plus the failing field, sentence or action) becomes a
 * plain-language diagnosis and a targeted patch instruction for the
 * Regenerator. No model call is involved. Instructions are assembled from the
 * fixed templates below plus codes, paths, ev-/course-/case- aliases and
 * numbers only: never a name, a date or any text copied from the draft or the
 * evidence. Each instruction is checked against that closed vocabulary and the
 * egress identifier scan, and anything that fails falls back to a generic
 * instruction built from the code and path alone.
 */
export type RepairDiagnosis = {
  code: string;
  path: string;
  diagnosis: string;
  instruction: string;
};

/** Plain-language wording per failure code. These strings are identical to
 * `ISSUES` in streamlit_app/labels.py (a test keeps the two in step). */
export const DIAGNOSIS_TEXT: Record<string, string> = {
  ADVISOR_REVIEW_REQUIRED: "Mentor review required",
  CATALOGUE_OR_DOMAIN_MISMATCH: "Action outside the approved catalogue",
  LENGTH_LIMIT: "Draft text outside the length limits",
  MISSING_TRIGGER_COVERAGE: "A triggering signal was not cited",
  OUTPUT_PII: "Personal details in the draft text",
  PRIVACY_SCOPE_MISMATCH: "Evidence outside the permitted scope",
  SCHEMA_INVALID: "Draft did not match the required format",
  SPECIALIST_LANGUAGE: "Wording not allowed for a wellbeing referral",
  SPECIALIST_MISMATCH: "Draft from the wrong specialist",
  SPECIALIST_SCOPE: "Evidence outside the specialist's scope",
  THRESHOLDS_NOT_FACULTY_SET: "Thresholds not set by faculty",
  UNCITED_CLAIM: "A sentence without an evidence citation",
  UNKNOWN_COURSE_ALIAS: "A course reference that does not exist",
  UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS: "Unsafe or diagnostic wording",
  UNSUPPORTED_CITATION: "Citation not found in the evidence",
  UNSUPPORTED_NUMBER: "A number not found in the evidence",
  UNSUPPORTED_SUMMARY: "Summary not supported by the evidence",
  JUDGE_ACTIONABILITY_LOW: "Judge: actions not practical enough for the mentor",
  JUDGE_GROUNDING_LOW: "Judge: claims not grounded in the cited evidence",
  JUDGE_SPECIFICITY_LOW: "Judge: too generic, lacks the concrete values",
  JUDGE_TONE_LOW: "Judge: tone not safe and supportive enough",
};

/** Schema limits the validator enforces (packet-v2), for length instructions. */
const LIMITS: Record<string, [number, number]> = {
  text: [12, 320],
  personalisation: [12, 400],
  talkingPoints: [4, 200],
  summary: [12, 600],
};
const MAX_CITATIONS = 6;

const TEMPLATES = {
  numberRefs:
    "rewrite {loc} so every number equals a cited value or a policy threshold, citing only {refs}",
  number:
    "rewrite {loc} so every number equals a cited value or a policy threshold",
  uncited: "rewrite {loc} so it cites at least one of {refs}",
  uncitedAny: "rewrite {loc} so it cites at least one triggering signal",
  citationRefs: "rewrite {loc} so it cites only {refs} from the evidence list",
  citation: "rewrite {loc} so it cites only refs from the evidence list",
  canonical: "keep the canonical trigger citations unchanged",
  coverage:
    "make the rationale and actions together cite every triggering signal, still uncited: {refs}",
  coverageAny:
    "make the rationale and actions together cite every triggering signal at least once",
  authority:
    "rewrite {loc} as a neutral description of the cited values with no diagnosis, prediction or promised contact",
  catalogueRefs:
    "rewrite {loc} so it cites only {refs} and uses {article} {domain}-domain code, one of {codes}",
  catalogue:
    "rewrite {loc} so it uses {article} {domain}-domain code, one of {codes}",
  pii: "rewrite {loc} without names, register numbers, emails, dates or phone numbers and refer to courses only by course aliases",
  courseAlias:
    "rewrite {loc} using only course aliases that appear in the evidence list",
  language:
    "rewrite {loc} in neutral terms that describe only the cited indicators, with no health, family or personal wording",
  scopeRefs: "rewrite {loc} so it cites only triggering evidence, {refs}",
  scope: "rewrite {loc} so it cites only triggering evidence",
  length: "rewrite {loc} to between {min} and {max} characters",
  citationCount: "rewrite {loc} to cite at most {max} refs",
  schema: "return {loc} again in the required format",
  specialist: "draft as the {domain} specialist",
  summary:
    "use the baseline summary verbatim or exactly one supplied risk explanation",
  advisor:
    "rewrite {loc} as advice for the assigned mentor, with no action owned by the student",
  human: "no model repair applies, hand this case to the assigned mentor",
  generic: "rewrite {loc} so it passes check {code}",
} as const;

/** Words that location labels add to the templates. */
const LOCATION_WORDS = [
  "rationale",
  "action",
  "citation",
  "citations",
  "actions",
  "summary",
  "specialist",
  "schema",
  "prohibited",
  "sentence",
  "a",
  "an",
];
const wordsOf = (text: string) =>
  text.replace(/\{\w+\}/g, " ").match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
/** The closed vocabulary an instruction may use besides tokens, numbers and codes. */
export const REPAIR_VOCABULARY: ReadonlySet<string> = new Set([
  ...Object.values(TEMPLATES).flatMap(wordsOf),
  ...LOCATION_WORDS,
]);
const CODE_WORDS = new Set<string>([
  ...actionCodes,
  ...domainNames,
  ...domainNames.map((d) => `${d}-domain`),
]);
const TOKEN =
  /^(?:(?:ev|course|stu)-\d{1,3}|case-[0-9a-f]{4}|[arc]\d{1,2}|[a-z]{3,20}\[\d{1,2}\](?:\.[A-Za-z]{2,20}(?:\[\d{1,2}\])?)?|\d{1,4}(?:\.\d{1,2})?%?|[A-Z][A-Z0-9_]{2,40})$/;

/** True when the text is built only from template words, aliases, paths,
 * codes and numbers, and the egress identifier scan finds nothing in it. */
export function isSafeInstruction(text: string, roster?: GuardRoster): boolean {
  if (!text || text.length > 400) return false;
  for (const raw of text.split(/[\s,;:()]+/)) {
    const token = raw.replace(/\.$/, "");
    if (!token) continue;
    if (!(REPAIR_VOCABULARY.has(token) || CODE_WORDS.has(token) || TOKEN.test(token)))
      return false;
  }
  return scanForIdentifiers(text, roster) === undefined;
}

type Location = {
  field: string;
  /** path of the failing item, e.g. rationale[1] */
  base: string;
  index?: number;
  sub?: string;
  /** label used in instructions, e.g. "action a2 (actions[1])" */
  label: string;
  /** label for people, e.g. "action 2" */
  human: string;
};
const PATH = /^([a-z]{3,20})(?:\[(\d{1,2})\])?(?:\.([A-Za-z]{2,20}(?:\[\d{1,2}\])?))?$/;
const NOUN: Record<string, [string, string, string]> = {
  rationale: ["rationale", "r", "sentence"],
  actions: ["action", "a", "action"],
  citations: ["citation", "c", "citation"],
};

function locate(failure: Diagnosis): Location {
  const match = (failure.path ?? failure.field).match(PATH);
  const field = match ? match[1]! : failure.field;
  const index = match?.[2] !== undefined ? Number(match[2]) : undefined;
  const sub = match?.[3];
  const noun = NOUN[field];
  if (index === undefined || !noun)
    return { field, base: field, sub, label: field, human: field };
  const base = `${field}[${index}]`;
  const subHuman = sub
    ? sub.replace(/\[(\d+)\]/, (_m, n: string) => ` ${Number(n) + 1}`).replace("talkingPoints", "talking point")
    : "";
  return {
    field,
    base,
    index,
    sub,
    label: `${noun[0]} ${noun[1]}${index + 1} (${base}${sub ? `.${sub}` : ""})`,
    human:
      field === "rationale"
        ? `rationale sentence ${index + 1}${subHuman && subHuman !== "text" ? `, ${subHuman}` : ""}`
        : `${noun[2]} ${index + 1}${subHuman ? `, ${subHuman}` : ""}`,
  };
}

export type DiagnoseContext = {
  /** the failing candidate (alias or real form), to read which refs an item cites */
  candidate?: unknown;
  aliases?: AliasMap;
  risk?: Risk;
  /** the specialist domain the draft belongs to */
  domain?: DomainName;
  roster?: GuardRoster;
};

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const byNumber = (a: string, b: string) =>
  Number(a.split("-")[1]) - Number(b.split("-")[1]);

function refResolver(aliases: AliasMap | undefined) {
  const toAlias = new Map(
    Object.entries(aliases?.evidence ?? {}).map(([alias, path]) => [path, alias]),
  );
  /** an ev- alias for a citation token or evidence path; undefined if unknown */
  return (token: unknown): string | undefined => {
    if (typeof token !== "string") return undefined;
    if (EVIDENCE_ALIAS.test(token))
      return !aliases || aliases.evidence[token] !== undefined ? token : undefined;
    return toAlias.get(token);
  };
}

function formatRefs(refs: Iterable<string | undefined>): string {
  return [...new Set([...refs].filter((r): r is string => !!r))]
    .sort(byNumber)
    .slice(0, MAX_CITATIONS)
    .join(", ");
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ""));
}

/**
 * Map validator failures to {code, path, diagnosis, instruction}. Pure and
 * deterministic: the same failures and context always give the same output.
 */
export function diagnose(
  failures: Diagnosis[],
  ctx: DiagnoseContext = {},
): RepairDiagnosis[] {
  const resolve = refResolver(ctx.aliases);
  const record = asRecord(ctx.candidate);
  const domain: DomainName = ctx.domain ?? "academic";
  const codes = (specialistRegistry[domain] ?? specialistRegistry.academic).codes;
  const signalPaths = new Set((ctx.risk?.signals ?? []).map((s) => s.path));
  const signalRefs = formatRefs((ctx.risk?.signals ?? []).map((s) => resolve(s.path)));
  const itemOf = (loc: Location) => {
    const list = record?.[loc.field];
    return loc.index !== undefined && Array.isArray(list)
      ? asRecord(list[loc.index])
      : undefined;
  };
  const citedRefs = (loc: Location) => {
    const cites = itemOf(loc)?.citations;
    return Array.isArray(cites) ? formatRefs(cites.map(resolve)) : "";
  };
  /** triggering signals no rationale sentence or action cites (citations are server-derived) */
  const uncitedRefs = () => {
    const cited = new Set<string>();
    for (const field of ["rationale", "actions"]) {
      const list = record?.[field];
      for (const item of Array.isArray(list) ? list : []) {
        const cites = asRecord(item)?.citations;
        for (const token of Array.isArray(cites) ? cites : [])
          if (typeof token === "string")
            cited.add(resolveCitation(token, ctx.aliases));
      }
    }
    return formatRefs(
      [...signalPaths].filter((p) => !cited.has(p)).map((p) => resolve(p)),
    );
  };

  const seen = new Set<string>();
  const out: RepairDiagnosis[] = [];
  for (const failure of failures) {
    const loc = locate(failure);
    const path = loc.sub ? `${loc.base}.${loc.sub}` : loc.base;
    const key = `${failure.code}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const own = citedRefs(loc);
    const vars = {
      loc: loc.label,
      refs: "",
      domain,
      article: /^[aeiou]/.test(domain) ? "an" : "a",
      codes: codes.join(", "),
      code: failure.code,
      min: 0,
      max: 0,
    } as Record<string, string | number>;
    const say = (template: keyof typeof TEMPLATES, refs = "") =>
      fill(TEMPLATES[template], { ...vars, refs });
    let instruction: string;
    if (loc.field === "summary") instruction = say("summary");
    else
      switch (failure.code) {
        case "UNSUPPORTED_NUMBER":
          instruction = own ? say("numberRefs", own) : say("number");
          break;
        case "UNCITED_CLAIM":
          instruction = signalRefs ? say("uncited", signalRefs) : say("uncitedAny");
          break;
        case "UNSUPPORTED_CITATION":
          instruction =
            loc.field === "citations"
              ? say("canonical")
              : own
                ? say("citationRefs", own)
                : say("citation");
          break;
        case "MISSING_TRIGGER_COVERAGE": {
          const refs = uncitedRefs();
          instruction = refs ? say("coverage", refs) : say("coverageAny");
          break;
        }
        case "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS":
          instruction = say("authority");
          break;
        case "CATALOGUE_OR_DOMAIN_MISMATCH":
          instruction = own ? say("catalogueRefs", own) : say("catalogue");
          break;
        case "OUTPUT_PII":
          instruction = say("pii");
          break;
        case "UNKNOWN_COURSE_ALIAS":
          instruction = say("courseAlias");
          break;
        case "SPECIALIST_LANGUAGE":
          instruction = say("language");
          break;
        case "SPECIALIST_SCOPE":
          instruction = signalRefs ? say("scopeRefs", signalRefs) : say("scope");
          break;
        case "LENGTH_LIMIT": {
          const limit = LIMITS[(loc.sub ?? "").replace(/\[\d+\]/, "")] ?? (loc.field === "rationale" ? LIMITS.text : undefined);
          instruction = /citations$/.test(loc.sub ?? "")
            ? fill(TEMPLATES.citationCount, { ...vars, max: MAX_CITATIONS })
            : limit
              ? fill(TEMPLATES.length, { ...vars, min: limit[0], max: limit[1] })
              : say("generic");
          break;
        }
        case "SCHEMA_INVALID":
          instruction = say("schema");
          break;
        case "SPECIALIST_MISMATCH":
          instruction = say("specialist");
          break;
        case "ADVISOR_REVIEW_REQUIRED":
          instruction = say("advisor");
          break;
        case "THRESHOLDS_NOT_FACULTY_SET":
        case "PRIVACY_SCOPE_MISMATCH":
          instruction = say("human");
          break;
        default:
          instruction = say("generic");
      }
    if (!isSafeInstruction(instruction, ctx.roster))
      instruction = fill(TEMPLATES.generic, {
        ...vars,
        loc: loc.base,
        code: /^[A-Z][A-Z0-9_]{2,40}$/.test(failure.code) ? failure.code : "SCHEMA_INVALID",
      });
    const wording = DIAGNOSIS_TEXT[failure.code] ?? "Draft did not pass a check";
    out.push({
      code: failure.code,
      path,
      diagnosis: loc.human === loc.field ? wording : `${wording} (${loc.human})`,
      instruction,
    });
  }
  return out;
}
