import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "../_components/LegalPage";

export function generateMetadata(props: PageProps<"/[locale]/faq">): Promise<Metadata> {
  return legalMetadata(props, "faq", "/faq");
}

export default function FaqPage({ params }: PageProps<"/[locale]/faq">) {
  return <LegalPage params={params} doc="faq" />;
}
