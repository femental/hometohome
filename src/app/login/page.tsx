import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { sendMagicLink, signInWithGoogle } from "./actions";

// Bilingual (EN / KO) until phase 3 i18n replaces these strings.
const ERRORS: Record<string, string> = {
  email: "Please enter a valid email. / 올바른 이메일을 입력하세요.",
  send: "Could not send the link. Try again. / 링크를 보내지 못했습니다. 다시 시도하세요.",
  oauth: "Google sign-in failed. / Google 로그인에 실패했습니다.",
  auth: "Sign-in link is invalid or expired. / 로그인 링크가 잘못되었거나 만료되었습니다.",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function LoginForms({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = first(params.next) ?? "";
  const error = ERRORS[first(params.error) ?? ""];
  const sent = first(params.sent) === "1";

  return (
    <div className="flex flex-col gap-4">
      {sent && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          Check your email for the sign-in link. / 이메일로 보낸 로그인 링크를 확인하세요.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <Field label="Email / 이메일" name="email" type="email" autoComplete="email" required />
        <Button type="submit">Email me a sign-in link / 로그인 링크 받기</Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        or / 또는
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" className="w-full">
          Continue with Google / Google로 계속하기
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6">
      <Card title="Sign in / 로그인" className="w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading… / 불러오는 중…</p>}>
          <LoginForms searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
