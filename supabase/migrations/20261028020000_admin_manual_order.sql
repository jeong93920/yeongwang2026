-- 고객 화면을 쓸 수 없을 때 관리자가 주방 현황에서 직접 주문을 넣는 RPC입니다.
-- 가격·세트 할인·재고 처리는 손님 주문과 같은 booth_create_order를 그대로 씁니다.
-- 연락처는 선택이고, 현장에서 입금을 확인했다면 바로 '주문 접수(confirmed)'로 넣습니다.
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
      status = case when coalesce(p_paid, true) then 'confirmed' else booth_orders.status end
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
