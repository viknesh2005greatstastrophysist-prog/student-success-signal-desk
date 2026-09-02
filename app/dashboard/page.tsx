import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignalDesk } from "../_components/signal-desk";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <SignalDesk />;
}
