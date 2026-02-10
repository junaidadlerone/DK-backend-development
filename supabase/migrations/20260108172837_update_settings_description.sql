-- Update the settings menu item description in app_content table
-- Changes "Manage Your Account Settings" to "Manage everything about your organization, preferences and team"

UPDATE app_content
SET menu_items = jsonb_set(
  menu_items,
  '{8,description}',  -- Index 8 is the settings item (9th item, 0-indexed)
  '"Manage everything about your organization, preferences and team"'
)
WHERE menu_items->8->>'name' = 'settings';

-- Also update any other possible positions if settings is at a different index
UPDATE app_content
SET menu_items = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'name' = 'settings'
      THEN jsonb_set(elem, '{description}', '"Manage everything about your organization, preferences and team"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(menu_items) AS elem
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(menu_items) AS elem
  WHERE elem->>'name' = 'settings'
  AND elem->>'description' = 'Manage Your Account Settings'
);
