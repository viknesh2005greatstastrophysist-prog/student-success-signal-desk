import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PortalLanding } from "./_components/auth-shell";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <PortalLanding />;
}
