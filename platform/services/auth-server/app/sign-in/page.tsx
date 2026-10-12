import { portalDefinitions,resolvePortalOrigins,portalOidcClients, type PortalId } from "@aura/contracts";
import { demoPersonas } from "@/lib/demo-personas";
import { identityMode } from "@/lib/identity-mode";
type SearchValue=string|string[]|undefined;
export default async function SignInPage({searchParams}:{searchParams:Promise<Record<string,SearchValue>>}){
  const raw=await searchParams;const params=new URLSearchParams();
  for(const [key,value] of Object.entries(raw))for(const item of Array.isArray(value)?value:value?[value]:[])params.append(key,item);
  const error=params.get("error");params.delete("error");
  if(identityMode()!=="demo"){
    const portal=(Object.entries(portalOidcClients).find(([,client])=>client===params.get("client_id"))?.[0]) as PortalId|undefined;
    return <main className="identity-stage"><section className="identity-story"><p className="eyebrow">AURA · academic workspace</p><h1>{portal?portalDefinitions[portal].name:"Account sign-in"}</h1><p>Courses, progress and student support in one connected workspace.</p></section><section className="identity-card"><h2>Sign in</h2>{error?<p className="form-error" role="alert">{error==="rate_limited"?"Too many sign-in attempts. Wait a few seconds and try again.":"Sign-in could not be completed. Check your account details or restart from the portal."}</p>:null}{portal?<form action={`/api/institution/sign-in?${params.toString()}`} method="post"><label htmlFor="college-email">Account email</label><input id="college-email" name="email" type="email" autoComplete="username" data-action-id="identity-college-email" required/><label htmlFor="college-password">Password</label><input id="college-password" name="password" type="password" autoComplete="current-password" minLength={10} data-action-id="identity-college-password" required/><button type="submit" data-action-id="identity-college-sign-in">Sign in</button></form>:<p>Open your assigned portal to start sign-in.</p>}<p>Access follows your assigned role and permissions.</p></section></main>;
  }
  const accounts=demoPersonas.filter(p=>p.clientId===params.get("client_id"));
  const portal=accounts[0]?.portal;const title=portal?portalDefinitions[portal].name:"Sign-in link expired";
  const hint=params.get("login_hint");
  const ordered=[...accounts].sort((a,b)=>Number(b.email===hint)-Number(a.email===hint));
  const restart=portal?resolvePortalOrigins()[portal][process.env.NODE_ENV==="production"?0:1]:"https://aura-student-portal.vercel.app";
  return <main className="identity-stage">
    <section className="identity-story" aria-label="AURA project demonstration"><div className="identity-mark" aria-hidden="true">A</div><div><p className="eyebrow">AURA · student support</p><h1>{title}</h1><p>Use a demonstration account to explore the portal. No password is needed.</p></div><p className="synthetic-note">Project demonstration · fictional people and records</p></section>
    <section className="identity-card"><p className="step-index">Continue to your portal</p><h2>{accounts.length>1?"Choose your account":"Your demo account"}</h2>
      {error?<p className="form-error" role="alert">The sign-in link expired or could not be completed. <a href={restart} data-action-id="identity-restart-login">Start again</a>.</p>:null}
      {ordered.length>4?<form action={`/api/demo/sign-in?${params.toString()}`} method="post">
        <input type="hidden" name="persona" value={portal}/>
        <label htmlFor="demo-account">Demo account</label>
        <select id="demo-account" name="account" defaultValue={ordered[0]?.email} data-action-id="identity-select-demo-account" required>
          {ordered.map(p=><option key={p.email} value={p.email}>{p.name}{portal==="lms"?` · ${p.label}`:""}</option>)}
        </select>
        <button type="submit" data-action-id="identity-enter-portal">Open portal</button>
      </form>:ordered.map(persona=><form key={persona.email} action={`/api/demo/sign-in?${params.toString()}`} method="post"><input type="hidden" name="persona" value={persona.portal}/><input type="hidden" name="account" value={persona.email}/><div className="persona-card"><span><strong>{persona.name}</strong><small>{persona.label}</small></span></div><button type="submit" data-action-id="identity-enter-portal">Continue as {persona.name}</button></form>)}
      {!accounts.length?<p>This link is not recognised. Open a portal and start sign-in again.</p>:<p className="privacy-copy">You will only see the courses and records assigned to this account.</p>}
    </section>
  </main>;
}
