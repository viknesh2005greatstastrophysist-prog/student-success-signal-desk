import { test, expect } from "@playwright/test";
import { enter } from "./helpers";
test("review starts with current records, awaits mentor, and confirmed support reaches student", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_REBUILD_MUTATIONS !== "1",
    "Enable explicitly on a prepared synthetic environment",
  );
  const context = await browser.newContext();
  const faculty = await context.newPage(),
    student = await context.newPage(),
    hod = await context.newPage();
  await enter(faculty, "faculty");
  await faculty
    .getByRole("button", { name: "Support & follow-ups", exact: true })
    .click();
  await faculty
    .getByRole("button", { name: "Start review", exact: true })
    .click();
  await faculty
    .getByRole("button", { name: "Start student review", exact: true })
    .click();
  await faculty
    .getByRole("checkbox", { name: "Ananya Rao · SYN-CSE-001", exact: true })
    .check();
  await faculty
    .getByRole("button", { name: "Start review", exact: true })
    .last()
    .click();
  await expect(
    faculty.getByText("Waiting for mentor", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect(
    faculty.getByText("Suggestion method: Rules with validation", {
      exact: true,
    }),
  ).toBeVisible();
  await faculty
    .getByRole("button", { name: "Suggestions", exact: true })
    .click();
  await faculty
    .getByRole("button", { name: "Review suggestion", exact: true })
    .first()
    .click();
  await faculty
    .getByLabel("Reason for this change", { exact: true })
    .fill(
      "The assigned mentor reviewed the evidence and confirmed these support steps",
    );
  await faculty
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await expect(
    faculty.getByText("Support plan confirmed and shared with the student.", {
      exact: true,
    }),
  ).toBeVisible();
  await enter(student, "student");
  await student
    .getByRole("button", { name: "My support plan", exact: true })
    .click();
  await expect(student.locator(".prose").first()).toContainText(
    "Mentor review requested",
  );
  await enter(hod, "hod");
  await expect(hod.locator("#workspace-main")).not.toContainText("Ananya Rao");
  await hod.getByRole("button", { name: "AI activity", exact: true }).click();
  await hod
    .getByRole("button", { name: "View review", exact: true })
    .first()
    .click();
  await hod
    .getByRole("button", { name: "View recorded evidence", exact: true })
    .click();
  await expect(hod.locator("pre")).toContainText("lms");
  await expect(hod.locator("pre")).toContainText("internship");
  await hod.screenshot({
    path: testInfo.outputPath("review-evidence.png"),
    fullPage: true,
  });
  await context.close();
});
