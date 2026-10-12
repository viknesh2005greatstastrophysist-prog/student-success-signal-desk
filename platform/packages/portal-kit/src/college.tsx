"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalId } from "@aura/contracts";
import { usePortalApi, Notice, Workspace, PageTitle, type PortalRecordMode } from "./workspace";
type SourceView = { actorRole: string; privacy: string; counts: { students: number; sources: number }; unknowns: string[];
  riskScore: null; studentSupportPublicationAllowed: false; sources: Array<{ id: string; filename: string; sheet: string }>;
  students: Array<{ id: string; name: string; srn: string; reports: Array<{ semester: number; section: string; sourceId: string;
    cells: Array<{ course: string; field: string; rawValue: string | number; sourceCell: string }> }> }> };
export function CollegeSourcesPortal({ portal, recordMode = "demo" }: { portal: PortalId; recordMode?: PortalRecordMode }) {
  const api = usePortalApi<SourceView>("/api/bff/college-sources"), [selected, setSelected] = useState("");
  const router = useRouter();
  if (api.signedOut) return <main className="loading-page"><h1>College source records</h1><p>{recordMode === "project" ? "Sign in with your college account to view records assigned to your role." : "Sign in with your provisioned college account. Source access requires verified assignments."}</p><a href="/api/session/login?returnTo=%2Fcollege-records">Sign in to college portal</a>{recordMode === "demo" ? <p>Demonstration identities cannot access actual college records.</p> : null}</main>;
  if (!api.data) return <main className="loading-page"><h1>College source records</h1>{api.error ? <Notice error>{api.error}</Notice> : <p role="status">Loading your authorized records…</p>}<button onClick={() => void api.refresh()}>Retry</button><a href="/">Return to portal</a></main>;
  const data = api.data, student = data.students.find(s => s.id === selected) ?? data.students[0];
  return <Workspace portal={portal} sections={["College records", "Portal home"]} current="College records" onNavigate={section => { if (section === "Portal home") router.push("/"); }} onSignOut={() => void api.signOut()} recordMode={recordMode}>
    <PageTitle title="College source records" description="Recorded values with their source references. Definitions and reporting periods remain unknown." />
    {recordMode === "project" ? data.unknowns.length ? <p className="muted source-notes">Source notes: {data.unknowns.join("; ")}.</p> : null : <Notice>Risk: unknown. Support publication is blocked. Missing: {data.unknowns.join("; ")}.</Notice>}
    {portal === "lms" ? <Notice>These academic exports do not establish LMS registration, lesson activity or submitted coursework.</Notice> : null}
    <p>{data.counts.students} authorized {data.counts.students === 1 ? "student" : "students"} · {data.counts.sources} assigned {data.counts.sources === 1 ? "source" : "sources"}.</p>
    {data.privacy === "authenticated_aggregate" ? <p>{recordMode === "project" ? "This view summarizes source readiness. Individual student records are not shown." : "AI operators receive aggregate source readiness. Individual student data is not included in this view."}</p> : <>
      {data.students.length > 1 ? <label className="source-picker">Student<select value={student?.id ?? ""} onChange={event => setSelected(event.target.value)}>{data.students.map(s => <option key={s.id} value={s.id}>{s.name} · {s.srn}</option>)}</select></label> : null}
      {student ? <section><h2>{student.name}</h2><p>{student.srn}</p>{student.reports.map(report => { const source = data.sources.find(s => s.id === report.sourceId); return <article key={report.sourceId}><h3>Semester {report.semester} · {report.section}</h3><p>{source?.filename} · Reporting period unknown</p><div className="table-wrap" tabIndex={0} role="region" aria-label="Recorded source fields"><table><thead><tr><th>Course</th><th>Field</th><th>Recorded value</th><th>Source cell</th></tr></thead><tbody>{report.cells.map(cell => <tr key={cell.sourceCell}><td>{cell.course}</td><td>{cell.field}</td><td>{String(cell.rawValue) || "Blank"}</td><td>{source?.sheet}!{cell.sourceCell}</td></tr>)}</tbody></table></div></article>; })}</section> : <p>No source rows are assigned to this account.</p>}
    </>}
  </Workspace>;
}
