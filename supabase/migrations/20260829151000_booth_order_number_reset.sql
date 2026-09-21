-- Reset booth order numbering after test data has been fully removed.
-- Abort rather than risk duplicate numbers if any order-related row remains.
do $$
begin
  if exists (select 1 from public.booth_orders) then
    raise exception 'booth_orders is not empty; order number sequence was not reset';
  end if;

  if exists (select 1 from public.booth_order_items) then
    raise exception 'booth_order_items is not empty; order number sequence was not reset';
  end if;

  if exists (select 1 from public.booth_public_queue) then
    raise exception 'booth_public_queue is not empty; order number sequence was not reset';
  end if;
end;
$$;

alter table public.booth_orders
  alter column order_number restart with 1;

do $$
declare
  v_last_value bigint;
  v_is_called boolean;
begin
  select last_value, is_called
    into v_last_value, v_is_called
    from public.booth_orders_order_number_seq;

  if v_last_value <> 1 or v_is_called then
    raise exception 'order number sequence reset verification failed';
  end if;
end;
$$;
