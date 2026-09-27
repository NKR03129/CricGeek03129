import { chromium } from "playwright";

const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE_URL = "http://localhost:3000";
const TEST_IMAGE = "C:/Users/srira/Desktop/cricgeek-app/public/test-upload.png";

const output = {
  browser: "Microsoft Edge",
  console: [],
  requestFailures: [],
  apiTraffic: [],
  flow: {
    login: "not-started",
    writerActivation: "not-started",
    polish: "not-started",
    upload: "not-started",
    publish: "not-started",
    eqsResult: "not-started",
  },
};

const trackedEndpoints = [
  "/api/auth/session",
  "/api/ai/paraphrase",
  "/api/ai/upload",
  "/api/ai/eqs",
  "/api/blogs",
  "/api/scoring/analyze",
  "/api/writer/profile",
];

function shouldTrack(url) {
  return trackedEndpoints.some((path) => url.includes(path));
}

const browser = await chromium.launch({
  headless: true,
  executablePath: EDGE_PATH,
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", async (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      output.console.push({ type: msg.type(), text: msg.text() });
    }
  });

  page.on("requestfailed", (request) => {
    output.requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "unknown",
    });
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!shouldTrack(url)) return;

    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "<unable-to-read-body>";
    }

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

  const becomeWriter = page.getByRole("button", { name: /Become a Writer/i });
  if (await becomeWriter.isVisible().catch(() => false)) {
    await becomeWriter.click();
    await page.waitForTimeout(1200);
  }

  const deliverBtn = page.getByRole("button", { name: /Deliver the Ball/i });
  if (await deliverBtn.isVisible().catch(() => false)) {
    output.flow.writerActivation = "ok";
  } else {
    output.flow.writerActivation = "failed";
  }

  await page.fill('input[placeholder="Your headline..."]', `Edge debug publish ${Date.now()}`);
  await page.fill("textarea", "This is an Edge-specific debug draft to test expression creation flow. The content is intentionally plain but long enough to pass validation. We need to verify polish, upload, publish, and EQS behavior under Edge. This draft includes enough words to cross the minimum requirement while keeping semantics stable for troubleshooting and reproducibility.");

  const polishBtn = page.getByRole("button", { name: /Polish with AI/i });
  await polishBtn.click();
  await page.waitForTimeout(3000);
  output.flow.polish = "ok";

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(TEST_IMAGE);
  await page.waitForTimeout(3000);
  output.flow.upload = "ok";

  await deliverBtn.click();
  output.flow.publish = "clicked";

  await page.waitForTimeout(14000);

  const eqsHeading = page.getByText(/EQS result/i).first();
  if (await eqsHeading.isVisible().catch(() => false)) {
    output.flow.eqsResult = "visible";
  } else {
    output.flow.eqsResult = "missing";
  }

  output.urlAfterFlow = page.url();
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}
