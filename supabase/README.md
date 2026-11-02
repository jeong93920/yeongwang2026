# Supabase 설정

BASAK WITCH 부스 QR 주문 관리 시스템의 데이터베이스(Supabase) 설정입니다.

## 구조

DB 구조는 마이그레이션 파일 하나에 모두 들어 있습니다.

- [`migrations/20261102120000_booth_schema.sql`](migrations/20261102120000_booth_schema.sql)
  - 테이블 6개: `booth_settings`, `booth_menu_items`, `booth_orders`, `booth_order_items`, `booth_public_queue`, `booth_admins`
  - 주문 함수: `booth_create_order`(손님 주문), `booth_get_order`(내 주문 조회), `booth_admin_create_order`(주방 수동 주문), `booth_is_admin`
  - 트리거: 주문이 생기거나 상태가 바뀌면 공개 대기열 갱신, 영업 중이 아니면 주문 거절, `updated_at` 자동 갱신
  - 행 수준 보안(RLS) 정책과 권한, 메뉴 사진 버킷(`booth-menu-images`), 실시간 대기열(`supabase_realtime`)
  - 기본 데이터: 부스 설정 1행, 메뉴 5개(튀김산도 3종, 음료 2종)

새 기능 때문에 DB를 바꿀 때는 이 파일을 고치지 않고, 더 늦은 시각의 마이그레이션 파일을 새로 추가합니다(`.claude/skills/release` 참고).

## 새 Supabase 프로젝트에 설치

```bash
npx supabase link --project-ref <프로젝트 ref>   # 데이터베이스 비밀번호는 보안 프롬프트에 직접 입력
npx supabase db push --linked --dry-run          # 적용될 파일 확인
npx supabase db push --linked
```

1. Supabase **Authentication**에서 관리자 계정을 만듭니다.
2. 관리자 계정을 `booth_admins`에 등록합니다(SQL Editor).
   ```sql
   insert into public.booth_admins (user_id)
   select id from auth.users where email = '관리자 이메일';
   ```
3. Authentication → URL Configuration에 배포 주소의 `/admin/`을 Redirect URL로 추가합니다.
4. `assets/supabase-config.js`에 프로젝트 URL과 **publishable key**를 넣습니다.

## 보안 원칙

- 브라우저에는 publishable key만 넣고, Service Role 키는 넣지 않습니다.
- 손님은 메뉴·부스 설정·공개 대기열(주문번호와 상태)만 읽을 수 있습니다.
- 주문은 `booth_create_order` 함수로만 만들고, 가격·세트 할인·재고는 함수 안에서 다시 계산합니다.
- 입금자명과 연락처는 관리자만 볼 수 있습니다.
- 관리자 데이터 변경은 Auth 로그인과 `booth_admins` 등록을 모두 요구합니다.

## 화면에서 쓰는 곳

| 화면 기능 | DB |
| --- | --- |
| 메뉴·부스 설정 | `booth_menu_items`, `booth_settings` |
| 주문 생성 | `booth_create_order` |
| 내 주문 복구 | `booth_get_order` |
| 공개 대기열 | `booth_public_queue` + Realtime |
| 주문 상태 변경 | `booth_orders` (관리자) |
| 수동 주문 | `booth_admin_create_order` (관리자) |
| 메뉴 가격·판매·품절·남은 수량, 세트 할인 | `booth_menu_items`, `booth_settings` (관리자) |
| 메뉴 사진 | Storage `booth-menu-images` |

## 운영 작업

- 주문 목록 초기화: `.claude/skills/reset-orders`
- 일차별·메뉴별 판매 집계: `.claude/skills/sales-report`
- DB와 화면을 함께 바꾸는 배포: `.claude/skills/release`
