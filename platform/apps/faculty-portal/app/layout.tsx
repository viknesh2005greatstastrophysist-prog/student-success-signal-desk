import "@aura/portal-kit/workspace.css";
export const metadata = {
  title: "AURA Faculty Portal",
  description: "Teaching assignments, student records, and follow-ups.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
