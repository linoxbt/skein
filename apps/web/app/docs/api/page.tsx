import type { Metadata } from "next";
import { PageHero } from "@skein/ui";
import { ApiReference } from "@/components/ApiReference";

export const metadata: Metadata = { title: "API reference" };

export default function ApiReferencePage() {
  return (
    <>
      <PageHero compact tag="API reference" title={<>Every route,<br />from the API itself.</>} sub="Rendered from the Skein API's own OpenAPI document, read live." />
      <ApiReference />
    </>
  );
}
