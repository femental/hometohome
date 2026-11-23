import Link from "next/link";
import { HtmlDocument } from "@/components/site/HtmlDocument";

// Rendered under the pass-through root layout (it replaces the admin layout), so it brings its own document.
export default function Forbidden() {
  return (
    <HtmlDocument lang="ko">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">접근 권한이 없습니다</h1>
        <p className="text-sm text-zinc-600">이 페이지는 운영자만 볼 수 있습니다. 운영자 계정으로 로그인하세요.</p>
        <Link href="/login" className="text-sm font-medium text-zinc-900 underline">
          다른 계정으로 로그인
        </Link>
      </main>
    </HtmlDocument>
  );
}
