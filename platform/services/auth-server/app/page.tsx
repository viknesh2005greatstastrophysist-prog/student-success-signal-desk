export default function Page() {
  return (
    <main className="identity-home">
      <div className="identity-mark" aria-hidden="true">A</div>
      <p className="eyebrow">AURA Institute of Technology</p>
      <h1>One identity boundary.<br />Five independent portals.</h1>
      <p className="lede">Central OAuth 2.1 and OpenID Connect for the synthetic academic ecosystem.</p>
      <a className="text-link" href="/api/auth/.well-known/openid-configuration">OpenID discovery</a>
    </main>
  );
}
