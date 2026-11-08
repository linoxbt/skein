import type { Metadata } from "next";
import NotFound from "../not-found";

export const metadata: Metadata = { title: "Verdict not found", robots: { index: false } };

/** Where middleware.ts sends /v/{id} for an id the API does not know, with a 404 status. */
export default function VerdictNotFound() {
  return <NotFound />;
}
