import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { open, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

process.umask(0o077);
const platform = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await realpath(process.argv[2] ?? resolve(platform, "../runtime/college-attendance/2026-10-12"));
const privateRoot = await realpath(resolve(platform, "../runtime/college-attendance"));
assert.ok(!relative(privateRoot, output).startsWith(".."), "Private output folder required");
const portals = ["student", "parent", "faculty", "hod", "governance", "lms"];
const children = [], logs = [], checks = [], errors = [];
let browser;
try {
  for (const [index, portal] of portals.entries()) {
    const log = await open(resolve(output, `native-${portal}-qa.log`), "w", 0o600); logs.push(log);
    const child = spawn(process.execPath, [resolve(platform, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(3711 + index)], {
      cwd: resolve(platform, `apps/${portal}-portal`), env: { ...process.env, AURA_PORTAL_MODE: "institutional" }, stdio: ["ignore", log.fd, log.fd],
    }); children.push(child);
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const [index, portal] of portals.entries()) {
    const base = `http://127.0.0.1:${3711 + index}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${base}/college-records`)).ok; } catch {}
      if (ready) break;
      if (children[index].exitCode !== null) throw new Error(`${portal} server exited`);
      await new Promise(done => setTimeout(done, 250));
    }
    assert.ok(ready, `${portal} starts`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    page.on("pageerror", error => errors.push(`${portal}: ${error.message}`));
    const anonymous = await context.request.get(`${base}/api/bff/college-sources`);
    assert.equal(anonymous.status(), 401, `${portal}: native BFF denies anonymous access`);
    await page.goto(`${base}/college-records`);
    await page.getByRole("link", { name: "Sign in to college portal" }).waitFor();
    const fixture = {
      actorRole: portal, privacy: portal === "governance" ? "authenticated_aggregate" : "authenticated_scoped",
      counts: { students: 1, sources: 1 }, unknowns: ["academic year", "source units", "mentor-approved policy"], riskScore: null, studentSupportPublicationAllowed: false,
      sources: [{ id: "FICTIONAL-SOURCE", filename: "fictional-test.xls", sheet: "TEST" }],
      students: portal === "governance" ? [] : [{ id: "FICTIONAL-STUDENT", name: "Fictional QA Student", srn: "TEST001", reports: [{ semester: 5, section: "TEST", sourceId: "FICTIONAL-SOURCE", cells: [{ course: "TEST101", field: "Attendance", rawValue: "TNS", sourceCell: "H8" }] }] }],
    };
    await page.route("**/api/bff/college-sources", route => route.fulfill({ status: 200, contentType: "application/json", headers: { "X-CSRF-Token": "FICTIONAL-QA" }, body: JSON.stringify({ ok: true, data: fixture }) }));
    await page.reload(); await page.getByText("1 authorized students", { exact: false }).waitFor();
    if (portal === "governance") assert.equal(await page.getByText("TEST001", { exact: true }).count(), 0);
    else { await page.getByRole("cell", { name: "TNS", exact: true }).waitFor(); await page.getByRole("cell", { name: "TEST!H8", exact: true }).waitFor(); }
    const layouts = [];
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${portal} ${width}: overflow`);
      const result = await new AxeBuilder({ page }).analyze();
      const serious = result.violations.filter(v => ["critical", "serious"].includes(v.impact));
      assert.deepEqual(serious.map(v => v.id), [], `${portal} ${width}: axe`);
      layouts.push({ width, seriousViolations: serious.length });
      await page.screenshot({ path: resolve(output, `native-${portal}-${width}-fictional.png`), fullPage: true });
    }
    checks.push({ portal, anonymousBffStatus: anonymous.status(), rendering: "fictional intercepted scoped response", layouts });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { status: "passed", checks, pageErrors: errors, realUserAuthenticationVerified: false, actualInstitutionalDeploymentVerified: false, visualRegression: "inconclusive: no baseline", screenReader: "not tested" };
  await writeFile(resolve(output, "native-portals-browser-verification.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(logs.map(log => log.close()));
}
