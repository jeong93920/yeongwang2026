alter table public.booth_menu_items
  add constraint booth_menu_active_positive_price
  check (not active or price > 0)
  not valid;

alter table public.booth_menu_items
  validate constraint booth_menu_active_positive_price;

create or replace function public.booth_require_open_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.booth_settings where id = true and is_open = true
  ) then
    raise exception '현재는 주문을 받지 않습니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.booth_require_open_for_order() from public;

drop trigger if exists booth_orders_require_open on public.booth_orders;
create trigger booth_orders_require_open
before insert on public.booth_orders
for each row execute function public.booth_require_open_for_order();
