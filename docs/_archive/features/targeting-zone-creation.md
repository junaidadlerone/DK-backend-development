# Create Targeting Zone

**URL**: http://localhost:5173/targeting/zones/create

## Sections
### Create Targeting Zone
### Target Zone Configurations
### Filtering Options
### Basic Information
### Estimated Results

## Form Fields
- radio: searchMode
- radio: searchMode
- text: Enter center address

## Field Labels
- Radius Mode
- Count Mode
- Radius
- Include Residential *

Filter out commercial properties
- Include Commercial *

Include business addresses
- Center Address *

## Actions
- AC
Acme Corp
- Quick Actions
- Notifications
- PU

Playwright User

playwright@mailinator.com
- Dashboard
- Referrals
- Campaigns
- Templates
- Targeting
- Targeting Zones
- Addresses Collection
- Global Exclusions & Opt-outs
- Analytics
- Settings
- Create Zone

## Page Content
```
Targeting
Targeting Zones
Create Targeting Zone
Create Targeting Zone
Create Zone
Target Zone Configurations
Radius Mode
Count Mode
Radius
0.1 miles
Enter an address and press Enter to see the map
Filtering Options
Include Residential *
Filter out commercial properties
Include Commercial *
Include business addresses
Basic Information
Center Address *
Estimated Results
Estimated Addresses
Residential Properties
Commercial Properties
Global Exclusions
Final Count
```

## Notes

## How to Create a Targeting Zone

1. Enter center address — street address or lat,lng (e.g. 30.2672,-97.7431)
2. Choose search mode:
   - **Radius**: all addresses within N miles
   - **Count**: closest N addresses
3. Set radius (0.1–5.0 miles) or count (10–1000)
4. Select address types: Residential, Commercial, or Both
5. Press Enter or click Find Addresses — backend searches via WebSocket
6. Wait 5–30 seconds for results
7. Review on map: orange = center, blue = residential, gray = commercial
8. Click "Create Zone" to save

## Tips
- Use lat,lng coordinates for precise centers
- Radius mode = neighborhood blitz
- Count mode = budget-controlled (postcard count = address count)
