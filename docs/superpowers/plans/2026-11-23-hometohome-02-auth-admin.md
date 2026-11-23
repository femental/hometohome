# hometohome 2단계: 인증 + 운영자 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 로그인해서 숙소·방·사진·차단 기간을 등록하고, 입주 신청을 승인/거절하고, 예약을 관리(오프라인 결제 확인, 취소·환불 미리보기, 퇴실·보증금 반환 표시)할 수 있게 한다. 승인·거절·확정·취소 시 게스트에게 이메일이 간다.

**Architecture:** 1단계의 `src/server/bookings/service.ts`는 그대로 두고, 그 위에 운영자용 서비스 계층(`src/server/admin/*`)을 얹는다. 화면은 Next 16 App Router 서버 컴포넌트 + 서버 액션이며, 액션은 얇게 유지하고(`requireAdmin()` → zod 검증 → 서비스 호출) 로직은 서비스에서 DB 테스트로 검증한다. 외부 의존(Supabase Auth/Storage, Kakao, Resend)은 모두 인터페이스 뒤에 두고 테스트에선 가짜 구현을 쓴다.

**Tech Stack:** Next.js 16.4.6(App Router, `cacheComponents: true`, `proxy.ts`), React 19, Tailwind 4, Prisma 7.10.1, Supabase(`@supabase/ssr`, `@supabase/supabase-js`, 로컬은 Supabase CLI), zod, Resend, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-hometohome-mvp-design.md` (특히 5·6·7·11·12·13·14장)

**선행:** 1단계(main, `b4e8b2c`) — 도메인 함수, Prisma 스키마, 예약 서비스, 검색.

## Global Constraints

- **Next 16은 학습 데이터와 다르다** (AGENTS.md). 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다. 특히 `01-app/01-getting-started/16-proxy.md`(Middleware → `proxy.ts`), `01-app/02-guides/authentication.md`, `authentication-with-cache-components.md`, `server-actions.md`, `forms.md`. `cacheComponents: true` 상태이므로 세션을 읽는 UI는 `<Suspense>` 뒤에 두거나 문서의 opt-out(`export const instant = false`)을 따른다.
- 모든 쓰기·권한 판단은 서버. **모든 운영자 서버 액션과 라우트 핸들러는 첫 줄에서 `requireAdmin()`을 호출**한다(proxy의 리다이렉트는 편의일 뿐 보안 경계가 아님).
- 서버 액션 입력은 전부 zod로 검증한다(FormData → 타입). 금액은 정수 원, 날짜는 `'YYYY-MM-DD'`.
- 운영자 화면 문구는 **한국어**. 게스트 이메일은 게스트 `locale`(`en` 기본, `ko`).
- 시각 표시는 **KST**(`Asia/Seoul`), 형식 `YYYY-MM-DD HH:mm (KST)`.
- 이메일 발송 실패는 업무 처리를 되돌리지 않는다: DB 트랜잭션이 끝난 뒤 보내고, 결과를 `email_log`(`status: sent|failed`, `error`)에 남긴다.
- 비밀값은 서버 전용(`import "server-only"`), `NEXT_PUBLIC_*`에는 공개 가능한 값만.
- 1단계 규약 유지: npm, `npm test`(unit) / `npm run test:db`(db, 직렬) / `npm run typecheck`. Prisma 7은 에이전트의 `migrate dev`/`migrate reset`을 막는다 → 새 마이그레이션은 `prisma migrate diff`로 SQL을 만들어 손으로 저장, 테스트는 global setup의 `migrate deploy`가 적용.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **게스트(또는 비로그인)가 운영자 서버 액션을 직접 호출** — 화면을 거치지 않아도 `FORBIDDEN`/로그인 리다이렉트 → Task 2·8·9 테스트.
2. **`ADMIN_EMAILS`에서 빠진 사람** — 다음 로그인부터 운영자 권한 없음 → Task 2 테스트.
3. **승인 메일의 결제 마감 시각** — UTC가 아니라 KST로 표시 → Task 3 테스트.
4. **이메일 발송 실패** — 승인/거절/취소 자체는 성공하고 `email_log`에 failed 기록 → Task 7 테스트.
5. **예약이 있는 방·집 삭제, 확정 예약과 겹치는 차단 기간** — 거부(숨김 처리 안내) → Task 4 테스트.

---

### Task 1: 환경 변수 + Supabase 로컬 + 공통 UI 기반

**Files:**
- Create: `src/server/env.ts`, `src/lib/format.ts`, `supabase/config.toml`(`npx supabase init`), `src/components/ui/{Button,Field,Card,Badge,Table}.tsx`
- Modify: `package.json`(scripts·deps), `.env.example`, `README.md`(로컬 실행 절차)
- Test: `tests/unit/env.test.ts`, `tests/unit/format.test.ts`

**Interfaces:**
- Produces:
  - `serverEnv(): ServerEnv` — 최초 호출 시 zod로 `process.env` 검증 후 캐시. 키: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`(url), `ADMIN_EMAILS`(쉼표 목록 → 소문자 trim 배열), `EMAIL_FROM`, `RESEND_API_KEY?`, `KAKAO_REST_API_KEY?`, `PHOTO_BUCKET`(기본 `"photos"`).
  - `parseServerEnv(raw: Record<string, string | undefined>): ServerEnv` (테스트용 순수 함수)
  - `formatKST(d: Date): string` → `"2027-03-02 12:00 (KST)"`; `formatKRW(n: number): string` → `"₩1,300,000"`; `formatDate(iso: ISODate, locale: "en" | "ko"): string`
  - scripts: `sb:start`(`supabase start`), `sb:stop`, `dev` 그대로.
