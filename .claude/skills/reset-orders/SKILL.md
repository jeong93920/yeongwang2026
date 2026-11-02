---
name: reset-orders
description: BASAK WITCH 부스 주문 관리 시스템의 실제 Supabase DB에서 주문 목록을 초기화하는 절차. 주문을 확인하고, 백업하고, 주문·주문 항목·대기열을 지운 뒤 주문번호를 1번부터 다시 시작한다. "주문 목록 초기화", "주문 다 지워줘", "주문번호 1번부터", "테스트 주문 정리" 같은 요청에 사용한다.
---

# reset-orders — 주문 목록 초기화

장사 전 테스트 주문을 정리하거나, 다음 날 장사를 새로 시작할 때 쓴다.
**실제 운영 DB의 데이터를 지우는 작업**이므로 사용자가 직접 요청했을 때만 하고, 지우기 전에 반드시 무엇을 지우는지 보여 준다.

준비: 저장소 루트에서 실행하고, Supabase CLI가 이 프로젝트에 연결(`supabase link`)되어 있어야 한다.
SQL 파일은 이 스킬 폴더의 `sql/`에 있다.

```bash
Q=".claude/skills/reset-orders/sql"
BACKUP_DIR="$HOME/연광제/backups"   # 저장소 밖. 손님 이름·연락처가 들어 있으므로 절대 커밋하지 않는다
mkdir -p "$BACKUP_DIR"
```

## 1. 지울 주문 확인
```bash
TZ=Asia/Seoul date '+%m-%d %H:%M'
npx -y supabase@latest db query --linked --read-only -f $Q/peek.sql
```
- 주문 건수, 상태, 시각을 사용자에게 알려 준다.
- 장사 중이면 **테스트 주문인지** 확인한다. 입금 확인된 실제 주문(`cooking`, `ready`, `picked_up`)이 섞여 있으면 멈추고 다시 물어본다. 지우면 매출 집계에서도 사라진다.

## 2. 백업
```bash
npx -y supabase@latest db query --linked --read-only -f $Q/backup.sql > "$BACKUP_DIR/orders-backup-$(TZ=Asia/Seoul date +%m%d-%H%M).json" 2>/dev/null
```
- 파일 안의 `orders`, `items`, `queue` 건수가 1단계에서 본 건수와 같은지 확인한다. 다르면 지우지 않는다.

## 3. 삭제와 주문번호 초기화
```bash
npx -y supabase@latest db query --linked --yes -f $Q/wipe.sql 2>&1 | grep -E '"(orders|items|queue|seq_last|seq_called)"|rror'
```
- 주문 항목 → 공개 대기열 → 주문 순서로 한 트랜잭션 안에서 지우고, `order_number`를 1번부터 다시 시작한다.
- 메뉴·가격·계좌·세트 할인 설정은 건드리지 않는다.

## 4. 검증
- `orders`, `items`, `queue`가 모두 `0`이고 `seq_last = 1`, `seq_called = false`이면 다음 주문이 **#1**이 된다.
- 주방 화면을 새로고침해 주문이 비었는지 사용자에게 확인을 부탁한다.

## 주문번호만 1번으로 되돌릴 때
주문 함수를 실제 DB에서 `begin … rollback`으로 시험하면 주문은 남지 않아도 주문번호는 소모된다. 주문이 0건일 때만:
```bash
npx -y supabase@latest db query --linked --yes -f $Q/reseq.sql
```
주문이 남아 있으면 오류를 내고 아무것도 바꾸지 않는다.

## 주의
- Supabase CLI는 실제(production) DB에 쿼리할 때 확인을 요구한다. 읽기만 하는 1·2단계는 `--read-only`, 데이터를 바꾸는 3단계와 `reseq.sql`은 **사용자가 1단계 결과를 보고 지워도 된다고 답한 뒤에만** `--yes`를 붙여 실행한다.
- 백업 파일은 저장소 밖(`~/연광제/backups/`)에만 둔다. 손님 이름·연락처가 들어 있다.
- `npx -y supabase@latest`는 실행할 때마다 CLI를 내려받아 1분 가까이 걸린다. 여러 번 실행할 일이 있으면 CLI를 한 번 설치해 두고 `supabase db query --linked`로 쓴다.
- 프로젝트가 일시정지(INACTIVE) 상태면 쿼리가 실패한다. 대시보드에서 먼저 복원한다.
