-- 관리자 화면에서 '입금 확인'을 누르면 주문이 바로 '조리 중'으로 넘어가므로,
-- 입금을 확인하고 넣는 수동 주문도 같은 상태(cooking)로 시작하게 맞춥니다.
create or replace function public.booth_admin_create_order(
  p_payer_name text,
  p_contact text,
  p_items jsonb,
  p_paid boolean default true
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
  v_order record;
  v_contact text;
begin
  if not public.booth_is_admin() then
    raise exception '관리자만 주문을 직접 넣을 수 있습니다.';
  end if;

  v_contact := nullif(regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g'), '');
  if v_contact is not null and v_contact !~ '^01[0-9]{8,9}$' then
    raise exception '연락처는 01로 시작하는 휴대폰 번호로 입력하거나 비워 두세요.';
  end if;

  select * into strict v_order
  from public.booth_create_order(coalesce(nullif(btrim(p_payer_name), ''), '현장 주문'), p_items);

  update public.booth_orders
  set contact = v_contact,
      status = case when coalesce(p_paid, true) then 'cooking' else booth_orders.status end
  where booth_orders.id = v_order.id
  returning booth_orders.status into v_order.status;

  return query select
    v_order.id,
    v_order.order_number,
    v_order.public_token,
    v_order.total_amount,
    v_order.status,
    v_order.created_at;
end;
$$;

revoke all on function public.booth_admin_create_order(text, text, jsonb, boolean) from public;
revoke execute on function public.booth_admin_create_order(text, text, jsonb, boolean) from anon;
grant execute on function public.booth_admin_create_order(text, text, jsonb, boolean) to authenticated;
