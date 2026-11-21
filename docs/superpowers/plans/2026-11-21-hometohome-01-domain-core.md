# hometohome 1단계: 도메인 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 골격과 DB 스키마를 세우고, 가격·환불·환율·예약 상태·가용성 규칙을 화면 없이 테스트로 검증된 서버 코드로 완성한다.

**Architecture:** Next.js(App Router) 단일 앱. 업무 규칙은 `src/domain/`(순수 함수, DB 없음)과 `src/server/`(Prisma로 DB를 쓰는 서비스)에 두고, 화면·API 라우트는 이후 단계에서 이 서비스만 호출한다. 이중 예약은 Postgres exclusion constraint로 DB가 최종 차단한다.

**Tech Stack:** Next.js(최신 안정판), TypeScript(strict), pnpm, Prisma, PostgreSQL 16(로컬: Docker, 운영: Supabase 서울), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-hometohome-mvp-design.md`

### 전체 계획 로드맵 (이 문서는 1단계)
1. **도메인 코어** (이 문서) — 골격, 스키마, 가격·환불·환율·상태·가용성·예약 서비스
2. **인증 + 운영자 화면** — Supabase Auth(Google·매직링크), role 가드, `/admin` 숙소·방·사진·차단·신청 승인/거절·예약 관리·오프라인 결제 확인, 카카오 주소검색 좌표화, 이메일(Resend) 알림
3. **게스트 화면 + 지도 + 다국어** — next-intl(en/ko), 검색(목록+Google Maps), 집·방 상세, 신청, 내 예약, 정적·법적 페이지
4. **결제** — PortOne V2(카드·PayPal), 결제 준비·검증·웹훅, 환율 API, 만료 후 결제 자동 환불, 취소 환불 실행
5. **배포·운영** — Vercel Pro(icn1)·Supabase Pro·도메인·Cron·Sentry·환경 분리, Playwright E2E

## Global Constraints

- 모든 날짜 규칙은 **Asia/Seoul(KST)** 기준. 날짜는 `'YYYY-MM-DD'` 문자열(`ISODate`), 시각은 `Date`(UTC instant).
- `move_out`은 **exclusive**(마지막 숙박일 + 1일).
- 금액은 **정수 최소 단위**: KRW는 원, USD는 센트. 부동소수 금액 저장 금지. (스펙의 "외화 decimal 2자리"는 `*_minor` 정수 센트로 구현)
- 결제·환불 금액은 서버만 계산한다. 클라이언트 입력 금액은 쓰지 않는다.
- 최소 기간 1개월, 최대 12개월. 일할 = `round(적용월세 / 30 × 남는일수)`.
- 신청 응답 기한 48시간, 결제 홀드 24시간, 입주일 ≥ 오늘(KST) + 3일.
- 취소 기한 = 입주일 − 7일의 23:59:59.999 KST.
- PayPal 환율 여유분 기본 `0.02`.
- TypeScript `strict: true`. 패키지 매니저 pnpm. Node 22 LTS.

## Review Focus

1. **월말 입주**(1/31, 윤년 2/29) — 개월 계산이 말일로 보정되어야 함 → Task 2·3 테스트.
2. **겹치는 두 신청을 동시에 승인** — 하나만 성공하고 다른 하나는 `ROOM_UNAVAILABLE` → Task 7 동시성 테스트.
3. **KST 자정 경계** — UTC로는 전날이지만 KST로는 오늘인 시각(예: `2027-03-07T15:30Z` = KST 3/8 00:30)에서 오늘·취소 기한 판정 → Task 2·4 테스트.
4. **Cron이 돌기 전 만료된 홀드에 결제 도착** — 저장된 상태가 `awaiting_payment`여도 `late_payment`로 처리 → Task 7 테스트.
5. **연속 예약**(A의 `move_out` == B의 `move_in`) — 겹침이 아니므로 허용 → Task 6·8 테스트.

---

### Task 1: 프로젝트 골격 + 테스트 환경

**Files:**
- Create: (create-next-app 산출물), `docker-compose.yml`, `vitest.config.ts`, `.env.example`, `.env.test`, `tests/smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: `pnpm test`(단위), `pnpm test:db`(DB 통합), `pnpm db:up`(로컬 Postgres), 경로 별칭 `@/*` → `src/*`

