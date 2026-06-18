# Agency Client Management

## Client Organizations

In an agency workspace, each client is a separate sub-organization. Clients have their own:
- Campaigns, targeting zones, and templates
- Team members
- Billing (payment methods and invoice history)
- Analytics

Nothing crosses between clients unless you explicitly share it.

---

## Adding a New Client

From **Agency → Overview**, click **+ Add Organization**. You'll go through a short onboarding for the new client:

1. Business name and type
2. Business address
3. Branding (logo and colors)
4. (Optional) invite client team members

Once complete, the client appears in your Agency Overview grid and in the top-bar org switcher.

---

## Managing a Client's Campaigns

Switch to the client org using the top-bar switcher or the Agency Overview card. Once inside the client's context:
- Create zones, templates, and campaigns as you normally would
- All data created here belongs to this client only
- Billing is charged to the payment method on file for this client org

---

## Sharing Agency Templates with Clients

Agency-level templates (created at **Agency → Templates**) can be shared with one or more client organizations:

1. Open the template in **Agency → Templates**
2. Click **Share** (or the share icon)
3. Select which client organizations should have access
4. Click Save

Shared templates appear in the client org's template library. Clients can select them for campaigns but **cannot edit** shared templates. To modify a shared template for a specific client, duplicate it first within the client's org.

---

## Client Team Members vs Agency Team Members

| | Agency Team Member | Client Team Member |
|---|---|---|
| Added via | Agency → Team | (within client org) → Settings → Team |
| Access | All client orgs under this agency | Only this specific client org |
| Best for | Agency staff working across multiple clients | Client's own employees |

---

## Billing Per Client

Each client organization manages its own billing independently:
- Payment methods: Settings → Subscription/Payments (while in the client's org)
- Billing history: Settings → Subscription/Payments → Billing History
- Each campaign launch charges the client org's default payment method

There is no agency-level consolidated billing. Each client org is billed separately.

---

## Deleting a Client Organization

If you need to remove a client organization:
1. Switch into the client's org
2. Go to **Settings → Danger Zone**
3. Click **Delete Organization**
4. Type the organization name to confirm

Deletion is scheduled 30 days in the future — see the Organization Settings guide for details on the recovery window.

---

## Client Analytics

Analytics are per-client. Switch to a client's org to see their campaign performance, delivery rates, and ROI data. There is no cross-client aggregate analytics dashboard.
