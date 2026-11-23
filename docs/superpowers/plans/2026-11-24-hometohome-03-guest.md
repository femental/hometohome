# hometohome 3단계: 게스트 화면 + 지도 + 다국어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외국인 게스트가 영어/한국어로 방을 검색(목록+지도)하고, 집·방 상세를 보고, 로그인해 입주 신청을 하고, 내 예약에서 상태 확인·철회·취소를 하고, 승인 후 결제 페이지에서 결제 안내를 볼 수 있게 한다.

**Architecture:** 게스트 화면은 `src/app/[locale]/…`(en 기본, ko) 아래 서버 컴포넌트 + 서버 액션. 로직은 `src/server/guest/*` 서비스에 두고 DB 테스트로 검증, 액션은 `requireUser()` → zod → 서비스. 1단계 `searchRooms`/`createRequest`/`withdrawRequest`/`cancelBooking`, 2단계 `previewCancellation`·`sendEmail`을 재사용한다. 운영자 화면(`/admin`)은 다국어 대상이 아니며 경로를 바꾸지 않는다.

**Tech Stack:** Next.js 16.4.6(App Router, `cacheComponents`, `proxy.ts`), next-intl 4.x(Next 16 지원 확인됨), `@vis.gl/react-google-maps` 1.x, Supabase Auth, Prisma 7, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-hometohome-mvp-design.md` (5·7·8·9·12·13장), 2단계 후속 메모 `docs/superpowers/notes/2026-11-23-phase2-followups.md`의 "3단계" 항목.

**선행:** main `da7965c`.

## Global Constraints

- **Next 16은 학습 데이터와 다르다** (AGENTS.md). 코드 전에 `node_modules/next/dist/docs/`의 관련 문서(`02-guides/internationalization.md`, `authentication-with-cache-components.md`, `forms.md`, `server-actions.md`, `01-getting-started/16-proxy.md`, `12-images.md`, `14-metadata-and-og-images.md`)와 next-intl의 Next 16/proxy 설정 문서(`node_modules/next-intl` README·docs)를 읽는다.
- 로케일: `en`(기본), `ko`. URL `/en/...`, `/ko/...`; `/`는 Accept-Language(ko면 ko, 그 외 en) 또는 저장된 쿠키로 리다이렉트. 모든 게스트 문구는 `messages/en.json`·`messages/ko.json`에서 가져오고 두 파일의 키 집합은 같아야 한다.
- 다국어 DB 필드(`{ en, ko? }`)는 `pickText(t, locale)` = `locale === "ko" && t.ko ? t.ko : t.en`.
- 금액은 KRW로 표시(`formatKRW`)하고 옆에 참고 USD를 `≈ $1,050` 형식으로 표시한다(환율은 4단계 전까지 `NEXT_PUBLIC_USD_KRW_REFERENCE` 고정값, 기본 1380). 시각은 KST(`formatKST`), 날짜는 `formatDate(iso, locale)`.
- 모든 게스트 서버 액션은 첫 줄에서 `requireUser()`; 예약 조회·변경은 **본인 예약만**(아니면 404). 가격·금액은 서버 계산만 사용.
- 사용자 동기화(`syncUser`)는 로그인 확인 라우트에서만 한다. 게스트 페이지의 세션 확인은 users 행을 **읽기만** 한다(운영자 `requireAdmin`은 기존대로 매 요청 역할 재계산).
- 화면은 모바일 우선(375px에서 가로 스크롤 없음), Tailwind만 사용, 2단계 `src/components/ui/*` 재사용.
- BookingError 등 오류 코드는 화면에 그대로 노출하지 않고 로케일 문구로 매핑한다.
- 1·2단계 규약 유지: npm, `npm test` / `npm run test:db` / `npm run typecheck` / `npm run lint` / `npm run build`(빌드에는 `RESEND_API_KEY` 등 placeholder env 필요). 마이그레이션은 `prisma migrate diff`로 SQL 생성 후 손 저장(에이전트는 migrate dev/reset 불가).
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **다른 게스트의 예약 ID로 접근/액션** — 404, 아무 변경 없음 → Task 6 테스트.
2. **잘못된 검색 파라미터**(종료일만, 종료<시작, 숫자 아닌 월세) — 500 없이 안내 문구와 함께 필터 무시 → Task 4 테스트.
3. **2인 신청인데 동반자 이름/성별 없음** — 검증 오류 → Task 5 테스트.
4. **비공개(draft/hidden) 집·방을 URL로 직접 접근** — 404 → Task 3 테스트.
5. **Google Maps 키 없음 / 로드 실패** — 목록은 정상, 지도 자리에 안내 → Task 4 (수동 확인 + 컴포넌트가 키 없을 때 지도 미렌더 단위 테스트).

---

### Task 1: 다국어 기반 (next-intl + `[locale]` 라우팅)

**Files:**
- Create: `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/i18n/navigation.ts`, `messages/en.json`, `messages/ko.json`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`(임시: 제목만, Task 4에서 교체), `src/components/site/{Header,Footer,LocaleSwitcher}.tsx`, `src/lib/i18n-text.ts`
- Modify: `src/proxy.ts`(next-intl 미들웨어와 Supabase 세션 갱신 결합, `/admin`·`/auth`·`/api`·정적 파일 제외), `next.config.ts`(next-intl 플러그인), `src/app/layout.tsx`(루트는 최소화, `<html lang>`은 `[locale]` 레이아웃에서), 기존 `src/app/page.tsx` 삭제
- Test: `tests/unit/messages-parity.test.ts`, `tests/unit/i18n-text.test.ts`, `tests/unit/proxy-locale.test.ts`

**Interfaces:**
- Produces:
  - `routing = defineRouting({ locales: ["en","ko"], defaultLocale: "en", localePrefix: "always" })`; `type Locale = "en" | "ko"`
  - `Link, redirect, usePathname, useRouter, getPathname` from `src/i18n/navigation.ts`
  - `pickText(t: { en: string; ko?: string } | null | undefined, locale: Locale): string`
  - `formatUsdReference(krw: number): string` → `"≈ $942"` (정수 달러 반올림, 기준 환율 env, 기본 1380)
  - `<Header />`(로고, 검색, 내 예약, 로그인/로그아웃, LocaleSwitcher), `<Footer />`(Task 7에서 사업자 정보 채움, 지금은 링크 자리)
  - LocaleSwitcher: 같은 경로의 다른 로케일로 이동, 로그인 상태면 `updateLocaleAction(locale)`(Task 2)로 users.locale 저장
- 메시지 네임스페이스(최상위 키): `common`, `nav`, `search`, `house`, `room`, `request`, `bookings`, `pay`, `auth`, `errors`, `legal`, `footer`. 이번 태스크는 `common`·`nav`·`footer`만 채우고 나머지는 각 태스크가 추가.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("en and ko message files have identical key sets", () => { /* 재귀 키 수집 후 toEqual */ });
test("pickText", () => {
  expect(pickText({ en: "Room", ko: "방" }, "ko")).toBe("방");
  expect(pickText({ en: "Room" }, "ko")).toBe("Room");
  expect(pickText({ en: "Room", ko: "" }, "ko")).toBe("Room");
});
test("formatUsdReference", () => { expect(formatUsdReference(1_300_000)).toBe("≈ $942"); });
test("proxy: / with Accept-Language ko → /ko; en-US → /en; /admin untouched", async () => { /* proxy(new NextRequest(...)) 응답 Location 확인, Supabase는 env 없음 경로로 */ });
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — next-intl 공식 Next 16 설정을 따른다(문서 확인). proxy는 next-intl 응답을 받은 뒤 같은 응답에 Supabase 쿠키 갱신을 적용하는 순서로 결합.
- [ ] **Step 4: 확인** — `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, 수동으로 `/`→`/en`, `/ko` 렌더, `/admin` 영향 없음
- [ ] **Step 5: Commit** — `feat(i18n): next-intl locale routing, header and footer shell`

---

### Task 2: 로그인 개선 (token_hash 확인 라우트, 읽기 전용 세션, 로케일 저장)

**Files:**
- Create: `src/app/auth/confirm/route.ts`, `src/app/[locale]/login/page.tsx`, `src/app/[locale]/login/actions.ts`, `src/server/auth/guest.ts`, `src/app/[locale]/account/actions.ts`
- Modify: `src/app/auth/callback/route.ts`(실패 시 signOut 후 리다이렉트), `supabase/config.toml`(`[auth.email.template.magic_link]` → `supabase/templates/magic_link.html`, 링크 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`), 기존 `src/app/login/*`는 `/admin` 운영자 로그인용으로 `/{locale}/login`으로 리다이렉트만 남김(`requireAdmin`의 로그인 경로를 `/ko/login`으로)
- Test: `tests/unit/auth-routes.test.ts`, `tests/db/guest-session.test.ts`

