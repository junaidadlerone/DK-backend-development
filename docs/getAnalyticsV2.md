# getAnalyticsV2 API Reference

**Endpoint:** `POST /functions/v1/getAnalyticsV2`  
**Base URL:** `https://xnflihspegizweqidvow.supabase.co`  
**Auth:** Bearer token (JWT) required in `Authorization` header  
**Roles:** ADMIN, MARKETER, TECHNICIAN

---

## Overview

Returns real-time delivery analytics based on individual PostGrid postcard records. All types share the same endpoint — the `type` field in the request body determines what data is returned.

**Supported types:**
| Type | Description |
|---|---|
| `dashboard_cards` | High-level summary cards |
| `delivery_funnel` | Full status breakdown as percentages |
| `waste_meter` | Wasted/delayed postcard counts + dollar costs |
| `scan_trend` | QR scan totals, unique scans, day-of-week breakdown |
| `recent_scans` | 5 most recent QR scan events per campaign |
| `campaign_leaderboard` | Top 5 campaigns ranked by total QR scans |
| `performance_trend` | Delivery & scan rates for last 7 days, current month weeks, and last 12 months |
| `campaign_performance` | Top 5 best and bottom 5 worst campaigns by QR scans |
| `scan_trend_by_type` | QR scan fraction by campaign target type for last 7 days, current month weeks, and last 12 months |
| `postcard_overview` | Per-campaign breakdown: delivered+scanned, delivered-not-scanned, in-transit, returned/cancelled |

---

## Optional Filters

All filters are optional and work with every type.

| Parameter | Type | Description |
|---|---|---|
| `campaign_ids` | `string[]` | Scope to one or more campaign UUIDs (must belong to the org) |
| `last_24hours` | `boolean` | Restrict to the last 24 hours |
| `last_week` | `boolean` | Restrict to the last 7 days |
| `last_month` | `boolean` | Restrict to the last 30 days |

When multiple time flags are set, the most restrictive window wins: `last_24hours` > `last_week` > `last_month`. When no time filter is set, all historical data is returned.

---

## Error Responses (all types)

### 400 — Missing `type`
```json
{
  "error": "INVALID_INPUT",
  "message": "type is required and must be a string"
}
```

### 400 — Unsupported `type`
```json
{
  "error": "INVALID_TYPE",
  "message": "Analytics type \"foo\" is not supported. Supported types: dashboard_cards, delivery_funnel, waste_meter, scan_trend, recent_scans, campaign_leaderboard, performance_trend, campaign_performance, scan_trend_by_type, postcard_overview"
}
```

### 401 — Missing or invalid token
```json
{
  "error": "UNAUTHORIZED",
  "message": "Unable to authenticate user"
}
```

### 403 — User not in any organization
```json
{
  "error": "NO_ORGANIZATION",
  "message": "User is not associated with any organization"
}
```

### 500 — Internal server error
```json
{
  "error": "INTERNAL_ERROR",
  "message": "An unexpected error occurred. Please try again later."
}
```

---

## Types

---

### `dashboard_cards`

Top-level summary cards. `spent_to_date_display` is formatted using the user's saved currency preference.

#### Curl — all campaigns, all time

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards",
    "last_month": true
  }'
```

#### Curl — combined: multiple campaigns + last week

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dashboard_cards",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ],
    "last_week": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "in_flight_postcards": 450,
    "delivered": 1200,
    "delivery_rate": 72.73,
    "total_scans": 342,
    "spent_to_date": 4950.00,
    "spent_to_date_display": {
      "value": 4950.00,
      "currency_code": "USD",
      "symbol": "$",
      "formatted": "$4,950.00"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `in_flight_postcards` | `number` | Postcards with status `ready`, `printing`, or `processed_for_delivery` |
| `delivered` | `number` | Postcards with status `completed` (PostGrid approximation) |
| `delivery_rate` | `number` | `(delivered / total_sent) × 100`, 2 decimal places |
| `total_scans` | `number` | All-time total QR scans across all org campaign trackers (sum of PostGrid `visitCount`) |
| `spent_to_date` | `number` | Sum of all `amount_paid` in `payment_history` for the org |
| `spent_to_date_display` | `object` | Currency-formatted version using user's saved preference |

---

### `delivery_funnel`

Full PostGrid status breakdown expressed as **percentages of total postcards sent**. Both `postgrid_status` and `imb_status` (Intelligent-Mail, US only) are included.

#### Curl — all campaigns, all time

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel",
    "last_month": true
  }'
```

