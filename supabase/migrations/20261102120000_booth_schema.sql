-- BASAK WITCH 부스 QR 주문 관리 시스템 — 데이터베이스 구조
--
-- 이 파일 하나로 빈 Supabase 프로젝트에 지금 운영 중인 DB 구조를 그대로 만들 수 있습니다.
--   테이블 6개: booth_settings, booth_menu_items, booth_orders, booth_order_items, booth_public_queue, booth_admins
--   주문 함수: booth_create_order(손님 주문), booth_get_order(내 주문 조회), booth_admin_create_order(주방 수동 주문)
--   보안: 손님은 메뉴·설정·공개 대기열만 읽고, 주문은 함수를 통해서만 만듭니다. 관리자는 booth_admins에 등록된 계정입니다.
--   메뉴 사진 버킷(booth-menu-images)과 실시간 대기열(supabase_realtime) 설정을 포함합니다.

create extension if not exists pgcrypto;

-- ============================================================
-- 테이블
-- ============================================================

CREATE TABLE public.booth_admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.booth_menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    price integer NOT NULL,
    image_url text,
    sold_out boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prep_speed text DEFAULT 'normal'::text NOT NULL,
    stock_remaining integer,
    category text,
    alt_name text,
    CONSTRAINT booth_menu_active_positive_price CHECK (((NOT active) OR (price > 0))),
    CONSTRAINT booth_menu_items_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['toast'::text, 'drink'::text])))),
    CONSTRAINT booth_menu_items_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
    CONSTRAINT booth_menu_items_prep_speed_check CHECK ((prep_speed = ANY (ARRAY['fast'::text, 'normal'::text, 'slow'::text]))),
    CONSTRAINT booth_menu_items_price_check CHECK ((price >= 0)),
    CONSTRAINT booth_menu_items_stock_remaining_check CHECK (((stock_remaining IS NULL) OR (stock_remaining >= 0)))
);

COMMENT ON COLUMN public.booth_menu_items.category IS 'toast 또는 drink. 세트는 toast 1개 + drink 1개로만 구성할 수 있습니다.';

COMMENT ON COLUMN public.booth_menu_items.alt_name IS '같은 가격으로 바꿔 받을 수 있는 대체 메뉴 이름 (예: 청귤에이드 → 청귤차).';

CREATE TABLE public.booth_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    menu_item_id uuid,
    name_snapshot text NOT NULL,
    price_snapshot integer NOT NULL,
    quantity integer NOT NULL,
    line_total integer GENERATED ALWAYS AS ((price_snapshot * quantity)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booth_order_items_price_snapshot_check CHECK ((price_snapshot >= 0)),
    CONSTRAINT booth_order_items_quantity_check CHECK (((quantity >= 1) AND (quantity <= 20)))
);

CREATE TABLE public.booth_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number bigint NOT NULL,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    payer_name text NOT NULL,
    status text DEFAULT 'payment_pending'::text NOT NULL,
    total_amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact text,
    CONSTRAINT booth_orders_contact_format CHECK (((contact IS NULL) OR (contact ~ '^01[0-9]{8,9}$'::text))),
    CONSTRAINT booth_orders_payer_name_check CHECK (((char_length(payer_name) >= 1) AND (char_length(payer_name) <= 20))),
    CONSTRAINT booth_orders_status_check CHECK ((status = ANY (ARRAY['payment_pending'::text, 'confirmed'::text, 'cooking'::text, 'ready'::text, 'picked_up'::text, 'cancelled'::text]))),
    CONSTRAINT booth_orders_total_amount_check CHECK ((total_amount >= 0))
);

COMMENT ON COLUMN public.booth_orders.contact IS 'Admin-only customer contact; never exposed through booth_public_queue or booth_get_order.';

ALTER TABLE public.booth_orders ALTER COLUMN order_number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booth_orders_order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.booth_public_queue (
    order_id uuid NOT NULL,
    order_number bigint NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booth_public_queue_status_check CHECK ((status = ANY (ARRAY['payment_pending'::text, 'confirmed'::text, 'cooking'::text, 'ready'::text, 'picked_up'::text, 'cancelled'::text])))
);

