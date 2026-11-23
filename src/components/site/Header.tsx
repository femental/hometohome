import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./LocaleSwitcher";

const NAV_LINK = "rounded-md px-2 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900";

/**
 * Guest site header: logo, Search, My bookings, Log in, language switch.
 * TODO(Task 2): show "Log out" (and pass `signedIn` to LocaleSwitcher) from the read-only
 * `getGuestUser()`. The current `getSessionUser()` syncs the users row (a DB write) on every call,
 * so the header always renders the signed-out state for now.
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
        <LocaleSwitcher className="sm:order-last" />
        <nav aria-label={t("mainMenu")} className="w-full sm:w-auto sm:flex-1">
          <ul className="-mx-2 flex flex-wrap items-center gap-1 sm:mx-0">
            <li>
              <Link href="/" className={NAV_LINK}>
                {t("search")}
              </Link>
            </li>
            <li>
              <Link href="/bookings" className={NAV_LINK}>
                {t("myBookings")}
              </Link>
            </li>
            <li>
              <Link href="/login" className={NAV_LINK}>
                {t("login")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
