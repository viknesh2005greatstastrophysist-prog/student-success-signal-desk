import { expect, test, type Page } from "@playwright/test";

const sites = {
  student: process.env.STUDENT_PORTAL_URL ?? "https://aura-student-portal.vercel.app",
  parent: process.env.PARENT_PORTAL_URL ?? "https://aura-parent-portal.vercel.app",
  faculty: process.env.FACULTY_PORTAL_URL ?? "https://aura-faculty-portal.vercel.app",
  hod: process.env.HOD_PORTAL_URL ?? "https://aura-hod-portal.vercel.app",
  governance: process.env.GOVERNANCE_PORTAL_URL ?? "https://aura-ai-governance.vercel.app",
} as const;
const identityUrl = process.env.IDENTITY_URL ?? "https://aura-identity-service.vercel.app";
function regexEscape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function enterPortal(page: Page, portal: keyof typeof sites) {
  await page.goto(sites[portal]);
  await page.getByRole("link", { name: /Enter as/i }).click();
  await expect(page).toHaveURL(new RegExp(`^${regexEscape(identityUrl)}/sign-in`));
  await page.getByLabel("Demo access PIN").fill(process.env.DEMO_ACCESS_PIN ?? "");
  await page.getByRole("button", { name: /Enter portal/i }).click();
  await expect(page).toHaveURL(`${sites[portal]}/dashboard`);
  await expect(page.locator(".revision-strip > span")).toHaveText("Institution revision");
  if (process.env.RELEASE_SHA) {
    await expect(page.locator(".portal-footer")).toContainText(`build ${process.env.RELEASE_SHA.slice(0, 8)}`);
  }
}