CREATE TABLE public.booth_settings (
    id boolean DEFAULT true NOT NULL,
    booth_name text DEFAULT '오늘의 부스'::text NOT NULL,
    bank_name text DEFAULT ''::text NOT NULL,
    account_holder text DEFAULT ''::text NOT NULL,
    account_number text DEFAULT ''::text NOT NULL,
    transfer_qr_url text,
    is_open boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    set_discount integer DEFAULT 500 NOT NULL,
    CONSTRAINT booth_settings_id_check CHECK (id),
    CONSTRAINT booth_settings_set_discount_range CHECK (((set_discount >= 0) AND (set_discount <= 100000)))
);

COMMENT ON COLUMN public.booth_settings.set_discount IS '토스트 + 음료 세트 할인 금액(원). 관리자 화면에서 변경합니다.';

-- ============================================================
-- 기본 키·고유·외래 키 제약
-- ============================================================

ALTER TABLE ONLY public.booth_admins
    ADD CONSTRAINT booth_admins_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.booth_menu_items
    ADD CONSTRAINT booth_menu_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booth_order_items
    ADD CONSTRAINT booth_order_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booth_orders
    ADD CONSTRAINT booth_orders_order_number_key UNIQUE (order_number);

ALTER TABLE ONLY public.booth_orders
    ADD CONSTRAINT booth_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booth_orders
    ADD CONSTRAINT booth_orders_public_token_key UNIQUE (public_token);

ALTER TABLE ONLY public.booth_public_queue
    ADD CONSTRAINT booth_public_queue_order_number_key UNIQUE (order_number);

ALTER TABLE ONLY public.booth_public_queue
    ADD CONSTRAINT booth_public_queue_pkey PRIMARY KEY (order_id);

ALTER TABLE ONLY public.booth_settings
    ADD CONSTRAINT booth_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booth_admins
    ADD CONSTRAINT booth_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.booth_order_items
    ADD CONSTRAINT booth_order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.booth_menu_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.booth_order_items
    ADD CONSTRAINT booth_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.booth_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.booth_public_queue
    ADD CONSTRAINT booth_public_queue_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.booth_orders(id) ON DELETE CASCADE;

-- ============================================================
-- 인덱스
-- ============================================================

CREATE INDEX booth_order_items_order_id_idx ON public.booth_order_items USING btree (order_id);

CREATE INDEX booth_orders_created_at_idx ON public.booth_orders USING btree (created_at DESC);

CREATE INDEX booth_orders_status_number_idx ON public.booth_orders USING btree (status, order_number);

CREATE INDEX booth_public_queue_status_number_idx ON public.booth_public_queue USING btree (status, order_number);

-- ============================================================
-- 함수 (주문 생성·조회·관리자 확인·트리거용)
-- ============================================================

