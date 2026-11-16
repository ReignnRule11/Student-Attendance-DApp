import type { Abi } from "viem";

export const studentAttendanceAbi = [
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "nextSessionId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "instructors", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "registeredStudents", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function", name: "sessions", stateMutability: "view", inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "instructor", type: "address" }, { name: "startsAt", type: "uint64" },
      { name: "endsAt", type: "uint64" }, { name: "qrNonce", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  { type: "function", name: "hasAttended", stateMutability: "view", inputs: [{ name: "sessionId", type: "uint256" }, { name: "student", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "authorizeInstructor", stateMutability: "nonpayable", inputs: [{ name: "instructor", type: "address" }], outputs: [] },
  { type: "function", name: "revokeInstructor", stateMutability: "nonpayable", inputs: [{ name: "instructor", type: "address" }], outputs: [] },
  { type: "function", name: "registerStudent", stateMutability: "nonpayable", inputs: [{ name: "student", type: "address" }], outputs: [] },
  { type: "function", name: "revokeStudent", stateMutability: "nonpayable", inputs: [{ name: "student", type: "address" }], outputs: [] },
  { type: "function", name: "createSession", stateMutability: "nonpayable", inputs: [{ name: "startsAt", type: "uint64" }, { name: "endsAt", type: "uint64" }], outputs: [{ name: "sessionId", type: "uint256" }] },
  { type: "function", name: "setSessionActive", stateMutability: "nonpayable", inputs: [{ name: "sessionId", type: "uint256" }, { name: "active", type: "bool" }], outputs: [] },
  { type: "function", name: "rotateQrNonce", stateMutability: "nonpayable", inputs: [{ name: "sessionId", type: "uint256" }], outputs: [] },
  { type: "function", name: "markAttendance", stateMutability: "nonpayable", inputs: [{ name: "sessionId", type: "uint256" }, { name: "expiresAt", type: "uint64" }, { name: "qrNonce", type: "uint64" }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "event", name: "SessionCreated", anonymous: false, inputs: [
    { name: "sessionId", type: "uint256", indexed: true }, { name: "instructor", type: "address", indexed: true },
    { name: "startsAt", type: "uint64", indexed: false }, { name: "endsAt", type: "uint64", indexed: false },
    { name: "qrNonce", type: "uint64", indexed: false },
  ] },
] as const satisfies Abi;
