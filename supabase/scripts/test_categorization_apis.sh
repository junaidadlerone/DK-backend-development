#!/bin/bash

# Test script for Campaign Categorization APIs
# Requires SUPABASE_URL and SUPABASE_ANON_KEY environment variables

SUPABASE_URL="https://xnflihspegizweqidvow.supabase.co"
SUPABASE_ANON_KEY=""
CAMPAIGN_ID=""

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set."
  echo "Example: SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=your-anon-key ./test_categorization_apis.sh"
  exit 1
fi

if [ -z "$CAMPAIGN_ID" ]; then
  echo "Error: CAMPAIGN_ID must be set."
  exit 1
fi

echo "--- Testing getCampaignStep ---"
curl -X POST "${SUPABASE_URL}/functions/v1/getCampaignStep" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"campaign_id\": \"${CAMPAIGN_ID}\"}" | jq .

echo -e "\n--- Testing getCampaignLaunchData ---"
curl -X POST "${SUPABASE_URL}/functions/v1/getCampaignLaunchData" \
  -H "Content-Type: application/json" \
  -d "{\"campaign_id\": \"${CAMPAIGN_ID}\"}" | jq .

echo -e "\n--- Testing createCampaignV2 (Step 1) ---"
curl -X POST "${SUPABASE_URL}/functions/v1/createCampaignV2" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"step\": 1,
    \"campaign_name\": \"Test Categorization $(date +%s)\",
    \"target_type\": \"Address List\"
  }" | jq .
