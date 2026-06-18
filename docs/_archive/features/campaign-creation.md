# Campaign Creation Flow

**URL**: /campaigns/create

## Overview
Campaigns combine a targeting zone with a postcard template to send physical mail.

## Steps

### Step 1: Campaign Name
Enter a descriptive name (e.g. "Summer 2025 — Austin North").

### Step 2: Targeting Zone
- Select an existing zone, OR create a new one (enter address + radius/count)

### Step 3: Address Validation
Click "Validate Addresses" to check deliverability via PostGrid.
- Green markers = deliverable
- Red = undeliverable
- Takes several minutes for large zones

### Step 4: Postcard Template
Select a template from your library or create a new one.

### Step 5: Review & Send
Total count and cost shown. Choose immediate or scheduled send. Click "Send Campaign."

## Cost
Cost = number of postcards × per-postcard rate (shown on review step).

# Campaign Create Step 1

**URL**: http://localhost:5173/campaigns/create

## Sections
### Create New Campaign
### Choose Your Target Audience
### Postcard Design
### Campaign Overview

## Form Fields
- radio: zoneType
- radio: zoneType
- radio: zoneType

## Field Labels
- Use Referral Address
- Create New Zone
- Select Existing Zone

## Actions
- AC
Acme Corp
- Quick Actions
- Notifications
- PU

Playwright User

playwright@mailinator.com
- Dashboard
- Referrals
- Campaigns
- Templates
- Targeting
- Analytics
- Settings
- Back
- Verify Addresses
- Front
- Full Screen Preview
- Edit Template

## Page Content
```
Campaigns
Create New Campaign
Create New Campaign
Back
Verify Addresses
Choose Your Target Audience
Use Referral Address
Create New Zone
Select Existing Zone
Campaign ID is required. Please create a campaign first.
Postcard Design
Front
Back
Select templates to see preview
Full Screen Preview
Edit Template
Campaign Overview
Referral
No referral selected
Template
Please select a template
Estimated Start Date
Not set
Targeting
Please select targeting zone
```