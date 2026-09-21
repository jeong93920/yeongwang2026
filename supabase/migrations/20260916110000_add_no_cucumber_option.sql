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
       or lower(coalesce(item->>'no_cucumber', 'false')) not in ('true', 'false')
  ) then
    raise exception '잘못된 주문 항목입니다.';
  end if;

  for v_item in
    select
      (item->>'menu_id')::uuid as menu_id,
      (lower(coalesce(item->>'no_cucumber', 'false')) = 'true') as no_cucumber,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by
      (item->>'menu_id')::uuid,
      (lower(coalesce(item->>'no_cucumber', 'false')) = 'true')
  loop
    if v_item.quantity < 1 or v_item.quantity > 20 then
      raise exception '메뉴당 수량은 1~20개까지 가능합니다.';
    end if;

    select * into v_menu
    from public.booth_menu_items
    where booth_menu_items.id = v_item.menu_id
      and active = true
      and sold_out = false
    for share;

    if not found then
      raise exception '판매 중이 아닌 메뉴가 포함되어 있습니다.';
    end if;

    if v_item.no_cucumber and v_menu.name <> '김치말이국수' then
      raise exception '선택할 수 없는 메뉴 옵션입니다.';
    end if;

    v_total := v_total + (v_menu.price * v_item.quantity);
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'menu_id', v_menu.id,
      'name', v_menu.name || case when v_item.no_cucumber then ' (오이 빼기)' else '' end,
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

revoke all on function public.booth_create_order(text, jsonb) from public;
