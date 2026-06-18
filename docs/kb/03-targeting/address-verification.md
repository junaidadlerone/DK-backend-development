# Address Verification

Address verification is the process of checking every address in a zone to confirm it is physically deliverable by a mail carrier. Only verified addresses are included in a campaign send — you are never charged for undeliverable addresses.

## Why Verification Matters

Without verification, you might pay to print and mail postcards to addresses that don't exist, are vacant, or can't receive mail. Verification filters these out before you're charged, saving money and improving your delivery rate.

## How to Verify

1. Open a zone from **Targeting → Zones**
2. Click **Validate Addresses**
3. Wait while the system checks each address — this can take a few seconds for small zones or several minutes for large ones (1,000 addresses may take 5+ minutes)
4. Keep the page open; navigating away does not cancel verification but you won't see progress updates
5. When complete, the map updates to show each address in its new status

## What Gets Checked

The verification service checks each address against national address databases to confirm:
- The street address actually exists
- The address is served by a mail carrier
- The address format is correct

## Understanding Results on the Map

After verification, each address marker is color-coded:

| Color | Status | Meaning |
|---|---|---|
| Green | Valid | Address verified, will receive a postcard |
| Red/Orange | Invalid/Unverified | Could not verify, excluded from the send |
| Yellow | Duplicate | Same location as another address in the zone |

## Verified vs Unverified Addresses

- **Verified addresses** are counted toward your campaign cost
- **Unverified and invalid addresses** are excluded from the send and not charged
- **Duplicate addresses** are flagged — adding a unit/suite/apartment number usually resolves these

## Skipping Verification (Address List Campaigns Only)

For Address List campaigns, you can skip verification if you already have a pre-verified list. However, even with verification skipped, if an address fails carrier acceptance at the time of mailing, that postcard will not be delivered.

It is always recommended to verify, even with your own list.

## When to Re-Verify

If you haven't launched a campaign yet and significant time has passed since creating the zone (e.g., months), consider re-verifying before launch. Address data can change — buildings get demolished, new units are added.

## Verification Status on Campaign Detail

Once a campaign launches, each address on the campaign detail page shows its individual delivery status (separate from the zone-level verification status). These update in real-time as postcards move through the mail system.
