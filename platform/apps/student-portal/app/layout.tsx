import "@aura/portal-kit/workspace.css";
export const metadata = {
  title: "AURA Student Portal",
  description: "Courses, timetables, progress, and support plans.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
