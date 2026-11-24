import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { routing } from "@/i18n/routing";
import { sendMagicLink, signInWithGoogle } from "./actions";

const ERROR_KEYS = ["email", "send", "oauth", "auth", "rate"] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("title"), robots: { index: false } };
}

// Localized page pattern: params and searchParams are read inside <Suspense> (see ../page.tsx).
export default function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  return (
    <div className="flex justify-center py-6">
      <Suspense>
        <Login params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Login({ params, searchParams }: Pick<PageProps<"/[locale]/login">, "params" | "searchParams">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  const query = await searchParams;
  const next = first(query.next) ?? "";
  const errorParam = first(query.error);
  const error = ERROR_KEYS.find((k): k is ErrorKey => k === errorParam);
  const sent = first(query.sent) === "1";

  return (
    <Card title={t("title")} className="w-full max-w-sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600">{t("intro")}</p>
        {sent && (
          <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            {t("sent")}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {t(`errors.${error}`)}
          </p>
        )}

        <form action={sendMagicLink} className="flex flex-col gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next} />
          <Field label={t("email")} name="email" type="email" autoComplete="email" inputMode="email" required />
          <Button type="submit">{t("sendLink")}</Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          {t("or")}
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <form action={signInWithGoogle}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="secondary" className="w-full">
            {t("google")}
          </Button>
        </form>
      </div>
    </Card>
  );
}
