-- ============================================================
-- Add restriction UI columns to template_bundles
-- ============================================================

ALTER TABLE template_bundles
  ADD COLUMN IF NOT EXISTS show_restriction_annotations_tooltips BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_restriction_area_warning          BOOLEAN NOT NULL DEFAULT true;
  
-- ---------------------------------------------------------------
-- Update get_template_bundles RPC to expose new columns
-- Must DROP first because the RETURNS TABLE shape is changing.
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN);

CREATE FUNCTION get_template_bundles(
  p_organization_id  UUID,
  p_limit            INT     DEFAULT 10,
  p_offset           INT     DEFAULT 0,
  p_postcard_size    TEXT    DEFAULT NULL,
  p_include_deleted  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  -- Bundle fields
  bundle_id                              UUID,
  is_universal                           BOOLEAN,
  show_restriction_annotations_tooltips  BOOLEAN,
  show_restriction_area_warning          BOOLEAN,
  bundle_created_at                      TIMESTAMPTZ,
  bundle_updated_at                      TIMESTAMPTZ,
  -- Front template fields
  front_id           UUID,
  front_html         TEXT,
  front_description  TEXT,
  front_postgrid_id  TEXT,
  front_type         TEXT,
  front_size         TEXT,
  front_is_universal BOOLEAN,
  front_is_manual    BOOLEAN,
  front_campaigns    JSONB,
  front_created_by   JSONB,
  front_live         BOOLEAN,
  front_deleted      BOOLEAN,
  front_created_at   TIMESTAMPTZ,
  front_updated_at   TIMESTAMPTZ,
  -- Back template fields
  back_id            UUID,
  back_html          TEXT,
  back_description   TEXT,
  back_postgrid_id   TEXT,
  back_type          TEXT,
  back_size          TEXT,
  back_is_universal  BOOLEAN,
  back_is_manual     BOOLEAN,
  back_campaigns     JSONB,
  back_created_by    JSONB,
  back_live          BOOLEAN,
  back_deleted       BOOLEAN,
  back_created_at    TIMESTAMPTZ,
  back_updated_at    TIMESTAMPTZ,
  -- Pagination
  total_count        BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    -- Bundle
    tb.id,
    tb.is_universal,
    tb.show_restriction_annotations_tooltips,
    tb.show_restriction_area_warning,
    tb.created_at,
    tb.updated_at,
    -- Front template
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
    -- Back template
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
    -- Total count (window function — no extra query needed)
    COUNT(*) OVER() AS total_count
  FROM template_bundles tb
  JOIN templates f ON f.id = tb.template_front_id
  JOIN templates b ON b.id = tb.template_back_id
  WHERE
    (tb.organization_id = p_organization_id OR tb.is_universal = true)
    AND (p_include_deleted OR (f.deleted = false AND b.deleted = false))
    AND (p_postcard_size IS NULL OR f.postcard_size::TEXT = p_postcard_size)
  ORDER BY tb.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN) TO service_role;

COMMENT ON COLUMN template_bundles.show_restriction_annotations_tooltips IS
  'When true, the UI displays tooltips for restriction annotation markers on the template.';

COMMENT ON COLUMN template_bundles.show_restriction_area_warning IS
  'When true, the UI displays a warning banner for restricted areas on the template.';
