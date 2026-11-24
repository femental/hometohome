# 3단계 후속 작업 메모 (2026-11-24)

3단계(게스트 화면, 지도, i18n) 최종 리뷰 후 이후 단계로 넘기는 항목입니다. 2단계 메모(`2026-11-23-phase2-followups.md`) 중 3단계에서 끝나지 않은 항목도 함께 옮겼습니다.

## 4단계

- 취소 시 `expectedKind`를 예약 행 잠금 안에서 비교한다.
- `previewCancellation`을 admin 모듈에서 공용 bookings 모듈로 옮긴다.
- 게스트 신청 메일 발송을 수신자별 try/catch로 분리한다.
- 운영자 환불 완료 시 게스트에게 메일(`refund_completed`)을 보낼지 결정한다.
- `BookingError.detail` 문자열 매칭을 코드/공유 상수로 바꾸고, 금액 불일치 테스트를 추가한다.
- `formatMinor`가 통화별 소수 자릿수를 따르도록 한다.
- (1단계 이월) 취소 시 결제 상태 확인, 40P01 재시도, 실패한 자동 환불의 재시도 설계.

## 5단계

- 운영 Supabase 매직링크 템플릿을 설정하고, `site_url`을 APP_URL로, redirect 허용 목록을 앱 도메인만으로 제한한다.
- 운영 Supabase에서 `{{ .RedirectTo }}` 인코딩이 올바른지 확인한다.
- 빌드 시 `NEXT_PUBLIC_SUPABASE_URL`을 필수로 한다(이미지 `remotePatterns`).
- Google Maps 키(리퍼러 제한)로 실제 지도가 뜨는지 확인한다.
- 사업자 정보는 빌드 시 고정되므로 변경하면 재배포해야 한다.
- 게스트용 `error.tsx`와 `[locale]/not-found.tsx`를 만든다(PPR에서 404가 200으로 나가는 문제 포함).
- `[locale]` 전체의 `instant=false` 설정을 재검토한다.
- quote/매직링크 요청에 rate limit을 건다.
- 사진 업로드를 Supabase signed upload URL 방식으로 바꿔 4MB 제한을 풀 수 있는지 검토한다.
- 숙소/방 삭제나 스토리지 삭제 실패로 남는 고아 파일 정리 작업을 만든다.
- 운영 Supabase 버킷을 미리 생성하고 `bucketEnsured` 로직 의존을 제거한다.
- proxy의 env 검증과 리다이렉트 캐시 헤더를 점검한다.
- Vercel에서 Prisma 커넥션 풀(pgbouncer)을 설정한다.
- `NEXT_PUBLIC_PHOTO_BUCKET`과 `PHOTO_BUCKET`을 하나로 통일한다.

## 제품 결정 필요

- 예약 전에 숙소 상세 주소와 정확한 좌표를 공개할지 결정한다.

## 정리

- 게스트 로그아웃이 global signOut(모든 기기 로그아웃)이다. local로 바꿀지 결정한다.
