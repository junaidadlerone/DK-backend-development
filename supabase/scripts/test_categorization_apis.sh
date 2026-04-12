#!/bin/bash

# Test script for Campaign Categorization APIs
# Requires SUPABASE_URL and SUPABASE_ANON_KEY environment variables

SUPABASE_URL="https://xnflihspegizweqidvow.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJFUzI1NiIsImtpZCI6ImQzZWVlN2IzLTg2ZWQtNDdjZC04M2UzLTdmNzg3OTI3NDM0YSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3huZmxpaHNwZWdpendlcWlkdm93LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIxMWM5OWU1Yi1mOGQ0LTQ5NWMtODNlNC1iZjJmOTdjMTVhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc1OTAwNDA1LCJpYXQiOjE3NzU4OTY4MDUsImVtYWlsIjoibnl4ZzZAc2hhcmVib3QubmV0IiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZnVsbF9uYW1lIjoiQWRtaW4gVXNlciJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzc1ODk2ODA1fV0sInNlc3Npb25faWQiOiI1OTVmZDBhMy1mNGNlLTQxMjEtODI2Mi0wMmM2ZjQ5Y2U5ZDYiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.bMgk2F_mKI03-3jJKv3Dz4zEKk1caNmue9MDmEMYkolHlQfLaybDQOHwVmSiiv8kIWOMB5ILEYWXTbET-mcX_A"
CAMPAIGN_ID="ea199d83-f880-498a-8801-5b3064e4de97"

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
