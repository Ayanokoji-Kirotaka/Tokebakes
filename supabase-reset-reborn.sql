-- TOKEBakes Reborn Reset
-- Full wipe + recreate for project objects (idempotent, destructive by design).
-- Run manually in Supabase SQL Editor.

BEGIN;

SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- Drop Project Objects (tables/functions/views/triggers/policies)
-- =========================================================

-- Functions and RPCs
DROP FUNCTION IF EXISTS public.get_site_state_snapshot() CASCADE;
DROP FUNCTION IF EXISTS public.get_site_stats_counts(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.get_site_stats_daily(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.get_site_stats(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.purge_site_events(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.log_site_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.can_access_admin_stats() CASCADE;
DROP FUNCTION IF EXISTS public.get_active_theme_public() CASCADE;
DROP FUNCTION IF EXISTS public.get_update_signal() CASCADE;
DROP FUNCTION IF EXISTS public.get_content_version() CASCADE;
DROP FUNCTION IF EXISTS public.bump_update_signal(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.bump_content_version() CASCADE;
DROP FUNCTION IF EXISTS public.site_last_updated() CASCADE;
DROP FUNCTION IF EXISTS public.touch_update_signal() CASCADE;
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.normalize_change_type(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.set_display_order_default() CASCADE;
DROP FUNCTION IF EXISTS public.normalize_display_order_conflicts() CASCADE;

-- Views (if present from older variants)
DROP VIEW IF EXISTS public.site_state_snapshot CASCADE;
DROP VIEW IF EXISTS public.site_stats_snapshot CASCADE;

-- Tables
DROP TABLE IF EXISTS public.product_option_values CASCADE;
DROP TABLE IF EXISTS public.product_option_groups CASCADE;
DROP TABLE IF EXISTS public.site_events CASCADE;
DROP TABLE IF EXISTS public.site_metadata CASCADE;
DROP TABLE IF EXISTS public.website_themes CASCADE;
DROP TABLE IF EXISTS public.hero_carousel CASCADE;
DROP TABLE IF EXISTS public.specials CASCADE;
DROP TABLE IF EXISTS public.featured_items CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.contact_messages CASCADE;
DROP TABLE IF EXISTS public.app_admins CASCADE;

-- Drop storage policies for this project if storage schema exists
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "tb_storage_public_read" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "tb_storage_admin_write" ON storage.objects';
  END IF;

  -- Do NOT delete rows from storage.objects/storage.buckets in SQL:
  -- Supabase protects storage metadata from direct DELETE (storage.protect_delete).
  -- If you need to purge files, use the Storage API/dashboard.
END;
$$;

-- =========================================================
-- Recreate Tables
-- =========================================================

CREATE TABLE public.app_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'owner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  image TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'pastries' CHECK (char_length(category) <= 50),
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  calories INTEGER CHECK (calories IS NULL OR calories >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.featured_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  menu_item_id UUID NULL REFERENCES public.menu_items(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NULL,
  end_date DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT featured_items_date_range_chk CHECK (
    start_date IS NULL
    OR end_date IS NULL
    OR end_date >= start_date
  )
);

CREATE TABLE public.specials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  alt TEXT NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 255),
  image_url TEXT NOT NULL CHECK (char_length(trim(image_url)) > 0),
  image TEXT NOT NULL CHECK (char_length(trim(image)) > 0),
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  original_price NUMERIC(12,2) NULL CHECK (original_price IS NULL OR original_price >= 0),
  is_special BOOLEAN NOT NULL DEFAULT false,
  badge_right_text TEXT NOT NULL DEFAULT 'SPECIAL'
    CHECK (char_length(trim(badge_right_text)) BETWEEN 1 AND 40),
  badge_right_icon TEXT NOT NULL DEFAULT chr(128293)
    CHECK (char_length(trim(badge_right_icon)) BETWEEN 1 AND 8),
  cta_label TEXT NOT NULL DEFAULT 'Order Now'
    CHECK (char_length(trim(cta_label)) BETWEEN 1 AND 40),
  is_active BOOLEAN NOT NULL DEFAULT true,
  width INTEGER NULL CHECK (width IS NULL OR width > 0),
  height INTEGER NULL CHECK (height IS NULL OR height > 0),
  file_size BIGINT NULL CHECK (file_size IS NULL OR file_size >= 0),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hero_carousel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alt TEXT NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 255),
  title TEXT NULL CHECK (title IS NULL OR char_length(title) <= 100),
  subtitle TEXT NULL,
  cta_text TEXT NULL CHECK (cta_text IS NULL OR char_length(cta_text) <= 50),
  cta_link TEXT NULL CHECK (cta_link IS NULL OR char_length(cta_link) <= 255),
  image TEXT NOT NULL,
  width INTEGER NULL CHECK (width IS NULL OR width > 0),
  height INTEGER NULL CHECK (height IS NULL OR height > 0),
  file_size BIGINT NULL CHECK (file_size IS NULL OR file_size >= 0),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.website_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_name TEXT NOT NULL UNIQUE,
  css_file TEXT NOT NULL UNIQUE,
  logo_file TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.product_option_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  type TEXT NOT NULL DEFAULT 'single' CHECK (type IN ('single', 'multiple')),
  required BOOLEAN NOT NULL DEFAULT false,
  max_selections INTEGER NULL CHECK (max_selections IS NULL OR max_selections > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.product_option_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  price_adjustment NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.site_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '0',
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_change_type TEXT NOT NULL DEFAULT 'all',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.site_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name ~ '^[a-z0-9_:-]{2,64}$'),
  page_path TEXT NULL,
  session_id TEXT NULL,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'admin', 'pwa', 'api', 'worker')),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.contact_messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name TEXT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  message TEXT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Update signal seed row (keeps tables otherwise empty)
INSERT INTO public.site_metadata (key, value, version, last_change_type, updated_at)
VALUES ('content_version', '0', 0, 'all', now())
ON CONFLICT (key) DO NOTHING;

-- =========================================================
-- Indexes
-- =========================================================

CREATE INDEX idx_menu_items_display_order ON public.menu_items(display_order ASC, created_at DESC);
CREATE INDEX idx_featured_items_display_order ON public.featured_items(display_order ASC, created_at DESC);
CREATE INDEX idx_featured_items_active ON public.featured_items(is_active, start_date, end_date);
CREATE INDEX idx_specials_display_order ON public.specials(display_order ASC, created_at DESC);
CREATE INDEX idx_specials_specials_active ON public.specials(is_active, display_order ASC);
CREATE INDEX idx_hero_carousel_display_order ON public.hero_carousel(display_order ASC, created_at DESC);
CREATE INDEX idx_hero_carousel_active ON public.hero_carousel(is_active, display_order ASC);
CREATE INDEX idx_product_option_groups_product ON public.product_option_groups(product_id, created_at ASC);
CREATE INDEX idx_product_option_values_group ON public.product_option_values(group_id, created_at ASC);
CREATE INDEX idx_site_metadata_updated ON public.site_metadata(updated_at DESC);
CREATE INDEX idx_site_events_created_at ON public.site_events(created_at DESC);
CREATE INDEX idx_site_events_event_created_at ON public.site_events(event_name, created_at DESC);
CREATE INDEX idx_site_events_session_id ON public.site_events(session_id);
CREATE INDEX idx_site_events_user_id ON public.site_events(user_id);
CREATE UNIQUE INDEX ux_website_themes_single_active
  ON public.website_themes((is_active))
  WHERE is_active = true;

-- =========================================================
-- Core Functions
-- =========================================================

CREATE OR REPLACE FUNCTION public.normalize_change_type(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(trim(p_raw), '')) IN ('menu_options', 'menu-options', 'menuoptions', 'option', 'options') THEN 'menu'
    WHEN lower(coalesce(trim(p_raw), '')) = 'gallery' THEN 'specials'
    WHEN lower(coalesce(trim(p_raw), '')) IN ('menu', 'featured', 'specials', 'carousel', 'theme', 'all') THEN lower(trim(p_raw))
    ELSE 'all'
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    current_user IN ('postgres', 'supabase_admin')
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.app_admins a
      WHERE a.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_display_order_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_order INTEGER;
BEGIN
  IF NEW.display_order IS NULL OR NEW.display_order < 0 THEN
    EXECUTE format(
      'SELECT COALESCE(MAX(display_order), -1) + 1 FROM public.%I',
      TG_TABLE_NAME
    )
    INTO next_order;
    NEW.display_order := GREATEST(COALESCE(next_order, 0), 0);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_display_order_conflicts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  EXECUTE format(
    'WITH ranked AS (
       SELECT id,
              row_number() OVER (
                ORDER BY COALESCE(display_order, 0) ASC, created_at ASC, id ASC
              ) - 1 AS new_order
       FROM public.%I
     )
     UPDATE public.%I t
     SET display_order = ranked.new_order
     FROM ranked
     WHERE t.id = ranked.id
       AND COALESCE(t.display_order, -1) <> ranked.new_order',
    TG_TABLE_NAME,
    TG_TABLE_NAME
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_update_signal(p_change_type TEXT DEFAULT 'all')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change_type TEXT := public.normalize_change_type(p_change_type);
  v_next BIGINT;
BEGIN
  INSERT INTO public.site_metadata (key, value, version, last_change_type, updated_at)
  VALUES ('content_version', '1', 1, v_change_type, now())
  ON CONFLICT (key)
  DO UPDATE SET
    version = GREATEST(public.site_metadata.version, 0) + 1,
    value = (GREATEST(public.site_metadata.version, 0) + 1)::TEXT,
    last_change_type = v_change_type,
    updated_at = now()
  RETURNING version INTO v_next;

  RETURN COALESCE(v_next, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_content_version()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.bump_update_signal('all');
$$;

CREATE OR REPLACE FUNCTION public.get_update_signal()
RETURNS TABLE (
  content_version BIGINT,
  last_change_type TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(sm.version, 0) AS content_version,
    public.normalize_change_type(sm.last_change_type) AS last_change_type,
    sm.updated_at
  FROM public.site_metadata sm
  WHERE sm.key = 'content_version'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_content_version()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT content_version FROM public.get_update_signal()), 0);
$$;

CREATE OR REPLACE FUNCTION public.site_last_updated()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE((SELECT max(updated_at) FROM public.menu_items), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.featured_items), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.specials), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.hero_carousel), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.website_themes), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.product_option_groups), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT max(updated_at) FROM public.product_option_values), 'epoch'::TIMESTAMPTZ),
    COALESCE((SELECT updated_at FROM public.site_metadata WHERE key = 'content_version'), 'epoch'::TIMESTAMPTZ)
  );
