import { expect, test } from "@playwright/test";

test("home page exposes the main attendance workflows", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Attendance that is verifiable/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect on Sepolia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create a signed attendance QR" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scan and record attendance" })).toBeVisible();
});

test("deployment panel identifies the configured Sepolia contract", async ({ page }) => {
  await page.goto("/");

  const contractAddress = "0x66d5E20AFEA78C97BefC47FaCd462D93b888C703";
  await expect(page.getByRole("heading", { name: "Sepolia contract status" })).toBeVisible();
  await expect(page.getByText(contractAddress)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View contract on Sepolia Etherscan" }),
  ).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${contractAddress}`);
  await expect(page.getByRole("button", { name: /Recheck deployment|Checking…/ })).toBeVisible();
});

test("student submission remains disabled until a wallet is connected", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Submit attendance" })).toBeDisabled();
  await expect(page.getByLabel("Or paste the QR payload")).toBeVisible();
});


test("PWA manifest and service worker are available", async ({ page, request }) => {
  await page.goto("/");
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", "./manifest.webmanifest");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.name).toBe("Student Attendance");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(1);

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBeTruthy();
});

test("main workflows fit common mobile and tablet viewports without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  for (const width of [360, 390, 480, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
  await expect(page.getByRole("link", { name: /Connect wallet/i })).toBeVisible();
  await expect(page.getByLabel("Or paste the QR payload")).toBeVisible();
});


test("cached application shell can reopen while offline", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Attendance that is verifiable/i })).toBeVisible();
});
