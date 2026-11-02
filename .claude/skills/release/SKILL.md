---
name: release
description: BASAK WITCH 부스 주문 관리 시스템에서 DB(Supabase)와 화면(GitHub Pages)을 함께 바꾸는 변경을 배포하는 절차. 메뉴·가격·계좌·세트 할인 변경, 새 DB 함수(RPC) 추가처럼 마이그레이션이 필요한 작업에 쓴다. "배포해줘", "메뉴 바꿔서 올려줘", "DB 바꾸고 배포" 같은 요청에 사용한다.
---

# release — DB 먼저, 화면은 나중에 배포하기

화면 코드는 새 DB 컬럼·함수를 바로 읽기 때문에, **DB를 먼저 바꾸고 확인한 뒤에 화면을 배포**해야 한다.
순서가 거꾸로면 실제 사이트에서 메뉴가 안 뜨거나 주문이 실패한다.

## 1. Supabase 상태 확인
```bash
npx -y supabase@latest projects list 2>&1 | grep -o '"status":"[A-Z_]*"'
```
- `INACTIVE`(일시정지)면 CLI로는 풀 수 없다. 사용자에게 대시보드에서 **Restore project**를 눌러 달라고 하고, `ACTIVE_HEALTHY`가 될 때까지 화면은 커밋만 하고 push하지 않는다.

## 2. 마이그레이션 작성
- `supabase/migrations/YYYYMMDDHHMMSS_설명.sql` — 마지막 파일보다 큰 타임스탬프로 만든다.
- **파일을 만드는 것만으로는 DB가 바뀌지 않는다.** 반드시 4단계까지 진행한다.
- 메뉴를 판매 상태로 올릴 때는 가격이 0보다 커야 한다(`not active or price > 0`). 가격 0원 메뉴는 손님 화면에 나오지 않는다.

## 3. 주문 함수를 바꿨다면 실제 DB에서 미리 시험
```bash
{ echo "begin;"; cat supabase/migrations/<이번 파일>.sql; cat test.sql; echo "rollback;"; } > /tmp/try.sql
npx -y supabase@latest db query --linked --yes -f /tmp/try.sql   # 사용자에게 시험 실행을 알린 뒤
```
- `test.sql`에는 `select * from public.booth_create_order(...)`처럼 함수를 불러 금액을 확인하는 쿼리를 넣는다. `rollback`으로 끝나므로 주문은 남지 않는다.
- 시험 뒤에는 주문번호가 소모되므로, 장사 전이라면 `reset-orders` 스킬의 `reseq.sql`로 1번으로 되돌린다.

## 4. 적용
```bash
npx -y supabase@latest db push --linked --dry-run 2>&1 | tail -8   # 이번 파일만 적용 대상인지 확인
yes | npx -y supabase@latest db push --linked 2>&1 | tail -6       # "Finished supabase db push" 확인
```
적용 뒤 바뀐 값을 `--read-only` 쿼리로 확인한다(예: `select name, price, active from booth_menu_items order by sort_order;`).

## 5. 화면 캐시 버전 올리기
바뀐 JS·CSS를 불러오는 `?v=` 값을 새 날짜시각으로 바꾼다. 올리지 않으면 손님 폰이 예전 파일을 계속 쓴다.
```bash
grep -n '?v=' index.html admin/index.html
```
`boot.js`의 `data-store`·`data-demo`·`data-page` 속성 안의 `?v=`도 함께 바꾼다. 데모 모드도 같은 화면 코드를 쓰므로 `npm test`로 흐름이 깨지지 않았는지 확인한다.

## 6. 배포와 확인
```bash
git add <바꾼 파일> && git commit && git push origin main
gh run watch $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --exit-status
curl -s "https://jeong93920.github.io/yeongwang2026/?x=$RANDOM" | grep -c '<새 ?v 값>'
```
- `0`이 나오면 Pages 반영이 늦은 것이니 잠시 뒤 다시 확인한다.
- 마지막으로 폰으로 고객 화면을 열어 메뉴와 가격이 바뀌었는지 사용자에게 확인을 부탁한다.

## 주의
- 실제 주소(`?demo` 없음)에서는 테스트 주문을 넣지 않는다. 화면 확인은 데모 모드로 한다.
- Service Role 키는 화면 코드에 넣지 않는다. 브라우저에는 publishable key만 둔다.
