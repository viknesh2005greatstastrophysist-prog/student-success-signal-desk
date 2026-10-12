/* Source strings are always inserted as text, never interpreted as HTML. */
const element = (id) => document.getElementById(id);
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const format = (number) => new Intl.NumberFormat("en-IN").format(number);
const reportLabel = (report) => `Semester ${report.semester} · Section ${report.section.replace(/^section\s+/i, "")}`;
let data, page = 0, lastStudent = "";
const size = 25;

function filteredStudents() {
  const source = element("report").value, search = element("search").value.trim().toLocaleLowerCase();
  return data.students.filter(student => (!source || student.reports.some(r => r.sourceId === source)) &&
    (!search || [student.name, student.srn, student.displayId, ...student.reports.map(r => r.nameAsRecorded)].some(value => value.toLocaleLowerCase().includes(search))));
}

function renderStudents() {
  const students = filteredStudents(), pages = Math.max(1, Math.ceil(students.length / size));
  page = Math.min(page, pages - 1);
  const start = page * size, rows = element("students");
  rows.replaceChildren();
  for (const student of students.slice(start, start + size)) {
    const row = node("tr"), name = node("td");
    name.append(node("b", student.name)); row.append(name, node("td", student.srn));
    row.append(node("td", student.reports.map(report => `${reportLabel(report)}${data.sources.find(source => source.id === report.sourceId)?.reportType ? " · CIE" : ""}`).join("; ")));
    const action = node("td"), button = node("button", "View record");
    button.dataset.student = student.id;
    button.setAttribute("aria-label", `View record for ${student.name}`);
    button.addEventListener("click", () => showStudent(student));
    action.append(button); row.append(action); rows.append(row);
  }
  if (!students.length) { const row = node("tr"), cell = node("td", "No students match. Try another name, SRN or report."); cell.colSpan = 4; row.append(cell); rows.append(row); }
  element("results").textContent = students.length ? `${format(students.length)} ${students.length === 1 ? "student" : "students"} · Showing ${start + 1}–${Math.min(start + size, students.length)}` : "0 students found";
  element("page").textContent = `Page ${page + 1} of ${pages}`;
  element("previous").disabled = page === 0; element("next").disabled = page + 1 >= pages;
}

function showStudent(student) {
  lastStudent = student.id;
  element("directory").hidden = true; element("student").hidden = false;
  element("student-name").textContent = student.name;
  element("student-srn").textContent = `SRN ${student.srn} · ${student.reports.length} ${student.reports.length === 1 ? "report" : "reports"}`;
  const target = element("student-reports"); target.replaceChildren();
  for (const report of student.reports) {
    const source = data.sources.find(s => s.id === report.sourceId), section = node("article", undefined, "source");
    section.append(node("h3", `${reportLabel(report)}${source.reportType ? ` · ${source.reportType}` : ""}`), node("p", `${source.filename} · Reporting period unconfirmed`));
    if (report.nameAsRecorded !== student.name) section.append(node("p", `Name in this report: ${report.nameAsRecorded}`));
    const wrap = node("div", undefined, "table-wrap"); wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", `${reportLabel(report)} course records`);
    const table = node("table"), head = node("thead"), titles = node("tr");
    for (const title of ["Course / batch", "Field", "Recorded value", "Source cell"]) { const th = node("th", title); th.scope = "col"; titles.append(th); }
    head.append(titles); table.append(head); const body = node("tbody");
    for (const course of report.courses) {
      const row = node("tr"); row.append(node("td", course.course), node("td", course.field), node("td", course.kind === "blank" ? "Blank" : String(course.value)), node("td", `${source.sheet || "Full_Attendance"}!${course.cell}`)); body.append(row);
    }
    table.append(body); wrap.append(table); section.append(wrap);
    const details = node("details"); details.append(node("summary", "Check the source"), node("p", `${source.institution} · ${source.department}`), node("p", `Report date field: ${source.reportedDateRange}. Student row: ${report.sourceRow}.`), node("p", "Original file fingerprint (SHA-256):"), node("code", source.id));
    section.append(details); target.append(section);
    if (source.legend) {
      const legend = node("details"); legend.append(node("summary", "Course titles and credits in this report"));
      for (const course of source.legend) legend.append(node("p", `${course.course}: ${course.title} · ${course.credits} credits`));
      section.append(legend);
    }
  }
  element("student-name").focus();
}