- 의존성 추가: `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `server-only`, `resend`; dev: `supabase`(CLI).

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("ADMIN_EMAILS is parsed, lowercased and trimmed", () => {
  expect(parseServerEnv({ ...validEnv, ADMIN_EMAILS: " Boss@Example.com, ops@example.com " }).ADMIN_EMAILS)
    .toEqual(["boss@example.com", "ops@example.com"]);
});
test("missing required key throws naming the key", () => {
  expect(() => parseServerEnv({ ...validEnv, APP_URL: undefined })).toThrow(/APP_URL/);
});
test("formatKST converts UTC to Seoul", () => {
  expect(formatKST(new Date("2027-03-02T03:00:00Z"))).toBe("2027-03-02 12:00 (KST)");
  expect(formatKST(new Date("2027-03-01T15:30:00Z"))).toBe("2027-03-02 00:30 (KST)");
});
test("formatKRW", () => { expect(formatKRW(1300000)).toBe("₩1,300,000"); });
```
- [ ] **Step 2: 실패 확인** — `npm test -- tests/unit/env.test.ts tests/unit/format.test.ts` → FAIL
- [ ] **Step 3: 구현** — `env.ts`는 `import "server-only"`. `formatKST`는 1단계와 같이 고정 +9h 계산(Intl 의존 금지 — Windows/Node ICU 차이 방지).
- [ ] **Step 4: Supabase 로컬 준비** — `npx supabase init`(config.toml 생성), `config.toml`에서 `[auth] site_url = "http://localhost:3000"`, `additional_redirect_urls = ["http://localhost:3000/auth/callback"]`, `[auth.email] enable_confirmations = false`. `.env.example`에 모든 키와 로컬 기본값 주석(`supabase status`로 확인하는 법). README에 "Docker → `npm run db:up` → `npm run sb:start` → `.env.local` 채우기 → `npm run dev`" 절차.
  - 앱 데이터 DB는 **개발 시 Supabase 로컬 Postgres**(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), 테스트는 기존 docker `h2h_test` 그대로.
- [ ] **Step 5: 공통 UI 컴포넌트** — Tailwind만 사용(컴포넌트 라이브러리 추가 안 함). `Button`(variant primary/secondary/danger, `pending` 표시), `Field`(label+input/select/textarea+error), `Card`, `Badge`(예약 상태 9종 색상 매핑 `statusBadge(status: BookingStatus)`), `Table`.
- [ ] **Step 6: 통과 확인** — `npm test`, `npm run typecheck`, `npm run lint` → PASS
- [ ] **Step 7: Commit** — `chore: env config, Supabase local setup and base UI components`

---

### Task 2: 인증 — 로그인, 콜백, 세션, 권한

