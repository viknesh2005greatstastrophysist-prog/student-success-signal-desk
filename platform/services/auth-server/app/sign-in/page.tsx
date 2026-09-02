import { demoPersonaForClient } from "@/lib/demo-personas";

type SearchValue = string | string[] | undefined;

function toSearchParams(input: Record<string, SearchValue>): URLSearchParams {
  const output = new URLSearchParams();
  for (const [key, raw] of Object.entries(input)) {
    for (const value of Array.isArray(raw) ? raw : raw ? [raw] : []) output.append(key, value);
  }
  return output;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  const params = toSearchParams(raw);
  const persona = demoPersonaForClient(params.get("client_id") ?? undefined);
  const error = params.get("error");

  return (
    <main className="identity-stage">
      <section className="identity-story" aria-label="AURA identity context">
        <div className="identity-mark" aria-hidden="true">A</div>
        <div>
          <p className="eyebrow">AURA identity</p>
          <h1>Cross the right threshold.</h1>
          <p>Each portal keeps its own session. This identity service only proves who is entering.</p>
        </div>
        <p className="synthetic-note">Synthetic people. Real authorization boundaries.</p>
      </section>

      <section className="identity-card">
        <p className="step-index">01 / identity check</p>
        <h2>{persona ? `Enter ${persona.portal}` : "Unknown client"}</h2>
        {persona ? (
          <>
            <div className="persona-card">
              <span className="persona-initial">{persona.name.slice(0, 1)}</span>
              <span><strong>{persona.name}</strong><small>{persona.label}</small></span>
              <span className="verified-chip">seeded</span>
            </div>
            <form action={`/api/demo/sign-in?${params.toString()}`} method="post">
              <input type="hidden" name="persona" value={persona.portal} />
              <label htmlFor="access-pin">Demo access PIN</label>
              <input id="access-pin" name="pin" type="password" inputMode="numeric" autoComplete="one-time-code" required minLength={4} maxLength={32} />
              {error ? <p className="form-error" role="alert">The identity check failed. Verify the PIN and portal.</p> : null}
              <button type="submit" data-action-id="identity-enter-portal">Enter portal <span aria-hidden="true">↗</span></button>
            </form>
            <p className="privacy-copy">Credentials stay at the identity origin. The destination receives a short-lived authorization result.</p>
          </>
        ) : (
          <p className="form-error" role="alert">This authorization request does not belong to a registered AURA portal.</p>
        )}
      </section>
    </main>
  );
}
