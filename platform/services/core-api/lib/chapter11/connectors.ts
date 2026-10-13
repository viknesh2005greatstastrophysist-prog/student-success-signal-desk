/** Adapters receive scope only after the service authorizes the request. */
import type { ActorContext } from "@aura/contracts";
import type { Source, SourceName, Reference } from "./engine";
export type SourceAdapter = (
  actor: ActorContext,
  studentId: string,
  source: SourceName,
) => Promise<Source>;
export function createSourceRegistry(
  defaultAdapter: SourceAdapter,
  defaultPrior: (
    actor: ActorContext,
    studentId: string,
  ) => Promise<Reference[]> = async () => [],
) {
  const adapters: Record<SourceName, SourceAdapter> = {
    academic: defaultAdapter,
    lms: defaultAdapter,
    internship: defaultAdapter,
    placement: defaultAdapter,
  };
  let prior = defaultPrior;
  return {
    readPrior: (actor: ActorContext, studentId: string) =>
      prior(actor, studentId),
    replacePrior: (adapter: typeof defaultPrior) => {
      const previous = prior;
      prior = adapter;
      return previous;
    },
    read: (actor: ActorContext, studentId: string, source: SourceName) =>
      adapters[source](actor, studentId, source),
    replace: (source: SourceName, adapter: SourceAdapter) => {
      const previous = adapters[source];
      adapters[source] = adapter;
      return previous;
    },
  };
}
export function referenceTags(codes: string[]) {
  const tags: string[] = [];
  if (
    codes.some((c) =>
      [
        "student-study-plan",
        "lms-catch-up",
        "internship-review",
        "placement-review",
      ].includes(c),
    )
  )
    tags.push("academic");
  if (codes.includes("attendance-review")) tags.push("attendance");
  if (codes.includes("wellbeing-referral")) tags.push("wellbeing-referral");
  return tags;
}
export function anonymousPriorReference(
  id: string,
  codes: string[],
  departmentId: string,
): Reference {
  const allowed = codes.filter((c) =>
    [
      "faculty-check-in",
      "student-study-plan",
      "attendance-review",
      "lms-catch-up",
      "internship-review",
      "placement-review",
      "wellbeing-referral",
    ].includes(c),
  );
  return {
    id,
    text: `Earlier approved support actions: ${allowed.join(" ")}`,
    tags: referenceTags(allowed),
    departmentId,
    actionCodes: allowed,
  };
}
