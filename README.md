# BASAK WITCH 부스 주문 웹앱

여울제 2026 할로윈 부스 **BASAK WITCH**의 고객·관리자 주문 웹앱입니다.
Supabase에 연결된 정적 웹앱으로, GitHub Pages에 배포합니다.

## 디자인

부스 메뉴판(`IMG_2675.jpeg`)에서 팔레트를 그대로 가져왔습니다.

| 역할 | 값 |
| --- | --- |
| 배경 (밤) | `#110E0C` · `#1A1512` · `#221B17` |
| 펌킨 오렌지 (주요 액션) | `#F2911E` |
| 슬라임 그린 (수령 가능·실시간) | `#7CC244` |
| 파치먼트 크림 (메뉴 카드) | `#FBF3DA` |
| 우드 (브랜드 간판) | `#8A5A2F` |

- 본문 Pretendard, 제목 도현체(Do Hyeon), 간판·주문번호 Creepster
- 메뉴 사진이 없으면 카드에 4:3 빈 자리를 남겨 둡니다 (`.menu-photo-slot`)
- 고객 화면은 나무 간판 로고 + 흘러내리는 슬라임 구분선 + 양피지 메뉴 카드
- 관리자 주방 화면은 상태별 색으로 구분합니다.
  입금 대기 `bone` / 접수 `potion` / 조리 중 `pumpkin` / 수령 가능 `slime` / 취소 `blood`
- 파비콘은 `assets/generate-favicon.py`로 생성합니다 (외부 라이브러리 없이 PNG 직접 출력).

## 메뉴

| 메뉴 | 분류 |
| --- | --- |
| 크림브륄레 튀김산도 | 튀김산도 |
| 초코 튀김산도 | 튀김산도 |
| 말차 튀김산도 | 튀김산도 |
| 청귤차 | 음료 |
| 청귤에이드 | 음료 |
| 아이스 아메리카노 | 음료 |

가격은 미정이라 `price = 0`, `active = false`로 넣어 두었습니다.
관리자 화면에서 가격을 입력하고 `판매 시작`을 눌러야 손님 메뉴에 나타납니다.
메뉴 사진도 아직 등록 전이라 `assets/menu-placeholder.svg`가 대신 표시됩니다.

## 화면

- 고객: `/index.html`
  - 판매 중인 사진 메뉴 조회와 4단계 주문 흐름
  - 주문 생성 RPC와 기기별 주문 복구
  - 토스·카카오페이 앱 바로 보내기 또는 계좌번호 복사 후 송금
  - 내 주문과 전체 공개 대기열 Realtime 확인
- 관리자: `/admin/index.html`
  - `ipad93920@gmail.com` 비밀번호 또는 매직링크 로그인
  - 지금 만들어야 할 메뉴 합계, 1·2일차 및 전체 매출
  - 주문 상태 변경·취소·복구, 조리 중 항목별 체크
  - 메뉴 가격·남은 수량 저장, 판매 시작·중지, 품절 관리

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
- 남은 수량은 서버 RPC에서 메뉴 행을 잠그고 검사·차감합니다.
- 내 주문은 기기에 저장한 추측 불가능한 공개 토큰으로 복구합니다.
- 입금자명과 연락처는 관리자에게만 보이며 전체 대기열에는 주문번호와 상태만 공개합니다.
- 관리자 데이터 변경은 Auth 로그인과 `booth_admins` 권한을 모두 요구합니다.
- 로그아웃하면 관리자 화면 DOM에 남은 주문 상세도 즉시 제거합니다.

## 남은 준비

- `supabase/migrations/20260923150000_basak_witch_menu.sql`을 원격에 적용해야 새 메뉴가 반영됩니다.
- 관리자 화면에서 메뉴 6종의 가격을 입력하고 판매를 시작해야 합니다.
- 실제 메뉴 사진을 등록해야 합니다.
- GitHub Pages 배포 후 해당 `/admin/` 주소를 Supabase Auth Redirect URL에 추가해야 합니다.

자세한 스키마·마이그레이션 상태는 `supabase/README.md`에 있습니다.
