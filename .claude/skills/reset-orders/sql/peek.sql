-- 지금 DB에 있는 주문 목록(한국 시간). 지우기 전에 무엇을 지우는지 확인용입니다.
select order_number, payer_name, total_amount, status,
       to_char(created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as kst
from booth_orders
order by order_number;
