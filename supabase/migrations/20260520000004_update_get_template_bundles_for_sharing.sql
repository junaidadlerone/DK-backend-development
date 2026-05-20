-- Re-create get_template_bundles to include shared-with visibility.
-- Original definition lives in 20260331000001_optimize_template_bundles_query.sql.
-- Only the WHERE clause changes: adds `p_organization_id = ANY (tb.shared_with_organization_ids)`.
-- Signature, return columns, ordering, pagination, and COUNT(*) OVER() are preserved verbatim
-- so the existing getAllTemplatesBundles edge function continues to work unchanged.

-- DROP first because CREATE OR REPLACE FUNCTION cannot change a row-type-returning
-- function's OUT parameters (raises 42P13). The deployed function on dev may have
-- drifted from the 20260331000001 definition; dropping ensures a clean swap.
DROP FUNCTION IF EXISTS get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_template_bundles(
  p_organization_id  UUID,
  p_limit            INT     DEFAULT 10,
  p_offset           INT     DEFAULT 0,
  p_postcard_size    TEXT    DEFAULT NULL,
  p_include_deleted  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  bundle_id          UUID,
  is_universal       BOOLEAN,
  bundle_created_at  TIMESTAMPTZ,
  bundle_updated_at  TIMESTAMPTZ,
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
  total_count        BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tb.id,
    tb.is_universal,
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
  'Returns paginated template bundles with joined front/back templates and total_count. Includes private (own org), universal, AND bundles shared with the caller''s org via template_bundles.shared_with_organization_ids.';
