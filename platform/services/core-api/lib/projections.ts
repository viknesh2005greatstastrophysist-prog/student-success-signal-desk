import type { AuthenticatedActor } from "./authentication";
import { withCoreTransaction } from "./db";

export async function loadPortalSnapshot(actor: AuthenticatedActor) {
  return withCoreTransaction(async (client) => {
    const current = await client.query<{ generation_id: string; revision: string }>(
      "SELECT current_generation_id AS generation_id, revision::text FROM institution_revisions WHERE singleton = true",
    );
    const { generation_id: generationId, revision } = current.rows[0]!;
    const offering = await client.query<{
      id: string;
      code: string;
      title: string;
      status: string;
      revision: number;
      capacity: number;
      department_id: string;
      department_code: string;
      faculty_person_id: string | null;
      faculty_name: string | null;
      enrolment: number;
    }>(
      `SELECT o.id, c.code, c.title, o.status, o.revision, o.capacity, d.id AS department_id,
              d.code AS department_code, fa.faculty_person_id, fp.display_name AS faculty_name,
              count(r.id)::int AS enrolment
       FROM course_offerings o
       JOIN courses c ON c.id = o.course_id
       JOIN departments d ON d.id = c.department_id
       LEFT JOIN faculty_assignments fa ON fa.generation_id = o.generation_id AND fa.course_offering_id = o.id AND fa.active
       LEFT JOIN people fp ON fp.id = fa.faculty_person_id
       LEFT JOIN registrations r ON r.generation_id = o.generation_id AND r.course_offering_id = o.id AND r.status IN ('registered', 'completed')
       WHERE o.generation_id = $1 AND c.code = 'CS401'
       GROUP BY o.id, c.code, c.title, d.id, d.code, fa.faculty_person_id, fp.display_name`,
      [generationId],
    );

    const people = await client.query<{ id: string; display_name: string; role: string; department_id: string | null }>(
      `SELECT p.id, p.display_name, r.role, r.department_id
       FROM people p JOIN role_assignments r ON r.person_id = p.id AND r.generation_id = p.generation_id AND r.active
       WHERE p.generation_id = $1
       ORDER BY p.display_name`,
      [generationId],
    );

    const events = await client.query<{
      id: string;
      event_type: string;
      aggregate_id: string;
      institution_revision: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT id, event_type, aggregate_id, institution_revision::text, payload, occurred_at
       FROM domain_events WHERE generation_id = $1 ORDER BY institution_revision DESC, occurred_at DESC LIMIT 30`,
      [generationId],
    );

    const visibleEvents = events.rows.filter((event) => {
      if (actor.role === "governance") return true;
      if (actor.role === "hod") return event.payload.departmentId === actor.departmentId;
      if (actor.role === "faculty") return event.payload.facultyPersonId === actor.personId;
      if (actor.role === "student") return event.event_type === "offering.published";
      return false;
    });

    const roleData: Record<string, unknown> = {};
    if (actor.role === "student" && actor.studentId) {
      const student = await client.query(
        `SELECT sp.register_number, sp.semester, d.name AS department,
                fi.status AS fee_status, fi.amount_paise::text, fi.due_on
         FROM student_profiles sp JOIN departments d ON d.id = sp.department_id
         LEFT JOIN fee_invoices fi ON fi.generation_id = sp.generation_id AND fi.student_id = sp.id
         WHERE sp.generation_id = $1 AND sp.id = $2`,
        [generationId, actor.studentId],
      );
      roleData.student = student.rows[0] ?? null;
    }
    if (actor.role === "parent") {
      const children = await client.query(
        `SELECT sp.id, p.display_name, sp.register_number, array_agg(pfg.field_group ORDER BY pfg.field_group) FILTER (WHERE pfg.granted) AS grants
         FROM parent_links pl
         JOIN student_profiles sp ON sp.id = pl.student_id
         JOIN people p ON p.id = sp.person_id
         LEFT JOIN parent_field_grants pfg ON pfg.parent_link_id = pl.id AND pfg.generation_id = pl.generation_id
         WHERE pl.generation_id = $1 AND pl.parent_person_id = $2 AND pl.active
         GROUP BY sp.id, p.display_name, sp.register_number
         ORDER BY sp.register_number`,
        [generationId, actor.personId],
      );
      roleData.children = children.rows;
    }
    if (actor.role === "faculty") {
      roleData.assignableOffering = offering.rows[0]?.faculty_person_id === actor.personId ? offering.rows[0] : null;
    }
    if (actor.role === "hod") {
      roleData.departmentPeople = people.rows.filter((person) => person.department_id === actor.departmentId);
      roleData.availableFaculty = people.rows.filter((person) => person.department_id === actor.departmentId && person.role === "faculty");
    }

    return {
      actor: { role: actor.role, displayName: actor.displayName, email: actor.email },
      institutionRevision: Number(revision),
      offering: offering.rows[0] ?? null,
      activity: visibleEvents.map((event) => ({
        id: event.id,
        type: event.event_type,
        resourceId: event.aggregate_id,
        revision: Number(event.institution_revision),
        payload: event.payload,
        occurredAt: event.occurred_at.toISOString(),
      })),
      ...roleData,
    };
  });
}
