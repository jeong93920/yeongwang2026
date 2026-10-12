-- 토스트·음료 메뉴로 교체하고, 세트(토스트 + 음료, 500원 할인)와
-- 음료 대체 옵션(청귤에이드 → 청귤차)을 주문 생성 RPC에서 처리합니다.

alter table public.booth_menu_items
  add column if not exists category text,
  add column if not exists alt_name text;

alter table public.booth_menu_items
  drop constraint if exists booth_menu_items_category_check;

alter table public.booth_menu_items
  add constraint booth_menu_items_category_check
  check (category is null or category in ('toast', 'drink'));

comment on column public.booth_menu_items.category is
  'toast 또는 drink. 세트는 toast 1개 + drink 1개로만 구성할 수 있습니다.';
comment on column public.booth_menu_items.alt_name is
  '같은 가격으로 바꿔 받을 수 있는 대체 메뉴 이름 (예: 청귤에이드 → 청귤차).';

-- 지난 메뉴 정리. 주문 내역은 이름·가격 스냅샷으로 남습니다.
delete from public.booth_menu_items;

insert into public.booth_menu_items (
  id, name, description, price, image_url,
  sold_out, active, sort_order, prep_speed, stock_remaining, category, alt_name
)
values
  ('b0030000-0000-4000-8000-000000000001', '크림브륄레 토스트', '', 4500, null, false, true, 10, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000002', '말차 토스트',       '', 4000, null, false, true, 20, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000003', '초코 토스트',       '', 4000, null, false, true, 30, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000004', '커피',              '', 3000, null, false, true, 40, 'fast',   null, 'drink', null),
  ('b0030000-0000-4000-8000-000000000005', '청귤에이드',        '', 4000, null, false, true, 50, 'fast',   null, 'drink', '청귤차')
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    active = excluded.active,
    sort_order = excluded.sort_order,
    prep_speed = excluded.prep_speed,
    category = excluded.category,
    alt_name = excluded.alt_name;

-- 주문 항목 형식:
--   { menu_id, quantity, alt?, set_drink_id?, set_drink_alt? }
-- set_drink_id가 있으면 menu_id(토스트) + set_drink_id(음료) 세트 1개를 뜻합니다.
-- 세트는 주방이 메뉴별로 합산할 수 있게 토스트 행과 음료 행으로 나눠 저장하고,
-- 할인은 음료 행 가격에서 뺍니다.
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
  c_set_discount constant integer := 500;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_order public.booth_orders%rowtype;
  v_menu public.booth_menu_items%rowtype;
  v_drink public.booth_menu_items%rowtype;
  v_need record;
  v_item record;
  v_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
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
    where coalesce(item->>'menu_id', '') !~ c_uuid
       or coalesce(item->>'quantity', '') !~ '^([1-9]|1[0-9]|20)$'
       or lower(coalesce(item->>'alt', 'false')) not in ('true', 'false')
       or lower(coalesce(item->>'set_drink_alt', 'false')) not in ('true', 'false')
       or (nullif(item->>'set_drink_id', '') is not null and item->>'set_drink_id' !~ c_uuid)
  ) then
    raise exception '잘못된 주문 항목입니다.';
  end if;

  -- 세트 음료까지 포함해 메뉴별 필요 수량을 모은 뒤, 교착을 막기 위해 id 순서로 잠급니다.
  for v_need in
    select need.menu_id, sum(need.quantity)::integer as quantity
    from (
      select (item->>'menu_id')::uuid as menu_id, (item->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) item
      union all
      select (item->>'set_drink_id')::uuid, (item->>'quantity')::integer
      from jsonb_array_elements(p_items) item
      where nullif(item->>'set_drink_id', '') is not null
    ) need
    group by need.menu_id
    order by need.menu_id
  loop
    if v_need.quantity > 20 then
      raise exception '메뉴당 수량은 1~20개까지 가능합니다.';
    end if;

    select * into v_menu
    from public.booth_menu_items
    where booth_menu_items.id = v_need.menu_id
      and active = true
      and sold_out = false
    for update;

    if not found then
      raise exception '판매 중이 아닌 메뉴가 포함되어 있습니다.';
    end if;

    if v_menu.stock_remaining is not null then
      if v_need.quantity > v_menu.stock_remaining then
        raise exception '%은(는) %개만 남았습니다.', v_menu.name, v_menu.stock_remaining;
      end if;

      update public.booth_menu_items as stock_menu
      set stock_remaining = v_menu.stock_remaining - v_need.quantity,
          sold_out = stock_menu.sold_out or (v_menu.stock_remaining - v_need.quantity <= 0)
      where stock_menu.id = v_menu.id;
    end if;
  end loop;

  for v_item in
    select
      (item->>'menu_id')::uuid as menu_id,
      (item->>'quantity')::integer as quantity,
      lower(coalesce(item->>'alt', 'false')) = 'true' as alt,
      nullif(item->>'set_drink_id', '')::uuid as set_drink_id,
      lower(coalesce(item->>'set_drink_alt', 'false')) = 'true' as set_drink_alt
    from jsonb_array_elements(p_items) item
  loop
    select * into v_menu from public.booth_menu_items where booth_menu_items.id = v_item.menu_id;

    if v_item.alt and v_menu.alt_name is null then
      raise exception '선택할 수 없는 메뉴 옵션입니다.';
    end if;

    if v_item.set_drink_id is null then
      if v_item.set_drink_alt then
        raise exception '선택할 수 없는 메뉴 옵션입니다.';
      end if;

      v_total := v_total + v_menu.price * v_item.quantity;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'menu_id', v_menu.id,
        'name', case when v_item.alt then v_menu.alt_name else v_menu.name end,
        'price', v_menu.price,
        'quantity', v_item.quantity
      ));
    else
      select * into v_drink from public.booth_menu_items where booth_menu_items.id = v_item.set_drink_id;

      if v_menu.category is distinct from 'toast' or v_drink.category is distinct from 'drink' or v_item.alt then
        raise exception '세트는 토스트 1개와 음료 1개로 골라 주세요.';
      end if;
      if v_item.set_drink_alt and v_drink.alt_name is null then
        raise exception '선택할 수 없는 메뉴 옵션입니다.';
      end if;
      if v_drink.price <= c_set_discount then
        raise exception '세트 가격을 계산할 수 없습니다.';
      end if;

      v_total := v_total + (v_menu.price + v_drink.price - c_set_discount) * v_item.quantity;
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'menu_id', v_menu.id,
          'name', v_menu.name || ' (세트)',
          'price', v_menu.price,
          'quantity', v_item.quantity
        ),
        jsonb_build_object(
          'menu_id', v_drink.id,
          'name', case when v_item.set_drink_alt then v_drink.alt_name else v_drink.name end || ' (세트)',
          'price', v_drink.price - c_set_discount,
          'quantity', v_item.quantity
        )
      );
    end if;
  end loop;

  insert into public.booth_orders (payer_name, total_amount)
  values (p_payer_name, v_total)
  returning * into v_order;

  insert into public.booth_order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, quantity
  )
  select
    v_order.id,
    (line->>'menu_id')::uuid,
    line->>'name',
    (line->>'price')::integer,
    sum((line->>'quantity')::integer)::integer
  from jsonb_array_elements(v_lines) line
  group by (line->>'menu_id')::uuid, line->>'name', (line->>'price')::integer
  order by min(line->>'name');

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
