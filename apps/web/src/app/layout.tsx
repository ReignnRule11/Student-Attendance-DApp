import type { Metadata, Viewport } from "next";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Student Attendance | On-chain attendance",
  applicationName: "Student Attendance",
  description:
    "Wallet-based student attendance with instructor-authorized QR sessions on Ethereum Sepolia.",
  manifest: "./manifest.webmanifest",
  icons: {
    icon: [{ url: "./icon-192.svg", type: "image/svg+xml" }],
    apple: [{ url: "./icon-192.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Attendance",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080d17",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
