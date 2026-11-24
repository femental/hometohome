import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "../_components/LegalPage";

export function generateMetadata(props: PageProps<"/[locale]/terms">): Promise<Metadata> {
  return legalMetadata(props, "terms", "/terms");
}

export default function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  return <LegalPage params={params} doc="terms" />;
}
