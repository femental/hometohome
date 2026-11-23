# hometohome

Room-booking MVP for foreigners in Seoul (Next.js 16, Prisma 7, Supabase auth).

## 로컬 실행

1. Docker Desktop 실행
2. `npm install`
3. `npm run db:up` — 테스트용 Postgres(`h2h_test`, 포트 54329)
4. `npm run sb:start` — 로컬 Supabase(Auth/Storage/Postgres). 첫 실행은 이미지 다운로드로 오래 걸림
5. `.env.example`을 `.env.local`로 복사하고 `npx supabase status`의 API URL, anon key, service_role key를 채움.
   개발 DB는 Supabase 로컬 Postgres(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`)
6. 스키마 적용: `npx prisma migrate deploy`
7. `npm run dev` — http://localhost:3000

종료: `npm run sb:stop`

### 로그인 (로컬)

- `/login`에서 이메일 매직링크를 요청하면 메일은 실제로 발송되지 않는다. 로컬 매직링크는 Supabase Studio의 Mailpit(`http://127.0.0.1:54324`)에서 확인한다.
- `ADMIN_EMAILS`에 있는 이메일로 로그인하면 운영자(`admin`), 그 외는 게스트. 목록에서 빼면 다음 로그인 때 게스트로 강등된다.
- Google 로그인은 `supabase/config.toml`에 `[auth.external.google]` 블록(`enabled = true`, `client_id`, `secret = "env(...)"`)을 추가해야 동작한다(로컬 기본값은 비활성).

### 테스트용 신청 만들기 (로컬)

```bash
npx tsx scripts/seed-request.ts
```

게스트 화면 없이 운영자 신청·예약 화면을 확인할 때 쓴다. 시드 게스트(`seed-guest@example.com`)로 1단계 `createRequest`를 그대로 호출해
신청 1건을 만들고 예약 id와 `/admin/bookings/<id>` 주소를 출력한다. 입주일은 오늘(KST) + 14일, 기간 2개월.

- 가장 최근에 등록된 공개 숙소의 공개 방을 쓰고, 없으면 시드 숙소·방을 만든다. 같은 방·기간에 점유 예약이 있으면 실패한다.
- `DATABASE_URL`은 환경변수 또는 `.env.local`에서 읽으며, 호스트가 `localhost`/`127.0.0.1`이 아니면 실행을 거부한다.
- 메일: `RESEND_API_KEY`가 비어 있으면 승인·거절 등 게스트 메일은 실제로 보내지 않고 서버 로그(`[email] to=... subject=...`)에만 찍힌다.
  발송 기록은 예약 상세의 메일 발송 이력에서 볼 수 있다.

## 테스트

```bash
npm test            # unit
npm run test:db     # DB 통합 (db:up 필요)
npm run typecheck
npm run lint
```
