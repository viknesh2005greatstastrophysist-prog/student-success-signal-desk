import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { fixture } from "../services/core-api/tests/fixtures/college-attendance";
import { buildCollegeAttendanceReview } from "../services/core-api/lib/chapter11/college-attendance-review";
import { createCollegeAttendanceServer } from "../services/core-api/lib/chapter11/college-attendance-server";
import { CollegePilot } from "../services/core-api/lib/chapter11/college-pilot-store";
process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), privateRoot = await realpath(resolve(root, "runtime/college-attendance"));
const output = await realpath(process.argv[2] ?? "../runtime/college-attendance/2026-10-12"), position = relative(privateRoot, output);
if (position.startsWith("..") || isAbsolute(position)) throw new Error("Private QA output directory required");
const actualUrl = process.argv[3] ?? "http://127.0.0.1:3503";
if (new URL(actualUrl).hostname !== "127.0.0.1") throw new Error("Local pilot required");
const bundle = fixture(), row = bundle.enrollments[0]!, review = buildCollegeAttendanceReview(bundle, [{ ...row, studentName: "Fictional QA Student", srn: "TEST001" }], {
  schemaVersion: "aura.college-source-context.v1", datasetId: bundle.datasetId,
  permission: { status: "user_confirmed", confirmedOn: "2026-10-12", statement: "Fictional test only", basis: "user_statement" },
  clarification: { zeroMeaning: "unconfirmed", zeroHypothesis: "Unknown", naMeaning: null, tnsMeaning: null, numericUnit: null, academicTerm: null, periodStart: null, periodEnd: null },
});
const dir = await mkdtemp(resolve(tmpdir(), "aura-pilot-browser-")), pilot = new CollegePilot(dir, review), assets = resolve(root, "platform/services/core-api/local/college-attendance");
const [html, script, css] = await Promise.all(["index.html", "review.js", "review.css"].map(name => readFile(resolve(assets, name), "utf8")));
const server = createCollegeAttendanceServer(review, { html: html!, script: script!, css: css! }, pilot);
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address !== "string");
const browser = await chromium.launch({ channel: "chrome", headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
const checks: string[] = [], layout: Array<{ width: number; seriousViolations: number }> = [];
try {
  await page.goto(`http://127.0.0.1:${address.port}`); await page.locator("#workspace-nav").waitFor({ state: "visible" });
  await page.locator("#show-workflow").click(); await page.locator("#workflow-mode").selectOption("deterministic"); await page.locator("#workflow-start").click();
  await page.waitForFunction(() => document.querySelector("#workflow-status")?.textContent?.includes("1 awaiting local review"));
  await page.locator("#workflow-jobs button").first().click(); await page.locator("#workflow-case").waitFor({ state: "visible" });
  assert.ok((await page.locator("#workflow-unknowns").textContent())?.includes("academic year")); assert.equal(await page.locator("#workflow-tasks li").count(), 7);
  await page.locator("#workflow-tasks button").nth(1).click(); await page.locator("#workflow-note").fill("Fictional QA reordered clarification questions."); await page.locator("#workflow-edit").click();
  await page.waitForFunction(() => document.querySelector("#workflow-case-status")?.textContent?.includes("Version 2"));
  await page.locator("#workflow-note").fill("Fictional QA accepts this local checklist only."); await page.locator("#workflow-approve").click();
  await page.waitForFunction(() => document.querySelector("#workflow-case-status")?.textContent?.includes("Accepted clarification checklist"));
  await page.locator("#workflow-note").fill("Fictional QA records a response pending verification."); await page.locator("#workflow-task-status").selectOption("response_recorded"); await page.locator("#workflow-record-followup").click();
  await page.waitForFunction(() => document.querySelector("#workflow-action-status")?.textContent?.includes("Source meanings are unchanged"));
  await page.locator("#workflow-note").fill("Fictional QA withdraws this local checklist."); await page.locator("#workflow-withdraw").click();
  await page.waitForFunction(() => document.querySelector("#workflow-case-status")?.textContent?.includes("Withdrawn checklist"));
  await page.locator("#workflow-note").fill("Fictional QA restores the same accepted version."); await page.locator("#workflow-restore").click();
  await page.waitForFunction(() => document.querySelector("#workflow-case-status")?.textContent?.includes("Accepted clarification checklist"));
  await page.locator("#workflow-replay").click(); await page.waitForFunction(() => document.querySelector("#workflow-action-status")?.textContent?.includes("Replay verified"));
  const downloadPromise = page.waitForEvent("download"); await page.locator("#workflow-export").click(); const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "private-college-case.json");
  const details = pilot.caseDetail(String(pilot.overview().runs[0]!.id), row.studentId); assert.equal(details.state, "approved"); assert.equal(details.packet!.riskScore, null); assert.equal(details.packet!.studentPublicationAllowed, false);
  checks.push("Fictional fixture: full preparation, edit, local acceptance, follow-up, withdrawal, restore, replay and download");
  const liveContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), live = await liveContext.newPage(); live.on("pageerror", error => errors.push(error.message));
  await live.goto(actualUrl); await live.locator("#workspace-nav").waitFor({ state: "visible" }); await live.locator("#show-workflow").click();
  await live.waitForFunction(() => document.querySelector("#workflow-status")?.textContent?.includes("321 awaiting local review"));
  await live.locator("#workflow-jobs button").first().click(); await live.locator("#workflow-case").waitFor({ state: "visible" });
  assert.match(await live.locator("#workflow-case-method").textContent() ?? "", /local model qwen3.8/);
  checks.push("Actual dataset: 321 persisted packets, local-model method and explicit unknowns; read-only browser inspection");
  for (const width of [375, 768, 1440]) {
    await live.setViewportSize({ width, height: 1000 }); assert.equal(await live.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const result = await new AxeBuilder({ page: live }).analyze(), serious = result.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    assert.equal(serious.length, 0); layout.push({ width, seriousViolations: serious.length });
    await live.screenshot({ path: resolve(output, `agent-workflow-${width}-redacted.png`), fullPage: true, mask: [live.locator("#workflow-jobs td:first-child"), live.locator("#workflow-case-heading")] });
  }
  await liveContext.close(); assert.deepEqual(errors, []);
  const result = { status: "passed", checks, layout, consoleErrors: errors, actualMentorApprovalClaimed: false, actualUserLoginClaimed: false, visualRegression: "inconclusive: no baseline", screenReader: "not tested" };
  await writeFile(resolve(output, "pilot-browser-verification.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify(result));
} finally { await context.close(); await browser.close(); await new Promise<void>(done => server.close(() => done())); pilot.close(); await rm(dir, { recursive: true, force: true }); }
