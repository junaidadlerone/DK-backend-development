-- Create template_history table
CREATE TABLE IF NOT EXISTS template_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  action text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for faster lookups
CREATE INDEX idx_template_history_template_id ON template_history(template_id);
CREATE INDEX idx_template_history_user_id ON template_history(user_id);
CREATE INDEX idx_template_history_created_at ON template_history(created_at DESC);

-- Enable RLS
ALTER TABLE template_history ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all template history"
  ON template_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view template history in their organization
CREATE POLICY "Users can view template history in their organization"
  ON template_history
  FOR SELECT
  TO authenticated
  USING (
    template_id IN (
      SELECT id FROM templates
      WHERE organization_id IN (
        SELECT id FROM organizations
        WHERE owner_id = auth.uid()
        OR auth.uid() = ANY(
          SELECT jsonb_array_elements_text(organization_members)::uuid
        )
      )
    )
  );

-- Add comment
COMMENT ON TABLE template_history IS 'Logs all actions performed on templates with user information';
