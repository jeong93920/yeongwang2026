-- 주문이 하나도 없을 때만 주문번호를 1번으로 되돌립니다(롤백 테스트로 번호가 소모됐을 때).
do $$ begin
  if exists (select 1 from public.booth_orders) then
    raise exception '주문이 남아 있어 번호를 되돌리지 않았습니다';
  end if;
end $$;
alter table public.booth_orders alter column order_number restart with 1;
select last_value as seq_last, is_called as seq_called from booth_orders_order_number_seq;
