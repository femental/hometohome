# hometohome 운영 배포 절차서

처음 운영 환경을 만들 때와, 이후 배포·장애 때 따라 하는 순서입니다. 체크 표시용 요약은 [production-checklist.md](production-checklist.md)에 있습니다.

> 표기: `<도메인>`은 실제 서비스 도메인(예: `hometohome.kr`), `<프로젝트ref>`는 Supabase 프로젝트 ID입니다.

> ⚠️ **운영 키는 그 명령 한 번에만.** 아래 명령들은 `powershell -Command { … }` 안에서 실행해 운영 URL·키가 지금 터미널에 남지 않게 합니다.
> `$env:…=`로 터미널에 직접 넣으면 같은 창에서 이어서 `npm run dev`, `npm run e2e`, `npx prisma migrate dev`를 실행할 때 **운영 DB·저장소를 건드립니다**.
> 실수로 넣었다면 그 창을 닫거나 `Remove-Item Env:DIRECT_URL, Env:DATABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY, Env:NEXT_PUBLIC_SUPABASE_URL`.

---

## 1. 필요한 계정·서비스

| 서비스 | 요금제 / 설정 | 용도 |
|---|---|---|
| Vercel | Pro (상업용은 Pro 필요), 리전 `icn1`(서울) | 앱 호스팅, Cron |
| Supabase | Pro, 리전 Seoul (`ap-northeast-2`) | DB, 로그인(Auth), 사진 저장소 |
| PortOne V2 | 상점 + 채널 2개(카드 PG, PayPal) | 결제·환불, 웹훅 |
| Resend | 발신 도메인 인증(SPF·DKIM) | 앱 메일 + Supabase 로그인 메일(SMTP) |
| Google Cloud | Maps JavaScript API 키 (HTTP 리퍼러 제한) | 검색 지도 |
| Kakao Developers | REST API 키 | 운영자 주소 검색(좌표 변환) |
| Sentry (선택) | Next.js 프로젝트 | 오류 감시 |
| 도메인 DNS | Vercel 연결 + Resend 레코드 | |

---

## 2. Supabase 운영 프로젝트

1. **프로젝트 생성**: 리전 Seoul. DB 비밀번호는 비밀번호 관리자에 보관.
2. **연결 문자열** (Project Settings → Database → Connect):
   - `DATABASE_URL` = **Transaction pooler** (포트 6543). 앱이 사용.
   - `DIRECT_URL` = **Direct connection** 또는 Session pooler (포트 5432). 마이그레이션 전용.
3. **Auth → URL Configuration**
   - Site URL: `https://<도메인>`
   - Redirect URLs: `https://<도메인>/auth/**` **하나만**. (와일드카드 도메인·localhost는 넣지 않습니다.)
4. **Auth → Email Templates → Magic Link**
   - 제목: `Your hometohome sign-in link / 로그인 링크`
   - 본문: 저장소의 `supabase/templates/magic_link.html` 내용을 그대로 붙여넣기.
     (링크가 `/auth/confirm?token_hash=…`로 가야 다른 기기에서 열어도 로그인됩니다.)
5. **Auth → SMTP Settings**: Custom SMTP 켜기 → Resend SMTP (`smtp.resend.com`, 포트 465, 사용자 `resend`, 비밀번호 = Resend API 키), 발신 주소는 `EMAIL_FROM`과 같은 도메인.
   기본 SMTP는 시간당 몇 통으로 제한되어 운영에 쓸 수 없습니다.
6. **Auth → Providers → Google**(선택): Google OAuth 클라이언트 등록, 승인된 리디렉션 URI는 Supabase가 보여주는 콜백 주소.
7. **사진 버킷 생성** (한 번만, 로컬 PC에서):

   ```powershell
   powershell -Command { $env:NEXT_PUBLIC_SUPABASE_URL="https://<프로젝트ref>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<service_role 키>"; npm run setup:storage }
   ```

   공개 버킷 `photos`(10MB, JPG/PNG/WEBP만)가 만들어집니다. 다시 실행해도 안전합니다.
8. **백업**: Database → Backups에서 PITR(시점 복구) 애드온 켜기 권장.

---

## 3. DB 마이그레이션

운영 DB에는 **포트 5432 연결**(Session pooler 또는 Direct)로만 적용합니다. `.env` 파일은 읽지 않으므로 명령에서 명시합니다.
Supabase 대시보드 Connect → **Session pooler** 문자열을 쓰면 됩니다(Direct 주소 `db.<ref>.supabase.co`는 IPv6 전용이라 집·사무실 망에서 안 될 수 있음).

