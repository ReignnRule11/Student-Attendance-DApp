import { expect, test, type Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, parseAbi, toFunctionSelector } from "viem";

const CONTRACT_ADDRESS = "0x66d5E20AFEA78C97BefC47FaCd462D93b888C703";
const OTHER_CONTRACT = "0x1111111111111111111111111111111111111111";
const ADMIN_ADDRESS = "0x1000000000000000000000000000000000000001";
const STUDENT_ADDRESS = "0x2000000000000000000000000000000000000002";
const OTHER_WALLET = "0x3000000000000000000000000000000000000003";
const TX_HASH = `0x${"aa".repeat(32)}`;
const VALID_SIG = `0x${"11".repeat(64)}1b`;

const abi = parseAbi([
  "function admin() view returns (address)",
  "function pendingAdmin() view returns (address)",
  "function nextSessionId() view returns (uint256)",
  "function instructors(address) view returns (bool)",
  "function registeredStudents(address) view returns (bool)",
  "function sessions(uint256) view returns (address instructor, uint64 startsAt, uint64 endsAt, uint64 qrNonce, bool active)",
  "function hasAttended(uint256, address) view returns (bool)",
]);

const selectors = {
  admin: toFunctionSelector("admin()"),
  pendingAdmin: toFunctionSelector("pendingAdmin()"),
  nextSessionId: toFunctionSelector("nextSessionId()"),
  instructors: toFunctionSelector("instructors(address)"),
  registeredStudents: toFunctionSelector("registeredStudents(address)"),
  sessions: toFunctionSelector("sessions(uint256)"),
  hasAttended: toFunctionSelector("hasAttended(uint256,address)"),
};

const multicallAbi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
const multicallSelector = toFunctionSelector("aggregate3((address,bool,bytes)[])");

function resolveContractCall(data: `0x${string}`, now: bigint): `0x${string}` {
  const sel = data.slice(0, 10).toLowerCase();
  if (sel === selectors.admin) {
    return encodeFunctionResult({ abi, functionName: "admin", result: ADMIN_ADDRESS });
  }
  if (sel === selectors.pendingAdmin) {
    return encodeFunctionResult({
      abi,
      functionName: "pendingAdmin",
      result: "0x0000000000000000000000000000000000000000",
    });
  }
  if (sel === selectors.nextSessionId) {
    return encodeFunctionResult({ abi, functionName: "nextSessionId", result: BigInt(2) });
  }
  if (sel === selectors.instructors) {
    return encodeFunctionResult({ abi, functionName: "instructors", result: false });
  }
  if (sel === selectors.registeredStudents) {
    return encodeFunctionResult({ abi, functionName: "registeredStudents", result: true });
  }
  if (sel === selectors.sessions) {
    return encodeFunctionResult({
      abi,
      functionName: "sessions",
      result: [ADMIN_ADDRESS, now - BigInt(60), now + BigInt(3600), BigInt(1), true],
    });
  }
  if (sel === selectors.hasAttended) {
    return encodeFunctionResult({ abi, functionName: "hasAttended", result: false });
  }
  return "0x";
}

type MockRpcOptions = {
  receiptStatus?: "0x1" | "0x0" | null;
  receiptDelayMs?: number;
  abortReceipt?: boolean;
};

