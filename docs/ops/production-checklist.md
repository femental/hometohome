# 운영 오픈 체크리스트

자세한 방법은 [deploy-runbook.md](deploy-runbook.md)의 해당 장을 보세요.

## 계정 (1장)
- [ ] Vercel Pro, 리전 icn1
- [ ] Supabase Pro, 리전 Seoul, PITR 백업
- [ ] PortOne 상점 + 카드·PayPal 실연동 채널
- [ ] Resend 도메인 인증 완료 (SPF·DKIM)
- [ ] Google Maps 키 (HTTP 리퍼러 `https://<도메인>/*` 제한)
- [ ] Kakao REST 키
- [ ] (선택) Sentry 프로젝트

## Supabase (2장)
- [ ] Site URL = `https://<도메인>`
- [ ] Redirect URLs = `https://<도메인>/auth/**` 하나만
- [ ] Magic Link 템플릿 = `supabase/templates/magic_link.html`
- [ ] Custom SMTP = Resend
- [ ] `npm run setup:storage` 실행 → `photos` 공개 버킷 존재
- [ ] `npm run db:deploy -- --yes` 성공 (3장)

## Vercel (4장)
- [ ] 환경 변수 표의 필수 값 모두 입력 (`PORTONE_FAKE` 없음)
- [ ] `CRON_SECRET` 32자 이상 랜덤
- [ ] Cron 2개(frequent, daily) 등록 확인
- [ ] 도메인 연결, HTTPS 정상

## PortOne (5장)
- [ ] 웹훅 URL `https://<도메인>/api/webhooks/portone` + Secret
- [ ] API Secret, 채널 키 입력

## 오픈 전 확인 (6장)
- [ ] 운영자 매직 링크 로그인 → /admin 진입
- [ ] 숙소·방 등록, 사진 업로드, 공개
- [ ] 게스트: 검색·지도·방 상세·가격 미리보기 (영어·한국어)
- [ ] 실제 카드 결제 → 확정 메일 → 취소 → 환불 완료 (PortOne 콘솔 대조)
- [ ] 실제 PayPal 결제 1건
- [ ] 결제 기한 알림 메일, 만료 처리 (Cron 로그)
- [ ] 약관·개인정보처리방침·환불정책 법률 검토본으로 교체
- [ ] 푸터 사업자 정보, 계좌 이체 안내 표시
- [ ] 없는 주소 → 404 화면, 운영자 아닌 계정으로 /admin → 접근 거부

## 운영 중
- [ ] 배포 전 GitHub Actions CI 통과
- [ ] 새 마이그레이션은 Vercel 배포 전에 적용
- [ ] 환불 실패·결제 문제 메일 / Sentry 알림 수신자 확인
