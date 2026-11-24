import type { ComponentType } from "react";
import type { Locale } from "@/i18n/routing";
import { Faq as FaqEn } from "./en/faq";
import { Privacy as PrivacyEn } from "./en/privacy";
import { RefundPolicy as RefundPolicyEn } from "./en/refund-policy";
import { Terms as TermsEn } from "./en/terms";
import { Faq as FaqKo } from "./ko/faq";
import { Privacy as PrivacyKo } from "./ko/privacy";
import { RefundPolicy as RefundPolicyKo } from "./ko/refund-policy";
import { Terms as TermsKo } from "./ko/terms";

export type LegalDoc = "terms" | "privacy" | "refundPolicy" | "faq";

export const LEGAL_CONTENT: Record<Locale, Record<LegalDoc, ComponentType>> = {
  en: { terms: TermsEn, privacy: PrivacyEn, refundPolicy: RefundPolicyEn, faq: FaqEn },
  ko: { terms: TermsKo, privacy: PrivacyKo, refundPolicy: RefundPolicyKo, faq: FaqKo },
};
