import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const sites = {
  student: process.env.STUDENT_PORTAL_URL ?? "https://aura-student-portal.vercel.app",
  parent: process.env.PARENT_PORTAL_URL ?? "https://aura-parent-portal.vercel.app",
  faculty: process.env.FACULTY_PORTAL_URL ?? "https://aura-faculty-portal.vercel.app",
  hod: process.env.HOD_PORTAL_URL ?? "https://aura-hod-portal.vercel.app",
  governance: process.env.GOVERNANCE_PORTAL_URL ?? "https://aura-ai-governance.vercel.app",
} as const;
const views = {
  student: ["Today", "Registration", "Academics", "Fees", "Support", "Account"],
  parent: ["Overview", "Children", "Fees", "Access"],
  faculty: ["Today", "Classrooms", "Gradebook", "Cases"],
  hod: ["Department", "Offerings", "People", "Cases"],
  governance: ["Operations", "Runs", "Evidence", "Simulation"],
} as const;
const identityUrl = process.env.IDENTITY_URL ?? "https://aura-identity-service.vercel.app";
function regexEscape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function enterPortal(page: Page, portal: keyof typeof sites) {
  await page.goto(sites[portal]);
  await page.getByRole("link", { name: /Enter as/i }).click();
  await expect(page).toHaveURL(new RegExp(`^${regexEscape(identityUrl)}/sign-in`));
  await page.getByLabel("Demo access PIN").fill(process.env.DEMO_ACCESS_PIN ?? "");
  await page.getByRole("button", { name: /Enter portal/i }).click();
  await expect(page.locator(".revision-strip")).toBeVisible();
}

test("all portal surfaces pass serious accessibility, overflow, and runtime-error gates", async ({ browser }, testInfo) => {
  test.skip(!process.env.DEMO_ACCESS_PIN, "DEMO_ACCESS_PIN is required");
  const context = await browser.newContext();
  const runtimeErrors: string[] = [];

  for (const portal of Object.keys(sites) as Array<keyof typeof sites>) {
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(`${portal}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) runtimeErrors.push(`${portal}: ${message.text()}`);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      const expectedGuestProbe = response.status() === 401 && url.pathname === "/api/bff/dashboard";
      if (response.status() >= 400 && !expectedGuestProbe) runtimeErrors.push(`${portal}: HTTP ${response.status()} ${url.origin}${url.pathname}`);
    });
    await enterPortal(page, portal);

    for (const view of views[portal]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator(".role-surface").first()).toBeVisible();
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const blocking = accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
      expect(blocking, `${portal}/${view} serious accessibility violations`).toEqual([]);
    }

    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (process.env.EVIDENCE_DIR) {
        await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/${portal}-${viewport.width}.png`, fullPage: true });
      }
    }
    await page.close();
  }

  await context.close();
  expect(runtimeErrors, `browser runtime errors in ${testInfo.title}`).toEqual([]);
});
