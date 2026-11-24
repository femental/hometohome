"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";

/**
 * Unexpected error on a guest page: localized message inside the site layout, with a retry.
 * Server errors arrive with only a digest (no details), which is shown so support can find the log.
 */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("common.errorPage");
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <meta name="robots" content="noindex" />
      <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
      <p className="text-sm text-zinc-600">{t("body")}</p>
      {digest && <p className="text-xs text-zinc-400">#{digest}</p>}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => retry()}>
          {t("retry")}
        </Button>
        <Link href="/" className="text-sm font-medium text-zinc-900 underline">
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
