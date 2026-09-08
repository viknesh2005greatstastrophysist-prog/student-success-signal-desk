import type {
  ActorContext,
  ExperienceOverview,
  ExperienceCourse,
  PersonSummary,
  StudentDetail,
  Classroom,
  CourseProgress,
  GradingScale,
} from "@aura/contracts";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withCoreTransaction } from "./db";
import { getCurrentGeneration } from "./command-ledger";
import { AuthorizationError, requireRole } from "./security";
import { NotFoundError } from "./http";
import { lmsEvidence, requireLmsCourse } from "./lms-queries";

export async function requireExperienceStudent(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
  id: string,
) {
  z.string().uuid().parse(id);
  const student = (
    await client.query<PersonSummary & { department_id: string }>(
      `SELECT s.id,s.person_id,p.revision,s.department_id,p.display_name AS name,p.email,s.register_number,s.semester,m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name,COALESCE(m.revision,0) AS mentor_revision FROM student_profiles s JOIN people p ON p.id=s.person_id LEFT JOIN mentor_assignments m ON m.generation_id=s.generation_id AND m.student_id=s.id LEFT JOIN people mp ON mp.id=m.faculty_person_id WHERE s.generation_id=$1 AND s.id=$2`,
      [generation, id],
    )
  ).rows[0];
  if (!student) throw new NotFoundError("Student not found");
  if (actor.role === "student" && actor.studentId === id)
    return { student, grants: ["attendance", "marks", "fees", "support"] };
  if (actor.role === "hod" && actor.departmentId === student.department_id)
    return {
      student,
      grants: ["attendance", "marks", "fees", "support", "private"],
    };
  if (actor.role === "faculty" && student.mentor_id === actor.personId)
    return {
      student,
      grants: ["attendance", "marks", "fees", "support", "private"],
    };
  if (actor.role === "parent") {
    const links = await client.query<{ grants: string[] }>(
      `SELECT COALESCE(array_agg(g.field_group) FILTER(WHERE g.granted),'{}') AS grants FROM parent_links l LEFT JOIN parent_field_grants g ON g.parent_link_id=l.id WHERE l.generation_id=$1 AND l.student_id=$2 AND l.parent_person_id=$3 AND l.active GROUP BY l.id`,
      [generation, id, actor.personId],
    );
    if (links.rowCount) return { student, grants: links.rows[0]!.grants };
  }
  throw new AuthorizationError("This student is outside your assigned access");
}
export async function experienceCourses(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
): Promise<ExperienceCourse[]> {
  if (!["student", "faculty", "hod"].includes(actor.role)) return [];
  return (
    await client.query<ExperienceCourse>(
      `SELECT o.id,o.course_id,o.term_id,c.code,c.title,c.description,c.credits,o.section,o.capacity,o.status,o.revision,t.name AS term_name,t.active AS term_active,
    fa.faculty_person_id AS faculty_id,p.display_name AS faculty_name,
    (SELECT count(*)::int FROM registrations r WHERE r.course_offering_id=o.id AND r.status='registered') AS enrolled,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'weekday',s.weekday,'starts_at',s.starts_at::text,'ends_at',s.ends_at::text,'room',s.room) ORDER BY s.weekday,s.starts_at) FROM timetable_slots s WHERE s.course_offering_id=o.id),'[]') AS slots,
    COALESCE((SELECT array_agg(pc.code) FROM course_prerequisites cp JOIN courses pc ON pc.id=cp.prerequisite_course_id WHERE cp.course_id=c.id),'{}') AS prerequisites,
    rw.status AS window_status,rw.opens_at,rw.closes_at,r.id AS registration_id,r.status AS registration_status
    FROM course_offerings o JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id
    LEFT JOIN faculty_assignments fa ON fa.course_offering_id=o.id AND fa.active LEFT JOIN people p ON p.id=fa.faculty_person_id
    LEFT JOIN registration_windows rw ON rw.term_id=o.term_id AND rw.department_id=c.department_id
    LEFT JOIN registrations r ON r.course_offering_id=o.id AND r.student_id=$4
    WHERE o.generation_id=$1 AND c.department_id=$2 AND ($3<>'faculty' OR fa.faculty_person_id=$5) AND ($3<>'student' OR o.status='published' OR r.status IN ('registered','completed')) ORDER BY t.starts_on DESC,c.code,o.section`,
      [
        generation,
        actor.departmentId,
        actor.role,
        actor.studentId ?? null,
        actor.personId,
      ],
    )
  ).rows;
}
export async function experienceOverview(
  actor: ActorContext,
): Promise<ExperienceOverview> {
  requireRole(actor, "student", "parent", "faculty", "hod", "governance");
  return withCoreTransaction(async (client) => {
    const gen = await getCurrentGeneration(client);
    const person = (
      await client.query<{ display_name: string; email: string }>(
        "SELECT display_name,email FROM people WHERE id=$1",
        [actor.personId],
      )
    ).rows[0]!;
    const department =
      (
        await client.query<{ name: string }>(
          "SELECT name FROM departments WHERE id=$1",
          [actor.departmentId ?? null],
        )
      ).rows[0]?.name ?? "AURA";
    const courses = await experienceCourses(client, gen, actor);
    const students = ["faculty", "hod"].includes(actor.role)
      ? (
          await client.query<PersonSummary>(
            `SELECT s.id,p.display_name AS name,p.email,s.register_number,s.semester,m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name,COALESCE(m.revision,0) AS mentor_revision,
      (SELECT count(*)::int FROM registrations r WHERE r.student_id=s.id AND r.status='registered') AS active_registrations,
      (SELECT count(*)::int FROM support_cases sc WHERE sc.student_id=s.id AND sc.status IN ('open','awaiting_faculty','failed')) AS attention_count
      FROM student_profiles s JOIN people p ON p.id=s.person_id LEFT JOIN mentor_assignments m ON m.student_id=s.id LEFT JOIN people mp ON mp.id=m.faculty_person_id
      WHERE s.generation_id=$1 AND s.department_id=$2 AND ($3='hod' OR m.faculty_person_id=$4) ORDER BY attention_count DESC,s.register_number`,
            [gen, actor.departmentId, actor.role, actor.personId],
          )
        ).rows
      : [];
    const faculty =
      actor.role === "hod"
        ? (
            await client.query<PersonSummary>(
              `SELECT p.id,p.display_name AS name,p.email,p.revision,(SELECT count(*)::int FROM mentor_assignments m WHERE m.faculty_person_id=p.id) AS mentee_count,(SELECT count(*)::int FROM faculty_assignments f WHERE f.faculty_person_id=p.id AND f.active) AS course_count FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.role='faculty' AND r.active WHERE p.generation_id=$1 AND r.department_id=$2 ORDER BY p.display_name`,
              [gen, actor.departmentId],
            )
          ).rows
        : [];
    const children =
      actor.role === "parent"
        ? (
            await client.query<PersonSummary>(
              `SELECT s.id,p.display_name AS name,p.email,s.register_number,s.semester FROM parent_links l JOIN student_profiles s ON s.id=l.student_id JOIN people p ON p.id=s.person_id WHERE l.generation_id=$1 AND l.parent_person_id=$2 AND l.active ORDER BY p.display_name`,
              [gen, actor.personId],
            )
          ).rows
        : [];
    const registration =
      actor.role === "student"
        ? (
            await client.query<ExperienceOverview["registration"][number]>(
              "SELECT id,term_id,status,revision,submitted_at FROM registration_submissions WHERE generation_id=$1 AND student_id=$2",
              [gen, actor.studentId],
            )
          ).rows
        : [];
    const terms = (
      await client.query<ExperienceOverview["terms"][number]>(
        "SELECT id,name,active FROM terms WHERE generation_id=$1 ORDER BY starts_on DESC",
        [gen],
      )
    ).rows;
    const grading = actor.departmentId
      ? ((
          await client.query<GradingScale>(
            "SELECT id,label,bands,revision FROM grading_scales WHERE generation_id=$1 AND department_id=$2",
            [gen, actor.departmentId],
          )
        ).rows[0] ?? null)
      : null;
    const followups = ["faculty", "hod"].includes(actor.role)
      ? (
          await client.query<ExperienceOverview["followups"][number]>(
            `SELECT f.id,f.student_id,p.display_name AS student_name,mp.display_name AS mentor_name,f.due_on::text,f.note,f.shared,f.status,f.outcome,f.revision,(f.due_on<CURRENT_DATE AND f.status<>'completed') AS overdue FROM support_followups f JOIN student_profiles s ON s.id=f.student_id JOIN people p ON p.id=s.person_id JOIN people mp ON mp.id=f.mentor_person_id JOIN mentor_assignments ma ON ma.student_id=s.id WHERE f.generation_id=$1 AND s.department_id=$2 AND ($3='hod' OR ma.faculty_person_id=$4) ORDER BY f.due_on`,
            [gen, actor.departmentId, actor.role, actor.personId],
          )
        ).rows
      : [];
    const status = ["hod", "faculty", "governance"].includes(actor.role)
      ? (
          await client.query<{ pending: number; failed: number }>(
            `SELECT count(*) FILTER(WHERE j.status='awaiting_faculty')::int AS pending,count(*) FILTER(WHERE j.status IN ('failed','blocked'))::int AS failed FROM ch11_jobs j JOIN student_profiles s ON s.id=j.student_id WHERE j.generation_id=$1 AND ($2='governance' OR s.department_id=$3) AND ($2<>'faculty' OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=s.id AND m.faculty_person_id=$4))`,
            [gen, actor.role, actor.departmentId ?? null, actor.personId],
          )
        ).rows[0]
      : undefined;
    const windows =
      actor.role === "hod"
        ? (
            await client.query<ExperienceOverview["windows"][number]>(
              "SELECT id,term_id,opens_at,closes_at,status,revision FROM registration_windows WHERE generation_id=$1 AND department_id=$2",
              [gen, actor.departmentId],
            )
          ).rows
        : [];
    return {
      actor: {
        role: actor.role,
        name: person.display_name,
        email: person.email,
        student_id: actor.studentId ?? null,
      },
      department,
      courses,
      students,
      faculty,
      children,
      registration,
      terms,
      grading,
      followups,
      windows,
      counts: {
        students: students.length,
        faculty: faculty.length,
        courses: courses.length,
        pending_reviews: status?.pending ?? 0,
        failed_reviews: status?.failed ?? 0,
        overdue_followups: followups.filter((f) => f.overdue).length,
        draft_courses: courses.filter((c) => c.status === "draft").length,
      },
    };
  });
}
export function calculateGpa(courses: CourseProgress[]) {
  const graded = courses.filter(
    (c) => c.result_published && c.grade_point !== null,
  );
  const byTerm = new Map<string, typeof graded>();
  for (const c of graded)
    byTerm.set(c.term_id, [...(byTerm.get(c.term_id) ?? []), c]);
  const mean = (list: typeof graded) =>
    Math.round(
      (list.reduce((s, c) => s + c.credits * c.grade_point!, 0) /
        list.reduce((s, c) => s + c.credits, 0)) *
        100,
    ) / 100;
  return {
    cgpa: graded.length ? mean(graded) : null,
    terms: [...byTerm.entries()].map(([id, list]) => ({
      id,
      name: list[0]!.term_name,
      sgpa: mean(list),
      credits: list.reduce((s, c) => s + c.credits, 0),
      graded_courses: list.length,
      registered_courses: courses.filter((c) => c.term_id === id).length,
    })),
    label:
      "Demonstration 10-point scale. Only published course results count; LMS assignment marks are separate.",
  };
}
export async function experienceStudent(
  actor: ActorContext,
  id: string,
): Promise<StudentDetail> {
  return withCoreTransaction(async (client) => {
    const gen = await getCurrentGeneration(client);
    const { student, grants } = await requireExperienceStudent(
      client,
      gen,
      actor,
      id,
    );
    const privateView = grants.includes("private");
    const courses = (
      await client.query<CourseProgress>(
        `SELECT o.id AS offering_id,c.code,c.title,c.credits,t.id AS term_id,t.name AS term_name,r.status AS registration_status,
      (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ses ON ses.id=ar.attendance_session_id WHERE ar.student_id=r.student_id AND ses.course_offering_id=o.id AND ses.status IN ('submitted','locked') AND ar.status='present') AS present,
      (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ses ON ses.id=ar.attendance_session_id WHERE ar.student_id=r.student_id AND ses.course_offering_id=o.id AND ses.status IN ('submitted','locked') AND ar.status='absent') AS absent,
      (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ses ON ses.id=ar.attendance_session_id WHERE ar.student_id=r.student_id AND ses.course_offering_id=o.id AND ses.status IN ('submitted','locked') AND ar.status='late') AS late,
      (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ses ON ses.id=ar.attendance_session_id WHERE ar.student_id=r.student_id AND ses.course_offering_id=o.id AND ses.status IN ('submitted','locked') AND ar.status='excused') AS excused,
      cr.id AS result_id,cr.percentage::float AS result_percentage,cr.grade_point::float,cr.letter,cr.revision AS result_revision,cr.published AS result_published
      FROM registrations r JOIN course_offerings o ON o.id=r.course_offering_id JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id LEFT JOIN course_results cr ON cr.student_id=r.student_id AND cr.course_offering_id=o.id AND (cr.published OR $3) WHERE r.generation_id=$1 AND r.student_id=$2 AND r.status IN ('registered','completed') ORDER BY t.starts_on DESC,c.code`,
        [gen, id, privateView],
      )
    ).rows.map((c) => ({
      ...c,
      percentage:
        c.present + c.late + c.absent
          ? Math.round(
              (100 * (c.present + c.late)) / (c.present + c.late + c.absent),
            )
          : null,
    }));
    const attendance = grants.includes("attendance")
      ? (
          await client.query<StudentDetail["attendance"][number]>(
            `SELECT ar.id,o.id AS offering_id,c.code,s.id AS session_id,s.session_date::text,s.topic,ar.status,ar.revision FROM attendance_records ar JOIN attendance_sessions s ON s.id=ar.attendance_session_id JOIN course_offerings o ON o.id=s.course_offering_id JOIN courses c ON c.id=o.course_id WHERE ar.generation_id=$1 AND ar.student_id=$2 AND s.status IN ('submitted','locked') ORDER BY s.session_date DESC,c.code`,
            [gen, id],
          )
        ).rows
      : [];
    const marks = grants.includes("marks")
      ? (
          await client.query<StudentDetail["marks"][number]>(
            `SELECT m.id,o.id AS offering_id,c.code,a.id AS assessment_id,a.title AS assessment,a.maximum_score::float,m.score::float,m.feedback,m.revision FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN course_offerings o ON o.id=a.course_offering_id JOIN courses c ON c.id=o.course_id WHERE m.generation_id=$1 AND m.student_id=$2 AND a.published ORDER BY c.code,a.title`,
            [gen, id],
          )
        ).rows
      : [];
    const invoices = grants.includes("fees")
      ? (
          await client.query<StudentDetail["invoices"][number]>(
            `SELECT i.id,i.invoice_number,i.description,i.amount_paise::float,i.paid_paise::float,i.due_on::text,i.status,i.revision,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount_paise',t.amount_paise,'created_at',t.created_at,'status',t.status) ORDER BY t.created_at DESC) FROM payment_transactions t WHERE t.invoice_id=i.id),'[]') AS transactions FROM fee_invoices i WHERE i.generation_id=$1 AND i.student_id=$2 ORDER BY i.due_on`,
            [gen, id],
          )
        ).rows
      : [];
    const mentor = grants.includes("support")
      ? ((
          await client.query<{ name: string; email: string }>(
            `SELECT p.display_name AS name,p.email FROM mentor_assignments m JOIN people p ON p.id=m.faculty_person_id WHERE m.generation_id=$1 AND m.student_id=$2`,
            [gen, id],
          )
        ).rows[0] ?? null)
      : null;
    const support = grants.includes("support")
      ? (
          await client.query<StudentDetail["support"][number]>(
            `SELECT p.id,c.id AS case_id,c.reason,c.risk_band,p.visible_to_student AS visible,p.created_at,p.plan FROM support_plans p JOIN support_cases c ON c.id=p.support_case_id WHERE p.generation_id=$1 AND p.student_id=$2 AND (p.visible_to_student OR $3) ORDER BY p.created_at DESC`,
            [gen, id, privateView],
          )
        ).rows
      : [];
    const followups = grants.includes("support")
      ? (
          await client.query<StudentDetail["followups"][number]>(
            `SELECT f.id,f.student_id,sp.display_name AS student_name,p.display_name AS mentor_name,f.due_on::text,f.note,f.shared,f.status,f.outcome,f.revision,(f.due_on<CURRENT_DATE AND f.status<>'completed') AS overdue FROM support_followups f JOIN people p ON p.id=f.mentor_person_id JOIN student_profiles s ON s.id=f.student_id JOIN people sp ON sp.id=s.person_id WHERE f.generation_id=$1 AND f.student_id=$2 AND (f.shared OR $3) ORDER BY f.due_on DESC`,
            [gen, id, privateView],
          )
        ).rows
      : [];
    const sources: StudentDetail["sources"] = [];
    if (privateView) {
      const lms = await lmsEvidence(client, gen, id);
      sources.push({
        source: "lms",
        state: lms.state,
        observed_at: lms.observedAt,
        values: lms.values,
      });
      const other = await client.query<StudentDetail["sources"][number]>(
        `SELECT source,record->>'state' AS state,record->>'observedAt' AS observed_at,record->'values' AS values FROM ch11_sources WHERE generation_id=$1 AND student_id=$2 AND source IN ('internship','placement')`,
        [gen, id],
      );
      sources.push(...other.rows);
    }
    const history =
      actor.role === "hod"
        ? (
            await client.query<StudentDetail["history"][number]>(
              `SELECT r.id,r.resource_type,r.reason,p.display_name AS actor,r.occurred_at,r.previous,r.updated FROM record_changes r JOIN people p ON p.id=r.actor_id WHERE r.generation_id=$1 AND (r.resource_id=$2 OR r.updated->>'student_id'=$2::text OR r.updated->>'studentId'=$2::text) ORDER BY r.occurred_at DESC LIMIT 100`,
              [gen, id],
            )
          ).rows
        : [];
    const registration =
      actor.role === "parent"
        ? []
        : (
            await client.query<StudentDetail["registration"][number]>(
              "SELECT id,term_id,status,revision,submitted_at FROM registration_submissions WHERE generation_id=$1 AND student_id=$2",
              [gen, id],
            )
          ).rows;
    const gpa = grants.includes("marks")
      ? calculateGpa(courses)
      : {
          cgpa: null,
          terms: [],
          label: "Results are not shared with this account.",
        };
    // Field grants must also apply to aggregate values, not just the detail tables.
    const visibleCourses = courses.map((c) => ({
      ...c,
      ...(!grants.includes("attendance")
        ? { present: 0, absent: 0, late: 0, excused: 0, percentage: null }
        : {}),
      ...(!grants.includes("marks")
        ? {
            result_id: null,
            result_percentage: null,
            grade_point: null,
            letter: null,
            result_revision: null,
            result_published: null,
          }
        : {}),
    }));
    return {
      student,
      grants,
      courses: visibleCourses,
      marks,
      attendance,
      gpa,
      mentor,
      invoices,
      support,
      followups,
      sources,
      history,
      registration,
    };
  });
}
export async function experienceClassroom(
  actor: ActorContext,
  id: string,
): Promise<Classroom> {
  return withCoreTransaction(async (client) => {
    const gen = await getCurrentGeneration(client);
    await requireLmsCourse(client, gen, actor, id, true);
    const course = (await experienceCourses(client, gen, actor)).find(
      (c) => c.id === id,
    );
    if (!course) throw new NotFoundError("Course not found");
    const roster = (
      await client.query<PersonSummary>(
        `SELECT s.id,p.display_name AS name,p.email,s.register_number FROM registrations r JOIN student_profiles s ON s.id=r.student_id JOIN people p ON p.id=s.person_id WHERE r.generation_id=$1 AND r.course_offering_id=$2 AND r.status IN ('registered','completed') ORDER BY s.register_number`,
        [gen, id],
      )
    ).rows;
    const sessions = (
      await client.query<Classroom["sessions"][number]>(
        `SELECT s.id,s.session_date::text,s.topic,s.status,s.revision,COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',r.student_id,'status',r.status)) FROM attendance_records r WHERE r.attendance_session_id=s.id),'[]') AS records FROM attendance_sessions s WHERE s.generation_id=$1 AND s.course_offering_id=$2 ORDER BY s.session_date DESC`,
        [gen, id],
      )
    ).rows;
    const assessments = (
      await client.query<Classroom["assessments"][number]>(
        `SELECT a.id,a.title,a.maximum_score::float,a.weight_percent::float,a.published,a.revision,COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',m.student_id,'score',m.score,'feedback',m.feedback)) FROM marks m WHERE m.assessment_id=a.id),'[]') AS marks FROM assessments a WHERE a.generation_id=$1 AND a.course_offering_id=$2 ORDER BY a.title`,
        [gen, id],
      )
    ).rows;
    const results = (
      await client.query<Classroom["results"][number]>(
        "SELECT student_id,percentage::float,revision,published FROM course_results WHERE generation_id=$1 AND course_offering_id=$2",
        [gen, id],
      )
    ).rows;
    return { course, roster, sessions, assessments, results };
  });
}
