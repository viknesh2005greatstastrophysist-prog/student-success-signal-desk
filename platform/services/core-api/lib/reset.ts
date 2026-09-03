import { randomUUID } from "node:crypto";
import { seedManifestSchema, type SeedManifest } from "@aura/contracts";
import type { PoolClient } from "pg";
import { loadCoreConfig } from "./config";
import { withCoreTransaction } from "./db";

type SeedPerson = {
  id: string;
  subject: string;
  name: string;
  email: string;
  role: "student" | "parent" | "faculty" | "hod" | "governance";
  departmentId?: string;
};

const seedVersion = "AURA-SYNTHETIC-SEED-V1" as const;

type SqlValue = string | number | boolean | null;

async function insertRows(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly SqlValue[])[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.flat();
  const tuples = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    return `(${row.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });
  await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
}

export async function resetSyntheticSeed(confirmation: string, requestedBy = "local-operator"): Promise<SeedManifest> {
  const expected = loadCoreConfig().resetConfirmation;
  if (confirmation !== expected || confirmation !== seedVersion) {
    throw new Error(`Reset refused: confirmation must equal ${seedVersion}`);
  }

  return withCoreTransaction(async (client) => {
    const identityEmails = ["student1@aura.invalid", "parent1@aura.invalid", "faculty1@aura.invalid", "hod.cse@aura.invalid", "governance@aura.invalid"];
    const priorSubjects = await client.query<{ email: string; external_subject: string }>(
      `SELECT p.email, p.external_subject FROM people p
       JOIN institution_revisions ir ON ir.current_generation_id = p.generation_id AND ir.singleton = true
       WHERE p.email = ANY($1::text[])`,
      [identityEmails],
    );
    const subjectByEmail = new Map(priorSubjects.rows.map((row) => [row.email, row.external_subject]));
    const generationId = randomUUID();
    const resetId = randomUUID();
    await client.query(
      "INSERT INTO simulation_resets (id, generation_id, seed_version, confirmation, requested_by) VALUES ($1, $2, $3, $4, $5)",
      [resetId, generationId, seedVersion, confirmation, requestedBy],
    );

    const institutionId = randomUUID();
    await client.query(
      "INSERT INTO institutions (id, generation_id, code, name) VALUES ($1, $2, 'AURA-DEMO', 'AURA Institute of Technology')",
      [institutionId, generationId],
    );

    const cseId = randomUUID();
    const eceId = randomUUID();
    await client.query(
      "INSERT INTO departments (id, generation_id, institution_id, code, name) VALUES ($1, $3, $2, 'CSE', 'Computer Science and Engineering'), ($4, $3, $2, 'ECE', 'Electronics and Communication Engineering')",
      [cseId, institutionId, generationId, eceId],
    );

    const termId = randomUUID();
    await client.query(
      "INSERT INTO terms (id, generation_id, institution_id, code, name, starts_on, ends_on) VALUES ($1, $2, $3, '2026-ODD', 'Odd Semester 2026', '2026-07-13', '2026-12-18')",
      [termId, generationId, institutionId],
    );

    const studentNames = [
      "Ananya Rao",
      "Dev Patel",
      "Ishaan Shah",
      "Kavya Nair",
      "Meera Iyer",
      "Nikhil Kumar",
      "Priya Das",
      "Rahul Menon",
      "Sara Ali",
      "Tarun Bose",
      "Varsha Reddy",
      "Yuvan Joseph",
    ];
    const students: SeedPerson[] = studentNames.map((name, index) => ({
      id: randomUUID(),
      subject: index === 0 ? subjectByEmail.get("student1@aura.invalid") ?? "aura-demo-student" : `aura-student-${String(index + 1).padStart(2, "0")}`,
      name,
      email: `student${index + 1}@aura.invalid`,
      role: "student",
      departmentId: index < 10 ? cseId : eceId,
    }));

    const parents: SeedPerson[] = Array.from({ length: 9 }, (_, index) => ({
      id: randomUUID(),
      subject: index === 0 ? subjectByEmail.get("parent1@aura.invalid") ?? "aura-demo-parent" : `aura-parent-${String(index + 1).padStart(2, "0")}`,
      name: ["Lakshmi Rao", "Harish Patel", "Neha Shah", "Gopal Nair", "Suma Iyer", "Mohan Kumar", "Deepa Das", "Arun Menon", "Farah Ali"][index]!,
      email: `parent${index + 1}@aura.invalid`,
      role: "parent",
    }));

    const faculty: SeedPerson[] = [
      [subjectByEmail.get("faculty1@aura.invalid") ?? "aura-demo-faculty", "Dr Mira Sen", cseId],
      ["aura-faculty-02", "Prof Arjun Bhat", cseId],
      ["aura-faculty-03", "Dr Leena Thomas", cseId],
      ["aura-faculty-04", "Prof Kiran Rao", eceId],
    ].map(([subject, name, departmentId], index) => ({
      id: randomUUID(),
      subject: subject!,
      name: name!,
      email: `faculty${index + 1}@aura.invalid`,
      role: "faculty" as const,
      departmentId,
    }));

    const hods: SeedPerson[] = [
      { id: randomUUID(), subject: subjectByEmail.get("hod.cse@aura.invalid") ?? "aura-demo-hod", name: "Dr Sahana Krishnan", email: "hod.cse@aura.invalid", role: "hod", departmentId: cseId },
      { id: randomUUID(), subject: "aura-hod-ece", name: "Dr Ramesh Iqbal", email: "hod.ece@aura.invalid", role: "hod", departmentId: eceId },
    ];
    const governance: SeedPerson = {
      id: randomUUID(),
      subject: subjectByEmail.get("governance@aura.invalid") ?? "aura-demo-governance",
      name: "AURA Governance Operator",
      email: "governance@aura.invalid",
      role: "governance",
    };

    const people = [...students, ...parents, ...faculty, ...hods, governance];
    await insertRows(
      client,
      "people",
      ["id", "generation_id", "external_subject", "display_name", "email"],
      people.map((person) => [person.id, generationId, person.subject, person.name, person.email]),
    );
    await insertRows(
      client,
      "role_assignments",
      ["id", "generation_id", "person_id", "role", "department_id"],
      people.map((person) => [randomUUID(), generationId, person.id, person.role, person.departmentId ?? null]),
    );

    const studentProfileIds = students.map(() => randomUUID());
    await insertRows(
      client,
      "student_profiles",
      ["id", "generation_id", "person_id", "department_id", "register_number", "cohort_year", "semester", "completed_course_codes"],
      students.map((student, index) => [
        studentProfileIds[index]!,
        generationId,
        student.id,
        student.departmentId ?? null,
        `SYN-${index < 10 ? "CSE" : "ECE"}-${String(index + 1).padStart(3, "0")}`,
        2023,
        7,
        JSON.stringify(index === 0 ? ["CS301"] : []),
      ]),
    );

    const parentLinkIds = studentProfileIds.map(() => randomUUID());
    await insertRows(
      client,
      "parent_links",
      ["id", "generation_id", "parent_person_id", "student_id", "relationship"],
      studentProfileIds.map((studentId, index) => [parentLinkIds[index]!, generationId, parents[index % parents.length]!.id, studentId, "Guardian"]),
    );
    await insertRows(
      client,
      "parent_field_grants",
      ["id", "generation_id", "parent_link_id", "field_group"],
      parentLinkIds.flatMap((linkId) => ["attendance", "marks", "fees", "support"].map((fieldGroup) => [randomUUID(), generationId, linkId, fieldGroup])),
    );

    const courseSpecs = [
      ["CS301", "Machine Learning Foundations", cseId, 4],
      ["CS401", "Agentic AI Systems", cseId, 4],
      ["CS402", "Responsible AI Engineering", cseId, 3],
      ["CS403", "Distributed Systems", cseId, 4],
      ["EC301", "Digital Signal Processing", eceId, 4],
      ["EC401", "Embedded Intelligence", eceId, 4],
    ] as const;
    const courseIds = new Map(courseSpecs.map(([code]) => [code, randomUUID()]));
    await insertRows(
      client,
      "courses",
      ["id", "generation_id", "department_id", "code", "title", "credits", "description"],
      courseSpecs.map(([code, title, departmentId, credits]) => [
        courseIds.get(code)!,
        generationId,
        departmentId,
        code,
        title,
        credits,
        `${title} in the synthetic AURA curriculum.`,
      ]),
    );
    await client.query(
      "INSERT INTO course_prerequisites (id, generation_id, course_id, prerequisite_course_id) VALUES ($1, $2, $3, $4)",
      [randomUUID(), generationId, courseIds.get("CS401"), courseIds.get("CS301")],
    );

    const offeringIds = new Map(courseSpecs.map(([code]) => [code, randomUUID()]));
    await insertRows(
      client,
      "course_offerings",
      ["id", "generation_id", "course_id", "term_id", "section", "capacity", "status", "published_at"],
      courseSpecs.map(([code]) => {
        const draft = code === "CS401";
        return [offeringIds.get(code)!, generationId, courseIds.get(code)!, termId, "A", 30, draft ? "draft" : "published", draft ? null : "2026-08-10T09:00:00Z"];
      }),
    );

    await client.query(
      "INSERT INTO registration_windows (id, generation_id, term_id, department_id, opens_at, closes_at, status) VALUES ($1, $2, $3, $4, '2026-08-01T00:00:00Z', '2026-09-30T23:59:59Z', 'open'), ($5, $2, $3, $6, '2026-08-01T00:00:00Z', '2026-09-30T23:59:59Z', 'open')",
      [randomUUID(), generationId, termId, cseId, randomUUID(), eceId],
    );

    const timetable = [
      ["CS301", 2, "09:00", "10:00", "CSE-201"],
      ["CS401", 1, "09:00", "10:00", "CSE-401"],
      ["CS402", 1, "09:00", "10:00", "CSE-305"],
      ["CS403", 3, "11:00", "12:00", "CSE-302"],
      ["EC301", 2, "10:00", "11:00", "ECE-210"],
      ["EC401", 4, "13:00", "14:00", "ECE-410"],
    ] as const;
    await insertRows(
      client,
      "timetable_slots",
      ["id", "generation_id", "course_offering_id", "weekday", "starts_at", "ends_at", "room"],
      timetable.map(([code, weekday, startsAt, endsAt, room]) => [randomUUID(), generationId, offeringIds.get(code)!, weekday, startsAt, endsAt, room]),
    );

    const facultyOfferingAssignments = [
      [0, "CS301"],
      [1, "CS402"],
      [2, "CS403"],
      [3, "EC301"],
      [3, "EC401"],
    ] as const;
    await insertRows(
      client,
      "faculty_assignments",
      ["id", "generation_id", "faculty_person_id", "course_offering_id", "assigned_by_person_id"],
      facultyOfferingAssignments.map(([facultyIndex, code]) => [
        randomUUID(),
        generationId,
        faculty[facultyIndex]!.id,
        offeringIds.get(code)!,
        hods[facultyIndex === 3 ? 1 : 0]!.id,
      ]),
    );

    await client.query(
      "INSERT INTO registrations (id, generation_id, student_id, course_offering_id, status, grade) VALUES ($1, $2, $3, $4, 'completed', 'A'), ($5, $2, $6, $7, 'registered', NULL), ($8, $2, $9, $10, 'registered', NULL)",
      [
        randomUUID(),
        generationId,
        studentProfileIds[0],
        offeringIds.get("CS301"),
        randomUUID(),
        studentProfileIds[1],
        offeringIds.get("CS403"),
        randomUUID(),
        studentProfileIds[9],
        offeringIds.get("CS402"),
      ],
    );

    const sessionId = randomUUID();
    await client.query(
      "INSERT INTO attendance_sessions (id, generation_id, course_offering_id, session_date, topic, status) VALUES ($1, $2, $3, '2026-08-24', 'Model evaluation', 'locked')",
      [sessionId, generationId, offeringIds.get("CS301")],
    );
    await client.query(
      "INSERT INTO attendance_records (id, generation_id, attendance_session_id, student_id, status, recorded_by_person_id) VALUES ($1, $2, $3, $4, 'present', $5)",
      [randomUUID(), generationId, sessionId, studentProfileIds[0], faculty[0]!.id],
    );
    await client.query(
      "INSERT INTO attendance_sessions (id, generation_id, course_offering_id, session_date, topic, status) VALUES ($1, $2, $3, '2026-09-03', 'Agent workflow design', 'open')",
      [randomUUID(), generationId, offeringIds.get("CS401")],
    );

    const assessmentId = randomUUID();
    await client.query(
      "INSERT INTO assessments (id, generation_id, course_offering_id, title, category, maximum_score, weight_percent, published) VALUES ($1, $2, $3, 'Foundation review', 'internal', 100, 20, true)",
      [assessmentId, generationId, offeringIds.get("CS301")],
    );
    await client.query(
      "INSERT INTO marks (id, generation_id, assessment_id, student_id, score, feedback, recorded_by_person_id) VALUES ($1, $2, $3, $4, 82, 'Strong foundations. Show more working in the next review.', $5)",
      [randomUUID(), generationId, assessmentId, studentProfileIds[0], faculty[0]!.id],
    );
    await client.query(
      "INSERT INTO assessments (id, generation_id, course_offering_id, title, category, maximum_score, weight_percent, published) VALUES ($1, $2, $3, 'Agent design review', 'internal', 100, 25, false)",
      [randomUUID(), generationId, offeringIds.get("CS401")],
    );

    await client.query(
      "INSERT INTO fee_invoices (id, generation_id, student_id, term_id, invoice_number, description, amount_paise, due_on, status) VALUES ($1, $2, $3, $4, 'INV-AURA-2026-001', 'Odd semester tuition and laboratory fee', 4500000, '2026-09-15', 'due')",
      [randomUUID(), generationId, studentProfileIds[0], termId],
    );

    const manifest = seedManifestSchema.parse({
      seedVersion,
      generationId,
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

    await client.query(
      "INSERT INTO institution_revisions (singleton, current_generation_id, revision) VALUES (true, $1, 0) ON CONFLICT (singleton) DO UPDATE SET current_generation_id = EXCLUDED.current_generation_id, revision = 0, updated_at = now()",
      [generationId],
    );
    await client.query("UPDATE simulation_resets SET completed_at = now(), manifest = $2::jsonb WHERE id = $1", [
      resetId,
      JSON.stringify(manifest),
    ]);

    return manifest;
  }, "exclusive");
}

export async function readCurrentSeedStats(): Promise<Record<string, number | string>> {
  return withCoreTransaction(async (client) => {
    const current = await client.query<{ current_generation_id: string }>(
      "SELECT current_generation_id FROM institution_revisions WHERE singleton = true",
    );
    const generationId = current.rows[0]?.current_generation_id;
    if (!generationId) throw new Error("No current synthetic generation exists");

    const tables = ["departments", "student_profiles", "courses", "course_offerings"] as const;
    const stats: Record<string, number | string> = { generationId };
    for (const table of tables) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE generation_id = $1`, [
        generationId,
      ]);
      stats[table] = Number(result.rows[0]?.count ?? 0);
    }
    const roleCounts = await client.query<{ role: string; count: string }>(
      "SELECT role, count(*)::text AS count FROM role_assignments WHERE generation_id = $1 GROUP BY role",
      [generationId],
    );
    for (const row of roleCounts.rows) stats[`role:${row.role}`] = Number(row.count);
    return stats;
  });
}
