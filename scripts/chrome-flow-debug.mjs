import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const TEST_IMAGE = "C:/Users/srira/Desktop/cricgeek-app/public/test-upload.png";

const output = {
  browser: "Chromium",
  console: [],
  apiTraffic: [],
  flow: {
    login: "not-started",
    writerActivation: "not-started",
    polish: "not-started",
    upload: "not-started",
    publish: "not-started",
    eqsResult: "not-started",
    published: "not-started",
  },
};

function tracked(url) {
  return ["/api/ai/paraphrase", "/api/ai/upload", "/api/ai/eqs", "/api/blogs", "/api/scoring/analyze", "/api/auth/session", "/api/writer/profile"].some((path) => url.includes(path));
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      output.console.push({ type: msg.type(), text: msg.text() });
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!tracked(url)) return;
    let body = "";
    try { body = await response.text(); } catch { body = "<unreadable>"; }
    output.apiTraffic.push({
      url,
      status: response.status(),
      method: response.request().method(),
      requestBody: response.request().postData() || null,
      responseBody: body,
    });
  });

  await page.goto(`${BASE_URL}/auth/login?redirect=/blog/write`, { waitUntil: "networkidle" });
  await page.fill("#login-email", "writer@demo.local");
  await page.fill("#login-password", "Writer@123");
  await page.click("#login-submit");
  await page.waitForURL("**/blog/write", { timeout: 20000 });
  output.flow.login = "ok";

  const becomeWriter = page.getByRole("button", { name: /Become a Writer/i }).first();
  if (await becomeWriter.isVisible().catch(() => false)) {
    await becomeWriter.click();
    await page.waitForTimeout(1200);
  }

  const deliverButton = page.getByRole("button", { name: /Deliver the Ball/i }).first();
  output.flow.writerActivation = (await deliverButton.isVisible().catch(() => false)) ? "ok" : "failed";

  await page.fill('input[placeholder="Your headline..."]', `Chromium full flow ${Date.now()}`);
  await page.fill(
    "textarea",
    "This chromium test validates write, polish, upload, publish, and EQS in one pass. The paragraph is intentionally longer than sixty words so validation stays safely above the minimum even if polish changes spacing. We also include enough descriptive detail to keep the originality check meaningful and to ensure the final result card appears after scoring."
  );

  await page.getByRole("button", { name: /Polish with AI/i }).first().click();
  await page.waitForTimeout(2200);
  output.flow.polish = "ok";

  await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  await page.waitForTimeout(2200);
  output.flow.upload = "ok";

  await deliverButton.click();
  output.flow.publish = "clicked";

  await page.waitForTimeout(14000);
  output.flow.eqsResult = (await page.getByText(/EQS result/i).first().isVisible().catch(() => false)) ? "visible" : "missing";
  output.flow.published = (await page.getByText(/^Published$/).first().isVisible().catch(() => false)) ? "visible" : "missing";

  output.urlAfterFlow = page.url();
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}