#### Curl — combined: multiple campaigns + last month

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "delivery_funnel",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ],
    "last_month": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_postcards_sent": 5000,
    "delivered":   { "count": 3625, "percentage": 0.725 },
    "in_transit":  { "count": 410,  "percentage": 0.082 },
    "processed":   { "count": 305,  "percentage": 0.061 },
    "printing":    { "count": 240,  "percentage": 0.048 },
    "ready":       { "count": 170,  "percentage": 0.034 },
    "returned":    { "count": 125,  "percentage": 0.025 },
    "cancelled":   { "count": 125,  "percentage": 0.025 }
  }
}
```

Each status field is an object with:

| Property | Type | Description |
|---|---|---|
| `count` | `number` | Raw postcard count for this status |
| `percentage` | `number` | Fraction of `total_postcards_sent` (0.0–1.0, 4 decimal places) |

| Status field | Source | Description |
|---|---|---|
| `total_postcards_sent` | — | Raw count (denominator) |
| `delivered` | `postgrid_status = completed` | Most likely delivered (PostGrid approximation) |
| `processed` | `postgrid_status = processed_for_delivery` | Handed off to local postal service |
| `printing` | `postgrid_status = printing` | Currently being printed |
| `ready` | `postgrid_status = ready` | Awaiting print on sendDate |
| `cancelled` | `postgrid_status = cancelled` | Cancelled, never sent |
| `in_transit` | `imb_status = entered_mail_stream` or `out_for_delivery` | Confirmed inside USPS network (US only) |
| `returned` | `imb_status = returned_to_sender` | Returned undeliverable (US only) |

> `in_transit` and `returned` will have `count: 0, percentage: 0` for non-US campaigns — PostGrid only sets `imbStatus` for USPS-tracked mail.

---

### `waste_meter`

Quantifies postcard spend that produced no delivery. Dollar amounts use a fixed price of **$3.00 per postcard**.

#### Risk status thresholds

| Status | Condition |
|---|---|
| `Healthy` | `(wasted + delayed) / total_sent` < 5% |
| `At Risk` | 5% – 15% |
| `Critical` | > 15% |

**Delayed definition:** A postcard is delayed if it has NOT reached `completed` or `cancelled` AND 7 or more working days (Mon–Fri) have passed since `created_at`.

#### Curl — all campaigns, all time

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter",
    "last_month": true
  }'
```

#### Curl — combined: multiple campaigns + last month

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waste_meter",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ],
    "last_month": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "status": "At Risk",
    "total_pieces_wasted": 87,
    "total_amount_wasted": 261.00,
    "total_pieces_returned": 42,
    "total_amount_returned": 126.00,
    "total_pieces_cancelled": 45,
    "total_amount_cancelled": 135.00,
    "total_pieces_delayed": 130,
    "total_amount_delayed": 390.00
  }
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | `"Healthy"` / `"At Risk"` / `"Critical"` |
| `total_pieces_wasted` | `number` | `returned + cancelled` count |
| `total_amount_wasted` | `number` | `total_pieces_wasted × $3.00` |
| `total_pieces_returned` | `number` | Postcards with `imb_status = returned_to_sender` |
| `total_amount_returned` | `number` | `total_pieces_returned × $3.00` |
| `total_pieces_cancelled` | `number` | Postcards with `postgrid_status = cancelled` |
| `total_amount_cancelled` | `number` | `total_pieces_cancelled × $3.00` |
| `total_pieces_delayed` | `number` | Active postcards ≥ 7 working days old with no delivery confirmation |
| `total_amount_delayed` | `number` | `total_pieces_delayed × $3.00` |

