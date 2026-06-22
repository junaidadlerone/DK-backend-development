# Global Exclusions and Opt-Outs

Global exclusions are a permanent do-not-mail list for your organization. Any address on this list is excluded from all targeting zones — past, present, and future.

## What They're Used For

- **Opt-out requests**: if someone asks to be removed from your mailings, add their address here
- **Your own address**: to avoid mailing postcards to yourself
- **Addresses you never want to target**: competitors, already-converted customers, etc.

## How to Add an Exclusion

1. Go to **Targeting → Exclusions**
2. Click **+ Add Exclusion**
3. Enter the address
4. The address is immediately excluded from all future zone searches

## How Exclusions Work

Excluded addresses are matched by GPS coordinates (with approximately 0.1 meter precision). This means:
- Even if the address is formatted differently in two zones, if it resolves to the same location, it's excluded
- Exclusions are matched against address data at the time of zone creation or re-search

**Important**: Exclusions apply to **future** zone searches and campaign launches only. If an address was already added to a saved zone before it was excluded, it will remain in that zone's address list. To remove it from an existing zone, you would need to delete the address from that zone manually.

## Exclusions and Campaign Billing

Addresses with opt-out/excluded status are not charged, even if they somehow appear in a zone — the system skips them at send time.

## Can I Undo an Exclusion?

Exclusions cannot be removed from within the app. If an address was added to the exclusion list by mistake, contact DoorKnocker support to have it removed.

## Exclusions Apply Organization-Wide

Global exclusions apply to your entire organization — all team members, all zones, all campaigns. They cannot be scoped to individual campaigns or users.

For agency workspaces, exclusions are per-client organization. A global exclusion in Client A's org does not affect Client B's org.

## Viewing the Exclusions List

**Targeting → Exclusions** shows all excluded addresses for your organization with the date they were added and who added them (if available).
