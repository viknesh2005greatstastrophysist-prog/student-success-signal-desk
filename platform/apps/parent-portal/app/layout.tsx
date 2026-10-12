import "@aura/portal-kit/workspace.css";
export const metadata = {
  title: "AURA Parent Portal",
  description: "Attendance, results, fees, and mentor updates.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
