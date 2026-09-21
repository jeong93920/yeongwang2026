# 부스 주문 웹앱

Supabase에 연결된 정적 고객·관리자 주문 웹앱입니다.

## 화면

- 고객: `/index.html`
  - 판매 중인 사진 메뉴 조회
  - 주문 생성 RPC와 기기별 주문 복구
  - 카카오페이·토스 앱 바로 보내기 또는 계좌번호 복사 후 송금
  - 내 주문과 전체 공개 대기열 Realtime 확인
- 관리자: `/admin/index.html`
  - `ipad93920@gmail.com` 매직링크 로그인
  - 입금 확인 완료 주문 기준 현재 매출 합계
  - 주문 상태 변경·취소·복구
  - 메뉴 가격 저장, 판매 시작·중지, 품절 관리

## 로컬 실행

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory /Users/jeong/여울제/yeoul2026
```

- 고객 화면: http://127.0.0.1:4173/
- 관리자 화면: http://127.0.0.1:4173/admin/

## Supabase 연결

페이지는 다음 순서로 고정 버전 Supabase JS와 앱 코드를 불러옵니다.

1. `@supabase/supabase-js@2.49.4`
2. `assets/supabase-config.js`
3. `assets/supabase-store.js`
4. 고객 또는 관리자 실행 스크립트

`assets/mock-store.js`, `assets/customer.js`, `assets/admin.js`는 이전 데모 구현으로 남아 있으며 현재 HTML에서는 로드하지 않습니다.

## 보안 경계

- 브라우저에는 publishable key만 사용하며 Service Role 키는 넣지 않습니다.
- 고객은 민감한 `booth_orders`를 직접 읽지 않습니다.
- 주문 생성은 서버 RPC에서 실제 메뉴 가격으로 계산합니다.
- 내 주문은 기기에 저장한 추측 불가능한 공개 토큰으로 복구합니다.
- 입금자명과 연락처는 관리자에게만 보이며 전체 대기열에는 주문번호와 상태만 공개합니다.
- 관리자 데이터 변경은 Auth 로그인과 `booth_admins` 권한을 모두 요구합니다.
- 로그아웃하면 관리자 화면 DOM에 남은 주문 상세도 즉시 제거합니다.

## 현재 운영 준비 상태

- 메뉴 가격과 판매 상태는 관리자 화면에서 관리합니다.
- 관리자 화면에서 가격을 입력하고 `판매 시작`을 누르면 고객 메뉴에 표시됩니다.
- 가격 0원 메뉴 활성화와 영업 종료 중 주문은 데이터베이스에서도 차단합니다.
- 실제 메뉴 사진은 아직 등록해야 합니다.
- GitHub Pages 배포 후 해당 `/admin/` 주소를 Supabase Auth Redirect URL에 추가해야 합니다.

자세한 스키마·마이그레이션 상태는 `supabase/README.md`에 있습니다.