```powershell
powershell -Command { $env:DIRECT_URL="postgresql://postgres.<프로젝트ref>:<비밀번호>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"; npm run db:deploy -- --yes }
```

- 테스트 DB(`localhost:54329`, 이름이 `_test`로 끝남)는 거부됩니다.
- 트랜잭션 풀러(포트 6543)는 거부됩니다.
- 원격 DB는 `--yes` 없이 거부됩니다.
- 새 마이그레이션이 있는 버전은 **`main`에 병합하기 전에** 실행합니다(병합하면 Vercel이 바로 배포함). 마이그레이션은 추가 위주라 구버전 앱과 함께 동작합니다.

---

## 4. Vercel

1. GitHub 저장소 import → Framework: Next.js. **Settings → Functions → Region: `icn1` (Seoul)** (`vercel.json`에도 지정됨).
2. 환경 변수 (Production에 입력, Preview는 별도 Supabase/테스트 키 권장):

| 이름 | 용도 | 공개 | 예시 형식 |
|---|---|---|---|
| `DATABASE_URL` | 앱 DB (트랜잭션 풀러) | 비공개 | `postgresql://postgres.<ref>:<pw>@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres` |
| `DIRECT_URL` | 마이그레이션용 (앱은 안 씀, 기록용) | 비공개 | `…:5432/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API | 공개 | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키 | 공개 | `eyJ…` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 관리 키 | **비공개** | `eyJ…` |
| `APP_URL` | 메일 링크 기준 주소 | 비공개 | `https://<도메인>` |
| `ADMIN_EMAILS` | 운영자 이메일(쉼표 구분) | 비공개 | `boss@<도메인>` |
| `EMAIL_FROM` | 발신자 | 비공개 | `hometohome <no-reply@<도메인>>` |
| `RESEND_API_KEY` | 메일 발송 (운영 필수) | 비공개 | `re_…` |
| `KAKAO_REST_API_KEY` | 주소 검색 | 비공개 | |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 지도 (리퍼러 제한 필수) | 공개 | `AIza…` |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | 가격 마커(선택) | 공개 | |
| `NEXT_PUBLIC_USD_KRW_REFERENCE` | 달러 참고가 환율 | 공개 | `1380` |
| `FX_USD_KRW_FALLBACK` | 환율 API 장애 시 PayPal 환율 | 비공개 | `1380` |
| `NEXT_PUBLIC_PHOTO_BUCKET` | 사진 버킷 | 공개 | `photos` |
| `NEXT_PUBLIC_PORTONE_STORE_ID` | PortOne 상점 ID | 공개 | `store-…` |
| `NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD` | 카드 채널 키 | 공개 | `channel-key-…` |
| `NEXT_PUBLIC_PORTONE_CHANNEL_KEY_PAYPAL` | PayPal 채널 키 | 공개 | `channel-key-…` |
| `PORTONE_API_SECRET` | PortOne V2 API Secret | **비공개** | |
| `PORTONE_WEBHOOK_SECRET` | 웹훅 서명 검증 | **비공개** | `whsec_…` |
| `CRON_SECRET` | Cron 호출 인증 (긴 랜덤 값) | **비공개** | 32자 이상 |
| `BUSINESS_*`, `MAIL_ORDER_NO` | 푸터 사업자 정보 | 비공개 | |
| `BANK_TRANSFER_INFO_EN` / `_KO` | 계좌 이체 안내 | 비공개 | 여러 줄 |
| `NEXT_PUBLIC_SENTRY_DSN` | 오류 감시(선택) | 공개 | `https://…@…ingest.sentry.io/…` |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | 소스맵 업로드(선택) | 비공개 | |

   - `PORTONE_FAKE`는 **넣지 않습니다** (운영에서는 무시되지만 혼동 방지).
   - `NEXT_PUBLIC_*` 값은 빌드에 박히므로 바꾼 뒤에는 **재배포**가 필요합니다. Supabase URL·anon 키가 없으면 빌드가 실패합니다.
3. **Cron**: 배포 후 Settings → Cron Jobs에서 두 개 확인
   - `/api/cron/frequent` 5분마다 (요청·결제 마감 처리, 결제 알림)
   - `/api/cron/daily` 매일 03:00 KST (오래된 결제 정리, 환불 대조, 고아 사진·요청 제한 기록 삭제)
4. **도메인** 연결 후 `APP_URL`과 Supabase Site URL이 같은 주소인지 확인.

---

## 5. PortOne 콘솔

