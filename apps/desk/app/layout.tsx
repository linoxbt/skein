import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Footer, Nav } from "@/components/Chrome";
import "./globals.css";

const inter = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-inter-tight" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500"], variable: "--font-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

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
