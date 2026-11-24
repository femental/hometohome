# hometohome 4단계: 결제(PortOne V2 — 카드·PayPal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 게스트가 결제 페이지에서 해외카드(KRW) 또는 PayPal(USD)로 첫 결제를 하면, 서버가 PortOne에서 결제를 검증해 예약을 확정하고, 취소·늦은 결제·중복 결제 환불이 PG로 자동 실행되게 한다.

**Architecture:** PortOne V2. 브라우저는 `@portone/browser-sdk`로 결제창만 띄우고, **금액·통화는 서버가 만든 Payment 행에서만** 나온다. 확정은 (a) 결제창 종료 후 서버 액션, (b) PortOne 웹훅 두 경로가 같은 멱등 함수 `completePayment`를 호출한다. PG 호출은 `PortOneClient` 인터페이스 뒤에 두고 테스트는 가짜 구현을 쓴다. 환불은 1단계의 `Refund(pending)` 행을 `executeRefund`가 PG 취소 API로 실행한다.

**Tech Stack:** Next.js 16.4.6, Prisma 7, `@portone/browser-sdk` 0.1.x, `@portone/server-sdk` 0.19.x(웹훅 검증·타입), PortOne REST API v2, frankfurter.app(환율, 키 불필요), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-hometohome-mvp-design.md` (7·9·10·11·13·14장), 후속 메모 `docs/superpowers/notes/2026-11-24-phase3-followups.md`의 "4단계".

**선행:** main `68705df`.

## Global Constraints

- **Next 16은 학습 데이터와 다르다** (AGENTS.md) — 라우트 핸들러·서버 액션·`connection()` 문서를 먼저 읽는다. PortOne V2는 설치된 SDK의 README·타입과 공식 문서(developers.portone.io의 V2 결제 연동·웹훅·결제 취소 API)를 확인하고 구현한다. 기억에 의존하지 않는다.
- **금액 신뢰 규칙:** 결제창에 넘기는 금액·통화·주문명은 서버가 만든 `Payment` 행에서 온다. 확정 전 반드시 PortOne `GET /payments/{paymentId}`로 `status === "PAID"`, `amount.total === amountChargedMinor`, `currency` 일치를 확인한다. 클라이언트·웹훅 본문의 금액은 쓰지 않는다.
- **멱등:** `completePayment`·`executeRefund`·웹훅은 몇 번 호출돼도 결과가 같다(1단계 `confirmPaid` 결과 유니언 사용).
- **통화:** 카드 = KRW(원 정수), PayPal = USD(센트 정수). PayPal 금액 = `quoteForeignMinor(amountKrw, rate, 0.02)`(1단계 fx), 환율은 Task 2. 환불도 결제 통화로(1단계 `proportionalRefundMinor`).
- **비밀값:** `PORTONE_API_SECRET`, `PORTONE_WEBHOOK_SECRET`은 서버 전용. 공개 가능: `NEXT_PUBLIC_PORTONE_STORE_ID`, `NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD`, `NEXT_PUBLIC_PORTONE_CHANNEL_KEY_PAYPAL`. 채널 키가 없는 수단은 결제 페이지에 표시하지 않고, 둘 다 없으면 3단계 계좌이체 안내만.
- **메일:** 커밋 후 발송, 수신자별 try/catch, 실패해도 결과 불변(2·3단계 규칙).
- 1~3단계 규약 유지: npm, `npm test`/`npm run test:db`/typecheck/lint/build(placeholder env), 마이그레이션은 `prisma migrate diff`로 SQL 손 저장, 게스트 액션은 `requireUser` 먼저·본인 확인, 운영자 액션은 `requireAdmin` 먼저, `"use server"` 파일은 액션만 export, 메시지 en/ko 동일 키.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **결제창 결과를 위조한 클라이언트**(다른 paymentId, 금액 조작) — 서버 조회 결과로만 판단, 불일치 시 확정 안 함 → Task 4 테스트.
2. **웹훅과 리다이렉트가 동시에 도착** — 확정 1번, 메일 1번 → Task 4 테스트.
3. **홀드 만료 후 결제 / 이미 확정된 예약에 두 번째 결제** — 자동 전액 환불 1건, PG 취소 1번 → Task 4·5 테스트.
4. **PG 취소 API 실패** — Refund `failed`, 운영자 알림, 재시도 버튼으로 재실행(중복 취소 없음) → Task 5 테스트.
5. **환율 API 장애** — 최근 7일 이내 캐시 → env 대체 환율 → 둘 다 없으면 PayPal 숨김(카드는 정상) → Task 2 테스트.

---

### Task 1: 결제 전 정리 (3단계 후속 메모 "4단계")

**Files:**
- Create: `src/server/bookings/refunds.ts`(previewCancellation 이동), `src/server/bookings/retry.ts`
- Modify: `src/server/admin/bookings.ts`·`src/server/guest/bookings.ts`(import 경로), `src/server/bookings/service.ts`, `src/server/bookings/errors.ts`, `src/app/admin/actions/messages.ts`, `src/server/guest/errors.ts`, `src/lib/format.ts`, `src/server/guest/requests.ts`
- Test: 기존 `tests/db/bookings.test.ts`, `tests/db/guest-bookings.test.ts`, `tests/unit/format.test.ts`, 신규 `tests/unit/retry.test.ts`

**Interfaces:**
- Produces:
  - `previewCancellation`은 `@/server/bookings/refunds`에서 export(동작 불변). admin 모듈은 재export하지 않는다.
  - `BookingError` 코드 추가: `NOT_FOUND`, `AMOUNT_MISMATCH`, `REFUND_CHANGED`. 운영자/게스트 메시지 매핑은 `detail` 문자열 대신 코드로. 3단계의 GuestError `REFUND_CHANGED`는 이 코드로 통합.
  - `cancelBooking(db, id, actor, now, opts?: { expectedKind?: "full" | "deposit_only" })` — **예약 행 잠금 안에서** 결정이 expectedKind와 다르면 `REFUND_CHANGED`. 확정 결제의 `status`가 `paid`가 아니면 `INVALID_STATE`(이미 환불된 결제에 취소 환불 중복 방지). `guestCancel`은 잠금 밖 사전 비교를 제거하고 이 옵션을 넘긴다.
  - `withSerializationRetry<T>(fn: () => Promise<T>, opts?: { attempts?: number }): Promise<T>` — Postgres `40P01`(deadlock)·`40001`(serialization)만 최대 3회 재시도(10–50ms 지터), 그 외 오류는 즉시 throw. 1단계 서비스의 `withLockedBooking` 트랜잭션을 감싼다.
  - `formatMinor(minor, currency)` — 통화별 소수 자릿수 표(`KRW: 0, USD: 2`), 표에 없는 통화는 throw.
  - `submitRequest` 메일: 수신자별 try/catch.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("cancel with expectedKind full after deadline → REFUND_CHANGED inside lock, nothing written", async () => {});
test("cancel when confirming payment already refunded → INVALID_STATE, no new refund", async () => {});
test("withSerializationRetry retries 40P01 up to 3 times then throws; other errors not retried", async () => {});
test("formatMinor: KRW 1300000 → ₩1,300,000; USD 96087 → $960.87; unknown currency throws", () => {});
test("admin/guest message mapping uses codes: AMOUNT_MISMATCH and NOT_FOUND have messages", () => {});
test("submitRequest: one admin email failing does not skip the others", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과** (기존 테스트 전부 유지)
- [ ] **Step 5: Commit** — `refactor(bookings): shared refund preview, coded errors, locked expected-kind check, deadlock retry`

---

### Task 2: 환율 (USD/KRW 일일 캐시)

**Files:**
- Create: `src/server/fx/rates.ts`, `prisma/migrations/<ts>_fx_rates/migration.sql`
- Modify: `prisma/schema.prisma`(`FxRate { id, base "USD", quote "KRW", rate Decimal(12,4), date @db.Date(KST), source, fetchedAt; @@unique([base, quote, date]) }`), `src/server/env.ts`(`FX_USD_KRW_FALLBACK?`), `src/lib/i18n-text.ts`·검색/방/결제 페이지의 참고 USD 표시를 서버 환율로
- Test: `tests/db/fx-rates.test.ts`

**Interfaces:**
- Produces:
  - `getUsdKrwRate(db: Db, now: Date, opts?: { fetch?: typeof fetch }): Promise<{ rate: number; date: ISODate; source: "frankfurter" | "cache" | "fallback" } | null>`
    - 오늘(KST) 행이 있으면 사용. 없으면 `https://api.frankfurter.app/latest?from=USD&to=KRW`(5초 타임아웃)로 받아 저장. 실패 시 최근 7일 이내 행(`cache`), 그다음 `FX_USD_KRW_FALLBACK`(`fallback`), 모두 없으면 `null`.
  - `formatUsdReference(krw, rate)`로 시그니처 변경(NEXT_PUBLIC 고정값 제거). 환율이 null이면 참고 USD 표시 생략.