CREATE FUNCTION public.booth_admin_create_order(p_payer_name text, p_contact text, p_items jsonb, p_paid boolean DEFAULT true) RETURNS TABLE(id uuid, order_number bigint, public_token uuid, total_amount integer, status text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_order record;
  v_contact text;
begin
  if not public.booth_is_admin() then
    raise exception '관리자만 주문을 직접 넣을 수 있습니다.';
  end if;

  v_contact := nullif(regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g'), '');
  if v_contact is not null and v_contact !~ '^01[0-9]{8,9}$' then
    raise exception '연락처는 01로 시작하는 휴대폰 번호로 입력하거나 비워 두세요.';
  end if;

  select * into strict v_order
  from public.booth_create_order(coalesce(nullif(btrim(p_payer_name), ''), '현장 주문'), p_items);

  update public.booth_orders
  set contact = v_contact,
      status = case when coalesce(p_paid, true) then 'cooking' else booth_orders.status end
  where booth_orders.id = v_order.id
  returning booth_orders.status into v_order.status;

  return query select
    v_order.id,
    v_order.order_number,
    v_order.public_token,
    v_order.total_amount,
    v_order.status,
    v_order.created_at;
end;
$_$;

CREATE FUNCTION public.booth_create_order(p_payer_name text, p_items jsonb) RETURNS TABLE(id uuid, order_number bigint, public_token uuid, total_amount integer, status text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_set_discount integer;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_order public.booth_orders%rowtype;
  v_menu public.booth_menu_items%rowtype;
  v_drink public.booth_menu_items%rowtype;
  v_need record;
  v_item record;
  v_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  select coalesce(s.set_discount, 0) into v_set_discount from public.booth_settings s where s.id = true;
  v_set_discount := coalesce(v_set_discount, 0);

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
    where coalesce(item->>'menu_id', '') !~ c_uuid
       or coalesce(item->>'quantity', '') !~ '^([1-9]|1[0-9]|20)$'
       or lower(coalesce(item->>'alt', 'false')) not in ('true', 'false')
       or lower(coalesce(item->>'set_drink_alt', 'false')) not in ('true', 'false')
       or (nullif(item->>'set_drink_id', '') is not null and item->>'set_drink_id' !~ c_uuid)
  ) then
    raise exception '잘못된 주문 항목입니다.';
  end if;

  -- 세트 음료까지 포함해 메뉴별 필요 수량을 모은 뒤, 교착을 막기 위해 id 순서로 잠급니다.
  for v_need in
    select need.menu_id, sum(need.quantity)::integer as quantity
    from (
      select (item->>'menu_id')::uuid as menu_id, (item->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) item
      union all
      select (item->>'set_drink_id')::uuid, (item->>'quantity')::integer
      from jsonb_array_elements(p_items) item
      where nullif(item->>'set_drink_id', '') is not null
    ) need
    group by need.menu_id
    order by need.menu_id
  loop
    if v_need.quantity > 20 then
      raise exception '메뉴당 수량은 1~20개까지 가능합니다.';
    end if;

    select * into v_menu
    from public.booth_menu_items
    where booth_menu_items.id = v_need.menu_id
      and active = true
      and sold_out = false
    for update;

    if not found then
      raise exception '판매 중이 아닌 메뉴가 포함되어 있습니다.';
    end if;

    if v_menu.stock_remaining is not null then
      if v_need.quantity > v_menu.stock_remaining then
        raise exception '%은(는) %개만 남았습니다.', v_menu.name, v_menu.stock_remaining;
      end if;

      update public.booth_menu_items as stock_menu
      set stock_remaining = v_menu.stock_remaining - v_need.quantity,
          sold_out = stock_menu.sold_out or (v_menu.stock_remaining - v_need.quantity <= 0)
      where stock_menu.id = v_menu.id;
    end if;
  end loop;

  for v_item in
    select
      (item->>'menu_id')::uuid as menu_id,
      (item->>'quantity')::integer as quantity,
      lower(coalesce(item->>'alt', 'false')) = 'true' as alt,
      nullif(item->>'set_drink_id', '')::uuid as set_drink_id,
      lower(coalesce(item->>'set_drink_alt', 'false')) = 'true' as set_drink_alt
    from jsonb_array_elements(p_items) item
  loop
    select * into v_menu from public.booth_menu_items where booth_menu_items.id = v_item.menu_id;

    if v_item.alt and v_menu.alt_name is null then
      raise exception '선택할 수 없는 메뉴 옵션입니다.';
    end if;

    if v_item.set_drink_id is null then
      if v_item.set_drink_alt then
        raise exception '선택할 수 없는 메뉴 옵션입니다.';
      end if;

      v_total := v_total + v_menu.price * v_item.quantity;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'menu_id', v_menu.id,
        'name', case when v_item.alt then v_menu.alt_name else v_menu.name end,
        'price', v_menu.price,
        'quantity', v_item.quantity
      ));
    else
      select * into v_drink from public.booth_menu_items where booth_menu_items.id = v_item.set_drink_id;

      if v_menu.category is distinct from 'toast' or v_drink.category is distinct from 'drink' or v_item.alt then
        raise exception '세트는 토스트 1개와 음료 1개로 골라 주세요.';
      end if;
      if v_item.set_drink_alt and v_drink.alt_name is null then
        raise exception '선택할 수 없는 메뉴 옵션입니다.';
      end if;
      if v_menu.price + v_drink.price <= v_set_discount then
        raise exception '세트 가격을 계산할 수 없습니다.';
      end if;

      v_total := v_total + (v_menu.price + v_drink.price - v_set_discount) * v_item.quantity;
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'menu_id', v_menu.id,
          'name', v_menu.name || ' (세트)',
          'price', v_menu.price - greatest(v_set_discount - v_drink.price, 0),
          'quantity', v_item.quantity
        ),
        jsonb_build_object(
          'menu_id', v_drink.id,
          'name', case when v_item.set_drink_alt then v_drink.alt_name else v_drink.name end || ' (세트)',
          'price', v_drink.price - least(v_set_discount, v_drink.price),
          'quantity', v_item.quantity
        )
      );
    end if;
  end loop;

  insert into public.booth_orders (payer_name, total_amount)
  values (p_payer_name, v_total)
  returning * into v_order;

  insert into public.booth_order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, quantity
  )
  select
    v_order.id,
    (line->>'menu_id')::uuid,
    line->>'name',
    (line->>'price')::integer,
    sum((line->>'quantity')::integer)::integer
  from jsonb_array_elements(v_lines) line
  group by (line->>'menu_id')::uuid, line->>'name', (line->>'price')::integer
  order by min(line->>'name');

  return query select
    v_order.id,
    v_order.order_number,
    v_order.public_token,
    v_order.total_amount,
    v_order.status,
    v_order.created_at;
