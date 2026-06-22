# User Guide: Campaigns

## Introduction

The **Campaigns** module is where you create, launch, and track direct‑mail postcard campaigns. From here you can see every campaign and its status, open a draft to finish setting it up, and open a launched campaign to track scans and leads.

This document covers three things:
- **A. The Campaigns list** — viewing and finding campaigns.
- **B. Creating a campaign** — the full step‑by‑step flow (template → targeting → validation → payment → launch).
- **C. Tracking an active campaign** — the post‑launch detail view.

---

## A. The Campaigns List

### Steps

**Step 1: Open Campaigns**
1. Log in and choose your organization.
2. In the left sidebar, click **Campaigns**.
3. The Campaigns page opens, showing summary stats and a table of all campaigns.

**Step 2: Read the summary stats**
At the top you'll see: **Active Campaigns**, **Total Postcards Initiated**, **Average Scan Rate**, **Total Leads Generated**, and **Total Spent**.

**Step 3: Find a campaign**
- Use **Search campaigns…** to search by name.
- Filter by **Start Date**.
- Use the column layout — **Campaign Name, Status, Postcards Sent, Scan Rate, Total Spent, Start Date** — and the pagination / **rows per page** control at the bottom.

**Step 4: Open a campaign**
- Click a **Draft** row to **resume setup**.
- Click an **Active** row to **view tracking/analytics**.

### Campaign statuses

| Status | Meaning |
|--------|---------|
| **Draft** | Created but not yet launched; targeting/payment not completed. |
| **Active** | Paid for and launched; postcards are being processed/delivered and scans are tracked. |

### Pops / Screenshots

**Screenshot A1: Campaigns list**
Displays the summary stats, search and date filters, and the campaign table with statuses.

![Campaigns list](screenshots/module_campaigns.png)

---

## B. Creating a Campaign

### Introduction

The Campaign Creation flow lets you create and launch a direct‑mail campaign using a pre‑designed template. You select a campaign type, choose and optionally customize a template, set a QR landing link, define a target audience by location, validate the mailing addresses, authorize payment, and launch.

The system ensures **all addresses are validated before mailing**, and shows you the cost before you pay.

> **Pricing reminder:** validation is **$0.025/address**; launch is **$3.00/postcard** (standard) or **$3.50/postcard** (premium). Cost includes printing, postage, and processing. Payment is via **Stripe**.

### Steps

#### Step 1: Access the Campaigns module
1. Log in to DoorKnocker Plus and select your organization.
2. From the left sidebar, click **Campaigns**.
3. The Campaigns page opens, displaying all existing campaigns.

#### Step 2: Start a new campaign
1. Click **+ Create New Campaign** in the top‑right corner.
2. The **Create Campaign** slider appears on the right.
3. Enter a **Campaign Name** (up to 20 characters).
4. Select a **Campaign Type** (see table below).
5. Complete the type‑specific and shared fields, then click **Create Campaign**.

**Campaign types**

| Type | Use it when… |
|------|--------------|
| **For Referrals** | You want to build a postcard campaign around a past customer/job. You must select an existing **Referral**, whose location becomes the campaign's primary location. |
| **Location Zone** | You want to target a geographic area — create a new zone or use an existing one. |
| **Address List** | You want to upload your own custom list of addresses to mail to. |

**Create Campaign fields**

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| Campaign Name | Text (≤20 chars) | ✔ | Shown with a live character counter (`0/20`). |
| Type | Choice (3 options) | ✔ | For Referrals / Location Zone / Address List. |
| Referral | Dropdown | ✔ (Referrals type only) | "Select a referral for this campaign." Its address becomes the primary location. |
| Estimated Start Date | Date picker | ✔ | Postcards start processing on this date; allow an extra 2–5 business days for arrival. |
| Disclaimer Text | Text area (≤500 chars) | ✔ | Legal disclaimers or additional terms. |

#### Step 3: Pick a template
1. The **Pick a Template** panel opens.
2. Browse templates; filter by **size** (4×6, 6×9, 6×11), **sort**, and **source** (All / Library / Agency / User Templates).
3. Click a template to select it (it shows a **Selected** badge).
4. Choose one of the following options:

**Option A — Continue without editing**
1. With a template selected, click **Continue without Editing**.
2. An **Edit Template** confirmation appears: *"Do you want to continue without editing this template? You won't be able to change the text or images of it otherwise."*
3. Click **Continue without Editing** to confirm.

**Option B — Open in editor**
1. Click **Open in Editor**.
2. The template opens in the design editor; modify text, images, shapes, icons, and dynamic text as needed.
3. Save your changes and continue. *(See [Templates](04_templates.md) for the full editor guide.)*

#### Step 4: Configure the QR code
1. The **Configure QR Code** dialog appears.
2. In **QR Code Landing Page Link**, enter the web page the postcard's QR code should open. Make sure the link matches the service you're promoting.
3. Click **Save QR Code**.

#### Step 5: Choose your target audience (targeting)
On the campaign setup page (**"This campaign is not launched yet"**), under **Choose Your Target Audience**:
1. Pick a zone source: **Use Referral Address**, **Create New Zone**, or **Select Existing Zone**.
2. In **Enter Address**, start typing and **select an address from the autocomplete suggestions** (this is required for a valid zone).
3. Choose a targeting mode:
   - **Radius Mode** — drag the **Radius** slider to set how far out (in miles) to target from the address.
   - **Count Mode** — enter the **Number of Addresses** you want to reach.
4. Click **Find Addresses**.

> ⏱️ Generating addresses can take a few minutes for large areas (the app shows "Fetching addresses for this might take 5–7 minutes").

