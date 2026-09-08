import type { PoolClient } from "pg";
export const demoBands = [
  { minimum: 90, points: 10, letter: "O" },
  { minimum: 80, points: 9, letter: "A+" },
  { minimum: 70, points: 8, letter: "A" },
  { minimum: 60, points: 7, letter: "B+" },
  { minimum: 50, points: 6, letter: "B" },
  { minimum: 40, points: 5, letter: "C" },
  { minimum: 0, points: 0, letter: "F" },
];
export async function seedExperience(client: PoolClient, generation: string) {
  await client.query(
    `INSERT INTO mentor_assignments(id,generation_id,student_id,faculty_person_id,assigned_by)
    SELECT gen_random_uuid(),s.generation_id,s.id,f.person_id,h.person_id FROM student_profiles s
    JOIN LATERAL(SELECT r.person_id FROM role_assignments r JOIN people p ON p.id=r.person_id WHERE r.generation_id=s.generation_id AND r.department_id=s.department_id AND r.role='faculty' AND r.active ORDER BY p.email LIMIT 1) f ON true
    JOIN LATERAL(SELECT r.person_id FROM role_assignments r WHERE r.generation_id=s.generation_id AND r.department_id=s.department_id AND r.role='hod' AND r.active ORDER BY r.person_id LIMIT 1) h ON true
    WHERE s.generation_id=$1 ON CONFLICT(generation_id,student_id) DO NOTHING`,
    [generation],
  );
  await client.query(
    "INSERT INTO grading_scales(id,generation_id,department_id,bands) SELECT gen_random_uuid(),generation_id,id,$2::jsonb FROM departments WHERE generation_id=$1 ON CONFLICT(generation_id,department_id) DO NOTHING",
    [generation, JSON.stringify(demoBands)],
  );
  await client.query(
    "INSERT INTO course_results(id,generation_id,student_id,course_offering_id,grade_point,letter,scale_revision,published) SELECT gen_random_uuid(),generation_id,student_id,course_offering_id,8,'A',0,true FROM registrations WHERE generation_id=$1 AND status='completed' AND grade='A' ON CONFLICT(generation_id,student_id,course_offering_id) DO NOTHING",
    [generation],
  );
}
