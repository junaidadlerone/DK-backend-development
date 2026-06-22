# Targeting Zones

A targeting zone is a saved geographic area with a list of addresses. Zones are the core of how DoorKnocker determines who receives postcards.

## What a Zone Contains

- A **center point** (a street address or GPS coordinates)
- A **search mode** (radius or count)
- A **search radius or count** (how far or how many)
- An **address type filter** (residential, commercial, or both)
- The resulting **list of addresses** found within those parameters

## Why Zones Are Reusable

Once you save a zone, you can use it in multiple campaigns. This means you can mail the same neighborhood quarterly without having to redefine the area each time.

---

## Two Search Modes

### Radius Mode
Finds all addresses within a set number of miles from the center point.

- Minimum: 0.1 miles
- Maximum: 5.0 miles
- Good for: targeting everyone in a specific radius, like "mail everyone within 1 mile of our job site"

### Count Mode
Finds the closest N addresses to the center point, regardless of distance.

- Minimum: 10 addresses
- Maximum: 1,000 addresses
- Good for: controlling campaign size (and cost) precisely, like "send to the 200 closest homes"

---

## Address Types

You can filter the addresses discovered in your zone:

| Option | What It Includes |
|---|---|
| Residential Only | Houses, apartments, condos |
| Commercial Only | Businesses and commercial properties |
| Both | All address types found in the area |

---

## Setting the Center Point

The center point is where the search radiates outward from. You can enter:
- A full street address (e.g., "4512 Red River St, Austin TX 78751")
- GPS coordinates in lat,lng format (e.g., "30.2672,-97.7431")

---

## Finding Addresses

After setting your center point, radius/count, and address type:
1. Click **Find Addresses**
2. Wait 5–30 seconds while the platform queries address data
3. Results appear on the map with colored markers:
   - **Orange**: center point
   - **Blue**: residential addresses
   - **Gray**: commercial addresses
4. The address count is shown below the map

---

## Saving a Zone

Click **Create Zone** (or Save) to save the zone. It will appear in **Targeting → Zones** and can be selected when creating a campaign.

---

## The Zones List

**Targeting → Zones** shows all saved zones for your organization. Each row shows:
- Zone name
- Total address count
- Center address
- Search mode (radius or count)
- Date created

Click any zone to view the map and address details, or to re-run address discovery with updated parameters.