#### Step 6: Review addresses, cost, and validate
After addresses are found, the system shows:
- **Estimated Addresses**, **Coverage (sq mi)**, and a live map of the zone.
- A **cost breakdown**: Postcards to Send × **Cost per Postcard ($3.00)** = **Postcards Cost**, plus **Address Validation Cost**, for a **Total Cost**.

1. Review the estimated addresses and cost.
2. Click **Validate Addresses**.

> ⚠️ **Important:** *"You need to validate the addresses before sending any postcards. Once validated, the search cannot be changed."* Validation is a **paid** step ($0.025/address).

#### Step 7: Validation confirmation & payment *(payment‑gated)*
1. On the **Validation Confirmation** screen, review the validation results.
2. **Authorize the payment** required for address validation processing.
3. Continue to the launch step.

#### Step 8: Launch preparation *(payment‑gated)*
1. The system displays the complete list of validated recipients.
2. If applicable, enter any **coupon codes / promotional offers**.
3. Verify all campaign details.

#### Step 9: Payment authorization & launch *(payment‑gated)*
1. Select your **payment method** (managed via **Settings → Payments & Billing**, Stripe).
2. Authorize the campaign payment.
3. Click **Launch Campaign**.
4. The system processes the request and launches the campaign.

---

### Pops / Screenshots

**Screenshot B1: Create Campaign slider**
Select a campaign type (For Referrals / Location Zone / Address List) and enter the campaign name, start date, and disclaimer.

![Create Campaign slider](screenshots/cc_01_create_slider.png)

**Screenshot B2: Location Zone type selected**
The slider after choosing **Location Zone** — the referral selector is hidden and zone targeting is configured later on the setup page.

![Location Zone type](screenshots/cc_type2_location_zone.png)

**Screenshot B3: Pick a Template**
Available templates with size, sort, and source filters; choose **Continue without Editing** or **Open in Editor**.

![Pick a Template](screenshots/cc_lz_03_pick_template.png)

**Screenshot B4: Edit Template confirmation**
Prompt confirming you want to proceed without editing the chosen template.

![Edit Template confirmation](screenshots/cc_lz_03c_after_template_continue.png)

**Screenshot B5: Configure QR Code**
Set the landing‑page link encoded into the postcard's QR code.

![Configure QR Code](screenshots/cc_lz_04_confirm_or_setup.png)

**Screenshot B6: Campaign setup — targeting (Radius Mode)**
Choose the target audience source, enter an address, and set a radius; the postcard design preview and Campaign Overview appear alongside.

![Targeting setup](screenshots/camp_draft_detail.png)

**Screenshot B7: Count Mode**
Targeting by a specific number of addresses instead of a radius.

![Count Mode](screenshots/cc_setup_02_count_mode.png)

**Screenshot B8: Address autocomplete**
Typing an address surfaces suggestions; select one to define the zone center.

![Address autocomplete](screenshots/cc_setup_03_address_autocomplete.png)

**Screenshot B9: Addresses found — cost & map**
Estimated addresses, coverage, the zone map, and the full cost breakdown, with the **Validate Addresses** action.

![Addresses found with cost](screenshots/cc_setup_07_addresses_generated.png)

**Screenshot B10: Validation confirmation & payment** *(payment‑gated)*
> _[Screenshot to be added — this screen requires authorizing a real payment and was intentionally not triggered during documentation.]_

**Screenshot B11: Launch & payment authorization** *(payment‑gated)*
> _[Screenshot to be added — requires completing payment/launch.]_

---

### Validation & business rules (Campaign Creation)

- **Campaign Name** is limited to **20 characters**.
- **Disclaimer Text** is limited to **500 characters** and is required.
- For **For Referrals** campaigns, a **Referral must be selected**; its address becomes the campaign's primary location.
- The targeting **address must be selected from the autocomplete list**. A free‑typed/invalid address produces: *"Unable to process the address. Please check that the address is valid and try again."*
- **Addresses must be validated before any postcards can be sent.** Once validated, **the search cannot be changed**.
- **Estimated Start Date** drives processing; delivery typically takes an **additional 2–5 business days**.
- Cost is calculated as **postcards × per‑postcard price**, plus **validation × $0.025/address**.

---

## C. Tracking an Active Campaign

### Introduction

Once a campaign is launched it becomes **Active**. Opening it shows live performance and recipient response.

### Steps
1. Go to **Campaigns** and click an **Active** campaign.
2. The campaign detail page opens, showing its status (**Active**), created and published dates, and a **View Analytics** button.
3. Use the tabs to explore:
   - **Overview** — headline stats: **Postcards Sent, Scan Rate, Leads Generated, Total Spent**; a **Leads Locations** map; the **Postcard Design** (Front/Back) and **Full Screen Preview**.
   - **Targeting Map** — the geographic zone the campaign targeted.
   - **Activity** — the activity/event history for the campaign.
4. The **Campaign Overview** sidebar shows the linked **Referral**, **Template**, **Estimated Start Date**, the **QR Code** tracker, **Targeting** zone, and any **Associated Referral**.

### Pops / Screenshots

**Screenshot C1: Active campaign — Overview**
Live stats, leads map, postcard design, and the QR tracker code for a launched campaign.

![Active campaign detail](screenshots/camp_active_detail_v3.png)

---

## Finalization

After completing the campaign creation flow:
- A template is assigned to the campaign and a QR landing link is set.
- A target audience has been generated using **Radius** or **Count** mode (or an uploaded **Address List** / **Referral** location).
- All mailing addresses have been **validated**.
- Payment has been authorized and the campaign **launched**.
- The campaign appears in the **Campaigns** list as **Active**, with tracking and analytics available.

## Expected Result

The campaign is successfully created, validated, paid for, and launched. The system begins processing the campaign for delivery, and scans/leads start appearing on the campaign's **Overview** and the **Dashboard**.