**Files:**
- Create: `src/server/auth/supabase.ts`, `src/server/auth/session.ts`, `src/server/auth/sync-user.ts`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/logout/actions.ts`
- Test: `tests/db/sync-user.test.ts`, `tests/unit/session.test.ts`

**Interfaces:**
- Consumes: Task 1 `serverEnv`, 1단계 `prisma`/`Db`, `User` 모델(`id` = Supabase auth user id, `role` guest|admin)
- Produces:
  - `createSupabaseServerClient(): Promise<SupabaseClient>` (`@supabase/ssr` + `cookies()`), `createSupabaseAdminClient(): SupabaseClient` (service role, 서버 전용)
  - `syncUser(db: Db, a: { authId: string; email: string; name?: string | null; adminEmails: string[] }): Promise<User>` — upsert. **role은 매 호출마다 `adminEmails.includes(email.toLowerCase()) ? "admin" : "guest"`로 다시 계산**(목록에서 빠지면 강등). `locale`은 신규일 때만 `"en"`.
  - `type SessionUser = { id: string; email: string; role: "guest" | "admin" }`
  - `getSessionUser(): Promise<SessionUser | null>` — Supabase `auth.getUser()`(getSession 금지) → `syncUser` 결과
  - `requireUser(): Promise<SessionUser>` — 없으면 `redirect("/login?next=…")`
  - `requireAdmin(): Promise<SessionUser>` — 비로그인 → redirect `/login`, 게스트 → `forbidden()`(Next 16에 있으면, 없으면 `notFound()`)
  - 테스트용 주입점: `session.ts`는 내부적으로 `resolveAuthUser: () => Promise<{ id: string; email: string; name?: string } | null>`를 쓰고 `__setAuthResolverForTests(fn)`로 바꿀 수 있게 한다.
  - 로그인 화면: 이메일 매직링크 폼(서버 액션 `sendMagicLink(formData)` → `signInWithOtp({ email, options: { emailRedirectTo: APP_URL + "/auth/callback?next=…" } })`), "Google로 계속하기" 버튼(`signInWithOAuth({ provider: "google" })`). 영어/한국어 병기 문구(게스트도 쓰는 화면, 3단계에서 i18n으로 교체).
  - `/auth/callback`: `code` 교환 → `syncUser` → `next`(같은 출처 상대경로만 허용, 아니면 `/`)로 redirect.
  - `proxy.ts`: Supabase 세션 쿠키 갱신(공식 `@supabase/ssr` Next 패턴을 Next 16 proxy 규약에 맞게) + `/admin/:path*` 비로그인 시 `/login`으로 낙관적 리다이렉트.
  - `signOut()` 서버 액션.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
// tests/db/sync-user.test.ts
test("new user in ADMIN_EMAILS becomes admin, others guest", async () => { /* syncUser 2회, role 확인, locale "en" */ });
test("email matching is case-insensitive", async () => { /* "Boss@Example.com" vs ["boss@example.com"] → admin */ });
test("removed from ADMIN_EMAILS → demoted to guest on next sync", async () => {});
test("existing user's locale is not overwritten", async () => {});
// tests/unit/session.test.ts (resolver 주입, syncUser는 vi.mock)
test("requireAdmin redirects anonymous to /login", async () => { /* redirect 호출 확인 (next/navigation mock) */ });
test("requireAdmin rejects guest with forbidden/notFound", async () => {});
test("requireAdmin returns admin SessionUser", async () => {});
test("callback next param: only same-origin relative paths allowed", () => {
  expect(safeNext("/admin")).toBe("/admin");
  expect(safeNext("https://evil.com")).toBe("/");
  expect(safeNext("//evil.com")).toBe("/");
});
```
`safeNext(next: string | null): string`는 `src/server/auth/session.ts`에서 export.
- [ ] **Step 2: 실패 확인** — `npm test -- tests/unit/session.test.ts`, `npm run test:db -- tests/db/sync-user.test.ts` → FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 그대로. 쿠키 설정 코드는 `@supabase/ssr`의 `getAll/setAll` 방식.
- [ ] **Step 4: 통과 확인** — 단위·DB·typecheck·lint PASS
- [ ] **Step 5: 수동 확인 메모** — README에 "로컬 매직링크는 Supabase Studio의 Mailpit(`http://127.0.0.1:54324`)에서 확인" 추가. `npm run build` 통과.
- [ ] **Step 6: Commit** — `feat(auth): Supabase login, callback, session and admin guard`

---

### Task 3: 이메일 — 템플릿과 발송기

**Files:**
- Create: `src/server/email/sender.ts`, `src/server/email/templates.ts`, `src/server/email/send.ts`
- Test: `tests/unit/email-templates.test.ts`, `tests/db/email-send.test.ts`

