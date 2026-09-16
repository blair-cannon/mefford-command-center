import type { Metadata } from "next";
import "./globals.css";
import "./customer-surveys.css";
import "./desktop-fluid.css";
import "./interface-polish.css";
import "./estimating-review.css";
import "./work-surfaces.css";
import "./responsive-workspaces.css";
import "./owner-billing-print.css";
import "./usability.css";
import "./project-workspace.css";
import { PhotoUploadCompatibility } from "./photo-upload-compatibility";

export const metadata: Metadata = {
  title: "Mefford Project Command Center",
  description: "Construction project operations for Mefford Contracting.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/mefford-logo.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mefford Command Center",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#111111" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="format-detection" content="telephone=yes" />
      </head>
      <body className="antialiased">
        <PhotoUploadCompatibility />
        {children}
      </body>
    </html>
  );
}
