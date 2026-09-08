/** Fictional people shared by the additive demo population and account picker. */
export const demoMentors = [
  { name: "Dr Mira Sen", email: "faculty1@aura.invalid" },
  { name: "Prof Arjun Bhat", email: "faculty2@aura.invalid" },
  { name: "Dr Leena Thomas", email: "faculty3@aura.invalid" },
] as const;

export const demoStudents = [
  { name: "Ananya Rao", email: "student1@aura.invalid", mentor: 0 },
  { name: "Dev Patel", email: "student2@aura.invalid", mentor: 0 },
  { name: "Ishaan Shah", email: "student3@aura.invalid", mentor: 0 },
  { name: "Kavya Nair", email: "student4@aura.invalid", mentor: 0 },
  { name: "Meera Iyer", email: "student5@aura.invalid", mentor: 1 },
  { name: "Nikhil Kumar", email: "student6@aura.invalid", mentor: 1 },
  { name: "Priya Das", email: "student7@aura.invalid", mentor: 1 },
  { name: "Rahul Menon", email: "student8@aura.invalid", mentor: 2 },
  { name: "Sara Ali", email: "student9@aura.invalid", mentor: 2 },
  { name: "Tarun Bose", email: "student10@aura.invalid", mentor: 2 },
] as const;

export const demoParents = [
  "Lakshmi Rao", "Harish Patel", "Neha Shah", "Gopal Nair", "Suma Iyer",
  "Mohan Kumar", "Deepa Das", "Arun Menon", "Farah Ali",
].map((name, i) => ({ name, email: `parent${i + 1}@aura.invalid` }));
