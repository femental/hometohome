import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "../_components/LegalPage";

export function generateMetadata(props: PageProps<"/[locale]/refund-policy">): Promise<Metadata> {
  return legalMetadata(props, "refundPolicy", "/refund-policy");
}

export default function RefundPolicyPage({ params }: PageProps<"/[locale]/refund-policy">) {
  return <LegalPage params={params} doc="refundPolicy" />;
}
