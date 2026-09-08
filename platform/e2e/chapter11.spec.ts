import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

const sites = {
  faculty: process.env.FACULTY_PORTAL_URL ?? "http://127.0.0.1:3103",
  governance: process.env.GOVERNANCE_PORTAL_URL ?? "http://127.0.0.1:3105",
  student: process.env.STUDENT_PORTAL_URL ?? "http://127.0.0.1:3101",
  parent: process.env.PARENT_PORTAL_URL ?? "http://127.0.0.1:3102",
};
async function enter(page: Page, role: keyof typeof sites) {
  await page.goto(sites[role]);
  await page.getByRole("link", { name: /Enter as/i }).click();
  await page.getByRole("button", { name: /Enter portal/i }).click();
  await expect(page.locator(".revision-strip")).toBeVisible();
}
async function post(page: Page, path: string, body: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const snapshot = await fetch("/api/bff/dashboard", { cache: "no-store" });
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": snapshot.headers.get("x-csrf-token") ?? "", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}

test("Chapter 11 through the browser: plan, four sources, model, mentor approval, cross-session publication and rollback", async ({ browser }, testInfo) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const [faculty, governance, student, parent] = await Promise.all(contexts.map(c => c.newPage()));
  const errors: string[] = [];
  for (const page of [faculty!, governance!, student!, parent!]) page.on("pageerror", e => errors.push(e.message));
  await enter(governance!, "governance");
  const reset = await post(governance!, "/api/bff/governance/simulation/reset", { confirmation: "AURA-SYNTHETIC-SEED-V1" });
  expect(reset.status).toBe(201);
  await governance!.reload();
  await governance!.locator('[data-action-id="governance-ch11-seed"]').click();
  await expect(governance!.locator(".ch11-message")).toContainText("Saved");
  await enter(faculty!, "faculty");
  await faculty!.getByRole("button", { name: "Cases", exact: true }).click();
  await faculty!.locator('[data-action-id="faculty-ch11-policy-open"]').click();
  await faculty!.locator('[data-action-id="faculty-ch11-policy-reason"]').fill("Synthetic mentor approves the demonstration methodology for this acceptance run");
  await faculty!.locator('[data-action-id="faculty-ch11-policy-approve"]').click();
  await expect(faculty!.locator(".ch11-message")).toContainText("Saved");
  await faculty!.locator('[data-action-id="faculty-ch11-save"]').click();
  await expect(faculty!.locator(".ch11-questions li")).toHaveCount(3);
  await faculty!.locator('[data-action-id="faculty-ch11-domain"]').selectOption("academic");
  await faculty!.locator('[data-action-id="faculty-ch11-policy"]').selectOption({ index: 1 });
  await faculty!.locator('[data-action-id="faculty-ch11-student"]').first().check();
  await faculty!.locator('[data-action-id="faculty-ch11-feedback"]').fill("Review this assigned student using all four signals");
  await faculty!.locator('[data-action-id="faculty-ch11-mode"]').selectOption(process.env.CH11_REQUIRE_MODEL === "1" ? "model" : "deterministic");
  await faculty!.locator('[data-action-id="faculty-ch11-save"]').click();
  await expect(faculty!.locator('[data-action-id="faculty-ch11-lock"]')).toBeVisible();
  await faculty!.locator('[data-action-id="faculty-ch11-lock"]').click();
  await expect(faculty!.locator('[data-action-id="faculty-ch11-execute"]')).toBeVisible();
  const missingCsrf = await faculty!.evaluate(async () => (await fetch("/api/bff/chapter11/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
  expect(missingCsrf).toBe(403);
  await faculty!.locator('[data-action-id="faculty-ch11-execute"]').click();
  await expect(faculty!.locator(".ch11-jobs")).toContainText("awaiting faculty", { timeout: 165000 });
  if (process.env.CH11_REQUIRE_MODEL === "1") await expect(faculty!.locator(".ch11-jobs")).toContainText("Actual execution: model");
  const exportUrl = await faculty!.locator('[data-action-id="faculty-ch11-export"]').getAttribute("href");
  const exported = await faculty!.evaluate(async path => (await fetch(path!)).json(), exportUrl);
  expect(Object.keys(exported.data.jobs[0].checkpoint.evidence).sort()).toEqual(["academic", "internship", "lms", "placement"]);
  expect(exported.data.jobs[0].checkpoint.composed.validation.valid).toBe(true);
  await writeFile(testInfo.outputPath("chapter11-execution.json"), JSON.stringify(exported.data, null, 2));
  await testInfo.attach("chapter11-execution.json", { body: JSON.stringify(exported.data, null, 2), contentType: "application/json" });
  await faculty!.locator('[data-action-id="faculty-enter-support-rationale"]').fill("I checked the frozen evidence and approve this bounded synthetic support plan");
  await faculty!.locator('[data-action-id="faculty-approve-support-artifact"]').click();
  await expect(faculty!.locator(".decision-complete")).toBeVisible();
  await enter(student!, "student");
  await student!.getByRole("button", { name: "Support", exact: true }).click();
  const summary = exported.data.jobs[0].checkpoint.composed.packet.summary;
  await expect(student!.getByText(summary, { exact: true })).toBeVisible();
  await enter(parent!, "parent");
  const parentBefore = await parent!.evaluate(async () => (await (await fetch("/api/bff/dashboard")).json()).data);
  expect(parentBefore.childSupportPlans).toHaveLength(1);
  await faculty!.reload();
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-status"]').selectOption("withdrawn");
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-note"]').fill("Withdraw the published plan to verify reversible mentor governance");
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-save"]').click();
  await expect(faculty!.locator(".ch11-workbench")).toContainText("Withdrawn from viewers");
  await student!.reload();
  await expect(student!.getByText(summary, { exact: true })).toHaveCount(0);
  const parentAfter = await parent!.evaluate(async () => (await (await fetch("/api/bff/dashboard")).json()).data);
  expect(parentAfter.childSupportPlans).toHaveLength(0);
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-status"]').selectOption("planned");
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-note"]').fill("Restore the exact approved plan after successful rollback verification");
  await faculty!.locator('[data-action-id="faculty-ch11-outcome-save"]').click();
  await expect(faculty!.locator(".ch11-workbench")).toContainText("Published to authorized viewers");
  await expect(faculty!.getByRole("button", { name: "Working…", exact: true })).toHaveCount(0);
  for (const width of [390, 768, 1440]) {
    await faculty!.setViewportSize({ width, height: 900 });
    expect(await faculty!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const axe = await new AxeBuilder({ page: faculty! }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter(v => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await faculty!.screenshot({ path: testInfo.outputPath("chapter11-faculty.png"), fullPage: true });
  expect(errors).toEqual([]);
  await Promise.all(contexts.map(c => c.close()));
});