async function setupMockWalletAndRpc(page: Page, options: MockRpcOptions = {}) {
  const state = {
    sendTxCount: 0,
    receiptCalls: 0,
    receiptStatus: options.receiptStatus ?? "0x1",
    receiptDelayMs: options.receiptDelayMs ?? 0,
    abortReceipt: options.abortReceipt ?? false,
    failAllRpc: false,
  };

  await page.addInitScript(
    ({ initialAccount, txHash }) => {
      let currentAccount = initialAccount;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

      const emit = (event: string, ...args: unknown[]) => {
        for (const cb of listeners.get(event) ?? []) cb(...args);
      };

      const provider = {
        isMetaMask: true,
        on(event: string, cb: (...args: unknown[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(cb);
        },
        removeListener(event: string, cb: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(cb);
        },
        async request({ method }: { method: string; params?: unknown[] }) {
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "net_version") return "11155111";
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return currentAccount ? [currentAccount] : [];
          }
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction") {
            (window as unknown as { __txSendCount: number }).__txSendCount += 1;
            const delay = (window as unknown as { __txSendDelayMs: number }).__txSendDelayMs || 0;
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            return txHash;
          }
          return null;
        },
      };

      (window as unknown as Record<string, unknown>).__txSendCount = 0;
      (window as unknown as Record<string, unknown>).__txSendDelayMs = 0;
      (window as unknown as Record<string, unknown>).__mockWallet = {
        switchAccount(next: string) {
          currentAccount = next;
          emit("accountsChanged", [next]);
        },
      };
      Object.defineProperty(window, "ethereum", {
        value: provider,
        configurable: true,
        writable: true,
      });
    },
    { initialAccount: STUDENT_ADDRESS, txHash: TX_HASH },
  );

  await page.route(
    (url) =>
      url.href.includes("publicnode.com") ||
      url.href.includes("tenderly.co"),
    async (route) => {
      if (state.failAllRpc) {
        await route.abort("failed");
        return;
      }
      const body = route.request().postDataJSON() as
        | { id: number; method: string; params?: unknown[] }
        | Array<{ id: number; method: string; params?: unknown[] }>;
      const requests = Array.isArray(body) ? body : [body];

      for (const req of requests) {
        if (req.method === "eth_getTransactionReceipt") {
          state.receiptCalls += 1;
          if (state.receiptDelayMs > 0) {
            await new Promise((r) => setTimeout(r, state.receiptDelayMs));
          }
          if (state.abortReceipt) {
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32000, message: "RPC connection lost during confirmation" },
              }),
            });
            return;
          }
        }
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      const responses = requests.map((req) => {
        if (req.method === "eth_chainId") {
          return { jsonrpc: "2.0", id: req.id, result: "0xaa36a7" };
        }
        if (req.method === "eth_getCode") {
          return { jsonrpc: "2.0", id: req.id, result: "0x60806040" };
        }
        if (req.method === "eth_blockNumber") {
          return { jsonrpc: "2.0", id: req.id, result: "0x100" };
        }
        if (req.method === "eth_getTransactionReceipt") {
          if (state.receiptStatus === null) {
            return { jsonrpc: "2.0", id: req.id, result: null };
          }
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              transactionHash: TX_HASH,
              blockNumber: "0x100",
              blockHash: `0x${"bb".repeat(32)}`,
              status: state.receiptStatus,
              logs: [],
            },
          };
        }
        if (req.method === "eth_call") {
          const callObj = (req.params?.[0] ?? {}) as { data?: string; input?: string };
          const data = (callObj.data ?? callObj.input ?? "0x") as `0x${string}`;
          const sel = data.slice(0, 10).toLowerCase();
          let result: `0x${string}` = "0x";
          if (sel === multicallSelector) {
            const decoded = decodeFunctionData({ abi: multicallAbi, data });
            const calls = decoded.args[0] as ReadonlyArray<{
              target: `0x${string}`;
              allowFailure: boolean;
              callData: `0x${string}`;
            }>;
            const results = calls.map((c) => {
              const returnData = resolveContractCall(c.callData, now);
              return { success: returnData !== "0x", returnData };
            });
            result = encodeFunctionResult({
              abi: multicallAbi,
              functionName: "aggregate3",
              result: results,
            });
          } else {
            result = resolveContractCall(data, now);
          }
          return { jsonrpc: "2.0", id: req.id, result };
        }
        return { jsonrpc: "2.0", id: req.id, result: null };
      });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(Array.isArray(body) ? responses : responses[0]),
      });
    },
  );

  return state;
}

async function connectMockWallet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("button", { name: /Browser Wallet/i }).click();
  await expect(page.getByText("Connected · Sepolia")).toBeVisible();
}

function validQrJson(overrides: Record<string, unknown> = {}) {
  const futureExpiry = String(Math.floor(Date.now() / 1000) + 1800);
  return JSON.stringify({
    version: 1,
    chainId: 11155111,
    contractAddress: CONTRACT_ADDRESS,
    sessionId: "1",
    qrNonce: "1",
    expiresAt: futureExpiry,
    signature: VALID_SIG,
    ...overrides,
  });
}

