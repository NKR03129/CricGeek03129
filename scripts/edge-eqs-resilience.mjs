import { chromium } from "playwright";

const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE_URL = "http://localhost:3000";

async function loginAndOpenWrite(page) {
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
}

async function fillDraft(page, title) {
  await page.fill('input[placeholder="Your headline..."]', title);
  await page.fill("textarea", "This draft validates EQS loading resilience under delayed and timeout scenarios. It should pass minimum length and trigger scoring. The goal is to ensure the UI always transitions to either result or an explicit error state, never an endless spinner. The text is simple but long enough for predictable validation behavior.");
}

async function clickDeliver(page) {
  const deliverButton = page.getByRole("button", { name: /Deliver the Ball/i }).first();
  if (!(await deliverButton.isVisible().catch(() => false))) {
    const becomeWriter = page.getByRole("button", { name: /Become a Writer/i }).first();
    if (await becomeWriter.isVisible().catch(() => false)) {
      await becomeWriter.click();
      await page.waitForTimeout(1200);
    }
  }
  await deliverButton.click({ timeout: 10000 });
}

const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
const context = await browser.newContext();
const page = await context.newPage();

const report = {
  slowSuccess: {
    progressDuringWait: null,
    publishedVisible: false,
    errorVisible: false,
  },
  timeoutFallback: {
    loaderStillVisible: null,
    errorVisible: false,
    deliverButtonVisible: false,
  },
};

try {
  await loginAndOpenWrite(page);

  // Test A: delayed success should show progressing loader and then finish.
  await context.route("**/api/ai/eqs", async (route) => {
    const req = route.request();
    const original = await route.fetch();
    const body = await original.text();
    await new Promise((resolve) => setTimeout(resolve, 7000));
    await route.fulfill({
      status: original.status(),
      headers: original.headers(),
      body,
    });
  }, { times: 1 });

  await fillDraft(page, `Edge slow EQS ${Date.now()}`);
  await clickDeliver(page);

  await page.waitForTimeout(3000);
  const progressText = await page.locator("text=/\\d+\\s*\\/\\s*12 checks/").first().textContent().catch(() => null);
  report.slowSuccess.progressDuringWait = progressText;

  await page.waitForTimeout(17000);
  report.slowSuccess.publishedVisible = await page.getByText("Published").first().isVisible().catch(() => false);
  report.slowSuccess.errorVisible = await page.getByText(/took too long|network error|Failed to create blog/i).first().isVisible().catch(() => false);

  // Reset overlay
  const continueBtn = page.getByRole("button", { name: /Continue editing/i }).first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
  }

  // Test B: force timeout to ensure fallback state is shown.
  await context.route("**/api/ai/eqs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 60000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ overallEqs: 80, weightedEqs: 80, attributes: [] }),
    });
  }, { times: 1 });

  await fillDraft(page, `Edge timeout EQS ${Date.now()}`);
  await clickDeliver(page);

  await page.waitForTimeout(47000);
  report.timeoutFallback.errorVisible = await page.getByText(/took too long|try again|network error/i).first().isVisible().catch(() => false);
  report.timeoutFallback.deliverButtonVisible = await page.getByRole("button", { name: /Deliver the Ball/i }).first().isVisible().catch(() => false);
  report.timeoutFallback.loaderStillVisible = await page.getByText(/Publish review in progress|Scoring your draft/i).first().isVisible().catch(() => false);

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
