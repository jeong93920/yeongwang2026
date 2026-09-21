alter table public.booth_menu_items
  add column if not exists stock_visible boolean not null default true;