element("search").addEventListener("input", () => { page = 0; renderStudents(); });
element("report").addEventListener("change", () => { page = 0; renderStudents(); });
element("previous").addEventListener("click", () => { page--; renderStudents(); });
element("next").addEventListener("click", () => { page++; renderStudents(); });
element("back").addEventListener("click", () => {
  element("student").hidden = true; element("directory").hidden = false;
  document.querySelector(`[data-student="${lastStudent}"]`)?.focus();
});

async function load() {
  try {
    const response = await fetch("/api/review", { cache: "no-store" });
    if (!response.ok) throw new Error("Import unavailable");
    data = await response.json();
    for (const [value, label] of [[data.students.length, "Students"], [data.sources.length, "College reports"], [data.recordedValues ?? data.summary.attendanceCells, "Recorded values"]]) {
      const metric = node("div", undefined, "metric"); metric.append(node("strong", format(value)), node("span", label)); element("metrics").append(metric);
    }
    for (const source of data.sources) { const option = node("option", `${reportLabel(source)}${source.reportType ? ` · ${source.reportType}` : ""} · ${source.students} rows`); option.value = source.id; element("report").append(option); }
    element("permission").textContent = `Local use of these records was authorized by the project owner on ${data.permission.confirmedOn}. The meanings and dates remain unconfirmed.`;
    element("loading").hidden = true; element("content").hidden = false; renderStudents();
    if (data.workflowAvailable) { element("workspace-nav").hidden = false; await refreshWorkflow(); }
  } catch {
    element("loading").textContent = "The college records could not be loaded. Keep the local review running, then reload this page.";
  }
}
void load();