- [ ] **Step 1: 실패하는 테스트**
```ts
test("fetches once per KST day and caches", async () => { /* fake fetch 호출 1회 */ });
test("API failure → most recent cached rate within 7 days", async () => {});
test("no cache within 7 days → env fallback; none → null", async () => {});
test("malformed API response treated as failure", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(fx): daily USD/KRW rate with cache and fallback`

---

### Task 3: PortOne 클라이언트 + 웹훅 검증

**Files:**
- Create: `src/server/payments/portone.ts`, `src/server/payments/fake-portone.ts`(테스트·로컬용)
- Modify: `src/server/env.ts`, `.env.example`
- Test: `tests/unit/portone.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PgPayment { id: string; status: "READY"|"PAID"|"FAILED"|"CANCELLED"|"PARTIAL_CANCELLED"|"VIRTUAL_ACCOUNT_ISSUED"|"PAY_PENDING";
    amount: { total: number; cancelled: number }; currency: "KRW" | "USD"; pgTxId?: string; method?: string; raw: unknown }
  interface PortOneClient {
    getPayment(paymentId: string): Promise<PgPayment | null>   // 404 → null
    cancelPayment(paymentId: string, a: { amount: number; reason: string; currentCancellableAmount: number }): Promise<{ status: "SUCCEEDED" | "REQUESTED" | "FAILED"; cancellationId: string }>
  }
  function createPortOneClient(apiSecret: string, fetch?: typeof fetch): PortOneClient   // Authorization: PortOne {secret}
  class FakePortOne implements PortOneClient { payments: Map<string, PgPayment>; failNextCancel?: boolean }
  function verifyPortOneWebhook(secret: string, rawBody: string, headers: Headers): Promise<{ type: string; paymentId?: string } | null> // @portone/server-sdk Webhook.verify, 실패 null
  function portOneConfig(): { storeId?: string; channelKeyCard?: string; channelKeyPaypal?: string; apiSecret?: string; webhookSecret?: string }
  ```
  - 응답 매핑은 설치된 `@portone/server-sdk` 타입을 기준으로 한다(필드명 확인). 응답 실패·네트워크 오류는 타입 있는 `PortOneError`로 throw(키 노출 금지).
