-- ============================================
-- TOKE BAKES SUPABASE MASTER RESET
-- Combines: supabase-setup.sql + supabase-product-configurator-migration.sql
-- Safe to run in Supabase SQL Editor (full project reset)
-- ============================================

BEGIN;

SET search_path = public;

-- ============================================
-- ADMIN ACCOUNT PRESERVATION
-- ============================================
-- Preserve current admin users across reset.
CREATE TEMP TABLE _app_admins_backup (
  user_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ
) ON COMMIT DROP;

DO $$
BEGIN
  IF to_regclass('public.app_admins') IS NOT NULL THEN
    INSERT INTO _app_admins_backup (user_id, created_at)
    SELECT a.user_id, a.created_at
    FROM public.app_admins a
    JOIN auth.users u ON u.id = a.user_id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END
$$;

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- FULL RESET (PROJECT OBJECTS)
-- ============================================

-- Drop project functions first to avoid signature/return-type conflicts.
DROP FUNCTION IF EXISTS public.bump_content_version() CASCADE;
DROP FUNCTION IF EXISTS public.get_content_version() CASCADE;
DROP FUNCTION IF EXISTS public.site_last_updated() CASCADE;
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;

-- Drop project tables (CASCADE removes triggers, policies, indexes, FKs).
DROP TABLE IF EXISTS public.product_option_values CASCADE;
DROP TABLE IF EXISTS public.product_option_groups CASCADE;
DROP TABLE IF EXISTS public.site_metadata CASCADE;
DROP TABLE IF EXISTS public.contact_messages CASCADE;
DROP TABLE IF EXISTS public.website_themes CASCADE;
DROP TABLE IF EXISTS public.hero_carousel CASCADE;
DROP TABLE IF EXISTS public.gallery CASCADE;
DROP TABLE IF EXISTS public.featured_items CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.app_admins CASCADE;

-- NOTE:
-- Supabase blocks direct SQL deletes on storage.objects/storage.buckets
-- (storage.protect_delete). Keep storage reset outside SQL via Storage API
-- or Dashboard bucket actions (empty/delete), then rerun this script.

-- ============================================
-- STORAGE SETUP
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
 ('menu-items','menu-items',true,2097152,'{"image/webp","image/avif","image/jpeg","image/png"}'),
 ('featured-items','featured-items',true,2097152,'{"image/webp","image/avif","image/jpeg","image/png"}'),
 ('gallery','gallery',true,5242880,'{"image/webp","image/avif","image/jpeg","image/png"}'),
 ('hero-carousel','hero-carousel',true,5242880,'{"image/webp","image/avif","image/jpeg","image/png"}')
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read access for storage" ON storage.objects;
CREATE POLICY "Public read access for storage"
ON storage.objects FOR SELECT
USING (bucket_id IN ('menu-items','featured-items','gallery','hero-carousel'));

DROP POLICY IF EXISTS "Authenticated upload access" ON storage.objects;
CREATE POLICY "Authenticated upload access"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id IN ('menu-items','featured-items','gallery','hero-carousel')
  AND auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Authenticated update access" ON storage.objects;