$$;

CREATE OR REPLACE FUNCTION public.touch_update_signal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change_type TEXT := 'all';
BEGIN
  IF TG_NARGS > 0 AND TG_ARGV[0] IS NOT NULL THEN
    v_change_type := public.normalize_change_type(TG_ARGV[0]);
  END IF;

  PERFORM public.bump_update_signal(v_change_type);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_theme_public()
RETURNS TABLE (
  theme_name TEXT,
  css_file TEXT,
  logo_file TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wt.theme_name,
    wt.css_file,
    wt.logo_file,
    wt.updated_at
  FROM public.website_themes wt
  WHERE wt.is_active = true
  ORDER BY wt.updated_at DESC NULLS LAST, wt.created_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_access_admin_stats()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.log_site_event(
  p_event_name TEXT,
  p_page_path TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'web',
  p_amount NUMERIC DEFAULT 0,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_source TEXT;
BEGIN
  IF p_event_name IS NULL OR btrim(p_event_name) = '' THEN
    RAISE EXCEPTION 'event_name is required' USING ERRCODE = '22023';
  END IF;

  IF lower(btrim(p_event_name)) !~ '^[a-z0-9_:-]{2,64}$' THEN
    RAISE EXCEPTION 'invalid event_name format' USING ERRCODE = '22023';
  END IF;

  v_source := lower(COALESCE(btrim(p_source), 'web'));
  IF v_source NOT IN ('web', 'admin', 'pwa', 'api', 'worker') THEN
    v_source := 'web';
  END IF;

  INSERT INTO public.site_events (
    event_name,
    page_path,
    session_id,
    user_id,
    source,
    amount,
    metadata
  )
  VALUES (
    lower(btrim(p_event_name)),
    NULLIF(left(COALESCE(p_page_path, ''), 512), ''),
    NULLIF(left(COALESCE(p_session_id, ''), 128), ''),
    auth.uid(),
    v_source,
    GREATEST(COALESCE(p_amount, 0), 0),
    COALESCE(p_metadata, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_site_stats(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := GREATEST(1, LEAST(COALESCE(p_days, 30), 3650));
  v_from TIMESTAMPTZ := now() - make_interval(days => v_days);
  v_payload JSONB;
BEGIN
  IF NOT public.can_access_admin_stats() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH event_totals AS (
    SELECT
      COUNT(*)::BIGINT AS total_events,
      COUNT(*) FILTER (WHERE event_name = 'page_view')::BIGINT AS page_views,
      COUNT(*) FILTER (WHERE event_name = 'menu_view')::BIGINT AS menu_views,
      COUNT(*) FILTER (WHERE event_name = 'add_to_cart')::BIGINT AS add_to_cart,
      COUNT(*) FILTER (WHERE event_name = 'order_now')::BIGINT AS order_now_clicks,
      COUNT(*) FILTER (WHERE event_name = 'order_submitted')::BIGINT AS orders_submitted,
      COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::BIGINT AS unique_sessions,
      COALESCE(SUM(amount) FILTER (WHERE event_name = 'order_submitted'), 0)::NUMERIC AS submitted_revenue
    FROM public.site_events
    WHERE created_at >= v_from
  ),
  top_events AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'event_name', t.event_name,
          'count', t.event_count
        )
        ORDER BY t.event_count DESC, t.event_name
      ),
      '[]'::JSONB
    ) AS rows
    FROM (
      SELECT
        se.event_name,
        COUNT(*)::BIGINT AS event_count
      FROM public.site_events se
      WHERE se.created_at >= v_from
      GROUP BY se.event_name
      ORDER BY event_count DESC, se.event_name
      LIMIT 10
    ) t
  ),
  core_totals AS (
    SELECT
      (SELECT COUNT(*)::BIGINT FROM public.menu_items) AS menu_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.menu_items WHERE is_available = true) AS menu_items_active,
      (SELECT COUNT(*)::BIGINT FROM public.featured_items) AS featured_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.featured_items WHERE is_active = true) AS featured_items_active,
      (SELECT COUNT(*)::BIGINT FROM public.specials) AS specials_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.hero_carousel) AS carousel_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.product_option_groups) AS option_groups_total,
      (SELECT COUNT(*)::BIGINT FROM public.product_option_values) AS option_values_total,
      (SELECT COUNT(*)::BIGINT FROM public.contact_messages WHERE is_read = false AND is_archived = false) AS unread_messages,
      (SELECT COALESCE(version, 0)::TEXT FROM public.site_metadata WHERE key = 'content_version' LIMIT 1) AS content_version,
      public.site_last_updated() AS site_last_updated
  )
  SELECT jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'core', jsonb_build_object(
      'menu_items_total', c.menu_items_total,
      'menu_items_active', c.menu_items_active,
      'featured_items_total', c.featured_items_total,
      'featured_items_active', c.featured_items_active,
      'specials_items_total', c.specials_items_total,
      'carousel_items_total', c.carousel_items_total,
      'option_groups_total', c.option_groups_total,
      'option_values_total', c.option_values_total,
      'unread_messages', c.unread_messages,
      'content_version', c.content_version,
      'site_last_updated', c.site_last_updated
    ),
    'events', jsonb_build_object(
      'total_events', e.total_events,
      'page_views', e.page_views,
      'menu_views', e.menu_views,
      'add_to_cart', e.add_to_cart,
      'order_now_clicks', e.order_now_clicks,
      'orders_submitted', e.orders_submitted,
      'unique_sessions', e.unique_sessions,
      'submitted_revenue', e.submitted_revenue
    ),
    'top_events', t.rows
  )
  INTO v_payload
  FROM event_totals e
  CROSS JOIN core_totals c
  CROSS JOIN top_events t;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_site_stats_daily(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  day DATE,
  total_events BIGINT,
  page_views BIGINT,
  menu_views BIGINT,
  add_to_cart BIGINT,
  order_now_clicks BIGINT,
  orders_submitted BIGINT,
  submitted_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := GREATEST(1, LEAST(COALESCE(p_days, 30), 3650));
  v_from TIMESTAMPTZ := now() - make_interval(days => v_days);
BEGIN
  IF NOT public.can_access_admin_stats() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('day', se.created_at)::DATE AS day,
    COUNT(*)::BIGINT AS total_events,
    COUNT(*) FILTER (WHERE se.event_name = 'page_view')::BIGINT AS page_views,
    COUNT(*) FILTER (WHERE se.event_name = 'menu_view')::BIGINT AS menu_views,
    COUNT(*) FILTER (WHERE se.event_name = 'add_to_cart')::BIGINT AS add_to_cart,
    COUNT(*) FILTER (WHERE se.event_name = 'order_now')::BIGINT AS order_now_clicks,
    COUNT(*) FILTER (WHERE se.event_name = 'order_submitted')::BIGINT AS orders_submitted,
    COALESCE(SUM(se.amount) FILTER (WHERE se.event_name = 'order_submitted'), 0)::NUMERIC AS submitted_revenue
  FROM public.site_events se
  WHERE se.created_at >= v_from
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_site_stats_counts(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  window_days INTEGER,
  menu_items_total BIGINT,
  menu_items_active BIGINT,
  featured_items_total BIGINT,
  featured_items_active BIGINT,
  specials_items_total BIGINT,
  carousel_items_total BIGINT,
  option_groups_total BIGINT,
  option_values_total BIGINT,
  unread_messages BIGINT,
  total_events BIGINT,
  page_views BIGINT,
  menu_views BIGINT,
  add_to_cart BIGINT,
  order_now_clicks BIGINT,
  orders_submitted BIGINT,
  unique_sessions BIGINT,
  submitted_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j JSONB;
BEGIN
  IF NOT public.can_access_admin_stats() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  j := public.get_site_stats(p_days);

  RETURN QUERY
  SELECT
    COALESCE((j->>'window_days')::INTEGER, p_days),
    COALESCE((j->'core'->>'menu_items_total')::BIGINT, 0),
    COALESCE((j->'core'->>'menu_items_active')::BIGINT, 0),
    COALESCE((j->'core'->>'featured_items_total')::BIGINT, 0),
    COALESCE((j->'core'->>'featured_items_active')::BIGINT, 0),
    COALESCE((j->'core'->>'specials_items_total')::BIGINT, 0),
    COALESCE((j->'core'->>'carousel_items_total')::BIGINT, 0),
    COALESCE((j->'core'->>'option_groups_total')::BIGINT, 0),
    COALESCE((j->'core'->>'option_values_total')::BIGINT, 0),
    COALESCE((j->'core'->>'unread_messages')::BIGINT, 0),
    COALESCE((j->'events'->>'total_events')::BIGINT, 0),
    COALESCE((j->'events'->>'page_views')::BIGINT, 0),
    COALESCE((j->'events'->>'menu_views')::BIGINT, 0),
    COALESCE((j->'events'->>'add_to_cart')::BIGINT, 0),
    COALESCE((j->'events'->>'order_now_clicks')::BIGINT, 0),
    COALESCE((j->'events'->>'orders_submitted')::BIGINT, 0),
    COALESCE((j->'events'->>'unique_sessions')::BIGINT, 0),
    COALESCE((j->'events'->>'submitted_revenue')::NUMERIC, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_site_events(p_keep_days INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep_days INTEGER := GREATEST(1, LEAST(COALESCE(p_keep_days, 180), 3650));
  v_deleted INTEGER;
BEGIN
  IF NOT public.can_access_admin_stats() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.site_events
  WHERE created_at < now() - make_interval(days => v_keep_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_site_state_snapshot()
RETURNS TABLE (
  content_version BIGINT,
  last_change_type TEXT,
  signal_updated_at TIMESTAMPTZ,
  menu_last_updated_at TIMESTAMPTZ,
  featured_last_updated_at TIMESTAMPTZ,
  specials_last_updated_at TIMESTAMPTZ,
  carousel_last_updated_at TIMESTAMPTZ,
  themes_last_updated_at TIMESTAMPTZ,
  options_last_updated_at TIMESTAMPTZ,
  site_last_updated_at TIMESTAMPTZ,
  active_theme_name TEXT,
  active_theme_css_file TEXT,
  active_theme_logo_file TEXT,
  last_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access_admin_stats() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH signal AS (
    SELECT
      COALESCE(sm.version, 0) AS content_version,
      public.normalize_change_type(sm.last_change_type) AS last_change_type,
      sm.updated_at AS signal_updated_at
    FROM public.site_metadata sm
    WHERE sm.key = 'content_version'
    LIMIT 1
  ),
  theme AS (
    SELECT
      wt.theme_name,
      wt.css_file,
      wt.logo_file
    FROM public.website_themes wt
    WHERE wt.is_active = true
    ORDER BY wt.updated_at DESC NULLS LAST, wt.created_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    COALESCE(s.content_version, 0) AS content_version,
    COALESCE(s.last_change_type, 'all') AS last_change_type,
    s.signal_updated_at,
    (SELECT max(updated_at) FROM public.menu_items) AS menu_last_updated_at,
    (SELECT max(updated_at) FROM public.featured_items) AS featured_last_updated_at,
    (SELECT max(updated_at) FROM public.specials) AS specials_last_updated_at,
    (SELECT max(updated_at) FROM public.hero_carousel) AS carousel_last_updated_at,
    (SELECT max(updated_at) FROM public.website_themes) AS themes_last_updated_at,
    GREATEST(
      COALESCE((SELECT max(updated_at) FROM public.product_option_groups), 'epoch'::TIMESTAMPTZ),
      COALESCE((SELECT max(updated_at) FROM public.product_option_values), 'epoch'::TIMESTAMPTZ)
    ) AS options_last_updated_at,
    public.site_last_updated() AS site_last_updated_at,
    t.theme_name AS active_theme_name,
    t.css_file AS active_theme_css_file,
    t.logo_file AS active_theme_logo_file,
    public.site_last_updated() AS last_updated_at
  FROM signal s
  FULL OUTER JOIN theme t ON true
  LIMIT 1;
END;
$$;

-- =========================================================
-- Triggers
-- =========================================================

-- updated_at triggers
CREATE TRIGGER set_updated_at_menu_items
BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_featured_items
BEFORE UPDATE ON public.featured_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_specials
BEFORE UPDATE ON public.specials
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_hero_carousel
BEFORE UPDATE ON public.hero_carousel
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_website_themes
BEFORE UPDATE ON public.website_themes
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_option_groups
BEFORE UPDATE ON public.product_option_groups
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_option_values
BEFORE UPDATE ON public.product_option_values
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_site_metadata
BEFORE UPDATE ON public.site_metadata
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_contact_messages
BEFORE UPDATE ON public.contact_messages
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- display_order auto-default + normalization
CREATE TRIGGER set_display_order_default_menu_items
BEFORE INSERT ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.set_display_order_default();

CREATE TRIGGER set_display_order_default_featured_items
BEFORE INSERT ON public.featured_items
FOR EACH ROW EXECUTE FUNCTION public.set_display_order_default();

CREATE TRIGGER set_display_order_default_specials
BEFORE INSERT ON public.specials
FOR EACH ROW EXECUTE FUNCTION public.set_display_order_default();

CREATE TRIGGER set_display_order_default_hero_carousel
BEFORE INSERT ON public.hero_carousel
FOR EACH ROW EXECUTE FUNCTION public.set_display_order_default();

CREATE TRIGGER normalize_display_order_menu_items
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH STATEMENT EXECUTE FUNCTION public.normalize_display_order_conflicts();

CREATE TRIGGER normalize_display_order_featured_items
AFTER INSERT OR UPDATE OR DELETE ON public.featured_items
FOR EACH STATEMENT EXECUTE FUNCTION public.normalize_display_order_conflicts();

CREATE TRIGGER normalize_display_order_specials
AFTER INSERT OR UPDATE OR DELETE ON public.specials
FOR EACH STATEMENT EXECUTE FUNCTION public.normalize_display_order_conflicts();

CREATE TRIGGER normalize_display_order_hero_carousel
AFTER INSERT OR UPDATE OR DELETE ON public.hero_carousel
FOR EACH STATEMENT EXECUTE FUNCTION public.normalize_display_order_conflicts();

-- update signal triggers
CREATE TRIGGER trg_menu_items_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('menu');

CREATE TRIGGER trg_featured_items_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.featured_items
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('featured');

CREATE TRIGGER trg_specials_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.specials
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('specials');

CREATE TRIGGER trg_hero_carousel_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.hero_carousel
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('carousel');

CREATE TRIGGER trg_website_themes_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.website_themes
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('theme');

CREATE TRIGGER trg_option_groups_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_groups
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('menu');

CREATE TRIGGER trg_option_values_update_signal
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_values
FOR EACH STATEMENT EXECUTE FUNCTION public.touch_update_signal('menu');

-- =========================================================
-- RLS + Policies
-- =========================================================

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_carousel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- app_admins
CREATE POLICY app_admins_read_self_or_admin
ON public.app_admins
FOR SELECT
TO authenticated
USING (public.is_admin() OR user_id = auth.uid());

CREATE POLICY app_admins_admin_all
ON public.app_admins
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- menu_items
CREATE POLICY menu_items_public_read
ON public.menu_items
FOR SELECT
TO anon, authenticated
USING (is_available = true);

CREATE POLICY menu_items_admin_all
ON public.menu_items
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- featured_items
CREATE POLICY featured_items_public_read
ON public.featured_items
FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY featured_items_admin_all
ON public.featured_items
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- specials
CREATE POLICY specials_public_read
ON public.specials
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY specials_admin_all
ON public.specials
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- hero_carousel
CREATE POLICY hero_carousel_public_read
ON public.hero_carousel
FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY hero_carousel_admin_all
ON public.hero_carousel
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- website_themes
CREATE POLICY website_themes_public_active_read
ON public.website_themes
FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY website_themes_admin_all
ON public.website_themes
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- product options
CREATE POLICY product_option_groups_public_read
ON public.product_option_groups
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_items m
    WHERE m.id = product_option_groups.product_id
      AND m.is_available = true
  )
);

CREATE POLICY product_option_groups_admin_all
ON public.product_option_groups
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY product_option_values_public_read
ON public.product_option_values
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.product_option_groups g
    JOIN public.menu_items m ON m.id = g.product_id
    WHERE g.id = product_option_values.group_id
      AND m.is_available = true
  )
);

CREATE POLICY product_option_values_admin_all
ON public.product_option_values
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- site_metadata
CREATE POLICY site_metadata_public_read_signal
ON public.site_metadata
FOR SELECT
TO anon, authenticated
USING (key = 'content_version');

CREATE POLICY site_metadata_admin_all
ON public.site_metadata
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- site_events (read/delete only for admin via table; inserts go through RPC)
CREATE POLICY site_events_admin_read
ON public.site_events
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY site_events_admin_delete
ON public.site_events
FOR DELETE
TO authenticated
USING (public.is_admin());

-- contact_messages (admin only)
CREATE POLICY contact_messages_admin_all
ON public.contact_messages
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- =========================================================
-- Storage Buckets + Policies (Supabase storage schema)
-- =========================================================

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES
      ('featured-items', 'featured-items', true),
      ('menu-items', 'menu-items', true),
      ('specials', 'specials', true),
      ('hero-carousel', 'hero-carousel', true)
    ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        name = EXCLUDED.name;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "tb_storage_public_read" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "tb_storage_admin_write" ON storage.objects';

    EXECUTE $policy$
      CREATE POLICY "tb_storage_public_read"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id IN ('featured-items', 'menu-items', 'specials', 'hero-carousel'))
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "tb_storage_admin_write"
      ON storage.objects
      FOR ALL
      TO authenticated
      USING (
        bucket_id IN ('featured-items', 'menu-items', 'specials', 'hero-carousel')
        AND public.is_admin()
      )
      WITH CHECK (
        bucket_id IN ('featured-items', 'menu-items', 'specials', 'hero-carousel')
        AND public.is_admin()
      )
    $policy$;
  END IF;
END;
$$;

-- =========================================================
-- Grants
-- =========================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.menu_items TO anon, authenticated;
GRANT SELECT ON public.featured_items TO anon, authenticated;
GRANT SELECT ON public.specials TO anon, authenticated;
GRANT SELECT ON public.hero_carousel TO anon, authenticated;
GRANT SELECT ON public.website_themes TO anon, authenticated;
GRANT SELECT ON public.product_option_groups TO anon, authenticated;
GRANT SELECT ON public.product_option_values TO anon, authenticated;
GRANT SELECT ON public.site_metadata TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.featured_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.specials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hero_carousel TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_themes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_metadata TO authenticated;
GRANT SELECT, DELETE ON public.site_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_messages TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_update_signal() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_content_version() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_update_signal(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_content_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.site_last_updated() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_theme_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_site_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_stats(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_stats_daily(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_stats_counts(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_site_events(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_state_snapshot() TO authenticated;

COMMIT;

-- =========================================================
-- Verification Queries (run after COMMIT)
-- =========================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'app_admins',
    'menu_items',
    'featured_items',
    'specials',
    'hero_carousel',
    'website_themes',
    'product_option_groups',
    'product_option_values',
    'site_metadata',
    'site_events',
    'contact_messages'
  )
ORDER BY table_name;

SELECT 'app_admins' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.app_admins
UNION ALL SELECT 'menu_items', COUNT(*)::BIGINT FROM public.menu_items
UNION ALL SELECT 'featured_items', COUNT(*)::BIGINT FROM public.featured_items
UNION ALL SELECT 'specials', COUNT(*)::BIGINT FROM public.specials
UNION ALL SELECT 'hero_carousel', COUNT(*)::BIGINT FROM public.hero_carousel
UNION ALL SELECT 'website_themes', COUNT(*)::BIGINT FROM public.website_themes
UNION ALL SELECT 'product_option_groups', COUNT(*)::BIGINT FROM public.product_option_groups
UNION ALL SELECT 'product_option_values', COUNT(*)::BIGINT FROM public.product_option_values
UNION ALL SELECT 'site_events', COUNT(*)::BIGINT FROM public.site_events
UNION ALL SELECT 'contact_messages', COUNT(*)::BIGINT FROM public.contact_messages
ORDER BY table_name;

SELECT * FROM public.get_update_signal();

-- Optional first-time bootstrap examples (commented out by default):
-- 1) Add your admin user UUID:
-- INSERT INTO public.app_admins (user_id, role) VALUES ('YOUR_AUTH_USER_UUID', 'owner');
--
-- 2) Set an initial active theme:
-- INSERT INTO public.website_themes (theme_name, css_file, logo_file, is_active)
-- VALUES ('Default', 'styles/style.css', 'images/logo.webp', true);

