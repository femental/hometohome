# hometohome MVP 설계 문서

- 작성일: 2026-11-21
- 상태: 초안 (대표 검토 전)
- 표기: **[결정]** = 대표가 대화에서 정한 것, **[제안]** = 설계자(Claude)의 판단으로 정한 것(대표가 바꿀 수 있음)

---

## 1. 의도와 배경

- 서울에서 **한 달 이상** 머무는 **외국인**이 공유주택·단기임대 숙소를 **방 단위**로 찾고, 신청하고, 온라인으로 첫 결제를 해서 예약을 확정하는 웹 서비스.
- 목적은 **시장 검증(MVP)**. 앱 출시 전에 실제 결제가 되는 안정적인 웹을 빠르게 열어 반응을 본다. 결과에 따라 앱·고도화로 넘어간다.
- 기존 바이브 코딩 시제품 코드는 **사용하지 않는다** [결정]. 화면·규칙은 이 문서를 기준으로 새로 만든다.
- 대표가 직접 풀스택으로 개발한다.

## 2. 목표 / 비목표 / 반목표

### 목표
1. 게스트가 날짜·조건으로 방을 검색하고 목록+지도로 본다.
2. 게스트가 입주 신청 → 운영자 승인 → 24시간 내 온라인 결제(첫 달 + 보증금) → 예약 확정까지 끝낸다.
3. 카드와 PayPal로 결제할 수 있다.
4. 규칙에 따른 취소·자동 환불이 된다.
5. 운영자가 숙소·방을 등록하고, 신청을 처리하고, 입주자를 관리한다.
6. 실제 도메인에 배포되어 운영된다.

### 비목표 (이번 범위 아님)
- 외부 집주인 입점·심사·수수료·정산 (데이터 구조만 대비) [결정]
- 둘째 달 이후 월세의 온라인 수납 — 오프라인 처리 [결정]
- 보증금 반환의 온라인 처리 — 오프라인 계좌이체, 시스템은 상태만 기록 [제안]
- 입주 후 중도 퇴실 정산 — 오프라인 [제안]
- 모바일 앱, 리뷰, 채팅, 쿠폰, 동적 가격, 신분증 인증
- 영어·한국어 외 언어 (구조만 대비)

### 반목표 (기술적으로 돌아가도 이러면 실패)
- **이중 예약**: 같은 방·겹치는 기간에 확정(또는 승인 대기 결제)이 둘 이상 생기는 것.
- **결제 검증 없는 확정**: PG 서버 조회로 금액·상태를 확인하지 않고 예약이 확정되는 것.
- **클라이언트가 정한 금액으로 청구**: 결제 금액은 반드시 서버가 계산한다.
- **화면 금액 ≠ 청구 금액**: 게스트가 본 금액과 실제 청구 금액이 다른 것.
- 환불 금액이 규칙과 다르게 나가는 것.

## 3. 제약

- **사업 구조**: 첫 오픈은 대표 소유 숙소만. 결제 대금은 전부 대표 사업자로 입금 [결정].
- **결제**: 한국 사업자는 Stripe 불가. PayPal은 KRW 결제를 지원하지 않는 것으로 보임 → PayPal은 USD 청구 [결정]. (착수 시 PayPal 공식 통화표로 재확인)
- **PG 가맹 심사**: 수 주 소요 가능, 숙박 업종 추가 서류 요구 가능. 개발과 병행해 즉시 신청. 심사 결과에 따라 사용 가능한 채널이 확정됨.
- **법적 표시**: PG 심사·전자상거래법상 이용약관, 개인정보처리방침, 환불 규정, 사업자 정보(상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 연락처) 페이지/푸터 필요.
- **지도**: Google 지도는 한국 상세 데이터가 제한적이지만 마커 표시·영문 지명엔 충분. 주소→좌표 변환은 국내 API가 정확.
- **외국인 사용자**: 휴대폰 본인인증 불가 → 이메일 기반 계정·알림.
- **시간대**: 모든 날짜 규칙은 **한국 시간(Asia/Seoul)** 기준.

