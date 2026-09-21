delete from public.booth_menu_items
where id in (
  'b0010000-0000-4000-8000-000000000002',
  'b0010000-0000-4000-8000-000000000003',
  'b0010000-0000-4000-8000-000000000004'
)
or name in ('불닭볶음면', '불닭냉면', '레몬에이드');

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
select
  'b0010000-0000-4000-8000-000000000006',
  '김치말이국수',
  '가격 확정 후 판매 시작',
  0,
  null,
  false,
  false,
  20
where not exists (
  select 1
  from public.booth_menu_items
  where name = '김치말이국수'
);

update public.booth_menu_items
set sort_order = 20
where name = '김치말이국수';

update public.booth_menu_items
set sort_order = 30
where name = '청포도에이드';
