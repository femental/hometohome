import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { paymentIdFromQuery } from "@/lib/payment-id";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { isBookingId } from "@/server/guest/bookings";
import { payDeps } from "@/server/payments/deps";
import { completePayment, type CompleteOutcome } from "@/server/payments/service";

export async function generateMetadata({ params }: PageProps<"/[locale]/bookings/[id]/pay/complete">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "pay" });
  return { title: t("completeHeading"), robots: { index: false } };
}

export default function CompletePage(props: PageProps<"/[locale]/bookings/[id]/pay/complete">) {
  return (
    <Suspense>
      <Complete {...props} />
    </Suspense>
  );
}

/**
 * Where PortOne returns after checkout (mobile redirect) and where the client goes after its own
 * verification. Shows only the server's verdict: the payment is re-verified with the PG here
 * (idempotent), for a payment on the caller's own booking.
 */
async function Complete({ params, searchParams }: PageProps<"/[locale]/bookings/[id]/pay/complete">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = await requireUser(isBookingId(id) ? `/${locale}/bookings/${id}` : `/${locale}/bookings`);
  const paymentId = paymentIdFromQuery((await searchParams).paymentId);
  if (!isBookingId(id) || !paymentId) notFound();

  const own = await prisma.payment.count({ where: { id: paymentId, bookingId: id, booking: { guestId: user.id } } });
  if (own === 0) notFound();

  const deps = payDeps();
  const outcome: CompleteOutcome = deps ? (await completePayment(deps, paymentId)).outcome : "unknown_payment";
  const t = await getTranslations("pay");
  const good = outcome === "confirmed" || outcome === "already_confirmed";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900">{t("completeHeading")}</h1>
      <Card>
        <p role="status" className={`text-sm ${good ? "text-green-800" : "text-zinc-800"}`}>
          {t(`outcome.${outcome}`)}
        </p>
      </Card>
      <Link href={`/bookings/${id}`} className="text-sm font-medium text-zinc-900 underline">
        {t("backToBooking")}
      </Link>
    </div>
  );
}