## 4. 접근 방식 (검토한 안)

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A. Next.js 풀스택 (채택)** | Next.js가 화면+API, 업무 규칙은 서버의 서비스 계층, Supabase는 DB·스토리지·로그인 | 코드베이스 하나, 1인 개발에 가장 빠름, `/api` REST로 추후 앱 재사용 | 서버리스 — 장시간 작업엔 약함(이번 범위엔 없음) |
| B. 프론트/백엔드 분리 (Next + NestJS) | 별도 API 서버 | 앱 확장에 가장 깔끔 | 배포·인증 두 벌, MVP 공수 약 1.5배 |
| C. Supabase 중심 BaaS | 규칙을 RLS·엣지 함수에 | 초기 최속 | 규칙이 흩어져 정산 확장·이전 시 발목 |

**채택: A** [결정] — 1인 개발·빠른 검증이 목적이고, 규칙을 서버 한곳에 모으면 외부 집주인 확장과 앱 전환 때 그대로 재사용할 수 있어서.

결제는 **PortOne V2로 단일 연동** [결정] (대안: PayPal 직접 + 국내 PG 해외카드 별도 연동 → 결제·환불 코드 두 벌이라 기각).
지도는 **Google Maps 표시 + 카카오 주소검색 좌표화** [결정] (대안: 네이버·카카오 지도 표시 → 외국인에게 낯설어 기각).

## 5. 기술 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js (App Router) + TypeScript [결정] | |
| 호스팅 | Vercel, 함수 리전 서울(icn1) [결정] | 도메인 연결, Vercel Cron |
| DB | Supabase Postgres, 서울 리전 [결정] | Prisma로 접근 [제안]. 브라우저→DB 직접 접근 금지, RLS는 전부 차단(deny-all)으로 두고 서버 service role만 사용 [제안] |
| 로그인 | Supabase Auth — Google OAuth + 이메일 매직링크 [결정] | 권한 판단은 Next 서버에서 |
| 이미지 | Supabase Storage [결정] | 표시엔 next/image |
| 결제 | PortOne V2 (해외카드 채널 예: Eximbay, PayPal 채널) [결정] | 채널은 심사 결과로 확정 |
| 지도 | Google Maps JavaScript API [결정] | 좌표는 등록 시 저장, 표시만 |
| 주소→좌표 | 다음 우편번호(주소검색) + Kakao Local API [결정] | 운영자 등록 화면에서만 사용 |
| 다국어 | next-intl, `/en`, `/ko` 경로, 기본 en [결정] | |
| 이메일 | Resend [제안] | 트랜잭션 메일만 |
| 환율 | 한국수출입은행 환율 API 등 공신력 있는 무료 API, 하루 1회 캐시 [제안] | |
| 오류 모니터링 | Sentry [제안] | |
| 테스트 | Vitest(가격·환불·상태 전이 단위 테스트), Playwright(예약 흐름 E2E, PortOne 테스트 모드) [제안] | |

## 6. 데이터 모델 [제안]

> 모든 금액은 KRW 정수(원). 외화는 소수 2자리 decimal. 날짜는 `date`(시간 없음), 시각은 `timestamptz`.

### users
- `id` (Supabase auth user id), `email`, `name`, `role` (`guest` | `admin`), `locale`, `created_at`
- 추후 `host` 역할 추가 대비.

### hosts
- `id`, `user_id`, `display_name`, `created_at`
- 지금은 대표 1행. 모든 집은 host에 속함 → 외부 집주인 확장 시 구조 변경 없음.

### houses (집)
- `id`, `host_id`, `status` (`draft` | `published` | `hidden`)
- `name` / `description` / `house_rules`: JSONB `{ "en": "...", "ko": "..." }` (en 필수)
- `address_ko`(도로명), `address_en`(선택), `district`(구, 예: `mapo`), `lat`, `lng`
- `nearest_stations`: JSONB 배열 `[{ "name_en", "name_ko", "line", "walk_min" }]`
- `amenities`: 텍스트 배열 (예: `kitchen`, `washer`, `wifi`, `aircon`, `elevator`) — 코드 상수로 관리, 라벨은 번역 파일
- `created_at`, `updated_at`

