import type { PortalDefinition } from "@aura/contracts";

export function PortalHome({ portal }: { portal: PortalDefinition }) {
  return (
    <main className="portal-page" style={{ "--portal-accent": portal.accent } as React.CSSProperties}>
      <header className="portal-header">
        <div>
          <p className="prototype-label">AURA synthetic institutional prototype</p>
          <h1>{portal.name}</h1>
        </div>
        <span className="actor-badge">{portal.actor}</span>
      </header>

      <section className="portal-intro" aria-labelledby="portal-purpose">
        <p className="section-label">Independent portal boundary</p>
        <h2 id="portal-purpose">{portal.purpose}</h2>
        <p>
          This application has its own origin, identity client, session, navigation, and release.
          Domain authority remains in the private Core API.
        </p>
      </section>

      <div className="portal-grid">
        <section className="portal-panel">
          <h2>Required capabilities</h2>
          <ul>
            {portal.capabilities.map((capability) => <li key={capability}>{capability}</li>)}
          </ul>
        </section>
        <section className="portal-panel boundary-panel">
          <h2>Must fail closed</h2>
          <ul>
            {portal.prohibited.map((boundary) => <li key={boundary}>{boundary}</li>)}
          </ul>
        </section>
      </div>

      <footer>
        Synthetic data only. This is not an official college service and makes no predictive claim.
      </footer>
    </main>
  );
}
