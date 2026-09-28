import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const out = {
  title: `Realtime EQS sync ${Date.now()}`,
  clickAt: null,
  eqsRequestAt: null,
  eqsResponseAt: null,
  blogsRequestAt: null,
  blogsResponseAt: null,
  firstProgressAt: null,
  progressSamples: [],
  finalState: null,
  finalStateAt: null,
  eqsFailed: null,
};

page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/ai/eqs") && req.method() === "POST") out.eqsRequestAt = Date.now();
  if (url.includes("/api/blogs") && req.method() === "POST") out.blogsRequestAt = Date.now();
});

page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/api/ai/eqs") && res.request().method() === "POST") out.eqsResponseAt = Date.now();
  if (url.includes("/api/blogs") && res.request().method() === "POST") out.blogsResponseAt = Date.now();
});

page.on("requestfailed", (req) => {
  const url = req.url();
  if (url.includes("/api/ai/eqs")) out.eqsFailed = req.failure()?.errorText || "request failed";
});

try {
  await page.goto(`${BASE_URL}/auth/login?redirect=/blog/write`, { waitUntil: "networkidle" });
  const loginEmail = page.locator("#login-email").first();
  if (await loginEmail.isVisible().catch(() => false)) {
    await page.fill("#login-email", "writer@demo.local");
    await page.fill("#login-password", "Writer@123");
    await page.click("#login-submit");
    await page.waitForURL("**/blog/write", { timeout: 20000 });
  } else if (!page.url().includes("/blog/write")) {
    await page.goto(`${BASE_URL}/blog/write`, { waitUntil: "networkidle" });
  }

  const becomeWriter = page.getByRole("button", { name: /Become a Writer/i }).first();
  if (await becomeWriter.isVisible().catch(() => false)) {
    await becomeWriter.click();
    await page.waitForTimeout(1200);
  }

  await page.waitForSelector('input[placeholder="Your headline..."]', { timeout: 20000 });
  await page.waitForSelector("textarea", { timeout: 20000 });

  await page.fill('input[placeholder="Your headline..."]', out.title);
  await page.fill(
    "textarea",
    "This real non mocked EQS sync verification run confirms animation pacing against an actual backend response. The draft is long enough to satisfy submission constraints and unique enough to avoid deterministic rejection. We expect live checks to start quickly, move through staged updates while waiting, and then transition cleanly to published plus EQS result once scoring and publish requests complete."
  );

  const deliver = page.getByRole("button", { name: /Deliver the Ball/i }).first();
  out.clickAt = Date.now();
  await deliver.click();

  const start = Date.now();
  while (Date.now() - start < 80000) {
    const progressText = await page.locator("text=/\\d+\\s*\\/\\s*12 checks/i").first().textContent().catch(() => null);
    if (progressText) {
      const clean = progressText.trim();
      if (!out.firstProgressAt) out.firstProgressAt = Date.now();
      const last = out.progressSamples.length ? out.progressSamples[out.progressSamples.length - 1].text : null;
      if (clean !== last) out.progressSamples.push({ t: Date.now(), text: clean });
    }

    const published = await page.getByText(/^Published$/).first().isVisible().catch(() => false);
    const eqsResult = await page.getByText(/EQS result/i).first().isVisible().catch(() => false);
    const error = await page.getByText(/took too long|Failed to create|Server error|Network error|Please try again/i).first().isVisible().catch(() => false);

    if (published) {
      out.finalState = "published";
      out.finalStateAt = Date.now();
      break;
    }
    if (eqsResult) {
      out.finalState = "eqs-result";
      out.finalStateAt = Date.now();
      break;
    }
    if (error) {
      out.finalState = "error";
      out.finalStateAt = Date.now();
      break;
    }

    await page.waitForTimeout(300);
  }

  if (!out.finalState) {
    out.finalState = "timeout-no-terminal-state";
    out.finalStateAt = Date.now();
  }

  out.metrics = {
    clickToFirstProgressMs: out.clickAt && out.firstProgressAt ? out.firstProgressAt - out.clickAt : null,
    clickToEqsRequestMs: out.clickAt && out.eqsRequestAt ? out.eqsRequestAt - out.clickAt : null,
    eqsNetworkMs: out.eqsRequestAt && out.eqsResponseAt ? out.eqsResponseAt - out.eqsRequestAt : null,
    clickToBlogsRequestMs: out.clickAt && out.blogsRequestAt ? out.blogsRequestAt - out.clickAt : null,
    blogsNetworkMs: out.blogsRequestAt && out.blogsResponseAt ? out.blogsResponseAt - out.blogsRequestAt : null,
    clickToFinalStateMs: out.clickAt && out.finalStateAt ? out.finalStateAt - out.clickAt : null,
    progressStepCountSeen: out.progressSamples.length,
    lastProgressSeen: out.progressSamples.length ? out.progressSamples[out.progressSamples.length - 1].text : null,
  };

  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