### house_photos / room_photos
- `id`, `house_id` 또는 `room_id`, `storage_path`, `sort_order`

### rooms (방)
- `id`, `house_id`, `status` (`draft` | `published` | `hidden`)
- `name`: JSONB `{en, ko}`
- `monthly_rent` (원), `deposit` (원)
- `available_from` (date) — 이 날짜 이전 입주 불가
- `room_type` (`single` | `double`), `private_bathroom` (bool), `gender_policy` (`male` | `female` | `any`)
- `max_occupants` (single=1, double=2), `extra_person_monthly_fee` (원, 2인 입주 시 월세에 더해지는 금액, 기본 0) [결정: 방 단위 예약 + 인원수 + 추가 요금]
- **예약 단위는 방 전체** [결정]: 2인실은 한 예약(커플·친구)이 통째로 사용. 침대 단위 판매 안 함.
- `description`: JSONB `{en, ko}`

### room_blocks (운영자 수동 차단 기간)
- `id`, `room_id`, `start_date`, `end_date_exclusive`, `reason`

### bookings (신청·예약 하나의 수명)
- `id`, `room_id`, `guest_id`
- `move_in` (date), `move_out` (date, **퇴실일 = 마지막 숙박일 다음 날**, exclusive)
- 신청 정보: `guest_name`, `nationality`, `gender`, `contact`(이메일 외 연락처, 예: WhatsApp), `message`
- `occupants` (1~`max_occupants`), `co_occupant_name`, `co_occupant_gender` (2인일 때)
- 가격 스냅샷(신청 시 계산·고정, 이후 변경 없음): `monthly_rent`, `deposit`, `full_months`, `extra_days`, `stay_total`, `first_rent_amount`, `first_payment_total`(= first_rent_amount + deposit)
- 상태: `status` (7장), `requested_at`, `request_expires_at`, `approved_at`, `hold_expires_at`, `confirmed_at`, `cancelled_at`, `cancel_reason`, `rejected_reason`
- 보증금 반환: `deposit_returned_at`, `deposit_return_note`
- 중복 방지: **Postgres exclusion constraint** — `status in ('awaiting_payment','confirmed')` 인 행끼리 같은 `room_id`에서 `daterange(move_in, move_out)` 겹침 금지 (`btree_gist`). room_blocks와의 겹침은 승인 시 트랜잭션 안에서 검사.

### payments
- `id` (= PortOne `paymentId`로 사용), `booking_id`, `method` (`card` | `paypal` | `offline`), `offline_note`(오프라인일 때 수단·메모)
- `amount_krw` (청구 기준 원화 = first_payment_total)
- `currency` (`KRW` | `USD`), `amount_charged` (실제 청구 통화 금액), `fx_rate` (1 USD당 원, USD일 때), `fx_quoted_at`
- `status` (`pending` | `paid` | `failed` | `cancelled` | `partially_refunded` | `refunded`)
- `pg_tx_id`, `paid_at`, `raw` (PG 응답 JSONB)

### refunds
- `id`, `payment_id`, `reason` (`guest_cancel_full` | `guest_cancel_deposit_only` | `admin_cancel` | `late_payment_auto`), `amount_krw`, `amount_refunded`(청구 통화 기준), `status`, `pg_refund_id`, `created_at`

### email_log (선택)
- 발송 이력. 디버깅·재발송용.

## 7. 예약 상태와 흐름

### 상태
| 상태 | 의미 | 방 점유 |
|---|---|---|
| `requested` | 게스트 신청, 운영자 응답 대기 | 점유 안 함 (같은 기간 신청 여러 건 공존 가능) |
| `rejected` | 운영자 거절 | — |
| `request_expired` | 운영자가 기한 내 응답 안 함 | — |
| `withdrawn` | 게스트가 신청 철회 | — |
| `awaiting_payment` | 승인됨, **24시간** 결제 대기 | **점유** |
| `payment_expired` | 24시간 내 미결제 | — (방 다시 열림) |
| `confirmed` | 결제 검증 완료, 예약 확정 | **점유** |
| `cancelled` | 확정 후 입주 전 취소 (환불 처리) | — |
| `completed` | 퇴실 완료 (운영자가 표시) | 과거 기간 |

