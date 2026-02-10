# Signature API Implementation Summary

## Overview
Added signature and proof document upload functionality to the Door Knocker API, integrated with the referral system.

## Changes Made

### 1. Database Schema (Migrations)

#### Migration: 20250219000001_create_signatures_table.sql
Creates the signatures table and links it to referrals.

#### Migration: 20250219000002_make_signature_proof_nullable.sql
Makes signature, proof_id, and proof_url nullable to support optional fields.

#### Table: `signatures`
```sql
CREATE TABLE public.signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signature TEXT DEFAULT NULL,
    proof_id UUID DEFAULT NULL,
    proof_url TEXT DEFAULT NULL,
    referral_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Fields:**
- `id`: Unique identifier for each signature record
- `signature`: Base64 encoded signature text (nullable - can be omitted if only uploading proof)
- `proof_id`: UUID of the uploaded proof document (nullable - can be omitted if only uploading signature)
- `proof_url`: Public URL to access the proof document (nullable - can be omitted if only uploading signature)
- `referral_id`: Optional link to a referral (nullable)
- `created_at`: Timestamp of creation
- `updated_at`: Timestamp of last update

#### Modified Table: `referrals`
Added column:
- `signature_id UUID`: Optional foreign key to link referral to a signature

**Foreign Key Constraints:**
- `signatures.referral_id` → `referrals.id` (ON DELETE SET NULL)
- `referrals.signature_id` → `signatures.id` (ON DELETE SET NULL)

**Indexes:**
- `idx_signatures_referral_id` on `signatures(referral_id)`
- `idx_referrals_signature_id` on `referrals(signature_id)`

**Row Level Security:**
- Service role has full access
- Authenticated users can view all signatures

### 2. New Edge Function: `/uploadSignature`

**Location:** `supabase/functions/uploadSignature/index.ts`

**Purpose:** Upload signature (base64 text) and/or proof document for optional linkage to a referral

**Request Format:** `multipart/form-data`

**Fields (at least one of signature or proof must be provided):**
- `signature` (string, optional): Base64 encoded signature text
- `proof` (file, optional): Proof document file
- `referral_id` (UUID string, optional): Referral to link signature to

**Supported Proof Formats:**
- PDF (application/pdf)
- JPEG/JPG (image/jpeg, image/jpg)
- PNG (image/png)
- WebP (image/webp)
- HEIC (image/heic)
- HEIF (image/heif)

**File Size Limit:** 10MB

**Storage Bucket:** `signatures`
**Storage Path:** `proofs/{proof_id}.{extension}`

**Response (201 Created):**
```json
{
  "status": "success",
  "message": "Signature uploaded successfully",
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "proof_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "proof_url": "https://example.supabase.co/storage/v1/object/public/signatures/proofs/c3d4e5f6.pdf",
    "referral_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "created_at": "2025-02-19T10:00:00.000Z",
    "updated_at": "2025-02-19T10:00:00.000Z"
  }
}
```

**Business Rules:**
- At least one of signature or proof must be provided
- If signature provided: validates it's a non-empty string
- If proof provided: validates file type and size
- If referral_id provided, verifies referral exists in user's organization
- Uploads proof to Supabase Storage only if proof is provided
- Creates signature record in database (signature, proof_id, proof_url can be null)
- Returns complete signature record

**Error Handling:**
- If both signature and proof missing: 400 Bad Request
- If proof provided but file type invalid: 400 Bad Request
- If proof provided but file size exceeds limit: 400 Bad Request
- If referral_id provided but not found: 404 Not Found
- If upload fails: Cleans up uploaded file and returns 500
- If database insert fails: Cleans up uploaded file (if any) and returns 500

### 3. New Edge Function: `/getSignatureById`

**Location:** `supabase/functions/getSignatureById/index.ts`

**Purpose:** Retrieve a specific signature record by its ID

**Request Format:** `application/json`

**Required Fields:**
- `id` (UUID string): Signature ID to retrieve

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Signature retrieved successfully",
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "proof_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "proof_url": "https://example.supabase.co/storage/v1/object/public/signatures/proofs/c3d4e5f6.pdf",
    "referral_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "created_at": "2025-02-19T10:00:00.000Z",
    "updated_at": "2025-02-19T10:00:00.000Z"
  }
}
```

**Business Rules:**
- Requires signature ID in request body
- Returns complete signature record including proof URL
- Organization-based authentication

**Error Handling:**
- If id missing or invalid type: 400 Bad Request
- If signature not found: 404 Not Found
- If database error: 500 Internal Server Error

### 4. Modified Edge Function: `/createReferral`

