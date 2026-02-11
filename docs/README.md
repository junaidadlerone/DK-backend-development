# Door Knocker Role-Based Authentication API

Complete role-based authentication system built with Supabase Edge Functions and Supabase Auth.

## Overview

This API provides a secure authentication system with three user roles:
- **ADMIN**: Full system access, can manage all users and create other ADMINs
- **MARKETER**: Marketing-specific permissions
- **TECHNICIAN**: Technical operations permissions (default role)

## Files

- **index.html** - Swagger UI documentation
- **openapi.yaml** - OpenAPI 3.0 specification (updated for role-based auth)
- **README.md** - This file

## Architecture

### Database Schema
- **profiles table**: Stores user roles and profile information (linked to auth.users)
- **Row Level Security (RLS)**: Enforces role-based access control
- **Enum type**: `user_role` for ADMIN, MARKETER, TECHNICIAN

### API Endpoints
1. **POST /signUp** - Register new users with role assignment
2. **POST /login** - Authenticate users and get JWT token
3. **GET /getUser** - Fetch user profile and role information
4. **GET /getAppContent** - Get role-based application content and menu configuration
5. **POST /logout** - Invalidate user session
6. **POST /forgotPassword** - Request password reset email
7. **POST /resetPassword** - Reset password with token
8. **POST /getAnalytics** - Get organization analytics with daily caching (REFERRALS type)

## Setup Instructions

### 1. Prerequisites
- Supabase project created
- Supabase CLI installed: `npm install -g supabase`
- Project linked to Supabase

### 2. Apply Database Migration

Run the SQL migration to create the profiles table and RLS policies:

```bash
# Push migrations to your Supabase project
supabase db push
```

Or manually apply in Supabase Dashboard > SQL Editor:
```sql
-- Copy contents of: supabase/migrations/20250113000001_create_profiles_table.sql
```

### 3. Deploy Edge Functions

Deploy all authentication functions:

```bash
# Deploy all functions
supabase functions deploy signUp
supabase functions deploy login
supabase functions deploy getUser
supabase functions deploy getAppContent
supabase functions deploy logout
supabase functions deploy forgotPassword
supabase functions deploy resetPassword
```

### 4. Create First ADMIN User

Since creating ADMIN users requires ADMIN authentication, manually create the first ADMIN:

**Option A: Via Supabase Dashboard**
1. Go to Authentication > Users
2. Create a new user with email/password
3. Copy the user's UUID
4. Go to Table Editor > profiles
5. Insert: `id` = UUID, `role` = ADMIN, `full_name` = "Admin User"

**Option B: Via SQL**
```sql
-- First create the auth user in Dashboard, then:
INSERT INTO profiles (id, role, full_name)
VALUES ('USER_UUID_HERE', 'ADMIN', 'Admin User');
```

Now this user can create other ADMIN users via the API.

## API Usage Examples

### 1. Sign Up (Create Account)

**Default Role (TECHNICIAN)**
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/signUp \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tech@example.com",
    "password": "SecurePass123!",
    "fullName": "John Technician"
  }'
```

**Create ADMIN User (Requires ADMIN Token)**
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/signUp \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!",
    "fullName": "Admin User",
    "role": "ADMIN"
  }'
```

### 2. Login

```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/login \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tech@example.com",
    "password": "SecurePass123!"
  }'
```

Response:
```json
{
  "status": "success",
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "role": "TECHNICIAN",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "tech@example.com",
    "fullName": "John Technician"
  }
}
```

### 3. Get User Profile

**Get Own Profile**
```bash
curl -X GET https://YOUR-PROJECT.supabase.co/functions/v1/getUser \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Response:
```json
{
  "status": "success",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "tech@example.com",
    "role": "TECHNICIAN",
    "full_name": "John Technician",
    "created_at": "2025-01-13T10:00:00.000Z"
  }
}
```

**Get Another User's Profile (ADMIN only)**
```bash
curl -X GET "https://YOUR-PROJECT.supabase.co/functions/v1/getUser?user_id=660e8400-e29b-41d4-a716-446655440001" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

### 4. Logout

```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/logout \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. Forgot Password

```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/forgotPassword \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "tech@example.com"}'
```

### 6. Get App Content (Role-based Menu Configuration)

```bash
curl -X GET https://YOUR-PROJECT.supabase.co/functions/v1/getAppContent \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**ADMIN User Response:**
```json
{
  "data": {
    "menu_items": [
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
        "description": "Manage Your Account Settings",
        "id": 9,
        "enabled": true,
        "extended": false,
        "extended_options": []
      }
    ]
  }
}
```

**MARKETER User Response** (Limited features):
```json
{
  "data": {
    "menu_items": [
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
        "extended_options": []
      },
      {
        "name": "analytics",
        "title": "Analytics", 
        "description": "",
        "id": 6,
        "enabled": true,
        "extended": true,
        "extended_options": []
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
    ]
  }
}
```

**TECHNICIAN User Response** (Referrals only):
```json
{
  "data": {
    "menu_items": [
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
        "name": "notifications",
        "title": "Notifications",
        "description": "",
        "id": 8,
        "enabled": true,
        "extended": false,
        "extended_options": []
      }
    ]
  }
}
```

### 7. Reset Password

```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/resetPassword \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "TOKEN_FROM_EMAIL",
    "newPassword": "NewSecurePass123!"
  }'
```

## Security Features

- **Role-Based Access Control**: Only ADMINs can create other ADMINs
- **Organization-Based Content**: App content scoped to user's organization
- **Dynamic Menu Generation**: Menu items filtered by user role
- **Row Level Security**: Database-level access control
- **Password Security**: Managed by Supabase Auth (bcrypt)
- **JWT Tokens**: Secure session management
- **Email Enumeration Prevention**: Forgot password always returns success

## Role-Based Features Access

| Feature | ADMIN | MARKETER | TECHNICIAN |
|---------|-------|----------|------------|
| Search | ✅ | ✅ | ✅ (Limited) |
| Dashboard | ✅ | ✅ | ✅ |
| Referrals | ✅ | ✅ | ✅ |
| Campaigns | ✅ | ✅ | ❌ |
| Templates | ✅ | ❌ | ❌ |
| Targeting | ✅ | ✅ | ❌ |
| Analytics | ✅ | ✅ | ❌ |
| Quick Actions | ✅ Full | ✅ Limited | ✅ Referrals Only |
| Notifications | ✅ | ✅ | ✅ |
| Settings | ✅ | ❌ | ❌ |
| Integrations | ✅ | ❌ | ❌ |

## Error Codes

| Code | Description |
|------|-------------|
| INVALID_INPUT | Missing or invalid parameters |
| INVALID_EMAIL | Invalid email format |
| WEAK_PASSWORD | Password < 8 characters |
| INVALID_ROLE | Invalid role specified |
| EMAIL_EXISTS | Email already registered |
| INVALID_CREDENTIALS | Wrong email/password |
| UNAUTHORIZED | Missing/invalid auth |
| FORBIDDEN | Insufficient permissions |
| INVALID_TOKEN | Token invalid/expired |
| USER_NOT_FOUND | Requested user does not exist |
| PROFILE_NOT_FOUND | User profile not found |
| NO_ORGANIZATION | User not associated with organization |
| CONTENT_FETCH_FAILED | Failed to fetch app content |
| CONTENT_NOT_FOUND | App content not found for user role |

## Enhanced Address Fields

The address-related APIs (`/getAddressesFromZone`, `/verifyAddresses`, `/getAddressZoneById`, etc.) now return enhanced address objects with additional tracking and metadata fields:

### New Address Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `propertyType` | string | Type of property based on building classification | "Single Family Home", "Office Building" |
| `distanceFromCenter` | number | Distance from search center point in meters | 847 |
| `targeting_zone_name` | string | Human-readable name of the targeting zone | "Mountain View, CA Area" |
| `campaigns_used_in` | string[] | Array of campaign names that have used this address | `["Summer 2024 Campaign"]` |
| `zoneType` | string | Type of zone search performed | "radius(1.0km)" or "point(50 addresses)" |
| `postcards_sent` | number | Number of postcards sent to this address | 0 |
| `first_post_card_sent_date` | string\|null | ISO date when first postcard was sent | "2024-01-15T10:30:00.000Z" |
| `status` | enum | Verification status of address | "Valid", "Duplicate", "Opt-out", "Unverified" |
| `createdBy` | object | Information about user who created/modified the address | See below |

#### createdBy Field Structure

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string (uuid) | User ID | "98a88548-47d3-470d-ac40-ba10c9881d98" |
| `user_role` | enum | User role (ADMIN, MARKETER, TECHNICIAN) | "ADMIN" |
| `full_name` | string\|null | Full name of the user | "Admin User" |
| `created_at` | string (ISO date) | When user profile was created | "2025-01-13T10:00:00.000Z" |
| `updated_at` | string (ISO date) | When user profile was last updated | "2025-01-13T10:00:00.000Z" |

### Address Status Values

- **UnVerified**: Default state, address not yet verified
- **Valid**: Address verified through PostGrid API (`/verifyAddresses`)
- **Duplicate**: Address already exists in another zone  
- **Opt-out**: Address manually marked as opted out

### Enhanced Response Example

```json
{
  "status": "success",
  "message": "Found 115 addresses",
  "addresses": [
    {
      "lat": 37.4176671,
      "long": -122.0928876,
      "address": "901, North Rengstorff Avenue",
      "residential": true,
      "building_type": "residential",
      "osm_id": "166790593",
      "propertyType": "Residential Building",
      "distanceFromCenter": 847,
      "targeting_zone_name": "Mountain View, CA Area",
      "campaigns_used_in": [],
      "zoneType": "radius(1.0km)",
      "postcards_sent": 0,
      "first_post_card_sent_date": null,
      "status": "UnVerified",
      "createdBy": {
        "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
        "user_role": "ADMIN",
        "full_name": "Admin User",
        "created_at": "2025-01-13T10:00:00.000Z",
        "updated_at": "2025-01-13T10:00:00.000Z"
      }
    }
  ]
}
```

**Note**: All request body formats remain unchanged - these are response-only enhancements.

