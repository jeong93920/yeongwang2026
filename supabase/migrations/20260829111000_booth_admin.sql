do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('dpgns1031@naver.com')
  limit 1;

  if v_user_id is null then
    raise exception 'Supabase Auth에 dpgns1031@naver.com 계정이 없습니다. 먼저 Authentication에서 계정을 생성해 주세요.';
  end if;

  insert into public.booth_admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
end;
$$;
