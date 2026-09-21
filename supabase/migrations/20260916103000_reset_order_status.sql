truncate table
  public.booth_order_items,
  public.booth_public_queue,
  public.booth_orders
restart identity;

do $$
begin
  if exists (select 1 from public.booth_orders)
    or exists (select 1 from public.booth_order_items)
    or exists (select 1 from public.booth_public_queue) then
    raise exception 'booth order reset verification failed';
  end if;
end;
$$;