**Interfaces:**
- Consumes: Task 1 `formatKST`, `formatKRW`, `formatDate`, `serverEnv`
- Produces:
  ```ts
  interface EmailMessage { to: string; subject: string; text: string; html: string }
  interface EmailSender { send(m: EmailMessage): Promise<void> }  // 실패 시 throw
  class MemoryEmailSender implements EmailSender { sent: EmailMessage[]; failNext?: boolean }
  class ResendEmailSender implements EmailSender { constructor(apiKey: string, from: string) }
  function defaultEmailSender(): EmailSender  // RESEND_API_KEY 있으면 Resend, 없으면 콘솔 출력 sender
  type TemplateName = "request_received" | "request_approved" | "request_rejected" | "request_expired"
    | "payment_expired" | "booking_confirmed" | "booking_cancelled" | "admin_new_request" | "admin_payment_received"
    | "admin_booking_cancelled" | "admin_late_payment_refund"
  function renderEmail(name: TemplateName, locale: "en" | "ko", data: TemplateData): { subject: string; text: string; html: string }
  function sendEmail(db: Db, sender: EmailSender, a: { to: string; template: TemplateName; locale: "en" | "ko";
    data: TemplateData; bookingId?: string }): Promise<"sent" | "failed">  // 절대 throw 안 함, email_log 기록
  ```
  - `TemplateData`: `{ guestName, houseName, roomName, moveIn, lastNight, firstPaymentTotal?, deposit?, holdExpiresAt?: Date, payUrl?, bookingUrl?, reason?, refundKrw? }` — 템플릿별 필요한 필드만 사용.
  - 스펙 13장 목록 중 "결제 마감 임박(3시간 전)"은 Cron이 필요하므로 5단계로 미룬다.
  - 이번 단계에서 실제로 발송을 연결하는 템플릿: request_approved, request_rejected, booking_confirmed, booking_cancelled, admin_booking_cancelled(Task 7). request_received·admin_new_request는 게스트 신청 화면(3단계), admin_payment_received·admin_late_payment_refund는 결제(4단계), request_expired·payment_expired는 Cron(5단계)에서 연결 — 템플릿만 지금 만든다.
  - 운영 환경의 매직링크 메일은 Supabase Auth가 보낸다(5단계에서 Supabase SMTP를 Resend로 설정).
  - admin_* 템플릿은 항상 `ko`, 수신자는 `ADMIN_EMAILS` 전원.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("request_approved (en) shows KST deadline, amount and pay link", () => {
  const m = renderEmail("request_approved", "en", { ...base, firstPaymentTotal: 1_300_000,
    holdExpiresAt: new Date("2027-03-02T03:00:00Z"), payUrl: "http://localhost:3000/en/bookings/b1/pay" });
  expect(m.text).toContain("2027-03-02 12:00 (KST)");
  expect(m.text).toContain("₩1,300,000");
  expect(m.html).toContain('href="http://localhost:3000/en/bookings/b1/pay"');
});
test("request_approved (ko) is Korean", () => { /* subject에 한글 포함 */ });
test("every template renders in en and ko without 'undefined'", () => { /* 모든 TemplateName × locale */ });
test("guest-supplied text is HTML-escaped", () => { /* guestName "<script>" → html에 &lt;script&gt; */ });
// db
test("sendEmail logs sent", async () => { /* MemoryEmailSender, email_log status sent, bookingId */ });
test("sendEmail logs failed and does not throw", async () => { /* failNext → "failed", error 기록 */ });
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 템플릿은 TS 객체(`{ en: {...}, ko: {...} }`)로, html은 단순 인라인 스타일 + 이스케이프 함수. 외부 템플릿 엔진 없음.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(email): templates, senders and logged sendEmail`

---

### Task 4: 운영자 숙소·방·차단 기간 서비스

**Files:**
- Create: `src/server/admin/catalog.ts`, `src/server/admin/schemas.ts`, `src/domain/amenities.ts`
- Test: `tests/db/admin-catalog.test.ts`, `tests/unit/admin-schemas.test.ts`

**Interfaces:**
- Consumes: 1단계 Prisma 모델(House, Room, RoomBlock, Booking), `OCCUPYING_STATUSES`, `effectiveStatus`
- Produces:
  ```ts
  // amenities.ts
  const AMENITIES = ["kitchen","washer","dryer","wifi","aircon","heating","elevator","parking","desk","tv"] as const
  type Amenity = typeof AMENITIES[number]
  const AMENITY_LABELS: Record<Amenity, { en: string; ko: string }>
  const DISTRICTS: readonly { code: string; en: string; ko: string }[]  // 서울 25개 구, code는 영문 소문자 (예: "mapo")
  // schemas.ts (zod) — FormData 파싱 헬퍼 포함
  houseInput, roomInput, blockInput : z.ZodType  // 다국어: { en: 필수 1자 이상, ko: 선택 }
  // catalog.ts
  class CatalogError extends Error { code: "NOT_FOUND" | "HAS_BOOKINGS" | "BLOCK_CONFLICT" | "INVALID" }
  function createHouse(db, hostId: string, input: HouseInput): Promise<House>
  function updateHouse(db, houseId: string, input: HouseInput): Promise<House>
  function setHouseStatus(db, houseId: string, status: "draft" | "published" | "hidden"): Promise<House>
  function deleteHouse(db, houseId: string): Promise<void>   // 하위 방 중 예약 1건이라도 있으면 HAS_BOOKINGS
  function createRoom(db, houseId: string, input: RoomInput): Promise<Room>
  function updateRoom(db, roomId: string, input: RoomInput): Promise<Room>  // 기존 신청의 가격 스냅샷은 건드리지 않음
  function setRoomStatus(db, roomId, status): Promise<Room>
  function deleteRoom(db, roomId: string): Promise<void>     // 예약 있으면 HAS_BOOKINGS
  function createBlock(db, roomId: string, input: { startDate: ISODate; endDateExclusive: ISODate; reason: string }, now: Date): Promise<RoomBlock>
    // 점유 중(effectiveStatus 기준 awaiting_payment/confirmed) 예약과 겹치면 BLOCK_CONFLICT, end <= start면 INVALID
  function deleteBlock(db, blockId: string): Promise<void>
  function getAdminHost(db, userId: string): Promise<Host>   // 운영자 user의 Host 행, 없으면 생성 (display_name = 이메일)
  function listHousesForAdmin(db): Promise<(House & { rooms: Room[] })[]>
  ```
  - `roomInput`: `maxOccupants`는 single=1 고정, double=2 고정(입력값 무시하고 roomType으로 결정); `extraPersonMonthlyFee`는 single이면 0 강제; 금액은 0 이상 정수, 월세 1 이상.
  - `houseInput`: `lat` 33~39, `lng` 124~132(한국 범위), `district`는 `DISTRICTS` code 중 하나, `nearestStations` 배열 최대 5개.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("houseInput rejects missing en name and out-of-Korea coordinates", () => {});
test("roomInput derives maxOccupants from roomType and zeroes extra fee for single", () => {});
test("create/update house and room roundtrip with multilingual fields", async () => {});
test("deleteRoom with any booking → HAS_BOOKINGS; without → deleted", async () => {});
test("deleteHouse with a booked room → HAS_BOOKINGS", async () => {});
test("createBlock overlapping confirmed booking → BLOCK_CONFLICT", async () => {});
test("createBlock overlapping only an expired hold or requested booking → allowed", async () => {});
test("createBlock adjacent to confirmed booking → allowed", async () => {});
test("createBlock end <= start → INVALID", async () => {});
test("updateRoom price does not change existing booking snapshot", async () => {});
test("getAdminHost creates host once and reuses it", async () => {});
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(admin): house, room and block catalog services`