CREATE POLICY "Authenticated update access"
ON storage.objects FOR UPDATE
USING (
  bucket_id IN ('menu-items','featured-items','gallery','hero-carousel')
  AND auth.role() = 'authenticated'
)
WITH CHECK (
  bucket_id IN ('menu-items','featured-items','gallery','hero-carousel')
  AND auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Authenticated delete access" ON storage.objects;
CREATE POLICY "Authenticated delete access"
ON storage.objects FOR DELETE
USING (
  bucket_id IN ('menu-items','featured-items','gallery','hero-carousel')
  AND auth.role() = 'authenticated'
);

-- ============================================
-- CORE TABLES
-- ============================================

CREATE TABLE public.app_admins(
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_admins (user_id, created_at)
SELECT b.user_id, COALESCE(b.created_at, now())
FROM _app_admins_backup b
JOIN auth.users u ON u.id = b.user_id
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE public.menu_items(
 id BIGSERIAL PRIMARY KEY,
 title VARCHAR(100) NOT NULL,
 description TEXT NOT NULL,
 price NUMERIC NOT NULL CHECK(price >= 0),
 image VARCHAR(255) NOT NULL,
 is_available BOOLEAN NOT NULL DEFAULT true,
 category VARCHAR(50) NOT NULL DEFAULT 'pastries',
 tags TEXT[] NOT NULL DEFAULT '{}',
 display_order SMALLINT NOT NULL DEFAULT 0 CHECK(display_order >= 0),
 calories SMALLINT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.featured_items(
 id BIGSERIAL PRIMARY KEY,
 title VARCHAR(100) NOT NULL,
 description TEXT NOT NULL,
 image VARCHAR(255) NOT NULL,
 menu_item_id BIGINT REFERENCES public.menu_items(id) ON DELETE SET NULL,
 display_order SMALLINT NOT NULL DEFAULT 0 CHECK(display_order >= 0),
 is_active BOOLEAN NOT NULL DEFAULT true,
 start_date DATE NOT NULL DEFAULT CURRENT_DATE,
 end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT featured_items_date_range_check CHECK (end_date >= start_date)
);

CREATE TABLE public.gallery(
 id BIGSERIAL PRIMARY KEY,
 alt VARCHAR(255) NOT NULL,
 image VARCHAR(255) NOT NULL,
 width SMALLINT,
 height SMALLINT,
 file_size INTEGER,
 display_order SMALLINT NOT NULL DEFAULT 0 CHECK(display_order >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hero_carousel(
 id BIGSERIAL PRIMARY KEY,
 alt VARCHAR(255) NOT NULL,
 image VARCHAR(255) NOT NULL,
 title VARCHAR(100),
 subtitle TEXT,
 cta_text VARCHAR(50),
 cta_link VARCHAR(255),
 display_order SMALLINT NOT NULL DEFAULT 0 CHECK(display_order >= 0),
 is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.website_themes(
 id SMALLSERIAL PRIMARY KEY,
 theme_name VARCHAR(50) UNIQUE NOT NULL,
 css_file VARCHAR(255) UNIQUE NOT NULL,
 logo_file VARCHAR(255),
 is_active BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.contact_messages(
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(100) NOT NULL,
 email VARCHAR(255) NOT NULL,
 subject VARCHAR(200),
 message TEXT NOT NULL,
 is_read BOOLEAN NOT NULL DEFAULT false,
 is_archived BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- PRODUCT CONFIGURATOR TABLES
-- ============================================

CREATE TABLE public.product_option_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  type TEXT NOT NULL DEFAULT 'single' CHECK (type IN ('single', 'multiple')),
  required BOOLEAN NOT NULL DEFAULT false,
  max_selections INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_option_groups_max_selections_check
    CHECK (max_selections IS NULL OR max_selections > 0),
  CONSTRAINT product_option_groups_single_type_max_check
    CHECK (type = 'multiple' OR max_selections IS NULL)
);

CREATE TABLE public.product_option_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  price_adjustment NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CONTENT VERSIONING / FRESHNESS
-- ============================================

CREATE TABLE public.site_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.site_metadata (key, value, updated_at)
VALUES ('content_version', '1', now())
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  updated_at = now();

-- ============================================
-- FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins
    WHERE user_id = auth.uid()
  );
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

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS set_updated_at_menu ON public.menu_items;
CREATE TRIGGER set_updated_at_menu
BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_featured ON public.featured_items;
CREATE TRIGGER set_updated_at_featured
BEFORE UPDATE ON public.featured_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_gallery ON public.gallery;
CREATE TRIGGER set_updated_at_gallery
BEFORE UPDATE ON public.gallery
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_hero ON public.hero_carousel;
CREATE TRIGGER set_updated_at_hero
BEFORE UPDATE ON public.hero_carousel
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_theme ON public.website_themes;
CREATE TRIGGER set_updated_at_theme
BEFORE UPDATE ON public.website_themes
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_product_option_groups ON public.product_option_groups;
CREATE TRIGGER set_updated_at_product_option_groups
BEFORE UPDATE ON public.product_option_groups
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_product_option_values ON public.product_option_values;
CREATE TRIGGER set_updated_at_product_option_values
BEFORE UPDATE ON public.product_option_values
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_site_metadata ON public.site_metadata;
CREATE TRIGGER set_updated_at_site_metadata
BEFORE UPDATE ON public.site_metadata
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- content version bumps
CREATE TRIGGER trg_menu_items_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_featured_items_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.featured_items
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_gallery_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.gallery
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_hero_carousel_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.hero_carousel
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_website_themes_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.website_themes
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_product_option_groups_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_groups
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

CREATE TRIGGER trg_product_option_values_bump_content_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_values
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_content_version();

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_menu_items_available
ON public.menu_items(is_available, display_order, created_at DESC)
WHERE is_available = true;

CREATE INDEX idx_featured_items_active
ON public.featured_items(is_active, start_date, end_date, display_order, created_at DESC)
WHERE is_active = true;

CREATE INDEX idx_gallery_order
ON public.gallery(display_order, created_at DESC);

CREATE INDEX idx_hero_carousel_active
ON public.hero_carousel(is_active, display_order)
WHERE is_active = true;

CREATE UNIQUE INDEX idx_website_themes_active
ON public.website_themes(is_active)
WHERE is_active = true;

CREATE INDEX idx_contact_messages_unread
ON public.contact_messages(is_read, created_at DESC)
WHERE is_read = false AND is_archived = false;

CREATE INDEX idx_product_option_groups_product_id
ON public.product_option_groups(product_id);

CREATE INDEX idx_product_option_values_group_id
ON public.product_option_values(group_id);

CREATE INDEX idx_site_metadata_key
ON public.site_metadata(key);

-- ============================================
-- BASE THEME ROWS
-- ============================================
INSERT INTO public.website_themes (theme_name, css_file, logo_file, is_active)
VALUES
  ('Default', 'styles/style.css', 'images/logo.webp', true),
  ('Valentine', 'styles/theme-valentine.css', 'images/valantine-logo.webp', false),
  ('Ramadan', 'styles/theme-ramadan.css', 'images/ramadan-logo.webp', false),
  ('Halloween', 'styles/theme-halloween.css', 'images/halloween-logo.webp', false),
  ('Independence Day', 'styles/theme-independenceday.css', 'images/independence-day-logo.webp', false),
  ('Christmas', 'styles/theme-christmas.css', 'images/christmas-logo.webp', false)
ON CONFLICT (theme_name) DO UPDATE
SET
  css_file = EXCLUDED.css_file,
  logo_file = EXCLUDED.logo_file,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ============================================
-- RLS + POLICIES
-- ============================================

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_carousel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_items_select_policy" ON public.menu_items;
CREATE POLICY "menu_items_select_policy"
ON public.menu_items
FOR SELECT
USING (is_available = true);

DROP POLICY IF EXISTS "featured_items_select_policy" ON public.featured_items;
CREATE POLICY "featured_items_select_policy"
ON public.featured_items
FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "gallery_select_policy" ON public.gallery;
CREATE POLICY "gallery_select_policy"
ON public.gallery
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "hero_carousel_select_policy" ON public.hero_carousel;
CREATE POLICY "hero_carousel_select_policy"
ON public.hero_carousel
FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "website_themes_select_policy" ON public.website_themes;
CREATE POLICY "website_themes_select_policy"
ON public.website_themes
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "product_option_groups_select_policy" ON public.product_option_groups;
CREATE POLICY "product_option_groups_select_policy"
ON public.product_option_groups
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.menu_items mi
    WHERE mi.id = product_option_groups.product_id
      AND mi.is_available = true
  )
);

DROP POLICY IF EXISTS "product_option_values_select_policy" ON public.product_option_values;
CREATE POLICY "product_option_values_select_policy"
ON public.product_option_values
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.product_option_groups pog
    JOIN public.menu_items mi ON mi.id = pog.product_id
    WHERE pog.id = product_option_values.group_id
      AND mi.is_available = true
  )
);

DROP POLICY IF EXISTS "site_metadata_public_read_policy" ON public.site_metadata;
CREATE POLICY "site_metadata_public_read_policy"
ON public.site_metadata
FOR SELECT
USING (key = 'content_version');

DROP POLICY IF EXISTS "menu_items_admin_policy" ON public.menu_items;
CREATE POLICY "menu_items_admin_policy"
ON public.menu_items
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "featured_items_admin_policy" ON public.featured_items;
CREATE POLICY "featured_items_admin_policy"
ON public.featured_items
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "gallery_admin_policy" ON public.gallery;
CREATE POLICY "gallery_admin_policy"
ON public.gallery
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "hero_carousel_admin_policy" ON public.hero_carousel;
CREATE POLICY "hero_carousel_admin_policy"
ON public.hero_carousel
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "website_themes_admin_policy" ON public.website_themes;
CREATE POLICY "website_themes_admin_policy"
ON public.website_themes
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "app_admins_admin_policy" ON public.app_admins;
CREATE POLICY "app_admins_admin_policy"
ON public.app_admins
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_option_groups_admin_policy" ON public.product_option_groups;
CREATE POLICY "product_option_groups_admin_policy"
ON public.product_option_groups
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_option_values_admin_policy" ON public.product_option_values;
CREATE POLICY "product_option_values_admin_policy"
ON public.product_option_values
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "site_metadata_admin_policy" ON public.site_metadata;
CREATE POLICY "site_metadata_admin_policy"
ON public.site_metadata
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "contact_messages_insert_policy" ON public.contact_messages;
CREATE POLICY "contact_messages_insert_policy"
ON public.contact_messages
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "contact_messages_admin_policy" ON public.contact_messages;
CREATE POLICY "contact_messages_admin_policy"
ON public.contact_messages
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ============================================
-- GRANTS
-- ============================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT EXECUTE ON FUNCTION public.site_last_updated() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_content_version() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

COMMIT;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT COUNT(*) AS menu_items FROM public.menu_items;
SELECT COUNT(*) AS product_option_groups FROM public.product_option_groups;
SELECT COUNT(*) AS product_option_values FROM public.product_option_values;
SELECT * FROM public.site_metadata ORDER BY key;
