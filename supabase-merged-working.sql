-- ============================================
-- TOKE BAKES UNIFIED SQL (PRODUCTION-SAFE)
-- Combines:
-- 1) content version sync / freshness
-- 2) site event logging + admin stats RPCs
-- Non-destructive and idempotent.
-- ============================================

BEGIN;

SET search_path = public;

-- ============================================
-- CONTENT VERSION + FRESHNESS CORE
-- ============================================

CREATE TABLE IF NOT EXISTS public.site_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_metadata
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

INSERT INTO public.site_metadata (key, value, updated_at)
VALUES ('content_version', '1', now())
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(NULLIF(public.site_metadata.value, ''), '1'),
    updated_at = now();

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_content_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.site_metadata (key, value, updated_at)
  VALUES ('content_version', '1', now())
  ON CONFLICT (key)
  DO UPDATE SET
    value = (
      COALESCE(
        NULLIF(regexp_replace(public.site_metadata.value, '[^0-9]', '', 'g'), ''),
        '0'
      )::BIGINT + 1
    )::TEXT,
    updated_at = now();

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_content_version()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT COALESCE(
        NULLIF(regexp_replace(sm.value, '[^0-9]', '', 'g'), ''),
        '0'
      )::BIGINT
      FROM public.site_metadata sm
      WHERE sm.key = 'content_version'
      LIMIT 1
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.site_last_updated()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    COALESCE((SELECT max(updated_at) FROM public.menu_items), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.featured_items), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.gallery), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.hero_carousel), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.website_themes), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.product_option_groups), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.product_option_values), 'epoch'::timestamptz),
    COALESCE((SELECT max(updated_at) FROM public.site_metadata WHERE key = 'content_version'), 'epoch'::timestamptz)
  );
$$;

DO $$
BEGIN
  IF to_regclass('public.menu_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_menu ON public.menu_items;
    CREATE TRIGGER set_updated_at_menu
    BEFORE UPDATE ON public.menu_items
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_menu_items_bump_content_version ON public.menu_items;
    CREATE TRIGGER trg_menu_items_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.featured_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_featured ON public.featured_items;
    CREATE TRIGGER set_updated_at_featured
    BEFORE UPDATE ON public.featured_items
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_featured_items_bump_content_version ON public.featured_items;
    CREATE TRIGGER trg_featured_items_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.featured_items
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.gallery') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_gallery ON public.gallery;
    CREATE TRIGGER set_updated_at_gallery
    BEFORE UPDATE ON public.gallery
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_gallery_bump_content_version ON public.gallery;
    CREATE TRIGGER trg_gallery_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.gallery
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.hero_carousel') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_hero ON public.hero_carousel;
    CREATE TRIGGER set_updated_at_hero
    BEFORE UPDATE ON public.hero_carousel
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_hero_carousel_bump_content_version ON public.hero_carousel;
    CREATE TRIGGER trg_hero_carousel_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.hero_carousel
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.website_themes') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_theme ON public.website_themes;
    CREATE TRIGGER set_updated_at_theme
    BEFORE UPDATE ON public.website_themes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_website_themes_bump_content_version ON public.website_themes;
    CREATE TRIGGER trg_website_themes_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.website_themes
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.product_option_groups') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_product_option_groups ON public.product_option_groups;
    CREATE TRIGGER set_updated_at_product_option_groups
    BEFORE UPDATE ON public.product_option_groups
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_product_option_groups_bump_content_version ON public.product_option_groups;
    CREATE TRIGGER trg_product_option_groups_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.product_option_groups
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.product_option_values') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_product_option_values ON public.product_option_values;
    CREATE TRIGGER set_updated_at_product_option_values
    BEFORE UPDATE ON public.product_option_values
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

    DROP TRIGGER IF EXISTS trg_product_option_values_bump_content_version ON public.product_option_values;
    CREATE TRIGGER trg_product_option_values_bump_content_version
    AFTER INSERT OR UPDATE OR DELETE ON public.product_option_values
    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();
  END IF;

  IF to_regclass('public.site_metadata') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_site_metadata ON public.site_metadata;
    CREATE TRIGGER set_updated_at_site_metadata
    BEFORE UPDATE ON public.site_metadata
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_site_metadata_key
  ON public.site_metadata(key);

ALTER TABLE IF EXISTS public.site_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_metadata_public_read_policy" ON public.site_metadata;
CREATE POLICY "site_metadata_public_read_policy"
ON public.site_metadata
FOR SELECT
USING (key = 'content_version');

DROP POLICY IF EXISTS "site_metadata_admin_policy" ON public.site_metadata;
CREATE POLICY "site_metadata_admin_policy"
ON public.site_metadata
FOR ALL
TO authenticated
USING (
  current_user IN ('postgres', 'supabase_admin')
  OR EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  )
)
WITH CHECK (
  current_user IN ('postgres', 'supabase_admin')
  OR EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  )
);