- [ ] **Step 1: 저장소 초기화와 스캐폴드**

Run (프로젝트 루트 `C:\Users\msdog\Projects\superPowers`):
(git 저장소는 이미 초기화되어 있음 — 설계·계획 문서가 첫 커밋)
```
pnpm create next-app@latest . --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-pnpm
```
기존 `docs/` 때문에 거부되면 임시 폴더에 생성 후 내용을 루트로 옮긴다.

- [ ] **Step 2: Vitest·Prisma 설치, 스크립트 추가**

`pnpm add -D vitest vite-tsconfig-paths prisma` / `pnpm add @prisma/client`
scripts: `"test": "vitest run --project unit"`, `"test:db": "vitest run --project db"`, `"db:up": "docker compose up -d db"`.
`vitest.config.ts`: projects 두 개 — `unit`(`tests/unit/**`, `tests/smoke.test.ts`), `db`(`tests/db/**`, `globalSetup: tests/db/global-setup.ts`, `fileParallelism: false`).

- [ ] **Step 3: 로컬 Postgres**

`docker-compose.yml`: 서비스 `db`, `postgres:16`, 포트 `54329:5432`, user/pw/db `h2h`/`h2h`/`h2h`.
`.env.test`: `DATABASE_URL=postgresql://h2h:h2h@localhost:54329/h2h_test`. `.env.example`에 `DATABASE_URL`, `DIRECT_URL` 키만.

- [ ] **Step 4: 스모크 테스트 작성·실행**