---

### Task 5: 주소 검색 + 좌표 변환

**Files:**
- Create: `src/server/geo/kakao.ts`, `src/app/admin/_components/AddressSearch.tsx`(client), `src/app/admin/actions/geocode.ts`
- Test: `tests/unit/kakao.test.ts`

**Interfaces:**
- Produces:
  - `geocodeAddress(address: string, opts: { apiKey?: string; fetch?: typeof fetch }): Promise<{ lat: number; lng: number } | null>` — `GET https://dapi.kakao.com/v2/local/search/address.json?query=…`, 헤더 `Authorization: KakaoAK {key}`. 결과 첫 항목의 `y`→lat, `x`→lng(문자열 → number). 키 없음/0건/HTTP 오류 → `null`(throw 안 함).
  - 서버 액션 `geocodeAction(address: string): Promise<{ lat: number; lng: number } | null>` — `requireAdmin()` 후 호출.
  - `<AddressSearch onSelect={(r: { addressKo: string; district: string; lat?: number; lng?: number }) => void} />` — Daum 우편번호 스크립트(`https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js`)를 `next/script`로 로드, 선택 시 도로명 주소와 `sigunguEnglish`/`sigungu`로 구 code 매핑(Task 4 `DISTRICTS`), 이어서 `geocodeAction` 호출. 좌표를 못 얻으면 lat/lng 입력칸을 직접 채우도록 안내(수동 입력 폴백).

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("parses first document's x/y", async () => {
  const fake = async () => new Response(JSON.stringify({ documents: [{ x: "126.9019", y: "37.5559" }] }));
  expect(await geocodeAddress("서울 마포구 양화로 45", { apiKey: "k", fetch: fake as any })).toEqual({ lat: 37.5559, lng: 126.9019 });
});
test("sends KakaoAK authorization header and encoded query", async () => {});
test("no key / empty documents / HTTP 500 → null", async () => {});
test("district mapping: 마포구 / Mapo-gu → mapo", () => { /* districtCodeFromSigungu export from kakao.ts or amenities.ts */ });
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: Commit** — `feat(admin): address search and Kakao geocoding`

