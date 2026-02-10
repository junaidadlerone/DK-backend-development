# Change Campaign Status API

## Overview
Created a new public API endpoint `/changeCampaignStatus` to handle campaign and referral status transitions. This functionality was previously bundled with `updatePostCardsSentCount` but has been separated for clearer separation of concerns.

## Changes Made

### 1. New Edge Function: `/changeCampaignStatus`

**Location:** `supabase/functions/changeCampaignStatus/index.ts`

**Purpose:** Changes campaign status to Active and associated referral status to "In Use"

**Access:** Public (no JWT authentication required)

**Request Format:** `application/json`

**Request Body:**
```json
{
  "campaign_id": "uuid-of-campaign"
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Campaign status changed to Active successfully",
  "campaign_id": "uuid-of-campaign"
}
```

**Business Rules:**
- Validates campaign exists
- Changes campaign status to "Active" (UUID: `e5ec5c13-8194-4d1b-8765-e6be3734954c`)
- If campaign has a linked referral, changes referral status to "In Use" (UUID: `cabe17d8-a7c8-4730-986f-bd0d87e44758`)
- Logs referral update errors but doesn't fail the request

**Error Handling:**
- If campaign_id missing: 400 Bad Request
- If campaign not found: 404 Not Found
- If update fails: 500 Internal Server Error

### 2. Modified Edge Function: `/updatePostCardsSentCount`

**Location:** `supabase/functions/updatePostCardsSentCount/index.ts`

**Changes:**
- Removed campaign status change logic
- Removed referral status change logic
- Now only updates the `postcards_sent` count
- No longer fetches `referral_id` from campaign

**Updated Functionality:**
- Only updates `postcards_sent` field
- Updates `updated_at` timestamp
- Does NOT change any status fields

**Updated Documentation:**
Updated function comments to reflect that status changes should use `/changeCampaignStatus`

## Deployment Status

✅ **Function deployed:** `changeCampaignStatus` (ACTIVE - public, no JWT required)
✅ **Function updated:** `updatePostCardsSentCount` (ACTIVE - public, no JWT required)
✅ **Documentation updated:** `openapi.yaml` - Both endpoints documented

## Usage Examples

### Change Campaign Status to Active
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/changeCampaignStatus \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

### Update Postcard Count (Without Status Change)
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/updatePostCardsSentCount \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "123e4567-e89b-12d3-a456-426614174000",
    "count": 250
  }'
```

## Separation of Concerns

### Before:
- `updatePostCardsSentCount` handled both count updates AND status changes

### After:
- `updatePostCardsSentCount` - Only updates postcards_sent count
- `changeCampaignStatus` - Only handles status transitions

## Status Transitions

### Campaign Status: Draft/Ready → Active
- Triggered by: `/changeCampaignStatus`
- Status ID: `e5ec5c13-8194-4d1b-8765-e6be3734954c`

### Referral Status: Ready → In Use
- Triggered by: `/changeCampaignStatus` (only if campaign has a referral)
- Status ID: `cabe17d8-a7c8-4730-986f-bd0d87e44758`

## Notes

- Both endpoints are publicly accessible (no authentication required)
- Designed for webhook integrations (e.g., PostGrid)
- No breaking changes to existing `updatePostCardsSentCount` API contract
- `updatePostCardsSentCount` still accepts the same request format
- Existing integrations using `updatePostCardsSentCount` will continue to work but will no longer change status
