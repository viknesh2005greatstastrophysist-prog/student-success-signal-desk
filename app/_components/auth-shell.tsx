import { SignIn, SignUp } from "@clerk/nextjs";
import Link from "next/link";

const clerkAppearance = {
  variables: {
    colorPrimary: "#c8102e",
    colorText: "#271d1e",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#271d1e",
    borderRadius: "4px",
    fontFamily: "var(--font-sans)",
  },
  elements: {
    rootBox: "clerk-root",
    cardBox: "clerk-card-box",
    card: "clerk-card",
    headerTitle: "clerk-title",
    headerSubtitle: "clerk-subtitle",
    formButtonPrimary: "clerk-primary",
    footerActionLink: "clerk-link",
    socialButtonsBlockButton: "clerk-social",
  },
};

function Mark() {
  return (
    <div className="university-mark" aria-label="KLE Technological University prototype">
      <div className="mark-symbol">KT</div>
      <div>
        <strong>KLE Technological University</strong>
        <span>Hubballi</span>
      </div>
    </div>
  );
}

function AuthFrame({ children, eyebrow }: { children: React.ReactNode; eyebrow: string }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Mark />
        <div className="auth-story-copy">
          <p className="auth-eyebrow">AURA · STUDENT SUCCESS LAB</p>
          <h1>Support should arrive before the crisis.</h1>
          <p>
            A governed agentic AI prototype that joins academic signals, human judgement,
            intervention delivery, and accountable oversight.
          </p>
        </div>
        <div className="notice-board">
          <div className="notice-title">Prototype notice board</div>
          <div className="notice-item"><span>01</span> All student records and outcomes are synthetic.</div>
          <div className="notice-item"><span>02</span> Agent recommendations require faculty approval.</div>
          <div className="notice-item"><span>03</span> This is not an official university service.</div>
        </div>
      </section>
      <section className="auth-action">
        <div className="auth-action-inner">
          <p className="auth-eyebrow light">{eyebrow}</p>
          {children}
          <p className="auth-boundary">
            Create credentials only for this prototype. Never reuse your Contineo or university password.
          </p>
        </div>
      </section>
      <footer className="auth-footer">
        <span>AURA Student Success Prototype</span>
        <span>Privacy boundary · Synthetic data only</span>
      </footer>
    </main>
  );
}

export function PortalLanding() {
  return (
    <AuthFrame eyebrow="ODD TERM 2026 · PROTOTYPE ACCESS">
      <div className="welcome-card">
        <div className="status-line"><span /> Protected prototype</div>
        <h2>One ecosystem.<br />Five accountable roles.</h2>
        <p>
          Sign in to a server-assigned Student, Parent, Mentor, Leadership, or AURA Operations role.
          Operations can inspect read-only surface previews; it cannot exercise mentor authority.
        </p>
        <Link className="primary-link" href="/sign-in">Sign in</Link>
        <Link className="secondary-link" href="/sign-up">Create prototype account</Link>
      </div>
    </AuthFrame>
  );
}

export function SignInPortal() {
  return (
    <AuthFrame eyebrow="SECURE PROTOTYPE SIGN IN">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/dashboard"
        appearance={clerkAppearance}
      />
    </AuthFrame>
  );
}

export function SignUpPortal() {
  return (
    <AuthFrame eyebrow="CREATE PROTOTYPE ACCOUNT">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/dashboard"
        appearance={clerkAppearance}
      />
    </AuthFrame>
  );
}
