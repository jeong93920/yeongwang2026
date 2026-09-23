-- BASAK WITCH 리브랜딩: 부스명과 메뉴를 할로윈 부스 기준으로 교체하고,
-- 특정 메뉴 이름에 묶여 있던 주문 생성 로직을 메뉴별 일반 로직으로 바꿉니다.

update public.booth_settings
set booth_name = 'BASAK WITCH'
where id = true;

-- 지난 부스 메뉴 정리.
-- booth_order_items.menu_item_id는 on delete set null이고 이름·가격은 스냅샷으로 남으므로
-- 지난 주문 내역과 매출 집계는 그대로 유지됩니다.
delete from public.booth_menu_items;

insert into public.booth_menu_items (
  id, name, description, price, image_url,
  sold_out, active, sort_order, prep_speed, stock_remaining
)
values
  ('b0020000-0000-4000-8000-000000000001', '크림브륄레 튀김산도', '가격 확정 후 판매 시작', 0, null, false, false, 10, 'normal', null),
  ('b0020000-0000-4000-8000-000000000002', '초코 튀김산도',       '가격 확정 후 판매 시작', 0, null, false, false, 20, 'normal', null),
  ('b0020000-0000-4000-8000-000000000003', '말차 튀김산도',       '가격 확정 후 판매 시작', 0, null, false, false, 30, 'normal', null),
  ('b0020000-0000-4000-8000-000000000004', '청귤차',              '가격 확정 후 판매 시작', 0, null, false, false, 40, 'fast',   null),
  ('b0020000-0000-4000-8000-000000000005', '청귤에이드',          '가격 확정 후 판매 시작', 0, null, false, false, 50, 'fast',   null),
  ('b0020000-0000-4000-8000-000000000006', '아이스 아메리카노',   '가격 확정 후 판매 시작', 0, null, false, false, 60, 'fast',   null)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    prep_speed = excluded.prep_speed;

-- 주문 생성: 감자치즈누룽지·김치말이국수·세트메뉴·오이 빼기에 묶여 있던 분기를 걷어내고
-- 모든 메뉴에 대해 stock_remaining을 동일하게 검사·차감합니다.
create or replace function public.booth_create_order(
  p_payer_name text,
  p_items jsonb
)
returns table (
  id uuid,
  order_number bigint,
  public_token uuid,
  total_amount integer,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.booth_orders%rowtype;
  v_menu public.booth_menu_items%rowtype;
  v_item record;
  v_total integer := 0;
  v_normalized jsonb := '[]'::jsonb;
begin
  p_payer_name := btrim(coalesce(p_payer_name, ''));
  if char_length(p_payer_name) < 1 or char_length(p_payer_name) > 20 then
    raise exception '입금자 이름은 1~20자로 입력해 주세요.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception '주문할 메뉴가 없습니다.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'menu_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(item->>'quantity', '') !~ '^[0-9]+$'
  ) then
    raise exception '잘못된 주문 항목입니다.';
  end if;

  for v_item in
    select
      (item->>'menu_id')::uuid as menu_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item->>'menu_id')::uuid
    order by 1 -- 동시 주문 사이의 교착을 막기 위해 잠금 순서를 고정합니다.
  loop
    if v_item.quantity < 1 or v_item.quantity > 20 then
      raise exception '메뉴당 수량은 1~20개까지 가능합니다.';
    end if;

    select * into v_menu
    from public.booth_menu_items
    where booth_menu_items.id = v_item.menu_id
      and active = true
      and sold_out = false
    for update;

    if not found then
      raise exception '판매 중이 아닌 메뉴가 포함되어 있습니다.';
    end if;

    if v_menu.stock_remaining is not null then
      if v_item.quantity > v_menu.stock_remaining then
        raise exception '%은(는) %개만 남았습니다.', v_menu.name, v_menu.stock_remaining;
      end if;

      update public.booth_menu_items as stock_menu
      set stock_remaining = v_menu.stock_remaining - v_item.quantity,
          sold_out = stock_menu.sold_out or (v_menu.stock_remaining - v_item.quantity <= 0)
      where stock_menu.id = v_menu.id;
    end if;

    v_total := v_total + (v_menu.price * v_item.quantity);
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'menu_id', v_menu.id,
      'name', v_menu.name,
      'price', v_menu.price,
      'quantity', v_item.quantity
    ));
  end loop;

  insert into public.booth_orders (payer_name, total_amount)
  values (p_payer_name, v_total)
  returning * into v_order;

  insert into public.booth_order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, quantity
  )
  select
    v_order.id,
    (item->>'menu_id')::uuid,
    item->>'name',
    (item->>'price')::integer,
    (item->>'quantity')::integer
  from jsonb_array_elements(v_normalized) item;

  return query select
    v_order.id,
    v_order.order_number,
    v_order.public_token,
    v_order.total_amount,
    v_order.status,
    v_order.created_at;
end;
$$;

-- 연락처를 강제하는 3인자 래퍼만 손님에게 열어 둡니다.
revoke all on function public.booth_create_order(text, jsonb) from public;
revoke execute on function public.booth_create_order(text, jsonb) from anon, authenticated;
