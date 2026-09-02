import { expect, test, type Page } from "@playwright/test";

const sites = {
  student: "https://aura-student-portal.vercel.app",
  parent: "https://aura-parent-portal.vercel.app",
  faculty: "https://aura-faculty-portal.vercel.app",
  hod: "https://aura-hod-portal.vercel.app",
  governance: "https://aura-ai-governance.vercel.app",
} as const;

async function enterPortal(page: Page, portal: keyof typeof sites) {
  await page.goto(sites[portal]);
  await page.getByRole("link", { name: /Enter as/i }).click();
  await expect(page).toHaveURL(/aura-identity-service\.vercel\.app\/sign-in/);
  await page.getByLabel("Demo access PIN").fill(process.env.DEMO_ACCESS_PIN ?? "");
  await page.getByRole("button", { name: /Enter portal/i }).click();
  await expect(page).toHaveURL(new RegExp(`^${sites[portal].replaceAll(".", "\\.")}/?$`));
  await expect(page.locator(".revision-strip > span")).toHaveText("Institution revision");
}

test("J01-J06 cross independent role sessions through the authoritative Core", async ({ browser }) => {
  test.skip(!process.env.DEMO_ACCESS_PIN, "DEMO_ACCESS_PIN is required");
  const context = await browser.newContext();
  const hod = await context.newPage();
  const student = await context.newPage();
  const faculty = await context.newPage();
  const parent = await context.newPage();
  const governance = await context.newPage();

  await enterPortal(hod, "hod");
  await hod.getByLabel("Assign faculty").selectOption({ label: "Dr Mira Sen" });
  await expect(hod.getByRole("button", { name: /Publish \+ assign/i })).toBeEnabled();
  await hod.getByRole("button", { name: /Publish \+ assign/i }).click();
  await expect(hod.getByText(/Published\. Every authorized portal/i)).toBeVisible();
  await expect(hod.getByRole("button", { name: "Published" })).toBeDisabled();

  await enterPortal(student, "student");
  await expect(student.getByText("published", { exact: true }).first()).toBeVisible();
  await expect(student.getByText(/HOD has published this offering/i)).toBeVisible();
  await student.getByRole("button", { name: "Registration", exact: true }).click();
  const registrationRow = student.locator('[data-course="CS401"]');
  await registrationRow.getByRole("button", { name: "Register", exact: true }).click();
  await registrationRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(student.getByText(/Registered\. Receipt/i)).toBeVisible();
  await expect(registrationRow.getByText("Active registration", { exact: true })).toBeVisible();

  await enterPortal(faculty, "faculty");
  await expect(faculty.getByText(/CS401 Agentic AI Systems/i)).toBeVisible();
  await expect(faculty.getByText("ready", { exact: true })).toBeVisible();
  await faculty.getByRole("button", { name: "Classrooms", exact: true }).click();
  await expect(faculty.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await faculty.getByRole("button", { name: "Submit attendance", exact: true }).click();
  await expect(faculty.getByText(/Attendance submitted\. Receipt/i)).toBeVisible();
  await faculty.getByRole("button", { name: "Gradebook", exact: true }).click();
  await faculty.getByRole("button", { name: "Publish marks", exact: true }).click();
  await expect(faculty.getByText(/Marks published\. Receipt/i)).toBeVisible();

  await hod.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(hod.getByText(/1 enrolled/i)).toBeVisible();
  await expect(hod.locator(".hod-academic-strip article").nth(0)).toContainText("2");
  await expect(hod.locator(".hod-academic-strip article").nth(1)).toContainText("2");

  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await student.getByRole("button", { name: "Academics", exact: true }).click();
  await expect(student.getByText("Agent workflow design", { exact: true })).toBeVisible();
  await expect(student.getByText("Agent design review", { exact: true })).toBeVisible();

  await enterPortal(parent, "parent");
  await expect(parent.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await expect(parent.locator(".grant-count")).toContainText("4");
  await parent.getByRole("button", { name: "Children", exact: true }).click();
  await expect(parent.getByText("Agent workflow design", { exact: true })).toBeVisible();
  await expect(parent.getByText("Agent design review", { exact: true })).toBeVisible();
  await parent.getByRole("button", { name: "Fees", exact: true }).click();
  await parent.getByLabel("Sandbox outcome").selectOption("decline");
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

  await hod.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(hod.getByText("Outstanding fees", { exact: true })).toBeVisible();
  await expect(hod.getByText("₹0", { exact: true })).toBeVisible();

  await student.getByRole("button", { name: "Account", exact: true }).click();
  const marksGrant = student.locator('[data-grant="marks"]');
  await marksGrant.getByRole("button", { name: "Revoke access", exact: true }).click();
  await marksGrant.getByRole("button", { name: "Confirm revoke", exact: true }).click();
  await expect(student.getByText(/marks access revoked\. Receipt/i)).toBeVisible();
  await parent.getByRole("button", { name: "Refresh portal data" }).click();
  await parent.getByRole("button", { name: "Children", exact: true }).click();
  await expect(parent.getByText("Marks access is not granted.", { exact: true })).toBeVisible();
  await expect(parent.getByText("Agent design review", { exact: true })).toHaveCount(0);

  await enterPortal(governance, "governance");
  await expect(governance.getByText(/Offering published and faculty assigned/i)).toBeVisible();
  await expect(governance.getByText(/Student registered and roster updated/i)).toBeVisible();
  await expect(governance.getByText(/Faculty submitted the attendance register/i)).toBeVisible();
  await expect(governance.getByText(/Faculty published assessed marks/i)).toBeVisible();
  await expect(governance.getByText(/Parent completed a sandbox payment/i)).toBeVisible();
  await expect(governance.getByText(/Sandbox payment attempt was declined/i)).toBeVisible();
  await expect(governance.getByText(/Student revoked a parent field grant/i)).toBeVisible();
  await expect(governance.getByText("NONE", { exact: true })).toBeVisible();

  await parent.getByTitle("Sign out").click();
  await expect(parent.getByRole("link", { name: /Enter as/i })).toBeVisible();
  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(student.getByTitle("Sign out")).toBeVisible();
  await expect(student.getByText("Agent design review", { exact: true })).toBeVisible();

  await expect(student.locator('a[href="#"]')).toHaveCount(0);
  await expect(parent.locator('a[href="#"]')).toHaveCount(0);
  await expect(faculty.locator('a[href="#"]')).toHaveCount(0);
  await expect(hod.locator('a[href="#"]')).toHaveCount(0);
  await expect(governance.locator('a[href="#"]')).toHaveCount(0);

  await context.close();
});
