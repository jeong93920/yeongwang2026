---
name: sales-report
description: BASAK WITCH 부스 주문 관리 시스템의 실제 Supabase DB에서 일차별·메뉴별 판매 개수와 매출을 집계해 표로 정리하는 절차. "오늘 몇 개 팔렸어", "메뉴별 판매 개수", "1일차 2일차 매출", "총합 정리" 같은 요청에 사용한다. 읽기 전용이다.
---

# sales-report — 일차별·메뉴별 판매 집계

장사 중간이나 끝난 뒤 "무엇이 몇 개 팔렸고 얼마 벌었는지"를 정리할 때 쓴다. DB를 읽기만 한다.

준비: 저장소 루트에서 실행하고, Supabase CLI가 이 프로젝트에 연결되어 있어야 한다.

```bash
Q=".claude/skills/sales-report/sql"
npx -y supabase@latest db query --linked --read-only -f $Q/sales-by-day.sql 2>/dev/null
npx -y supabase@latest db query --linked --read-only -f $Q/excluded.sql 2>/dev/null
```

## 집계 규칙 (관리자 화면 매출과 같은 기준)
- **매출에 넣는 주문**: 입금 확인 이후 상태(`confirmed`, `cooking`, `ready`, `picked_up`)만. `payment_pending`(입금 대기)과 `cancelled`(취소)는 `excluded.sql`로 따로 보여 준다.
- **일차**: 주문 시각을 **한국 시간** 날짜로 바꿔 나눈다. 연광제는 10/28 = 1일차, 10/29 = 2일차.
- **세트**: `말차 튀김산도 (세트)`처럼 저장된 세트 줄은 `(세트)`를 떼고 단품과 합쳐 센다. 세트로 팔린 개수는 `in_set` 열에 따로 나온다.
- **대체 메뉴**: 청귤차는 청귤에이드와 합치지 않고 따로 센다.
- **금액**: 메뉴별 금액은 `수량 × 저장된 가격`이고, 세트 음료는 할인이 반영된 가격이다. 일차 합계는 주문의 `total_amount` 합이다. 둘의 합이 같은지 확인한다.

## 결과 정리
1. 결과의 `rows` JSON에서 `kind = 'item'` 줄을 일차별로 모아 표로 만든다.

   | 메뉴 | 1일차 | 2일차 | 합계 |
   | --- | --- | --- | --- |
   | 크림브륄레 튀김산도 | ○개 · ○원 | … | … |

2. 마지막에 일차별 주문 건수(`kind = 'total'`)와 매출, 전체 합계를 쓴다.
3. 취소·입금 대기 건수와 금액은 "매출에서 뺀 주문"으로 한 줄 덧붙인다.
4. 관리자 화면의 1·2일차 매출과 숫자가 다르면, 날짜를 한국 시간으로 바꿨는지와 상태 조건을 먼저 확인한다.

## 주의
- 항상 `--read-only`로 실행한다. 집계는 DB를 바꿀 일이 없고, 이 옵션이 없으면 CLI가 실제 DB 쿼리 확인을 요구한다.
- 결과에 손님 이름·연락처는 나오지 않는다. 다른 쿼리를 덧붙일 때도 `payer_name`, `contact`는 출력하지 않는다.
- `npx -y supabase@latest`는 실행할 때마다 CLI를 내려받아 느리다. 자주 볼 때는 CLI를 설치해 두고 `supabase db query --linked`로 쓴다.