## Get All Addresses API

The `/getAllAddresses` endpoint retrieves all addresses from all location zones in the user's organization with optional filtering capabilities.

### Endpoint

- **URL**: `/getAllAddresses`
- **Methods**: GET, POST
- **Authentication**: Required (Bearer Token)

### Features

- Returns addresses from all zones in the organization
- Optional filtering to show only non-Valid addresses (exclusions)
- Automatic deduplication based on lat/lng coordinates
- Includes zone metadata for each address
- Detailed status breakdown and metadata

### Request Methods

**GET Request** - Returns all addresses (default behavior):
```bash
curl -X GET https://YOUR-PROJECT.supabase.co/functions/v1/getAllAddresses \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**POST Request** - Supports filtering with request body:
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/getAllAddresses \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "showOnlyExclusions": true
  }'
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `showOnlyExclusions` | boolean | false | If true, returns only addresses with status other than 'Valid' (UnVerified, Duplicate, Opt-out) |

### Response Format

```json
{
  "status": "success",
  "message": "Found 150 unique addresses from 3 zones",
  "metadata": {
    "total_zones": 3,
    "total_addresses_before_dedup": 152,
    "total_addresses_after_dedup": 150,
    "addresses_returned": 150,
    "showOnlyExclusions": false,
    "status_breakdown": {
      "Valid": 120,
      "UnVerified": 25,
      "Duplicate": 3,
      "Opt-out": 2
    },
    "processingTimeMs": 150
  },
  "addresses": [
    {
      "lat": 37.4176671,
      "long": -122.0928876,
      "address": "901, North Rengstorff Avenue",
      "residential": true,
      "building_type": "residential",
      "osm_id": "166790593",
      "propertyType": "Residential Building",
      "distanceFromCenter": 847,
      "targeting_zone_name": "Mountain View Zone",
      "campaigns_used_in": ["Summer 2024 Campaign"],
      "zoneType": "radius(1.0km)",
      "postcards_sent": 0,
      "first_post_card_sent_date": null,
      "status": "Valid",
      "zone_id": "c9abd41e-56a2-448e-942c-a0b37f796972",
      "zone_name": "Mountain View Zone",
      "campaign_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6"
    }
  ]
}
```

### Additional Address Fields

Each address in the response includes zone-specific metadata:

| Field | Type | Description |
|-------|------|-------------|
| `zone_id` | string (uuid) | ID of the zone this address belongs to |
| `zone_name` | string | Name of the zone this address belongs to |
| `campaign_id` | string (uuid) \| null | Campaign ID associated with the zone |

### Filtering Logic

- **showOnlyExclusions = false** (default): Returns all addresses regardless of status
- **showOnlyExclusions = true**: Returns only addresses with non-Valid status:
  - UnVerified
  - Duplicate
  - Opt-out

### Example: Get Only Exclusions

**Request:**
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/getAllAddresses \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "showOnlyExclusions": true
  }'
```

**Response:**
```json
{
  "status": "success",
  "message": "Found 30 addresses with non-Valid status (30 total exclusions)",
  "metadata": {
    "total_zones": 3,
    "total_addresses_before_dedup": 152,
    "total_addresses_after_dedup": 150,
    "addresses_returned": 30,
    "showOnlyExclusions": true,
    "status_breakdown": {
      "Valid": 0,
      "UnVerified": 25,
      "Duplicate": 3,
      "Opt-out": 2
    },
    "processingTimeMs": 120
  },
  "addresses": [...]
}
```

### Business Rules

1. **Organization Scope**: Only returns addresses from zones in the user's organization
2. **Deduplication**: Addresses are automatically deduplicated based on lat/lng coordinates
3. **Zone Metadata**: Each address includes information about the zone it belongs to
4. **Status Tracking**: Provides detailed breakdown of address statuses
5. **Performance**: Returns processing time for monitoring

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | User not in organization |
| 500 | Internal Server Error | Database or processing error |

### Use Cases

1. **Global Address Review**: View all addresses across all campaigns and zones
2. **Exclusion Management**: Filter to see only problematic addresses (duplicates, unverified, opt-outs)
3. **Data Quality**: Monitor address verification status across organization
4. **Compliance**: Track opt-outs across all zones
5. **Analytics**: Analyze address distribution and status across organization

## Exclude Address API

The `/excludeAddress` endpoint opts out an address across all zones accessible to the user by changing its status to 'Opt-out'.

### Endpoint

- **URL**: `/excludeAddress`
- **Method**: POST
- **Authentication**: Required (Bearer Token)

### Features

- Takes a complete address object in request body
- Searches for the address across all zones in user's organization
- Changes status to 'Opt-out' wherever the address is found
- Matches addresses based on lat/lng coordinates with high precision
- Returns list of zones where address was updated
- Supports matching addresses across multiple zones simultaneously

### Request Format

**POST Request**:
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/excludeAddress \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "address": {
      "lat": 37.4176671,
      "long": -122.0928876,
      "address": "901, North Rengstorff Avenue",
      "residential": true,
      "building_type": "residential",
      "osm_id": "166790593",
      "propertyType": "Residential Building",
      "distanceFromCenter": 933,
      "targeting_zone_name": "Zone at 37.4225, -122.0842",
      "campaigns_used_in": [],
      "zoneType": "radius(1.0km)",
      "postcards_sent": 0,
      "first_post_card_sent_date": null,
      "status": "UnVerified",
      "zone_id": "1b503442-f07e-4aaa-800e-b151d0a1e37d",
      "zone_name": "Zone at 37.4225, -122.0842",
      "campaign_id": "1c650d6f-a29c-4667-9f17-5709765ba34f"
    }
  }'
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | object | Yes | Complete address object to be excluded |
| `address.lat` | number | Yes | Latitude coordinate |
| `address.long` | number | Yes | Longitude coordinate |
| `address.address` | string | No | Street address |
| `address.*` | various | No | All other address fields (optional) |

### Response Format

**Success Response (Address Found)**:
```json
{
  "status": "success",
  "message": "Address successfully excluded in 1 zone(s)",
  "address": {
    "lat": 37.4176671,
    "long": -122.0928876,
    "address": "901, North Rengstorff Avenue"
  },
  "zonesSearched": 1,
  "zonesUpdated": [
    {
      "zone_id": "1b503442-f07e-4aaa-800e-b151d0a1e37d",
      "zone_name": "Zone at 37.4225, -122.0842",
      "campaign_id": "1c650d6f-a29c-4667-9f17-5709765ba34f",
      "addresses_updated": 1
    }
  ],
  "addressesUpdated": 1,
  "processingTimeMs": 817
}
```

**Success Response (Address Not Found)**:
```json
{
  "status": "success",
  "message": "Address not found in any accessible zones",
  "zonesSearched": 5,
  "zonesUpdated": [],
  "addressesUpdated": 0,
  "processingTimeMs": 320
}
```

