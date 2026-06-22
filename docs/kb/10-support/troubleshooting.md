# Troubleshooting

---

## Campaigns

**My campaign won't launch — it's grayed out or showing an error.**
Check these four things in order:
1. **Your role**: only Admin and Owner can launch campaigns. Marketers cannot. If you're a Marketer, ask your Admin.
2. **Zone attached**: is a targeting zone selected on the campaign?
3. **Verified addresses**: run address verification on the zone if you haven't — unverified addresses don't count
4. **Payment method**: go to Settings → Subscription/Payments and confirm a card is on file

**"Error: All consents must be provided"**
Scroll to the bottom of the campaign launch review page. There are several consent checkboxes — all must be checked before you can launch. Scroll down to find any unchecked ones.

**My campaign launched but the delivery status hasn't updated.**
Allow 1–2 business days after launch for initial statuses to appear. The full end-to-end timeline (launch → doorstep) is typically 5–10 business days:
- Days 1–2: printing
- Days 2–4: processing and handoff to mail carrier
- Days 4–10: in-transit to recipient

If 12+ business days have passed with no status change past "Printing," contact support with your campaign name.

**Postcards haven't arrived — it's been more than 2 weeks.**
First check the campaign detail page for per-address delivery statuses. If addresses show "Completed," the postcards were delivered per carrier confirmation — though occasional carrier errors do happen. If addresses are still "Processed for Delivery" after 2 weeks, contact support.

**Campaign status shows "Active" but nothing is being delivered.**
Active means the campaign is in the print queue — not that all postcards have been delivered. Check the campaign detail page for individual address delivery statuses. Delivery takes 3–7 business days.

**I want to make a change to a launched campaign.**
You cannot edit a launched campaign. Duplicate it instead (Campaigns → open campaign → Duplicate), make your changes to the new Draft, and launch the duplicate.

---

## Targeting and Zones

**Address verification is taking a very long time.**
Large zones (1,000 addresses) can take 5 minutes or more. Keep the browser tab open and wait. If it's been more than 15 minutes with no result, refresh the page and try running verification again.

**Address verification returned mostly invalid addresses.**
This can happen in rural areas or newer developments where address data is incomplete. You can:
- Accept a lower verified count (you only pay for what verifies)
- Manually add specific known-valid addresses
- Use an Address List campaign and upload a pre-verified CSV

**The map isn't loading.**
Try a hard refresh: Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows. If it still doesn't load, clear your browser cache and try again. If the issue persists across devices, contact support.

**I uploaded a CSV but the addresses aren't mapping correctly.**
The required column headers are exactly: `street_address`, `city`, `state`, `postal_code`. Your CSV headers must match (case-sensitive). Use the column mapping step during upload to manually assign your column names if they differ.

**I switched organizations and now I can't find my campaigns.**
Campaigns are scoped to their organization. After switching orgs, you're seeing the new org's data. Check the organization name in the top bar — switch back to your original org to find your campaigns.

---

## Templates

**My QR code isn't showing on the postcard preview.**
Two things must be true:
1. A QR Code element is added to the template in the editor
2. That element is linked to the `{{qr_url}}` variable in its properties

If both are set up and it still doesn't show, try saving the template and reopening it.

**The template editor is showing a different font than I expected.**
Make sure the font is set both in Settings → Branding (Heading Font) and applied within the text element in the template editor. Changes to branding only apply to template elements that use the brand heading font variable — manually-set font choices in individual text elements won't change.

**I can't delete a template.**
Templates cannot be deleted while they are used by an active campaign. Archive or complete the associated campaign first, then try deleting the template.

---

## Billing and Payments

**I can't delete my payment method.**
You cannot remove the last payment method on file. Add a new card first, set it as your default, then remove the old one.

**I don't see the Billing tab in Settings.**
Billing is restricted to Admin and Owner roles. If you don't see it, you likely have a Marketer or Technician role. Contact your organization's Admin for billing information.

**My payment failed when launching a campaign.**
The campaign is still in Draft status — nothing was charged. Common reasons:
- Card expired: update it in Settings → Subscription/Payments
- Insufficient funds: try a different card
- Card declined: contact your bank, or use a different payment method

**I can't find an old invoice.**
All invoices are in Settings → Subscription/Payments → Billing History. They're sorted by date. If a specific transaction isn't there, contact support with the approximate date and amount.

---

## Team and Account

**An invited team member isn't receiving their invitation email.**
Ask them to check their spam/junk folder. If it's not there, go to Team → find the pending invite row → click Resend Invite.

**I accidentally deleted my organization.**
Go to Settings — you'll see a red recovery banner at the top. Click it to cancel the deletion. You have 30 days from when deletion was initiated. After 30 days, recovery is not possible.

**I'm locked out of my account.**
Use the "Forgot Password" link on the login page to reset your password via email. If you don't receive the reset email, check spam or contact support.

**I can't see Analytics data for my campaign.**
Analytics update with a 24–48 hour delay. If it's been less than 2 days since launch, wait. If it's been over a week and no data appears, contact support with your campaign name and launch date.

**The app is showing an error page or blank screen.**
Try: (1) hard refresh (Cmd+Shift+R / Ctrl+Shift+R), (2) clear browser cache, (3) try a different browser. If the issue persists, contact support.
