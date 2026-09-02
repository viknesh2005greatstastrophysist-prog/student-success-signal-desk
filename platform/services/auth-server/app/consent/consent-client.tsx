"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function ConsentClient() {
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const scopes = (params.get("scope") ?? "openid profile email").split(" ").filter(Boolean);

  async function decide(accept: boolean) {
    setPending(true);
    setError("");
    const response = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept, scope: scopes.join(" "), oauth_query: params.toString() }),
    });
    const result = await response.json().catch(() => null) as { url?: string; redirect_uri?: string } | null;
    const destination = result?.url ?? result?.redirect_uri;
    if (response.ok && destination) window.location.assign(destination);
    else { setError("The consent decision could not be recorded."); setPending(false); }
  }

  return (
    <main className="consent-stage">
      <section className="identity-card">
        <p className="step-index">02 / permission</p><h1>Confirm the hand-off</h1><p>The portal is asking the identity service for:</p>
        <ul>{scopes.map((scope) => <li key={scope}>{scope.replaceAll("_", " ")}</li>)}</ul>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="consent-actions">
          <button type="button" disabled={pending} onClick={() => decide(true)} data-action-id="identity-consent-allow">Allow once</button>
          <button className="button-quiet" type="button" disabled={pending} onClick={() => decide(false)} data-action-id="identity-consent-deny">Deny</button>
        </div>
      </section>
    </main>
  );
}
