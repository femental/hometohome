import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireAdmin } from "@/server/auth/session";
import { AdminNav, AdminNavFallback } from "./_components/AdminNav";

// Every admin screen reads the session at request time; navigations are allowed to block.
export const instant = false;

export const metadata = { title: "hometohome 운영" };

/**
 * Checks the session before rendering the segment. Pages still call requireAdmin() themselves:
 * layouts and pages render in parallel, so this check alone does not protect page data.
 */
async function AdminGate({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div lang="ko" className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <Suspense fallback={<AdminNavFallback />}>
          <AdminNav />
        </Suspense>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </div>
  );
}
