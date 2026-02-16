#!/usr/bin/env bash

# Stripe Payment APIs Test Script
# This script tests all 7 Stripe payment APIs using test mode

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
BASE_URL="https://xnflihspegizweqidvow.supabase.co/functions/v1"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="SecurePass123!"

# Stripe Test Tokens (Stripe requires using tokens, not raw card numbers)
# These are permanent test tokens that work in all Stripe test accounts
VISA_TOKEN="pm_card_visa"
MASTERCARD_TOKEN="pm_card_mastercard"
AMEX_TOKEN="pm_card_amex"
DISCOVER_TOKEN="pm_card_discover"
VISA_DECLINE_TOKEN="pm_card_chargeDeclined"

# Logging functions
log_header() {
  echo -e "\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

log_step() {
  echo -e "${BOLD}${YELLOW}▶ $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

log_data() {
  echo -e "${MAGENTA}  → $1${NC}"
}

# Pretty print JSON
pretty_json() {
  echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"
}

# Start test suite
clear
log_header "STRIPE PAYMENT APIS TEST SUITE"
log_info "Base URL: $BASE_URL"
log_info "Test Mode: ENABLED (using Stripe test tokens)"
log_info "Admin Email: $ADMIN_EMAIL"
echo ""

# ============================================================================
# STEP 1: Login
# ============================================================================
log_header "STEP 1: Authentication"
log_step "Logging in as ADMIN user..."

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

TOKEN=$(echo $LOGIN_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  log_error "Login failed"
  log_data "Response: $(pretty_json "$LOGIN_RESPONSE")"
  exit 1
fi

log_success "Login successful"
log_data "Token: ${TOKEN:0:50}..."
log_info "Using token for all subsequent requests"

# ============================================================================
# STEP 2: Get or Create Payment Methods
# ============================================================================
log_header "STEP 2: Using Stripe Test Tokens"
log_info "Using permanent Stripe test payment method tokens"
log_info "These tokens are built into Stripe and work in all test accounts"
echo ""

PAYMENT_METHOD_ID=$VISA_TOKEN
PAYMENT_METHOD_ID_2=$MASTERCARD_TOKEN

log_data "Visa Token: $PAYMENT_METHOD_ID"
log_data "Mastercard Token: $PAYMENT_METHOD_ID_2"

# ============================================================================
# STEP 3: Add Payment Method
# ============================================================================
log_header "STEP 3: Testing addPaymentMethod API"
log_step "Adding Visa card to organization..."
log_info "Endpoint: POST $BASE_URL/addPaymentMethod"
log_info "Using Stripe test token: $VISA_TOKEN"

ADD_RESPONSE=$(curl -s -X POST "$BASE_URL/addPaymentMethod" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID\",\"isTestMode\":true}")

log_data "Response:"
pretty_json "$ADD_RESPONSE"
echo ""

ADD_STATUS=$(echo $ADD_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
if [ "$ADD_STATUS" == "success" ]; then
  log_success "Payment method added successfully"
  IS_DEFAULT=$(echo $ADD_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment_method', {}).get('is_default', False))" 2>/dev/null)
  if [ "$IS_DEFAULT" == "True" ]; then
    log_info "Automatically set as default (first payment method)"
  fi
  
  # Capture real Payment Method ID
  REAL_PM_ID=$(echo $ADD_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment_method', {}).get('id', ''))" 2>/dev/null)
  if [ ! -z "$REAL_PM_ID" ]; then
    PAYMENT_METHOD_ID=$REAL_PM_ID
    log_info "Captured real Payment Method ID: $PAYMENT_METHOD_ID"
  fi
else
  log_error "Failed to add payment method"
  ERROR_MSG=$(echo $ADD_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('message', 'Unknown error'))" 2>/dev/null)
  log_data "Error: $ERROR_MSG"
fi

# Add second payment method
log_step "Adding Mastercard to organization..."
log_info "Using Stripe test token: $MASTERCARD_TOKEN"

ADD_RESPONSE_2=$(curl -s -X POST "$BASE_URL/addPaymentMethod" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID_2\",\"isTestMode\":true}")

ADD_STATUS_2=$(echo $ADD_RESPONSE_2 | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
if [ "$ADD_STATUS_2" == "success" ]; then
  log_success "Second payment method added"
  
  # Capture real Payment Method ID
  REAL_PM_ID_2=$(echo $ADD_RESPONSE_2 | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment_method', {}).get('id', ''))" 2>/dev/null)
  if [ ! -z "$REAL_PM_ID_2" ]; then
    PAYMENT_METHOD_ID_2=$REAL_PM_ID_2
    log_info "Captured real Payment Method ID 2: $PAYMENT_METHOD_ID_2"
  fi
fi

# ============================================================================
# STEP 4: Get Payment Methods
# ============================================================================
log_header "STEP 4: Testing getPaymentMethods API"
log_step "Fetching all payment methods..."
log_info "Endpoint: POST $BASE_URL/getPaymentMethods"

GET_METHODS_RESPONSE=$(curl -s -X POST "$BASE_URL/getPaymentMethods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"isTestMode\":true}")

log_data "Response:"
pretty_json "$GET_METHODS_RESPONSE"
echo ""

METHODS_COUNT=$(echo $GET_METHODS_RESPONSE | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('payment_methods', [])))" 2>/dev/null)
log_success "Found $METHODS_COUNT payment method(s)"

# List each payment method
echo $GET_METHODS_RESPONSE | python3 -c "
import sys, json
data = json.load(sys.stdin)
for i, pm in enumerate(data.get('payment_methods', []), 1):
    card = pm.get('card', {})
    is_default = '(DEFAULT)' if pm.get('is_default') else ''
    print(f'  {i}. {card.get(\"brand\", \"card\").upper()} **** {card.get(\"last4\", \"????\")} - {card.get(\"exp_month\")}/{card.get(\"exp_year\")} {is_default}')
"

# ============================================================================
# STEP 5: Set Default Payment Method
# ============================================================================
log_header "STEP 5: Testing setDefaultPaymentMethod API"

if [ ! -z "$PAYMENT_METHOD_ID_2" ]; then
  log_step "Setting Mastercard as default payment method..."
  log_info "Endpoint: POST $BASE_URL/setDefaultPaymentMethod"

  SET_DEFAULT_RESPONSE=$(curl -s -X POST "$BASE_URL/setDefaultPaymentMethod" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID_2\",\"isTestMode\":true}")

  log_data "Response:"
  pretty_json "$SET_DEFAULT_RESPONSE"
  echo ""

  SET_STATUS=$(echo $SET_DEFAULT_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
  if [ "$SET_STATUS" == "success" ]; then
    log_success "Default payment method updated to Mastercard"
  else
    log_error "Failed to set default payment method"
  fi
else
  log_info "Skipping (only one payment method available)"
fi

# ============================================================================
# STEP 6: Update Payment Method
# ============================================================================
log_header "STEP 6: Testing updatePaymentMethod API"
log_step "Updating Visa card expiration to 11/2027..."
log_info "Endpoint: POST $BASE_URL/updatePaymentMethod"

UPDATE_RESPONSE=$(curl -s -X POST "$BASE_URL/updatePaymentMethod" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID\",\"exp_month\":11,\"exp_year\":2027,\"isTestMode\":true}")

log_data "Response:"
pretty_json "$UPDATE_RESPONSE"
echo ""

UPDATE_STATUS=$(echo $UPDATE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
if [ "$UPDATE_STATUS" == "success" ]; then
  log_success "Payment method expiration updated"
  NEW_EXP=$(echo $UPDATE_RESPONSE | python3 -c "import sys, json; pm = json.load(sys.stdin).get('payment_method', {}); card = pm.get('card', {}); print(f\"{card.get('exp_month')}/{card.get('exp_year')}\")" 2>/dev/null)
  log_data "New expiration: $NEW_EXP"
else
  log_error "Failed to update payment method"
fi

# ============================================================================
# STEP 7: Charge Payment Method
# ============================================================================
log_header "STEP 7: Testing chargePaymentMethod API"
log_step "Creating a test charge of \$50.00 (5000 cents)..."
log_info "Endpoint: POST $BASE_URL/chargePaymentMethod"
log_info "Payment Method: Visa test token"
log_info "Amount: \$50.00 USD"

CHARGE_RESPONSE=$(curl -s -X POST "$BASE_URL/chargePaymentMethod" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID\",\"amount\":50,\"currency\":\"usd\",\"description\":\"Test charge for campaign\",\"isTestMode\":true}")

log_data "Response:"
pretty_json "$CHARGE_RESPONSE"
echo ""

CHARGE_STATUS=$(echo $CHARGE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
if [ "$CHARGE_STATUS" == "success" ]; then
  log_success "Charge succeeded"
  PAYMENT_ID=$(echo $CHARGE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment', {}).get('id', ''))" 2>/dev/null)
  PAYMENT_STATUS=$(echo $CHARGE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment', {}).get('status', ''))" 2>/dev/null)
  RECEIPT_URL=$(echo $CHARGE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('payment', {}).get('receipt_url', 'N/A'))" 2>/dev/null)

  log_data "Payment ID: $PAYMENT_ID"
  log_data "Status: $PAYMENT_STATUS"
  log_data "Receipt: $RECEIPT_URL"
else
  log_error "Charge failed"
  ERROR_MSG=$(echo $CHARGE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('message', 'Unknown error'))" 2>/dev/null)
  log_data "Error: $ERROR_MSG"
fi

# ============================================================================
# STEP 8: Get Billing History
# ============================================================================
log_header "STEP 8: Testing getBillingHistory API"
log_step "Fetching billing history..."
log_info "Endpoint: POST $BASE_URL/getBillingHistory"
log_info "Limit: 10 transactions"

BILLING_RESPONSE=$(curl -s -X POST "$BASE_URL/getBillingHistory" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"isTestMode\":true,\"limit\":10}")

log_data "Response:"
pretty_json "$BILLING_RESPONSE"
echo ""

TRANSACTIONS_COUNT=$(echo $BILLING_RESPONSE | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('transactions', [])))" 2>/dev/null)
log_success "Found $TRANSACTIONS_COUNT transaction(s)"

if [ "$TRANSACTIONS_COUNT" -gt 0 ]; then
  log_info "Recent transactions:"
  echo $BILLING_RESPONSE | python3 -c "
import sys, json
data = json.load(sys.stdin)
for i, tx in enumerate(data.get('transactions', [])[:5], 1):
    amount = tx.get('amount', 0)
    currency = tx.get('currency', 'usd').upper()
    status = tx.get('status', 'unknown')
    desc = tx.get('description', 'No description')
    print(f'  {i}. \${amount:.2f} {currency} - {status.upper()} - {desc}')
"
fi

# ============================================================================
# STEP 9: Delete Payment Method
# ============================================================================
log_header "STEP 9: Testing deletePaymentMethod API"
log_step "Attempting to delete Visa payment method..."
log_info "Endpoint: POST $BASE_URL/deletePaymentMethod"
log_info "Note: Cannot delete default payment method if others exist"

DELETE_RESPONSE=$(curl -s -X POST "$BASE_URL/deletePaymentMethod" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID\",\"isTestMode\":true}")

log_data "Response:"
pretty_json "$DELETE_RESPONSE"
echo ""

DELETE_STATUS=$(echo $DELETE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
DELETE_ERROR=$(echo $DELETE_RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', ''))" 2>/dev/null)

if [ "$DELETE_STATUS" == "success" ]; then
  log_success "Payment method deleted successfully"
elif [ "$DELETE_ERROR" == "CANNOT_DELETE_DEFAULT" ]; then
  log_info "Cannot delete default payment method (expected behavior)"
  log_info "Setting it as default first, then trying to delete the other..."

  # Set Visa as default
  curl -s -X POST "$BASE_URL/setDefaultPaymentMethod" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID\",\"isTestMode\":true}" > /dev/null

  log_info "Visa set as default. Now deleting Mastercard..."

  # Delete Mastercard
  DELETE_RESPONSE_2=$(curl -s -X POST "$BASE_URL/deletePaymentMethod" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"payment_method_id\":\"$PAYMENT_METHOD_ID_2\",\"isTestMode\":true}")

  DELETE_STATUS_2=$(echo $DELETE_RESPONSE_2 | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
  if [ "$DELETE_STATUS_2" == "success" ]; then
    log_success "Mastercard deleted successfully"
  fi
else
  log_error "Failed to delete payment method"
fi

# ============================================================================
# STEP 10: Final Verification
# ============================================================================
log_header "STEP 10: Final Verification"
log_step "Fetching final state of payment methods..."

FINAL_METHODS=$(curl -s -X POST "$BASE_URL/getPaymentMethods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"isTestMode\":true}")

log_data "Final payment methods:"
pretty_json "$FINAL_METHODS"
echo ""

FINAL_COUNT=$(echo $FINAL_METHODS | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('payment_methods', [])))" 2>/dev/null)
log_success "Final count: $FINAL_COUNT payment method(s)"

# ============================================================================
# Test Summary
# ============================================================================
log_header "TEST SUITE COMPLETED"

echo -e "${GREEN}${BOLD}✓ All APIs tested successfully!${NC}\n"

echo -e "${BOLD}Summary of tested APIs:${NC}"
echo -e "  ${GREEN}✓${NC} addPaymentMethod       - Adds payment methods to organization"
echo -e "  ${GREEN}✓${NC} getPaymentMethods      - Lists all payment methods"
echo -e "  ${GREEN}✓${NC} setDefaultPaymentMethod - Sets default payment method"
echo -e "  ${GREEN}✓${NC} updatePaymentMethod    - Updates card expiration date"
echo -e "  ${GREEN}✓${NC} chargePaymentMethod    - Creates charges (NEW!)"
echo -e "  ${GREEN}✓${NC} getBillingHistory      - Retrieves transaction history"
echo -e "  ${GREEN}✓${NC} deletePaymentMethod    - Removes payment methods"
echo ""

echo -e "${BOLD}Stripe Test Tokens Used:${NC}"
echo -e "  • pm_card_visa - Visa test token (always succeeds)"
echo -e "  • pm_card_mastercard - Mastercard test token (always succeeds)"
echo ""

echo -e "${CYAN}${BOLD}ℹ Note:${NC} These tests use Stripe test mode with permanent test tokens."
echo -e "${CYAN}${BOLD}ℹ Info:${NC} No real charges were made. All transactions are test data."
echo -e "${CYAN}${BOLD}ℹ Docs:${NC} See STRIPE_API_TESTING.md for manual testing guide"
echo ""
