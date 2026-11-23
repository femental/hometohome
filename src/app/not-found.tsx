import Link from "next/link";
import { HtmlDocument } from "@/components/site/HtmlDocument";

/**
 * Root 404 (unknown locale, unmatched paths, `notFound()` without a closer boundary). The root layout
 * passes children through, so this page brings its own document. Bilingual: no locale is known here.
 */
export default function NotFound() {
  return (
    <HtmlDocument lang="en">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Page not found</h1>
        <p lang="ko" className="text-sm text-zinc-600">
          페이지를 찾을 수 없습니다.
        </p>
        <Link href="/" className="text-sm font-medium text-zinc-900 underline">
          Home / 홈으로
        </Link>
      </main>
    </HtmlDocument>
  );
}
