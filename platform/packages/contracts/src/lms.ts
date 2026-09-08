export type LmsAttachment = { name: string; data: string };
export type LmsCourse = {
  id: string;
  code: string;
  title: string;
  credits: number;
  section: string;
  faculty_name: string;
  registration_status: string | null;
  lessons: number;
  assignments: number;
  pending: number;
};
export type LmsLesson = {
  id: string;
  title: string;
  body: string;
  material_url: string;
  attachment_name: string | null;
  published: boolean;
  position: number;
  revision: number;
  opened_at: string | null;
};
export type LmsAssignment = {
  id: string;
  title: string;
  instructions: string;
  due_at: string;
  maximum_score: string;
  attachment_name: string | null;
  published: boolean;
  allow_late: boolean;
  deadline_passed: boolean;
  revision: number;
  submissions: number;
};
export type LmsSubmission = {
  id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  answer: string;
  attachment_name: string | null;
  submitted_at: string;
  revision: number;
  score: string | null;
  feedback: string;
  graded_at: string | null;
};
export type LmsOverview = {
  role: "student" | "faculty" | "hod";
  name: string;
  courses: LmsCourse[];
};
export type LmsCourseDetail = {
  course: LmsCourse;
  lessons: LmsLesson[];
  assignments: LmsAssignment[];
  submissions: LmsSubmission[];
  canManage: boolean;
};
