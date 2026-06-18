# Campaign Statuses and Lifecycle

Every campaign moves through a set of statuses from creation to completion.

## Campaign Statuses

### Draft
- Campaign has been started but not launched
- All fields are editable (name, zone, template, paper quality)
- No payment has been taken
- Drafts appear in the campaign list and can be returned to at any time

### Active
- Campaign has been launched and postcards are in the print and mail queue
- Cannot be edited — the order is already processing
- Delivery status for individual addresses updates on the campaign detail page as postcards move through the mail system

### Inactive
- Campaign has ended (all postcards delivered) or was manually set to inactive
- Historical data is preserved; analytics are still viewable
- Cannot be re-activated for new sends — duplicate the campaign to create a new draft

### Archived
- Campaign is hidden from the default campaigns list view
- Still accessible by filtering for "Archived" campaigns
- Data is preserved for reporting purposes
- Archived campaigns can be unarchived

## Delivery Statuses (Per Address)

On the campaign detail page, each address shows an individual delivery status:

| Status | Meaning |
|---|---|
| Ready | Address verified, postcard queued for printing |
| Printing | Postcard is being printed |
| Processed for Delivery | Postcard handed off to mail carrier |
| Completed | Mail carrier confirms delivery |
| Cancelled | This specific address was cancelled (e.g., returned to sender) |

Delivery statuses update automatically as the mailing progresses. Allow 1–2 business days for initial statuses to appear after launch.

## Delivery Timeline

From the moment you launch a campaign, here is the typical end-to-end timeline:

| Phase | Time |
|---|---|
| Printing | 1–2 business days |
| Processing and handoff to mail carrier | 1–2 business days |
| In-transit delivery | 3–7 business days |
| **Total (launch to doorstep)** | **5–10 business days** |

- Delivery times depend on distance from the print facility to the recipient addresses and standard mail carrier schedules.
- Business-dense or metropolitan areas tend to be on the shorter end (5–7 days); rural or remote addresses may take closer to 10 business days.
- These are estimates — actual delivery can vary with holidays, weather, and postal service volume.
- You can monitor per-address delivery progress on the campaign detail page. Statuses update as we receive tracking information from the mail carrier.
- DoorKnocker does not guarantee specific delivery dates. If an address is undeliverable, it receives a "Cancelled" status and is not charged.

## Referral Status Changes Tied to Campaigns

When a Referral-type campaign is created and launched, the linked referral's status changes automatically:

| Campaign Event | Referral Status |
|---|---|
| Campaign created (draft) | Ready |
| Campaign launched | In Use |
| Campaign completes mailing | Published |

A referral that is "In Use" cannot be linked to another campaign until its current campaign is complete.

## Campaign Lifecycle Summary

```
[Created] → Draft → [Launched] → Active → [Mailing complete] → Inactive
                                               ↓
                                          [Archived manually]
                                               ↓
                                           Archived
```
