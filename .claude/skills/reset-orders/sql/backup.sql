-- 주문·주문 항목 전체를 JSON으로 받아 두는 백업. 결과를 파일로 저장합니다.
select (select count(*) from booth_orders) as orders,
       (select count(*) from booth_order_items) as items,
       (select count(*) from booth_public_queue) as queue,
       (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from booth_orders o) as orders_json,
       (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from booth_order_items i) as items_json;
