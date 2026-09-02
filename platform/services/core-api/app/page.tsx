export default function CoreApiPage() {
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", maxWidth: 720, margin: "15vh auto", padding: 24 }}>
      <p>AURA / institutional core</p>
      <h1>Authoritative API boundary</h1>
      <p>This service exposes machine-readable endpoints. It is not a sixth user portal.</p>
      <a href="/api/v1/health">Health contract</a>
    </main>
  );
}
