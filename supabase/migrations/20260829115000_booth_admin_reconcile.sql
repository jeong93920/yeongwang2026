do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('k01027895490@gmail.com')
  order by created_at desc
  limit 1;

  if v_user_id is null then
    raise exception 'Supabase Auth에 k01027895490@gmail.com 계정이 없습니다.';
  end if;

  insert into public.booth_admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  if not exists (
    select 1 from public.booth_admins where user_id = v_user_id
  ) then
    raise exception 'Gmail 관리자 등록 검증에 실패했습니다.';
  end if;
end;
$$;
