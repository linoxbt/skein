import type { Metadata } from "next";
import localFont from "next/font/local";
import { Footer, Nav } from "@/components/Chrome";
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

export const metadata: Metadata = {
  title: { default: "Skein Desk — the listing queue that decides itself", template: "%s · Skein Desk" },
  description: "A listing queue for a fictional exchange. An agent buys a Skein verdict for every application and acts on it: shortlist, decline, or the analyst queue.",
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
