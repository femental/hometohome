import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "../_components/LegalPage";

export function generateMetadata(props: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  return legalMetadata(props, "privacy", "/privacy");
}

export default function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  return <LegalPage params={params} doc="privacy" />;
}
