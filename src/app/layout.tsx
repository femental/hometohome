import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hometohome",
};

/**
 * Pass-through root layout (next-intl's pattern for an app with localized and non-localized
 * segments): `<html>`/`<body>` come from `app/[locale]/layout.tsx` (guest, `lang` per locale),
 * `app/admin/layout.tsx`, `app/login/layout.tsx` and the root `not-found.tsx` / `forbidden.tsx`,
 * all via `HtmlDocument`.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return children;
}