GRANT EXECUTE ON FUNCTION public.site_last_updated() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_content_version() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_content_version() TO authenticated;

-- ============================================
-- SITE EVENTS + ADMIN STATS
-- ============================================

CREATE TABLE IF NOT EXISTS public.site_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name ~ '^[a-z0-9_:-]{2,64}$'),
  page_path TEXT,
  session_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'admin', 'pwa', 'api', 'worker')),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_events_created_at
  ON public.site_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_events_event_created_at
  ON public.site_events(event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_events_session_id
  ON public.site_events(session_id);

CREATE INDEX IF NOT EXISTS idx_site_events_user_id
  ON public.site_events(user_id);

CREATE OR REPLACE FUNCTION public.can_access_admin_stats()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    current_user IN ('postgres', 'supabase_admin')
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.app_admins a
      WHERE a.user_id = auth.uid()
    )
  );
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
      (SELECT COUNT(*)::BIGINT FROM public.gallery) AS gallery_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.hero_carousel) AS carousel_items_total,
      (SELECT COUNT(*)::BIGINT FROM public.product_option_groups) AS option_groups_total,
      (SELECT COUNT(*)::BIGINT FROM public.product_option_values) AS option_values_total,
      (SELECT COUNT(*)::BIGINT FROM public.contact_messages WHERE is_read = false AND is_archived = false) AS unread_messages,
      (SELECT COALESCE(value, '0') FROM public.site_metadata WHERE key = 'content_version' LIMIT 1) AS content_version,
      GREATEST(
        COALESCE((SELECT max(updated_at) FROM public.menu_items), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.featured_items), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.gallery), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.hero_carousel), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.website_themes), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.product_option_groups), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.product_option_values), 'epoch'::TIMESTAMPTZ),
        COALESCE((SELECT max(updated_at) FROM public.site_metadata WHERE key = 'content_version'), 'epoch'::TIMESTAMPTZ)
      ) AS site_last_updated
  )
  SELECT jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'core', jsonb_build_object(
      'menu_items_total', c.menu_items_total,
      'menu_items_active', c.menu_items_active,
      'featured_items_total', c.featured_items_total,
      'featured_items_active', c.featured_items_active,
      'gallery_items_total', c.gallery_items_total,
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
  gallery_items_total BIGINT,
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
    COALESCE((j->'core'->>'gallery_items_total')::BIGINT, 0),
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

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_events_admin_read" ON public.site_events;
CREATE POLICY "site_events_admin_read"
ON public.site_events
FOR SELECT
TO authenticated
USING (
  current_user IN ('postgres', 'supabase_admin')
  OR EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "site_events_admin_delete" ON public.site_events;
CREATE POLICY "site_events_admin_delete"
ON public.site_events
FOR DELETE
TO authenticated
USING (
  current_user IN ('postgres', 'supabase_admin')
  OR EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.site_events FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_site_event(TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_site_stats(INTEGER)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_site_stats_daily(INTEGER)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_site_stats_counts(INTEGER)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.purge_site_events(INTEGER)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_access_admin_stats()
TO authenticated;

COMMIT;

