insert into public.booth_menu_items (
  id,
  name,
  description,
  price,
  image_url,
  sold_out,
  active,
  sort_order
)
values (
  'b0010000-0000-4000-8000-000000000007',
  '세트메뉴',
  '감자치즈누룽지 + 김치말이국수 + 청포도에이드',
  13000,
  null,
  false,
  true,
  40
)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    sold_out = excluded.sold_out,
    active = excluded.active,
    sort_order = excluded.sort_order;