#### Success Response — Healthy (no waste)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "status": "Healthy",
    "total_pieces_wasted": 0,
    "total_amount_wasted": 0,
    "total_pieces_returned": 0,
    "total_amount_returned": 0,
    "total_pieces_cancelled": 0,
    "total_amount_cancelled": 0,
    "total_pieces_delayed": 0,
    "total_amount_delayed": 0
  }
}
```

---

### `scan_trend`

Aggregates QR code scan data from PostGrid trackers across all campaigns in the organization. Requires campaigns to have a tracker linked via `/linkQRCodeToCampaign`.

**When a time filter is set:** Uses the PostGrid `/visits` endpoint (up to 1000 most recent events) and filters in-memory by `createdAt`. `unique_scans` is derived by deduplicating `orderId` values within the filtered window.

**When no time filter is set:** Uses the PostGrid tracker summary (`visitCount`, `uniqueVisitCount`) for totals, and embedded `clicks[]` for the day-of-week breakdown.

#### Curl — all campaigns, all time

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend",
    "last_month": true
  }'
```

#### Curl — combined: specific campaign + last week

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    "last_week": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_scans": 342,
    "unique_scans": 289,
    "scan_rate": 6.31,
    "breakdown": {
      "monday_scans": 58,
      "tuesday_scans": 63,
      "wednesday_scans": 71,
      "thursday_scans": 49,
      "friday_scans": 55,
      "saturday_scans": 28,
      "sunday_scans": 18
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `total_scans` | `number` | Sum of `visitCount` across all org trackers |
| `unique_scans` | `number` | Sum of `uniqueVisitCount` (unique postcards scanned) |
| `scan_rate` | `number` | `(total_scans / total_postcards_sent) × 100`, 2 decimal places |
| `breakdown` | `object` | Scan count grouped by the weekday each scan occurred |

#### Success Response — no trackers linked

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_scans": 0,
    "unique_scans": 0,
    "scan_rate": 0,
    "breakdown": {
      "monday_scans": 0,
      "tuesday_scans": 0,
      "wednesday_scans": 0,
      "thursday_scans": 0,
      "friday_scans": 0,
      "saturday_scans": 0,
      "sunday_scans": 0
    }
  }
}
```

---

### `recent_scans`

Returns the **5 most recent QR code scan events per campaign**, enriched with the delivery address and a human-readable relative timestamp. Campaigns with zero scans are excluded.

**Scan address** comes from `postcard_sends.address` — the household the postcard was mailed to. **Postcard number** is the sequential position of that postcard within its campaign (ordered by send date, 1-based).

#### Curl — all campaigns

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans",
    "last_month": true
  }'
```

#### Curl — combined: multiple campaigns + last 24 hours

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_scans",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ],
    "last_24hours": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "data": [
      {
        "campaign_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "campaign_name": "Spring Promotion 2024",
        "scans": [
          {
            "postcard_number": 42,
            "scan_address": "512 Elm St, Austin, TX 78701",
            "scan_time_stamp": "15 minutes ago"
          },
          {
            "postcard_number": 17,
            "scan_address": "88 Maple Ave, Dallas, TX 75201",
            "scan_time_stamp": "2 hours ago"
          },
          {
            "postcard_number": 103,
            "scan_address": "4 Oak Blvd, Houston, TX 77001",
            "scan_time_stamp": "1 day ago"
          }
        ]
      },
      {
        "campaign_id": "b2c3d4e5-f6a7-8901-bcde-fa2345678901",
        "campaign_name": "Summer Sale Campaign",
        "scans": [
          {
            "postcard_number": 8,
            "scan_address": "200 Pine Rd, San Antonio, TX 78201",
            "scan_time_stamp": "3 hours ago"
          }
        ]
      }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `data` | `array` | One entry per campaign that has at least one scan |
| `data[].campaign_id` | `string` | Campaign UUID |
| `data[].campaign_name` | `string` | Campaign display name |
| `data[].scans` | `array` | Up to 5 most recent scan events for this campaign |
| `data[].scans[].postcard_number` | `number` | Sequential position of the postcard within the campaign (1-based, ordered by send date) |
| `data[].scans[].scan_address` | `string` | Delivery address of the postcard that was scanned |
| `data[].scans[].scan_time_stamp` | `string` | Relative time: `"just now"`, `"5 minutes ago"`, `"2 hours ago"`, `"3 days ago"`, etc. |

#### Success Response — no scans / no trackers

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "data": []
  }
}
```

---

### `campaign_leaderboard`

Returns the **top 5 campaigns ranked by total QR scans**. Campaigns with zero scans or no PostGrid tracker linked are excluded.

#### Curl — all campaigns, all time

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "c3d4e5f6-a7b8-9012-cdef-123456789012"
    ]
  }'
```

