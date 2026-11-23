import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { signOut } from "@/app/logout/actions";
import { Link } from "@/i18n/navigation";
import { getGuestUser } from "@/server/auth/guest";
import { LocaleSwitcher } from "./LocaleSwitcher";

const NAV_LINK = "rounded-md px-2 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900";

/**
 * Guest site header: logo, Search, account links (Log in, or My bookings + Log out), language switch.
 * The account links and the switch's `signedIn` read the session (request time, read-only
 * `getGuestUser()`), so they stream in behind <Suspense>; the rest stays in the static shell.
 */
export async function Header() {
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-900">
          {tc("appName")}
        </Link>
        <Suspense fallback={<LocaleSwitcher className="sm:order-last" />}>
          <SessionLocaleSwitcher className="sm:order-last" />
        </Suspense>
        <nav aria-label={t("mainMenu")} className="w-full sm:w-auto sm:flex-1">
          <ul className="-mx-2 flex flex-wrap items-center gap-1 sm:mx-0">
            <li>
              <Link href="/" className={NAV_LINK}>
                {t("search")}
              </Link>
            </li>
            <Suspense>
              <AccountLinks />
            </Suspense>
          </ul>
        </nav>
      </div>
    </header>
  );
}

async function SessionLocaleSwitcher({ className }: { className: string }) {
  const user = await getGuestUser();
  return <LocaleSwitcher className={className} signedIn={user !== null} />;
}

async function AccountLinks() {
  const [user, t, locale] = await Promise.all([getGuestUser(), getTranslations("nav"), getLocale()]);

  if (!user) {
    return (
      <li>
        <Link href="/login" className={NAV_LINK}>
          {t("login")}
        </Link>
      </li>
    );
  }
  return (
    <>
      <li>
        <Link href="/bookings" className={NAV_LINK}>
          {t("myBookings")}
        </Link>
      </li>
      <li>
        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className={NAV_LINK}>
            {t("logout")}
          </button>
        </form>
      </li>
    </>
  );
}
