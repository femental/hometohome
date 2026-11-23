# 2단계 후속 작업 메모 (2026-11-23)

2단계(인증 + 관리자 화면) 최종 리뷰에서 나온 항목 중 이번 단계에서 처리하지 않고 이후 단계로 넘기는 것들입니다.

## 3단계

- 게스트 매직링크는 PKCE 방식이라 메일을 다른 브라우저(앱 내 브라우저 등)에서 열면 실패한다. `token_hash` + `verifyOtp` 확인 라우트로 전환한다.
- 콜백에서 `toAuthUser`가 null이거나 `syncUser`가 실패하면 `signOut` 후 리다이렉트한다. 콜백 라우트 테스트를 추가한다.
- 게스트 페이지는 매 요청마다 upsert하지 말고 콜백에서 사용자 동기화를 한다.
- `booking_confirmed` 메일에 결제 금액과 환불 규칙을 한 줄로 넣는다.
- 주소를 수정하면 이전 좌표를 초기화한다.
- `listBookings`에 상태 사전 필터와 `take`를 추가한다.
- 결제 링크 `/{locale}/bookings/{id}/pay` 화면을 만든다.

## 4단계

- `BookingError.detail` 문자열 매칭을 코드/공유 상수로 바꾸고, 금액 불일치 테스트를 추가한다.
- 운영자 환불 완료 시 게스트에게 메일(`refund_completed`)을 보낼지 결정한다.
- `formatMinor`가 통화별 소수 자릿수를 따르도록 한다.
- (1단계 이월) 취소 시 결제 상태 확인, 40P01 재시도, 실패한 자동 환불의 재시도 설계.

## 5단계

- 사진 업로드를 Supabase signed upload URL 방식으로 바꿔 4MB 제한을 풀 수 있는지 검토한다.
- 숙소/방 삭제나 스토리지 삭제 실패로 남는 고아 파일 정리 작업을 만든다.
- 운영 Supabase 버킷을 미리 생성하고 `bucketEnsured` 로직 의존을 제거한다.
- proxy의 env 검증과 리다이렉트 캐시 헤더를 점검한다.
- 운영 Supabase의 redirect 허용 목록과 `site_url`을 설정한다.
- Vercel에서 Prisma 커넥션 풀(pgbouncer)을 설정한다.
- `NEXT_PUBLIC_PHOTO_BUCKET`과 `PHOTO_BUCKET`을 하나로 통일한다.