#### Curl — with `last_24hours` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard",
    "last_24hours": true
  }'
```

#### Curl — with `last_week` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard",
    "last_week": true
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard",
    "last_month": true
  }'
```

#### Curl — combined: multiple campaigns + last month

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_leaderboard",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ],
    "last_month": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "leaderboard": [
      {
        "campaign_name": "Campaign Awesome",
        "total_scans": 55,
        "total_postcards_sent": 5000,
        "scan_rate": 1.10,
        "ranking_position": 1
      },
      {
        "campaign_name": "Spring Promo 2024",
        "total_scans": 38,
        "total_postcards_sent": 2000,
        "scan_rate": 1.90,
        "ranking_position": 2
      },
      {
        "campaign_name": "Summer Sale",
        "total_scans": 21,
        "total_postcards_sent": 1500,
        "scan_rate": 1.40,
        "ranking_position": 3
      },
      {
        "campaign_name": "Campaign Awesome 2",
        "total_scans": 15,
        "total_postcards_sent": 100,
        "scan_rate": 15.00,
        "ranking_position": 4
      },
      {
        "campaign_name": "Q4 Outreach",
        "total_scans": 7,
        "total_postcards_sent": 800,
        "scan_rate": 0.88,
        "ranking_position": 5
      }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `leaderboard` | `array` | Up to 5 entries, sorted by `total_scans` descending |
| `leaderboard[].campaign_name` | `string` | Campaign display name |
| `leaderboard[].total_scans` | `number` | Total QR scans from PostGrid `visitCount` |
| `leaderboard[].total_postcards_sent` | `number` | Total postcards sent for this campaign |
| `leaderboard[].scan_rate` | `number` | `(total_scans / total_postcards_sent) × 100`, 2 decimal places |
| `leaderboard[].ranking_position` | `number` | Rank 1–5 (1 = most scans) |

#### Success Response — no campaigns with trackers / no scans

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "leaderboard": []
  }
}
```

---

---

### `scan_trend_by_type`

Shows what fraction of QR scans in each time period came from each campaign target type. The three fractions always sum to 1.0 when at least one scan occurred in that period. All three are 0.0 when there were no scans.

**Campaign target types:**
| DB value | Response key |
|---|---|
| `Location Zone` | `location_zone` |
| `Referral` | `referral` |
| `Addresses List` | `addresses_list` |

Time-based filters are ignored — windows are always:
- `daily_data` — last 7 rolling days (oldest → today), always 7 entries
- `weekly_data` — current month split into fixed week buckets (Week 1–5) up to the current week
- `monthly_data` — last 12 rolling months (oldest → current)

`campaign_ids` filter applies.

#### Curl — all campaigns

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend_by_type"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scan_trend_by_type",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "daily_data": [
      { "date": "2026-04-16", "day": "Thursday",  "total_scans": 8,  "location_zone": { "count": 5, "percentage": 0.625  }, "referral": { "count": 2, "percentage": 0.25   }, "addresses_list": { "count": 1, "percentage": 0.125  } },
      { "date": "2026-04-17", "day": "Friday",    "total_scans": 14, "location_zone": { "count": 8, "percentage": 0.5714 }, "referral": { "count": 4, "percentage": 0.2857 }, "addresses_list": { "count": 2, "percentage": 0.1429 } },
      { "date": "2026-04-18", "day": "Saturday",  "total_scans": 3,  "location_zone": { "count": 2, "percentage": 0.6667 }, "referral": { "count": 1, "percentage": 0.3333 }, "addresses_list": { "count": 0, "percentage": 0.0    } },
      { "date": "2026-04-19", "day": "Sunday",    "total_scans": 0,  "location_zone": { "count": 0, "percentage": 0.0    }, "referral": { "count": 0, "percentage": 0.0    }, "addresses_list": { "count": 0, "percentage": 0.0    } },
      { "date": "2026-04-20", "day": "Monday",    "total_scans": 20, "location_zone": { "count": 12, "percentage": 0.6   }, "referral": { "count": 5,  "percentage": 0.25   }, "addresses_list": { "count": 3, "percentage": 0.15   } },
      { "date": "2026-04-21", "day": "Tuesday",   "total_scans": 12, "location_zone": { "count": 6,  "percentage": 0.5   }, "referral": { "count": 4,  "percentage": 0.3333 }, "addresses_list": { "count": 2, "percentage": 0.1667 } },
      { "date": "2026-04-22", "day": "Wednesday", "total_scans": 4,  "location_zone": { "count": 2,  "percentage": 0.5   }, "referral": { "count": 1,  "percentage": 0.25   }, "addresses_list": { "count": 1, "percentage": 0.25   } }
    ],
    "weekly_data": [
      { "week": "Week 1", "range": "1-7",   "total_scans": 80,  "location_zone": { "count": 44, "percentage": 0.55 }, "referral": { "count": 24, "percentage": 0.3  }, "addresses_list": { "count": 12, "percentage": 0.15   } },
      { "week": "Week 2", "range": "8-14",  "total_scans": 100, "location_zone": { "count": 48, "percentage": 0.48 }, "referral": { "count": 35, "percentage": 0.35 }, "addresses_list": { "count": 17, "percentage": 0.17   } },
      { "week": "Week 3", "range": "15-21", "total_scans": 75,  "location_zone": { "count": 45, "percentage": 0.6  }, "referral": { "count": 21, "percentage": 0.28 }, "addresses_list": { "count": 9,  "percentage": 0.12   } },
      { "week": "Week 4", "range": "22-28", "total_scans": 12,  "location_zone": { "count": 6,  "percentage": 0.5  }, "referral": { "count": 4,  "percentage": 0.3333}, "addresses_list": { "count": 2,  "percentage": 0.1667 } }
    ],
    "monthly_data": [
      { "month": "April",     "total_scans": 210, "location_zone": { "count": 120, "percentage": 0.5714 }, "referral": { "count": 60, "percentage": 0.2857 }, "addresses_list": { "count": 30, "percentage": 0.1429 } },
      { "month": "May",       "total_scans": 185, "location_zone": { "count": 100, "percentage": 0.5405 }, "referral": { "count": 55, "percentage": 0.2973 }, "addresses_list": { "count": 30, "percentage": 0.1622 } },
      { "month": "June",      "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "July",      "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "August",    "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "September", "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "October",   "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "November",  "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "December",  "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "January",   "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "February",  "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } },
      { "month": "March",     "total_scans": 0,   "location_zone": { "count": 0,   "percentage": 0.0    }, "referral": { "count": 0,  "percentage": 0.0    }, "addresses_list": { "count": 0,  "percentage": 0.0    } }
    ]
  }
}
```

