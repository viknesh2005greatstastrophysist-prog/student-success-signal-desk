import "@aura/portal-kit/styles.css";
export const metadata = { title: "AURA Parent Portal", description: "Independent consent-scoped synthetic parent portal" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