### 흐름 [결정 + 제안]
1. **신청** (게스트, 로그인 필요): 방·입주일·퇴실일 선택 → 서버가 가격 계산·가용성 확인 → 신청서 제출 → `requested`. 결제 없음 [결정].
   - 입주일 ≥ 오늘(KST) + 3일 [제안] (승인 + 24h 결제 시간 확보)
   - 입주일 ≥ `room.available_from`, 방 `gender_policy`와 **입주자 전원** 성별 일치 [제안] — 성별 제한 방에는 동성 2인만, 혼성 커플은 `any` 방만 가능
   - `occupants ≤ room.max_occupants`
   - `request_expires_at` = 신청 시각 + 48시간 [제안]. 지나면 `request_expired` + 게스트 메일.
2. **승인/거절** (운영자): 승인 시 트랜잭션에서 가용성 재확인(점유 예약·room_blocks) → **신청 시점 가격 스냅샷을 그대로 사용**(재계산하지 않음; 운영자가 그 사이 방 가격을 바꿔도 기존 신청에는 적용 안 됨) [제안] → `awaiting_payment`, `hold_expires_at` = 승인 시각 + 24시간 [결정] → 게스트에게 결제 링크 메일.
3. **결제** (게스트, 24시간 내): 결제 페이지에서 카드/PayPal 선택 → 서버가 `payments` 행 생성(금액·통화·환율 서버 확정) → PortOne SDK 결제창 → 완료 후 **서버가 PortOne API로 결제 조회해 금액·상태 검증** → `confirmed` + 확정 메일. 웹훅도 같은 검증 함수를 호출(멱등).
   - 확정 시 같은 방·겹치는 기간의 `requested` 신청은 자동 `rejected` + 안내 메일 [제안].
4. **만료**: Vercel Cron(5분 간격) [제안]으로 `request_expires_at`/`hold_expires_at` 지난 건 처리. 조회 시점에도 만료 시각을 기준으로 판단해 Cron 지연과 무관하게 정확히 동작.
   - **만료 후 결제 도착**(경합): 자동 전액 환불 + `payment_expired` 유지 + 게스트·운영자 메일.
5. **취소** (확정 후, 입주 전): 게스트가 "내 예약"에서 취소 또는 운영자가 관리 화면에서 취소 → 환불 계산(9장) → PortOne 취소 API로 자동 (부분)환불 → `cancelled` [결정].
6. **입주 후**: 월세·중도 퇴실·보증금 반환은 오프라인 [결정]. 운영자가 `completed`, 보증금 반환 완료를 표시.

## 8. 가격 계산 규칙 [결정]

입력: `monthly_rent`, `deposit`, `move_in`, `move_out`(exclusive), `occupants`.

0. **적용 월세**: 2인이면 `monthly_rent` + `extra_person_monthly_fee`, 1인이면 `monthly_rent`. 이하 `monthly_rent`는 이 적용 월세를 뜻한다. 보증금은 인원과 무관 [제안].

1. **개월 수**: `full_months` = `move_in`에 k개월을 더한 날짜가 `move_out` 이하인 최대 k. 월말 보정: 더한 달에 해당 일이 없으면 그 달 말일 (예: 1/31 + 1개월 = 2/28 또는 2/29).
2. **최소·최대 기간**: `full_months ≥ 1`. 미만이면 신청 불가. 최대 12개월(`move_out ≤ move_in + 12개월`) [제안] — 작은 첫 결제로 방을 장기간 묶지 않도록. 설정값으로 둔다.
3. **남는 일수**: `extra_days` = `move_out` − (`move_in` + `full_months`개월).
4. **일할 금액**: `round(monthly_rent / 30 × extra_days)` (원 단위 반올림).
5. **총 숙박 금액**: `stay_total` = `monthly_rent × full_months` + 일할 금액.
6. **첫 결제 금액**:
   - 전체 기간이 2개월 미만(`full_months == 1`): `first_rent_amount` = `stay_total` (남는 날까지 전부)
   - 그 외: `first_rent_amount` = `monthly_rent` (입주일부터 1개월치)
   - `first_payment_total` = `first_rent_amount` + `deposit`

