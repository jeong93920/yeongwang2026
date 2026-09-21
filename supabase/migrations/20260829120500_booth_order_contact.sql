alter table public.booth_orders
  add column if not exists contact text;

alter table public.booth_orders
  drop constraint if exists booth_orders_contact_format;

alter table public.booth_orders
  add constraint booth_orders_contact_format
  check (contact is null or contact ~ '^01[0-9]{8,9}$')
  not valid;

alter table public.booth_orders
  validate constraint booth_orders_contact_format;

comment on column public.booth_orders.contact is
  'Admin-only customer contact; never exposed through booth_public_queue or booth_get_order.';

-- Prevent anonymous callers from bypassing the required contact by using the old signature.
revoke execute on function public.booth_create_order(text, jsonb) from anon, authenticated;

create or replace function public.booth_create_order(
  p_payer_name text,
  p_contact text,
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
  v_order record;
begin
  p_contact := regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g');
  if p_contact !~ '^01[0-9]{8,9}$' then
    raise exception '연락처는 01로 시작하는 휴대폰 번호를 입력해 주세요.';
  end if;

  select * into strict v_order
  from public.booth_create_order(p_payer_name, p_items);

  update public.booth_orders
  set contact = p_contact
  where booth_orders.id = v_order.id;

  return query select
    v_order.id,
    v_order.order_number,
    v_order.public_token,
    v_order.total_amount,
    v_order.status,
    v_order.created_at;
end;
$$;

revoke all on function public.booth_create_order(text, text, jsonb) from public;
grant execute on function public.booth_create_order(text, text, jsonb) to anon, authenticated;