---

### Task 6: 사진 업로드

**Files:**
- Create: `src/server/photos/storage.ts`, `src/server/photos/service.ts`
- Test: `tests/db/photos.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PhotoStorage { put(path: string, bytes: Uint8Array, contentType: string): Promise<void>; remove(paths: string[]): Promise<void>; publicUrl(path: string): string }
  class SupabasePhotoStorage implements PhotoStorage { constructor(client: SupabaseClient, bucket: string) }
  class MemoryPhotoStorage implements PhotoStorage { files: Map<string, { bytes: Uint8Array; contentType: string }> }
  class PhotoError extends Error { code: "BAD_TYPE" | "TOO_LARGE" | "NOT_FOUND" | "LIMIT" }
  const PHOTO_MAX_BYTES = 10 * 1024 * 1024, PHOTO_TYPES = ["image/jpeg","image/png","image/webp"], PHOTOS_PER_OWNER = 20
  function addPhoto(db, storage, owner: { kind: "house" | "room"; id: string }, file: { bytes: Uint8Array; contentType: string }): Promise<HousePhoto | RoomPhoto>
    // 경로: `${kind}s/${id}/${uuid}.${ext}`, sort_order = 현재 최대 + 1. 검증 실패 시 storage 호출 전에 throw. DB 실패 시 업로드한 파일 remove.
  function removePhoto(db, storage, kind: "house" | "room", photoId: string): Promise<void>
  function reorderPhotos(db, kind, ownerId: string, orderedIds: string[]): Promise<void>  // 집합이 정확히 일치해야 함, 아니면 INVALID→NOT_FOUND
  ```
  - 버킷 `photos`는 public. Task 1 README에 로컬 버킷 생성 방법(`supabase/seed` 또는 Studio) 기록, 또는 `SupabasePhotoStorage`가 최초 put에서 버킷 없으면 생성.
  - 서버 액션 바디 크기: `next.config.ts`의 `experimental.serverActions.bodySizeLimit`(Next 16 문서 확인)를 `"12mb"`로.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("addPhoto stores file and appends sort order", async () => {});