**Interfaces:**
- Produces:
  - `GET /auth/confirm?token_hash&type&next` — `supabase.auth.verifyOtp({ type, token_hash })` → 성공 시 `syncUser` → `safeNext(next)`로 redirect; 실패 또는 `syncUser` 예외 시 `signOut()` 후 `/{locale}/login?error=auth`(locale은 next의 첫 세그먼트, 없으면 en)
  - `/auth/callback`(Google OAuth)도 같은 실패 처리
  - `getGuestUser(): Promise<SessionUser & { name: string; locale: Locale } | null>` — `auth.getUser()` 후 users 행을 **읽기만**; 행이 없으면 그때만 `syncUser` 1회
  - `requireUser(next?: string): Promise<…>` — 게스트 페이지용으로 `getGuestUser` 기반으로 바꾸고 비로그인 시 `/{locale}/login?next=…`(locale은 next에서 추출, 기본 en)
  - `updateLocaleAction(locale: Locale): Promise<void>` — requireUser 후 users.locale 갱신(메일 언어에 사용)
  - 로그인 화면은 `auth` 네임스페이스 문구로 en/ko, 매직링크 `emailRedirectTo`는 `${APP_URL}/auth/confirm?next=…`가 아니라 Supabase 템플릿이 confirm 링크를 만들도록 `emailRedirectTo: next 경로의 절대 URL`.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("confirm: verifyOtp ok → syncUser → redirect to safe next", async () => { /* supabase client mock */ });
