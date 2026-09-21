do $$
declare
  v_order_id uuid;
begin
  select id into v_order_id
  from public.booth_orders
  where order_number = 169;

  if v_order_id is null then
    raise exception '주문번호 169를 찾을 수 없습니다.';
  end if;

  delete from public.booth_order_items
  where order_id = v_order_id
    and name_snapshot in ('감자치즈누룽지', '김치말이국수');

  update public.booth_orders
  set total_amount = (
        select coalesce(sum(line_total), 0)::integer
        from public.booth_order_items
        where order_id = v_order_id
      ),
      updated_at = now()
  where id = v_order_id;
end;
$$;
