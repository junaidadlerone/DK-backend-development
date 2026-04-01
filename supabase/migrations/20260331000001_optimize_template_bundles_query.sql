-- ============================================================
-- Optimize getAllTemplatesBundles query performance
-- ============================================================

-- ---------------------------------------------------------------
-- Optimization 1: Composite + partial indexes for the OR filter
-- ---------------------------------------------------------------

-- Composite index: covers org-scoped filter + ORDER BY created_at DESC in one pass
CREATE INDEX IF NOT EXISTS idx_template_bundles_org_created
  ON template_bundles(organization_id, created_at DESC);

-- Partial index: only the (small) set of universal bundles + sort
-- Postgres can use an index union on these two instead of a full table scan
CREATE INDEX IF NOT EXISTS idx_template_bundles_universal_created
  ON template_bundles(created_at DESC)
  WHERE is_universal = true;

-- ---------------------------------------------------------------
-- Optimization 2: Partial index on templates for join filter
-- ---------------------------------------------------------------

-- Covers the common case: join on non-deleted templates
CREATE INDEX IF NOT EXISTS idx_templates_not_deleted
  ON templates(id)
  WHERE deleted = false;

-- ---------------------------------------------------------------
-- Optimization 3: RPC function — single JOIN + window COUNT
-- Eliminates the separate COUNT round-trip entirely.
-- total_count is returned alongside data via COUNT(*) OVER().
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_template_bundles(
  p_organization_id  UUID,
  p_limit            INT     DEFAULT 10,
  p_offset           INT     DEFAULT 0,
  p_postcard_size    TEXT    DEFAULT NULL,
  p_include_deleted  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  -- Bundle fields
  bundle_id          UUID,
  is_universal       BOOLEAN,
  bundle_created_at  TIMESTAMPTZ,
  bundle_updated_at  TIMESTAMPTZ,
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

-- Grant execution to service role (used by Edge Functions)
GRANT EXECUTE ON FUNCTION get_template_bundles(UUID, INT, INT, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION get_template_bundles IS
  'Returns paginated template bundles with joined front/back templates and a total_count window column. Replaces the two-query (COUNT + SELECT) pattern with a single pass.';
