# 4단계 후속 작업 메모 (2026-11-24)

4단계(PortOne 카드·PayPal 결제)에서 처리하지 않고 넘기는 항목입니다. 3단계 메모(`2026-11-24-phase3-followups.md`)의 5단계 항목도 그대로 유효합니다.

## 실제 PortOne 키로 확인할 것 (대표님 키 준비 후)

- 해외카드 테스트 채널로 카드 결제 → 확정 → 게스트 취소 → PG 환불까지 실제로 확인한다(지금은 가짜 PG로만 확인).
- PayPal 샌드박스 채널: `loadPaymentUI`(PAYPAL_SPB) 버튼이 `.portone-ui-container[data-portone-ui-type="paypal-spb"]`에 그려지는지, 승인 후 확정되는지 확인한다.
- 모바일 결제 후 리다이렉트(`/{locale}/bookings/{id}/pay/complete`)에서 PortOne이 붙이는 쿼리(`paymentId`, `code`, `message`)가 문제없는지 확인한다.
- 웹훅: PortOne 콘솔에 `https://<도메인>/api/webhooks/portone`과 웹훅 Secret을 등록하고 `Transaction.Paid`가 확정을 만드는지 확인한다.

## 5단계

- 취소 상태가 `REQUESTED`(비동기 취소)인 PG가 있으면 지금은 `done`으로 기록된다. 웹훅(`Transaction.Cancelled`)이나 조회로 최종 상태를 재확인한다.
- PG에서는 PAID인데 예약 쪽에서 확정을 거절하는 드문 경우(금액 불일치 등) 웹훅이 500을 반복한다. 운영자 알림과 자동 취소를 붙인다.
- 금액 불일치(`amount_mismatch`)는 지금 로그만 남긴다. Sentry/운영자 알림을 붙인다.
- 결제 버튼을 누를 때마다 `pending` 결제 행이 생긴다. 오래된 pending 행 정리 작업을 만든다.
- 운영자 결제 내역에 PG 거래 ID를 표시한다.
- `npx prisma migrate deploy`는 `DATABASE_URL`을 명시하지 않으면 테스트 DB에 적용된다. 운영·개발 DB 배포 절차에 `DATABASE_URL`을 명시한다.

## 범위 밖 (결정만 기록)

- PortOne 콘솔에서 운영자가 직접 결제를 취소한 경우 앱의 예약은 그대로 확정 상태로 남는다. 콘솔 대신 앱의 관리자 화면에서 취소하도록 운영 원칙을 정한다.
