do $$
declare
  v_menu public.booth_menu_items%rowtype;
  v_order_203 uuid;
  v_order_204 uuid;
begin
  lock table public.booth_orders in access exclusive mode;

  if exists (
    select 1
    from public.booth_orders
    where order_number in (203, 204)
  ) then
    raise exception '203 또는 204번 주문이 이미 존재합니다.';
  end if;

  select * into v_menu
  from public.booth_menu_items
  where name = '감자치즈누룽지'
  for update;

  if v_menu.id is null then
    raise exception '감자치즈누룽지 메뉴를 찾을 수 없습니다.';
  end if;

  if v_menu.stock_remaining is not null and v_menu.stock_remaining < 2 then
    raise exception '감자치즈누룽지 재고가 2개 미만입니다.';
  end if;

  insert into public.booth_orders (
    order_number,
    payer_name,
    status,
    total_amount
  )
  overriding system value
  values (
    203,
    '조민경',
    'picked_up',
    v_menu.price
  )
  returning id into v_order_203;

  insert into public.booth_order_items (
    order_id,
    menu_item_id,
    name_snapshot,
    price_snapshot,
    quantity
  ) values (
    v_order_203,
    v_menu.id,
    v_menu.name,
    v_menu.price,
    1
  );

  insert into public.booth_orders (
    order_number,
    payer_name,
    status,
    total_amount
  )
  overriding system value
  values (
    204,
    '오창준',
    'picked_up',
    v_menu.price
  )
  returning id into v_order_204;

  insert into public.booth_order_items (
    order_id,
    menu_item_id,
    name_snapshot,
    price_snapshot,
    quantity
  ) values (
    v_order_204,
    v_menu.id,
    v_menu.name,
    v_menu.price,
    1
  );

  if v_menu.stock_remaining is not null then
    update public.booth_menu_items as menu
    set stock_remaining = menu.stock_remaining - 2,
        sold_out = menu.sold_out or (menu.stock_remaining - 2 <= 0)
    where menu.id = v_menu.id;
  end if;

  perform setval(
    'public.booth_orders_order_number_seq',
    greatest(
      204,
      (select coalesce(max(order_number), 204) from public.booth_orders)
    ),
    true
  );
end;
$$;