```ts
// tests/smoke.test.ts
import { expect, test } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```
Run: `pnpm test` → Expected: 1 passed

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "chore: scaffold Next.js app with Vitest and local Postgres"
```

---

### Task 2: KST 날짜 유틸

**Files:**
- Create: `src/domain/dates.ts`
- Test: `tests/unit/dates.test.ts`

**Interfaces:**
- Produces:
  - `type ISODate = string`
  - `addDays(d: ISODate, n: number): ISODate`
  - `addMonthsClamped(d: ISODate, months: number): ISODate` — 대상 월에 해당 일이 없으면 말일
  - `diffDays(from: ISODate, to: ISODate): number` — `to − from`
  - `todayKST(now: Date): ISODate`
  - `startOfDayKST(d: ISODate): Date`, `endOfDayKST(d: ISODate): Date` (23:59:59.999 KST)
  - `isValidISODate(s: string): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("addMonthsClamped clamps to month end", () => {
  expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
  expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  expect(addMonthsClamped("2027-03-15", 2)).toBe("2027-05-15");
  expect(addMonthsClamped("2027-08-31", 1)).toBe("2027-09-30");
  expect(addMonthsClamped("2027-12-15", 1)).toBe("2028-01-15");
});
test("diffDays / addDays", () => {
  expect(diffDays("2027-04-15", "2027-04-25")).toBe(10);
  expect(addDays("2027-03-15", -7)).toBe("2027-03-08");
});
test("todayKST uses Seoul date", () => {
  expect(todayKST(new Date("2027-03-07T15:30:00Z"))).toBe("2027-03-08");
  expect(todayKST(new Date("2027-03-07T14:59:59Z"))).toBe("2027-03-07");
});
test("endOfDayKST / startOfDayKST", () => {
  expect(endOfDayKST("2027-03-08").toISOString()).toBe("2027-03-08T14:59:59.999Z");
  expect(startOfDayKST("2027-03-15").toISOString()).toBe("2027-03-14T15:00:00.000Z");
});
test("isValidISODate", () => {
  expect(isValidISODate("2027-02-29")).toBe(false);
  expect(isValidISODate("2028-02-29")).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm test tests/unit/dates.test.ts` → FAIL (module not found)

- [ ] **Step 3: `src/domain/dates.ts` 구현** — 외부 라이브러리 없이 `Date.UTC` 연산. KST는 고정 +9시간(한국은 서머타임 없음).

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(domain): KST date utilities"`

---

### Task 3: 가격 계산

**Files:**
- Create: `src/domain/pricing.ts`
- Test: `tests/unit/pricing.test.ts`

**Interfaces:**
- Consumes: Task 2 `addMonthsClamped`, `diffDays`
- Produces:
  ```ts
  interface PriceInput { monthlyRent: number; extraPersonMonthlyFee: number; deposit: number;
    moveIn: ISODate; moveOut: ISODate; occupants: 1 | 2 }
  interface PriceQuote { appliedMonthlyRent: number; fullMonths: number; extraDays: number;
    proratedAmount: number; stayTotal: number; firstRentAmount: number; deposit: number;
    firstPaymentTotal: number }
  class PricingError extends Error { code: "INVALID_RANGE" | "MIN_STAY" | "MAX_STAY" }
  const MAX_STAY_MONTHS = 12
  function calculatePrice(input: PriceInput): PriceQuote
  ```

- [ ] **Step 1: 실패하는 테스트 작성** (스펙 8장 예시 그대로, 월세 800,000 / 보증금 500,000 / 추가요금 0 / 1인)

```ts
const base = { monthlyRent: 800_000, extraPersonMonthlyFee: 0, deposit: 500_000, occupants: 1 as const };
test.each([
  ["2027-03-15", "2027-05-15", 2, 0, 1_600_000, 1_300_000],
  ["2027-03-15", "2027-04-25", 1, 10, 1_066_667, 1_566_667],
  ["2027-03-15", "2027-05-25", 2, 10, 1_866_667, 1_300_000],
  ["2027-01-31", "2027-02-28", 1, 0, 800_000, 1_300_000],
])("%s → %s", (moveIn, moveOut, months, days, total, first) => {
  const q = calculatePrice({ ...base, moveIn, moveOut });
  expect([q.fullMonths, q.extraDays, q.stayTotal, q.firstPaymentTotal]).toEqual([months, days, total, first]);
});
test("2 occupants add extra fee to rent, not deposit", () => {
  const q = calculatePrice({ ...base, extraPersonMonthlyFee: 100_000, occupants: 2, moveIn: "2027-03-15", moveOut: "2027-05-15" });
  expect(q.appliedMonthlyRent).toBe(900_000);
  expect(q.firstPaymentTotal).toBe(900_000 + 500_000);
});
test("rejects < 1 month, > 12 months, and moveOut <= moveIn", () => {
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2027-04-14" })).toThrow(expect.objectContaining({ code: "MIN_STAY" }));
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2028-03-16" })).toThrow(expect.objectContaining({ code: "MAX_STAY" }));
  expect(calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2028-03-15" }).fullMonths).toBe(12);
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2027-03-15" })).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
});
```

- [ ] **Step 2: 실패 확인** — `pnpm test tests/unit/pricing.test.ts` → FAIL

- [ ] **Step 3: `calculatePrice` 구현** — 스펙 8장 순서대로. `fullMonths`는 `addMonthsClamped(moveIn, k) <= moveOut`인 최대 k(1부터 증가). `firstRentAmount = fullMonths === 1 ? stayTotal : appliedMonthlyRent`.

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(domain): monthly/daily pricing rules"`

---

### Task 4: 취소 환불 규칙 + 환율

**Files:**
- Create: `src/domain/refund.ts`, `src/domain/fx.ts`
- Test: `tests/unit/refund.test.ts`, `tests/unit/fx.test.ts`

**Interfaces:**
- Consumes: Task 2 `addDays`, `endOfDayKST`, `startOfDayKST`
- Produces:
  ```ts
  // refund.ts
  function cancellationDeadline(moveIn: ISODate): Date
  type RefundDecision = { kind: "full" | "deposit_only"; amountKrw: number } | { kind: "not_allowed"; amountKrw: 0 }
  function decideRefund(a: { firstPaymentTotal: number; deposit: number; moveIn: ISODate;
    now: Date; actor: "guest" | "admin" }): RefundDecision
  // fx.ts
  const DEFAULT_FX_MARGIN = 0.02
  function quoteForeignMinor(amountKrw: number, krwPerUnit: number, margin?: number): number // 센트, 올림
  function proportionalRefundMinor(chargedMinor: number, amountKrw: number, refundKrw: number): number
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// refund.test.ts — moveIn 2027-03-15, 첫 결제 1,300,000 / 보증금 500,000
const a = { firstPaymentTotal: 1_300_000, deposit: 500_000, moveIn: "2027-03-15" };
test("deadline is moveIn-7 23:59:59.999 KST", () => {
  expect(cancellationDeadline("2027-03-15").toISOString()).toBe("2027-03-08T14:59:59.999Z");
});
test("guest: full until deadline, deposit only after, not allowed from move-in day", () => {
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-08T14:59:59.999Z") })).toEqual({ kind: "full", amountKrw: 1_300_000 });
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-08T15:00:00Z") })).toEqual({ kind: "deposit_only", amountKrw: 500_000 });
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-14T15:00:00Z") }).kind).toBe("not_allowed");
});
test("admin: always full before move-in, not allowed from move-in day", () => {
  expect(decideRefund({ ...a, actor: "admin", now: new Date("2027-03-12T00:00:00Z") })).toEqual({ kind: "full", amountKrw: 1_300_000 });
  expect(decideRefund({ ...a, actor: "admin", now: new Date("2027-03-14T15:00:00Z") }).kind).toBe("not_allowed");
});

// fx.test.ts
test("quote: KRW→USD cents with 2% margin, rounded up", () => {
  // 1,300,000 / 1,380 = 942.0289… × 1.02 = 960.8695… → 96087 cents
  expect(quoteForeignMinor(1_300_000, 1380)).toBe(96087);
  expect(quoteForeignMinor(1_300_000, 1380, 0)).toBe(94203);
});
test("proportional refund", () => {
  expect(proportionalRefundMinor(96087, 1_300_000, 500_000)).toBe(36957); // 96087×5/13 = 36956.54 → round
  expect(proportionalRefundMinor(96087, 1_300_000, 1_300_000)).toBe(96087);
});
```

- [ ] **Step 2: 실패 확인** — `pnpm test tests/unit/refund.test.ts tests/unit/fx.test.ts` → FAIL

- [ ] **Step 3: 구현** — `decideRefund`: `now >= startOfDayKST(moveIn)`이면 `not_allowed`; admin이면 full; guest는 `now <= cancellationDeadline`이면 full, 아니면 deposit_only. `quoteForeignMinor`는 부동소수 오차를 피하려고 `Math.ceil(Math.round(amountKrw * (1 + margin) * 100 * 1e6 / krwPerUnit) / 1e6)`처럼 정수 스케일에서 계산(테스트 값이 기준). 전액 환불은 `chargedMinor` 그대로.

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(domain): cancellation refund policy and FX quoting"`

---

### Task 5: 예약 상태 전이

**Files:**
- Create: `src/domain/booking-status.ts`
- Test: `tests/unit/booking-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type BookingStatus = "requested" | "rejected" | "request_expired" | "withdrawn" | "awaiting_payment"
    | "payment_expired" | "confirmed" | "cancelled" | "completed"
  type BookingEvent = "approve" | "reject" | "expire_request" | "withdraw" | "pay" | "expire_payment" | "cancel" | "complete"
  class InvalidTransitionError extends Error { from: BookingStatus; event: BookingEvent }
  function nextStatus(from: BookingStatus, event: BookingEvent): BookingStatus
  function effectiveStatus(b: { status: BookingStatus; requestExpiresAt: Date | null; holdExpiresAt: Date | null }, now: Date): BookingStatus
  const OCCUPYING_STATUSES: readonly BookingStatus[] // ["awaiting_payment", "confirmed"]
  const REQUEST_TTL_MS = 48 * 3600_000, HOLD_TTL_MS = 24 * 3600_000
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

허용 전이 표(이 외 전부 throw):
`requested`: approve→awaiting_payment, reject→rejected, expire_request→request_expired, withdraw→withdrawn
`awaiting_payment`: pay→confirmed, expire_payment→payment_expired, cancel→cancelled(운영자 취소, 미결제라 환불 없음)
`confirmed`: cancel→cancelled, complete→completed

```ts
test.each([
  ["requested", "approve", "awaiting_payment"], ["requested", "reject", "rejected"],
  ["requested", "expire_request", "request_expired"], ["requested", "withdraw", "withdrawn"],
  ["awaiting_payment", "pay", "confirmed"], ["awaiting_payment", "expire_payment", "payment_expired"],
  ["awaiting_payment", "cancel", "cancelled"], ["confirmed", "cancel", "cancelled"], ["confirmed", "complete", "completed"],
])("%s --%s--> %s", (f, e, t) => expect(nextStatus(f as any, e as any)).toBe(t));
test("invalid transitions throw", () => {
  expect(() => nextStatus("requested", "pay")).toThrow(InvalidTransitionError);
  expect(() => nextStatus("payment_expired", "pay")).toThrow(InvalidTransitionError);
  expect(() => nextStatus("cancelled", "cancel")).toThrow(InvalidTransitionError);
});
test("effectiveStatus applies expiry at read time", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  expect(effectiveStatus({ status: "awaiting_payment", requestExpiresAt: null, holdExpiresAt: new Date("2027-02-28T23:59:59Z") }, now)).toBe("payment_expired");
  expect(effectiveStatus({ status: "requested", requestExpiresAt: new Date("2027-03-01T00:00:01Z"), holdExpiresAt: null }, now)).toBe("requested");
  expect(effectiveStatus({ status: "requested", requestExpiresAt: now, holdExpiresAt: null }, now)).toBe("request_expired");
});
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 전이 표를 `Record` 상수로. 만료 판정은 `now >= expiresAt`.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(domain): booking status transitions"`

---

### Task 6: DB 스키마 + 이중 예약 제약

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/<ts>_init/migration.sql`, `prisma/migrations/<ts>_booking_exclusion/migration.sql`, `src/server/db.ts`, `tests/db/global-setup.ts`, `tests/db/factories.ts`, `tests/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `prisma` 싱글턴(`src/server/db.ts`), `type Db = PrismaClient | Prisma.TransactionClient`
  - 모델(스펙 6장 + Global Constraints 반영): `User`(role: guest|admin), `Host`, `House`, `HousePhoto`, `Room`, `RoomPhoto`, `RoomBlock`, `Booking`, `Payment`, `Refund`, `EmailLog`
  - 컬럼명은 snake_case(`@map`), Prisma 필드는 camelCase. 날짜 컬럼(`move_in`, `move_out`, `available_from`, `start_date`, `end_date_exclusive`)은 `@db.Date`.
  - 다국어 필드(`name`, `description`, `house_rules`)는 `Json` `{ en: string; ko?: string }`.
  - `Payment`: `method`(card|paypal|offline), `amountKrw Int`, `currency`(KRW|USD), `amountChargedMinor Int`, `fxRate Decimal?`, `fxQuotedAt`, `status`, `pgTxId`, `offlineNote`, `raw Json?`, `paidAt`.
  - `Refund`: `reason`(guest_cancel_full|guest_cancel_deposit_only|admin_cancel|late_payment_auto), `amountKrw`, `amountRefundedMinor`, `status`(pending|done|failed), `manual Boolean`, `pgRefundId`.
  - `Booking`: 스펙 6장 필드 + `occupants`, `coOccupantName`, `coOccupantGender`, 가격 스냅샷(`PriceQuote` 필드 전부).
  - 테스트 팩토리: `makeAdmin(db)`, `makeGuest(db, overrides?)`, `makeRoom(db, overrides?)`(host·house 자동 생성, 기본값: published, 월세 800,000, 보증금 500,000, available_from `2027-01-01`, single, gender any, max_occupants 1), `makeBooking(db, overrides)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/db/schema.test.ts
test("overlapping occupying bookings on same room are rejected by DB", async () => {
  const room = await makeRoom(prisma);
  await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
  await expect(makeBooking(prisma, { roomId: room.id, moveIn: "2027-05-01", moveOut: "2027-06-01", status: "awaiting_payment" }))
    .rejects.toThrow(/booking_no_overlap/);
});
test("adjacent bookings are allowed", async () => {
  const room = await makeRoom(prisma);
  await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
  await expect(makeBooking(prisma, { roomId: room.id, moveIn: "2027-05-15", moveOut: "2027-06-15", status: "confirmed" })).resolves.toBeTruthy();
});
test("non-occupying statuses may overlap", async () => {
  const room = await makeRoom(prisma);
  await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
  await expect(makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "requested" })).resolves.toBeTruthy();
});
```

- [ ] **Step 2: 실패 확인** — `pnpm db:up && pnpm test:db` → FAIL

- [ ] **Step 3: 스키마·마이그레이션 작성**

`pnpm prisma migrate dev --name init`으로 기본 스키마 생성 후, 빈 마이그레이션(`--create-only --name booking_exclusion`)에 다음을 넣는다:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (room_id WITH =, daterange(move_in, move_out, '[)') WITH &&)
  WHERE (status IN ('awaiting_payment', 'confirmed'));
ALTER TABLE bookings ADD CONSTRAINT booking_range_valid CHECK (move_out > move_in);
```
`global-setup.ts`: `.env.test` 로드 → `prisma migrate reset --force --skip-seed`. 각 테스트 파일 `beforeEach`에서 테이블 TRUNCATE(`tests/db/factories.ts`에 `resetDb()`).

- [ ] **Step 4: 통과 확인** — `pnpm test:db` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(db): schema and double-booking exclusion constraint"`

---

### Task 7: 예약 서비스

**Files:**
- Create: `src/server/bookings/errors.ts`, `src/server/bookings/availability.ts`, `src/server/bookings/service.ts`
- Test: `tests/db/bookings.test.ts`

**Interfaces:**
- Consumes: Task 3 `calculatePrice`, Task 4 `decideRefund`, Task 5 `nextStatus`/`effectiveStatus`/TTL 상수, Task 6 `prisma`/`Db`/팩토리
- Produces:
  ```ts
  class BookingError extends Error { code: "ROOM_NOT_FOUND" | "ROOM_NOT_PUBLISHED" | "TOO_SOON" | "BEFORE_AVAILABLE"
    | "GENDER_MISMATCH" | "TOO_MANY_OCCUPANTS" | "ROOM_UNAVAILABLE" | "PRICING" | "INVALID_STATE" | "FORBIDDEN"
    | "CANCEL_NOT_ALLOWED"; detail?: string }
  // availability.ts
  function isRoomFree(db: Db, roomId: string, moveIn: ISODate, moveOut: ISODate, now: Date, excludeBookingId?: string): Promise<boolean>
  // service.ts
  interface RequestInput { roomId: string; guestId: string; moveIn: ISODate; lastNight: ISODate; occupants: 1 | 2;
    guestName: string; nationality: string; gender: "male" | "female"; contact: string; message: string;
    coOccupantName?: string; coOccupantGender?: "male" | "female" }
  function createRequest(db: Db, input: RequestInput, now: Date): Promise<Booking>
  function approveRequest(db: Db, bookingId: string, now: Date): Promise<Booking>
  function rejectRequest(db: Db, bookingId: string, reason: string, now: Date): Promise<Booking>
  function withdrawRequest(db: Db, bookingId: string, guestId: string, now: Date): Promise<Booking>
  function expireDue(db: Db, now: Date): Promise<{ requestExpired: string[]; paymentExpired: string[] }>
  function confirmPaid(db: Db, bookingId: string, paymentId: string, now: Date):
    Promise<{ result: "confirmed"; autoRejectedIds: string[] } | { result: "late_payment" }>
  function confirmOfflinePayment(db: Db, bookingId: string, p: { method: "bank_transfer" | "cash" | "other"; amountKrw: number; note: string }, now: Date):
    Promise<{ result: "confirmed"; autoRejectedIds: string[] }>
  function cancelBooking(db: Db, bookingId: string, actor: { kind: "guest"; userId: string } | { kind: "admin" }, now: Date):
    Promise<{ booking: Booking; refund: RefundDecision; refundIds: string[] }>
  function markCompleted(db: Db, bookingId: string, now: Date): Promise<Booking>
  function markDepositReturned(db: Db, bookingId: string, note: string, now: Date): Promise<Booking>
  ```
  - 서비스는 이메일·PG를 호출하지 않는다. 반환값으로 무엇이 일어났는지 알려주고, 알림(2단계)과 PG 실행(4단계)은 호출자가 한다.
  - `confirmPaid`는 이미 서버에서 검증된 `Payment`(status paid, amountKrw == firstPaymentTotal)를 전제로 한다. 금액 불일치면 `INVALID_STATE`.
  - `cancelBooking`은 `Refund` 행을 `status: pending`(오프라인 결제면 `manual: true`)으로 만든다. 미결제(`awaiting_payment`) 운영자 취소는 환불 행 없음.

- [ ] **Step 1: 실패하는 테스트 작성** (`now` 기본값 `2027-03-01T03:00:00Z` = KST 3/1 12:00)

```ts
test("createRequest stores price snapshot and 48h expiry", async () => {
  const room = await makeRoom(prisma); const guest = await makeGuest(prisma);
  const b = await createRequest(prisma, req(room, guest, { moveIn: "2027-03-15", lastNight: "2027-05-14" }), now);
  expect(b.status).toBe("requested"); expect(b.moveOut).toEqual(new Date("2027-05-15"));
  expect(b.firstPaymentTotal).toBe(1_300_000);
  expect(b.requestExpiresAt).toEqual(new Date(now.getTime() + 48 * 3600_000));
});
test.each([
  [{ moveIn: "2027-03-03" }, "TOO_SOON"],               // 오늘+2일
  [{ roomAvailableFrom: "2027-04-01" }, "BEFORE_AVAILABLE"], // 방 available_from을 4/1로 만들고 3/15 입주 신청
  [{ occupants: 2 }, "TOO_MANY_OCCUPANTS"],
  [{ lastNight: "2027-04-10" }, "PRICING"],             // 1개월 미만
])("createRequest rejects %o with %s", async (o, code) => { /* expect BookingError code */ });
test("gender: female room rejects male co-occupant", async () => { /* room gender_policy female, max 2 → GENDER_MISMATCH */ });
test("createRequest moveIn exactly today+3 is allowed", async () => { /* moveIn 2027-03-04 → requested */ });
test("approve sets 24h hold and keeps the request-time price", async () => {
  /* 신청 후 room.monthlyRent를 900,000으로 변경 → 승인 → status awaiting_payment, holdExpiresAt = now+24h, firstPaymentTotal 여전히 1,300,000 */
});
test("approving two overlapping requests concurrently: exactly one succeeds", async () => {
  /* 같은 방·겹치는 기간 신청 2건 → Promise.allSettled([approve(a), approve(b)]) → fulfilled 1, rejected 1 with ROOM_UNAVAILABLE */
});
test("approve fails when the period overlaps a room block", async () => { /* ROOM_UNAVAILABLE */ });
test("approve on an expired request fails with INVALID_STATE", async () => { /* now + 49h */ });
test("confirmPaid confirms and auto-rejects overlapping requests", async () => {
  /* A 승인·결제, B(겹침) requested, C(비겹침) requested → autoRejectedIds == [B.id], C 그대로 */
});
test("confirmPaid after hold expiry (cron not yet run) returns late_payment", async () => {
  /* 저장 status awaiting_payment, now = hold+1s → { result: "late_payment" }, booking status payment_expired */
});
test("expireDue expires stale requests and holds", async () => { /* 반환 id 목록과 DB 상태 확인 */ });
test("guest cancel before deadline → full refund row; after → deposit only; on move-in day → CANCEL_NOT_ALLOWED", async () => {});
test("guest cannot cancel someone else's booking", async () => { /* FORBIDDEN */ });
test("offline-paid booking cancel creates manual refund row", async () => {});
test("cancelled booking frees the room for a new approval", async () => {});
```
`req(room, guest, overrides)`는 테스트 파일 안의 기본 `RequestInput` 생성기.

- [ ] **Step 2: 실패 확인** — `pnpm test:db tests/db/bookings.test.ts` → FAIL

- [ ] **Step 3: `errors.ts`, `availability.ts` 구현** — `isRoomFree`: 같은 방에서 `[moveIn, moveOut)`과 겹치는 `RoomBlock`이 없고, 겹치는 예약 중 `effectiveStatus`가 OCCUPYING인 것이 없으면 true(만료된 홀드는 점유 아님).

- [ ] **Step 4: `service.ts` 구현** — 상태 변경은 모두 `prisma.$transaction` 안에서 `SELECT … FOR UPDATE`(`$queryRaw`)로 대상 예약 행을 잠근 뒤 `effectiveStatus`로 현재 상태를 판단하고 `nextStatus`로 전이. 만료된 행을 만나면 먼저 만료 상태로 저장. 승인 시 exclusion constraint 위반(Postgres `23P01`)은 `BookingError("ROOM_UNAVAILABLE")`로 변환 — 동시성 보장은 이 제약이 담당하므로 `isRoomFree`는 room_blocks 검사와 친절한 에러용.

- [ ] **Step 5: 통과 확인** — `pnpm test:db` → PASS (Task 6 테스트 포함)

- [ ] **Step 6: Commit** — `git commit -m "feat(server): booking request/approve/pay/cancel service"`

---

### Task 8: 방 검색 쿼리

**Files:**
- Create: `src/server/rooms/search.ts`
- Test: `tests/db/search.test.ts`

**Interfaces:**
- Consumes: Task 7 `isRoomFree` 로직의 SQL 판정 기준(동일 규칙), Task 6 팩토리
- Produces:
  ```ts
  interface RoomSearchParams { moveIn?: ISODate; lastNight?: ISODate; minRent?: number; maxRent?: number;
    districts?: string[]; roomType?: "single" | "double"; genderPolicy?: "male" | "female" | "any"; occupants?: 1 | 2 }
  interface RoomSearchResult { roomId: string; houseId: string; roomName: LocalizedText; houseName: LocalizedText;
    district: string; lat: number; lng: number; monthlyRent: number; deposit: number; availableFrom: ISODate;
    roomType: "single" | "double"; genderPolicy: "male" | "female" | "any"; privateBathroom: boolean; coverPhotoPath: string | null }
  type LocalizedText = { en: string; ko?: string }
  function searchRooms(db: Db, p: RoomSearchParams, now: Date): Promise<RoomSearchResult[]>
  ```
  - 집·방 모두 `published`인 것만. 기간이 주어지면 `availableFrom <= moveIn`, 겹치는 block 없음, 겹치는 점유 예약 없음(`awaiting_payment`은 `hold_expires_at > now`일 때만 점유). 기간 없으면 가용성 필터 없이 전부.
  - `occupants: 2`면 `max_occupants >= 2`만. 정렬: `monthly_rent` 오름차순.
  - 한 번의 SQL(`NOT EXISTS` 서브쿼리)로 처리. 페이지네이션은 3단계에서 결정.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("excludes rooms with overlapping confirmed booking, includes adjacent", async () => {});
test("expired hold does not block search", async () => { /* awaiting_payment, hold_expires_at < now → 결과에 포함 */ });
test("excludes rooms whose availableFrom is after moveIn", async () => {});
test("excludes blocked periods", async () => {});
test("filters: rent range, districts, roomType, genderPolicy, occupants", async () => {});
test("excludes unpublished house or room", async () => {});
test("no dates → all published rooms sorted by rent", async () => {});
```
각 테스트는 방 2~3개를 만들고 `searchRooms` 결과의 `roomId` 배열을 정확히 비교한다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: `searchRooms` 구현** — `$queryRaw` 템플릿으로 파라미터 바인딩(문자열 이어붙이기 금지).
- [ ] **Step 4: 통과 확인** — `pnpm test && pnpm test:db` → 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(server): room availability search"`
