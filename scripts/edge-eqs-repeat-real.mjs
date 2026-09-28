import { chromium } from "playwright";

const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE_URL = "http://localhost:3000";
const RUNS = 5;

const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
const context = await browser.newContext();
const page = await context.newPage();

async function ensureWritePage() {
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

  await page.waitForSelector('input[placeholder="Your headline..."]', { timeout: 20000 });
  await page.waitForSelector("textarea", { timeout: 20000 });
}

function buildDraft(index) {
  return `Real non mocked run ${index}. This expression is intentionally long enough to pass validation and stress EQS timing behavior under repeated submissions. We are checking whether live checks advance and whether the run ends in a published state or explicit timeout fallback without getting stuck. The sentence count is deliberately expanded so the editor word gate cannot block submission. This lets us measure true network and model timing rather than form validation behavior.`;
}

const report = {
  runs: [],
  summary: {
    total: RUNS,
    published: 0,
    error: 0,
    eqsAborted: 0,
    eqsOk: 0,
  },
};

try {
  await ensureWritePage();

  for (let i = 1; i <= RUNS; i += 1) {
    const run = {
      index: i,
      title: `Repeat EQS run ${Date.now()}-${i}`,
      clickAt: null,
      eqsRequestAt: null,
      eqsResponseAt: null,
      eqsFailed: null,
      blogsResponseAt: null,
      firstProgressAt: null,
      lastProgress: null,
      finalState: null,
      finalStateAt: null,
      errorText: null,
      consoleErrors: [],
    };

    const onReq = (req) => {
      if (req.url().includes("/api/ai/eqs") && req.method() === "POST") run.eqsRequestAt = Date.now();
    };
    const onRes = async (res) => {
      if (res.url().includes("/api/ai/eqs") && res.request().method() === "POST") run.eqsResponseAt = Date.now();
      if (res.url().includes("/api/blogs") && res.request().method() === "POST") run.blogsResponseAt = Date.now();
    };
    const onFail = (req) => {
      if (req.url().includes("/api/ai/eqs")) run.eqsFailed = req.failure()?.errorText || "request failed";
    };
    const onConsole = (msg) => {
      if (msg.type() === "error") run.consoleErrors.push(msg.text());
    };

    page.on("request", onReq);
    page.on("response", onRes);
    page.on("requestfailed", onFail);
    page.on("console", onConsole);

    try {
      await page.locator('input[placeholder="Your headline..."]').first().fill(run.title);
      await page.locator("textarea").first().fill(buildDraft(i));

      const countText = await page.locator("text=/📝\\s*\\d+ words/").first().textContent().catch(() => "");
      run.wordCountText = countText || "";

      run.clickAt = Date.now();
      await page.getByRole("button", { name: /Deliver the Ball/i }).first().click();

      await page.waitForTimeout(800);
      if (!run.eqsRequestAt) {
        const validationMsg = await page.getByText(/minimum 50 words|Expression must be at least 50 words/i).first().textContent().catch(() => null);
        if (validationMsg) {
          run.finalState = "validation-blocked";
          run.finalStateAt = Date.now();
          run.errorText = validationMsg;
          report.runs.push(run);
          await page.waitForTimeout(600);
          continue;
        }
      }

      const start = Date.now();
      while (Date.now() - start < 90000) {
        const progress = await page.locator("text=/\\d+\\s*\\/\\s*12 checks/i").first().textContent().catch(() => null);
        if (progress) {
          if (!run.firstProgressAt) run.firstProgressAt = Date.now();
          run.lastProgress = progress.trim();
        }

        const published = await page.getByText(/^Published$/).first().isVisible().catch(() => false);
        const errorNode = page.getByText(/took too long|Network error|Server error|Failed to create|Please try again/i).first();
        const errorVisible = await errorNode.isVisible().catch(() => false);

        if (published) {
          run.finalState = "published";
          run.finalStateAt = Date.now();
          break;
        }

        if (errorVisible) {
          run.finalState = "error";
          run.finalStateAt = Date.now();
          run.errorText = (await errorNode.textContent().catch(() => "")) || "";
          break;
        }

        await page.waitForTimeout(250);
      }

      if (!run.finalState) {
        run.finalState = "timeout-no-terminal-state";
        run.finalStateAt = Date.now();
      }

      run.metrics = {
        clickToFirstProgressMs: run.clickAt && run.firstProgressAt ? run.firstProgressAt - run.clickAt : null,
        eqsDurationMs: run.eqsRequestAt && run.eqsResponseAt ? run.eqsResponseAt - run.eqsRequestAt : null,
        clickToFinalMs: run.clickAt && run.finalStateAt ? run.finalStateAt - run.clickAt : null,
      };

      if (run.finalState === "published") report.summary.published += 1;
      if (run.finalState === "error") report.summary.error += 1;
      if (run.eqsResponseAt) report.summary.eqsOk += 1;
      if (run.eqsFailed === "net::ERR_ABORTED") report.summary.eqsAborted += 1;

      report.runs.push(run);

      const continueBtn = page.getByRole("button", { name: /Continue editing/i }).first();
      if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
      }
      await page.waitForTimeout(800);
    } finally {
      page.off("request", onReq);
      page.off("response", onRes);
      page.off("requestfailed", onFail);
      page.off("console", onConsole);
    }
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
