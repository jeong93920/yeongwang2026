# Supabase 연결 준비

대상 프로젝트: `rvamsrgvfubsvlttuaqt` (`Seoul`, ipad93920@gmail.com 계정의 독립 프로젝트)

이 프로젝트는 원래 예제였던 `vedraqrdkwyyipztxddw`와 완전히 분리된 새 Supabase 프로젝트입니다. 스키마(24개 마이그레이션 중 일반 스키마 마이그레이션)는 이미 적용 완료했습니다. 단, 원래 행사의 실데이터(관리자 이메일 등록, 주문 169번 수정, 수동주문 203/204)에 해당하는 5개 마이그레이션은 이 프로젝트에는 적용하지 않고 `migration repair --status applied`로 건너뛰도록 표시해두었습니다 — 파일은 히스토리 보존을 위해 저장소에 그대로 남아 있습니다.

## 안전 원칙

- 기존 앱의 테이블, 함수, 정책은 수정하지 않습니다.
- 새 데이터베이스 객체는 모두 `booth_` 접두사를 사용합니다.
- 메뉴 사진은 `booth-menu-images` 버킷에만 저장합니다.
- Service Role 키는 브라우저 코드에 넣지 않습니다.
- 고객에게는 `booth_public_queue`의 주문번호와 상태만 공개합니다.

## 1. 프로젝트 연결

데이터베이스 비밀번호는 채팅이나 파일에 저장하지 말고 아래 명령의 보안 프롬프트에 직접 입력합니다.

```bash
cd /Users/jeong/여울제/yeoul2026
npx supabase link --project-ref rvamsrgvfubsvlttuaqt
```

## 2. 적용 전 확인

```bash
supabase db push --dry-run
```

출력에는 아직 원격에 적용되지 않은 신규 마이그레이션만 보여야 합니다.

이 프로젝트에는 스키마 마이그레이션 전부가 적용 완료 상태입니다. 아래 5개는 원래 행사의 실데이터/관리자 이메일에 묶여 있어 실제로는 실행하지 않고 `migration repair --status applied`로 완료 처리만 해두었습니다(파일은 히스토리 보존용으로 남아 있음):

- `20260829111000_booth_admin.sql`
- `20260829111500_booth_admin_switch.sql`
- `20260829115000_booth_admin_reconcile.sql`
- `20260917040650_fix_order_169_items.sql`
- `20260917053059_add_manual_orders_203_204.sql`

## 3. 마이그레이션 적용

```bash
supabase db push
```

## 4. 관리자 등록

먼저 Supabase Authentication에서 관리자 계정을 만든 뒤 SQL Editor에서 다음 SQL을 실행합니다.

```sql
insert into public.booth_admins (user_id)
select id from auth.users where email = '관리자 이메일';
```

## 5. 프런트엔드 연결

현재 고객·관리자 페이지는 `assets/supabase-store.js`를 사용합니다.

- 메뉴: `booth_menu_items`
- 주문 생성: `booth_create_order` RPC
- 내 주문 복구: `booth_get_order` RPC
- 공개 대기열: `booth_public_queue` + Realtime
- 관리자 주문 변경: `booth_orders`
- 메뉴 가격·판매·품절 변경: `booth_menu_items`
- 메뉴 이미지: `booth-menu-images`

관리자는 고정된 Gmail 계정으로 Auth 매직링크 로그인 후 `booth_is_admin()` 검사를 통과해야 데이터를 조회·변경할 수 있습니다. GitHub Pages 배포 후 `/admin/` 공개 주소를 Supabase Auth Redirect URL에 등록합니다.

## 현재 관리자

- 이메일: `ipad93920@gmail.com`
- 등록 방법: 관리자 화면에서 매직링크로 최초 로그인해 Auth 사용자를 만든 뒤, SQL Editor에서 위 4번 SQL로 `booth_admins`에 등록합니다.

## 현재 메뉴

메뉴·가격·부스명은 아직 확정 전입니다. 관리자 화면에서 메뉴 이름·가격을 입력하고 판매 시작을 눌러야 고객 화면에 표시됩니다.
