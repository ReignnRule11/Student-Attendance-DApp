import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Student Attendance | On-chain attendance",
  description:
    "Wallet-based student attendance with instructor-authorized QR sessions on Ethereum Sepolia.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
