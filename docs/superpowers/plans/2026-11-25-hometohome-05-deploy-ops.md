# hometohome 5단계: 배포·운영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 도메인에서 운영할 수 있게 만든다. 만료·알림을 자동으로 돌리는 예약 작업(Cron), 결제·사진·로그인의 운영 보강, 오류 감시, 자동 테스트(E2E·CI), 그리고 Vercel + Supabase + PortOne 운영 배포 절차를 갖춘다.

**Architecture:** 1~4단계 코드 위에 운영 기능만 더한다. 주기 작업은 Vercel Cron이 `CRON_SECRET`으로 보호된 라우트 핸들러를 호출하고, 각 작업은 기존 서비스 함수(`expireDue`, `executeRefund` 등)를 재사용하는 `src/server/jobs/*`에 둔다. 외부 서비스(Sentry)는 env가 없으면 꺼지는 선택 기능이다.

**Tech Stack:** Next.js 16.4.6, Prisma 7(+ Supabase 풀러), Supabase Storage signed upload, Vercel Cron, `@sentry/nextjs`, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-21-hometohome-mvp-design.md`(7·13·14장), 후속 메모 `docs/superpowers/notes/2026-11-24-phase3-followups.md`·`2026-11-24-phase4-followups.md`의 "5단계".

**선행:** main `464214a`.

## Global Constraints

- **Next 16은 학습 데이터와 다르다** (AGENTS.md) — 라우트 핸들러, `connection()`, `error.tsx`/`not-found.tsx`, instrumentation 문서를 `node_modules/next/dist/docs`에서 먼저 읽는다. Sentry·Playwright·Supabase signed upload는 설치된 패키지의 README·타입으로 확인한다.
- 주기 작업 라우트는 `Authorization: Bearer ${CRON_SECRET}`이 정확히 일치할 때만 실행(아니면 401). 작업은 멱등(몇 번 돌아도 결과 같음)이고 한 번에 처리량 상한을 둔다.
- 메일은 커밋 후 발송, 발송 기록은 email_log로 중복 방지(같은 예약·같은 템플릿은 한 번).
- 운영 비밀값(`CRON_SECRET`, `SENTRY_DSN` 서버 키, `PORTONE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`)은 서버 전용.
- 1~4단계 규약 유지: npm, `npm test`/`npm run test:db`/typecheck/lint/build, 마이그레이션은 `prisma migrate diff`로 SQL 손 저장, 게스트 `requireUser`·운영자 `requireAdmin` 먼저, `"use server"`는 액션만 export, 메시지 en/ko 동일 키.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Cron이 두 번 동시에 돌거나 늦게 돎** — 만료·리마인더 메일 중복 없음 → Task 1 테스트.
2. **CRON_SECRET 없이 cron 라우트 호출** — 401, 아무 변경 없음 → Task 1 테스트.
3. **서명 업로드 후 등록 단계를 건너뛰거나 다른 숙소 경로로 등록** — 거부, 고아 파일은 정리 작업이 지움 → Task 3 테스트.
4. **같은 IP·이메일로 매직링크 대량 요청** — 제한 후 안내 문구, 정상 사용자는 영향 없음 → Task 4 테스트.
5. **운영 DB 주소 없이 마이그레이션 실행** — 테스트 DB에 잘못 적용되지 않도록 스크립트가 거부 → Task 6 테스트.

---

### Task 1: 주기 작업 (만료·결제 마감 알림)

**Files:** Create `src/server/jobs/{expire,reminders,cleanup}.ts`, `src/app/api/cron/[job]/route.ts`, `vercel.json`, migration `<ts>_payment_reminder`; Modify `prisma/schema.prisma`(Booking `paymentReminderSentAt DateTime?`), `src/server/email/templates.ts`(`payment_reminder` en/ko — `holdExpiresAt`, `payUrl`, `firstPaymentTotal` 필요); Test `tests/db/jobs.test.ts`, `tests/unit/cron-route.test.ts`

**Interfaces:**
- `runExpiry(d: JobDeps): Promise<{ requestExpired: string[]; paymentExpired: string[] }>` — 1단계 `expireDue` 후 각 예약에 `request_expired`/`payment_expired` 게스트 메일(email_log로 중복 방지).
- `runPaymentReminders(d): Promise<string[]>` — `awaiting_payment`이고 `holdExpiresAt`까지 3시간 이하·미발송(`paymentReminderSentAt` null)인 예약에 `payment_reminder`, 조건부 updateMany로 표시 후 발송(동시 실행에도 1회).
- `runDailyCleanup(d)` — Task 3·Task 2가 채움(이 태스크에선 빈 함수 + 라우트만).
- `JobDeps = { db; email; now; appUrl; adminEmails; pg?; storage? }`
- `GET /api/cron/frequent`(5분: expiry + reminders), `GET /api/cron/daily`(매일 03:00 KST = 18:00 UTC: cleanup). `vercel.json`: `{"crons":[{"path":"/api/cron/frequent","schedule":"*/5 * * * *"},{"path":"/api/cron/daily","schedule":"0 18 * * *"}]}`. 그 외 job 이름은 404.

- [ ] **Step 1: 실패하는 테스트**
```ts
test("runExpiry expires stale requests/holds and emails each guest once even when run twice", async () => {});
test("payment reminder goes out once, 3h before the hold expires, not for later holds", async () => {});
test("two concurrent reminder runs send one email", async () => {});
test("cron route: missing/wrong bearer → 401 and no job call; right secret → 200 with counts", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(jobs): scheduled expiry and payment reminders`

---

### Task 2: 결제 운영 보강

**Files:** Modify `src/server/payments/{service,refunds}.ts`, `src/server/email/templates.ts`(`admin_payment_problem` ko — `reason`), `src/server/admin/bookings.ts`(getBookingDetail에 `pgTxId`), `src/app/admin/_components/RefundList.tsx`; Test `tests/db/payments.test.ts`, `tests/db/refunds.test.ts`

**Interfaces / 규칙:**
- PG 취소 결과가 `REQUESTED`(비동기)면 Refund를 `done`이 아니라 `processing`으로 둔다. 웹훅 `Transaction.Cancelled`/`PartialCancelled`와 daily cleanup이 PG 조회로 `pg.amount.cancelled − ledger(done) ≥ amount`면 `done`(+ `refund_completed`)으로 확정.
- PG는 PAID인데 `confirmPaid`가 거절(AMOUNT_MISMATCH 등)하면: 결제 `failed`, PG 전액 취소, 운영자 `admin_payment_problem`, 웹훅 응답 200(무한 재시도 방지).
- `amount_mismatch`에도 `admin_payment_problem` 발송.
- daily cleanup: 24시간 지난 `pending` 결제 행을 `cancelled`로(그 사이 PG에서 PAID가 됐다면 `completePayment`로 처리).
- 운영자 결제 내역에 PG 거래 ID 표시.
- [ ] **Step 1: 실패하는 테스트**
```ts
test("REQUESTED cancellation stays processing until the PG shows it cancelled, then done + refund_completed", async () => {});
test("PAID payment refused by confirmPaid → PG full cancel, payment failed, admin_payment_problem, webhook 200", async () => {});
test("amount_mismatch emails operators", async () => {});
test("stale pending payments (24h) are cancelled; one that the PG shows PAID is completed instead", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `fix(payments): async cancellations, refused paid payments, stale checkouts`

---

### Task 3: 사진 서명 업로드 + 고아 파일 정리 + 버킷 설정 일원화

**Files:** Modify `src/server/photos/{service,storage}.ts`, `src/app/admin/actions/photos.ts`, `src/app/admin/_components/PhotoManager.tsx`, `src/lib/photo-url.ts`, `src/server/env.ts`, `.env.example`, `next.config.ts`(bodySizeLimit 원복 가능 여부 확인); Create `supabase/seed-storage.sql` 또는 `scripts/setup-storage.ts`(버킷 생성 1회); Test `tests/db/photos.test.ts`, `tests/db/jobs.test.ts`

**Interfaces / 규칙:**
- `createPhotoUpload(db, storage, owner, { contentType, size }): Promise<{ path; token; signedUrl }>` — requireAdmin 액션에서 호출. 형식(jpeg/png/webp)·크기(≤ 10MB)·개수(20장)를 먼저 검사, 경로 `${kind}s/${ownerId}/${uuid}.${ext}`(서버가 정함). 브라우저는 Supabase `uploadToSignedUrl`로 직접 업로드(서버 액션 본문 크기 제한 회피).
- `registerPhoto(db, storage, owner, path)` — 경로가 그 owner 접두사인지, 스토리지에 실제 있는지·크기·형식(첫 바이트 매직 넘버) 확인 후 행 생성. 아니면 파일 삭제 + 오류.
- 버킷 이름은 `NEXT_PUBLIC_PHOTO_BUCKET` 하나로(서버·클라이언트 공용, 기본 `photos`), `PHOTO_BUCKET` 제거. 버킷 자동 생성(`bucketEnsured`) 제거 → 설정 스크립트로 1회 생성.
- daily cleanup: 어떤 photo 행도 가리키지 않는 `houses/`·`rooms/` 아래 파일 중 24시간 지난 것 삭제(한 번에 최대 500개).
- [ ] **Step 1: 실패하는 테스트**
```ts
test("createPhotoUpload refuses bad type, >10MB and the 21st photo before issuing a URL", async () => {});
test("registerPhoto refuses a path outside the owner's prefix and a missing object", async () => {});
test("registerPhoto rejects a file whose bytes are not an image, deleting it", async () => {});
test("cleanup deletes unreferenced files older than 24h and keeps referenced/new ones", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(photos): signed direct uploads, orphan cleanup, single bucket setting`

---

### Task 4: 게스트 오류 화면 + 요청 제한

**Files:** Create `src/app/[locale]/error.tsx`, `src/app/[locale]/not-found.tsx`, `src/server/rate-limit.ts`, migration `<ts>_rate_limits`; Modify `src/app/[locale]/login/actions.ts`, `src/app/[locale]/rooms/[id]/actions.ts`(quoteAction), `messages/*.json`(`errors.RATE_LIMITED`, `common.errorPage`, `common.notFound`); Test `tests/db/rate-limit.test.ts`

**Interfaces / 규칙:**
- `rateLimit(db, key: string, limit: number, windowSec: number, now): Promise<boolean>` — Postgres `rate_limits(key, window_start, count)` 고정 창, upsert 1회. 키에는 해시만 저장(`sha256(ip|email)`).
- 매직링크: 이메일당 5회/시간, IP당 20회/시간. quote: IP당 120회/분. 초과 시 `RATE_LIMITED` 안내(로그인은 "잠시 후 다시 시도").
- IP는 `x-forwarded-for` 첫 값(Vercel), 없으면 `unknown`.
- `[locale]/not-found.tsx`·`error.tsx`는 헤더·푸터 포함, 로케일 문구, `noindex`. 운영자 영역은 기존 유지.
- daily cleanup에 1일 지난 rate_limits 행 삭제 추가.
- [ ] **Step 1: 실패하는 테스트**
```ts
test("allows up to the limit in a window, refuses after, resets in the next window", async () => {});
test("keys are stored hashed, not raw emails or IPs", async () => {});
test("sendMagicLink returns RATE_LIMITED after 5 requests for one email within an hour", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(guest): error pages and request rate limits`

---

### Task 5: 오류 감시 (Sentry) + proxy 점검

**Files:** Create `instrumentation.ts`, `instrumentation-client.ts`, `sentry.*.config.ts`(설치된 `@sentry/nextjs` 버전 문서대로); Modify `next.config.ts`(withSentryConfig — DSN 없으면 비활성), `src/proxy.ts`(필수 `NEXT_PUBLIC_SUPABASE_*` 없으면 명확한 오류, 리다이렉트에 캐시 헤더 복사), 결제 문제 경로(`amount_mismatch`, 환불 실패, 웹훅 500)에서 `captureException`; Test `tests/unit/proxy-locale.test.ts`, `tests/unit/observability.test.ts`

**Interfaces / 규칙:** `reportProblem(message: string, extra: Record<string, unknown>)` — Sentry가 켜져 있으면 capture, 아니면 `console.error`. 개인정보(이메일·이름)는 extra에 넣지 않는다(예약·결제 ID만).
- [ ] **Step 1–4** (DSN 없을 때 no-op, proxy 오류 메시지, 리다이렉트 캐시 헤더 테스트) → **Step 5: Commit** — `feat(ops): Sentry error monitoring and proxy hardening`

---

### Task 6: 운영 DB 연결·마이그레이션 안전장치

**Files:** Modify `prisma.config.ts`(`DIRECT_URL`을 마이그레이션용으로), `src/server/db.ts`(풀러 URL 사용 시 `connection_limit` 등 Supabase 권장값은 문서 확인), `package.json`(`db:deploy` 스크립트), `next.config.ts`(빌드 시 `NEXT_PUBLIC_SUPABASE_URL` 없으면 실패); Create `scripts/db-deploy.ts`; Test `tests/unit/db-deploy.test.ts`

**Interfaces / 규칙:**
- `npm run db:deploy` — `DIRECT_URL`(또는 `DATABASE_URL`)이 **명시적으로** 주어져야 하고, 호스트가 테스트 DB(`localhost:54329`/이름 `*_test`)면 거부, 운영 호스트면 확인 프롬프트 대신 `--yes` 플래그 필수. 내부적으로 `prisma migrate deploy`.
- 운영 `DATABASE_URL`은 Supabase 트랜잭션 풀러(6543, `?pgbouncer=true`), `DIRECT_URL`은 직접 연결(5432) — `.env.example`에 설명.
- [ ] **Step 1–4** (URL 판정 함수 단위 테스트: 테스트 DB 거부, 명시 안 됨 거부, `--yes` 없으면 거부) → **Step 5: Commit** — `chore(db): pooled runtime connection and guarded production migrations`

---

### Task 7: E2E + CI

**Files:** Create `playwright.config.ts`, `e2e/{guest-booking,admin-ops}.spec.ts`, `.github/workflows/ci.yml`; Modify `package.json`(`e2e`), README

**규칙:**
- E2E는 로컬 Supabase + `PORTONE_FAKE=1`로: 게스트 검색 → 방 → 매직링크 로그인(Mailpit API로 링크 획득) → 신청 → 운영자 승인 → 카드(가짜) 결제 → 확정 → 취소 → 환불 완료 표시까지. 운영자 시나리오: 숙소·방 등록, 사진 업로드, 차단 기간.
- CI(GitHub Actions, push·PR): `npm ci` → typecheck → lint → unit → db(Postgres 16 서비스 컨테이너, 포트 54329, `h2h_test`) → build(placeholder env). E2E는 수동 실행 워크플로(`workflow_dispatch`)로 분리(Supabase CLI 필요).
- [ ] **Step 1–4** (로컬에서 `npm run e2e` 통과, CI 파일은 `act` 없이 문법 검사 수준) → **Step 5: Commit** — `test(e2e): guest and admin flows; ci workflow`

---

### Task 8: 운영 배포 절차서 + 체크리스트

**Files:** Create `docs/ops/deploy-runbook.md`(한국어), `docs/ops/production-checklist.md`

**내용:**
- 계정·서비스: Vercel(Pro), Supabase(Pro, 서울 리전), PortOne(상점·채널), Resend(도메인 인증), Google Maps 키(리퍼러 제한), 카카오 REST 키, Sentry(선택), 도메인 DNS.
- Supabase 운영 설정: Auth `site_url`=APP_URL, redirect 허용 목록 `https://<도메인>/auth/**`만, 매직링크 메일 템플릿(`supabase/templates/magic_link.html` 내용 붙여넣기), SMTP를 Resend로, 저장소 버킷 생성 스크립트 실행.
- Vercel 환경 변수 전체 표(이름·용도·공개 여부·예시 형식), Cron 확인, 리전 icn1.
- PortOne 콘솔: 웹훅 URL `https://<도메인>/api/webhooks/portone` + Secret, 채널 키.
- 최초 배포 순서: `npm run db:deploy -- --yes`(DIRECT_URL) → Vercel 배포 → 운영자 로그인 확인 → 실제 테스트 결제·환불 1건 → 법률 검토 끝난 약관 교체.
- 장애 대응: 환불 실패 재시도, 웹훅 재전송, 백업 복구(Supabase PITR) 절차.

- [ ] **Step 1: 작성** → **Step 2: 다른 사람이 따라 할 수 있는지 컨트롤러가 검토** → **Step 3: Commit** — `docs(ops): deploy runbook and production checklist`

---

### Task 9: 실제 배포 (대표님과 함께)

- [ ] 대표님이 계정을 만들고 키를 준비하면, 절차서대로 운영 DB 마이그레이션·Vercel 배포를 함께 진행하고, 실제 도메인에서 로그인·신청·승인·PortOne 테스트 결제·환불·Cron 동작을 확인한다. 비밀값 입력과 결제 승인은 대표님이 직접 한다.
