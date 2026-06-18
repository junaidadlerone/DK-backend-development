# Address Statuses

Each address in a targeting zone has a status that reflects its deliverability and opt-out state.

## Zone-Level Address Statuses

These statuses appear on the zone detail page and campaign detail map:

### Valid
The address has been verified and is confirmed deliverable. It will receive a postcard when a campaign is launched.

### Unverified
The address has not been checked yet, or the verification check returned an inconclusive result. Unverified addresses are **excluded from the campaign send** and you are not charged for them.

To resolve: run address verification (Targeting → Zones → open zone → Validate Addresses).

### Duplicate
The address matches the coordinates of another address already in the zone. This usually means two records point to the same physical location.

To resolve: add more specificity to the address — an apartment number, suite number, or unit number usually differentiates two entries at the same building.

### Opt-Out
This address has been added to your organization's global exclusion list. It will never appear in campaign sends, regardless of the zone.

To understand opt-outs, see the Global Exclusions guide.

---

## Campaign-Level Delivery Statuses

Once a campaign is launched, each address on the campaign detail page shows a delivery status that updates as the mailing progresses:

| Status | Meaning |
|---|---|
| Ready | Queued for printing |
| Printing | Postcard is being printed |
| Processed for Delivery | Handed off to mail carrier |
| Completed | Carrier confirms delivery |
| Cancelled | This address was cancelled (e.g., returned to sender) |

---

## How Statuses Affect Billing

You are charged **only for addresses with Valid (verified) status** in a zone at the time of campaign launch. The cost calculation excludes:
- Unverified addresses
- Duplicate addresses (unless they have different unit numbers that pass verification separately)
- Opt-out addresses

---

## Handling Problem Addresses

| Problem | What To Do |
|---|---|
| Many unverified addresses | Run verification; addresses in remote areas may still fail — this is normal |
| Duplicate addresses | Add unit/suite/apt to differentiate; if truly duplicates, remove one |
| Opt-out addresses | These cannot be mailed to — they are permanently excluded |
| Addresses in the wrong area | Remove them from the zone manually, or adjust the zone boundary |
