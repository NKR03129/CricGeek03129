import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const report = {
  progressTextDuringWait: null,
  eqsResultVisible: false,
  publishedVisible: false,
};

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  await context.route("**/api/ai/eqs", async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.text();
    await new Promise((resolve) => setTimeout(resolve, 7000));
    await route.fulfill({ status: upstream.status(), headers: upstream.headers(), body });
  }, { times: 1 });

  await page.goto(`${BASE_URL}/auth/login?redirect=/blog/write`, { waitUntil: "networkidle" });
  await page.fill("#login-email", "writer@demo.local");
  await page.fill("#login-password", "Writer@123");
  await page.click("#login-submit");
  await page.waitForURL("**/blog/write", { timeout: 20000 });

  const becomeWriter = page.getByRole("button", { name: /Become a Writer/i }).first();
  if (await becomeWriter.isVisible().catch(() => false)) {
    await becomeWriter.click();
    await page.waitForTimeout(1200);
  }

  await page.fill('input[placeholder="Your headline..."]', `Progress check ${Date.now()}`);
  await page.fill(
    "textarea",
    "This delayed EQS test confirms that the live scoring panel reveals checks while the backend call is still in flight. We should see a progress count like two out of twelve or three out of twelve before completion. The text remains above minimum length and the request should end in a visible published state after scoring finishes."
  );

  await page.getByRole("button", { name: /Deliver the Ball/i }).first().click();
  await page.waitForTimeout(3200);
  report.progressTextDuringWait = await page.locator("text=/\\d+\\s*\\/\\s*12 checks/").first().textContent().catch(() => null);

  await page.waitForTimeout(17000);
  report.eqsResultVisible = await page.getByText(/EQS result/i).first().isVisible().catch(() => false);
  report.publishedVisible = await page.getByText(/^Published$/).first().isVisible().catch(() => false);

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
