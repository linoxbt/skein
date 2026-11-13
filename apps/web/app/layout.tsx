import type { Metadata } from "next";
import localFont from "next/font/local";
import { Footer } from "@/components/site/Footer";
import { Nav } from "@/components/site/Nav";
import { SITE } from "@/lib/site";
import "./globals.css";

// Self-hosted (app/fonts, OFL), so a build never depends on reaching Google Fonts.
const inter = localFont({
  src: [
    { path: "./fonts/inter-tight-latin-300-normal.woff2", weight: "300" },
    { path: "./fonts/inter-tight-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/inter-tight-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-inter-tight",
  display: "swap",
});
// Headings and the wordmark (spec section 11): 400 for display type, 500 for the wordmark.
const grotesk = localFont({
  src: [
    { path: "./fonts/space-grotesk-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/space-grotesk-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-grotesk",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

const DESCRIPTION =
  "Skein sells one decision: is this token fit to list. It buys ranked Telegraph intelligence, fuses it with fixed rules, and returns a verdict with reasons, cost and a receipt for every input.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Skein — One request. Every thread.", template: "%s · Skein" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Skein", title: "Skein — One request. Every thread.", description: DESCRIPTION, url: SITE },
  twitter: { card: "summary", title: "Skein — One request. Every thread.", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-24 focus:z-[60] focus:bg-thread focus:px-4 focus:py-2 focus:text-black">
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