> `monthly_data` always returns 12 entries — last 12 rolling months oldest to newest. `daily_data` always returns 7 entries — 7 rolling days ending today.

| Field | Type | Description |
|---|---|---|
| `daily_data` | `array[7]` | Last 7 rolling days ending today, oldest first |
| `daily_data[].date` | `string` | Date string `YYYY-MM-DD` |
| `daily_data[].day` | `string` | Day of week name |
| `weekly_data` | `array[1-5]` | Current month week buckets (Week 1–5) up to current week |
| `weekly_data[].week` | `string` | `"Week 1"` … `"Week 5"` |
| `weekly_data[].range` | `string` | Day range, e.g. `"1-7"`, `"22-28"` |
| `monthly_data` | `array[12]` | Last 12 rolling months oldest to newest |
| `monthly_data[].month` | `string` | Month name, e.g. `"April"` |
| `*.total_scans` | `number` | Raw total QR scans across all types in this period |
| `*.location_zone.count` | `number` | Raw scans from `Location Zone` campaigns |
| `*.location_zone.percentage` | `number` | `scans / postcards_sent_for_type` (0.0–1.0, 4dp) |
| `*.referral.count` | `number` | Raw scans from `Referral` campaigns |
| `*.referral.percentage` | `number` | `scans / postcards_sent_for_type` (0.0–1.0, 4dp) |
| `*.addresses_list.count` | `number` | Raw scans from `Addresses List` campaigns |
| `*.addresses_list.percentage` | `number` | `scans / postcards_sent_for_type` (0.0–1.0, 4dp) |

