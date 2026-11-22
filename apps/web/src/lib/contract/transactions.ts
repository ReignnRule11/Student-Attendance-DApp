import type { TransactionReceipt } from "viem";

export type PendingTransactionRecord = {
  hash: `0x${string}`;
  address: `0x${string}`;
  label: string;
  createdAt?: number;
};

const STORAGE_PREFIX = "student-attendance-pending-tx:";

export function assertSuccessfulReceipt(
  receipt: Pick<TransactionReceipt, "status">,
  revertedMessage = "Transaction reverted on-chain. No state change was recorded.",
): void {
  if (receipt.status !== "success") {
    throw new Error(revertedMessage);
  }
}

export function savePendingTransaction(
  scope: string,
  record: PendingTransactionRecord,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${STORAGE_PREFIX}${scope}`,
      JSON.stringify({ ...record, createdAt: record.createdAt ?? Date.now() }),
    );
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

export function loadPendingTransaction(
  scope: string,
): PendingTransactionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${scope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTransactionRecord>;
    if (
      typeof parsed.hash === "string" &&
      parsed.hash.startsWith("0x") &&
      typeof parsed.address === "string" &&
      parsed.address.startsWith("0x") &&
      typeof parsed.label === "string"
    ) {
      return parsed as PendingTransactionRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingTransaction(scope: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
  } catch {
    // Ignore storage access errors.
  }
}
