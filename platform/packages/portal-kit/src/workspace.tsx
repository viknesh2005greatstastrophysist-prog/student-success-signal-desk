"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  portalDefinitions,
  resolvePortalOrigins,
  type PortalId,
} from "@aura/contracts";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export function usePortalApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingCount = useRef(0);
  const csrf = useRef("");
  const requestVersion = useRef(0);
  const lastCommand = useRef<{ body: string; key: string } | null>(null);
  const read = useCallback(async <R,>(url: string): Promise<R> => {
    const response = await fetch(url, { cache: "no-store" });
    const token = response.headers.get("x-csrf-token");
    if (token) csrf.current = token;
    if (response.status === 401) {
      setSignedOut(true);
      throw new Error("Your session ended. Sign in again.");
    }
    const result = (await response.json()) as ApiResult<R>;
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const value = await read<T>(path);
      if (version === requestVersion.current) {
        setData(value);
        setError("");
        setSignedOut(false);
      }
    } catch (e) {
      if (version === requestVersion.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not load this page. Try again.",
        );
    }
  }, [path, read]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      requestVersion.current = requestVersion.current + 1;
    };
  }, [refresh]);
  const command = useCallback(
    async <R,>(
      url: string,
      input: unknown,
      concurrent = false,
    ): Promise<R | null> => {
      if (pendingCount.current > 0 && !concurrent) return null;
      pendingCount.current += 1;
      setPending(true);
      setError("");
      const body = JSON.stringify(input);
      const fingerprint = url + body;
      if (lastCommand.current?.body !== fingerprint)
        lastCommand.current = { body: fingerprint, key: crypto.randomUUID() };
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf.current,
            "Idempotency-Key": lastCommand.current.key,
          },
          body,
        });
        if (response.status === 401) setSignedOut(true);
        const result = (await response.json()) as ApiResult<R>;
        if (!result.ok) throw new Error(result.error.message);
        lastCommand.current = null;
        return result.data;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not save this change. Try again.",
        );
        return null;
      } finally {
        pendingCount.current -= 1;
        setPending(pendingCount.current > 0);
      }
    },
    [],
  );
  const signOut = async () => {
    const response = await fetch("/api/session/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf.current },
    });
    if (response.ok) {
      setData(null);
      setSignedOut(true);
      window.history.replaceState({}, "", "/");
    } else setError("Could not sign out. Try again.");
  };
  return {
    data,
    error,
    setError,
    signedOut,
    pending,
    read,
    command,
    refresh,
    signOut,
  };
}
export function portalUrl(portal: PortalId) {
  const origins = resolvePortalOrigins()[portal];
  return origins[
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? 1
      : 0
  ]!;
}
export function Workspace({
  portal,
  sections,
  current,
  onNavigate,
  onSignOut,
  viewer,
  children,
}: {
  portal: PortalId;
  sections: string[];
  current: string;
  onNavigate: (section: string) => void;
  onSignOut: () => void;
  viewer?: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace" data-portal={portal}>
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <header className="workspace-header">
        <div className="workspace-brand">
          <b>AURA</b>
          <span>{portalDefinitions[portal].name}</span>
        </div>
        <div className="workspace-tools">
          {viewer ? <span className="viewer-name">{viewer}</span> : null}
          <span className="demo-label">Project demo</span>
          <button className="quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <nav aria-label="Portal sections">
            {sections.map((section) => (
              <button
                key={section}
                className={current === section ? "nav-current" : ""}
                aria-current={current === section ? "page" : undefined}
                onClick={() => onNavigate(section)}
              >
                {section}
              </button>
            ))}
          </nav>
          <details className="portal-links">
            <summary>Other portals</summary>
            {Object.entries(portalDefinitions)
              .filter(([id]) => id !== portal)
              .map(([id, p]) => (
                <a key={id} href={portalUrl(id as PortalId)}>
                  {p.name}
                </a>
              ))}
          </details>
          <p className="sidebar-note">
            Fictional records for the student-support project.
          </p>
        </aside>
        <main id="workspace-main" className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function PortalEntry({
  portal,
  description,
}: {
  portal: PortalId;
  description: string;
}) {
  return (
    <main className="entry-page">
      <div className="workspace-brand">
        <b>AURA</b>
        <span>Project demonstration</span>
      </div>
      <section>
        <p className="eyebrow">{portalDefinitions[portal].name}</p>
        <h1>
          {portal === "lms"
            ? "Your course work, in one place."
            : portalDefinitions[portal].name}
        </h1>
        <p>{description}</p>
        <a
          className="primary button-link"
          href={`/api/session/login?returnTo=${encodeURIComponent(typeof window !== "undefined" && window.location.pathname !== "/" ? window.location.pathname + window.location.search : "/dashboard")}`}
        >
          Open {portal === "lms" ? "LMS" : "portal"}
        </a>
        <small>
          No password needed. Choose a demo account on the next screen.
        </small>
      </section>
      <footer>
        Fictional people and records · AURA student-support project
      </footer>
    </main>
  );
}
export function dateTime(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value))
    : "Not recorded";
}
export async function selectedFile(file: File | undefined) {
  if (!file) return undefined;
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Choose a file smaller than 2 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { name: file.name, data: btoa(binary) };
}
