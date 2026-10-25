-- 실제 입금 계좌로 바꾸고, 메뉴 이름을 튀김산도·아이스 아메리카노로 바꿉니다.
-- 토스 송금 버튼 링크도 이 계좌 값으로 자동 생성됩니다.
update public.booth_settings
set bank_name = '국민은행',
    account_holder = '원종훈',
    account_number = '95130200147672'
where id = true;

update public.booth_menu_items as m
set name = v.name
from (values
  ('b0030000-0000-4000-8000-000000000001'::uuid, '크림브륄레 튀김산도'),
  ('b0030000-0000-4000-8000-000000000002'::uuid, '말차 튀김산도'),
  ('b0030000-0000-4000-8000-000000000003'::uuid, '초코 튀김산도'),
  ('b0030000-0000-4000-8000-000000000004'::uuid, '아이스 아메리카노'),
  ('b0030000-0000-4000-8000-000000000005'::uuid, '청귤에이드')
) as v(id, name)
where m.id = v.id;