**Success Response (Multiple Zones Updated)**:
```json
{
  "status": "success",
  "message": "Address successfully excluded in 3 zone(s)",
  "address": {
    "lat": 37.4176671,
    "long": -122.0928876,
    "address": "901, North Rengstorff Avenue"
  },
  "zonesSearched": 5,
  "zonesUpdated": [
    {
      "zone_id": "1b503442-f07e-4aaa-800e-b151d0a1e37d",
      "zone_name": "Zone A",
      "campaign_id": "1c650d6f-a29c-4667-9f17-5709765ba34f",
      "addresses_updated": 1
    },
    {
      "zone_id": "2c513552-g18f-5bbb-911f-c262e1b2f48e",
      "zone_name": "Zone B",
      "campaign_id": "2d761e7g-b3ad-5778-a28g-6810876cb56g",
      "addresses_updated": 1
    },
    {
      "zone_id": "3d624663-h29g-6ccc-a22g-d373f2c3g59f",
      "zone_name": "Zone C",
      "campaign_id": null,
      "addresses_updated": 1
    }
  ],
  "addressesUpdated": 3,
  "processingTimeMs": 1245
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Response status ("success" or "error") |
| `message` | string | Human-readable message |
| `address` | object | Summary of the excluded address (lat, long, address) |
| `zonesSearched` | integer | Total number of zones searched |
| `zonesUpdated` | array | List of zones where address was found and updated |
| `zonesUpdated[].zone_id` | string (uuid) | ID of the updated zone |
| `zonesUpdated[].zone_name` | string | Name of the updated zone |
| `zonesUpdated[].campaign_id` | string (uuid) \| null | Associated campaign ID |
| `zonesUpdated[].addresses_updated` | integer | Number of addresses updated in this zone |
| `addressesUpdated` | integer | Total number of address instances updated |
| `processingTimeMs` | integer | Processing time in milliseconds |

### Matching Logic

- **Coordinate Matching**: Uses lat/lng coordinates with tolerance of ±0.000001 degrees
- **Precision**: Approximately 0.1 meter precision for address matching
- **Multi-Zone Support**: Updates all matching addresses found in any zone
- **Status Change**: Changes status from any current status to 'Opt-out'

### Business Rules

1. **Organization Scope**: Only searches zones in the user's organization
2. **Global Exclusion**: Updates address in all zones where it appears
3. **Coordinate-Based**: Matching is based on coordinates, not string address
4. **Idempotent**: Running multiple times is safe (already opted-out addresses remain opted-out)
5. **Atomic Updates**: All zone updates succeed or fail together

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing address object or invalid coordinates |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | User not in organization |
| 405 | METHOD_NOT_ALLOWED | Only POST method is allowed |
| 500 | Internal Server Error | Database or processing error |

### Error Examples

**Missing Address Object**:
```json
{
  "error": "INVALID_INPUT",
  "message": "Missing 'address' object in request body"
}
```

**Invalid Coordinates**:
```json
{
  "error": "INVALID_INPUT",
  "message": "Address must have valid 'lat' and 'long' coordinates"
}
```

### Use Cases

1. **User Opt-Out**: User requests to stop receiving marketing materials at their address
2. **Compliance**: Handle do-not-contact requests in compliance with regulations
3. **Global Exclusion**: Blacklist an address across all campaigns and zones
4. **Address Cleanup**: Remove problematic addresses from targeting
5. **Privacy Management**: Honor user privacy preferences across organization

### Integration Example

**Frontend Integration**:
```javascript
async function excludeAddress(addressObject, authToken) {
  const response = await fetch(
    'https://YOUR-PROJECT.supabase.co/functions/v1/excludeAddress',
    {
      method: 'POST',
      headers: {
        'apikey': 'YOUR_ANON_KEY',
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: addressObject
      })
    }
  );

  const result = await response.json();

  if (result.status === 'success') {
    console.log(`Address excluded in ${result.zonesUpdated.length} zone(s)`);
    console.log(`Total addresses updated: ${result.addressesUpdated}`);
  }

  return result;
}
```

### Best Practices

1. **Complete Address Object**: Pass the complete address object from `getAllAddresses` response
2. **Coordinate Accuracy**: Ensure lat/lng coordinates have sufficient precision (6 decimal places)
3. **User Confirmation**: Ask for user confirmation before excluding an address
4. **Audit Trail**: Log exclusion requests for compliance and auditing
5. **Notification**: Notify relevant stakeholders when addresses are excluded
6. **Verify Results**: Check `addressesUpdated` to confirm the operation succeeded

---

## Add Address To Zone By ID API

### Endpoint
`POST /addAddressToZoneById`

### Description
Adds a single address to an existing location zone after validating and geocoding it using Google Maps API. This endpoint is useful for manually adding specific addresses to a targeting zone.

### Features
- **Address Validation**: Validates address using Google Maps Geocoding API
- **Automatic Formatting**: Formats address to match zone's address structure
- **Organization Scoped**: Zone must belong to user's organization
- **Duplicate Detection**: Checks for duplicate addresses (same lat/lng)
- **Distance Calculation**: Automatically calculates distance from zone center
- **Status Assignment**: Marks new address as "UnVerified"
- **Full Metadata**: Generates complete address object with all tracking fields

### Request Method
- **POST**: Send address components and zone ID in request body

### Request Body

```json
{
  "zone_id": "c9abd41e-56a2-448e-942c-a0b37f796972",
  "street_address": "1024 Alta Ave",
  "city": "Mountain View",
  "state": "CA",
  "zip": "94043",
  "googleMapsApiKey": "AIzaSyDummyKey123456789"
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `zone_id` | string (uuid) | ID of the zone to add address to |
| `street_address` | string | Street address (number and street name) |
| `city` | string | City name |
| `state` | string | State abbreviation (e.g., "CA") |
| `zip` | string | ZIP code |
| `googleMapsApiKey` | string | Google Maps API key for geocoding |

### Response Format

#### Success Response (201 Created)

```json
{
  "status": "success",
  "message": "Address added to zone successfully",
  "data": {
    "zone_id": "c9abd41e-56a2-448e-942c-a0b37f796972",
    "address_added": {
      "lat": 37.4190968,
      "long": -122.0856435,
      "address": "1024 Alta Ave, Mountain View, CA 94043, USA",
      "residential": true,
      "building_type": "house",
      "osm_id": "",
      "propertyType": "Single Family Home",
      "distanceFromCenter": 396,
      "targeting_zone_name": "Zone at 37.4225, -122.0842",
      "campaigns_used_in": [],
      "zoneType": "radius(0.6km)",
      "postcards_sent": 0,
      "first_post_card_sent_date": null,
      "status": "UnVerified",
      "createdBy": {
        "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
        "user_role": "ADMIN",
        "full_name": "Admin User",
        "created_at": "2025-11-20T16:58:32.847402+00:00",
        "updated_at": "2025-11-20T16:58:32.847402+00:00"
      }
    },
    "total_addresses": 15
  },
  "processingTimeMs": 350
}
```

### Business Rules

1. **Authentication Required**: Valid JWT token must be provided
2. **Organization Verification**: User must be associated with an organization
3. **Zone Ownership**: Zone must belong to user's organization
4. **Address Validation**: Address is validated and geocoded via Google Maps
5. **Duplicate Prevention**: Prevents adding addresses with same lat/lng
6. **Automatic Metadata**: System generates all required address metadata
7. **Status Assignment**: New addresses always start as "UnVerified"

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing or invalid required fields |
| 400 | INVALID_ADDRESS | Address could not be validated or found |
| 400 | DUPLICATE_ADDRESS | Address already exists in zone (same coordinates) |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 403 | GOOGLE_MAPS_API_ERROR | Google Maps API key is invalid or denied |
| 404 | ZONE_NOT_FOUND | Zone not found or doesn't belong to organization |
| 500 | GOOGLE_MAPS_API_ERROR | Failed to connect to Google Maps API |
| 500 | INTERNAL_ERROR | Unexpected server error |

### Example Usage

```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/addAddressToZoneById \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zone_id": "c9abd41e-56a2-448e-942c-a0b37f796972",
    "street_address": "1024 Alta Ave",
    "city": "Mountain View",
    "state": "CA",
    "zip": "94043",
    "googleMapsApiKey": "YOUR_GOOGLE_MAPS_API_KEY"
  }'
```

### Use Cases

1. **Manual Address Addition**: Add specific addresses that weren't found by radius/count search
2. **Customer Requests**: Add addresses requested by customers or sales team
3. **Address Correction**: Replace invalid addresses with manually verified ones
4. **Targeted Marketing**: Add high-value addresses to existing campaigns
5. **Gap Filling**: Fill geographic gaps in zone coverage
6. **List Import**: Import addresses from external lists one at a time

### Google Maps API Setup

To use this endpoint, you need a Google Maps API key with Geocoding API enabled:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable "Geocoding API"
4. Create credentials (API Key)
5. Restrict the key to Geocoding API for security
6. Use the key in `googleMapsApiKey` field

### Address Components Accepted

The API accepts standard US address format:
- **Street Address**: Full street number and name (e.g., "1024 Alta Ave")
- **City**: City name (e.g., "Mountain View")
- **State**: Two-letter state code (e.g., "CA")
- **ZIP**: 5-digit or 9-digit ZIP code (e.g., "94043" or "94043-1234")

The Google Maps API will:
- Validate the address exists
- Standardize the format
- Provide accurate geocoding (lat/lng)
- Return formatted address string

### Property Type Detection

The system automatically determines property type based on Google Maps data:
- **Single Family Home**: Standard residential addresses
- **Apartment/Condo**: Multi-unit residential (subpremise)
- **Commercial**: Business establishments
- **Unknown**: Could not be determined

### Distance Calculation

Distance from zone center is calculated using the Haversine formula:
- Measured in meters
- Accounts for Earth's curvature
- Rounded to nearest meter
- Used for sorting and filtering

### Notes

- **Residential Flag**: Automatically set based on Google Maps property types
- **Building Type**: Set to "house" for residential, "commercial" for others
- **OSM ID**: Not available from Google Maps (left empty)
- **Zone Type**: Inherited from parent zone (e.g., "radius(0.6km)")
- **Targeting Zone Name**: Auto-generated from zone center coordinates
- **Created By**: Captured from authenticated user profile

---

## Template Management APIs

The template management APIs allow you to create, retrieve, and delete PostGrid templates for your postcards. All templates are organization-scoped.

**Campaign Integration:** When templates are used in campaigns (via `/createCampaign` Step 2), the campaign name is automatically added to the template's `campaigns_used` array. The Step 2 endpoint accepts both database UUIDs and PostGrid template IDs for flexible template selection.

### Create New Template API

The `/createNewTemplate` endpoint creates a template in PostGrid and saves it to the database.

#### Endpoint

- **URL**: `/createNewTemplate`
- **Method**: POST
- **Authentication**: Required (Bearer Token)

#### Request Body

```json
{
  "postgridApiKey": "live_sk_...",
  "description": "Summer Campaign Front Template",
  "html": "<b>Hello</b> {{to.firstName}}!",
  "templateType": "Front",
  "postcardSize": "4x6"
}
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `postgridApiKey` | string | Yes | PostGrid API key for authentication |
| `description` | string | Yes | Template description |
| `html` | string | Yes | HTML content for the template |
| `templateType` | enum | Yes | Template type: "Front" or "Back" |
| `postcardSize` | enum | Yes | Postcard size: "4x6", "6x9", or "6x11" |

#### Response

```json
{
  "status": "success",
  "message": "Template created successfully",
  "template": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "postgrid_template_id": "template_tBnVEzz878mXLbHQaz86j8",
    "description": "Summer Campaign Front Template",
    "html": "<b>Hello</b> {{to.firstName}}!",
    "templateType": "Front",
    "postcardSize": "4x6",
    "campaigns_used": [],
    "createdBy": {
      "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
      "user_role": "ADMIN",
      "full_name": "Admin User",
      "created_at": "2025-01-13T10:00:00.000Z",
      "updated_at": "2025-01-13T10:00:00.000Z"
    },
    "live": false,
    "deleted": false,
    "created_at": "2025-02-02T10:00:00.000Z",
    "updated_at": "2025-02-02T10:00:00.000Z"
  },
  "processingTimeMs": 1523
}
```

### Get All Templates API

The `/getAllTemplates` endpoint returns all templates for the user's organization.

#### Endpoint

- **URL**: `/getAllTemplates`
- **Method**: GET
- **Authentication**: Required (Bearer Token)

#### Query Parameters (Optional)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeDeleted` | boolean | false | Include deleted templates |
| `templateType` | enum | null | Filter by "Front" or "Back" |
| `postcardSize` | enum | null | Filter by "4x6", "6x9", or "6x11" |

#### Example Request