**Location:** `supabase/functions/createReferral/index.ts`

**Changes:**
- Added optional `signature_id` field to request body
- Validates signature exists if `signature_id` provided
- Links referral to signature during creation

**Updated Request Body:**
```json
{
  "home_owner_info": { ... },
  "job_details": { ... },
  "hasOwnerConsent": false,
  "signature_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901"
}
```

**Business Rules:**
- `signature_id` is optional
- If provided, verifies signature exists in database
- Returns 404 if signature_id provided but not found
- Stores signature_id in referral record

**Updated Documentation:**
- Added signature_id to business rules
- Updated OpenAPI specification

### 5. Documentation Updates

**File:** `supabase/functions/docs/openapi.yaml`

**Changes:**
1. Updated `/createReferral` endpoint:
   - Updated description to mention signature_id
   - Added signature_id to request body schema
   - Updated business rules documentation

2. Added new `/uploadSignature` endpoint:
   - Complete endpoint documentation
   - Request/response schemas
   - Error examples
   - Business rules
   - File format specifications

3. Added new `/getSignatureById` endpoint:
   - Complete endpoint documentation
   - Request/response schemas
   - Error examples
   - Business rules

## Deployment Status

✅ **Migration deployed:** `20250219000001_create_signatures_table.sql`
✅ **Migration deployed:** `20250219000002_make_signature_proof_nullable.sql`
✅ **Function deployed:** `uploadSignature` (ACTIVE - updated to support optional fields)
✅ **Function deployed:** `getSignatureById` (ACTIVE)
✅ **Function deployed:** `createReferral` (ACTIVE - supports signature_id)
✅ **Documentation updated:** `openapi.yaml`

## Usage Flow

### Typical Workflow:

1. **Upload Signature and Proof (both provided)**
   ```bash
   POST /uploadSignature
   Content-Type: multipart/form-data

   signature: "data:image/png;base64,..."
   proof: [PDF/Image File]
   referral_id: "referral-uuid" (optional)
   ```
   Returns: `{ data: { id: "signature-uuid", signature: "...", proof_id: "...", proof_url: "...", ... } }`

2. **Upload Signature Only (no proof)**
   ```bash
   POST /uploadSignature
   Content-Type: multipart/form-data

   signature: "data:image/png;base64,..."
   referral_id: "referral-uuid" (optional)
   ```
   Returns: `{ data: { id: "signature-uuid", signature: "...", proof_id: null, proof_url: null, ... } }`

3. **Upload Proof Only (no signature)**
   ```bash
   POST /uploadSignature
   Content-Type: multipart/form-data

   proof: [PDF/Image File]
   referral_id: "referral-uuid" (optional)
   ```
   Returns: `{ data: { id: "signature-uuid", signature: null, proof_id: "...", proof_url: "...", ... } }`

4. **Create Referral with Signature**
   ```bash
   POST /createReferral
   Content-Type: application/json

   {
     "home_owner_info": { ... },
     "job_details": { ... },
     "signature_id": "signature-uuid"
   }
   ```

### Retrieve Signature:

**Get Signature by ID**
```bash
POST /getSignatureById
Content-Type: application/json

{
  "id": "signature-uuid"
}
```
Returns: Complete signature record with proof URL

## Database Relationships

```
referrals (1) ←→ (0..1) signatures
    ↓                      ↓
signature_id          referral_id
```

Both directions are nullable, allowing:
- Referrals without signatures
- Signatures without referrals
- Referrals linked to signatures
- Signatures linked to referrals

## Security

- **Authentication:** JWT bearer token required (Supabase Auth)
- **Authorization:** Organization-based (user must be in organization)
- **Storage:** Files stored in public `signatures` bucket
- **RLS Policies:**
  - Service role: Full access
  - Authenticated users: Read access to all signatures

## Storage Bucket

**Bucket Name:** `signatures`
**Path Structure:** `proofs/{proof_id}.{extension}`
**Access:** Public read access
**Pre-created:** Yes (mentioned by user)

## Testing

All functions are deployed and ACTIVE:
- ✅ `uploadSignature` - Version 1
- ✅ `getSignatureById` - Version 1
- ✅ `createReferral` - Version 17
- ✅ `uploadImage` - Version 14 (unchanged)

## Notes

- No breaking changes to existing functionality
- All existing APIs continue to work as before
- signature_id is optional in createReferral
- Signatures can exist independently of referrals
- Either signature OR proof OR both can be uploaded (at least one required)
- All three fields (signature, proof_id, proof_url) are nullable in database
- Proof documents support same formats as image uploads plus PDF
- Larger file size limit (10MB) compared to images (4MB)
