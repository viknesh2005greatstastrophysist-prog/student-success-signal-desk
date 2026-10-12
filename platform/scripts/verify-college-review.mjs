// Read-only QA of the private local source review. Never persist student names.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import assert from "node:assert/strict";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:3502");
if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Use the local loopback review only");
const privateRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../../runtime/college-attendance"));
const output = await realpath(process.argv[3] ?? "../runtime/college-attendance/2026-10-12");
const location = relative(privateRoot, output);
if (location.startsWith("..") || isAbsolute(location)) throw new Error("Save evidence only inside the private import directory");
const inventory = JSON.parse(await readFile(resolve(output, "download-inventory.json"), "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], failed = [], checks = [], accessibility = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 400) failed.push({ status: response.status() }); });
try {
  await page.goto(url.href);
  await page.locator("#content").waitFor({ state: "visible" });
  const response = await page.request.get(new URL("/api/review", url).href);
  const data = await response.json();
  assert.equal(data.sources.length, inventory.uniqueFiles);
  assert.equal(data.students.length, inventory.combinedUniqueStudents);
  assert.equal(data.recordedValues, inventory.attendance.attendanceCells + inventory.cie.recordedCells);
  assert.equal(data.fullAgentReviewReady, false); assert.equal(data.overallRiskScore, null);
  checks.push("Combined API totals and unknown-risk boundary");
  const cie = data.sources.find(source => source.sheet === "CIE_ATTENDANCE");
  const student = data.students.find(item => item.reports.some(report => report.sourceId === cie.id));
  const studentCie = student.reports.find(report => report.sourceId === cie.id);
  await page.locator("#report").selectOption(cie.id);
  assert.match(await page.locator("#results").textContent(), new RegExp(`^${inventory.cie.studentRows} students`));
  await page.locator("#students button").first().click();
  await page.locator("#student").waitFor({ state: "visible" });
  assert.equal(await page.locator("#student-reports article").count(), student.reports.length);
  assert.ok(await page.getByRole("heading", { name: /Final CIE & attendance/ }).count());
  assert.ok(await page.getByText(`CIE_ATTENDANCE!${studentCie.courses[0].cell}`, { exact: true }).count());
  await page.getByText("Course titles and credits in this report", { exact: true }).click();
  assert.ok((await page.locator("#student-reports").textContent()).includes(cie.legend[0].title));
  checks.push("CIE fields, source addresses, course titles and separate report cards");
  await page.locator("#back").click();
  await page.locator("#search").fill(student.srn);
  assert.match(await page.locator("#results").textContent(), /^1 student/);
  await page.locator("#search").fill("NO-SUCH-RECORD-TEST");
  assert.equal(await page.locator("#results").textContent(), "0 students found");
  await page.locator("#search").fill(""); await page.locator("#report").selectOption("");
  await page.locator("#next").click(); assert.match(await page.locator("#page").textContent(), /^Page 2/);
  await page.locator("#previous").click();
  checks.push("Exact SRN search, no-results state, clearing filters and pagination");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(item => ["serious", "critical"].includes(item.impact));
    accessibility.push({ width, violations: results.violations.map(item => ({ id: item.id, impact: item.impact })), serious: serious.length });
    assert.equal(serious.length, 0);
    await page.screenshot({ path: resolve(output, `review-${width}-redacted.png`), fullPage: true,
      mask: [page.locator("#students td:nth-child(1)"), page.locator("#students td:nth-child(2)")] });
  }
  checks.push("375/768/1440px directory layout and automated accessibility");
  await page.locator("#report").selectOption(cie.id); await page.locator("#students button").first().click();
  await page.setViewportSize({ width: 375, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  const detail = await new AxeBuilder({ page }).analyze();
  assert.equal(detail.violations.filter(item => ["serious", "critical"].includes(item.impact)).length, 0);
  await page.screenshot({ path: resolve(output, "cie-detail-mobile-redacted.png"), fullPage: true,
    mask: [page.locator("#student-name"), page.locator("#student-srn"), page.locator("#student-reports article > p")] });
  checks.push("Mobile CIE detail layout and automated accessibility");
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  const summary = { status: "passed", checks, accessibility, consoleErrors: errors, failedResponses: failed,
    visualRegression: "inconclusive: no baseline", screenReader: "not tested", piiMaskedInScreenshots: true };
  await writeFile(resolve(output, "browser-verification.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
