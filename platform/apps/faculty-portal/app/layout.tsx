import "@aura/portal-kit/workspace.css";
export const metadata = { title: "AURA Faculty Portal", description: "Independent assigned-classroom and review portal" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
