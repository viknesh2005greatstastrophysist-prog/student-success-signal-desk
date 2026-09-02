import { Suspense } from "react";
import { ConsentClient } from "./consent-client";

export default function ConsentPage() {
  return <Suspense fallback={<main className="consent-stage"><p>Loading permission request…</p></main>}><ConsentClient /></Suspense>;
}