```bash
curl -X GET 'https://YOUR-PROJECT.supabase.co/functions/v1/getAllTemplates?templateType=Front&postcardSize=4x6' \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Response

```json
{
  "status": "success",
  "message": "Found 5 template(s)",
  "metadata": {
    "total_templates": 5,
    "filters_applied": {
      "includeDeleted": false,
      "templateType": "Front",
      "postcardSize": "4x6"
    },
    "processingTimeMs": 245
  },
  "templates": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "postgrid_template_id": "template_tBnVEzz878mXLbHQaz86j8",
      "description": "Summer Campaign Front Template",
      "html": "<b>Hello</b> {{to.firstName}}!",
      "templateType": "Front",
      "postcardSize": "4x6",
      "campaigns_used": ["Summer 2024 Campaign"],
      "createdBy": {
        "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
        "user_role": "ADMIN",
        "full_name": "Admin User",
        "created_at": "2025-01-13T10:00:00.000Z",
        "updated_at": "2025-01-13T10:00:00.000Z"
      },
      "live": false,
      "deleted": false,
      "created_at": "2025-02-02T10:00:00.000Z",
      "updated_at": "2025-02-02T10:00:00.000Z"
    }
  ]
}
```

### Delete Template API

The `/deleteTemplate` endpoint deletes a template from both PostGrid and the database.

#### Endpoint

- **URL**: `/deleteTemplate`
- **Method**: POST
- **Authentication**: Required (Bearer Token)

#### Request Body

```json
{
  "templateId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "postgridApiKey": "live_sk_..."
}
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateId` | string (uuid) | Yes | Template ID to delete |
| `postgridApiKey` | string | Yes | PostGrid API key |

#### Response

```json
{
  "status": "success",
  "message": "Template deleted successfully",
  "template": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "postgrid_template_id": "template_tBnVEzz878mXLbHQaz86j8",
    "description": "Summer Campaign Front Template"
  },
  "processingTimeMs": 892
}
```

### Template Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (uuid) | Database template ID |
| `postgrid_template_id` | string | PostGrid template ID |
| `description` | string | Template description |
| `html` | string | HTML content |
| `templateType` | enum | "Front" or "Back" |
| `postcardSize` | enum | "4x6", "6x9", or "6x11" |
| `campaigns_used` | array | List of campaign names using this template |
| `createdBy` | object | User who created the template |
| `live` | boolean | Whether template is live in PostGrid |
| `deleted` | boolean | Whether template is deleted |
| `created_at` | string (ISO date) | Creation timestamp |
| `updated_at` | string (ISO date) | Last update timestamp |

### Business Rules

1. **Organization Scope**: Templates belong to organizations
2. **PostGrid Integration**: Creates actual templates in PostGrid
3. **Soft Delete**: Deletion marks template as deleted but preserves data
4. **Campaign Tracking**: Tracks which campaigns use each template
5. **Creator Attribution**: Stores who created each template

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing or invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | User not in organization |
| 404 | TEMPLATE_NOT_FOUND | Template not found or doesn't belong to organization |
| 500 | POSTGRID_API_ERROR | PostGrid API error |
| 500 | DATABASE_ERROR | Database operation error |

### Use Cases

1. **Campaign Creation**: Create templates for postcard front and back
2. **Template Library**: Maintain reusable templates for marketing campaigns
3. **Brand Consistency**: Standardize postcard designs across campaigns
4. **Template Management**: Organize and track template usage
5. **Multi-Size Support**: Create templates for different postcard sizes

---

## Update Template API

### Endpoint
`POST /updateTemplate`

### Description
Updates a template in both PostGrid and the database. Supports partial updates - you only need to provide the fields you want to update.

### Features
- **Dual ID Support**: Accepts both database UUID and PostGrid template ID
- **Organization Scoped**: Templates must belong to user's organization
- **Partial Updates**: Update only html, description, or both
- **Sync with PostGrid**: Updates PostGrid first, then database
- **Validation**: Cannot update deleted templates

### Request Method
- **POST** or **PATCH**: Send update data in request body

### Request Body

```json
{
  "postgridApiKey": "live_sk_...",
  "templateId": "template_tBnVEzz878mXLbHQaz86j8",
  "html": "<b>Hello</b> updated world!",
  "description": "Updated template description"
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `postgridApiKey` | string | PostGrid API key for authentication |
| `templateId` | string | Template ID (database UUID or PostGrid ID) |

### Optional Fields (at least one required)

| Field | Type | Description |
|-------|------|-------------|
| `html` | string | Updated HTML content for the template |
| `description` | string | Updated description for the template |

### Response Format

#### Success Response (200 OK)

```json
{
  "status": "success",
  "message": "Template updated successfully",
  "template": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "postgrid_template_id": "template_tBnVEzz878mXLbHQaz86j8",
    "description": "Updated template description",
    "html": "<b>Hello</b> updated world!",
    "templateType": "Front",
    "postcardSize": "4x6",
    "campaigns_used": ["Summer Campaign 2025"],
    "createdBy": {
      "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
      "user_role": "ADMIN",
      "full_name": "Admin User",
      "created_at": "2025-01-13T10:00:00.000Z",
      "updated_at": "2025-01-13T10:00:00.000Z"
    },
    "live": true,
    "deleted": false,
    "created_at": "2025-02-02T10:00:00.000Z",
    "updated_at": "2025-02-02T15:30:00.000Z"
  },
  "processingTimeMs": 892
}
```

### Template ID Flexibility

The API automatically detects the type of ID provided:
- **UUID Format** (e.g., `a7b3c4d5-e6f7-8901-2345-6789abcdef01`): Looks up by database `id`
- **Non-UUID Format** (e.g., `template_abc123xyz`): Looks up by `postgrid_template_id`

### Business Rules

1. **Organization Verification**: Template must belong to user's organization
2. **Deleted Templates**: Cannot update templates marked as deleted (returns 410)
3. **Partial Updates**: Provide only the fields you want to update
4. **PostGrid First**: Updates PostGrid template before updating database
5. **Atomic Operations**: If PostGrid update fails, database is not updated

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing required fields or no update fields provided |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 404 | TEMPLATE_NOT_FOUND | Template not found or doesn't belong to organization |
| 410 | TEMPLATE_DELETED | Cannot update a deleted template |
| 500 | POSTGRID_API_ERROR | PostGrid API error |
| 500 | DATABASE_ERROR | Database update error |

### Example Usage

#### Update HTML Only (Using Database UUID)
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/updateTemplate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "live_sk_...",
    "templateId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "html": "<b>Hello</b> updated world!"
  }'
```

#### Update Description Only (Using PostGrid Template ID)
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/updateTemplate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "live_sk_...",
    "templateId": "template_tBnVEzz878mXLbHQaz86j8",
    "description": "Updated Summer Campaign Front Template"
  }'
```

#### Update Both HTML and Description
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/updateTemplate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "live_sk_...",
    "templateId": "template_tBnVEzz878mXLbHQaz86j8",
    "html": "<b>Hello</b> updated world!",
    "description": "Updated template with new content"
  }'
```

### Use Cases

1. **Content Updates**: Modify template HTML for design changes
2. **Description Changes**: Update template descriptions for better organization
3. **Template Refinement**: Iterate on template designs based on campaign results
4. **Bulk Updates**: Programmatically update multiple templates
5. **Version Control**: Update templates while maintaining campaign associations

### Notes

- Updates are applied to both PostGrid and database atomically
- The `updated_at` timestamp is automatically updated
- The `live` status from PostGrid is synced to database
- Template type and postcard size cannot be changed after creation
- Campaigns using this template will use the updated version

---

## Get Template by ID API

### Endpoint
`POST /getTemplateById`

### Description
Retrieves a single template by either its database UUID or PostGrid template ID. The API automatically detects which type of ID is provided.

### Features
- **Dual ID Support**: Accepts both database UUID and PostGrid template ID
- **Organization Scoped**: Returns only templates belonging to user's organization
- **Deleted Template Detection**: Returns 410 status if template is marked as deleted
- **Authentication Required**: Uses JWT token from Authorization header

### Request Method
- **POST**: Send template ID in request body

### Request Body

**Using Database UUID:**
```json
{
  "templateId": "a7b3c4d5-e6f7-8901-2345-6789abcdef01"
}
```

**Using PostGrid Template ID:**
```json
{
  "templateId": "template_abc123xyz"
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Response Format

#### Success Response (200 OK)

```json
{
  "status": "success",
  "message": "Template retrieved successfully",
  "template": {
    "id": "a7b3c4d5-e6f7-8901-2345-6789abcdef01",
    "postgrid_template_id": "template_abc123xyz",
    "description": "Front side template for spring campaign",
    "html": "<html><body>...</body></html>",
    "templateType": "Front",
    "postcardSize": "6x9",
    "campaigns_used": ["Spring Sale 2025", "March Promotion"],
    "createdBy": {
      "id": "98a88548-47d3-470d-ac40-ba10c9881d98",
      "user_role": "ADMIN",
      "full_name": "Admin User",
      "created_at": "2025-01-13T10:00:00.000Z",
      "updated_at": "2025-01-13T10:00:00.000Z"
    },
    "live": true,
    "deleted": false,
    "created_at": "2025-02-01T14:30:00.000Z",
    "updated_at": "2025-02-01T14:30:00.000Z"
  },
  "processingTimeMs": 245
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `templateId` | string | Either database UUID or PostGrid template ID |

**Response Fields**: See [Template Fields](#template-fields) section above for complete field descriptions.

### ID Type Detection

The API automatically determines the ID type:
- **UUID Format** (e.g., `a7b3c4d5-e6f7-8901-2345-6789abcdef01`): Queries by database `id`
- **Non-UUID Format** (e.g., `template_abc123xyz`): Queries by `postgrid_template_id`

### Business Rules

1. **Organization Verification**: Template must belong to user's organization
2. **Deleted Templates**: Returns 410 Gone status if template is deleted
3. **Authentication Required**: Valid JWT token must be provided
4. **Flexible ID Lookup**: Supports both internal and external ID references

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing or invalid templateId |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 404 | TEMPLATE_NOT_FOUND | Template not found or doesn't belong to organization |
| 410 | TEMPLATE_DELETED | Template has been deleted |
| 500 | DATABASE_ERROR | Database operation error |

### Example Usage

#### Using Database UUID
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getTemplateById \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "a7b3c4d5-e6f7-8901-2345-6789abcdef01"
  }'
```

#### Using PostGrid Template ID
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getTemplateById \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "template_abc123xyz"
  }'
