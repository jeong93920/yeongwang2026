-- 세트 할인 금액을 관리자 화면에서 바꿀 수 있도록 booth_settings로 옮깁니다.
-- 할인은 음료 줄에서 먼저 빼고, 음료 가격보다 크면 나머지를 토스트 줄에서 뺍니다.

alter table public.booth_settings
  add column if not exists set_discount integer not null default 500;

alter table public.booth_settings
  drop constraint if exists booth_settings_set_discount_range;

alter table public.booth_settings
  add constraint booth_settings_set_discount_range
  check (set_discount between 0 and 100000);

comment on column public.booth_settings.set_discount is
  '토스트 + 음료 세트 할인 금액(원). 관리자 화면에서 변경합니다.';

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
  v_set_discount integer;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_order public.booth_orders%rowtype;
  v_menu public.booth_menu_items%rowtype;
  v_drink public.booth_menu_items%rowtype;
  v_need record;
  v_item record;
  v_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  select coalesce(s.set_discount, 0) into v_set_discount from public.booth_settings s where s.id = true;
  v_set_discount := coalesce(v_set_discount, 0);

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
      if v_menu.price + v_drink.price <= v_set_discount then
        raise exception '세트 가격을 계산할 수 없습니다.';
      end if;

      v_total := v_total + (v_menu.price + v_drink.price - v_set_discount) * v_item.quantity;
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'menu_id', v_menu.id,
          'name', v_menu.name || ' (세트)',
          'price', v_menu.price - greatest(v_set_discount - v_drink.price, 0),
          'quantity', v_item.quantity
        ),
        jsonb_build_object(
          'menu_id', v_drink.id,
          'name', case when v_item.set_drink_alt then v_drink.alt_name else v_drink.name end || ' (세트)',
          'price', v_drink.price - least(v_set_discount, v_drink.price),
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
