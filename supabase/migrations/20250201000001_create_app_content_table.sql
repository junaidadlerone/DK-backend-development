-- Create app_content table for organization-based menu configuration
CREATE TABLE IF NOT EXISTS app_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  menu_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique index to ensure one app content per organization per role
CREATE UNIQUE INDEX idx_app_content_org_role ON app_content(organization_id, role);

-- Create indexes for faster queries
CREATE INDEX idx_app_content_organization_id ON app_content(organization_id);
CREATE INDEX idx_app_content_role ON app_content(role);

-- Enable RLS
ALTER TABLE app_content ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all app content"
  ON app_content
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view app content for their organization
CREATE POLICY "Users can view app content in their organization"
  ON app_content
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR auth.uid() = ANY(
        SELECT (jsonb_array_elements_text(organization_members))::uuid
      )
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_app_content_updated_at
  BEFORE UPDATE ON app_content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to create default app content for an organization
CREATE OR REPLACE FUNCTION create_default_app_content(org_id uuid)
RETURNS void AS $$
BEGIN
  -- ADMIN gets access to everything
  INSERT INTO app_content (organization_id, role, menu_items)
  VALUES (org_id, 'ADMIN', '[
    {
      "name": "search_bar",
      "title": "Search",
      "description": "Search Job, Referrals & Campaigns",
      "id": 0,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "dashboard",
      "title": "Dashboard",
      "description": "Create, Navigate, Lead & Iterate",
      "id": 1,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "referrals",
      "title": "Referrals",
      "description": "Add Referrals, start Campaigns & Get Leads",
      "id": 2,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "campaigns",
      "title": "Campaigns",
      "description": "Manage Your Campaigns",
      "id": 3,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "templates",
      "title": "Templates",
      "description": "Manage Your Templates",
      "id": 4,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "targeting",
      "title": "Targeting",
      "description": "",
      "id": 5,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "targeting_zones",
          "title": "Targeting Zones",
          "description": "Targeting > Targeting Zones",
          "id": 51,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "addresses_collection",
          "title": "Addresses Collection",
          "description": "Targeting > Addresses Collection",
          "id": 52,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "global_exclusions",
          "title": "Global Exclusions & Opt-outs",
          "description": "Targeting > Global Exclusions & Opt-outs",
          "id": 53,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "analytics",
      "title": "Analytics",
      "description": "",
      "id": 6,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "overview",
          "title": "Overview",
          "description": "Analytics > Overview",
          "id": 61,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "campaign_performance",
          "title": "Campaign Performance",
          "description": "Analytics > Campaign Performance",
          "id": 62,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "roi",
          "title": "ROI & Cost Analysis",
          "description": "Analytics > ROI & Cost Analysis",
          "id": 63,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "quick_actions",
      "title": "Quick Actions",
      "description": "",
      "id": 7,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "create_new_campaign",
          "title": "Create New Campaign",
          "description": "",
          "id": 71,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "add_new_referral",
          "title": "Add New Referral",
          "description": "",
          "id": 72,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "create_new_template",
          "title": "Create New Template",
          "description": "",
          "id": 73,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "notifications",
      "title": "Notifications",
      "description": "",
      "id": 8,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "settings",
      "title": "Settings",
      "description": "Manage everything about your organization, preferences and team",
      "id": 9,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "integrations",
      "title": "Integrations",
      "description": "",
      "id": 10,
      "enabled": false,
      "extended": false,
      "extended_options": []
    }
  ]'::jsonb);

  -- MARKETER gets access to campaigns, referrals, analytics, targeting, and notifications
  INSERT INTO app_content (organization_id, role, menu_items)
  VALUES (org_id, 'MARKETER', '[
    {
      "name": "search_bar",
      "title": "Search",
      "description": "Search Job, Referrals & Campaigns",
      "id": 0,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "dashboard",
      "title": "Dashboard",
      "description": "Create, Navigate, Lead & Iterate",
      "id": 1,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "referrals",
      "title": "Referrals",
      "description": "Add Referrals, start Campaigns & Get Leads",
      "id": 2,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "campaigns",
      "title": "Campaigns",
      "description": "Manage Your Campaigns",
      "id": 3,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "targeting",
      "title": "Targeting",
      "description": "",
      "id": 5,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "targeting_zones",
          "title": "Targeting Zones",
          "description": "Targeting > Targeting Zones",
          "id": 51,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "addresses_collection",
          "title": "Addresses Collection",
          "description": "Targeting > Addresses Collection",
          "id": 52,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "global_exclusions",
          "title": "Global Exclusions & Opt-outs",
          "description": "Targeting > Global Exclusions & Opt-outs",
          "id": 53,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "analytics",
      "title": "Analytics",
      "description": "",
      "id": 6,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "overview",
          "title": "Overview",
          "description": "Analytics > Overview",
          "id": 61,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "campaign_performance",
          "title": "Campaign Performance",
          "description": "Analytics > Campaign Performance",
          "id": 62,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "roi",
          "title": "ROI & Cost Analysis",
          "description": "Analytics > ROI & Cost Analysis",
          "id": 63,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "quick_actions",
      "title": "Quick Actions",
      "description": "",
      "id": 7,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "create_new_campaign",
          "title": "Create New Campaign",
          "description": "",
          "id": 71,
          "enabled": true,
          "extended": false,
          "extended_options": []
        },
        {
          "name": "add_new_referral",
          "title": "Add New Referral",
          "description": "",
          "id": 72,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "notifications",
      "title": "Notifications",
      "description": "",
      "id": 8,
      "enabled": true,
      "extended": false,
      "extended_options": []
    }
  ]'::jsonb);

  -- TECHNICIAN gets access to referrals and notifications only
  INSERT INTO app_content (organization_id, role, menu_items)
  VALUES (org_id, 'TECHNICIAN', '[
    {
      "name": "search_bar",
      "title": "Search",
      "description": "Search Job & Referrals",
      "id": 0,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "dashboard",
      "title": "Dashboard",
      "description": "View Your Work & Progress",
      "id": 1,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "referrals",
      "title": "Referrals",
      "description": "Add Referrals & Manage Jobs",
      "id": 2,
      "enabled": true,
      "extended": false,
      "extended_options": []
    },
    {
      "name": "quick_actions",
      "title": "Quick Actions",
      "description": "",
      "id": 7,
      "enabled": true,
      "extended": true,
      "extended_options": [
        {
          "name": "add_new_referral",
          "title": "Add New Referral",
          "description": "",
          "id": 72,
          "enabled": true,
          "extended": false,
          "extended_options": []
        }
      ]
    },
    {
      "name": "notifications",
      "title": "Notifications",
      "description": "",
      "id": 8,
      "enabled": true,
      "extended": false,
      "extended_options": []
    }
  ]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION create_default_app_content(uuid) TO service_role;

-- Add comments
COMMENT ON TABLE app_content IS 'Organization-based app menu configuration for different user roles';
COMMENT ON COLUMN app_content.organization_id IS 'Reference to the organization this app content belongs to';
COMMENT ON COLUMN app_content.role IS 'User role this app content configuration is for (ADMIN, MARKETER, TECHNICIAN)';
COMMENT ON COLUMN app_content.menu_items IS 'JSON array of menu items and their configurations based on role permissions';
COMMENT ON FUNCTION create_default_app_content(uuid) IS 'Creates default app content entries for all roles when a new organization is created';