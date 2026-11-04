import type { Metadata, Viewport } from "next";
import { DM_Sans, Syne } from "next/font/google";
import { SITE_URL } from "@/lib/hosts";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Kiota",
  description:
    "Kiota runs fees, report cards, parent messages and boarding for Kenyan schools, from primary to senior school.",
  applicationName: "Kiota",
  openGraph: {
    type: "website",
    siteName: "Kiota",
    locale: "en_KE",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#1F5F63",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
