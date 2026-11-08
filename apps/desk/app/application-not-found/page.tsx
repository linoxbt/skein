import type { Metadata } from "next";
import NotFound from "../not-found";

export const metadata: Metadata = { title: "Application not found", robots: { index: false } };

/** Where middleware.ts sends /a/{id} for an application the Desk does not have, with a 404 status. */
export default function ApplicationNotFound() {
  return <NotFound />;
}
