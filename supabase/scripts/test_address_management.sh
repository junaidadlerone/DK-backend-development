#!/bin/bash

# Comprehensive Test Script for Address Management APIs
# Requires SUPABASE_URL and SUPABASE_ANON_KEY (authenticated JWT) environment variables

SUPABASE_URL="https://xnflihspegizweqidvow.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJFUzI1NiIsImtpZCI6ImQzZWVlN2IzLTg2ZWQtNDdjZC04M2UzLTdmNzg3OTI3NDM0YSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3huZmxpaHNwZWdpendlcWlkdm93LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIxMWM5OWU1Yi1mOGQ0LTQ5NWMtODNlNC1iZjJmOTdjMTVhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc1OTcyMjk2LCJpYXQiOjE3NzU5Njg2OTYsImVtYWlsIjoibnl4ZzZAc2hhcmVib3QubmV0IiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZnVsbF9uYW1lIjoiQWRtaW4gVXNlciJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzc1OTY4Njk2fV0sInNlc3Npb25faWQiOiJlNzUzNWFhZi05YzJiLTQyOTEtYTIwNy1lOTc4NDNiNzYxOWQiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.RyXW7eUgKlUf_JEVnoIp5GD5f1tB5FapG_fSDWofEkJyrbbJZKwLa6W-3RLpLbJpim7ezYynCgagLSvJqLyQpg"
CAMPAIGN_ID="63869fc3-16c7-4e46-9e19-3607eb9490d2"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set."
  exit 1
fi

CSV_DATA="QWRkcmVzcyBMaW5lIDEsQWRkcmVzcyBMaW5lIDIsQ2l0eSxTdGF0ZSxaaXAgQ29kZQo0OTM4IE1hcmtldCBTdCwsU2FuIEZyYW5jaXNjbyxDQSw5NDEwMgozOTQgTWFya2V0IFN0LCxTYW4gRnJhbmNpc2NvLENBLDk0MTAyCjU4MzEgTWFya2V0IFN0LCxTYW4gRnJhbmNpc2NvLENBLDk0MTAyCjQ5MzggTWFya2V0IFN0LCxTYW4gRnJhbmNpc2NvLENBLDk0MTAy"

echo "--- 1. importAddressList ---"
IMPORT_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/importAddressList" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"campaign_id\": \"${CAMPAIGN_ID}\",
    \"list_name\": \"Test Management $(date +%s)\",
    \"csv_data\": \"data:text/csv;base64,${CSV_DATA}\",
    \"filename\": \"test_addresses.csv\"
  }")

echo $IMPORT_RESPONSE | jq .

LIST_ID=$(echo $IMPORT_RESPONSE | jq -r '.list_id')
ADDRESS_ID_1=$(echo $IMPORT_RESPONSE | jq -r '.results[0].id')
ADDRESS_ID_2=$(echo $IMPORT_RESPONSE | jq -r '.results[1].id')
ADDRESS_ID_3=$(echo $IMPORT_RESPONSE | jq -r '.results[2].id')

if [ "$LIST_ID" == "null" ] || [ -z "$LIST_ID" ]; then
  echo "Failed to get LIST_ID. Exiting."
  exit 1
fi

echo -e "\n--- 2. getCSVAddressListDetails (Initial - should have 1 excluded duplicate) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/getCSVAddressListDetails" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"csv_address_list_id\": \"${LIST_ID}\"}" | jq '{total_count, included_count, excluded_count}'

echo -e "\n--- 3. validateAddresses (Geocode all rows) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/validateAddresses" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"list_id\": \"${LIST_ID}\"
  }" | jq .

echo -e "\n--- 4. editAddress (Modify second row) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/editAddress" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"list_id\": \"${LIST_ID}\",
    \"address_id\": \"${ADDRESS_ID_2}\",
    \"updates\": {
      \"address_line1\": \"999 Edited St\",
      \"city\": \"Edited City\"
    }
  }" | jq .

echo -e "\n--- 5. deleteCSVAddresses (Mark third row as deleted) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/deleteCSVAddresses" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"list_id\": \"${LIST_ID}\",
    \"address_ids\": [\"${ADDRESS_ID_3}\"]
  }" | jq .

echo -e "\n--- 6. removeAllDuplicates (Already marked in import, but testing function) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/removeAllDuplicates" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"list_id\": \"${LIST_ID}\"}" | jq .

echo -e "\n--- 7. getCSVAddressListDetails (Final counts) ---"
curl -s -X POST "${SUPABASE_URL}/functions/v1/getCSVAddressListDetails" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"csv_address_list_id\": \"${LIST_ID}\"}" | jq '{total_count, included_count, excluded_count}'
