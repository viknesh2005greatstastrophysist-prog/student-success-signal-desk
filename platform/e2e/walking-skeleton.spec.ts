import { expect, test } from "@playwright/test";
import { enter, post } from "./helpers";
test("registration, faculty attendance and marks, parent payment and receipt", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_REBUILD_MUTATIONS !== "1",
    "Enable explicitly on a prepared synthetic environment",
  );
  const context = await browser.newContext();
  const student = await context.newPage(),
    faculty = await context.newPage(),
    parent = await context.newPage();
  await enter(student, "student");
  await student
    .getByRole("button", { name: "Course registration", exact: true })
    .click();
  const submit = student.getByRole("button", {
    name: "Review selection",
    exact: true,
  });
  if (await submit.isVisible()) {
    await student.getByRole("checkbox", { name: /CS401/ }).check();
    await submit.click();
    await student
      .getByRole("button", { name: "Submit course selection", exact: true })
      .click();
  }
  await expect(
    student.getByText(/Your course selection has been submitted/),
  ).toBeVisible();
  await student.reload();
  await expect(
    student.getByText(/Your course selection has been submitted/),
  ).toBeVisible();
  await enter(faculty, "faculty");
  await faculty
    .getByRole("button", { name: "My timetable", exact: true })
    .click();
  await faculty
    .locator("article")
    .filter({ hasText: "CS401" })
    .getByRole("button", { name: "Open class" })
    .click();
  await expect(faculty.getByRole("navigation", { name: "Class records" })).toBeVisible();
  const existingAttendance = faculty
    .locator("article")
    .filter({ has: faculty.getByRole("heading", { name: "Browser acceptance attendance", exact: true }) })
    .filter({ hasText: new Date().toISOString().slice(0, 10) });
  if (await existingAttendance.count())
    await existingAttendance
      .getByRole("button", { name: "Open records" })
      .click();
  else
    await faculty.getByRole("button", { name: "New attendance sheet" }).click();
  await faculty
    .getByLabel("Class topic", { exact: true })
    .fill("Browser acceptance attendance");
  await faculty
    .getByLabel("Class date", { exact: true })
    .fill(new Date().toISOString().slice(0, 10));
  await faculty
    .getByLabel("Attendance for Ananya Rao", { exact: true })
    .selectOption("present");
  await faculty.getByLabel("Reason for this change", { exact: true }).fill("Verify today's class attendance in the synthetic browser walkthrough");
  await faculty
    .getByRole("button", { name: "Publish attendance", exact: true })
    .click();
  await expect(
    faculty.getByText("Published. Student and parent records are up to date."),
  ).toBeVisible();
  await faculty
    .getByRole("button", { name: "Final results", exact: true })
    .click();
  await faculty.getByText(/Ananya Rao · (Not published|85\/100)/).click();
  await faculty.getByLabel("Final marks out of 100").fill("85");
  await faculty
    .getByLabel("Reason for this change", { exact: true })
    .fill("Publish the browser acceptance course result");
  await faculty.getByRole("button", { name: "Publish final result" }).click();
  await expect(
    faculty.getByText("Ananya Rao · 85/100", { exact: true }),
  ).toBeVisible();
  await enter(parent, "parent");
  await parent.getByRole("button", { name: "Attendance", exact: true }).click();
  await expect(
    parent.locator("tr").filter({ hasText: "CS401" }).first(),
  ).toContainText("100%");
  await parent
    .getByRole("button", { name: "Marks & results", exact: true })
    .click();
  await expect(
    parent.locator("tr").filter({ hasText: "CS401" }).first(),
  ).toContainText("85/100");
  await parent
    .getByRole("button", { name: "Fees & receipts", exact: true })
    .click();
  const pay = parent.getByRole("button", { name: /Record demo payment/ });
  if (await pay.isVisible()) await pay.click();
  await expect(
    parent
      .getByRole("link", { name: "Download demo receipt", exact: true })
      .first(),
  ).toBeVisible();
  const receipt = await parent
    .getByRole("link", { name: "Download demo receipt", exact: true })
    .first()
    .getAttribute("href");
  const result = await parent.request.get(
    new URL(receipt!, parent.url()).toString(),
  );
  expect(result.status()).toBe(200);
  expect(await result.text()).toContain("Sandbox simulation only");
  const missingCsrf = await student.evaluate(
    async () =>
      (
        await fetch("/api/bff/experience/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
  );
  expect(missingCsrf).toBe(403);
  const badRole = await post(parent, "/api/bff/experience/commands", {
    action: "save-grading",
    expectedRevision: 0,
    label: "Unauthorized scale",
    bands: [
      { minimum: 50, points: 10, letter: "A" },
      { minimum: 0, points: 0, letter: "F" },
    ],
    reason: "A parent must not change grade rules",
  });
  expect(badRole.status).toBe(403);
  await parent.screenshot({
    path: testInfo.outputPath("parent-receipt.png"),
    fullPage: true,
  });
  await context.close();
});
