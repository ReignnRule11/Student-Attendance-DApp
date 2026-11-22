import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_QR_PAYLOAD_LENGTH,
  parseAttendanceQrPayload,
} from "../../src/lib/qr/attendance-payload.ts";

const VALID_CONTRACT = "0x66d5E20AFEA78C97BefC47FaCd462D93b888C703";
const VALID_SIGNATURE = `0x${"11".repeat(64)}1b`;

function makeValidPayload(overrides = {}) {
  return JSON.stringify({
    version: 1,
    chainId: 11155111,
    contractAddress: VALID_CONTRACT,
    sessionId: "1",
    qrNonce: "1",
    expiresAt: "1893456000",
    signature: VALID_SIGNATURE,
    ...overrides,
  });
}

describe("parseAttendanceQrPayload (ADV-005 & format validation)", () => {
  it("accepts a well-formed attendance QR payload", () => {
    const parsed = parseAttendanceQrPayload(makeValidPayload());
    assert.equal(parsed.version, 1);
    assert.equal(parsed.chainId, 11155111);
    assert.equal(parsed.sessionId, "1");
    assert.equal(parsed.qrNonce, "1");
  });

  it("rejects empty input", () => {
    assert.throws(() => parseAttendanceQrPayload(""), /empty/i);
  });

  it("rejects oversized payloads exceeding MAX_QR_PAYLOAD_LENGTH", () => {
    const huge = JSON.stringify({
      version: 1,
      padding: "a".repeat(MAX_QR_PAYLOAD_LENGTH + 1),
    });
    assert.throws(() => parseAttendanceQrPayload(huge), /maximum allowed size/i);
  });

  it("rejects malformed JSON", () => {
    assert.throws(() => parseAttendanceQrPayload("{not-json"), /not valid JSON/i);
  });

  it("rejects JSON arrays", () => {
    assert.throws(() => parseAttendanceQrPayload("[1, 2, 3]"), /not a valid attendance payload/i);
  });

  it("rejects deeply nested objects within the size limit", () => {
    let nested = '{"a":1}';
    for (let i = 0; i < 200; i += 1) {
      nested = `{"a":${nested}}`;
    }
    assert.ok(nested.length <= MAX_QR_PAYLOAD_LENGTH);
    assert.throws(
      () => parseAttendanceQrPayload(nested),
      /incomplete or has an unsupported format/i,
    );
  });

  it("rejects wrong chainId, invalid signature length, and uint64 overflow", () => {
    assert.throws(() => parseAttendanceQrPayload(makeValidPayload({ chainId: 1 })));
    assert.throws(() => parseAttendanceQrPayload(makeValidPayload({ signature: "0x1234" })));
    assert.throws(() =>
      parseAttendanceQrPayload(makeValidPayload({ qrNonce: "18446744073709551616" })),
    );
    assert.throws(() => parseAttendanceQrPayload(makeValidPayload({ sessionId: "0" })));
  });
});