end;
$_$;

CREATE FUNCTION public.booth_create_order(p_payer_name text, p_contact text, p_items jsonb) RETURNS TABLE(id uuid, order_number bigint, public_token uuid, total_amount integer, status text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

CREATE FUNCTION public.booth_get_order(p_public_token uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

CREATE FUNCTION public.booth_is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.booth_admins where user_id = auth.uid()
  );
$$;

CREATE FUNCTION public.booth_require_open_for_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.booth_settings where id = true and is_open = true
  ) then
    raise exception '현재는 주문을 받지 않습니다.';
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.booth_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE FUNCTION public.booth_sync_public_queue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

-- ============================================================
-- 트리거
-- ============================================================

CREATE TRIGGER booth_menu_items_updated_at BEFORE UPDATE ON public.booth_menu_items FOR EACH ROW EXECUTE FUNCTION public.booth_set_updated_at();

CREATE TRIGGER booth_orders_require_open BEFORE INSERT ON public.booth_orders FOR EACH ROW EXECUTE FUNCTION public.booth_require_open_for_order();

CREATE TRIGGER booth_orders_sync_public_queue AFTER INSERT OR UPDATE OF status ON public.booth_orders FOR EACH ROW EXECUTE FUNCTION public.booth_sync_public_queue();

CREATE TRIGGER booth_orders_updated_at BEFORE UPDATE ON public.booth_orders FOR EACH ROW EXECUTE FUNCTION public.booth_set_updated_at();

CREATE TRIGGER booth_settings_updated_at BEFORE UPDATE ON public.booth_settings FOR EACH ROW EXECUTE FUNCTION public.booth_set_updated_at();

-- ============================================================
-- 행 수준 보안(RLS)과 정책
-- ============================================================

ALTER TABLE public.booth_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_admins_read_self ON public.booth_admins FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY booth_menu_admin_read ON public.booth_menu_items FOR SELECT TO authenticated USING (public.booth_is_admin());

CREATE POLICY booth_menu_admin_write ON public.booth_menu_items TO authenticated USING (public.booth_is_admin()) WITH CHECK (public.booth_is_admin());

ALTER TABLE public.booth_menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_menu_public_read ON public.booth_menu_items FOR SELECT TO anon, authenticated USING ((active = true));

ALTER TABLE public.booth_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_order_items_admin_all ON public.booth_order_items TO authenticated USING (public.booth_is_admin()) WITH CHECK (public.booth_is_admin());

ALTER TABLE public.booth_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_orders_admin_all ON public.booth_orders TO authenticated USING (public.booth_is_admin()) WITH CHECK (public.booth_is_admin());

