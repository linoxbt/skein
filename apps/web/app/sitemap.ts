import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

const PAGES = ["", "/how-it-works", "/tutorial", "/docs", "/policies", "/verify", "/ledger", "/status"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE}${p}`, changeFrequency: p === "" || p === "/status" || p === "/ledger" ? "daily" : "weekly", priority: p === "" ? 1 : 0.6 }));
}
