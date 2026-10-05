import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Sanket · Distribution workspace",
  description:
    "Wholesale inventory, vehicle sales and daily reconciliation in one connected workspace.",
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sanket" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
