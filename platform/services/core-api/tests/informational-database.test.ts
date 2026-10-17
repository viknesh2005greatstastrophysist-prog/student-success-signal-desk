/**
 * Informational records against a real database (spec conformance P2-5). Opt-in: needs a
 * disposable schema (aura_core_test_informational*) on a reachable PostgreSQL; never point
 * it at a project or deployed schema. CI runs it on a fresh Postgres.
 *
 * Migration 013 applies; the backfill fills the current data generation in one transaction,
 * writes nothing for a frozen student, touches no existing row, no data generation, no
 * institution revision and no evidence time, and writes nothing the second time; the
 * collectors carry the records as informational evidence that leaves the risk analysis
 * unchanged; the student record and the Learning course follow the grants; the egress guard
 * roster blocks the scoped students' internship organisations.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import type { Source } from "../lib/chapter11/engine";

test(
  "database: informational records are backfilled once, shown within the grants and never scored",
  { skip: process.env.RUN_INFORMATIONAL_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_informational/);
    process.env.CORE_FROZEN_REGISTER_NUMBERS = "SYN-CSE-010";
    process.env.CORE_FROZEN_CASE_IDS = "";
    const { migrateCoreDatabase } = await import("../lib/migrations");
    const { resetSyntheticSeed } = await import("../lib/reset");
    const { closePool, withCoreSnapshot, withCoreTransaction } = await import("../lib/db");
    const { getCurrentGeneration } = await import("../lib/command-ledger");
    const { loadGuardRoster, readSource, seedChapterSources } = await import("../lib/chapter11/service");
    const { demoPolicy, riskAnalysis, sourceNames } = await import("../lib/chapter11/engine");
    const { experienceStudent } = await import("../lib/experience-queries");
    const { lmsCourseDetail } = await import("../lib/lms-queries");
    const { planInformational } = await import("../lib/data-refresh/generator");
    const { applyInformationalBackfill, backfillReport, informationalTablesReady, loadInformationalBackfill } = await import("../lib/data-refresh/informational-apply");
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "informational-isolated-test");
      const world = await withCoreTransaction(async (c) => {
        assert.equal(await informationalTablesReady(c), true, "migration 013 applied");
        const generation = await getCurrentGeneration(c);
        const people = (await c.query<{ id: string; email: string; department_id: string }>(
          "SELECT p.id,p.email,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
          [generation],
        )).rows;
        const person = (email: string) => people.find((p) => p.email === email)!;
        const make = (email: string, role: ActorContext["role"], extra: Record<string, unknown> = {}) =>
          ({ subject: email, role, displayName: email, email, clientId: portalOidcClients[role], personId: person(email).id, departmentId: person(email).department_id, ...extra }) as ActorContext;
        const profile = async (register: string) =>
          (await c.query<{ id: string }>("SELECT id FROM student_profiles WHERE generation_id=$1 AND register_number=$2", [generation, register])).rows[0]!.id;
        const student = await profile("SYN-CSE-002");
        const frozen = await profile("SYN-CSE-010");
        const offering = (await c.query<{ id: string }>(
          "SELECT r.course_offering_id AS id FROM registrations r WHERE r.generation_id=$1 AND r.student_id=$2 AND r.status='registered' LIMIT 1",
          [generation, student],
        )).rows[0]!.id;
        // A data generation for the backfill to fill (test-only row in the disposable schema).
        await c.query(
          "INSERT INTO data_generations(id,generation_id,label,seed,as_of,supersedes_label,summary,created_at) VALUES(gen_random_uuid(),$1,'test-informational','test-informational-seed',now()-interval '1 day',NULL,'{}'::jsonb,now()-interval '1 day')",
          [generation],
        );
        return {
          generation, student, frozen, offering,
          hod: make("hod.cse@aura.invalid", "hod"),
          governance: make("governance@aura.invalid", "governance"),
          studentActor: make("student2@aura.invalid", "student", { studentId: student }),
          facultyId: person("faculty1@aura.invalid").id,
          departmentId: person("hod.cse@aura.invalid").department_id,
        };
      });
      await seedChapterSources(world.governance);

      const invariants = () =>
        withCoreSnapshot(async (c) => (await c.query<Record<string, string>>(
          `SELECT (SELECT count(*) FROM data_generations)::text AS generations,
             (SELECT string_agg(id::text||label||as_of::text||created_at::text,',' ORDER BY id) FROM data_generations) AS generation_rows,
             (SELECT revision::text FROM institution_revisions WHERE singleton) AS revision,
             (SELECT current_generation_id::text FROM institution_revisions WHERE singleton) AS current_generation,
             (SELECT count(*) FROM record_changes)::text AS changes,
             (SELECT md5(string_agg(id::text||record::text,',' ORDER BY id)) FROM ch11_sources) AS sources,
             (SELECT count(*)::text||coalesce(max(captured_at)::text,'') FROM evidence_snapshots) AS evidence`,
        )).rows[0]!);
      const before = await invariants();
      const count = (table: string, student?: string) =>
        withCoreSnapshot(async (c) => Number((await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE generation_id=$1${student ? " AND student_id=$2" : ""}`,
          student ? [world.generation, student] : [world.generation],
        )).rows[0]!.n));
      const events = () => withCoreSnapshot(async (c) => Number((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM ch11_events WHERE event_type='data.informational.backfilled'")).rows[0]!.n));

      // Dry run: counts only, nothing written.
      const dry = await withCoreSnapshot(async (c) => {
        const load = await loadInformationalBackfill(c, { excludeStudentIds: [] });
        return backfillReport(load, planInformational(load.input));
      });
      assert.equal(dry.dataGeneration, "test-informational");
      assert.equal(dry.excludedStudents, 1, "the frozen student is left out");
      assert.ok(dry.toWrite.quizScores > 0 && dry.toWrite.internshipRecords > 0 && dry.toWrite.placementRecords > 0, JSON.stringify(dry.toWrite));
      assert.equal(await count("lms_quiz_scores") + await count("internship_records") + await count("placement_records"), 0);

      const applied = await withCoreTransaction(async (c) => applyInformationalBackfill(c, await loadInformationalBackfill(c, { excludeStudentIds: [] })), "exclusive");
      assert.deepEqual(
        [applied.written!.quizScoresAdded, applied.written!.internshipRecordsAdded, applied.written!.placementRecordsAdded],
        [dry.toWrite.quizScores, dry.toWrite.internshipRecords, dry.toWrite.placementRecords],
        "the dry run counted exactly what was written",
      );
      assert.equal(await count("lms_quiz_scores"), dry.toWrite.quizScores);
      assert.equal(await events(), 1, "one audit row");
      for (const table of ["lms_quiz_scores", "internship_records", "placement_records"]) assert.equal(await count(table, world.frozen), 0, `nothing for the frozen student in ${table}`);

      // Safe to run twice: the second run writes nothing.
      const again = await withCoreTransaction(async (c) => applyInformationalBackfill(c, await loadInformationalBackfill(c, { excludeStudentIds: [] })), "exclusive");
      assert.deepEqual(Object.values(again.written!), [0, 0, 0, 0, 0, 0]);
      assert.equal(await events(), 1);
      assert.deepEqual(await invariants(), before, "no generation row, institution revision, existing row or evidence time changed");

      // Collectors: the records ride along as informational evidence; the risk is unchanged.
      const evidence: Record<string, Source> = Object.fromEntries(
        await Promise.all(sourceNames.map(async (name) => [name, await readSource(world.hod, world.student, name)] as const)),
      );
      const quizzes = await count("lms_quiz_scores", world.student);
      assert.ok(quizzes > 0);
      assert.equal(evidence.lms.informational?.scored, false);
      assert.equal(evidence.lms.informational?.items.length, quizzes);
      assert.equal(evidence.internship.informational?.origin, "Internship cell register");
      assert.ok(evidence.placement.informational?.recordedOn);
      const stripped = Object.fromEntries(Object.entries(evidence).map(([name, source]) => {
        const copy: Source = { ...source };
        delete copy.informational;
        return [name, copy];
      }));
      assert.deepEqual(riskAnalysis(evidence as never, demoPolicy), riskAnalysis(stripped as never, demoPolicy));

      // The student sees their own records and their own quiz scores in Learning; staff get none there.
      const own = await experienceStudent(world.studentActor, world.student);
      assert.equal(own.informational?.quizzes?.length, quizzes);
      assert.equal(own.informational?.career_shared, true);
      assert.ok(own.informational?.internship && own.informational?.placement);
      const course = await lmsCourseDetail(world.studentActor, world.offering);
      assert.equal(course.quizzes?.length, await withCoreSnapshot(async (c) => Number((await c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM lms_quiz_scores WHERE student_id=$1 AND course_offering_id=$2", [world.student, world.offering])).rows[0]!.n)));
      assert.deepEqual((await lmsCourseDetail(world.hod, world.offering)).quizzes, []);
      const staff = await experienceStudent(world.hod, world.student);
      assert.equal(staff.informational?.quizzes?.length, quizzes);

      // A parent sees quiz scores with the marks grant and career records with the support grant.
      const parent = await withCoreSnapshot(async (c) => (await c.query<{ person_id: string; email: string; grants: string[] }>(
        `SELECT l.parent_person_id AS person_id,p.email,COALESCE(array_agg(g.field_group) FILTER (WHERE g.granted),'{}') AS grants
         FROM parent_links l JOIN people p ON p.id=l.parent_person_id LEFT JOIN parent_field_grants g ON g.parent_link_id=l.id
         WHERE l.generation_id=$1 AND l.student_id=$2 AND l.active GROUP BY 1,2 LIMIT 1`,
        [world.generation, world.student],
      )).rows[0]);
      if (parent) {
        const view = await experienceStudent({ subject: parent.email, role: "parent", displayName: parent.email, email: parent.email, clientId: portalOidcClients.parent, personId: parent.person_id } as ActorContext, world.student);
        assert.equal(view.informational?.quizzes === null, !parent.grants.includes("marks"));
        assert.equal(view.informational?.career_shared, parent.grants.includes("support"));
        if (!parent.grants.includes("support")) assert.equal(view.informational?.internship, null);
      }

      // The egress guard roster blocks the scoped student's organisation.
      const organisation = own.informational?.internship?.organisation;
      if (organisation) {
        const roster = await withCoreSnapshot((c) => loadGuardRoster(c, world.generation, [world.student], world.facultyId, world.departmentId));
        assert.ok(roster.phrases?.includes(organisation));
      }
    } finally {
      await closePool();
    }
  },
);
