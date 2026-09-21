-- Booth Order: isolated schema objects inside an existing Supabase project.
-- This migration only creates objects prefixed with booth_ and a booth-menu-images bucket.

create extension if not exists pgcrypto;

create table if not exists public.booth_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.booth_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.booth_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.booth_is_admin() from public;
grant execute on function public.booth_is_admin() to authenticated;

create table if not exists public.booth_settings (
  id boolean primary key default true check (id),
  booth_name text not null default '오늘의 부스',
  bank_name text not null default '',
  account_holder text not null default '',
  account_number text not null default '',
  transfer_qr_url text,
  is_open boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.booth_menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  price integer not null check (price >= 0),
  image_url text,
  sold_out boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booth_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  public_token uuid not null default gen_random_uuid() unique,
  payer_name text not null check (char_length(payer_name) between 1 and 20),
  status text not null default 'payment_pending' check (
    status in ('payment_pending', 'confirmed', 'cooking', 'ready', 'picked_up', 'cancelled')
  ),
  total_amount integer not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booth_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.booth_orders(id) on delete cascade,
  menu_item_id uuid references public.booth_menu_items(id) on delete set null,
  name_snapshot text not null,
  price_snapshot integer not null check (price_snapshot >= 0),
  quantity integer not null check (quantity between 1 and 20),
  line_total integer generated always as (price_snapshot * quantity) stored,
  created_at timestamptz not null default now()
);

-- Sanitized queue table: no payer name, menu, token, or payment details.
create table if not exists public.booth_public_queue (
  order_id uuid primary key references public.booth_orders(id) on delete cascade,
  order_number bigint not null unique,
  status text not null check (
    status in ('payment_pending', 'confirmed', 'cooking', 'ready', 'picked_up', 'cancelled')
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists booth_orders_status_number_idx
  on public.booth_orders(status, order_number);
create index if not exists booth_orders_created_at_idx
  on public.booth_orders(created_at desc);
create index if not exists booth_order_items_order_id_idx
  on public.booth_order_items(order_id);
create index if not exists booth_public_queue_status_number_idx
  on public.booth_public_queue(status, order_number);

create or replace function public.booth_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.booth_sync_public_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booth_public_queue (
    order_id, order_number, status, created_at, updated_at
  ) values (
    new.id, new.order_number, new.status, new.created_at, now()
  )
  on conflict (order_id) do update
    set status = excluded.status,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists booth_settings_updated_at on public.booth_settings;
create trigger booth_settings_updated_at
before update on public.booth_settings
for each row execute function public.booth_set_updated_at();

drop trigger if exists booth_menu_items_updated_at on public.booth_menu_items;
create trigger booth_menu_items_updated_at
before update on public.booth_menu_items
for each row execute function public.booth_set_updated_at();

drop trigger if exists booth_orders_updated_at on public.booth_orders;
create trigger booth_orders_updated_at
before update on public.booth_orders
for each row execute function public.booth_set_updated_at();

drop trigger if exists booth_orders_sync_public_queue on public.booth_orders;
create trigger booth_orders_sync_public_queue
after insert or update of status on public.booth_orders
for each row execute function public.booth_sync_public_queue();

-- Creates an order atomically and calculates all prices from trusted menu rows.
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
  ) then
    raise exception '잘못된 주문 항목입니다.';
  end if;

  for v_item in
    select
      (item->>'menu_id')::uuid as menu_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item->>'menu_id')::uuid
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

    v_total := v_total + (v_menu.price * v_item.quantity);
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'menu_id', v_menu.id,
      'name', v_menu.name,
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

-- Reads one customer's order using the unguessable token stored on that device.
create or replace function public.booth_get_order(p_public_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'total_amount', o.total_amount,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'price', i.price_snapshot,
        'quantity', i.quantity,
        'line_total', i.line_total
      ) order by i.created_at)
      from public.booth_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.booth_orders o
  where o.public_token = p_public_token;