- [ ] **Step 1: 실패하는 테스트** — fake fetch로 getPayment 매핑(PAID KRW/USD), 404→null, cancel 요청 본문(amount·currentCancellableAmount·reason), 인증 헤더, 오류 시 비밀값 미노출, 웹훅 서명 검증 성공/실패(SDK로 서명 생성).
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(payments): PortOne client and webhook verification`

---

### Task 4: 결제 준비·완료 (확정 경로 2개, 멱등)

**Files:**
- Create: `src/server/payments/service.ts`, `src/app/api/webhooks/portone/route.ts`, `src/app/[locale]/bookings/[id]/pay/actions.ts`
- Test: `tests/db/payments.test.ts`, guard 테스트 확장

**Interfaces:**
- Consumes: 1단계 `confirmPaid`(결과 유니언), Task 1~3, 2단계 `sendEmail`
- Produces:
  ```ts
  interface PayDeps { db: Db; pg: PortOneClient; email: EmailSender; now: Date; appUrl: string; adminEmails: string[] }
  function preparePayment(d: PayDeps, userId: string, bookingId: string, method: "card" | "paypal"):
    Promise<{ paymentId: string; storeId: string; channelKey: string; currency: "KRW" | "USD"; totalAmount: number; orderName: string;
      customer: { email: string; fullName: string }; redirectUrl: string; fx?: { rate: number; date: ISODate } }>
    // 본인 + effective awaiting_payment만. Payment(pending) 생성: card → KRW amountChargedMinor = firstPaymentTotal; paypal → USD quote(Task 2 환율, 없으면 PAYPAL_UNAVAILABLE)
    // paymentId = Payment.id(uuid), redirectUrl = `${appUrl}/{locale}/bookings/{id}/pay/complete?paymentId=…`
  function completePayment(d: PayDeps, paymentId: string): Promise<
    { outcome: "confirmed" | "already_confirmed" | "late_refunded" | "duplicate_refunded" | "not_paid" | "amount_mismatch" | "unknown_payment" }>
    // 1) Payment 행 조회(없으면 unknown_payment)  2) pg.getPayment  3) PAID 아니면 not_paid(FAILED면 Payment failed)
    // 4) amount.total·currency ≠ 행 → amount_mismatch: Payment failed + PG 전액 취소 + 운영자 메일
    // 5) Payment paid(pgTxId, raw, paidAt) — 이미 paid면 건너뜀  6) confirmPaid → confirmed/already_confirmed/late_payment/duplicate_payment
    // 7) late/duplicate → 생성된 refundId로 Task 5 executeRefund + 게스트 late_payment_refund + admin_late_payment_refund
    // 8) confirmed → 게스트 booking_confirmed + admin_payment_received. already_confirmed → 메일 없음
  ```
  - 서버 액션 `preparePaymentAction(bookingId, method, locale)` — requireUser → preparePayment. `completePaymentAction(paymentId, locale)` — requireUser + 해당 Payment가 본인 예약 것인지 확인 → completePayment → 결과에 맞는 화면 상태.
  - 웹훅 `POST /api/webhooks/portone` — 원문 body로 서명 검증(실패 401), `Transaction.Paid`·`Transaction.Cancelled`·`Transaction.Failed` 계열에서 paymentId로 `completePayment`(Cancelled는 Payment 상태 동기화만), 항상 빠르게 200(처리 오류는 로그 후 500으로 재시도 유도).
  - 모든 PG/DB 작업은 `withSerializationRetry` 안.
- [ ] **Step 1: 실패하는 테스트**
```ts
test("preparePayment card: KRW amount = firstPaymentTotal; paypal: USD with 2% margin from Task 2 rate", async () => {});
test("preparePayment refuses other guest / not awaiting_payment / expired hold", async () => {});
test("completePayment PAID → confirmed + booking_confirmed + admin_payment_received", async () => {});
test("completePayment twice (redirect + webhook) concurrently → one confirmation, one set of emails", async () => {});
test("PG amount differs from row → amount_mismatch, payment failed, PG full cancel, not confirmed", async () => {});
test("PAID after hold expiry → late_refunded with exactly one refund executed at PG", async () => {});
test("second payment on confirmed booking → duplicate_refunded", async () => {});
test("completePaymentAction rejects a paymentId of another guest's booking", async () => {});
test("webhook: bad signature 401; valid Transaction.Paid → confirmed", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(payments): prepare and verify PortOne payments with idempotent confirmation and webhook`

---

### Task 5: 환불 실행기 + 재시도

**Files:**
- Create: `src/server/payments/refunds.ts`
- Modify: `src/server/guest/bookings.ts`·`src/server/admin/bookings.ts`(취소 후 PG 환불 실행), `src/server/email/templates.ts`(`refund_completed`, `admin_refund_failed` en/ko·ko), `src/app/admin/actions/bookings.ts`(`retryRefundAction`), 운영자 예약 상세(실패 환불 재시도 버튼, PG 거래 ID·환불 상태 표시), 대시보드 `failedRefunds` 카운트
- Test: `tests/db/refunds.test.ts`

**Interfaces:**
- Produces:
  - `executeRefund(d: PayDeps, refundId: string): Promise<"done" | "failed" | "skipped">` — `manual=false`이고 `pending|failed`일 때만. 예약 행 잠금 없이 Refund 행을 `FOR UPDATE`로 잠그고 PG `cancelPayment(paymentId, { amount: amountRefundedMinor, reason, currentCancellableAmount: pg.amount.total - pg.amount.cancelled })`. 이미 PG에서 해당 금액만큼 취소돼 있으면(`cancelled`로 판단) 중복 호출 없이 done 처리. 성공 → Refund done + Payment `refunded`/`partially_refunded` + 게스트 `refund_completed`. 실패 → Refund failed(+error) + 운영자 `admin_refund_failed`.
  - 수동(오프라인) 환불의 `adminMarkRefundDone`도 게스트 `refund_completed` 발송 [결정: 보낸다].
  - `retryRefundAction(refundId)` — requireAdmin → executeRefund.
- [ ] **Step 1: 실패하는 테스트**
```ts
test("guest cancel (card) → PG cancel called with won amount, refund done, payment partially_refunded/refunded, refund_completed mail", async () => {});
test("paypal deposit-only refund uses proportional cents", async () => {});
test("PG cancel failure → refund failed + admin_refund_failed; retry succeeds once", async () => {});
test("executeRefund twice → PG cancel called once", async () => {});
test("manual refund marked done sends refund_completed", async () => {});
```
- [ ] **Step 2–4** → **Step 5: Commit** — `feat(payments): PG refund execution with retry and notifications`

---

### Task 6: 결제 페이지 UI (카드·PayPal)

**Files:**
- Modify: `src/app/[locale]/bookings/[id]/pay/page.tsx`
- Create: `src/app/[locale]/bookings/[id]/pay/_components/{MethodPicker,CardCheckout,PaypalCheckout}.tsx`, `src/app/[locale]/bookings/[id]/pay/complete/page.tsx`
- Modify: `messages/*.json`(`pay`)
- Test: `tests/unit/pay-method-picker.test.tsx`(jsdom: 채널 키 유무에 따른 수단 표시)

**Interfaces:**
- 결제 페이지: 사용 가능한 수단만 표시. 카드 → "₩1,300,000 (KRW)", PayPal → "$960.87 (USD) · 환율 1 USD = ₩1,380 (날짜)" + "카드사·PayPal 환전 수수료는 별도일 수 있음" 안내. 둘 다 없으면 3단계 계좌이체 안내.
- 카드: 버튼 → `preparePaymentAction` → `PortOne.requestPayment({ storeId, channelKey, paymentId, orderName, totalAmount, currency: "CURRENCY_KRW", payMethod: "CARD", customer, redirectUrl, locale })`(필드명은 설치된 SDK 타입 확인) → 결과가 오면 `completePaymentAction`(모바일은 redirectUrl의 complete 페이지가 같은 액션 호출).
- PayPal: PortOne V2 PayPal 연동 방식(SDK의 PayPal UI 로드 함수, 문서 확인)으로 버튼 렌더 → 승인 시 `completePaymentAction`.
- complete 페이지: paymentId로 결과 표시(확정/처리 중/실패/늦은 결제 환불 안내) 후 예약 상세 링크. 서버 판정만 표시.
- 결제 진행 중 중복 클릭 방지, 남은 시간 0이면 결제 버튼 비활성.
- [ ] **Step 1–4** → **Step 5: Commit** — `feat(guest): card and PayPal checkout on the payment page`

---

### Task 7: 통합 확인 (컨트롤러)

- [ ] PortOne **테스트 채널 키가 있으면**: 로컬 Supabase + `npm run dev` + ngrok 없이(웹훅은 수동 재전송 또는 생략) 카드 테스트 결제 → 확정 메일(콘솔 발송기) → 게스트 취소 → PG 환불 done 확인. PayPal 샌드박스는 키가 있을 때만.
- [ ] 키가 없으면: `FakePortOne`을 쓰는 개발용 플래그(`PORTONE_FAKE=1`, production에서 무시)로 결제 흐름을 브라우저에서 끝까지 확인하고, 실제 PG 확인은 대표님 키 준비 후로 기록.
