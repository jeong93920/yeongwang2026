-- 일차별·메뉴별 판매 개수와 매출. 결제 완료(입금 확인 이후) 주문만 셉니다.
-- 일차는 한국 시간 날짜 기준이고, "(세트)" 줄은 단품과 합칩니다. 청귤차는 청귤에이드와 따로 셉니다.
with o as (
  select *, (created_at at time zone 'Asia/Seoul')::date as day
  from booth_orders
  where status in ('confirmed', 'cooking', 'ready', 'picked_up')
)
select 'item' as kind, o.day::text as day,
       regexp_replace(i.name_snapshot, ' \(세트\)$', '') as name,
       sum(i.quantity) as qty,
       sum(i.quantity) filter (where i.name_snapshot like '% (세트)') as in_set,
       sum(i.quantity * i.price_snapshot) as amount
from o join booth_order_items i on i.order_id = o.id
group by 2, 3
union all
select 'total', o.day::text, '주문 ' || count(*) || '건', null, null, sum(o.total_amount)
from o group by o.day
order by 1, 2, 4 desc nulls last;
