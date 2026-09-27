import { chromium } from "playwright";

const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE_URL = "http://localhost:3000";

const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
const context = await browser.newContext();
const page = await context.newPage();

const run = {
  clickAt: null,
  eqsReq: null,
  eqsRes: null,
  eqsFail: null,
  blogRes: null,
  firstProgressAt: null,
  final: null,
  finalAt: null,
  errorText: null,
};

page.on("request", (req) => {
  if (req.url().includes("/api/ai/eqs") && req.method() === "POST") run.eqsReq = Date.now();
});
page.on("response", (res) => {
  if (res.url().includes("/api/ai/eqs") && res.request().method() === "POST") run.eqsRes = Date.now();
  if (res.url().includes("/api/blogs") && res.request().method() === "POST") run.blogRes = Date.now();
});
page.on("requestfailed", (req) => {
  if (req.url().includes("/api/ai/eqs")) run.eqsFail = req.failure()?.errorText || "request failed";
});

try {
  await page.goto(`${BASE_URL}/auth/login?redirect=/blog/write`, { waitUntil: "networkidle" });
  const loginEmail = page.locator("#login-email").first();
  if (await loginEmail.isVisible().catch(() => false)) {
    await loginEmail.fill("writer@demo.local");
    await page.locator("#login-password").first().fill("Writer@123");
    await page.locator("#login-submit").first().click();
    await page.waitForURL("**/blog/write", { timeout: 25000 });
  }

  const becomeWriter = page.getByRole("button", { name: /Become a Writer/i }).first();
  if (await becomeWriter.isVisible().catch(() => false)) {
    await becomeWriter.click();
    await page.waitForTimeout(1200);
  }

  await page.waitForSelector('input[placeholder="Your headline..."]', { timeout: 30000 });
  await page.waitForSelector("textarea", { timeout: 30000 });

  await page.locator('input[placeholder="Your headline..."]').first().fill(`E2E timing ${Date.now()}`);
  await page.locator("textarea").first().fill(
    "This is a single real end to end publish timing run after EQS timeout and cancellation fixes. The draft is intentionally above minimum words and is submitted without any mock delays. This test measures how long real scoring takes and whether the publish flow finishes cleanly with a final published state."
  );

  run.clickAt = Date.now();
  await page.getByRole("button", { name: /Deliver the Ball/i }).first().click();

  const start = Date.now();
  while (Date.now() - start < 180000) {
    const progress = await page.locator("text=/\\d+\\s*\\/\\s*12 checks/i").first().textContent().catch(() => null);
    if (progress && !run.firstProgressAt) run.firstProgressAt = Date.now();

    const published = await page.getByText(/^Published$/).first().isVisible().catch(() => false);
    const errorNode = page.getByText(/took too long|Network error|Server error|Failed to create|Please try again/i).first();
    const errorVisible = await errorNode.isVisible().catch(() => false);

    if (published) {
      run.final = "published";
      run.finalAt = Date.now();
      break;
    }

    if (errorVisible) {
      run.final = "error";
      run.finalAt = Date.now();
      run.errorText = (await errorNode.textContent().catch(() => null)) || null;
      break;
    }

    await page.waitForTimeout(300);
  }

  if (!run.final) {
    run.final = "no-terminal";
    run.finalAt = Date.now();
  }

  run.metrics = {
    clickToFirstProgressMs: run.clickAt && run.firstProgressAt ? run.firstProgressAt - run.clickAt : null,
    eqsDurationMs: run.eqsReq && run.eqsRes ? run.eqsRes - run.eqsReq : null,
    clickToTerminalMs: run.clickAt && run.finalAt ? run.finalAt - run.clickAt : null,
  };

  console.log(JSON.stringify(run, null, 2));
} finally {
  await browser.close();
}