$$;

revoke all on function public.booth_create_order(text, jsonb) from public;
revoke all on function public.booth_get_order(uuid) from public;
grant execute on function public.booth_create_order(text, jsonb) to anon, authenticated;
grant execute on function public.booth_get_order(uuid) to anon, authenticated;

alter table public.booth_admins enable row level security;
alter table public.booth_settings enable row level security;
alter table public.booth_menu_items enable row level security;
alter table public.booth_orders enable row level security;
alter table public.booth_order_items enable row level security;
alter table public.booth_public_queue enable row level security;

drop policy if exists booth_admins_read_self on public.booth_admins;
create policy booth_admins_read_self on public.booth_admins
for select to authenticated
using (user_id = auth.uid());

drop policy if exists booth_settings_public_read on public.booth_settings;
create policy booth_settings_public_read on public.booth_settings
for select to anon, authenticated using (true);

drop policy if exists booth_settings_admin_write on public.booth_settings;
create policy booth_settings_admin_write on public.booth_settings
for all to authenticated
using (public.booth_is_admin()) with check (public.booth_is_admin());

drop policy if exists booth_menu_public_read on public.booth_menu_items;
create policy booth_menu_public_read on public.booth_menu_items
for select to anon, authenticated using (active = true);

drop policy if exists booth_menu_admin_read on public.booth_menu_items;
create policy booth_menu_admin_read on public.booth_menu_items
for select to authenticated using (public.booth_is_admin());

drop policy if exists booth_menu_admin_write on public.booth_menu_items;
create policy booth_menu_admin_write on public.booth_menu_items
for all to authenticated
using (public.booth_is_admin()) with check (public.booth_is_admin());

drop policy if exists booth_orders_admin_all on public.booth_orders;
create policy booth_orders_admin_all on public.booth_orders
for all to authenticated
using (public.booth_is_admin()) with check (public.booth_is_admin());

drop policy if exists booth_order_items_admin_all on public.booth_order_items;
create policy booth_order_items_admin_all on public.booth_order_items
for all to authenticated
using (public.booth_is_admin()) with check (public.booth_is_admin());

drop policy if exists booth_queue_public_read on public.booth_public_queue;
create policy booth_queue_public_read on public.booth_public_queue
for select to anon, authenticated using (true);

drop policy if exists booth_queue_admin_all on public.booth_public_queue;
create policy booth_queue_admin_all on public.booth_public_queue
for all to authenticated
using (public.booth_is_admin()) with check (public.booth_is_admin());

revoke all on public.booth_admins, public.booth_settings, public.booth_menu_items,
  public.booth_orders, public.booth_order_items, public.booth_public_queue
from anon, authenticated;

grant select on public.booth_settings, public.booth_menu_items, public.booth_public_queue
  to anon, authenticated;
grant select on public.booth_admins to authenticated;
grant select, insert, update, delete on public.booth_settings, public.booth_menu_items,
  public.booth_orders, public.booth_order_items, public.booth_public_queue
  to authenticated;
grant usage, select on sequence public.booth_orders_order_number_seq to authenticated;

insert into public.booth_settings (id)
values (true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('booth-menu-images', 'booth-menu-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists booth_images_public_read on storage.objects;
create policy booth_images_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'booth-menu-images');

drop policy if exists booth_images_admin_insert on storage.objects;
create policy booth_images_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'booth-menu-images' and public.booth_is_admin());

drop policy if exists booth_images_admin_update on storage.objects;
create policy booth_images_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'booth-menu-images' and public.booth_is_admin())
with check (bucket_id = 'booth-menu-images' and public.booth_is_admin());

drop policy if exists booth_images_admin_delete on storage.objects;
create policy booth_images_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'booth-menu-images' and public.booth_is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booth_public_queue'
  ) then
    alter publication supabase_realtime add table public.booth_public_queue;
  end if;
end;
$$;