```

### Use Cases

1. **Template Preview**: Fetch template details before using in campaign
2. **Template Verification**: Verify template exists and is accessible
3. **Template Inspection**: Review template HTML and metadata
4. **Campaign Setup**: Retrieve template for campaign configuration
5. **External Integration**: Look up templates using PostGrid IDs from external systems

---

## Create Postcard From Template API

### Endpoint
`POST /createPostCardFromTemplate`

### Description
Creates a postcard using PostGrid's API with specified front and back templates. This endpoint accepts both database UUIDs and PostGrid template IDs for flexible template selection.

### Features
- **Dual ID Support**: Accepts both database UUID and PostGrid template IDs for frontTemplate and backTemplate
- **Organization Scoped**: Templates must belong to user's organization
- **PostGrid Integration**: Direct integration with PostGrid's postcard creation API
- **Merge Variables**: Support for dynamic template variables
- **Validation**: Verifies templates exist and are not deleted before creating postcard

### Request Method
- **POST**: Send postcard details in request body

### Request Body

```json
{
  "postgridApiKey": "test_sk_7oVoDY45m5aPpjKmMZJxz3",
  "to": {
    "firstName": "John",
    "lastName": "Smith",
    "addressLine1": "123 Main Street",
    "city": "San Francisco",
    "provinceOrState": "CA",
    "postalOrZip": "94105",
    "countryCode": "US"
  },
  "from": {
    "companyName": "ABC Home Services",
    "addressLine1": "456 Business Ave",
    "city": "San Francisco",
    "provinceOrState": "CA",
    "postalOrZip": "94107",
    "countryCode": "US"
  },
  "size": "6x4",
  "frontTemplate": "a7b3c4d5-e6f7-8901-2345-6789abcdef01",
  "backTemplate": "template_phXZr8fWFejSVWP3o5WEWh",
  "description": "Spring Promo Postcard",
  "mergeVariables": {
    "offer_headline": "Special Spring Discount!",
    "offer_description": "Get 20% off all services this month",
    "cta_text": "Call Now to Redeem",
    "disclaimer_text": "Offer valid for new customers only",
    "business_name": "ABC Home Services",
    "phone": "+1-555-123-4567",
    "website": "https://abchome.com",
    "qr_url": "https://abchome.com/spring-promo",
    "before_image_id": "https://example.com/before.jpg",
    "after_image_id": "https://example.com/after.jpg"
  }
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `postgridApiKey` | string | PostGrid API key for authentication |
| `to` | object | Recipient address details |
| `to.firstName` | string | Recipient first name |
| `to.lastName` | string | Recipient last name |
| `to.addressLine1` | string | Recipient street address |
| `to.city` | string | Recipient city |
| `to.provinceOrState` | string | Recipient state/province code |
| `to.postalOrZip` | string | Recipient postal/zip code |
| `to.countryCode` | string | Recipient country code (e.g., "US") |
| `from` | object | Sender address details |
| `from.addressLine1` | string | Sender street address |
| `from.city` | string | Sender city |
| `from.provinceOrState` | string | Sender state/province code |
| `from.postalOrZip` | string | Sender postal/zip code |
| `from.countryCode` | string | Sender country code (e.g., "US") |
| `size` | string | Postcard size: "6x4", "6x9", or "6x11" |
| `frontTemplate` | string | Front template ID (database UUID or PostGrid ID) |
| `backTemplate` | string | Back template ID (database UUID or PostGrid ID) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `to.addressLine2` | string | Additional recipient address line |
| `from.firstName` | string | Sender first name |
| `from.lastName` | string | Sender last name |
| `from.companyName` | string | Sender company name |
| `from.addressLine2` | string | Additional sender address line |
| `description` | string | Description for the postcard |
| `mergeVariables` | object | Variables to merge into templates |

### Response Format

#### Success Response (201 Created)

```json
{
  "status": "success",
  "message": "Postcard created successfully",
  "postcard": {
    "id": "postcard_abc123xyz",
    "object": "postcard",
    "live": false,
    "to": {
      "firstName": "John",
      "lastName": "Smith",
      "addressLine1": "123 Main Street",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94105",
      "countryCode": "US"
    },
    "from": {
      "companyName": "ABC Home Services",
      "addressLine1": "456 Business Ave",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94107",
      "countryCode": "US"
    },
    "size": "6x4",
    "frontTemplate": "template_ePSnE9wew6vFzghb1V4awo",
    "backTemplate": "template_phXZr8fWFejSVWP3o5WEWh",
    "description": "Spring Promo Postcard",
    "url": "https://api.postgrid.com/print-mail/v1/postcards/postcard_abc123xyz",
    "createdAt": "2025-02-02T10:30:00.000Z",
    "updatedAt": "2025-02-02T10:30:00.000Z"
  },
  "processingTimeMs": 1523
}
```

### Template ID Flexibility

The API automatically detects the type of ID provided:
- **UUID Format** (e.g., `a7b3c4d5-e6f7-8901-2345-6789abcdef01`): Looks up template in database
- **Non-UUID Format** (e.g., `template_abc123xyz`): Treats as PostGrid template ID

Both formats are validated to ensure:
1. Template exists in the database
2. Template belongs to user's organization
3. Template is not marked as deleted

### Business Rules

1. **Organization Verification**: Templates must belong to user's organization
2. **Template Validation**: Cannot use deleted templates
3. **Authentication Required**: Valid JWT token must be provided
4. **PostGrid Integration**: All PostGrid postcard parameters are supported
5. **Error Propagation**: PostGrid API errors are returned with original status codes

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing or invalid required fields |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 404 | TEMPLATE_NOT_FOUND | Template not found or doesn't belong to organization |
| 410 | TEMPLATE_DELETED | Template has been deleted |
| 500 | POSTGRID_API_ERROR | PostGrid API error (includes PostGrid error details) |
| 500 | INTERNAL_ERROR | Unexpected server error |

### Example Usage

#### Using Database UUIDs
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/createPostCardFromTemplate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "test_sk_7oVoDY45m5aPpjKmMZJxz3",
    "to": {
      "firstName": "John",
      "lastName": "Smith",
      "addressLine1": "123 Main Street",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94105",
      "countryCode": "US"
    },
    "from": {
      "companyName": "ABC Home Services",
      "addressLine1": "456 Business Ave",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94107",
      "countryCode": "US"
    },
    "size": "6x4",
    "frontTemplate": "a7b3c4d5-e6f7-8901-2345-6789abcdef01",
    "backTemplate": "b8c9d0e1-f2g3-4567-8901-gh2345678902",
    "description": "Spring Promo Postcard",
    "mergeVariables": {
      "offer_headline": "Special Spring Discount!",
      "business_name": "ABC Home Services"
    }
  }'
```

#### Using PostGrid Template IDs
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/createPostCardFromTemplate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "test_sk_7oVoDY45m5aPpjKmMZJxz3",
    "to": {
      "firstName": "John",
      "lastName": "Smith",
      "addressLine1": "123 Main Street",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94105",
      "countryCode": "US"
    },
    "from": {
      "companyName": "ABC Home Services",
      "addressLine1": "456 Business Ave",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94107",
      "countryCode": "US"
    },
    "size": "6x4",
    "frontTemplate": "template_ePSnE9wew6vFzghb1V4awo",
    "backTemplate": "template_phXZr8fWFejSVWP3o5WEWh",
    "description": "Spring Promo Postcard"
  }'
```

### Use Cases

1. **Campaign Execution**: Send postcards to leads using campaign templates
2. **Single Send**: Send individual postcards with custom data
3. **Batch Processing**: Create multiple postcards programmatically
4. **A/B Testing**: Test different template combinations
5. **Automated Mailings**: Trigger postcards based on events or workflows

### Notes

- The `mergeVariables` object can contain any custom fields your templates use
- PostGrid response includes tracking URLs and status information
- Test mode postcards (using test API keys) are not actually sent
- Processing time includes template lookup and PostGrid API call

---

## Get Postcard By ID API

### Endpoint
`POST /getPostCardById`

### Description
Retrieves a postcard from PostGrid API by its ID. This endpoint provides complete postcard details including status, addresses, templates used, and tracking information.

### Features
- **Direct PostGrid Integration**: Fetches postcard data directly from PostGrid API
- **Organization Scoped**: User must be authenticated and in organization
- **Complete Data**: Returns all PostGrid postcard information
- **Error Handling**: Properly handles PostGrid API errors

### Request Method
- **POST**: Send postcard ID in request body

### Request Body

```json
{
  "postgridApiKey": "test_sk_7oVoDY45m5aPpjKmMZJxz3",
  "postcardId": "postcard_dfHxSciyRyyAZkRsuWSrNn"
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `postgridApiKey` | string | PostGrid API key for authentication |
| `postcardId` | string | PostGrid postcard ID to retrieve |

### Response Format

#### Success Response (200 OK)

```json
{
  "status": "success",
  "message": "Postcard retrieved successfully",
  "postcard": {
    "id": "postcard_dfHxSciyRyyAZkRsuWSrNn",
    "object": "postcard",
    "live": false,
    "to": {
      "firstName": "John",
      "lastName": "Smith",
      "addressLine1": "123 Main Street",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94105",
      "countryCode": "US"
    },
    "from": {
      "companyName": "ABC Home Services",
      "addressLine1": "456 Business Ave",
      "city": "San Francisco",
      "provinceOrState": "CA",
      "postalOrZip": "94107",
      "countryCode": "US"
    },
    "size": "6x4",
    "frontTemplate": "template_ePSnE9wew6vFzghb1V4awo",
    "backTemplate": "template_phXZr8fWFejSVWP3o5WEWh",
    "description": "Spring Promo Postcard",
    "url": "https://api.postgrid.com/print-mail/v1/postcards/postcard_dfHxSciyRyyAZkRsuWSrNn",
    "status": "ready",
    "createdAt": "2025-02-02T10:30:00.000Z",
    "updatedAt": "2025-02-02T10:30:00.000Z"
  },
  "processingTimeMs": 245
}
```

### Business Rules

1. **Authentication Required**: Valid JWT token must be provided
2. **Organization Verification**: User must be associated with an organization
3. **PostGrid Integration**: All data is fetched directly from PostGrid API
4. **Error Propagation**: PostGrid API errors are returned with original status codes

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing or invalid required fields |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 404 | POSTGRID_API_ERROR | Postcard not found (PostGrid returns 404) |
| 500 | POSTGRID_API_ERROR | PostGrid API connection error |
| 500 | INTERNAL_ERROR | Unexpected server error |

### Example Usage

```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getPostCardById \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postgridApiKey": "test_sk_7oVoDY45m5aPpjKmMZJxz3",
    "postcardId": "postcard_dfHxSciyRyyAZkRsuWSrNn"
  }'
