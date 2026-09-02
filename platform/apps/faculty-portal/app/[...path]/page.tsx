import { notFound } from "next/navigation";
import { portalDefinitions, portalViewRoutes } from "@aura/contracts";
import { PortalHome } from "@aura/portal-kit";

export default async function PortalRoute({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const initialPath = `/${path.join("/")}`;
  if (!(Object.values(portalViewRoutes.faculty) as string[]).includes(initialPath)) notFound();
  return <PortalHome portal={portalDefinitions.faculty} initialPath={initialPath} release={process.env.VERCEL_GIT_COMMIT_SHA} />;
}
