import { expect, type Page } from "@playwright/test";
export const sites = {
  student: process.env.STUDENT_PORTAL_URL ?? "http://127.0.0.1:3101",
  parent: process.env.PARENT_PORTAL_URL ?? "http://127.0.0.1:3102",
  faculty: process.env.FACULTY_PORTAL_URL ?? "http://127.0.0.1:3103",
  hod: process.env.HOD_PORTAL_URL ?? "http://127.0.0.1:3104",
  governance: process.env.GOVERNANCE_PORTAL_URL ?? "http://127.0.0.1:3105",
  lms: process.env.LMS_PORTAL_URL ?? "http://127.0.0.1:3106",
};
const names = {
  student: "Ananya Rao",
  parent: "Lakshmi Rao",
  faculty: "Dr Mira Sen",
  hod: "Dr Sahana Krishnan",
  governance: "AURA Governance Operator",
  lms: "Ananya Rao",
};
export async function enter(
  page: Page,
  portal: keyof typeof sites,
  name = names[portal],
) {
  await page.goto(sites[portal]);
  if (
    await page
      .getByRole("button", { name: "Sign out", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("link", {
      name: portal === "lms" ? "Open LMS" : "Open portal",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: `Continue as ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Portal sections", exact: true }),
  ).toBeVisible();
}
export async function post(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const overview = await fetch("/api/bff/experience/overview", {
        cache: "no-store",
      });
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": overview.headers.get("x-csrf-token") ?? "",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body },
  );
}