```

### Use Cases

1. **Order Tracking**: Check status and details of sent postcards
2. **Delivery Verification**: Verify postcard was created and is being processed
3. **Audit Trail**: Retrieve postcard details for record-keeping
4. **Status Monitoring**: Monitor postcard status throughout delivery lifecycle
5. **Debugging**: Troubleshoot issues with specific postcard sends

### Postcard Status Values

PostGrid postcards can have the following status values:
- `ready`: Postcard is ready to be printed
- `scheduled`: Postcard is scheduled to be sent
- `in_transit`: Postcard is being delivered
- `delivered`: Postcard was successfully delivered
- `returned`: Postcard was returned to sender
- `cancelled`: Postcard was cancelled

### Notes

- The response includes complete PostGrid data including tracking information
- Test mode postcards can be retrieved but are not actually sent
- Processing time only includes API call duration
- PostGrid API key permissions must allow reading postcards

---

## Get Template History API

### Endpoint
`POST /getTemplateHistory`

### Description
Retrieves the complete history log for a specific template, showing all actions performed on the template including creation, updates, and deletion. This endpoint accepts both database UUIDs and PostGrid template IDs.

### Features
- **Dual ID Support**: Accepts both database UUID and PostGrid template IDs
- **Complete History**: Returns all logged actions (creation, updates, deletions)
- **Chronological Order**: Results ordered by most recent action first
- **User Information**: Includes user details for each action
- **Organization Scoped**: Only returns history for templates in user's organization
- **Automatic Tracking**: History is automatically logged by the system

### Request Method
- **POST**: Send template ID in request body

### Request Body

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Or using PostGrid template ID:

```json
{
  "id": "template_ePSnE9wew6vFzghb1V4awo"
}
```

### Request Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Template ID (database UUID or PostGrid template ID) |

### Response Format

#### Success Response (200 OK)

```json
{
  "status": "success",
  "message": "Template history retrieved successfully",
  "data": {
    "template_id": "550e8400-e29b-41d4-a716-446655440000",
    "history": [
      {
        "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
        "template_id": "550e8400-e29b-41d4-a716-446655440000",
        "user_id": "f9e8d7c6-b5a4-3210-9876-543210fedcba",
        "user_name": "John Doe",
        "action": "updated template (html, description)",
        "created_at": "2025-02-03T14:30:00.000Z"
      },
      {
        "id": "b2c3d4e5-f6a7-8901-2345-678901bcdefg",
        "template_id": "550e8400-e29b-41d4-a716-446655440000",
        "user_id": "f9e8d7c6-b5a4-3210-9876-543210fedcba",
        "user_name": "John Doe",
        "action": "created template (Front, 4x6)",
        "created_at": "2025-02-03T10:00:00.000Z"
      }
    ],
    "count": 2
  }
}
```

### Business Rules

1. **Authentication Required**: Valid JWT token must be provided
2. **Organization Verification**: User must be associated with an organization
3. **Template Ownership**: Template must belong to user's organization
4. **Dual ID Resolution**: Automatically detects if ID is database UUID or PostGrid template ID
5. **Automatic Logging**: History is automatically logged on template creation, update, and deletion
6. **Immutable History**: History records cannot be modified or deleted

### History Action Types

The following actions are automatically tracked:

| Action | Description | Example |
|--------|-------------|---------|
| `created template` | Template was created | "created template (Front, 4x6)" |
| `updated template` | Template was updated | "updated template (html, description)" |
| `deleted template` | Template was deleted | "deleted template" |

### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Missing template ID |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 404 | TEMPLATE_NOT_FOUND | Template not found in organization |
| 500 | HISTORY_FETCH_FAILED | Failed to retrieve history from database |
| 500 | INTERNAL_ERROR | Unexpected server error |

### Example Usage

```bash
# Using database UUID
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getTemplateHistory \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }'

# Using PostGrid template ID
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getTemplateHistory \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "template_ePSnE9wew6vFzghb1V4awo"
  }'
```

### Use Cases

1. **Audit Trail**: Track all changes made to a template over time
2. **Compliance**: Maintain records of who modified templates and when
3. **Troubleshooting**: Investigate when and how a template was changed
4. **Team Collaboration**: See which team members worked on a template
5. **Version Tracking**: Understand the evolution of a template
6. **Change Management**: Review template modification history before using in campaigns

### Response Details

**History Array**: Ordered by `created_at` descending (most recent first)
- Each entry includes the user who performed the action
- Timestamps are in ISO 8601 format
- Actions include contextual information (e.g., which fields were updated)

**Count**: Total number of history records for the template

### Notes

- History is automatically logged by the system - no manual action required
- History persists even if template is deleted (CASCADE delete removes history)
- Empty history array means no actions have been recorded (should not happen for valid templates)
- User names are captured at the time of the action
- All timestamps are in UTC

---

## Settings Management APIs

### Get App Content API

#### Endpoint
`GET /getAppContent`

#### Description
Retrieves role-based application content and user-specific branding settings.

#### Features
- **Role-Based Access**: Different menu items based on ADMIN, MARKETER, or TECHNICIAN role
- **User Branding**: Returns theme colors and fonts specific to the user
- **Default Theme**: Provides standard theme if user hasn't customized

####Response Format

```json
{
  "data": {
    "menu_items": [
      {
        "name": "dashboard",
        "title": "Dashboard",
        "description": "Create, Navigate, Lead & Iterate",
        "id": 1,
        "enabled": true,
        "extended": false,
        "extended_options": []
      }
    ],
    "theme": {
      "colors": {
        "primary": "#E36A00",
        "secondary": "#1D1D20",
        "accent": "#47BAD7"
      },
      "fonts": {
        "primary": {
          "name": "Poppins"
        },
        "body": {
          "name": "Poppins"
        }
      }
    }
  }
}
```

---

### Get All Fonts API

#### Endpoint
`GET /getAllFonts`

#### Description
Returns all available Google Fonts for use in branding settings.

#### Features
- **Google Fonts Integration**: Fetches fonts from Google Fonts API
- **Fallback List**: Provides curated popular fonts if API unavailable
- **Font Metadata**: Returns font name, category, variants, and subsets

#### Response Format

```json
{
  "status": "success",
  "message": "Retrieved 15 fonts",
  "fonts": [
    {
      "name": "Poppins",
      "category": "sans-serif",
      "variants": ["regular", "500", "600", "700"],
      "subsets": ["latin"]
    },
    {
      "name": "Roboto",
      "category": "sans-serif",
      "variants": ["regular", "500", "700"],
      "subsets": ["latin"]
    }
  ],
  "processingTimeMs": 245
}
```

#### Example Usage

```bash
curl -X GET https://iywivotqnphrjijztxtu.supabase.co/functions/v1/getAllFonts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### Update Branding Settings API

#### Endpoint
`POST /updateBrandingSettings`

#### Description
Updates user-specific branding settings including theme colors and fonts.

#### Features
- **User-Specific**: Settings apply only to the authenticated user
- **Color Validation**: Validates hex color format
- **Font Validation**: Ensures font names are valid
- **Immediate Effect**: Changes reflected in getAppContent response

#### Request Body

```json
{
  "theme": {
    "colors": {
      "primary": "#E36A00",
      "secondary": "#1D1D20",
      "accent": "#47BAD7"
    },
    "fonts": {
      "primary": {
        "name": "Poppins"
      },
      "body": {
        "name": "Poppins"
      }
    }
  }
}
```

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `theme.colors.primary` | string | Primary brand color (hex format) |
| `theme.colors.secondary` | string | Secondary brand color (hex format) |
| `theme.colors.accent` | string | Accent color (hex format) |
| `theme.fonts.primary.name` | string | Primary font name (Google Font) |
| `theme.fonts.body.name` | string | Body font name (Google Font) |

#### Response Format

```json
{
  "status": "success",
  "message": "Branding settings updated successfully",
  "branding_settings": {
    "theme": {
      "colors": {
        "primary": "#E36A00",
        "secondary": "#1D1D20",
        "accent": "#47BAD7"
      },
      "fonts": {
        "primary": {
          "name": "Poppins"
        },
        "body": {
          "name": "Poppins"
        }
      }
    }
  },
  "processingTimeMs": 128
}
```

#### Business Rules

