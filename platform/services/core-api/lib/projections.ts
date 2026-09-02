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

    const parentGrantRows = actor.role === "parent" ? await client.query<{ student_id: string; field_group: string }>(
      `SELECT link.student_id, grant_row.field_group
       FROM parent_links link JOIN parent_field_grants grant_row ON grant_row.parent_link_id = link.id AND grant_row.generation_id = link.generation_id
       WHERE link.generation_id = $1 AND link.parent_person_id = $2 AND link.active AND grant_row.granted`,
      [generationId, actor.personId],
    ) : undefined;
    const parentGrants = new Map<string, Set<string>>();
    parentGrantRows?.rows.forEach((row) => {
      const fields = parentGrants.get(row.student_id) ?? new Set<string>();
      fields.add(row.field_group);
      parentGrants.set(row.student_id, fields);
    });

    const visibleEvents = events.rows.filter((event) => {
      if (actor.role === "governance") return true;
      if (actor.role === "hod") return event.payload.departmentId === actor.departmentId;
      if (actor.role === "faculty") return event.payload.facultyPersonId === actor.personId;
      if (actor.role === "student") {
        const studentIds = Array.isArray(event.payload.studentIds) ? event.payload.studentIds : [];
        return event.event_type === "offering.published" || event.payload.studentId === actor.studentId || studentIds.includes(actor.studentId);
      }
      if (actor.role === "parent") {
        if (event.payload.parentPersonId === actor.personId) return true;
        const studentId = typeof event.payload.studentId === "string" ? event.payload.studentId : undefined;
        if (!studentId) return false;
        const grants = parentGrants.get(studentId);
        if (event.event_type.startsWith("support.")) return grants?.has("support") ?? false;
        if (event.event_type.startsWith("attendance.")) return grants?.has("attendance") ?? false;
        if (event.event_type.startsWith("marks.")) return grants?.has("marks") ?? false;
        return false;
      }
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
        paid_paise: string | null;
        remaining_paise: string | null;
        due_on: string | null;
      }>(
        `SELECT sp.register_number, sp.semester, sp.department_id, sp.completed_course_codes, d.name AS department,
                fi.status AS fee_status, fi.amount_paise::text, fi.paid_paise::text,
                (fi.amount_paise - fi.paid_paise)::text AS remaining_paise, fi.due_on
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
      const attendance = await client.query(
        `SELECT course.code, course.title, session.session_date, session.topic, record.status, session.revision
         FROM attendance_records record
         JOIN attendance_sessions session ON session.id = record.attendance_session_id
         JOIN course_offerings offering ON offering.id = session.course_offering_id
         JOIN courses course ON course.id = offering.course_id
         WHERE record.generation_id = $1 AND record.student_id = $2 AND session.status IN ('submitted', 'locked')
         ORDER BY session.session_date DESC`,
        [generationId, actor.studentId],
      );
      const marks = await client.query(
        `SELECT course.code, course.title, assessment.title AS assessment, assessment.maximum_score::text,
                mark.score::text, mark.feedback, assessment.revision
         FROM marks mark
         JOIN assessments assessment ON assessment.id = mark.assessment_id
         JOIN course_offerings offering ON offering.id = assessment.course_offering_id
         JOIN courses course ON course.id = offering.course_id
         WHERE mark.generation_id = $1 AND mark.student_id = $2 AND assessment.published
         ORDER BY course.code, assessment.title`,
        [generationId, actor.studentId],
      );
      roleData.academics = { attendance: attendance.rows, marks: marks.rows };
      const parentAccess = await client.query(
        `SELECT grant_row.id, grant_row.field_group, grant_row.granted, grant_row.revision,
                parent.display_name AS parent_name, link.relationship, link.linked_at
         FROM parent_links link
         JOIN people parent ON parent.id = link.parent_person_id
         JOIN parent_field_grants grant_row ON grant_row.parent_link_id = link.id AND grant_row.generation_id = link.generation_id
         WHERE link.generation_id = $1 AND link.student_id = $2 AND link.active
         ORDER BY parent.display_name, grant_row.field_group`,
        [generationId, actor.studentId],
      );
      roleData.parentAccess = parentAccess.rows;
      const supportPlans = await client.query(
        `SELECT plan.id, support_case.id AS case_id, support_case.reason, support_case.risk_band,
                support_case.status, plan.plan, plan.created_at
         FROM support_plans plan JOIN support_cases support_case ON support_case.id = plan.support_case_id
         WHERE plan.generation_id = $1 AND plan.student_id = $2 AND plan.visible_to_student
         ORDER BY plan.created_at DESC`,
        [generationId, actor.studentId],
      );
      roleData.supportPlans = supportPlans.rows;
    }
    if (actor.role === "parent") {
      const children = await client.query<{ id: string; display_name: string; register_number: string; grants: string[] | null }>(
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
      const child = children.rows[0];
      if (child) {
        const grants = child.grants ?? [];
        const attendance = grants.includes("attendance") ? await client.query(
          `SELECT course.code, session.session_date, session.topic, record.status
           FROM attendance_records record
           JOIN attendance_sessions session ON session.id = record.attendance_session_id
           JOIN course_offerings offering ON offering.id = session.course_offering_id
           JOIN courses course ON course.id = offering.course_id
           WHERE record.generation_id = $1 AND record.student_id = $2 AND session.status IN ('submitted', 'locked')
           ORDER BY session.session_date DESC`,
          [generationId, child.id],
        ) : undefined;
        const marks = grants.includes("marks") ? await client.query(
          `SELECT course.code, assessment.title AS assessment, assessment.maximum_score::text, mark.score::text, mark.feedback
           FROM marks mark
           JOIN assessments assessment ON assessment.id = mark.assessment_id
           JOIN course_offerings offering ON offering.id = assessment.course_offering_id
           JOIN courses course ON course.id = offering.course_id
           WHERE mark.generation_id = $1 AND mark.student_id = $2 AND assessment.published
           ORDER BY course.code, assessment.title`,
          [generationId, child.id],
        ) : undefined;
        roleData.childAcademics = {
          studentId: child.id,
          grantedFields: grants,
          attendance: attendance?.rows,
          marks: marks?.rows,
        };
        if (grants.includes("fees")) {
          const invoices = await client.query(
            `SELECT invoice.id, invoice.invoice_number, invoice.description, invoice.amount_paise::text,
                    invoice.paid_paise::text, (invoice.amount_paise - invoice.paid_paise)::text AS remaining_paise,
                    invoice.due_on::text, invoice.status, invoice.revision,
                    COALESCE(jsonb_agg(jsonb_build_object(
                      'id', transaction.id,
                      'amountPaise', transaction.amount_paise,
                      'providerReference', transaction.provider_reference,
                      'status', transaction.status,
                      'createdAt', transaction.created_at,
                      'receiptId', CASE WHEN transaction.status = 'captured' THEN transaction.id ELSE NULL END
                    ) ORDER BY transaction.created_at DESC) FILTER (WHERE transaction.id IS NOT NULL), '[]'::jsonb) AS transactions
             FROM fee_invoices invoice
             LEFT JOIN payment_transactions transaction ON transaction.generation_id = invoice.generation_id AND transaction.invoice_id = invoice.id
             WHERE invoice.generation_id = $1 AND invoice.student_id = $2
             GROUP BY invoice.id
             ORDER BY invoice.due_on`,
            [generationId, child.id],
          );
          roleData.childFinance = { studentId: child.id, granted: true, invoices: invoices.rows };
        }
        if (grants.includes("support")) {
          const supportPlans = await client.query(
            `SELECT plan.id, support_case.id AS case_id, support_case.reason, support_case.risk_band,
                    support_case.status, plan.plan, plan.created_at
             FROM support_plans plan JOIN support_cases support_case ON support_case.id = plan.support_case_id
             WHERE plan.generation_id = $1 AND plan.student_id = $2 AND plan.visible_to_student
             ORDER BY plan.created_at DESC`,
            [generationId, child.id],
          );
          roleData.childSupportPlans = supportPlans.rows;
        }
      }
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
        const attendanceSession = await client.query(
          `SELECT id, session_date, topic, status, revision
           FROM attendance_sessions WHERE generation_id = $1 AND course_offering_id = $2
           ORDER BY session_date DESC LIMIT 1`,
          [generationId, offering.rows[0].id],
        );
        const assessment = await client.query(
          `SELECT id, title, category, maximum_score::text, weight_percent::text, published, revision
           FROM assessments WHERE generation_id = $1 AND course_offering_id = $2
           ORDER BY title LIMIT 1`,
          [generationId, offering.rows[0].id],
        );
        roleData.classroom = { attendanceSession: attendanceSession.rows[0] ?? null, assessment: assessment.rows[0] ?? null };
      } else roleData.roster = [];
      const supportCases = await client.query(
        `SELECT support_case.id, support_case.student_id, support_case.status, support_case.risk_band,
                support_case.reason, support_case.revision, student.register_number, person.display_name,
                artifact.id AS artifact_id, artifact.content_hash, artifact.recommendation, artifact.validation,
                artifact.created_at
         FROM support_cases support_case
         JOIN student_profiles student ON student.id = support_case.student_id
         JOIN people person ON person.id = student.person_id
         JOIN evidence_snapshots evidence ON evidence.support_case_id = support_case.id AND evidence.generation_id = support_case.generation_id
         JOIN agent_runs run ON run.evidence_snapshot_id = evidence.id AND run.generation_id = support_case.generation_id
         JOIN agent_artifacts artifact ON artifact.agent_run_id = run.id AND artifact.generation_id = support_case.generation_id
         WHERE support_case.generation_id = $1 AND evidence.evidence->>'assignedFacultyPersonId' = $2
         ORDER BY support_case.opened_at DESC, artifact.artifact_version DESC`,
        [generationId, actor.personId],
      );
      roleData.supportCases = supportCases.rows;
    }
    if (actor.role === "hod") {
      roleData.departmentPeople = people.rows.filter((person) => person.department_id === actor.departmentId);
      roleData.availableFaculty = people.rows.filter((person) => person.department_id === actor.departmentId && person.role === "faculty");
      const academicSummary = await client.query<{ submitted_attendance: number; published_assessments: number }>(
        `SELECT
          (SELECT count(*)::int FROM attendance_sessions attendance
           JOIN course_offerings offering ON offering.id = attendance.course_offering_id
           JOIN courses course ON course.id = offering.course_id
           WHERE attendance.generation_id = $1 AND course.department_id = $2 AND attendance.status IN ('submitted', 'locked')) AS submitted_attendance,
          (SELECT count(*)::int FROM assessments assessment
           JOIN course_offerings offering ON offering.id = assessment.course_offering_id
           JOIN courses course ON course.id = offering.course_id
           WHERE assessment.generation_id = $1 AND course.department_id = $2 AND assessment.published) AS published_assessments`,
        [generationId, actor.departmentId],
      );
      roleData.academicSummary = academicSummary.rows[0];
      const financeSummary = await client.query<{ due_invoices: number; outstanding_paise: string; captured_payments: number }>(
        `SELECT
          count(*) FILTER (WHERE invoice.status IN ('due', 'partial'))::int AS due_invoices,
          COALESCE(sum(invoice.amount_paise - invoice.paid_paise) FILTER (WHERE invoice.status IN ('due', 'partial')), 0)::text AS outstanding_paise,
          (SELECT count(*)::int FROM payment_transactions transaction
           JOIN fee_invoices paid_invoice ON paid_invoice.id = transaction.invoice_id
           JOIN student_profiles paid_student ON paid_student.id = paid_invoice.student_id
           WHERE transaction.generation_id = $1 AND paid_student.department_id = $2 AND transaction.status = 'captured') AS captured_payments
         FROM fee_invoices invoice JOIN student_profiles student ON student.id = invoice.student_id
         WHERE invoice.generation_id = $1 AND student.department_id = $2`,
        [generationId, actor.departmentId],
      );
      roleData.financeSummary = financeSummary.rows[0];
      const departmentSupport = await client.query(
        `SELECT support_case.id, support_case.status, support_case.risk_band, support_case.reason,
                student.register_number, person.display_name, support_case.opened_at
         FROM support_cases support_case JOIN student_profiles student ON student.id = support_case.student_id
         JOIN people person ON person.id = student.person_id
         WHERE support_case.generation_id = $1 AND student.department_id = $2
         ORDER BY support_case.opened_at DESC`,
        [generationId, actor.departmentId],
      );
      roleData.supportCases = departmentSupport.rows;
      roleData.supportSummary = departmentSupport.rows.reduce<Record<string, number>>((summary, item) => {
        summary[item.status] = (summary[item.status] ?? 0) + 1;
        return summary;
      }, {});
    }
    if (actor.role === "governance") {
      const processableEvents = await client.query(
        `SELECT event.id, event.event_type, event.institution_revision::text, event.occurred_at,
                event.payload, outbox.attempts
         FROM domain_events event JOIN outbox_items outbox ON outbox.domain_event_id = event.id AND outbox.generation_id = event.generation_id
         WHERE event.generation_id = $1 AND event.event_type IN ('attendance.submitted', 'marks.published') AND outbox.delivered_at IS NULL
         ORDER BY event.institution_revision DESC`,
        [generationId],
      );
      const governanceRuns = await client.query(
        `SELECT run.id, run.mode, run.status, run.started_at, run.completed_at,
                support_case.id AS support_case_id, support_case.status AS case_status,
                support_case.risk_band, person.display_name AS student_name,
                evidence.input_hash, artifact.id AS artifact_id, artifact.content_hash,
                artifact.recommendation, artifact.validation,
                (SELECT count(*)::int FROM replay_receipts replay WHERE replay.generation_id = run.generation_id AND replay.original_agent_run_id = run.id) AS replay_count
         FROM agent_runs run JOIN support_cases support_case ON support_case.id = run.support_case_id
         JOIN student_profiles student ON student.id = support_case.student_id
         JOIN people person ON person.id = student.person_id
         JOIN evidence_snapshots evidence ON evidence.id = run.evidence_snapshot_id
         JOIN agent_artifacts artifact ON artifact.agent_run_id = run.id
         WHERE run.generation_id = $1
         ORDER BY run.started_at DESC, artifact.artifact_version DESC`,
        [generationId],
      );
      roleData.processableEvents = processableEvents.rows;
      roleData.governanceRuns = governanceRuns.rows;
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