test("confirm: verifyOtp error → signOut, redirect /en/login?error=auth", async () => {});
test("confirm: syncUser throws → signOut, redirect /ko/login?error=auth when next=/ko/...", async () => {});
test("confirm: next=//evil.com → redirect to /", async () => {});
test("callback: toAuthUser null → signOut and error redirect", async () => {});
// db
test("getGuestUser reads existing row without writing", async () => { /* updatedAt/role 변화 없음, ADMIN_EMAILS 변경해도 role 그대로 */ });
test("getGuestUser creates row once when missing", async () => {});
test("updateLocaleAction stores locale", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과(`npm test`, `npm run test:db`, typecheck, lint, build)** — 로컬 Supabase로 매직링크 메일(Mailpit)의 링크가 `/auth/confirm?token_hash=`인지 수동 확인
- [ ] **Step 5: Commit** — `feat(auth): token_hash magic link confirm, read-only guest session, locale preference`

---

### Task 3: 게스트용 카탈로그 조회 서비스

**Files:**
- Create: `src/server/guest/catalog.ts`
- Test: `tests/db/guest-catalog.test.ts`

**Interfaces:**
- Consumes: Prisma 모델, `photoUrl`, `isRoomFree`(1단계), `calculatePrice`
- Produces:
  ```ts
  interface PublicPhoto { url: string; alt: string }
  interface PublicHouse { id; name: LocalizedText; description: LocalizedText; houseRules: LocalizedText; district: string;
    addressKo: string; lat: number; lng: number; amenities: Amenity[]; nearestStations: Station[]; photos: PublicPhoto[];
    rooms: PublicRoomSummary[] }
  interface PublicRoomSummary { id; name: LocalizedText; monthlyRent; deposit; availableFrom: ISODate; roomType; genderPolicy;
    privateBathroom: boolean; maxOccupants: number; extraPersonMonthlyFee: number; coverPhotoUrl: string | null; available?: boolean }
  interface PublicRoom extends PublicRoomSummary { description: LocalizedText; photos: PublicPhoto[]; house: Omit<PublicHouse, "rooms"> }
  function getPublicHouse(db: Db, id: string, opts: { moveIn?: ISODate; lastNight?: ISODate; now: Date }): Promise<PublicHouse | null>
  function getPublicRoom(db: Db, id: string): Promise<PublicRoom | null>
  ```
  - 집·방 모두 `published`일 때만 반환(방은 집도 published여야), 아니면 `null`. id가 uuid가 아니면 `null`(DB 조회 없이).
  - `getPublicHouse`에 기간이 주어지면 각 방의 `available`을 `isRoomFree` 규칙 + `availableFrom <= moveIn`으로 계산.
  - 사진은 sortOrder 순, `alt`는 집/방 영문 이름.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("published house with rooms is returned; draft/hidden rooms excluded", async () => {});
test("hidden house → null; room of hidden house → null; malformed id → null", async () => {});
test("availability per room for given dates (confirmed overlap → false, adjacent → true)", async () => {});
test("photos ordered and mapped to public URLs", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과**
- [ ] **Step 5: Commit** — `feat(guest): public house and room read services`

---

### Task 4: 검색 화면 + 지도

**Files:**
- Create: `src/app/[locale]/page.tsx`(교체), `src/app/[locale]/_components/{SearchForm,ResultList,RoomCard,ResultsMap,MapFallback}.tsx`, `src/server/guest/search-params.ts`
- Modify: `next.config.ts`(`images.remotePatterns`에 Supabase Storage 호스트 — `NEXT_PUBLIC_SUPABASE_URL`에서 도출), `messages/*.json`(`search`)
- Test: `tests/unit/search-params.test.ts`, `tests/unit/results-map.test.tsx`(필요 시 `@testing-library/react` + jsdom을 unit 프로젝트의 해당 파일에만)

**Interfaces:**
- Consumes: 1단계 `searchRooms(db, params, now)`·`RoomSearchParams`·`RoomSearchResult`, `DISTRICTS`, Task 1 `pickText`·`formatUsdReference`
- Produces:
  - `parseSearchParams(sp: Record<string, string | string[] | undefined>, todayKst: ISODate): { params: RoomSearchParams; issues: ("dates_incomplete" | "dates_order" | "dates_past" | "rent_invalid" | "district_invalid")[] }` — 문제 있는 필터는 버리고 issue만 기록(throw 안 함). 입주일이 오늘(KST)+3일보다 이르면 `dates_past`로 기간 필터 제거. 쿼리 키: `moveIn`, `lastNight`, `minRent`, `maxRent`, `district`(복수), `type`, `gender`, `occupants`.
  - 결과 화면: 위에 SearchForm(GET), 왼쪽(모바일은 탭 전환 "List"/"Map") 목록, 오른쪽 지도. 결과 0건이면 안내.
  - `ResultsMap`(client): `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 없으면 `<MapFallback />`(지도 대신 안내 문구)만 렌더. 마커는 집 단위로 묶고(같은 house 여러 방 → 1개 마커, 최저 월세 라벨), 클릭 시 집 카드 팝업 → 집 상세 링크. 지도 범위는 결과 좌표에 fit, 결과 없으면 서울 중심(37.5665, 126.9780).
  - RoomCard: 대표 사진, 방·집 이름(pickText), 구, 월세(KRW + 참고 USD), 보증금, 입주 가능일, 타입/성별/욕실 배지 → `/[locale]/rooms/[id]?moveIn&lastNight` 링크(검색 기간 유지).
  - 페이지 `generateMetadata`: 로케일별 제목, `alternates.languages`(en/ko).

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("valid params pass through", () => {});
test("only lastNight → dates_incomplete, no date filter", () => {});
test("lastNight < moveIn → dates_order", () => {});
test("moveIn earlier than today+3 → dates_past", () => {});
test("minRent=abc → rent_invalid, ignored", () => {});
test("unknown district dropped with district_invalid", () => {});
test("ResultsMap without API key renders fallback, not a map", () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과(+ build)**
- [ ] **Step 5: Commit** — `feat(guest): search page with list and map`

---

### Task 5: 집·방 상세 + 입주 신청

**Files:**
- Create: `src/app/[locale]/houses/[id]/page.tsx`, `src/app/[locale]/rooms/[id]/page.tsx`, `src/app/[locale]/rooms/[id]/_components/{PhotoGallery,PricePreview,RequestForm}.tsx`, `src/app/[locale]/rooms/[id]/actions.ts`, `src/server/guest/requests.ts`, `src/server/guest/errors.ts`
- Modify: `messages/*.json`(`house`, `room`, `request`, `errors`)
- Test: `tests/db/guest-requests.test.ts`, `tests/unit/guest-request-schema.test.ts`, `tests/unit/guest-actions-guard.test.ts`

**Interfaces:**
- Consumes: Task 3 `getPublicHouse`/`getPublicRoom`, 1단계 `calculatePrice`·`createRequest`·`BookingError`, 2단계 `sendEmail`·`defaultEmailSender`, Task 2 `requireUser`/`getGuestUser`
- Produces:
  - `quoteAction(input: { roomId; moveIn; lastNight; occupants }): Promise<{ ok: true; quote: PriceQuote } | { ok: false; error: GuestErrorKey }>` — 로그인 불필요(가격 미리보기), zod 검증, published 방만.
  - `requestInput` zod: roomId uuid, moveIn/lastNight ISODate, occupants 1|2, guestName 1–100, nationality 2–56, gender male|female, contact 3–100, message ≤ 1000, **occupants=2면 coOccupantName(1–100)·coOccupantGender 필수**.
  - `submitRequest(deps: { db; email; now; appUrl; adminEmails }, user: { id; email; locale }, input): Promise<{ bookingId: string }>` — `createRequest` 후 게스트 `request_received`, 운영자 전원 `admin_new_request`(ko). 메일 실패는 결과에 영향 없음.
  - `submitRequestAction(formData)` — requireUser(next=현재 방 URL) → zod → submitRequest → `/[locale]/bookings/[id]`로 redirect. 오류는 `GuestErrorKey`로 반환.
  - `type GuestErrorKey = BookingErrorCode | "VALIDATION" | "NOT_FOUND"`; `guestErrorMessageKey(code): string`(messages `errors.*` 키). 모든 BookingError 코드에 en/ko 문구 존재(테스트).
  - 방 상세: 사진 갤러리, 설명, 공용시설·하우스 규칙(집), 지하철역, 지도(단일 마커, 키 없으면 주소만), 날짜·인원 선택 → PricePreview(quoteAction, 월할/일할 내역, 첫 결제 = 첫 월세+보증금, 취소 규칙 요약 문구: 입주 7일 전 23:59 KST까지 전액, 이후 보증금만, 입주일부터 온라인 취소 불가) → RequestForm(로그인 안 됐으면 "로그인 후 신청" 버튼 → `/[locale]/login?next=`).
  - 집 상세: 집 정보 + 방 목록(검색 기간이 있으면 가능 여부 배지).

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("requestInput: occupants 2 requires co-occupant name and gender", () => {});
test("requestInput: occupants 1 ignores co-occupant fields", () => {});
test("submitRequest creates booking and sends request_received (guest locale) + admin_new_request (ko, each admin)", async () => {});
test("submitRequest on unavailable dates → BookingError ROOM_UNAVAILABLE, no emails", async () => {});
test("submitRequest still succeeds when email fails", async () => {});
test("every BookingError code has en and ko error message", () => {});
test("submitRequestAction and every guest action call requireUser first (guard)", async () => {});
test("quoteAction rejects unpublished room and invalid ranges", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과(+ build)**
- [ ] **Step 5: Commit** — `feat(guest): house and room pages with price preview and booking request`

---

### Task 6: 내 예약 + 철회·취소 + 결제 안내 페이지

**Files:**
- Create: `src/app/[locale]/bookings/page.tsx`, `src/app/[locale]/bookings/[id]/page.tsx`, `src/app/[locale]/bookings/[id]/pay/page.tsx`, `src/app/[locale]/bookings/actions.ts`, `src/server/guest/bookings.ts`
- Modify: `messages/*.json`(`bookings`, `pay`), `src/server/env.ts`(`BANK_TRANSFER_INFO_EN?`, `BANK_TRANSFER_INFO_KO?` — 여러 줄 문자열), `.env.example`
- Test: `tests/db/guest-bookings.test.ts`, guard 테스트에 액션 추가

**Interfaces:**
- Consumes: 1단계 `withdrawRequest`·`cancelBooking`·`effectiveStatus`, 2단계 `previewCancellation`·`sendEmail`, Task 2 `requireUser`
- Produces:
  - `listMyBookings(db, userId, now): Promise<GuestBookingRow[]>`(최신순, effectiveStatus)
  - `getMyBooking(db, userId, bookingId, now): Promise<GuestBookingDetail | null>` — **다른 사람 예약이면 null**(존재 여부 노출 안 함)
  - `guestWithdraw(deps, userId, bookingId)`, `guestCancel(deps, userId, bookingId): Promise<{ refundKrw: number }>` — 취소 후 게스트 `booking_cancelled` + 운영자 `admin_booking_cancelled`
  - `guestPreviewCancel(db, userId, bookingId, now)` — 2단계 `previewCancellation(…, { kind: "guest", userId })` 위임, 본인 아니면 null
  - 액션: `withdrawAction(id)`, `cancelAction(id)`(미리보기 확인 단계 후 실행) — requireUser, uuid 검증, 본인 확인, 오류는 GuestErrorKey
  - 예약 상세: 상태 배지(로케일 문구), 기간, 가격 스냅샷, 상태별 안내(`requested`: 응답 마감 시각 KST, 철회 버튼; `awaiting_payment`: 결제 마감 시각 + "결제하기" → pay 페이지; `confirmed`: 취소 규칙과 취소 버튼(미리보기 금액 표시); 만료/거절/취소: 안내).
  - 결제 페이지 `/[locale]/bookings/[id]/pay`: 본인 + `awaiting_payment`(유효)일 때만, 아니면 상세로 redirect. 첫 결제 금액(KRW + 참고 USD), 남은 시간(서버 시각 기준 표시 + 클라이언트 카운트다운), **온라인 결제는 4단계에서 연결** — 이번 단계는 `BANK_TRANSFER_INFO_{EN,KO}` 계좌이체 안내와 "입금 후 운영자가 확인하면 확정 메일이 발송됩니다" 문구(스펙 11장). 값이 없으면 "운영자에게 문의" 안내.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("getMyBooking returns null for another guest's booking", async () => {});
test("withdraw/cancel on another guest's booking → not found, no state change", async () => {});
test("guestWithdraw only from requested", async () => {});
test("guestCancel before deadline → full refund rows + guest/admin emails", async () => {});
test("guestCancel on move-in day → CANCEL_NOT_ALLOWED", async () => {});
test("listMyBookings shows effective status (expired hold → payment_expired)", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과(+ build)**
- [ ] **Step 5: Commit** — `feat(guest): my bookings, withdraw/cancel and payment instructions page`

---

### Task 7: 정적·법적 페이지 + 푸터 사업자 정보

**Files:**
- Create: `src/app/[locale]/(legal)/{terms,privacy,refund-policy,faq}/page.tsx`, `src/content/legal/{en,ko}/*.tsx`(본문)
- Modify: `src/components/site/Footer.tsx`, `src/server/env.ts`(`BUSINESS_NAME`, `BUSINESS_REP`, `BUSINESS_REG_NO`, `MAIL_ORDER_NO`, `BUSINESS_ADDRESS`, `BUSINESS_PHONE`, `BUSINESS_EMAIL` — 모두 선택, 없으면 해당 줄 숨김), `.env.example`, `messages/*.json`(`legal`, `footer`)
- Test: `tests/unit/footer.test.tsx`(값 있는 키만 렌더)

**Interfaces:**
- 환불 규정 페이지 본문은 스펙 9장 규칙을 그대로(입주 7일 전 23:59 KST까지 전액, 이후 보증금만, 입주일부터 온라인 취소 불가, 운영자 취소 시 전액, 입주 후 중도 퇴실·보증금 반환은 오프라인).
- 이용약관·개인정보처리방침·FAQ는 빌더가 초안 작성, 각 페이지 상단에 "초안 — 게시 전 법률 검토 필요"(ko)/"Draft — legal review required before publishing"(en)을 표시. 개인정보 항목은 스펙 14장(이름·국적·성별·연락처·메시지·이메일)과 일치.

- [ ] **Step 1–4: 실패하는 테스트 → 확인 → 구현 → 통과(+ build)**
- [ ] **Step 5: Commit** — `feat(guest): legal pages and business info footer`

---

### Task 8: 2단계 후속 정리 묶음

**Files:**
- Modify: `src/server/email/templates.ts`(booking_confirmed에 결제 금액 + 환불 규칙 한 줄, en/ko; deposit 필드 사용), `src/server/admin/bookings.ts`(adminConfirmOffline이 firstPaymentTotal·deposit 전달), `src/app/admin/_components/HouseForm.tsx`(주소 텍스트를 직접 수정하면 lat/lng 초기화 + 안내), `src/server/admin/bookings.ts` `listBookings`(요청 effective 상태가 나올 수 있는 저장 상태로 DB 사전 필터 + `take: 200`)
- Test: 기존 `tests/unit/email-templates.test.ts`, `tests/db/admin-bookings.test.ts`에 케이스 추가

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
test("booking_confirmed shows paid amount and refund rule (en/ko)", () => { /* "₩1,300,000", "7" days, "KST" */ });
test("listBookings status=payment_expired returns stored awaiting_payment with expired hold", async () => {});
test("listBookings caps at 200 rows", async () => {});
```
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과**
- [ ] **Step 5: Commit** — `fix: phase 2 follow-ups (confirmed mail details, stale coordinates, bounded admin list)`

---

### Task 9: 통합 확인 (컨트롤러가 브라우저로)

- [ ] 로컬 Supabase + `npm run dev`로 확인하고 결과를 기록한다(코드 변경이 생기면 해당 태스크 형식으로 수정 커밋):
  1. `/` → 브라우저 언어에 맞는 로케일, LocaleSwitcher로 전환
  2. 검색: 기간·월세·구 필터, 잘못된 파라미터 안내, 지도 키 없을 때 대체 안내(키가 있으면 마커·팝업)
  3. 방 상세: 가격 미리보기 숫자가 스펙 8장 예시와 일치(80만/50만, 3/15~5/14 → 첫 결제 130만)
  4. 게스트 매직링크 로그인(Mailpit 링크가 `/auth/confirm`) → 2인 신청 시 동반자 필수 → 신청 → 내 예약에 `requested`
  5. 운영자로 승인 → 게스트 결제 페이지에 금액·마감·계좌 안내
  6. 다른 게스트 계정으로 그 예약 URL 접근 → 404
  7. 375px 폭에서 가로 스크롤 없음
