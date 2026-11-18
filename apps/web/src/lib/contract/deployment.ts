import { getAddress, isAddress, type Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
const configuredAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();

export const studentAttendanceAddress: Address | undefined =
  configuredAddress && isAddress(configuredAddress)
    ? getAddress(configuredAddress)
    : undefined;

export const isStudentAttendanceConfigured = Boolean(studentAttendanceAddress);