예시 (월세 800,000원, 보증금 500,000원):
| 입주 | 퇴실(exclusive) | 개월 | 남는 일 | 총액 | 첫 결제 |
|---|---|---|---|---|---|
| 3/15 | 5/15 | 2 | 0 | 1,600,000 | 800,000 + 500,000 = 1,300,000 |
| 3/15 | 4/25 | 1 | 10 | 1,066,667 | 1,066,667 + 500,000 = 1,566,667 |
| 3/15 | 5/25 | 2 | 10 | 1,866,667 | 800,000 + 500,000 = 1,300,000 |
| 1/31 | 2/28 | 1 | 0 | 800,000 | 1,300,000 (2/28은 1/31+1개월) |

> 화면의 날짜 선택 UI는 "입주일 + 마지막 숙박일"로 받고, 저장 시 `move_out` = 마지막 숙박일 + 1일로 변환 [제안]. 게스트에게는 "3/15 ~ 5/14 (2개월)"처럼 표시.

가격 계산은 **단일 순수 함수**로 구현하고 화면 미리보기·신청·승인·결제 모두 이 함수(서버)를 거친다.

## 9. 취소·환불 규칙 [결정]

- **기한**: `move_in` − 7일의 23:59:59 KST. (예: 입주 3/15 → 3/8 23:59:59까지)
- 기한 내 취소: `first_payment_total` **전액** 환불.
- 기한 후 취소(입주 전): **보증금만** 환불.
- 입주일 이후: 온라인 취소 불가 (오프라인).
- 운영자 측 취소(방 사고 등): 항상 전액 환불 [제안].
- **통화별 환불 금액**:
  - KRW 결제: 위 원화 금액 그대로.
  - USD(PayPal) 결제: `환불 USD = round(amount_charged × 환불 KRW / amount_krw, 2)`. 전액이면 `amount_charged` 그대로. → 게스트가 실제 낸 금액 기준 비율 [결정].
- 취소 버튼을 누르기 전, 환불 예정 금액을 게스트에게 보여준다.

## 10. 통화와 환율 [결정]

- 가격 기준·표시: **KRW**. 옆에 참고용 USD 표기("≈ $1,050").
- 카드: **KRW 청구** (해외 카드사가 게스트 통화로 환산). ※ 선택한 PG 채널의 KRW 해외카드 청구 지원 여부는 계약 시 확인.
  - 구현은 **결제 수단과 통화를 분리**한다 [제안]: 환율 견적·비율 환불 로직은 "청구 통화 ≠ KRW"인 모든 결제에 적용되게 만들어, 카드도 USD로 청구해야 하는 경우 설정만 바꾸면 되게 한다.
  - 국내 카드·카카오페이 등 국내 결제수단은 이번 범위 아님 [제안].
- PayPal: **USD 청구**. 결제 시작 시점 환율로 `amount_charged = ceil(amount_krw / fx_rate × (1 + fx_margin), 2)`.
  - `fx_margin`은 설정값, 기본 **2%** [결정].
  - 환율 견적은 해당 `payments` 행에 고정되며 그 결제 시도에만 유효. 결제 재시도 시 새 견적.
- 환율 손익은 대표가 감수 [결정].

## 11. PG 미승인 대비: 오프라인 결제 확인 [결정]

- PG 심사가 오픈까지 끝나지 않거나 일부 채널만 승인될 경우를 대비해, 운영자 화면에 **"오프라인 결제 확인"** 기능을 둔다.
- `awaiting_payment` 예약에 대해 운영자가 수단(`bank_transfer` | `cash` | `other`), 받은 금액(원), 메모를 입력하면 `payments` 행(`method = offline`, `currency = KRW`, `status = paid`)을 만들고 `confirmed`로 전이. 확정 메일은 동일.
- 온라인 결제 채널은 설정으로 켜고 끈다(카드/PayPal 각각). 모두 꺼져 있으면 게스트 결제 페이지에는 계좌이체 안내 문구를 보여준다.
- 오프라인 결제 건의 취소 환불은 시스템이 환불 금액만 계산해 보여주고, 실제 송금은 운영자가 처리 후 "환불 완료"를 표시.
- `payments.method`에 `offline` 추가, `refunds`에 수동 처리 여부 표시.

