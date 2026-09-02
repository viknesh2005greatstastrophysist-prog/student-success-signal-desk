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
  await expect(page.getByText("Institution revision", { exact: true })).toBeVisible();
}

test("J01 crosses independent role sessions through the authoritative Core", async ({ browser }) => {
  test.skip(!process.env.DEMO_ACCESS_PIN, "DEMO_ACCESS_PIN is required");
  const context = await browser.newContext();
  const hod = await context.newPage();
  const student = await context.newPage();
  const faculty = await context.newPage();
  const parent = await context.newPage();
  const governance = await context.newPage();

  await enterPortal(hod, "hod");
  await expect(hod.getByRole("button", { name: /Publish \+ assign/i })).toBeEnabled();
  await hod.getByRole("button", { name: /Publish \+ assign/i }).click();
  await expect(hod.getByText(/Published\. Every authorized portal/i)).toBeVisible();
  await expect(hod.getByRole("button", { name: "Published" })).toBeDisabled();

  await enterPortal(student, "student");
  await expect(student.getByText("published", { exact: true }).first()).toBeVisible();
  await expect(student.getByText(/HOD has published this offering/i)).toBeVisible();

  await enterPortal(faculty, "faculty");
  await expect(faculty.getByText(/CS401 Agentic AI Systems/i)).toBeVisible();
  await expect(faculty.getByText("ready", { exact: true })).toBeVisible();

  await enterPortal(parent, "parent");
  await expect(parent.getByText("Ananya Rao", { exact: true })).toBeVisible();
  await expect(parent.getByText("4", { exact: true })).toBeVisible();

  await enterPortal(governance, "governance");
  await expect(governance.getByText(/Offering published and faculty assigned/i)).toBeVisible();
  await expect(governance.getByText("NONE", { exact: true })).toBeVisible();

  await parent.getByTitle("Sign out").click();
  await expect(parent.getByRole("link", { name: /Enter as/i })).toBeVisible();
  await student.getByRole("button", { name: "Refresh portal data" }).click();
  await expect(student.getByText(/Good morning/i)).toBeVisible();

  await expect(student.locator('a[href="#"]')).toHaveCount(0);
  await expect(parent.locator('a[href="#"]')).toHaveCount(0);
  await expect(faculty.locator('a[href="#"]')).toHaveCount(0);
  await expect(hod.locator('a[href="#"]')).toHaveCount(0);
  await expect(governance.locator('a[href="#"]')).toHaveCount(0);

  await context.close();
});
