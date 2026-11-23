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

## 테스트

```bash
npm test            # unit
npm run test:db     # DB 통합 (db:up 필요)
npm run typecheck
npm run lint
```
