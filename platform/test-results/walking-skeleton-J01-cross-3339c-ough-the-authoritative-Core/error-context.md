# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: walking-skeleton.spec.ts >> J01 crosses independent role sessions through the authoritative Core
- Location: e2e/walking-skeleton.spec.ts:21:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /^https:\/\/aura-hod-portal\.vercel\.app\/?$/
Received string:  "https://aura-identity-service.vercel.app/sign-in?response_type=code&redirect_uri=https%3A%2F%2Faura-hod-portal.vercel.app%2Fapi%2Fauth%2Fcallback%2Faura&scope=openid+profile+email+offline_access&state=s61QlsTPVeKeB1wrrgyupca2XukYnyHz&client_id=kqiOIOfbMBtlcIqJxIjHmIHinbBQsnCX&prompt=login&code_challenge=0IoKpxjE_QQKUzdX4K6GUMWdH9PF7tg5mAWkxMBeiSs&code_challenge_method=S256&nonce=Fcv3lMr5lqIG2URKv0SPn3dbZsrAi8Cc&resource=urn%3Aaura%3Acore-api&exp=1788375820&ba_iat=1788375220336&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=code_challenge&ba_param=code_challenge_method&ba_param=exp&ba_param=nonce&ba_param=prompt&ba_param=redirect_uri&ba_param=resource&ba_param=response_type&ba_param=scope&ba_param=state&sig=z40PdomCvRFTw3Vf3mswfj%2F9B1GTkfK64x7PjnckHrA%3D"
Timeout: 15000ms

Call log:
  - Expect "toHaveURL" with timeout 15000ms
    - waiting for "https://aura-identity-service.vercel.app/api/demo/sign-in?response_type=code&redirect_uri=https%3A%2F%2Faura-hod-portal.vercel.app%2Fapi%2Fauth%2Fcallback%2Faura&scope=openid+profile+email+offline_ac…" navigation to finish...
    - navigated to "https://aura-identity-service.vercel.app/sign-in?response_type=code&redirect_uri=https%3A%2F%2Faura-hod-portal.vercel.app%2Fapi%2Fauth%2Fcallback%2Faura&scope=openid+profile+email+offline_access&stat…"
    29 × locator resolved to <html lang="en">…</html>
       - unexpected value "https://aura-identity-service.vercel.app/sign-in?response_type=code&redirect_uri=https%3A%2F%2Faura-hod-portal.vercel.app%2Fapi%2Fauth%2Fcallback%2Faura&scope=openid+profile+email+offline_access&state=s61QlsTPVeKeB1wrrgyupca2XukYnyHz&client_id=kqiOIOfbMBtlcIqJxIjHmIHinbBQsnCX&prompt=login&code_challenge=0IoKpxjE_QQKUzdX4K6GUMWdH9PF7tg5mAWkxMBeiSs&code_challenge_method=S256&nonce=Fcv3lMr5lqIG2URKv0SPn3dbZsrAi8Cc&resource=urn%3Aaura%3Acore-api&exp=1788375820&ba_iat=1788375220336&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=code_challenge&ba_param=code_challenge_method&ba_param=exp&ba_param=nonce&ba_param=prompt&ba_param=redirect_uri&ba_param=resource&ba_param=response_type&ba_param=scope&ba_param=state&sig=z40PdomCvRFTw3Vf3mswfj%2F9B1GTkfK64x7PjnckHrA%3D"

```

```yaml
- main:
  - region "AURA identity context":
    - paragraph: AURA identity
    - heading "Cross the right threshold." [level=1]
    - paragraph: Each portal keeps its own session. This identity service only proves who is entering.
    - paragraph: Synthetic people. Real authorization boundaries.
  - paragraph: 01 / identity check
  - heading "Enter hod" [level=2]
  - text: D
  - strong: Dr Sahana Krishnan
  - text: Head · Computer Science seeded Demo access PIN
  - textbox "Demo access PIN"
  - button "Enter portal"
  - paragraph: Credentials stay at the identity origin. The destination receives a short-lived authorization result.