test("J01-J10 cross independent role sessions through the authoritative Core", async ({ browser }) => {
  test.skip(!process.env.DEMO_ACCESS_PIN, "DEMO_ACCESS_PIN is required");
  const context = await browser.newContext();
  const hod = await context.newPage();
  const student = await context.newPage();
  const faculty = await context.newPage();
  const parent = await context.newPage();
  const governance = await context.newPage();

  await enterPortal(hod, "hod");
  await hod.getByRole("button", { name: "Offerings", exact: true }).click();
  await expect.poll(() => new URL(hod.url()).pathname).toBe("/offerings/current");
  await hod.getByLabel("Assign faculty").selectOption({ label: "Dr Mira Sen" });
  await expect(hod.getByRole("button", { name: /Publish \+ assign/i })).toBeEnabled();
  await hod.getByRole("button", { name: /Publish \+ assign/i }).click();
  await expect(hod.getByText(/Published\. Every authorized portal/i)).toBeVisible();
  await expect(hod.getByRole("button", { name: "Published", exact: true })).toBeDisabled();
  await hod.getByRole("button", { name: "Inspect enrolment", exact: true }).click();
  await expect(hod.getByText("Available", { exact: true })).toBeVisible();
  await hod.getByRole("button", { name: "Close enrolment detail", exact: true }).click();

  await enterPortal(student, "student");
  await expect(student.getByText("published", { exact: true }).first()).toBeVisible();
  await expect(student.getByText(/HOD has published this offering/i)).toBeVisible();
  const csrfToken = await student.evaluate(async () => (await fetch("/api/bff/dashboard", { cache: "no-store" })).headers.get("x-csrf-token"));
  expect(csrfToken).toBeTruthy();
  const missingCsrfStatus = await student.evaluate(async () => (await fetch("/api/bff/registrations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).status);
  expect(missingCsrfStatus).toBe(403);
  const forgedOrigin = await context.request.post(`${sites.student}/api/bff/registrations`, {
    headers: { Origin: "https://attacker.invalid", "X-CSRF-Token": csrfToken!, "Content-Type": "application/json" },
    data: {},
  });
  expect(forgedOrigin.status()).toBe(403);
  await student.getByRole("button", { name: /Open consequence: Offering published and faculty assigned/i }).click();
  await expect.poll(() => new URL(student.url()).pathname).toBe("/registration");
  await student.getByPlaceholder("Code, title, or faculty").fill("CS401");
  await student.getByLabel("Eligibility").selectOption("eligible");
  const registrationRow = student.locator('[data-course="CS401"]');
  await registrationRow.getByRole("button", { name: "Inspect course", exact: true }).click();
  await expect(registrationRow.getByText("Prerequisites", { exact: true })).toBeVisible();
  await registrationRow.getByRole("button", { name: "Close details", exact: true }).click();
  await student.getByLabel("Eligibility").selectOption("all");
  await registrationRow.getByRole("button", { name: "Register", exact: true }).click();
  await registrationRow.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(registrationRow.getByRole("button", { name: "Register", exact: true })).toBeVisible();
  await registrationRow.getByRole("button", { name: "Register", exact: true }).click();
  await registrationRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(student.getByText(/Registered\. Receipt/i)).toBeVisible();
  await expect(registrationRow.getByText("Active registration", { exact: true })).toBeVisible();
  await registrationRow.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(student.getByText(/Withdrawn\. Receipt/i)).toBeVisible();
  await expect(registrationRow.getByRole("button", { name: "Register", exact: true })).toBeVisible();
  await registrationRow.getByRole("button", { name: "Register", exact: true }).click();
  await registrationRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(student.getByText(/Registered\. Receipt/i)).toBeVisible();

  await enterPortal(faculty, "faculty");
  await expect(faculty.getByText(/CS401 Agentic AI Systems/i)).toBeVisible();
  await expect(faculty.getByText("ready", { exact: true })).toBeVisible();
  await faculty.getByRole("button", { name: "Open classroom", exact: true }).click();
  await faculty.getByPlaceholder("Name or register number").fill("Ananya");
  await expect(faculty.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await faculty.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(faculty.getByText(/Visible because this faculty member is assigned/i)).toBeVisible();
  await faculty.getByRole("button", { name: "Close", exact: true }).click();
  await faculty.getByLabel("Attendance for Ananya Rao").selectOption("late");
  await faculty.getByRole("button", { name: "Submit attendance", exact: true }).click();
  await expect(faculty.getByText(/Attendance submitted\. Receipt/i)).toBeVisible();
  await faculty.getByRole("button", { name: "Gradebook", exact: true }).click();
  await faculty.getByLabel("Score for Ananya Rao").fill("87");
  await faculty.getByRole("button", { name: "Publish marks", exact: true }).click();
  await expect(faculty.getByText(/Marks published\. Receipt/i)).toBeVisible();

  await hod.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(hod.getByText(/1 enrolled/i)).toBeVisible();
  await expect(hod.locator(".hod-academic-strip article").nth(0)).toContainText("2");
  await expect(hod.locator(".hod-academic-strip article").nth(1)).toContainText("2");

  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await student.getByRole("button", { name: "Academics", exact: true }).click();
  await expect.poll(() => new URL(student.url()).pathname).toBe("/academics");
  await student.reload();
  await expect(student.getByText("Agent workflow design", { exact: true })).toBeVisible();
  await expect(student.getByText("Agent design review", { exact: true })).toBeVisible();
  await expect(student.getByText("late", { exact: true })).toBeVisible();
  await expect(student.locator(".academic-columns strong").filter({ hasText: "87.00/100.00" })).toBeVisible();
  await student.getByLabel("Course").selectOption("CS401");
  await student.locator('[data-action-id="student-inspect-academic-record"]').first().click();
  await expect(student.getByText(/Submitted record/i)).toBeVisible();

  await enterPortal(parent, "parent");
  await expect(parent.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await expect(parent.locator(".grant-count")).toContainText("4");
  await parent.locator('[data-action-id="parent-inspect-grant"]').first().click();
  await expect(parent.getByText(/Core rechecks this field on every request/i)).toBeVisible();
  await parent.getByLabel("Linked student").selectOption({ index: 1 });
  await expect(parent.getByText("Tarun Bose", { exact: true })).toBeVisible();
  await parent.getByLabel("Linked student").selectOption({ index: 0 });
  await expect(parent.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await parent.getByRole("button", { name: "Children", exact: true }).click();
  await parent.getByLabel("Course").selectOption("CS401");
  await expect(parent.getByText("Agent workflow design", { exact: true })).toBeVisible();
  await expect(parent.getByText("Agent design review", { exact: true })).toBeVisible();
  await parent.locator('[data-action-id="parent-inspect-academic-record"]').first().click();
  await expect(parent.getByText(/Granted attendance event/i)).toBeVisible();
  await parent.getByRole("button", { name: "Fees", exact: true }).click();
  await parent.getByLabel("Sandbox outcome").selectOption("decline");
  await parent.getByRole("button", { name: /Pay ₹45,000/i }).click();
  await parent.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(parent.getByRole("button", { name: /Pay ₹45,000/i })).toBeVisible();
  await parent.getByRole("button", { name: /Pay ₹45,000/i }).click();
  await parent.getByRole("button", { name: "Confirm sandbox payment", exact: true }).click();
  await expect(parent.getByText(/Payment declined by the sandbox/i)).toBeVisible();
  await expect(parent.getByText("due", { exact: true })).toBeVisible();
  await parent.getByLabel("Sandbox outcome").selectOption("success");
  await parent.getByRole("button", { name: /Pay ₹45,000/i }).click();
  await parent.getByRole("button", { name: "Confirm sandbox payment", exact: true }).click();
  await expect(parent.getByText(/Payment captured in the sandbox/i)).toBeVisible();
  await expect(parent.getByText("paid", { exact: true }).first()).toBeVisible();
  const [download] = await Promise.all([
    parent.waitForEvent("download"),
    parent.getByRole("link", { name: /Download verified receipt/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^AURA-INV-AURA-2026-001-receipt\.html$/);

  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await student.getByRole("button", { name: "Fees", exact: true }).click();
  await expect(student.getByText("All settled.", { exact: true })).toBeVisible();
  await expect(student.getByText("₹0", { exact: true })).toBeVisible();
  await student.getByRole("button", { name: "Inspect invoice", exact: true }).click();
  await expect(student.getByText("INV-AURA-2026-001", { exact: true })).toBeVisible();
  const [studentReceipt] = await Promise.all([
    student.waitForEvent("download"),
    student.getByRole("link", { name: /Download existing receipt/i }).click(),
  ]);
  expect(studentReceipt.suggestedFilename()).toMatch(/^AURA-INV-AURA-2026-001-receipt\.html$/);

  await hod.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(hod.getByText("Outstanding fees", { exact: true })).toBeVisible();
  await expect(hod.getByText("₹0", { exact: true })).toBeVisible();

  await student.getByRole("button", { name: "Account", exact: true }).click();
  const marksGrant = student.locator('[data-grant="marks"]');
  await marksGrant.getByRole("button", { name: "Inspect boundary", exact: true }).click();
  await expect(marksGrant.getByText(/Core returns this field after every request-time check/i)).toBeVisible();
  await marksGrant.getByRole("button", { name: "Close boundary", exact: true }).click();
  await marksGrant.getByRole("button", { name: "Revoke access", exact: true }).click();
  await marksGrant.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(marksGrant.getByRole("button", { name: "Revoke access", exact: true })).toBeVisible();
  await marksGrant.getByRole("button", { name: "Revoke access", exact: true }).click();
  await marksGrant.getByRole("button", { name: "Confirm revoke", exact: true }).click();
  await expect(student.getByText(/marks access revoked\. Receipt/i)).toBeVisible();
  await parent.getByRole("button", { name: "Refresh portal data" }).click();
  await parent.getByRole("button", { name: "Children", exact: true }).click();
  await expect(parent.getByText("Marks access is not granted.", { exact: true })).toBeVisible();
  await expect(parent.getByText("Agent design review", { exact: true })).toHaveCount(0);

  await enterPortal(governance, "governance");
  await expect(governance.getByText(/Offering published and faculty assigned/i)).toBeVisible();
  await expect(governance.getByText(/Student registered and roster updated/i).first()).toBeVisible();
  await expect(governance.getByText(/Faculty submitted the attendance register/i)).toBeVisible();
  await expect(governance.getByText(/Faculty published assessed marks/i)).toBeVisible();
  await expect(governance.getByText(/Parent completed a sandbox payment/i)).toBeVisible();
  await expect(governance.getByText(/Sandbox payment attempt was declined/i)).toBeVisible();
  await expect(governance.getByText(/Student revoked a parent field grant/i)).toBeVisible();
  await expect(governance.getByText("NONE", { exact: true })).toBeVisible();
  await governance.getByRole("button", { name: "Freeze evidence + process", exact: true }).click();
  await expect(governance.getByText(/Evidence frozen and artifact validated\. Receipt/i)).toBeVisible();
  await governance.getByRole("button", { name: "Open latest governed run", exact: true }).click();
  await governance.getByRole("button", { name: "Inspect run stages", exact: true }).click();
  await expect(governance.locator(".run-stage-grid span").nth(1)).toContainText("Evidence frozen");
  await governance.getByRole("button", { name: "Inspect validation", exact: true }).click();
  await expect(governance.locator(".validation-detail")).toContainText("policyVersion");

  await faculty.getByRole("button", { name: "Refresh portal data" }).click();
  await faculty.getByRole("button", { name: "Cases", exact: true }).click();
  await expect(faculty.getByText(/Offer a bounded academic check-in/i)).toBeVisible();
  await expect(faculty.getByText(/VALID · AURA-SUPPORT-1/i)).toBeVisible();
  await faculty.getByLabel("Decision rationale").fill("The first artifact is declined to verify the governed rejection path.");
  await faculty.getByRole("button", { name: "Reject artifact", exact: true }).click();
  await expect(faculty.getByText(/Support artifact rejected\. Receipt/i)).toBeVisible();

  await governance.getByRole("button", { name: "Refresh portal data" }).click();
  await governance.getByRole("button", { name: "Operations", exact: true }).click();
  await governance.getByRole("button", { name: "Freeze evidence + process", exact: true }).click();
  await expect(governance.getByText(/Evidence frozen and artifact validated\. Receipt/i)).toBeVisible();
  await faculty.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(faculty.getByText(/Offer a bounded academic check-in/i)).toBeVisible();
  await faculty.getByLabel("Decision rationale").fill("The second artifact is proportionate, student-visible, and grounded in the cited evidence.");
  await faculty.getByRole("button", { name: "Approve exact artifact", exact: true }).click();
  await expect(faculty.getByText(/Support artifact approved\. Receipt/i)).toBeVisible();

  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await student.getByRole("button", { name: "Support", exact: true }).click();
  await expect(student.getByText("A plan, not a label.", { exact: true })).toBeVisible();
  await expect(student.getByText(/Schedule one 20-minute academic check-in/i)).toBeVisible();
  await student.getByRole("button", { name: "Inspect plan provenance", exact: true }).click();
  await expect(student.getByText("Student approved", { exact: true })).toBeVisible();
  await student.getByRole("button", { name: "Acknowledge update", exact: true }).click();
  await expect(student.getByRole("button", { name: "Update acknowledged", exact: true })).toBeDisabled();

  await parent.getByRole("button", { name: "Refresh portal data" }).click();
  await parent.getByRole("button", { name: "Children", exact: true }).click();
  await expect(parent.getByText("A plan, not a label.", { exact: true })).toBeVisible();
  await parent.getByRole("button", { name: "Inspect plan provenance", exact: true }).click();
  await expect(parent.getByText("Parent grant checked", { exact: true })).toBeVisible();

  await hod.getByRole("button", { name: "Refresh portal data" }).click();
  await hod.getByRole("button", { name: "Cases", exact: true }).click();
  await expect(hod.getByText("approved", { exact: true })).toBeVisible();
  await hod.getByRole("button", { name: "People", exact: true }).click();
  await hod.getByPlaceholder("Name or register number").fill("Ananya");
  await hod.getByLabel("Cohort").selectOption("students");
  await expect(hod.getByText("SYN-CSE-001", { exact: false })).toBeVisible();
  await hod.getByRole("button", { name: "Inspect profile", exact: true }).click();
  await expect(hod.getByText(/Parent details and credentials are excluded/i)).toBeVisible();
  await hod.getByPlaceholder("Name or register number").fill("Mira");
  await hod.getByLabel("Cohort").selectOption("faculty");
  await expect(hod.getByText("Dr Mira Sen", { exact: true })).toBeVisible();
  await expect(hod.getByText(/SYN-ECE-/)).toHaveCount(0);
  await hod.getByRole("button", { name: "Department", exact: true }).click();
  await expect(hod.getByLabel("Academic term")).toBeDisabled();
  await expect(hod.getByText(/one active term/i)).toBeVisible();

  await governance.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(governance.getByText(/Validated deterministic runs/i)).toBeVisible();
  await expect(governance.getByRole("button", { name: "Compare latest runs", exact: true })).toBeEnabled();
  await governance.getByRole("button", { name: "Compare latest runs", exact: true }).click();
  await expect(governance.locator(".run-comparison article")).toHaveCount(2);
  const replayResponsePromise = governance.waitForResponse((response) => response.request().method() === "POST" && /\/api\/bff\/governance\/runs\/[0-9a-f-]+\/replay$/.test(new URL(response.url()).pathname));
  await governance.getByRole("button", { name: "Replay + verify hashes", exact: true }).click();
  const replayResponse = await replayResponsePromise;
  expect(replayResponse.status(), await replayResponse.text()).toBe(201);
  await expect(governance.getByText(/Replay verified\. Receipt .* zero domain mutations/i)).toBeVisible();
  const [evidenceDownload] = await Promise.all([
    governance.waitForEvent("download"),
    governance.getByRole("link", { name: /Download evidence JSON/i }).click(),
  ]);
  expect(evidenceDownload.suggestedFilename()).toMatch(/^AURA-run-.*-evidence\.json$/);
  await governance.getByRole("button", { name: "Evidence", exact: true }).click();
  await governance.getByPlaceholder("Path or statement").fill("not-a-real-evidence-path");
  await expect(governance.getByText("No citation matches this evidence filter.", { exact: true })).toBeVisible();
  await governance.getByPlaceholder("Path or statement").fill("");
  const [evidencePackage] = await Promise.all([
    governance.waitForEvent("download"),
    governance.getByRole("link", { name: /Export immutable evidence package/i }).click(),
  ]);
  expect(evidencePackage.suggestedFilename()).toMatch(/^AURA-run-.*-evidence\.json$/);

  await parent.getByTitle("Sign out").click();
  await expect(parent.getByRole("link", { name: /Enter as/i })).toBeVisible();
  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(student.getByTitle("Sign out")).toBeVisible();
  await student.getByRole("button", { name: "Academics", exact: true }).click();
  await expect(student.getByText("Agent design review", { exact: true })).toBeVisible();

  await student.route("**/api/bff/dashboard", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { code: "TEST_TRANSIENT", message: "Synthetic transient failure." } }),
  }));
  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(student.getByText("Synthetic transient failure.", { exact: true })).toBeVisible();
  await student.unroute("**/api/bff/dashboard");
  await student.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(student.locator(".revision-strip")).toBeVisible();

  await governance.getByRole("button", { name: "Simulation", exact: true }).click();
  await governance.getByRole("button", { name: "Preview reset effects", exact: true }).click();
  await expect(governance.getByText(/preserve prior audit and evidence rows/i)).toBeVisible();
  const resetButton = governance.getByRole("button", { name: "Reset synthetic ecosystem", exact: true });
  await expect(resetButton).toBeDisabled();
  await governance.getByLabel(/Type AURA-SYNTHETIC-SEED-V1 to confirm/i).fill("AURA-SYNTHETIC-SEED-V1");
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(governance.getByText(/New synthetic generation active/i)).toBeVisible({ timeout: 60_000 });
  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await student.getByRole("button", { name: "Today", exact: true }).click();
  await expect(student.getByText("draft", { exact: true }).first()).toBeVisible();

  for (const page of [student, faculty, hod, governance]) {
    await page.getByTitle("Sign out").click();
    await expect(page.getByRole("link", { name: /Enter as/i })).toBeVisible();
  }

  await expect(student.locator('a[href="#"]')).toHaveCount(0);
  await expect(parent.locator('a[href="#"]')).toHaveCount(0);
  await expect(faculty.locator('a[href="#"]')).toHaveCount(0);
  await expect(hod.locator('a[href="#"]')).toHaveCount(0);
  await expect(governance.locator('a[href="#"]')).toHaveCount(0);

  await context.close();
});
