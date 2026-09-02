import "@aura/portal-kit/styles.css";
export const metadata = { title: "AURA Student Portal", description: "Independent synthetic student portal" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
