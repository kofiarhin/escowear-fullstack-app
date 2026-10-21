// IDE-118 browser smoke: drives the production build through the isolated
// harness in headless Chromium at desktop and mobile sizes.
//
//   npm run build --prefix client
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core node e2e/browser-smoke.cjs
//
// playwright-core is not a project dependency; point PLAYWRIGHT_CORE_PATH at
// an existing install (browsers come from the usual ms-playwright cache).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { start } = require("./harness.cjs");

const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const OUT = process.env.E2E_OUTPUT_DIR || path.join(__dirname, "..", "test-results", "e2e");

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 860 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

const results = [];
const pass = (name) => {
  results.push(`PASS ${name}`);
  console.log(`PASS ${name}`);
};

// Records console errors, page errors and failed/5xx requests for a page.
// Chrome logs every 4xx fetch as a console error; those are collected in
// `problems.expected4xx` and checked against the negative steps we trigger.
const watch = (page, label, problems) => {
  problems.expected4xx = problems.expected4xx || [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) return;
    problems.push(`${label} console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.status() < 500) problems.expected4xx.push(`${response.status()} ${new URL(response.url()).pathname.replace(/[a-f0-9]{24}/g, ":id")}`);
  });
  page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on("requestfailed", (request) => problems.push(`${label} requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${label} ${response.status()}: ${response.url()}`);
  });
};

const a11yAudit = (page) =>
  page.evaluate(() => {
    const issues = [];
    const h1s = document.querySelectorAll("main h1");
    if (h1s.length !== 1) issues.push(`expected one h1 in main, found ${h1s.length}`);
    document.querySelectorAll("main input, main select, main textarea").forEach((control) => {
      if (control.type === "hidden") return;
      const labelled = (control.id && document.querySelector(`label[for="${control.id}"]`)) || control.closest("label") || control.getAttribute("aria-label");
      if (!labelled) issues.push(`unlabelled ${control.tagName.toLowerCase()} ${control.name || control.id}`);
    });
    document.querySelectorAll("main button").forEach((button) => {
      if (!button.textContent.trim() && !button.getAttribute("aria-label")) issues.push("button without accessible name");
    });
    if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    return issues;
  });

const expectNoA11yIssues = async (page, label) => {
  const issues = await a11yAudit(page);
  assert.deepEqual(issues, [], `${label}: ${issues.join("; ")}`);
};

const runJourney = async (browser, harness, { name, ...contextOptions }) => {
  const problems = [];
  const shot = (page, step) => page.screenshot({ path: path.join(OUT, `${name}-${step}.png`), fullPage: true });

  // --- Customer: product -> cart -> checkout -> confirmation -----------------
  const customer = await browser.newContext(contextOptions);
  const page = await customer.newPage();
  watch(page, `${name}/customer`, problems);

  await page.goto(`${harness.url}/details/${harness.product._id}`);
  await page.getByRole("button", { name: "UK 9", exact: true }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL("**/cart");
  await page.getByRole("link", { name: /continue to checkout/i }).click();
  await page.waitForURL("**/checkout");
  await page.getByRole("note").filter({ hasText: /No payment now/ }).waitFor();
  await expectNoA11yIssues(page, `${name} checkout`);
  pass(`${name}: product → cart → checkout, no-payment notice, labelled controls, no overflow`);

  await page.getByRole("button", { name: "Place order request" }).click();
  await page.getByRole("alert").filter({ hasText: /correct the highlighted fields/i }).waitFor();
  assert.equal(await page.getByLabel("Full name").evaluate((element) => element === document.activeElement), true);
  pass(`${name}: empty submit blocked, errors announced, focus moved to first invalid field`);

  await page.getByLabel("Full name").fill("E2E Customer");
  await page.getByLabel("Email").fill(`${name}.customer@e2e.test`);
  await page.getByLabel("Ghana phone number").fill("024 123 4567");
  await page.getByLabel("Street address or house number").fill("1 Test Street");
  await page.getByLabel("Town or city").fill("Accra");
  await page.getByLabel("Region").selectOption("Greater Accra");
  await page.getByLabel(/I understand this is an order request/).check();
  await shot(page, "1-checkout");
  // Keyboard submit: focus the button and press Enter.
  await page.getByRole("button", { name: "Place order request" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Order received — awaiting our email" }).waitFor();
  const orderNumber = (await page.locator(".order-confirmation-reference strong").textContent()).trim();
  assert.match(orderNumber, /^EW-/);
  assert.equal(await page.evaluate(() => localStorage.getItem("escowear-cart-v1")), "[]");
  await page.getByText(/not paid and not yet confirmed/i).waitFor();
  await expectNoA11yIssues(page, `${name} confirmation`);
  await shot(page, "2-confirmation");
  pass(`${name}: keyboard submit creates ${orderNumber}, received-only receipt, cart cleared`);

  const confirmationUrl = page.url();
  const stranger = await browser.newContext(contextOptions);
  const strangerPage = await stranger.newPage();
  watch(strangerPage, `${name}/stranger`, problems);
  await strangerPage.goto(confirmationUrl);
  await strangerPage.getByRole("heading", { name: /order details unavailable/i }).waitFor();
  assert.equal(await strangerPage.getByText(orderNumber).count(), 0);
  await stranger.close();
  pass(`${name}: confirmation URL alone reveals nothing in another browser`);

  // --- Admin: quote -> proof -> bank verification -> dispatch ----------------
  const adminContext = await browser.newContext(contextOptions);
  const adminPage = await adminContext.newPage();
  watch(adminPage, `${name}/admin`, problems);
  const session = await (await fetch(`${harness.url}/__e2e/admin-session`)).json();
  // Seed the admin session from a same-origin page that makes no API calls.
  await adminPage.goto(`${harness.url}/__e2e/outbox`);
  await adminPage.evaluate((user) => localStorage.setItem("user", JSON.stringify(user)), session);
  await adminPage.goto(`${harness.url}/admin/orders`);
  await adminPage.getByRole("link", { name: orderNumber }).click();
  await adminPage.getByRole("heading", { name: orderNumber }).waitFor();
  await expectNoA11yIssues(adminPage, `${name} admin detail`);

  const actionForm = (title) => adminPage.locator("form.admin-action").filter({ has: adminPage.getByRole("heading", { name: title }) });
  const quote = actionForm("Send GHS quote and payment instructions");
  await quote.getByLabel("Items (GHS)").fill("1800.00");
  await quote.getByLabel("Fees (GHS)").fill("50");
  await quote.getByLabel("Shipping (GHS)").fill("150.00");
  await quote.getByLabel("Duties (GHS)").fill("0");
  const expiry = new Date(Date.now() + 2 * 86400000);
  const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await quote.getByLabel("Quote valid until").fill(localExpiry);
  await quote.getByRole("button", { name: "Send payment instructions" }).click();
  await adminPage.getByText(/send payment instructions: saved\. email queued/i).waitFor();
  await adminPage.getByText(/awaiting payment/i).first().waitFor();

  await actionForm("Payment proof received by email").getByRole("button", { name: "Mark proof under review" }).click();
  await adminPage.getByText(/mark proof under review: saved/i).waitFor();

  const verify = actionForm("Verify bank receipt");
  await verify.getByLabel("Amount received (GHS)").fill("1999.00");
  await verify.getByLabel("Bank transaction reference").fill("E2E-TXN-1");
  const received = new Date(Date.now() - 5 * 60000);
  await verify.getByLabel("Funds received at").fill(new Date(received.getTime() - received.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await verify.getByLabel(/personally confirmed these funds arrived/).check();
  await verify.getByRole("button", { name: "Confirm payment verified" }).click();
  await adminPage.getByRole("alert").filter({ hasText: /does not match the quote/i }).waitFor();
  pass(`${name}: admin quote sent; mismatched bank amount refused`);

  await verify.getByLabel("Amount received (GHS)").fill("2000.00");
  await verify.getByRole("button", { name: "Confirm payment verified" }).click();
  await adminPage.getByText(/confirm payment verified: saved/i).waitFor();

  const fulfil = () => actionForm("Update fulfilment");
  await fulfil().getByLabel("Next step").selectOption("processing");
  await fulfil().getByRole("button", { name: "Save fulfilment step" }).click();
  await adminPage.getByText(/save fulfilment step: saved/i).waitFor();
  await fulfil().getByLabel("Next step").selectOption("dispatched");
  await fulfil().getByLabel("Carrier").fill("E2E Courier");
  await fulfil().getByLabel("Tracking number").fill("E2E-TRACK-9");
  await fulfil().getByRole("button", { name: "Save fulfilment step" }).click();
  await adminPage.getByText("E2E Courier", { exact: false }).first().waitFor();
  await shot(adminPage, "3-admin");
  pass(`${name}: bank receipt verified, processing → dispatched with carrier`);

  // --- Guest tracking with emailed one-time code ----------------------------
  const guest = await browser.newContext(contextOptions);
  const guestPage = await guest.newPage();
  watch(guestPage, `${name}/guest`, problems);
  await guestPage.goto(`${harness.url}/track-order?order=${orderNumber}`);
  await guestPage.getByLabel("Email").fill(`${name}.customer@e2e.test`);
  await guestPage.getByRole("button", { name: "Email me a code" }).click();
  await guestPage.getByLabel("6-digit code").waitFor();
  let code;
  for (let attempt = 0; attempt < 40 && !code; attempt += 1) {
    const mails = await (await fetch(`${harness.url}/__e2e/outbox`)).json();
    code = mails.filter((mail) => mail.subject.includes(orderNumber) && /tracking code/.test(mail.subject)).at(-1)?.text.match(/is: (\d{6})/)?.[1];
    if (!code) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(code, "tracking code email delivered by worker");
  await guestPage.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
  await guestPage.getByRole("button", { name: "View my order" }).click();
  await guestPage.getByRole("alert").filter({ hasText: /not valid or has expired/i }).waitFor();
  await guestPage.getByLabel("6-digit code").fill(code);
  await guestPage.getByRole("button", { name: "View my order" }).click();
  await guestPage.getByRole("heading", { name: "Dispatched" }).waitFor();
  await guestPage.getByText("E2E-TRACK-9").waitFor();
  const visible = await guestPage.locator("main").innerText();
  assert.ok(!/E2E-TXN-1|E2E TEST CHANNEL/.test(visible), "no bank reference or channel shown to the guest");
  await expectNoA11yIssues(guestPage, `${name} order details`);
  await shot(guestPage, "4-tracking");
  pass(`${name}: wrong code rejected, emailed code grants order view with tracking, no internal data`);

  // Emails produced by the journey, in order.
  const mails = (await (await fetch(`${harness.url}/__e2e/outbox`)).json()).filter((mail) => mail.subject.includes(orderNumber));
  const kinds = mails.map((mail) => mail.subject.replace(/ — #.*/, ""));
  for (const expected of ["EscoWear order received", "EscoWear payment details", "EscoWear order confirmed", "EscoWear order update", "Your EscoWear tracking code"]) {
    assert.ok(kinds.includes(expected), `missing email: ${expected}`);
  }
  assert.equal(new Set(mails.map((mail) => mail.idempotencyKey)).size, mails.length, "no duplicate email sends");
  pass(`${name}: ${mails.length} customer emails, each sent once`);

  await Promise.all([customer.close(), adminContext.close(), guest.close()]);
  // Only the deliberate negative steps may produce 4xx responses.
  assert.deepEqual(problems.expected4xx.sort(), ["400 /api/orders/tracking/verify", "422 /api/admin/orders/:id/verify-payment"]);
  // Images in this harness are local; any other problem is a real failure.
  assert.deepEqual([...problems], [], problems.join("\n"));
  pass(`${name}: no console errors, page errors, failed requests or 5xx responses`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const harness = await start();
  console.log(`Harness data store: ${harness.database}`);
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) await runJourney(browser, harness, viewport);
    console.log(`\n${results.length} checks passed. Screenshots: ${OUT}`);
  } finally {
    await browser.close();
    await harness.stop();
  }
})().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
