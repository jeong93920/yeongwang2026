-- 주문 항목 → 공개 대기열 → 주문 순서로 지우고 주문번호를 1번부터 다시 시작합니다(한 트랜잭션).
-- 메뉴·가격·계좌·세트 할인 설정은 건드리지 않습니다.
begin;
delete from public.booth_order_items;
delete from public.booth_public_queue;
delete from public.booth_orders;
alter table public.booth_orders alter column order_number restart with 1;
commit;
-- 검증: 세 테이블 모두 0, seq_last = 1, seq_called = false 이면 다음 주문이 1번입니다.
select (select count(*) from booth_orders) as orders,
       (select count(*) from booth_order_items) as items,
       (select count(*) from booth_public_queue) as queue,
       (select last_value from booth_orders_order_number_seq) as seq_last,
       (select is_called from booth_orders_order_number_seq) as seq_called;
