import { isAddress, isHex } from "viem";

export type AttendanceQrPayload = {
  version: 1;
  chainId: 11155111;
  contractAddress: `0x${string}`;
  sessionId: string;
  qrNonce: string;
  expiresAt: string;
  signature: `0x${string}`;
};

export function parseAttendanceQrPayload(raw: string): AttendanceQrPayload {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") {
    throw new Error("QR data is not a valid attendance payload.");
  }

  const item = value as Record<string, unknown>;
  const maxUint64 = BigInt("18446744073709551615");
  const maxUint256 = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935");
  if (
    item.version !== 1 ||
    item.chainId !== 11155111 ||
    typeof item.contractAddress !== "string" ||
    !isAddress(item.contractAddress) ||
    typeof item.sessionId !== "string" ||
    !/^[0-9]+$/.test(item.sessionId) ||
    BigInt(item.sessionId) <= BigInt(0) ||
    BigInt(item.sessionId) > maxUint256 ||
    typeof item.qrNonce !== "string" ||
    !/^[0-9]+$/.test(item.qrNonce) ||
    BigInt(item.qrNonce) <= BigInt(0) ||
    BigInt(item.qrNonce) > maxUint64 ||
    typeof item.expiresAt !== "string" ||
    !/^[0-9]+$/.test(item.expiresAt) ||
    BigInt(item.expiresAt) <= BigInt(0) ||
    BigInt(item.expiresAt) > maxUint64 ||
    typeof item.signature !== "string" ||
    !isHex(item.signature, { strict: true }) ||
    item.signature.length !== 132
  ) {
    throw new Error("QR payload is incomplete or has an unsupported format.");
  }

  return item as AttendanceQrPayload;
}