## 12. 화면 목록

### 게스트 (en/ko)
- **홈/검색**: 입주일·마지막 숙박일, 월세 범위, 지역(구), 방 타입, 성별 정책 필터 → 결과를 **목록 + 지도**(마커, 지도 이동 시 목록 동기화는 선택) [결정]
  - 검색 결과에는 해당 기간에 점유(awaiting_payment/confirmed)·차단이 없고 `available_from` 조건을 만족하는 published 방만 표시.
  - 기간 미입력 시 모든 published 방 + "입주 가능일" 표시.
- **집 상세**: 사진, 설명, 공용시설, 하우스 규칙, 지하철역, 지도, 하위 방 목록
- **방 상세 / 신청**: 방 정보, 날짜 선택, 실시간 가격 미리보기(8장 규칙), 신청서
- **로그인**: Google, 이메일 매직링크
- **내 예약**: 상태별 목록, 결제 버튼(awaiting_payment, 남은 시간 표시), 취소(환불 예정액 표시)
- **결제 페이지**: 금액 요약, 카드/PayPal 선택, 결과 페이지
- **정적 페이지**: 이용약관, 개인정보처리방침, 환불 규정, FAQ, 사업자 정보 푸터

### 운영자 (`/admin`, role=admin, 한국어 우선)
- 대시보드: 응답 대기 신청 수, 결제 대기, 이번 달 입주/퇴실 예정
- 숙소 관리: 집 CRUD(주소검색 → 좌표 자동), 사진 업로드·정렬, 방 CRUD, 차단 기간
- 신청 관리: 신청 상세(신청자 정보·가격), 승인/거절(사유)
- 예약·입주자 관리: 확정 예약 목록(방별·기간별), 취소(환불 미리보기), 퇴실 완료·보증금 반환 표시, 결제·환불 내역

## 13. 이메일 알림 [결정]
게스트: 신청 접수, 승인+결제 링크(마감 시각 명시), 결제 마감 임박(만료 3시간 전) [제안], 결제 완료/확정, 거절, 신청 만료, 결제 만료, 취소·환불 완료.
운영자: 새 신청, 결제 완료, 취소, 만료 후 결제 자동 환불 발생.
언어는 게스트 `locale` 기준.

## 14. 보안·운영
- 모든 쓰기·금액 계산은 서버. 클라이언트가 보낸 금액·상태는 신뢰하지 않음.
- PortOne 웹훅 서명 검증, 결제 검증 함수 멱등.
- 관리자 라우트는 서버에서 role 확인.
- Supabase 백업: Pro 플랜 일일 백업 [제안].
- Vercel: 상업용 서비스이고 5분 간격 Cron이 필요하므로 **Pro 플랜** 필요 (Hobby는 비상업용·Cron 하루 1회). 월 고정비 = Vercel Pro + Supabase Pro + 도메인 + Google Maps 사용량.
- 환경 분리: `preview`(PortOne 테스트 모드) / `production` [제안].
- 개인정보: 수집 최소화(이름·국적·성별·연락처·메시지), 처리방침에 명시.

## 15. 결과물
- 소스코드 일체 (Git 저장소)
- DB 설계 문서 (스키마·상태 전이·제약; 본 문서 6~9장을 기반으로 마이그레이션과 함께 유지)
- 운영 도메인에 배포된 서비스 + 배포·운영 메모(환경변수, Cron, 웹훅 URL, 백업)

## 16. 빌더에게 맡기는 것
- 디렉터리 구조, 컴포넌트·스타일 라이브러리 선택(예: Tailwind + shadcn/ui), 디자인 디테일
- 지도-목록 동기화 방식, 페이지네이션
- 이메일 템플릿 문구
- 테스트 범위 세부 (단, 8·9장 가격·환불 규칙과 7장 상태 전이·이중 예약 방지는 반드시 자동 테스트)