ALTER TABLE public.booth_public_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_queue_admin_all ON public.booth_public_queue TO authenticated USING (public.booth_is_admin()) WITH CHECK (public.booth_is_admin());

CREATE POLICY booth_queue_public_read ON public.booth_public_queue FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.booth_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY booth_settings_admin_write ON public.booth_settings TO authenticated USING (public.booth_is_admin()) WITH CHECK (public.booth_is_admin());

CREATE POLICY booth_settings_public_read ON public.booth_settings FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 권한
-- ============================================================

REVOKE ALL ON FUNCTION public.booth_admin_create_order(p_payer_name text, p_contact text, p_items jsonb, p_paid boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.booth_admin_create_order(p_payer_name text, p_contact text, p_items jsonb, p_paid boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.booth_create_order(p_payer_name text, p_items jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.booth_create_order(p_payer_name text, p_contact text, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.booth_create_order(p_payer_name text, p_contact text, p_items jsonb) TO anon;
GRANT ALL ON FUNCTION public.booth_create_order(p_payer_name text, p_contact text, p_items jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.booth_get_order(p_public_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.booth_get_order(p_public_token uuid) TO anon;
GRANT ALL ON FUNCTION public.booth_get_order(p_public_token uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.booth_is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.booth_is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.booth_require_open_for_order() FROM PUBLIC;

GRANT SELECT ON TABLE public.booth_admins TO authenticated;

GRANT SELECT ON TABLE public.booth_menu_items TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booth_menu_items TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booth_order_items TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booth_orders TO authenticated;

GRANT SELECT,USAGE ON SEQUENCE public.booth_orders_order_number_seq TO authenticated;

GRANT SELECT ON TABLE public.booth_public_queue TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booth_public_queue TO authenticated;

GRANT SELECT ON TABLE public.booth_settings TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booth_settings TO authenticated;

-- ============================================================
-- 기본 데이터: 부스 설정과 메뉴
-- (가격·판매 여부·품절·남은 수량·세트 할인은 운영 중 관리자 화면에서 바꿉니다)
-- ============================================================
insert into public.booth_settings (id, booth_name, bank_name, account_holder, account_number, transfer_qr_url, is_open, set_discount)
values (true, 'BASAK WITCH', '국민은행', '원종훈', '95130200147672', null, true, 500);

insert into public.booth_menu_items (id, name, description, price, image_url, sold_out, active, sort_order, prep_speed, stock_remaining, category, alt_name) values
  ('b0030000-0000-4000-8000-000000000001', '크림브륄레 튀김산도', '', 4500, null, false, true, 10, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000002', '말차 튀김산도', '', 4000, null, false, true, 20, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000003', '초코 튀김산도', '', 4000, null, false, true, 30, 'normal', null, 'toast', null),
  ('b0030000-0000-4000-8000-000000000004', '아이스 아메리카노', '', 3000, null, false, true, 40, 'fast', null, 'drink', null),
  ('b0030000-0000-4000-8000-000000000005', '청귤에이드', '', 4000, null, false, true, 50, 'fast', null, 'drink', '청귤차');

-- 관리자 등록: Supabase Authentication에서 계정을 먼저 만든 뒤 적용됩니다.
insert into public.booth_admins (user_id)
select id from auth.users where email = 'ipad93920@gmail.com'
on conflict (user_id) do nothing;

-- ============================================================
-- 메뉴 사진 저장소(Storage)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('booth-menu-images', 'booth-menu-images', true)
on conflict (id) do update set public = excluded.public;

create policy booth_images_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'booth-menu-images');

create policy booth_images_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'booth-menu-images' and public.booth_is_admin());

create policy booth_images_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'booth-menu-images' and public.booth_is_admin())
with check (bucket_id = 'booth-menu-images' and public.booth_is_admin());

create policy booth_images_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'booth-menu-images' and public.booth_is_admin());

-- ============================================================
-- 실시간 대기열: 주문 상태가 바뀌면 손님·주방 화면에 바로 알림
-- ============================================================

alter publication supabase_realtime add table public.booth_public_queue;
