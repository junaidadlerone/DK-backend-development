# Campaign Types

When creating a campaign, you choose one of three targeting types. This choice is permanent — you cannot change the type after the campaign is created.

## 1. Location Zone

A **Location Zone** campaign targets all verified addresses within a defined geographic area.

Best for:
- Neighborhood blitzes after completing a job in an area
- Seasonal outreach to a specific zip code or radius
- Any campaign where you want to target based on geography, not a specific list

How it works:
1. Create (or select) a targeting zone in Targeting → Zones
2. The zone contains all addresses found within your defined radius or count
3. DoorKnocker verifies which addresses are deliverable before you launch

## 2. Address List

An **Address List** campaign lets you upload your own CSV file of addresses.

Best for:
- Sending to your existing customer base
- Using a purchased or curated mailing list
- Targeting a specific set of addresses that don't follow a geographic pattern

How it works:
1. Upload a CSV file during campaign creation
2. The system processes and maps your columns to the required fields
3. Addresses are validated for deliverability before launch

**Required CSV columns:**
| Column | Required? |
|---|---|
| `street_address` | Yes |
| `city` | Yes |
| `state` | Yes |
| `postal_code` | Yes |
| `country` | No (defaults to US) |
| `name` | No |
| `address_type` | No |

Column names must match exactly, or use the column mapping step during upload to assign your columns manually.

## 3. Referral

A **Referral** campaign is linked to a specific referral job record in your system.

Best for:
- Targeting the neighborhood around a completed job
- Showcasing real before/after photos from a job site in your postcard design

How it works:
1. Create a referral record (Referrals → + Create Referral) with the homeowner's address and job details
2. When creating a campaign, choose "Referral" type and select that referral
3. The referral's address becomes the center point of the targeting zone
4. Before/after photos from the referral can appear as dynamic variables in the postcard template
5. On launch, the referral status changes to "In Use"

## Which Type Should I Choose?

| Goal | Best Type |
|---|---|
| Target a neighborhood around my business or a job site | Location Zone |
| Mail to my existing customer list | Address List |
| Showcase a completed job to the surrounding neighbors | Referral |
| Reuse a list I verified elsewhere | Address List |