---

### `postcard_overview`

Per-campaign breakdown of how postcards ended up — delivered and scanned, delivered but not scanned, still in transit, or returned/cancelled. Also returns an aggregate `total_summary` across all campaigns.

**Field definitions:**
- `delivered_and_scanned` — `postgrid_status = completed` AND the postcard's ID appears in PostGrid scan visits (fraction of total sent, 0.0–1.0)
- `delivered_but_not_scanned` — `postgrid_status = completed` AND QR was never scanned (fraction of total sent, 0.0–1.0)
- `in_transit` — `postgrid_status` in `ready`, `printing`, `processed_for_delivery` (raw count)
- `returned_cancelled` — `postgrid_status = cancelled` OR `imb_status = returned_to_sender` (raw count)

Campaigns with no `postgrid_tracker_id` will have `delivered_and_scanned: 0` — all delivered postcards are treated as not-scanned since there is no scan data. `campaign_ids` filter applies.

#### Curl — all campaigns

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "postcard_overview"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "postcard_overview",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ]
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_summary": {
      "delivered_and_scanned": 0.0842,
      "delivered_but_not_scanned": 0.6431,
      "in_transit": 450,
      "returned_cancelled": 87
    },
    "campaign_summary": [
      {
        "campaign_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "campaign_name": "Spring Promotion 2024",
        "delivered_and_scanned": 0.11,
        "delivered_but_not_scanned": 0.62,
        "in_transit": 270,
        "returned_cancelled": 42
      },
      {
        "campaign_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "campaign_name": "Summer Sale Campaign",
        "delivered_and_scanned": 0.055,
        "delivered_but_not_scanned": 0.67,
        "in_transit": 180,
        "returned_cancelled": 45
      }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `total_summary` | `object` | Aggregate across all campaigns |
| `total_summary.delivered_and_scanned` | `number` | Delivered + QR scanned / total sent (0.0–1.0, 4dp) |
| `total_summary.delivered_but_not_scanned` | `number` | Delivered but QR never scanned / total sent (0.0–1.0, 4dp) |
| `total_summary.in_transit` | `number` | Postcards still in the delivery pipeline (raw count) |
| `total_summary.returned_cancelled` | `number` | Postcards returned or cancelled (raw count) |
| `campaign_summary` | `array` | One entry per campaign |
| `campaign_summary[].campaign_id` | `string` | Campaign UUID |
| `campaign_summary[].campaign_name` | `string` | Campaign display name |
| `campaign_summary[].delivered_and_scanned` | `number` | Fraction of this campaign's postcards delivered + scanned (0.0–1.0) |
| `campaign_summary[].delivered_but_not_scanned` | `number` | Fraction delivered but not scanned (0.0–1.0) |
| `campaign_summary[].in_transit` | `number` | In-flight postcard count for this campaign |
| `campaign_summary[].returned_cancelled` | `number` | Returned/cancelled count for this campaign |

#### Success Response — no campaigns

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_summary": {
      "delivered_and_scanned": 0,
      "delivered_but_not_scanned": 0,
      "in_transit": 0,
      "returned_cancelled": 0
    },
    "campaign_summary": []
  }
}
```

---

## Filter Behaviour Notes

---

### `performance_trend`

Returns delivery and scan rate metrics broken down across three rolling time windows. Time-based filters (`last_24hours`, `last_week`, `last_month`) are ignored for this type. `campaign_ids` still applies.

**Windows:**
- `daily_data` — last 7 rolling days ending today, always 7 entries (oldest → today)
- `weekly_data` — current month split into fixed week buckets (Week 1–5) up to the current week
- `monthly_data` — last 12 rolling months ending with the current month (oldest → newest)

**Rates:**
- `delivery_rate` per period = completed postcards created in that period / total postcards created in that period
- `scan_rate` per period = scans that occurred in that period / total postcards sent org-wide (all time)
- `total_volume` = postcards created in that period

#### Curl — all campaigns

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "performance_trend"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "performance_trend",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ]
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "total_delivery_rate": 0.7273,
    "total_scan_rate": 0.0631,
    "daily_data": [
      { "date": "2026-04-16", "day": "Thursday",  "delivery_rate": 0.85, "scan_rate": 0.0018, "total_volume": 120 },
      { "date": "2026-04-17", "day": "Friday",    "delivery_rate": 0.80, "scan_rate": 0.0021, "total_volume": 95  },
      { "date": "2026-04-18", "day": "Saturday",  "delivery_rate": 0.0,  "scan_rate": 0.0003, "total_volume": 0   },
      { "date": "2026-04-19", "day": "Sunday",    "delivery_rate": 0.0,  "scan_rate": 0.0,    "total_volume": 0   },
      { "date": "2026-04-20", "day": "Monday",    "delivery_rate": 0.75, "scan_rate": 0.0015, "total_volume": 80  },
      { "date": "2026-04-21", "day": "Tuesday",   "delivery_rate": 0.80, "scan_rate": 0.0020, "total_volume": 50  },
      { "date": "2026-04-22", "day": "Wednesday", "delivery_rate": 0.60, "scan_rate": 0.0008, "total_volume": 30  }
    ],
    "weekly_data": [
      { "week": "Week 1", "range": "1-7",   "delivery_rate": 0.82, "scan_rate": 0.018, "total_volume": 220 },
      { "week": "Week 2", "range": "8-14",  "delivery_rate": 0.79, "scan_rate": 0.022, "total_volume": 310 },
      { "week": "Week 3", "range": "15-21", "delivery_rate": 0.71, "scan_rate": 0.019, "total_volume": 180 },
      { "week": "Week 4", "range": "22-28", "delivery_rate": 0.80, "scan_rate": 0.004, "total_volume": 50  }
    ],
    "monthly_data": [
      { "month": "April",     "delivery_rate": 0.68, "scan_rate": 0.041, "total_volume": 580 },
      { "month": "May",       "delivery_rate": 0.72, "scan_rate": 0.038, "total_volume": 620 },
      { "month": "June",      "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "July",      "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "August",    "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "September", "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "October",   "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "November",  "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "December",  "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "January",   "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "February",  "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   },
      { "month": "March",     "delivery_rate": 0.0,  "scan_rate": 0.0,   "total_volume": 0   }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `total_delivery_rate` | `number` | Overall delivery rate, all time (0.0–1.0) |
| `total_scan_rate` | `number` | Overall scan rate = total scans / total postcards sent (0.0–1.0) |
| `daily_data` | `array[7]` | Last 7 rolling days ending today, oldest first |
| `daily_data[].date` | `string` | Date string `YYYY-MM-DD` |
| `daily_data[].day` | `string` | Day of week name (`"Monday"` … `"Sunday"`) |
| `daily_data[].delivery_rate` | `number` | Completed / sent on that day (0.0–1.0) |
| `daily_data[].scan_rate` | `number` | Scans on that day / total postcards sent all time (0.0–1.0) |
| `daily_data[].total_volume` | `number` | Postcards created on that day |
| `weekly_data` | `array[1-5]` | Current month week buckets up to current week |
| `weekly_data[].week` | `string` | `"Week 1"` … `"Week 5"` |
| `weekly_data[].range` | `string` | Day range, e.g. `"1-7"`, `"22-28"` |
| `monthly_data` | `array[12]` | Last 12 rolling months, oldest to newest |
| `monthly_data[].month` | `string` | Month name, e.g. `"April"` |

---

---

### `campaign_performance`

Ranks ALL campaigns that have a PostGrid tracker by total QR scans and returns the top 5 (best) and bottom 5 (worst). Rankings are global — rank 1 = most scans, rank N = least. Campaigns with 0 scans are included so that the true worst performers always appear.

If there are 5 or fewer campaigns total, all go into `top_performers` and `bottom_performers` is empty (no overlap).

`scan_rate` is a fraction (0.0–1.0), same as other types.

#### Curl — all campaigns

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_performance"
  }'
```

