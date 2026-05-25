-- V3 template-bundle listing support.
--
-- 1. Re-creates `get_template_bundles` (V1) to expose three extra columns:
--    - shared_with_organization_ids  (needed by V1 edge function to compute isAgencyTemplate)
--    - bundle_organization_id        (useful for client-side filtering)
--    - show_restriction_annotations_tooltips / show_restriction_area_warning
--      (existed on the table since 20260417 but were never surfaced via the RPC;
--       the existing V1 edge function reads them and was getting `undefined`)
--    Behavior of the WHERE clause is unchanged. All existing columns retain
--    their original keys so the V1 edge function keeps working.
--
-- 2. Adds new `get_template_bundles_v3` for the agency-owned-bundles list.
--    Takes a UUID[] of agency org ids; returns ONLY bundles owned by one of
--    those orgs (no universal, no shared-in). Same return columns as V1 RPC.

DROP FUNCTION IF EXISTS get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_template_bundles(
  p_organization_id  UUID,
  p_limit            INT     DEFAULT 10,
  p_offset           INT     DEFAULT 0,
  p_postcard_size    TEXT    DEFAULT NULL,
  p_include_deleted  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  bundle_id                              UUID,
  bundle_organization_id                 UUID,
  is_universal                           BOOLEAN,
  shared_with_organization_ids           UUID[],
  show_restriction_annotations_tooltips  BOOLEAN,
  show_restriction_area_warning          BOOLEAN,
  bundle_created_at                      TIMESTAMPTZ,
  bundle_updated_at                      TIMESTAMPTZ,
  front_id                               UUID,
  front_html                             TEXT,
  front_description                      TEXT,
  front_postgrid_id                      TEXT,
  front_type                             TEXT,
  front_size                             TEXT,
  front_is_universal                     BOOLEAN,
  front_is_manual                        BOOLEAN,
  front_campaigns                        JSONB,
  front_created_by                       JSONB,
  front_live                             BOOLEAN,
  front_deleted                          BOOLEAN,
  front_created_at                       TIMESTAMPTZ,
  front_updated_at                       TIMESTAMPTZ,
  back_id                                UUID,
  back_html                              TEXT,
  back_description                       TEXT,
  back_postgrid_id                       TEXT,
  back_type                              TEXT,
  back_size                              TEXT,
  back_is_universal                      BOOLEAN,
  back_is_manual                         BOOLEAN,
  back_campaigns                         JSONB,
  back_created_by                        JSONB,
  back_live                              BOOLEAN,
  back_deleted                           BOOLEAN,
  back_created_at                        TIMESTAMPTZ,
  back_updated_at                        TIMESTAMPTZ,
  total_count                            BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tb.id,
    tb.organization_id,
    tb.is_universal,
    COALESCE(tb.shared_with_organization_ids, '{}'::uuid[]),
    tb.show_restriction_annotations_tooltips,
    tb.show_restriction_area_warning,
    tb.created_at,
    tb.updated_at,
    f.id,
    f.html,
    f.description,
    f.postgrid_template_id,
    f.template_type::TEXT,
    f.postcard_size::TEXT,
    f.is_universal,
    f.is_manual_edit,
    f.campaigns_used,
    f.created_by,
    f.live,
    f.deleted,
    f.created_at,
    f.updated_at,
    b.id,
    b.html,
    b.description,
    b.postgrid_template_id,
    b.template_type::TEXT,
    b.postcard_size::TEXT,
    b.is_universal,
    b.is_manual_edit,
    b.campaigns_used,
    b.created_by,
    b.live,
    b.deleted,
    b.created_at,
    b.updated_at,
    COUNT(*) OVER() AS total_count
  FROM template_bundles tb
  JOIN templates f ON f.id = tb.template_front_id
  JOIN templates b ON b.id = tb.template_back_id
  WHERE
    (
      tb.organization_id = p_organization_id
      OR tb.is_universal = true
      OR p_organization_id = ANY (tb.shared_with_organization_ids)
    )
    AND (p_include_deleted OR (f.deleted = false AND b.deleted = false))
    AND (p_postcard_size IS NULL OR f.postcard_size::TEXT = p_postcard_size)
  ORDER BY tb.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION get_template_bundles IS
  'Returns paginated template bundles with joined front/back templates, total_count, shared_with_organization_ids, owning org id, and restriction flags. Includes private (own org), universal, AND bundles shared with the caller''s org.';

-- ───────────────────────────────────────────────────────────────────
-- V3 RPC: agency-owned bundles only. No universal, no shared-in.
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_template_bundles_v3(UUID[], INT, INT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_template_bundles_v3(
  p_agency_organization_ids UUID[],
  p_limit                   INT     DEFAULT 10,
  p_offset                  INT     DEFAULT 0,
  p_postcard_size           TEXT    DEFAULT NULL,
  p_include_deleted         BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  bundle_id                              UUID,
  bundle_organization_id                 UUID,
  is_universal                           BOOLEAN,
  shared_with_organization_ids           UUID[],
  show_restriction_annotations_tooltips  BOOLEAN,
  show_restriction_area_warning          BOOLEAN,
  bundle_created_at                      TIMESTAMPTZ,
  bundle_updated_at                      TIMESTAMPTZ,
  front_id                               UUID,
  front_html                             TEXT,
  front_description                      TEXT,
  front_postgrid_id                      TEXT,
  front_type                             TEXT,
  front_size                             TEXT,
  front_is_universal                     BOOLEAN,
  front_is_manual                        BOOLEAN,
  front_campaigns                        JSONB,
  front_created_by                       JSONB,
  front_live                             BOOLEAN,
  front_deleted                          BOOLEAN,
  front_created_at                       TIMESTAMPTZ,
  front_updated_at                       TIMESTAMPTZ,
  back_id                                UUID,
  back_html                              TEXT,
  back_description                       TEXT,
  back_postgrid_id                       TEXT,
  back_type                              TEXT,
  back_size                              TEXT,
  back_is_universal                      BOOLEAN,
  back_is_manual                         BOOLEAN,
  back_campaigns                         JSONB,
  back_created_by                        JSONB,
  back_live                              BOOLEAN,
  back_deleted                           BOOLEAN,
  back_created_at                        TIMESTAMPTZ,
  back_updated_at                        TIMESTAMPTZ,
  total_count                            BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tb.id,
    tb.organization_id,
    tb.is_universal,
    COALESCE(tb.shared_with_organization_ids, '{}'::uuid[]),
    tb.show_restriction_annotations_tooltips,
    tb.show_restriction_area_warning,
    tb.created_at,
    tb.updated_at,
    f.id,
    f.html,
    f.description,
    f.postgrid_template_id,
    f.template_type::TEXT,
    f.postcard_size::TEXT,
    f.is_universal,
    f.is_manual_edit,
    f.campaigns_used,
    f.created_by,
    f.live,
    f.deleted,
    f.created_at,
    f.updated_at,
    b.id,
    b.html,
    b.description,
    b.postgrid_template_id,
    b.template_type::TEXT,
    b.postcard_size::TEXT,
    b.is_universal,
    b.is_manual_edit,
    b.campaigns_used,
    b.created_by,
    b.live,
    b.deleted,
    b.created_at,
    b.updated_at,
    COUNT(*) OVER() AS total_count
  FROM template_bundles tb
  JOIN templates f ON f.id = tb.template_front_id
  JOIN templates b ON b.id = tb.template_back_id
  WHERE
    tb.organization_id = ANY (p_agency_organization_ids)
    AND tb.is_universal = false
    AND (p_include_deleted OR (f.deleted = false AND b.deleted = false))
    AND (p_postcard_size IS NULL OR f.postcard_size::TEXT = p_postcard_size)
  ORDER BY tb.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_template_bundles_v3(UUID[], INT, INT, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION get_template_bundles_v3 IS
  'V3: paginated bundles owned by one of the caller''s agency orgs. Filters tb.organization_id = ANY(p_agency_organization_ids) AND is_universal = false. No universal, no shared-in. Used by /getAllTemplatesBundlesV3.';
