import "@aura/portal-kit/styles.css";
export const metadata = { title: "AURA HOD Portal", description: "Independent department operations portal" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