test("rejects gif and >10MB before touching storage", async () => { /* storage.files.size === 0 */ });
test("21st photo → LIMIT", async () => {});
test("removePhoto deletes row and file", async () => {});
test("reorderPhotos applies order; mismatched id set → error, order unchanged", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: Commit** — `feat(photos): photo storage and ordering`

---

### Task 7: 운영자 예약 운영 서비스 + 알림 연결

**Files:**
- Create: `src/server/admin/bookings.ts`
- Test: `tests/db/admin-bookings.test.ts`

**Interfaces:**
- Consumes: 1단계 `approveRequest`, `rejectRequest`, `confirmOfflinePayment`, `cancelBooking`, `markCompleted`, `markDepositReturned`, `decideRefund`, `effectiveStatus`; Task 3 `sendEmail`, `EmailSender`; Task 1 `serverEnv().APP_URL`, `ADMIN_EMAILS`
- Produces:
  ```ts
  interface Deps { db: Db; email: EmailSender; now: Date; appUrl: string; adminEmails: string[] }
  function adminApprove(d: Deps, bookingId: string): Promise<Booking>            // 승인 후 request_approved 메일(payUrl = `${appUrl}/${locale}/bookings/${id}/pay`)
  function adminReject(d: Deps, bookingId: string, reason: string): Promise<Booking>  // request_rejected 메일
  function adminConfirmOffline(d: Deps, bookingId: string, p: { method: "bank_transfer" | "cash" | "other"; amountKrw: number; note: string }):
    Promise<{ autoRejectedIds: string[] }>  // booking_confirmed 메일 + 자동 거절된 신청자들에게 request_rejected
  function previewCancellation(db: Db, bookingId: string, actor: CancelActor, now: Date): Promise<RefundDecision & { payments: { method: string; currency: string; refundMinor: number }[] }>  // 쓰기 없음
  function adminCancel(d: Deps, bookingId: string): Promise<{ refundIds: string[] }>  // booking_cancelled 메일(게스트) + admin_booking_cancelled
  function adminMarkRefundDone(db: Db, refundId: string, note: string, now: Date): Promise<Refund>  // manual 환불만, pending → done
  function adminComplete(db, bookingId, now), adminDepositReturned(db, bookingId, note, now)  // 1단계 함수 위임
  function listRequests(db: Db, now: Date): Promise<AdminBookingRow[]>  // effectiveStatus === requested, requestExpiresAt 오름차순
  function listBookings(db: Db, f: { status?: BookingStatus[]; roomId?: string; from?: ISODate; to?: ISODate }, now: Date): Promise<AdminBookingRow[]>
  function getBookingDetail(db: Db, id: string, now: Date): Promise<AdminBookingDetail | null>  // 방·집·게스트·결제·환불·email_log 포함, effectiveStatus 계산 포함
  function dashboardCounts(db: Db, now: Date): Promise<{ pendingRequests: number; awaitingPayment: number; moveInsThisMonth: number; moveOutsThisMonth: number; manualRefundsPending: number }>
  type AdminBookingRow = { id; status: BookingStatus /* effective */; guestName; guestEmail; houseName; roomName; moveIn: ISODate; lastNight: ISODate; firstPaymentTotal; requestExpiresAt; holdExpiresAt }
  ```
  - 메일은 서비스 호출이 성공한 **뒤** 보낸다. 메일 실패는 결과에 영향 없음.
  - "이번 달"은 KST 달력 기준.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("adminApprove sends request_approved with KST deadline and locale pay URL", async () => {
  /* guest locale "ko" → payUrl ".../ko/bookings/<id>/pay", 메일 1통, email_log sent */
});
test("adminApprove still succeeds when email fails", async () => { /* failNext → booking awaiting_payment, email_log failed */ });
test("adminApprove on overlapping confirmed → ROOM_UNAVAILABLE and no email", async () => {});
test("adminReject sends request_rejected with reason", async () => {});
test("adminConfirmOffline confirms, emails guest and auto-rejected applicants", async () => {});
test("previewCancellation matches cancelBooking amounts and writes nothing", async () => {});
test("adminCancel on confirmed before deadline → full refund rows, guest+admin emails", async () => {});
test("adminMarkRefundDone only for manual pending refunds", async () => {});
test("listRequests hides expired requests; listBookings filters by status (effective)", async () => {});
test("dashboardCounts uses KST month boundaries", async () => { /* now = 2027-03-31T15:30Z (KST 4/1) → 4월 입주 집계 */ });
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: Commit** — `feat(admin): booking operations with email notifications`

---

### Task 8: 운영자 화면 — 레이아웃, 대시보드, 숙소·방·사진·차단

**Files:**
- Create: `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/houses/page.tsx`, `src/app/admin/houses/new/page.tsx`, `src/app/admin/houses/[id]/page.tsx`, `src/app/admin/rooms/[id]/page.tsx`, `src/app/admin/actions/catalog.ts`, `src/app/admin/actions/photos.ts`, `src/app/admin/_components/{HouseForm,RoomForm,PhotoManager,BlockList,AdminNav}.tsx`
- Test: `tests/unit/admin-actions-guard.test.ts`

**Interfaces:**
- Consumes: Task 2 `requireAdmin`, Task 4 catalog 함수·schemas·`AMENITIES`·`DISTRICTS`, Task 5 `AddressSearch`, Task 6 photo 함수, Task 7 `dashboardCounts`, Task 1 UI 컴포넌트
- Produces: 서버 액션(모두 `"use server"`, 첫 줄 `requireAdmin()`, zod 파싱, 성공 시 `revalidatePath`/redirect, 실패 시 `{ ok: false; error: string }` 한국어 메시지 반환 — `useActionState`로 폼에 표시):
  `createHouseAction`, `updateHouseAction`, `setHouseStatusAction`, `deleteHouseAction`, `createRoomAction`, `updateRoomAction`, `setRoomStatusAction`, `deleteRoomAction`, `createBlockAction`, `deleteBlockAction`, `uploadPhotoAction`, `removePhotoAction`, `reorderPhotosAction`.
  - `CatalogError`/`PhotoError` 코드 → 한국어 메시지 매핑 표를 `src/app/admin/actions/messages.ts`에 둔다(예: HAS_BOOKINGS → "예약 이력이 있어 삭제할 수 없습니다. 숨김으로 바꿔주세요.").
  - 화면: 대시보드(Task 7 카운트 5개 카드 + 응답 대기 신청 바로가기), 숙소 목록(상태 배지, 방 수), 숙소 편집(기본정보·주소검색·지하철역·공용시설 체크박스·하우스 규칙 en/ko·사진·방 목록), 방 편집(가격·보증금·입주 가능일·타입·욕실·성별·설명 en/ko·사진·차단 기간 목록/추가).
  - `/admin/layout.tsx`에서 `requireAdmin()`(cacheComponents 규칙에 맞게 Suspense 또는 `instant = false`).

- [ ] **Step 1: 실패하는 테스트 작성** — 각 액션 파일을 import해 `requireAdmin`을 게스트로 mock하면 서비스가 호출되지 않는지:
```ts
test.each(Object.entries(catalogActions))("%s refuses non-admin", async (_name, action) => {
  /* requireAdmin mock이 forbidden throw → action 호출이 reject, catalog 서비스 mock 호출 0회 */
});
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 액션·화면 구현**
- [ ] **Step 4: 확인** — `npm test`, `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build` 모두 PASS
- [ ] **Step 5: Commit** — `feat(admin-ui): dashboard and catalog management screens`

---

### Task 9: 운영자 화면 — 신청·예약 관리

**Files:**
- Create: `src/app/admin/requests/page.tsx`, `src/app/admin/bookings/page.tsx`, `src/app/admin/bookings/[id]/page.tsx`, `src/app/admin/actions/bookings.ts`, `src/app/admin/_components/{BookingActions,CancelPreview,OfflinePaymentForm,RefundList}.tsx`
- Test: `tests/unit/admin-booking-actions-guard.test.ts`

**Interfaces:**
- Consumes: Task 7 전부, Task 2 `requireAdmin`, Task 3 `defaultEmailSender`, Task 1 `formatKST`/`formatKRW`/`statusBadge`
- Produces: 서버 액션 `approveAction`, `rejectAction`(사유 필수), `confirmOfflineAction`, `cancelAction`(확인 단계에서 `previewCancellation` 결과 표시 후 실행), `markRefundDoneAction`, `completeAction`, `depositReturnedAction`. `Deps`는 `{ db: prisma, email: defaultEmailSender(), now: new Date(), appUrl, adminEmails }`로 조립.
  - `BookingError` 코드 → 한국어 메시지(`messages.ts`에 추가): ROOM_UNAVAILABLE "같은 기간에 이미 점유된 예약이 있습니다", INVALID_STATE "현재 상태에서는 할 수 없는 작업입니다", CANCEL_NOT_ALLOWED "입주일 이후에는 온라인 취소가 불가합니다" 등 전 코드.
  - 화면: 신청 목록(남은 응답 시간), 예약 목록(상태·기간·방 필터, KST 표시), 예약 상세(신청자 정보, 가격 스냅샷, 상태별 버튼만 노출, 결제·환불 내역, 메일 발송 이력, 오프라인 결제 폼은 `awaiting_payment`일 때만, 금액 기본값 = firstPaymentTotal).

- [ ] **Step 1: 실패하는 테스트 작성** — Task 8과 같은 방식으로 모든 예약 액션이 게스트에게 거부되는지 + `rejectAction`이 빈 사유를 zod로 거부하는지.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 액션·화면 구현**
- [ ] **Step 4: 확인** — `npm test`, `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build` PASS
- [ ] **Step 5: 수동 스모크(컨트롤러가 브라우저로 진행)** — Supabase 로컬 + `npm run dev`: 운영자 이메일로 매직링크 로그인 → 숙소·방 등록(사진 1장) → DB에 게스트 신청 1건 시드(1단계 `createRequest`를 부르는 `scripts/seed-request.ts`, 이 태스크에서 작성) → 승인 → Mailpit에 승인 메일 확인 → 오프라인 결제 확인 → 취소 미리보기.
- [ ] **Step 6: Commit** — `feat(admin-ui): request and booking management screens`
