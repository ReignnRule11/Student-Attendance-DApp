import type { Abi } from "viem";

export const studentAttendanceAbi = [
  {
    type: "function",
    name: "registeredStudents",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "sessions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "instructor", type: "address" },
      { name: "startsAt", type: "uint64" },
      { name: "endsAt", type: "uint64" },
      { name: "qrNonce", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "hasAttended",
    stateMutability: "view",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "student", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "markAttendance",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "qrNonce", type: "uint64" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;
