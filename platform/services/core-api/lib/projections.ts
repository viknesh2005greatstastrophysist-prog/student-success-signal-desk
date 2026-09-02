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
      if (actor.role === "student") return event.event_type === "offering.published" || event.payload.studentId === actor.studentId;
      return false;
    });

    const roleData: Record<string, unknown> = {};
    if (actor.role === "student" && actor.studentId) {
      const student = await client.query<{
        register_number: string;
        semester: number;
        department: string;
        department_id: string;
        completed_course_codes: string[];
        fee_status: string | null;
        amount_paise: string | null;
        due_on: string | null;
      }>(
        `SELECT sp.register_number, sp.semester, sp.department_id, sp.completed_course_codes, d.name AS department,
                fi.status AS fee_status, fi.amount_paise::text, fi.due_on
         FROM student_profiles sp JOIN departments d ON d.id = sp.department_id
         LEFT JOIN fee_invoices fi ON fi.generation_id = sp.generation_id AND fi.student_id = sp.id
         WHERE sp.generation_id = $1 AND sp.id = $2`,
        [generationId, actor.studentId],
      );
      roleData.student = student.rows[0] ?? null;
      const catalogue = await client.query<{
        id: string;
        code: string;
        title: string;
        credits: number;
        status: string;
        capacity: number;
        enrolment: number;
        faculty_name: string | null;
        registration_id: string | null;
        registration_status: string | null;
        window_status: string | null;
        opens_at: Date | null;
        closes_at: Date | null;
        prerequisites: string[] | null;
        schedule: Array<{ weekday: number; startsAt: string; endsAt: string; room: string }> | null;
        has_clash: boolean;
      }>(
        `SELECT o.id, c.code, c.title, c.credits, o.status, o.capacity,
                (SELECT count(*)::int FROM registrations enrolled WHERE enrolled.generation_id = o.generation_id AND enrolled.course_offering_id = o.id AND enrolled.status = 'registered') AS enrolment,
                fp.display_name AS faculty_name, own.id AS registration_id, own.status AS registration_status,
                rw.status AS window_status, rw.opens_at, rw.closes_at,
                (SELECT array_agg(prerequisite.code ORDER BY prerequisite.code)
                 FROM course_prerequisites cp JOIN courses prerequisite ON prerequisite.id = cp.prerequisite_course_id
                 WHERE cp.generation_id = o.generation_id AND cp.course_id = c.id) AS prerequisites,
                (SELECT jsonb_agg(jsonb_build_object('weekday', slot.weekday, 'startsAt', slot.starts_at::text, 'endsAt', slot.ends_at::text, 'room', slot.room) ORDER BY slot.weekday, slot.starts_at)
                 FROM timetable_slots slot WHERE slot.generation_id = o.generation_id AND slot.course_offering_id = o.id) AS schedule,
                EXISTS (
                  SELECT 1 FROM timetable_slots candidate
                  JOIN timetable_slots existing_slot ON existing_slot.generation_id = candidate.generation_id
                    AND existing_slot.weekday = candidate.weekday
                    AND existing_slot.starts_at < candidate.ends_at AND existing_slot.ends_at > candidate.starts_at
                  JOIN registrations existing_registration ON existing_registration.generation_id = candidate.generation_id
                    AND existing_registration.course_offering_id = existing_slot.course_offering_id
                    AND existing_registration.student_id = $2 AND existing_registration.status = 'registered'
                  WHERE candidate.generation_id = o.generation_id AND candidate.course_offering_id = o.id
                    AND existing_slot.course_offering_id <> o.id
                ) AS has_clash
         FROM course_offerings o
         JOIN courses c ON c.id = o.course_id
         LEFT JOIN faculty_assignments fa ON fa.generation_id = o.generation_id AND fa.course_offering_id = o.id AND fa.active
         LEFT JOIN people fp ON fp.id = fa.faculty_person_id
         LEFT JOIN registrations own ON own.generation_id = o.generation_id AND own.course_offering_id = o.id AND own.student_id = $2
         LEFT JOIN registration_windows rw ON rw.generation_id = o.generation_id AND rw.term_id = o.term_id AND rw.department_id = c.department_id
         WHERE o.generation_id = $1 AND c.department_id = $3
         ORDER BY c.code`,
        [generationId, actor.studentId, student.rows[0]!.department_id],
      );
      const completed = new Set(student.rows[0]!.completed_course_codes ?? []);
      roleData.registrationCatalogue = catalogue.rows.map((item) => {
        const missing = (item.prerequisites ?? []).filter((code) => !completed.has(code));
        const now = Date.now();
        const reasons: string[] = [];
        if (item.registration_status !== "registered") {
          if (item.registration_status === "completed") reasons.push("Course already completed");
          if (item.status !== "published") reasons.push("Offering has not been published");
          if (item.window_status !== "open" || !item.opens_at || !item.closes_at || item.opens_at.getTime() > now || item.closes_at.getTime() < now) reasons.push("Registration window is closed");
          if (missing.length) reasons.push(`Requires ${missing.join(", ")}`);
          if (item.enrolment >= item.capacity) reasons.push("Offering is full");
          if (item.has_clash) reasons.push("Timetable conflict");
        }
        return { ...item, prerequisites: item.prerequisites ?? [], schedule: item.schedule ?? [], eligible: reasons.length === 0, reasons };
      });
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
      if (offering.rows[0]?.faculty_person_id === actor.personId) {
        const roster = await client.query(
          `SELECT sp.id, sp.register_number, p.display_name, r.registered_at
           FROM registrations r
           JOIN student_profiles sp ON sp.id = r.student_id
           JOIN people p ON p.id = sp.person_id
           WHERE r.generation_id = $1 AND r.course_offering_id = $2 AND r.status = 'registered'
           ORDER BY sp.register_number`,
          [generationId, offering.rows[0].id],
        );
        roleData.roster = roster.rows;
      } else roleData.roster = [];
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
