"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/logout/actions";

const LINKS = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/houses", label: "숙소" },
  { href: "/admin/requests", label: "신청" },
  { href: "/admin/bookings", label: "예약" },
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/admin") return pathname === "/admin";
  // Room pages belong to the 숙소 section.
  if (href === "/admin/houses" && pathname.startsWith("/admin/rooms")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBar({ pathname }: { pathname: string | null }) {
  return (
    <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3 sm:px-6">
      <span className="mr-3 text-sm font-semibold text-zinc-900">hometohome 운영</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 aria-[current=page]:bg-zinc-900 aria-[current=page]:text-white"
        >
          {l.label}
        </Link>
      ))}
      <form action={signOut} className="ml-auto">
        <button type="submit" className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
          로그아웃
        </button>
      </form>
    </nav>
  );
}

/** usePathname suspends on unknown dynamic params, so render this inside <Suspense fallback={<AdminNavFallback />}>. */
export function AdminNav() {
  return <NavBar pathname={usePathname()} />;
}

export function AdminNavFallback() {
  return <NavBar pathname={null} />;
}
