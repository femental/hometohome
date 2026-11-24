import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatDate, formatKRW, formatKST } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { listMyBookings } from "@/server/guest/bookings";
import { BookingStatusBadge } from "./_components/BookingStatus";

export async function generateMetadata({ params }: PageProps<"/[locale]/bookings">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "bookings" });
  return { title: t("metaTitle"), robots: { index: false } };
}

// Localized page pattern: params are read inside <Suspense> (see ../page.tsx).
export default function MyBookingsPage({ params }: PageProps<"/[locale]/bookings">) {
  return (
    <Suspense>
      <MyBookings params={params} />
    </Suspense>
  );
}

async function MyBookings({ params }: Pick<PageProps<"/[locale]/bookings">, "params">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await requireUser(`/${locale}/bookings`);
  const [rows, t] = await Promise.all([listMyBookings(prisma, user.id, new Date()), getTranslations("bookings")]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900">{t("heading")}</h1>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-700">{t("empty")}</p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            {t("findRoom")}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bookings/${b.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-400"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-zinc-900">{pickText(b.houseName, locale)}</p>
                    <p className="break-words text-sm text-zinc-600">{pickText(b.roomName, locale)}</p>
                  </div>
                  <BookingStatusBadge status={b.status} />
                </div>
                <p className="text-sm text-zinc-700">
                  {t("stayRange", { from: formatDate(b.moveIn, locale), to: formatDate(b.lastNight, locale) })} ·{" "}
                  {t("guests", { count: b.occupants })}
                </p>
                <p className="text-sm text-zinc-700">
                  {t("firstPayment", { amount: formatKRW(b.firstPaymentTotal) })}{" "}
                  <span className="text-xs text-zinc-500">{formatUsdReference(b.firstPaymentTotal)}</span>
                </p>
                {b.status === "requested" && b.requestExpiresAt && (
                  <p className="text-xs text-zinc-500">{t("respondBy", { time: formatKST(b.requestExpiresAt) })}</p>
                )}
                {b.status === "awaiting_payment" && b.holdExpiresAt && (
                  <p className="text-sm font-medium text-amber-800">{t("payBy", { time: formatKST(b.holdExpiresAt) })}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
