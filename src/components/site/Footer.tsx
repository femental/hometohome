import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Pages arrive in Task 7 (src/app/[locale]/(legal)/...).
const LEGAL_LINKS = [
  { href: "/terms", key: "terms" },
  { href: "/privacy", key: "privacy" },
  { href: "/refund-policy", key: "refundPolicy" },
  { href: "/faq", key: "faq" },
] as const;

/** Guest site footer. TODO(Task 7): business registration details (사업자 정보) from env. */
export async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-zinc-600 sm:px-6">
        <nav aria-label={t("legalLinks")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.map(({ href, key }) => (
              <li key={key}>
                <Link href={href} className="hover:text-zinc-900 hover:underline">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-xs text-zinc-500">{t("copyright")}</p>
      </div>
    </footer>
  );
}
