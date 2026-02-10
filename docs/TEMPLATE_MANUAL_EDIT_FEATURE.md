# Template Manual Edit Feature

## Overview
This document describes the manual edit template feature added to the template management system. This feature allows creating campaign-specific templates that are only visible when querying for a specific campaign.

## Database Changes

### Migration: `20260107211800_add_is_manual_edit_to_templates.sql`

Added a new column to the `templates` table:
- **Column Name**: `is_manual_edit`
- **Type**: `BOOLEAN`
- **Default**: `false`
- **Description**: Flag indicating if template was manually created/edited for a specific campaign. Manual edit templates are only shown when querying with specific campaign_id.

## API Changes

### 1. `/createNewTemplate` API

#### New Optional Parameters

- **`isManualEdit`** (boolean, optional, default: `false`)
  - When `true`, marks the template as a manual edit template
  - Template will only be visible when querying with the associated campaign_id
  - When `true`, `campaign_id` parameter is **required**

- **`campaign_id`** (string, optional)
  - **Required** when `isManualEdit` is `true`
  - Campaign ID to add to the template's `campaigns_used` array
  - Must be a valid string (typically UUID format)

#### Request Body Example

```json
{
  "postgridApiKey": "live_sk_...",
  "description": "Custom Template for Summer Campaign",
  "html": "<b>Hello</b> {{to.firstName}}!",
  "templateType": "Front",
  "postcardSize": "4x6",
  "isManualEdit": true,
  "campaign_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Validation Rules

1. If `isManualEdit` is `true`, `campaign_id` must be provided and must be a string
2. If `isManualEdit` is `false` or not provided, API works as before (empty `campaigns_used` array)

#### Response Changes

The response now includes:
- `is_manual_edit`: boolean flag
- `campaigns_used`: array containing the campaign_id if isManualEdit was true, otherwise empty array

### 2. `/getAllTemplates` API

#### New Query Parameter

- **`campaign_id`** (string, optional)
  - When provided, the API includes manual edit templates that contain this campaign_id in their `campaigns_used` array
  - Without this parameter, manual edit templates are excluded from results

#### Behavior Changes

**Default Behavior (no `campaign_id` parameter):**
- Returns organization templates + universal templates
- **Excludes** templates where `is_manual_edit=true`

**With `campaign_id` parameter:**
- Returns organization templates + universal templates (excluding manual edit templates)
- **Additionally includes** manual edit templates where:
  - `is_manual_edit=true` AND
  - `campaigns_used` array contains the provided `campaign_id`

#### Query Examples

**Example 1: Get all regular templates**
```
GET /getAllTemplates
```
Returns: Organization templates + universal templates (no manual edit templates)

**Example 2: Get templates including manual edits for specific campaign**
```
GET /getAllTemplates?campaign_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
Returns: Organization templates + universal templates + manual edit templates for campaign a1b2c3d4

**Example 3: With additional filters**
```
GET /getAllTemplates?campaign_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890&templateType=Front&postcardSize=4x6
```
Returns: Filtered templates including manual edits for the campaign

#### Response Changes

The response now includes:
- In `metadata.filters_applied`:
  - `campaign_id`: The campaign_id filter applied (or null)
- In each template object:
  - `isManualEdit`: boolean flag indicating if template is a manual edit template

### 3. `/getTemplateById` API

#### Response Changes

The response now includes:
- `isManualEdit`: boolean flag in the template object

### 4. `/updateTemplate` API

#### Response Changes

The response now includes:
- `isManualEdit`: boolean flag in the template object

## Use Cases

### Use Case 1: Create a Campaign-Specific Template

When a user wants to customize a template for a specific campaign:

1. Call `/createNewTemplate` with:
   ```json
   {
     "postgridApiKey": "live_sk_...",
     "description": "Custom Q1 2024 Campaign Front",
     "html": "<custom html>",
     "templateType": "Front",
     "postcardSize": "4x6",
     "isManualEdit": true,
     "campaign_id": "campaign-q1-2024-uuid"
   }
   ```

2. Template is created with:
   - `is_manual_edit = true`
   - `campaigns_used = ["campaign-q1-2024-uuid"]`

3. This template will NOT appear in regular `/getAllTemplates` calls
4. This template WILL appear when calling `/getAllTemplates?campaign_id=campaign-q1-2024-uuid`

### Use Case 2: View Templates for Campaign Editor

When showing templates in a campaign editor:

1. Call `/getAllTemplates?campaign_id=<campaign-uuid>`
2. Response includes:
   - All regular organization templates
   - All universal templates
   - Manual edit templates specifically created for this campaign

### Use Case 3: View Templates in General Template Library

When showing templates in a general template library (not campaign-specific):

1. Call `/getAllTemplates` (without campaign_id parameter)
2. Response includes:
   - All regular organization templates
   - All universal templates
   - NO manual edit templates (keeps library clean)

## Technical Implementation

### Database Query Logic

**Main Query (getAllTemplates):**
```sql
SELECT * FROM templates
WHERE (organization_id = <org_id> OR is_universal = true)
  AND (is_manual_edit IS NULL OR is_manual_edit = false)
  AND deleted = false
```

**Manual Edit Query (when campaign_id provided):**
```sql
SELECT * FROM templates
WHERE organization_id = <org_id>
  AND is_manual_edit = true
  AND campaigns_used @> ARRAY[<campaign_id>]::text[]
  AND deleted = false
```

**Results:**
- Combine both query results
- Remove duplicates by template ID
- Sort by `created_at` descending

## Migration Checklist

- [x] Database migration applied (`is_manual_edit` column added)
- [x] `/createNewTemplate` API updated with `isManualEdit` and `campaign_id` parameters
- [x] `/getAllTemplates` API updated with conditional manual edit template inclusion
- [x] OpenAPI documentation updated for all affected endpoints
- [x] Response schemas updated to include `isManualEdit` flag
- [x] All template endpoints deployed

## Breaking Changes

**None.** This is a backward-compatible addition:
- Existing templates default to `is_manual_edit = false`
- Existing API calls work unchanged
- New parameters are optional
