import AxeBuilder from "@axe-core/playwright";
import { experienceViewRoutes } from "@aura/contracts";
import { expect, test } from "@playwright/test";
import { enter, sites } from "./helpers";
test("six portals: navigation, accessibility, mobile overflow and session roles", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext();
  const errors: string[] = [];
  for (const portal of Object.keys(sites) as (keyof typeof sites)[]) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${portal}: ${e.message}`));
    await enter(page, portal);
    const routes =
      portal === "lms"
        ? { Home: "/dashboard", Courses: "/courses" }
        : experienceViewRoutes[portal];
    for (const [view, path] of Object.entries(routes)) {
      await page
        .getByRole("navigation", { name: "Portal sections", exact: true })
        .getByRole("button", { name: view, exact: true })
        .click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      await expect(page.locator("#workspace-main h1").first()).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.filter(
          (v) => v.impact === "critical" || v.impact === "serious",
        ),
        `${portal}/${view} accessibility`,
      ).toEqual([]);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth,
              ),
            { message: `${portal}/${view} at ${width}px` },
          )
          .toBe(true);
      }
      if (view === Object.keys(routes)[0]) {
        if (portal === "hod")
          await expect(page.locator("#workspace-main")).not.toContainText(
            "Ananya Rao",
          );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: testInfo.outputPath(`${portal}-mobile.png`),
          fullPage: true,
        });
      }
    }
    await page.close();
  }
  expect(errors).toEqual([]);
  await context.close();
});
