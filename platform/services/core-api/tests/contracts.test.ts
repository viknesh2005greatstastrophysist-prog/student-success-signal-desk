import assert from "node:assert/strict";
import test from "node:test";
import { actorContextSchema, causalReceiptSchema, seedManifestSchema } from "@aura/contracts";

test("actor identity rejects an unknown role", () => {
  assert.equal(
    actorContextSchema.safeParse({
      subject: "attacker",
      role: "admin",
      personId: "00000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
});

test("causal receipts require all three correlation identifiers", () => {
  assert.equal(
    causalReceiptSchema.safeParse({
      commandId: "00000000-0000-4000-8000-000000000001",
      eventId: "00000000-0000-4000-8000-000000000002",
      institutionRevision: 1,
      occurredAt: new Date().toISOString(),
    }).success,
    false,
  );
});

test("seed manifest is deliberately exact rather than approximately shaped", () => {
  const result = seedManifestSchema.safeParse({
    seedVersion: "AURA-SYNTHETIC-SEED-V1",
    generationId: "00000000-0000-4000-8000-000000000001",
    institutionCode: "AURA-DEMO",
    termCode: "2026-ODD",
    counts: { departments: 2, students: 12, parents: 9, faculty: 4, hods: 2, courses: 6, offerings: 6 },
    demoSubjects: {
      student: "aura-demo-student",
      parent: "aura-demo-parent",
      faculty: "aura-demo-faculty",
      hod: "aura-demo-hod",
      governance: "aura-demo-governance",
    },
  });
  assert.equal(result.success, true);
});
