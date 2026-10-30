import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Footer } from "@/components/site/Footer";
import { Nav } from "@/components/site/Nav";
import "./globals.css";

const inter = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-inter-tight" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500"], variable: "--font-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "Skein — One request. Every thread.", template: "%s · Skein" },
  description:
    "Skein sells one decision: is this token fit to list. It buys ranked Telegraph intelligence, fuses it with fixed rules, and returns a verdict with reasons, cost and a receipt for every input.",
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
