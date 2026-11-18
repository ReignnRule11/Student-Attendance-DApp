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