let workflowData, workflowRun = "", workflowPage = 0, workflowDetail, taskOrder = [], processing = false;
const statusLabel = { queued: "Queued", processing: "Processing", awaiting_review: "Awaiting local review", approved: "Accepted clarification checklist", rejected: "Returned for review", withdrawn: "Withdrawn checklist", failed: "Failed" };
async function workflowApi(path = "", body) {
  const response = await fetch(`/api/workflow${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-CSRF": workflowData.csrf }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "REQUEST_FAILED");
  return result;
}
function announceWorkflowError(error) { element("workflow-status").textContent = `Action stopped: ${error.message}. Refresh status before retrying.`; }
async function refreshWorkflow() {
  workflowData = await workflowApi();
  if (!workflowRun || !workflowData.runs.some(run => run.id === workflowRun)) workflowRun = workflowData.runs[0]?.id || "";
  const jobs = workflowData.jobs.filter(job => job.run_id === workflowRun), totals = {};
  for (const job of jobs) totals[job.state] = (totals[job.state] || 0) + 1;
  element("workflow-status").textContent = workflowRun ? `${jobs.length} students: ${Object.entries(totals).map(([key, total]) => `${total} ${statusLabel[key].toLowerCase()}`).join("; ")}.` : "No run yet. Prepare the cohort to create source-linked review packets.";
  element("workflow-method").textContent = `Configured local model: ${workflowData.model || "none"}. Validated task orders are reused for matching question profiles. Actual method and fallback are recorded in each case.`;
  element("workflow-audit").textContent = `Saved audit: ${workflowData.audit.valid ? "hash chain verified" : "verification failed"}; ${workflowData.audit.events} events. Local operator role; actual mentor unknown.`;
  element("workflow-continue").disabled = !workflowRun || processing; element("workflow-pause").disabled = !workflowRun;
  if (!workflowData.model) element("workflow-mode").value = "deterministic";
  renderWorkflowQueue();
}
function renderWorkflowQueue() {
  const search = element("workflow-search").value.trim().toLocaleLowerCase(), filter = element("workflow-filter").value;
  const jobs = workflowData.jobs.filter(job => job.run_id === workflowRun && (!filter || job.state === filter)).filter(job => {
    const student = data.students.find(s => s.id === job.student_id);
    return !search || [student.name, student.srn].some(value => value.toLocaleLowerCase().includes(search));
  });
  const pages = Math.max(1, Math.ceil(jobs.length / size)); workflowPage = Math.min(workflowPage, pages - 1);
  const target = element("workflow-jobs"); target.replaceChildren();
  for (const job of jobs.slice(workflowPage * size, (workflowPage + 1) * size)) {
    const student = data.students.find(s => s.id === job.student_id), row = node("tr"), action = node("td"), button = node("button", job.state === "failed" ? "Inspect failure" : "Review checklist");
    button.addEventListener("click", () => openWorkflowCase(job.student_id).catch(announceWorkflowError));
    row.append(node("td", student.name), node("td", statusLabel[job.state]), node("td", job.stage.replaceAll("_", " "))); action.append(button); row.append(action); target.append(row);
  }
  if (!jobs.length) { const row = node("tr"), cell = node("td", "No matching checklists."); cell.colSpan = 4; row.append(cell); target.append(row); }
  element("workflow-results").textContent = `${jobs.length} matching checklists. Student risk remains unknown.`;
  element("workflow-page").textContent = `Page ${workflowPage + 1} of ${pages}`;
  element("workflow-previous").disabled = workflowPage === 0; element("workflow-next").disabled = workflowPage + 1 >= pages;
}
async function processWorkflow() {
  if (processing || !workflowRun) return;
  processing = true; element("workflow-continue").disabled = true;
  try {
    while (processing) {
      const result = await workflowApi(`/runs/${workflowRun}/advance`, {});
      await refreshWorkflow();
      if (!result.processed || result.paused || !workflowData.jobs.some(job => job.run_id === workflowRun && ["queued", "processing"].includes(job.state))) break;
    }
  } finally { processing = false; element("workflow-continue").disabled = !workflowRun; }
}
async function openWorkflowCase(studentId) {
  workflowDetail = await workflowApi(`/runs/${workflowRun}/cases/${studentId}`);
  const student = data.students.find(s => s.id === studentId), packet = workflowDetail.packet;
  element("workflow-case").hidden = false; element("workflow-case-heading").textContent = `${student.name}: clarification checklist`;
  element("workflow-case-status").textContent = `${statusLabel[workflowDetail.state]} · Version ${workflowDetail.revision}${workflowDetail.error_code ? ` · ${workflowDetail.error_code}` : ""}`;
  const ordering = workflowDetail.checkpoint.ordering;
  element("workflow-case-method").textContent = ordering ? `Actual suggestion method: ${ordering.method === "local_model" ? `local model ${ordering.modelId}` : "deterministic rules"}. ${ordering.fallback ? "Model fallback was used." : ""} ${ordering.reusedProfile ? "Previously validated question-profile order reused." : ""}` : "Collection has not produced a validated packet yet.";
  element("workflow-unknowns").textContent = packet ? `Unknown: ${packet.unknowns.join("; ")}.` : "Required definitions and linked sources remain unknown.";
  element("workflow-facts").replaceChildren();
  for (const fact of packet?.facts || []) { const item = node("li", fact.statement); item.append(node("code", fact.ref)); element("workflow-facts").append(item); }
  taskOrder = packet?.tasks.map(task => ({ ...task })) || []; renderTaskOrder();
  element("workflow-task-code").replaceChildren();
  for (const task of packet?.tasks || []) { const option = node("option", task.label); option.value = task.code; element("workflow-task-code").append(option); }
  element("workflow-events").replaceChildren();
  for (const event of workflowDetail.events) element("workflow-events").append(node("li", `${event.created_at} · ${event.kind} · ${event.actor}`));
  element("workflow-edit").disabled = !packet; element("workflow-approve").disabled = workflowDetail.state !== "awaiting_review";
  element("workflow-reject").disabled = workflowDetail.state !== "awaiting_review"; element("workflow-withdraw").disabled = workflowDetail.state !== "approved";
  element("workflow-restore").disabled = workflowDetail.state !== "withdrawn"; element("workflow-retry").disabled = workflowDetail.state !== "failed";
  element("workflow-followup").disabled = workflowDetail.state !== "approved";
  element("workflow-replay").disabled = !packet; element("workflow-export").disabled = !packet;
  element("workflow-note").value = ""; element("workflow-case-heading").focus();
}
function renderTaskOrder() {
  const target = element("workflow-tasks"); target.replaceChildren();
  taskOrder.forEach((task, index) => { const item = node("li", task.label), button = node("button", "Move up"); button.disabled = index === 0;
    button.setAttribute("aria-label", `Move up: ${task.label}`); button.addEventListener("click", () => { [taskOrder[index - 1], taskOrder[index]] = [taskOrder[index], taskOrder[index - 1]]; renderTaskOrder(); });
    item.append(button); target.append(item); });
}
async function caseAction(action, extra = {}) {
  const note = element("workflow-note").value.trim();
  if (note.length < 8) { element("workflow-action-status").textContent = "Add a review note of at least eight characters."; element("workflow-note").focus(); return; }
  const studentId = workflowDetail.student_id;
  const result = await workflowApi(`/runs/${workflowRun}/cases/${studentId}/${action}`, { commandId: crypto.randomUUID(), expectedRevision: workflowDetail.revision, note, ...extra });
  await refreshWorkflow(); await openWorkflowCase(studentId);
  element("workflow-action-status").textContent = `Saved ${action.replaceAll("_", " ")}. ${result.sourceDefinitionsChanged === false ? "Source meanings are unchanged." : "Student publication remains blocked."}`;
}
element("show-records").addEventListener("click", () => { element("workflow").hidden = true; element("student").hidden = true; element("directory").hidden = false; });
element("show-workflow").addEventListener("click", () => { element("directory").hidden = true; element("student").hidden = true; element("workflow").hidden = false; element("workflow-heading").focus(); refreshWorkflow().catch(announceWorkflowError); });
element("workflow-start").addEventListener("click", async () => { element("workflow-start").disabled = true; try { const run = await workflowApi("/runs", { mode: element("workflow-mode").value, commandId: crypto.randomUUID() }); workflowRun = run.runId; workflowPage = 0; element("workflow-case").hidden = true; await refreshWorkflow(); await processWorkflow(); } catch (error) { announceWorkflowError(error); } finally { element("workflow-start").disabled = false; } });
element("workflow-continue").addEventListener("click", async () => { try { await workflowApi(`/runs/${workflowRun}/pause`, { paused: false, commandId: crypto.randomUUID() }); await processWorkflow(); } catch (error) { announceWorkflowError(error); } });
element("workflow-pause").addEventListener("click", async () => { processing = false; try { await workflowApi(`/runs/${workflowRun}/pause`, { paused: true, commandId: crypto.randomUUID() }); await refreshWorkflow(); } catch (error) { announceWorkflowError(error); } });
element("workflow-refresh").addEventListener("click", () => refreshWorkflow().catch(announceWorkflowError));
for (const id of ["workflow-search", "workflow-filter"]) element(id).addEventListener(id.endsWith("search") ? "input" : "change", () => { workflowPage = 0; renderWorkflowQueue(); });
element("workflow-next").addEventListener("click", () => { workflowPage++; renderWorkflowQueue(); }); element("workflow-previous").addEventListener("click", () => { workflowPage--; renderWorkflowQueue(); });
for (const action of ["approve", "reject", "withdraw", "restore"]) element(`workflow-${action}`).addEventListener("click", () => caseAction(action).catch(announceWorkflowError));
element("workflow-edit").addEventListener("click", () => caseAction("edit", { taskCodes: taskOrder.map(task => task.code) }).catch(announceWorkflowError));
element("workflow-record-followup").addEventListener("click", () => caseAction("followup", { taskCode: element("workflow-task-code").value, status: element("workflow-task-status").value }).catch(announceWorkflowError));
element("workflow-retry").addEventListener("click", async () => { try { await workflowApi(`/runs/${workflowRun}/cases/${workflowDetail.student_id}/retry`, { commandId: crypto.randomUUID() }); await processWorkflow(); await openWorkflowCase(workflowDetail.student_id); } catch (error) { announceWorkflowError(error); } });
element("workflow-replay").addEventListener("click", async () => { try { const result = await workflowApi(`/runs/${workflowRun}/cases/${workflowDetail.student_id}/replay`, {}); element("workflow-action-status").textContent = result.valid ? "Replay verified: source snapshot, saved versions and audit hashes agree. No model regeneration was claimed." : "Replay verification failed."; } catch (error) { announceWorkflowError(error); } });
element("workflow-export").addEventListener("click", () => { const link = node("a"); link.href = `/api/workflow/runs/${workflowRun}/cases/${workflowDetail.student_id}/export`; link.download = "private-college-case.json"; link.click(); });