- alert
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | 
  3  | const sites = {
  4  |   student: "https://aura-student-portal.vercel.app",
  5  |   parent: "https://aura-parent-portal.vercel.app",
  6  |   faculty: "https://aura-faculty-portal.vercel.app",
  7  |   hod: "https://aura-hod-portal.vercel.app",
  8  |   governance: "https://aura-ai-governance.vercel.app",
  9  | } as const;
  10 | 
  11 | async function enterPortal(page: Page, portal: keyof typeof sites) {
  12 |   await page.goto(sites[portal]);
  13 |   await page.getByRole("link", { name: /Enter as/i }).click();
  14 |   await expect(page).toHaveURL(/aura-identity-service\.vercel\.app\/sign-in/);
  15 |   await page.getByLabel("Demo access PIN").fill(process.env.DEMO_ACCESS_PIN ?? "");
  16 |   await page.getByRole("button", { name: /Enter portal/i }).click();
> 17 |   await expect(page).toHaveURL(new RegExp(`^${sites[portal].replaceAll(".", "\\.")}/?$`));
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  18 |   await expect(page.getByText("Institution revision", { exact: true })).toBeVisible();
  19 | }
  20 | 
  21 | test("J01 crosses independent role sessions through the authoritative Core", async ({ browser }) => {
  22 |   test.skip(!process.env.DEMO_ACCESS_PIN, "DEMO_ACCESS_PIN is required");
  23 |   const context = await browser.newContext();
  24 |   const hod = await context.newPage();
  25 |   const student = await context.newPage();
  26 |   const faculty = await context.newPage();
  27 |   const parent = await context.newPage();
  28 |   const governance = await context.newPage();
  29 | 
  30 |   await enterPortal(hod, "hod");
  31 |   await expect(hod.getByRole("button", { name: /Publish \+ assign/i })).toBeEnabled();
  32 |   await hod.getByRole("button", { name: /Publish \+ assign/i }).click();
  33 |   await expect(hod.getByText(/Published\. Every authorized portal/i)).toBeVisible();
  34 |   await expect(hod.getByRole("button", { name: "Published" })).toBeDisabled();
  35 | 
  36 |   await enterPortal(student, "student");
  37 |   await expect(student.getByText("published", { exact: true }).first()).toBeVisible();
  38 |   await expect(student.getByText(/HOD has published this offering/i)).toBeVisible();
  39 | 
  40 |   await enterPortal(faculty, "faculty");
  41 |   await expect(faculty.getByText(/CS401 Agentic AI Systems/i)).toBeVisible();
  42 |   await expect(faculty.getByText("ready", { exact: true })).toBeVisible();
  43 | 
  44 |   await enterPortal(parent, "parent");
  45 |   await expect(parent.getByText("Ananya Rao", { exact: true })).toBeVisible();
  46 |   await expect(parent.getByText("4", { exact: true })).toBeVisible();
  47 | 
  48 |   await enterPortal(governance, "governance");
  49 |   await expect(governance.getByText(/Offering published and faculty assigned/i)).toBeVisible();
  50 |   await expect(governance.getByText("NONE", { exact: true })).toBeVisible();
  51 | 
  52 |   await parent.getByTitle("Sign out").click();
  53 |   await expect(parent.getByRole("link", { name: /Enter as/i })).toBeVisible();
  54 |   await student.getByRole("button", { name: "Refresh portal data" }).click();
  55 |   await expect(student.getByText(/Good morning/i)).toBeVisible();
  56 | 
  57 |   await expect(student.locator('a[href="#"]')).toHaveCount(0);
  58 |   await expect(parent.locator('a[href="#"]')).toHaveCount(0);
  59 |   await expect(faculty.locator('a[href="#"]')).toHaveCount(0);
  60 |   await expect(hod.locator('a[href="#"]')).toHaveCount(0);
  61 |   await expect(governance.locator('a[href="#"]')).toHaveCount(0);
  62 | 
  63 |   await context.close();
  64 | });
  65 | 
```