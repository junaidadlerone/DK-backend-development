-- Create analytics table for caching daily analytics data
-- This table stores computed analytics to avoid recalculation on every request

CREATE TABLE IF NOT EXISTS analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    analytics_type TEXT NOT NULL, -- Type of analytics (e.g., 'REFERRALS', 'CAMPAIGNS', etc.)
    analytics_date DATE NOT NULL DEFAULT CURRENT_DATE, -- Date for which analytics are computed
    data JSONB NOT NULL, -- Computed analytics data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure one analytics record per organization per type per date
    UNIQUE(organization_id, analytics_type, analytics_date)
);

-- Create index for faster lookups
CREATE INDEX idx_analytics_org_type_date ON analytics(organization_id, analytics_type, analytics_date);

-- Create index for date-based cleanup
CREATE INDEX idx_analytics_date ON analytics(analytics_date);

-- Add RLS policies
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access analytics for their organization
CREATE POLICY "Users can view analytics for their organization"
    ON analytics
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations
            WHERE owner_id = auth.uid()
            OR auth.uid() = ANY(
                SELECT (jsonb_array_elements(organization_members)->>'member_uid')::uuid
                FROM organizations
                WHERE id = organization_id
            )
        )
    );

-- Policy: Service role can manage all analytics
CREATE POLICY "Service role can manage all analytics"
    ON analytics
    FOR ALL
    USING (auth.role() = 'service_role');

-- Add comment
COMMENT ON TABLE analytics IS 'Stores cached daily analytics data to improve performance';
