-- 임시 가격: 확정 전까지 손님 화면에서 메뉴를 확인할 수 있게 판매 상태로 올립니다.
-- 가격이 확정되면 관리자 화면(메뉴 가격·판매·품절 설정)에서 덮어쓰면 됩니다.

update public.booth_menu_items
set price = 3000,
    description = ''
where id in (
  'b0020000-0000-4000-8000-000000000001', -- 크림브륄레 튀김산도
  'b0020000-0000-4000-8000-000000000002', -- 초코 튀김산도
  'b0020000-0000-4000-8000-000000000003'  -- 말차 튀김산도
);

update public.booth_menu_items
set price = 2500,
    description = ''
where id in (
  'b0020000-0000-4000-8000-000000000004', -- 청귤차
  'b0020000-0000-4000-8000-000000000005', -- 청귤에이드
  'b0020000-0000-4000-8000-000000000006'  -- 아이스 아메리카노
);

-- 가격이 들어간 뒤에야 booth_menu_active_positive_price 제약을 통과합니다.
update public.booth_menu_items
set active = true,
    sold_out = false
where price > 0;