#### Curl — with `campaign_ids` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_performance",
    "campaign_ids": [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    ]
  }'
```

#### Curl — with `last_month` filter

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_performance",
    "last_month": true
  }'
```

#### Curl — combined: specific campaigns + last week

```bash
curl -X POST https://xnflihspegizweqidvow.supabase.co/functions/v1/getAnalyticsV2 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "campaign_performance",
    "campaign_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    "last_week": true
  }'
```

#### Success Response `200`

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "top_performers": [
      { "campaign_name": "Campaign Awesome",  "total_scans": 55, "total_postcards_sent": 5000, "scan_rate": 0.011,   "ranking_position": 1 },
      { "campaign_name": "Spring Promo 2024", "total_scans": 38, "total_postcards_sent": 2000, "scan_rate": 0.019,   "ranking_position": 2 },
      { "campaign_name": "Summer Sale",       "total_scans": 21, "total_postcards_sent": 1500, "scan_rate": 0.014,   "ranking_position": 3 },
      { "campaign_name": "Fall Outreach",     "total_scans": 15, "total_postcards_sent": 1000, "scan_rate": 0.015,   "ranking_position": 4 },
      { "campaign_name": "Q4 Push",           "total_scans": 7,  "total_postcards_sent": 800,  "scan_rate": 0.00875, "ranking_position": 5 }
    ],
    "bottom_performers": [
      { "campaign_name": "Winter Blast",  "total_scans": 4, "total_postcards_sent": 600, "scan_rate": 0.0067, "ranking_position": 6  },
      { "campaign_name": "Early Bird",    "total_scans": 2, "total_postcards_sent": 400, "scan_rate": 0.005,  "ranking_position": 7  },
      { "campaign_name": "Referral Drive","total_scans": 1, "total_postcards_sent": 250, "scan_rate": 0.004,  "ranking_position": 8  },
      { "campaign_name": "Local Blitz",   "total_scans": 1, "total_postcards_sent": 100, "scan_rate": 0.01,   "ranking_position": 9  },
      { "campaign_name": "Test Campaign", "total_scans": 0, "total_postcards_sent": 50,  "scan_rate": 0.0,    "ranking_position": 10 }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `top_performers` | `array` | Up to 5 best campaigns, ranked 1–5 |
| `bottom_performers` | `array` | Up to 5 worst campaigns, ranked 6–10. Empty if ≤5 campaigns total |
| `[].campaign_name` | `string` | Campaign display name |
| `[].total_scans` | `number` | Total QR scans from PostGrid |
| `[].total_postcards_sent` | `number` | Total postcards sent for this campaign |
| `[].scan_rate` | `number` | `total_scans / total_postcards_sent` (0.0–1.0) |
| `[].ranking_position` | `number` | Global rank — 1 = most scans, 10 = least |

#### Success Response — 5 or fewer campaigns (no bottom performers)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "data": {
    "top_performers": [
      { "campaign_name": "Only Campaign", "total_scans": 12, "total_postcards_sent": 200, "scan_rate": 0.06, "ranking_position": 1 }
    ],
    "bottom_performers": []
  }
}
```

---

### `campaign_ids` with PostGrid-based types

For `scan_trend`, `recent_scans`, and `campaign_leaderboard`, `campaign_ids` scopes which campaign trackers are queried from PostGrid. If a campaign ID in the list has no `postgrid_tracker_id`, it is silently skipped.

### Time filters with PostGrid-based types

When `last_24hours`, `last_week`, or `last_month` is set for `scan_trend`, `recent_scans`, or `campaign_leaderboard`, the function fetches up to **1000 most recent visits** from PostGrid's `/visits` endpoint per tracker and filters in-memory by `createdAt`. Campaigns with more than 1000 total visits may show undercounted results within the time window.

### Time filters with DB-based types

For `dashboard_cards`, `delivery_funnel`, and `waste_meter`, time filters apply a `created_at >= <cutoff>` condition directly on the `postcard_sends` and `payment_history` tables — no approximation.

### `last_24hours` vs `last_week` vs `last_month`

If multiple time flags are passed simultaneously, only the most restrictive window is applied:

```json
{
  "type": "dashboard_cards",
  "last_24hours": true,
  "last_week": true
}
```

The above uses the last 24 hours (ignores `last_week`).