1. 결제 연동 → 채널: 카드(국내 PG) 채널, PayPal 채널 각각 **실연동** 채널 키를 Vercel 변수에 입력.
2. 결제 연동 → 웹훅: URL `https://<도메인>/api/webhooks/portone`, 버전 V2, 발급된 Secret을 `PORTONE_WEBHOOK_SECRET`에.
3. V2 API Secret 발급 → `PORTONE_API_SECRET`.
4. 테스트 모드 채널로 먼저 한 번 검증한 뒤 실연동 채널 키로 바꿉니다.

---

## 6. 최초 배포 순서

1. Supabase 프로젝트 준비 (2장) → 사진 버킷 생성.
2. `npm run db:deploy -- --yes` (3장).
3. Vercel 환경 변수 입력 → 배포 (4장).
4. **운영자 로그인 확인**: `https://<도메인>/admin` → `ADMIN_EMAILS`의 메일로 매직 링크 → 관리자 화면이 열리는지.
5. 숙소·방 등록 → 사진 업로드 → 공개 전환 → 게스트 화면에서 검색·지도·가격 표시 확인.
6. **실제 결제 1건**: 다른 이메일로 게스트 신청 → 승인 → 소액 방(테스트용 월세)으로 카드 결제 → 확정 메일 → 취소 → 환불 완료 메일과 PortOne 콘솔의 취소 내역 확인. PayPal도 1건.
7. 약관·개인정보처리방침·환불정책을 **법률 검토가 끝난 문안**으로 교체.
8. 사업자 정보·계좌 안내가 푸터·결제 화면에 맞게 나오는지 확인.

---

## 7. 이후 배포

1. PR의 GitHub Actions CI 통과 확인.
2. 새 마이그레이션이 있으면 **병합 전에** `npm run db:deploy -- --yes` (3장).
3. `main`에 병합 → Vercel이 자동 배포. 문제 시 Vercel → Deployments에서 이전 배포로 **Instant Rollback**.

---

## 8. 장애 대응

### 환불 실패
- 증상: 운영자 메일 "결제 문제" / 예약 상세의 환불 상태 "실패".
- 조치: 예약 상세 → 환불 목록 → **환불 재시도**. 같은 금액이 두 번 나가지 않도록 시스템이 PG의 취소 가능 금액을 확인합니다.
- PortOne 쪽에서 계속 거절되면 콘솔에서 원인 확인 후 직접 취소한 다음, 앱에서 **환불 재시도**를 한 번 더 누릅니다. PG에 이미 취소된 금액을 확인하고 "완료"로 기록합니다(이중 환불 없음).
- PG가 비동기로 처리 중인 환불이 24시간 넘게 끝나지 않으면 매일 작업이 오류 감시(Sentry 또는 로그 `[problem]`)에 알립니다. PortOne 콘솔에서 상태를 확인하세요.
- 무통장(직접 송금) 환불은 송금 후 **환불 완료 표시**.

### 결제는 됐는데 예약이 확정되지 않음
- PortOne 콘솔 → 웹훅 → 해당 결제의 웹훅 **재전송**. 앱은 같은 결제를 여러 번 받아도 한 번만 처리합니다.
- 그래도 안 되면 매일 정리 작업이 24시간 넘은 결제를 PG 상태 기준으로 마무리합니다.
- 예약이 이미 만료·취소된 뒤 결제된 경우 시스템이 자동으로 PG 취소 + 운영자 메일을 보냅니다.

### 로그인 메일이 오지 않음
- Supabase → Auth → Logs, Resend → Logs 확인. SMTP 비밀번호(=Resend 키) 만료 여부.
- 같은 이메일로 1시간 5회 초과 요청은 앱이 막습니다("잠시 후 다시 시도").

### Cron이 돌지 않음
- Vercel → Cron Jobs → 실행 기록. 401이면 `CRON_SECRET` 불일치. 수동 실행:

  ```powershell
  curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://<도메인>/api/cron/frequent
  ```

### 데이터 복구
- Supabase → Database → Backups → PITR로 특정 시점 복구(새 프로젝트로 복원 후 확인하고 전환 권장).
- 복구 후 `DATABASE_URL`/`DIRECT_URL`을 새 프로젝트로 바꾸고 재배포, PortOne 결제 내역과 대조.

### 오류 감시
- Sentry를 켰다면 결제 문제(금액 불일치, 환불 실패, 웹훅 오류)가 이벤트로 들어옵니다. 개인정보 없이 예약·결제 ID만 기록됩니다.
- 끄면 같은 내용이 Vercel 함수 로그에 `[problem]`으로 남습니다.
