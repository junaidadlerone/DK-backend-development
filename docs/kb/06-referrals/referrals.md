# Referrals

A referral is a record of a completed or in-progress job at a homeowner's address. It acts as the seed for a "Referral" type campaign — you target the neighborhood around the job site, showing neighbors what you did nearby.

## Why Use Referrals

When you complete a job at a house, the neighbors are your most qualified prospects:
- They saw your truck and crew
- They know someone in the area already used your service
- They're likely to have similar needs

The referral workflow lets you take that completed job and turn it into a postcard campaign targeting the surrounding neighborhood, optionally featuring before/after photos of the actual job.

---

## Creating a Referral

1. Go to **Referrals** in the sidebar
2. Click **+ Create Referral**
3. Fill in the referral details:
   - **Homeowner name**: the customer's name
   - **Address**: the job site address (this becomes the campaign center point)
   - **Phone**: homeowner's phone number (optional)
   - **Email**: homeowner's email (optional)
   - **Job type**: e.g., "Roof Replacement", "HVAC Install", "Landscaping"
   - **Estimated job value**: the dollar value of the job
   - **Referral percentage**: your commission/referral rate (if applicable)
   - **Notes**: any relevant notes about the job or customer
4. Optionally upload **before and after photos** of the job
5. Click Save

---

## Referral Statuses

| Status | Meaning |
|---|---|
| **Draft** | Referral created but not yet ready for use |
| **Ready** | Referral is complete and available to link to a campaign |
| **In Use** | Linked to an active campaign — cannot be linked to another campaign |
| **Published** | The linked campaign has completed its mailing |

Referrals progress through these statuses automatically based on campaign events.

---

## Linking a Referral to a Campaign

When creating a new campaign, choose **Referral** as the campaign type. You'll be prompted to select a referral record. Only referrals in **Ready** status can be selected.

Once you link a referral and launch the campaign:
- The referral status changes to **In Use**
- The referral's address becomes the geographic center of the campaign's targeting zone
- Before/after photos (if uploaded) become available as dynamic variables in the postcard template (`{{before_image_id}}` and `{{after_image_id}}`)

---

## Referral Analytics

The Referrals list page shows aggregate stats:
- **Total Referrals**: all referral records in your organization
- **Campaign-Ready**: referrals in Ready status (can be used in a new campaign)
- **Average Job Value**: average of all estimated job values entered

---

## Referral History

Each referral has a history log showing every status change and which team member made the change. This is useful for tracking which campaigns were launched from which jobs.
