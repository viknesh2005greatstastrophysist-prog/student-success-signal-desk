import "@aura/portal-kit/workspace.css";
export const metadata = {
  title: "AURA HOD Portal",
  description: "Department faculty, courses, timetables, and support reviews.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
