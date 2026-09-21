do $$
declare
  v_new_user_id uuid;
begin
  select id into v_new_user_id
  from auth.users
  where lower(email) = lower('k01027895490@gmail.com')
  limit 1;

  if v_new_user_id is null then
    raise exception 'Supabase Auth에 k01027895490@gmail.com 계정이 없습니다.';
  end if;

  delete from public.booth_admins
  where user_id in (
    select id from auth.users
    where lower(email) = lower('dpgns1031@naver.com')
  );

  insert into public.booth_admins (user_id)
  values (v_new_user_id)
  on conflict (user_id) do nothing;
end;
$$;
