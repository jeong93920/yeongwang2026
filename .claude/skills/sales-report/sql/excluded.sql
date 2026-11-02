-- 매출에서 빠진 주문: 취소와 입금 대기(일차별 건수·금액)
select (created_at at time zone 'Asia/Seoul')::date::text as day, status,
       count(*) as orders, sum(total_amount) as amount
from booth_orders
where status in ('cancelled', 'payment_pending')
group by 1, 2
order by 1, 2;