test.describe("Adversarial frontend & integration checks", () => {
  test("ADV-003: rejects QR payload targeting a different contract address", async ({ page }) => {
    await setupMockWalletAndRpc(page);
    await connectMockWallet(page);

    await page.getByLabel("Or paste the QR payload").fill(
      validQrJson({ contractAddress: OTHER_CONTRACT }),
    );
    await page.getByRole("button", { name: "Submit attendance" }).click();

    await expect(page.getByText("This QR belongs to a different contract address.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __txSendCount: number }).__txSendCount)).toBe(0);
  });

  test("ADV-004: rejects expired QR payload before sending a transaction", async ({ page }) => {
    await setupMockWalletAndRpc(page);
    await connectMockWallet(page);

    await page.getByLabel("Or paste the QR payload").fill(
      validQrJson({ expiresAt: "1700000000" }),
    );
    await page.getByRole("button", { name: "Submit attendance" }).click();

    await expect(page.getByText("This attendance QR has expired.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __txSendCount: number }).__txSendCount)).toBe(0);
  });

  test("ADV-005: rejects oversized QR JSON without freezing the UI", async ({ page }) => {
    await setupMockWalletAndRpc(page);
    await connectMockWallet(page);

    const oversized = JSON.stringify({ version: 1, pad: "x".repeat(5000) });
    await page.getByLabel("Or paste the QR payload").fill(oversized);
    await page.getByRole("button", { name: "Submit attendance" }).click();

    await expect(page.getByText("QR payload exceeds the maximum allowed size.")).toBeVisible();
  });

  test("ADV-006: prevents duplicate concurrent submissions while confirmation is in flight", async ({ page }) => {
    await setupMockWalletAndRpc(page, { receiptDelayMs: 600 });
    await connectMockWallet(page);
    await page.evaluate(() => {
      (window as unknown as { __txSendDelayMs: number }).__txSendDelayMs = 300;
    });

    await page.getByLabel("Or paste the QR payload").fill(validQrJson());
    const submitBtn = page.locator("section.scanner-panel button.primary-action");
    await submitBtn.click();
    await expect(submitBtn).toBeDisabled();

    await expect(page.getByText("Attendance confirmed on Sepolia.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __txSendCount: number }).__txSendCount)).toBe(1);
  });

  test("ADV-007: surfaces a clear error when RPC disconnects during submission", async ({ page }) => {
    const rpc = await setupMockWalletAndRpc(page);
    await connectMockWallet(page);

    await page.getByLabel("Or paste the QR payload").fill(validQrJson());
    rpc.failAllRpc = true;
    await page.getByRole("button", { name: "Submit attendance" }).click();

    await expect(page.locator("section.scanner-panel [role='alert']")).toBeVisible();
    await expect(page.getByText("Attendance confirmed on Sepolia.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit attendance" })).toBeEnabled();
  });

  test("ADV-008: detects wallet switch mid-operation and avoids misattribution", async ({ page }) => {
    await setupMockWalletAndRpc(page, { receiptDelayMs: 600 });
    await connectMockWallet(page);

    await page.getByLabel("Or paste the QR payload").fill(validQrJson());
    await page.getByRole("button", { name: "Submit attendance" }).click();
    await expect(page.getByText("Transaction submitted. Waiting for Sepolia confirmation…")).toBeVisible();

    await page.evaluate((next) => {
      (window as unknown as { __mockWallet: { switchAccount: (a: string) => void } }).__mockWallet.switchAccount(next);
    }, OTHER_WALLET);

    await expect(page.getByText(/Wallet changed while the transaction was confirming/i)).toBeVisible();
    await expect(page.getByText("Attendance confirmed on Sepolia.")).toHaveCount(0);
  });

  test("ADV-009: reports failure when transaction receipt status is reverted (0x0)", async ({ page }) => {
    await setupMockWalletAndRpc(page, { receiptStatus: "0x0" });
    await connectMockWallet(page);

    await page.getByLabel("Or paste the QR payload").fill(validQrJson());
    await page.getByRole("button", { name: "Submit attendance" }).click();

    await expect(page.getByText("Transaction reverted on-chain. Attendance was not recorded.")).toBeVisible();
    await expect(page.getByText("Attendance confirmed on Sepolia.")).toHaveCount(0);
  });

  test("ADV-011: handles rapid camera start/stop interactions without uncaught errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await setupMockWalletAndRpc(page);
    await page.goto("/");

    const cameraBtn = page.getByRole("button", { name: "Open camera scanner" });
    await cameraBtn.click();
    await cameraBtn.click();
    await expect(page.locator("section.scanner-panel")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("ADV-012: recovers pending transaction status after page reload", async ({ page }) => {
    await setupMockWalletAndRpc(page, { receiptStatus: "0x1" });
    await connectMockWallet(page);

    await page.evaluate(
      ({ hash, address }) => {
        window.sessionStorage.setItem(
          "student-attendance-pending-tx:student-attendance",
          JSON.stringify({ hash, address, label: "Attendance for session #1", createdAt: Date.now() }),
        );
      },
      { hash: TX_HASH, address: STUDENT_ADDRESS },
    );

    await page.reload();

    await expect(page.getByText("Recovered attendance transaction confirmed on Sepolia.")).toBeVisible();
  });
});