1. **User-Level Settings**: Branding is per-user, not per-organization
2. **Color Format**: Colors must be valid 3 or 6-digit hex codes (e.g., #FFF or #FFFFFF)
3. **Font Names**: Should match Google Fonts names from getAllFonts
4. **Default Values**: New users get default theme automatically

#### Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | INVALID_INPUT | Invalid hex color or missing required fields |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | NO_ORGANIZATION | User not associated with any organization |
| 500 | UPDATE_FAILED | Database update error |

#### Example Usage

```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/updateBrandingSettings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "theme": {
      "colors": {
        "primary": "#E36A00",
        "secondary": "#1D1D20",
        "accent": "#47BAD7"
      },
      "fonts": {
        "primary": {
          "name": "Montserrat"
        },
        "body": {
          "name": "Open Sans"
        }
      }
    }
  }'
```

#### Use Cases

1. **Brand Customization**: Allow users to match app colors to their brand
2. **Accessibility**: Users can choose high-contrast colors for better visibility
3. **Font Preferences**: Select fonts that match brand guidelines
4. **Multi-Brand**: Different users can have different branding
5. **White-Label**: Customize appearance per user account

#### Notes

- Default theme uses Orange (#E36A00), Dark Gray (#1D1D20), and Cyan (#47BAD7)
- Default fonts are Poppins for both primary and body
- Changes apply immediately to all app sessions
- Settings are stored in user's profile in the database

---

## Analytics API

### POST /getAnalytics

Get organization-level analytics with intelligent daily caching.

**Authentication**: Required (JWT token)

**Authorization**: Organization-based (ADMIN, MARKETER, TECHNICIAN)

**Features**:
- ✅ Daily caching - First request computes, subsequent requests fetch from cache
- ✅ Automatic refresh each day
- ✅ Organization-scoped data
- ✅ Extensible for multiple analytics types

#### Request Body

```json
{
  "type": "REFERRALS"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | Yes | Type of analytics: "REFERRALS", "TEMPLATES", "CAMPAIGNS", "DASHBOARD", "TARGETING_ZONES", "ADDRESS_COLLECTION", or "GLOBAL_EXCLUSIONS" |

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics retrieved from cache",
  "cached": true,
  "data": {
    "total_referrals": 25,
    "campaign_ready_referrals": 8,
    "campaign_published_referrals": 12,
    "avg_referrals_value": 5250.75,
    "overview": {
      "currency": "USD",
      "total_referrals_breakdown": "3 This week",
      "campaign_ready_referrals_breakdown": "2 This week",
      "campaign_published_referrals_breakdown": "1 This week"
    }
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| status | string | Always "success" for successful requests |
| message | string | Describes whether data was cached or computed |
| cached | boolean | true if from cache, false if freshly computed |
| data.total_referrals | integer | Total number of referrals in organization |
| data.campaign_ready_referrals | integer | Referrals with campaigns at step 5 or 6 and status Draft/InActive |
| data.campaign_published_referrals | integer | Referrals with Active campaigns |
| data.avg_referrals_value | number | Average value from job_details.value |
| data.overview.currency | string | Most common currency from job_details |
| data.overview.*_breakdown | string | Count of items created/updated this week |

#### Campaign Readiness Logic

A referral is **campaign ready** when:
1. campaign_id is not null
2. Campaign current_step is 5 or 6
3. Campaign status is "Draft" or "InActive"

A referral is **campaign published** when:
1. campaign_id is not null
2. Campaign status is "Active"

#### Caching Behavior

**First Request of Day**: Computes from database, saves cache, returns `cached: false`

**Subsequent Requests (Same Day)**: Fetches from cache, returns `cached: true` (~50-100ms)

**Next Day**: Cache refreshes automatically with new date

#### Example Request (REFERRALS)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"REFERRALS"}'
```

---

### TEMPLATES Analytics Type

Get template usage analytics by campaign status.

#### Request Body

```json
{
  "type": "TEMPLATES"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "total_templates": 15,
    "active_templates": 8,
    "draft_templates": 5,
    "inactive_templates": 2
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.total_templates | integer | Total number of templates in organization |
| data.active_templates | integer | Templates with at least one Active campaign in campaigns_used |
| data.draft_templates | integer | Templates with at least one Draft campaign in campaigns_used |
| data.inactive_templates | integer | Templates with at least one InActive campaign in campaigns_used |

**Note**: A template can be counted in multiple categories if it has campaigns with different statuses.

#### Templates Logic

Templates are counted based on the campaigns they're used in:

1. **Active Templates**: Template has at least one campaign ID in `campaigns_used` where campaign status is "Active"
2. **Draft Templates**: Template has at least one campaign ID in `campaigns_used` where campaign status is "Draft"
3. **InActive Templates**: Template has at least one campaign ID in `campaigns_used` where campaign status is "InActive"

Templates with empty `campaigns_used` arrays are not counted in status categories (only in total_templates).

#### Example Request (TEMPLATES)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"TEMPLATES"}'
```

---

### CAMPAIGNS Analytics Type

Get campaign analytics including active campaigns and spending.

#### Request Body

```json
{
  "type": "CAMPAIGNS"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "active_campaigns": 12,
    "total_postcards_sent": 5420,
    "total_spent": 16260,
    "overview": {
      "currency": "USD"
    }
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.active_campaigns | integer | All campaigns in organization with status "Active" |
| data.total_postcards_sent | integer | Sum of all campaigns' postcards_sent |
| data.total_spent | number | Total spent (postcards_sent × 3) |
| data.overview.currency | string | Currency (always "USD") |

#### Example Request (CAMPAIGNS)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CAMPAIGNS"}'
```

---

### DASHBOARD Analytics Type

Get comprehensive dashboard analytics combining referrals and campaigns data with weekly breakdowns.

#### Request Body

```json
{
  "type": "DASHBOARD"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "total_referrals": 25,
    "active_campaigns": 12,
    "total_spent": 16260,
    "overview": {
      "currency": "USD",
      "total_referrals_breakdown": "3 This week",
      "active_campaigns_breakdown": "2 This week"
    }
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.total_referrals | integer | Total number of referrals in organization |
| data.active_campaigns | integer | All campaigns in organization with status "Active" |
| data.total_spent | number | Total spent (sum of all campaigns' postcards_sent × 3) |
| data.overview.currency | string | Currency (always "USD") |
| data.overview.total_referrals_breakdown | string | Count of referrals created in last 7 days |
| data.overview.active_campaigns_breakdown | string | Count of active campaigns created in last 7 days |

#### Dashboard Logic

- **total_referrals**: Count of all referrals in organization
- **active_campaigns**: Count of campaigns with status "Active"
- **total_spent**: Sum of `postcards_sent` across all campaigns × 3
- **total_referrals_breakdown**: Referrals where `created_at` is within last 7 days
- **active_campaigns_breakdown**: Active campaigns where `created_at` is within last 7 days

#### Example Request (DASHBOARD)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"DASHBOARD"}'
```

---

### TARGETING_ZONES Analytics Type

Get targeting zones analytics including active zones, addresses, duplicates, and average radius.

#### Request Body

```json
{
  "type": "TARGETING_ZONES"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "active_targeting_zones": 8,
    "total_addresses_targetted": 1540,
    "duplicate_supressions": 45,
    "average_radius": 1609.34,
    "overview": {
      "unit": "miles",
      "symbol": "mi"
    }
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.active_targeting_zones | integer | Location zones with Active campaign (campaign_id not null and campaign status is "Active") |
| data.total_addresses_targetted | integer | Sum of all addresses with status "verified" or "Valid" in all location zones |
| data.duplicate_supressions | integer | Number of duplicate addresses across all location zones |
| data.average_radius | number | Average radius from center.radius across all location zones (in meters) |
| data.overview.unit | string | Unit of measurement (always "miles") |
| data.overview.symbol | string | Symbol for unit (always "mi") |

#### Targeting Zones Logic

- **active_targeting_zones**: Location zones where `campaign_id` is not null AND the campaign's `status` is "Active"
- **total_addresses_targetted**: Count of addresses with `status` "verified" or "Valid" across all location zones in the organization
- **duplicate_supressions**: Count of addresses that appear more than once across all location zones (duplicate occurrences minus 1)
- **average_radius**: Average of `center.radius` values across all location zones (value is in meters, frontend converts to miles)

#### Example Request (TARGETING_ZONES)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"TARGETING_ZONES"}'
```

---

### ADDRESS_COLLECTION Analytics Type

Get address collection analytics including total addresses, validated addresses, duplicates, and opt-outs.

#### Request Body

```json
{
  "type": "ADDRESS_COLLECTION"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "total_addresses": 3250,
    "validated_addresses": 2890,
    "duplicates": 125,
    "opt_outs": 87
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.total_addresses | integer | Total sum of all addresses in all location zones (sum of addresses array lengths) |
| data.validated_addresses | integer | Addresses with status "verified" or "Valid" |
| data.duplicates | integer | Number of duplicate addresses across all location zones |
| data.opt_outs | integer | Addresses with Opt-out "verified" |

#### Address Collection Logic

- **total_addresses**: Sum of the count of all addresses in the `addresses` field across all location zones in the organization
- **validated_addresses**: Count of addresses where `status` field equals "verified" or "Valid"
- **duplicates**: Count of addresses that appear more than once across all location zones (duplicate occurrences minus 1)
- **opt_outs**: Count of addresses where `Opt-out` field equals "verified"

#### Example Request (ADDRESS_COLLECTION)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"ADDRESS_COLLECTION"}'
```

---

### GLOBAL_EXCLUSIONS Analytics Type

Get global exclusions analytics including total excluded addresses, opt-outs, and manual entries.

#### Request Body

```json
{
  "type": "GLOBAL_EXCLUSIONS"
}
```

#### Response (Success - 200 OK)

```json
{
  "status": "success",
  "message": "Analytics computed successfully",
  "cached": false,
  "data": {
    "total_excluded": 425,
    "opt_outs": 87,
    "manual_entries": 156
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data.total_excluded | integer | Addresses with status not equal to "verified", not equal to "Valid", and not equal to "Opt-out" |
| data.opt_outs | integer | Addresses with status equal to "Opt-out" |
| data.manual_entries | integer | Addresses manually added via /addAddressToZoneById (have manual_entry flag set to true) |

#### Global Exclusions Logic

- **total_excluded**: Count of addresses where `status` field is NOT "verified" AND NOT "Valid" AND NOT "Opt-out"
- **opt_outs**: Count of addresses where `status` field equals "Opt-out"
- **manual_entries**: Count of addresses with `manual_entry` field set to `true` (set by /addAddressToZoneById API when addresses are manually added)

#### Example Request (GLOBAL_EXCLUSIONS)

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/getAnalytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"GLOBAL_EXCLUSIONS"}'
```

---

#### Error Responses

**Invalid Type (400)**:
```json
{
  "error": "INVALID_TYPE",
  "message": "Analytics type \"INVALID\" is not supported. Supported types: REFERRALS, TEMPLATES, CAMPAIGNS, DASHBOARD, TARGETING_ZONES, ADDRESS_COLLECTION, GLOBAL_EXCLUSIONS"
}
```

**Missing Type (400)**:
```json
{
  "error": "INVALID_INPUT",
  "message": "type is required and must be a string"
}
```

**Unauthorized (401)**:
```json
{
  "error": "UNAUTHORIZED",
  "message": "Unable to authenticate user"
}
```

**No Organization (403)**:
```json
{
  "error": "NO_ORGANIZATION",
  "message": "User is not associated with any organization"
}
```

#### Performance

- **Cached Request**: ~50-100ms
- **Fresh Computation**: ~500-1500ms (depends on data volume)
- **Keep-Alive**: Warmed every 5 minutes via cron job

#### Database Table

Analytics are cached in the `analytics` table:

```sql
CREATE TABLE analytics (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    analytics_type TEXT NOT NULL,
    analytics_date DATE NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, analytics_type, analytics_date)
);
```

---

## GET /getNotifications

Retrieve role-based notifications for the authenticated user.

### Overview

Returns notifications based on user's role (ADMIN, MARKETER, TECHNICIAN) and organization. Automatically marks all returned notifications as read after fetching.

### Authentication

Requires valid JWT token in Authorization header.

### Request

```http
GET /getNotifications
Authorization: Bearer YOUR_JWT_TOKEN
```

### Response (Success - 200 OK)

```json
{
  "data": [
    {
      "title": "Campaign Linked",
      "description": "Campaign 'My Awesome Campaign' has been linked to your Referral 'Referral Name'",
      "isUnread": true
    },
    {
      "title": "Status Changed",
      "description": "Referral 'Referral Name' status changed to 'Completed'",
      "isUnread": true
    }
  ],
  "processingTimeMs": 45
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| data | array | Array of notification objects |
| data[].title | string | Short notification title |
| data[].description | string | Full notification message |
| data[].isUnread | boolean | Whether notification was unread (true for unread before this call) |
| processingTimeMs | number | Request processing time in milliseconds |

### Notifications by Role

#### TECHNICIAN Notifications
- Campaign linked to referral
- Referral status changed
- New user added to organization

#### MARKETER Notifications
All TECHNICIAN notifications plus:
- Postcards sent from campaign
- Campaign status changed
- New targeting zone added
- New address added to targeting zone
- Address opted out

#### ADMIN Notifications
All MARKETER notifications plus:
- Template used in campaign
- New template created

### Behavior

1. **Fetches** all notifications for user's organization and role
2. **Returns** notifications in reverse chronological order (newest first)
3. **Marks** all returned unread notifications as read
4. **Sets** `isUnread: true` for notifications that were unread before this call

### Integration with getAppContent

The `/getAppContent` API includes an `isUnread` flag on the notifications menu item:

```json
{
  "id": 8,
  "name": "notifications",
  "title": "Notifications",
  "enabled": true,
  "isUnread": true
}
```

This flag is `true` when there are unread notifications, and becomes `false` after calling `/getNotifications`.

### Example Request

```bash
curl -X GET "https://YOUR-PROJECT.supabase.co/functions/v1/getNotifications" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Error Responses

**Unauthorized (401)**:
```json
{
  "error": "UNAUTHORIZED",
  "message": "Unable to authenticate user"
}
```

**No Organization (403)**:
```json
{
  "error": "NO_ORGANIZATION",
  "message": "User is not associated with any organization"
}
```

**Profile Not Found (404)**:
```json
{
  "error": "PROFILE_NOT_FOUND",
  "message": "User profile not found"
}
```

**Invalid Role (403)**:
```json
{
  "error": "INVALID_ROLE",
  "message": "Invalid user role"
}
```

### Database Table

Notifications are stored in the `notifications` table:

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    user_id UUID,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    target_roles TEXT[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Creating Notifications

Notifications are created automatically by other APIs when relevant events occur. Each notification specifies `target_roles` (e.g., `['ADMIN', 'MARKETER']`) to control visibility.

---

## Viewing the Documentation

### Option 1: Open Locally

Simply open the Swagger UI in your browser:

```bash
# macOS
open docs/swagger.html

# Linux
xdg-open docs/swagger.html

# Windows
start docs/swagger.html
```

### Option 2: Serve with Python

```bash
# Python 3
cd docs
python3 -m http.server 8000

# Then visit: http://localhost:8000/swagger.html
```

### Option 3: Serve with Node.js

```bash
# Install http-server globally
npm install -g http-server

# Serve the docs
cd docs
http-server -p 8000

# Then visit: http://localhost:8000/swagger.html
```

### Option 4: Deploy to Hosting

The `swagger.html` file is a completely standalone file that can be deployed to any static hosting service:

- **Firebase Hosting** (recommended, see GitHub Actions example below)
- **Netlify**
- **Vercel**
- **GitHub Pages**
- **AWS S3**
- **Cloudflare Pages**

## Using the OpenAPI Spec

The `openapi.yaml` file can be used with various tools:

### Generate Client SDKs

```bash
# Install OpenAPI Generator
npm install @openapitools/openapi-generator-cli -g

# Generate TypeScript client
openapi-generator-cli generate -i docs/openapi.yaml -g typescript-axios -o client/typescript

# Generate Python client
openapi-generator-cli generate -i docs/openapi.yaml -g python -o client/python

# Generate Java client
openapi-generator-cli generate -i docs/openapi.yaml -g java -o client/java
```

### Validate the Spec

```bash
# Install Swagger CLI
npm install -g @apidevtools/swagger-cli

# Validate
swagger-cli validate docs/openapi.yaml
```

### Use with Postman

1. Open Postman
2. Click "Import"
3. Select `openapi.yaml`
4. All endpoints will be imported as a collection

## Deployment with GitHub Actions

### Deploy to Firebase Hosting

Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy API Documentation

on:
  push:
    branches:
      - main
    paths:
      - 'docs/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: your-firebase-project-id
          target: api-docs
```

Then create `firebase.json` in the root:

```json
{
  "hosting": {
    "target": "api-docs",
    "public": "docs",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**",
      "**/*.md"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/swagger.html"
      }
    ]
  }
}
```

### Deploy to GitHub Pages

Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy API Documentation

on:
  push:
    branches:
      - main
    paths:
      - 'docs/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './docs'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Deploy to Netlify

Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy API Documentation

on:
  push:
    branches:
      - main
    paths:
      - 'docs/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to Netlify
        uses: nwtgck/actions-netlify@v2
        with:
          publish-dir: './docs'
          production-branch: main
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deploy-message: "Deploy API docs from GitHub Actions"
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

## Updating the Documentation

When you add or modify API endpoints:

1. Update the OpenAPI spec in `openapi.yaml`
2. Update the embedded spec in `swagger.html` (lines 25-800+)
3. Commit both files
4. The GitHub Action will automatically deploy the changes

### Quick Update Script

You can create a script to keep both files in sync:

```bash
#!/bin/bash
# update-docs.sh

# Convert YAML to JSON and update swagger.html
# This requires yq (https://github.com/mikefarah/yq)

yq eval -o=json docs/openapi.yaml > /tmp/openapi.json

# TODO: Update the spec object in swagger.html with the JSON content
echo "Please manually update the spec object in swagger.html"
echo "Or use a templating tool to automate this"
```

## Interactive Features

The Swagger UI includes:

- **Try it out** - Test API endpoints directly from the browser
- **Code samples** - Generate code snippets in multiple languages
- **Request/Response examples** - View sample payloads
- **Authentication** - Test with Bearer tokens
- **Filter** - Search through endpoints
- **Download** - Export the OpenAPI spec

## Customization

### Change Server URL

Edit the `servers` section in both files:

```yaml
servers:
  - url: https://your-actual-project.supabase.co/functions/v1
    description: Production server
```

### Add Custom Styling

In `swagger.html`, add custom CSS in the `<style>` tag:

```html
<style>
    body {
        margin: 0;
        padding: 0;
    }
    .topbar {
        display: none;
    }
    /* Add your custom styles here */
    .swagger-ui .info .title {
        color: #your-brand-color;
    }
</style>
```

### Add Custom Logo

In `swagger.html`, modify the spec's info section:

```javascript
"info": {
    "title": "Door Knocker Authentication API",
    "x-logo": {
        "url": "https://your-domain.com/logo.png",
        "altText": "Door Knocker Logo"
    },
    // ... rest of info
}
```

## Security Notes

- The documentation is public (don't include sensitive data)
- Don't include real API keys or tokens in examples
- The "Try it out" feature sends real requests to your API
- Consider adding authentication to your docs hosting if needed

## Troubleshooting

### Swagger UI not loading

- Check browser console for errors
- Ensure you're serving over HTTP/HTTPS (not `file://`)
- Verify the OpenAPI spec is valid

### CORS errors when testing

- This is expected when testing from a different origin
- Configure CORS in your Supabase Edge Functions
- Or use a browser extension to disable CORS temporarily

### Spec validation errors

```bash
# Install validator
npm install -g @apidevtools/swagger-cli

# Validate spec
swagger-cli validate docs/openapi.yaml
```

## Additional Resources

- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger UI Documentation](https://swagger.io/docs/open-source-tools/swagger-ui/)
- [OpenAPI Generator](https://openapi-generator.tech/)
- [Postman OpenAPI Import](https://learning.postman.com/docs/integrations/available-integrations/working-with-openAPI/)
### 11. Charge Payment Method (ADMIN only)

```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/chargePaymentMethod \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method_id": "pm_123456789",
    "amount": 5000,
    "currency": "usd",
    "description": "Campaign postcard printing"
  }'
```

**Parameters:**
- `payment_method_id` (required): Stripe Payment Method ID
- `amount` (required): Amount in cents (e.g., 5000 = $50.00)
- `currency` (optional): Currency code (default: "usd")
- `description` (optional): Description of the charge
- `isTestMode` (optional): Set to true for test mode

**Response:**
```json
{
  "status": "success",
  "message": "Payment succeeded",
  "payment": {
    "id": "pi_123456789",
    "amount": 5000,
    "currency": "usd",
    "status": "succeeded",
    "description": "Campaign postcard printing",
    "created": "2025-01-13T10:00:00.000Z",
    "receipt_url": "https://pay.stripe.com/receipts/...",
    "payment_method": {
      "id": "pm_123456789",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025
      }
    }
  }
}
```
