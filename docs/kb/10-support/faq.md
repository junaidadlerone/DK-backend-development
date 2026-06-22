# Frequently Asked Questions

---

## Getting Started

**How do I create an account?**
Go to the DoorKnocker sign-up page and enter your email and password, or sign in with Google. After signing up, check your email for a verification link — you must click it before you can access the app.

**What's the difference between Business and Agency?**
Business is for a single company running its own campaigns. Agency is for marketing agencies that manage campaigns for multiple client businesses from a single login. Each client gets their own isolated workspace with separate campaigns, billing, and team members.

**Can I change my workspace type (Business to Agency or vice versa) after signing up?**
No. Workspace type is locked after onboarding. Contact support if you chose the wrong type.

**What's the first thing I should do after signing up?**
Complete onboarding (you'll be taken there automatically), then go to Targeting → Zones to create your first targeting area, or go to Templates to build your first postcard design.

**How do I invite team members?**
Go to Team in the sidebar (or Settings → Team), click "+ Invite Member," enter their email, select a role, and send the invite. They'll receive an email to join.

---

## Campaigns

**How do I create a campaign?**
Go to Campaigns → + New Campaign. Name your campaign, select a targeting zone (or upload a CSV), choose a postcard template, review the cost, accept the consents, and click Launch.

**What are the three campaign types?**
1. **Location Zone** — targets all addresses within a geographic radius
2. **Address List** — targets addresses from a CSV you upload
3. **Referral** — targets the neighborhood around a specific job site

**How much does a campaign cost?**
$3.00 per postcard for Standard paper, $3.50 for Premium. You're only charged for verified, deliverable addresses. There's no minimum order.

**Can I edit a campaign after it launches?**
No. Once launched, postcards enter the print queue immediately. Edits are disabled. Duplicate the campaign to make a new editable version.

**Can I cancel a launched campaign and get a refund?**
No. Once launched, the order cannot be cancelled or refunded. Postcards are sent to the printer immediately after launch.

**Why won't my campaign launch?**
Common blockers:
1. You have a Marketer role — only Admins and Owners can launch
2. No targeting zone is attached
3. No verified addresses in the zone
4. No payment method on file
5. Not all consent checkboxes are checked on the review step

**What is a draft campaign?**
A draft is a campaign you've started but haven't launched yet. Drafts are saved automatically after you name the campaign. You can return to a draft from the Campaigns list and continue where you left off.

**How do I duplicate a campaign?**
Open the campaign from the Campaigns list, click the options menu (three dots or kebab menu), and select Duplicate. A new Draft campaign is created with the same zone and template.

**How long does it take for postcards to be delivered?**
The typical end-to-end timeline from launch to doorstep is **5–10 business days**:
- Printing: 1–2 business days
- Processing and carrier handoff: 1–2 business days
- In-transit delivery: 3–7 business days

Metropolitan and suburban addresses usually arrive toward the shorter end of that range. Rural or remote addresses may take up to 10 business days. Holidays and high-volume postal periods can extend delivery. You can track per-address delivery progress on the campaign detail page.

**When will the "Completed" delivery status appear?**
"Completed" means the mail carrier has confirmed delivery. This typically appears 5–10 business days after launch. If an address is undeliverable the status shows "Cancelled" and you are not charged for that address.

---

## Targeting and Zones

**What's the difference between Radius and Count mode when creating a zone?**
Radius mode finds all addresses within X miles of your center point. Count mode finds the closest N addresses to your center point regardless of distance. Use Radius to cover a geographic area; use Count to control campaign size precisely.

**How long does address discovery take?**
Usually 5–30 seconds for zones under 500 addresses. Larger zones (1,000 addresses) can take up to a few minutes. Keep the page open — navigating away won't cancel it, but you won't see progress.

**What does "verified" mean for an address?**
Verified means the address passed a check against national address databases confirming it exists and is physically deliverable by a mail carrier. Only verified addresses are mailed and charged.

**Why are some addresses marked as "duplicate"?**
Two addresses resolve to the same GPS coordinates — usually this means two units at the same building without a unit number. Add an apartment/suite/unit number to differentiate them.

**How do I permanently exclude an address from all my campaigns?**
Go to Targeting → Exclusions → + Add Exclusion. Once added, that address is excluded from all zones for your organization, now and in the future.

**Can I upload my own list of addresses instead of drawing a zone?**
Yes. Create a campaign and choose "Address List" as the type. You'll be prompted to upload a CSV. Required columns: `street_address`, `city`, `state`, `postal_code`.

---

## Templates and Postcards

**What postcard sizes are available?**
4×6 inches, 6×9 inches, and 6×11 inches. The size is chosen when creating the template and cannot be changed after.

**What are dynamic variables?**
Placeholders in your template design that get filled in automatically when a campaign is launched. For example, `{{business_name}}` is replaced with your organization's name. Use them to create one reusable template for multiple campaigns.

**Is the return address required on the postcard?**
Yes. The back of every postcard must include a return address. It's typically your business's official mailing address.

**Can I add a QR code to my postcard?**
Yes. Add a QR Code element from the template editor. Link it to the `{{qr_url}}` variable. Each campaign generates a unique QR code automatically so you can track scans per campaign.

**Can I change the postcard size after creating a template?**
No. Size is permanent. Duplicate the template and select the new size when creating the duplicate.

**What's the difference between Standard and Premium paper?**
Standard ($3.00/postcard) is regular postcard stock. Premium ($3.50/postcard) is heavier, higher-quality paper with a better finish. Both are the same physical size — only the paper quality differs.

---

## Billing and Payments

**When am I charged?**
You are charged immediately when you click Launch on a campaign. Payment is taken at the point of launch, not after delivery.

**What payment methods are accepted?**
Credit and debit cards (Visa, Mastercard, American Express, Discover). Manage cards at Settings → Subscription/Payments.

**How do I apply a coupon code?**
Enter the coupon code in the coupon field on the campaign review/launch step. The discount is shown before you confirm.

**Where do I find my invoices?**
Settings → Subscription/Payments → Billing History. Click the download icon on any row to get a PDF invoice.

**Who can add or remove payment methods?**
Only Admin and Owner roles. Marketers and Technicians cannot access billing.

**What happens if my payment fails?**
The campaign does not launch and stays as a Draft. Update your payment method in Settings and try launching again.

---

## Team and Roles

**What can a Marketer do that a Technician can't?**
Marketers can create and edit campaigns, targeting zones, and templates, and view analytics. Technicians are limited to creating and managing referrals — they cannot create campaigns or view analytics.

**Why can't I launch my campaign?**
Most likely you have a Marketer role. Only Admins and Owners can process payments and launch campaigns. Ask your Admin or Owner to launch it, or ask them to upgrade your role.

**How do I change someone's role?**
Go to Team in the sidebar, find the team member, click the role badge next to their name, and select the new role. Only Admins and Owners can change roles.

**Can I transfer ownership of my organization?**
Yes. Go to Settings → find the Transfer Ownership option. Select the new owner and confirm. This is irreversible — the new owner gets the Owner role and you become an Admin.

---

## Referrals

**What is a referral?**
A referral is a record of a completed job at a homeowner's address. It's used to create a "Referral" type campaign that targets the neighborhood around that job site, optionally using before/after job photos in the postcard design.

**How do I link a referral to a campaign?**
Create a campaign, choose "Referral" as the campaign type, and select the referral from your referral list. Only referrals in "Ready" status can be selected.

**What does "In Use" mean for a referral status?**
The referral is currently linked to an active campaign that's in the print or mail queue. It cannot be linked to another campaign until the current one finishes, at which point it moves to "Published."

---

## Agency

**How do I manage multiple clients?**
Use an Agency workspace. Create client organizations from Agency → Overview → + Add Organization. Switch between clients using the top-bar org switcher.

**Can I share templates across clients?**
Yes. Create templates in Agency → Templates, then open any template and click Share to select which client organizations can use it. Clients can use shared templates but cannot edit them.

**Does each client get their own billing?**
Yes. Each client organization has its own payment methods and billing history. There is no agency-level consolidated billing.

---

## Account and Settings

**How do I delete my organization?**
Settings → Danger Zone → Delete Organization → type your org name to confirm. Deletion is scheduled 30 days out — not immediate. Only the Owner can do this.

**Can I recover a deleted organization?**
Yes, within 30 days of initiating deletion. Click the recovery banner that appears at the top of the app, or go to Settings → Danger Zone → Cancel Deletion. After 30 days, recovery is not possible.

**How do I change my password?**
Profile (click your name at the bottom of the sidebar) → Password section → enter current password, new password, confirm. Click Update Password.

**Can I change my email address?**
Not from within the app — your email is your account identity. Contact support to change it.
