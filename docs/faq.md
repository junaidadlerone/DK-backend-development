# DoorKnocker FAQ

## What is DoorKnocker?

DoorKnocker is a web application for managing door-to-door marketing campaigns. It helps you identify target addresses, send postcards, verify addresses, and track campaign analytics — all in one place.

## How do I create a campaign?

Go to the Campaigns section from the left sidebar, then click "Create Campaign." You will be guided through steps: choosing a name, setting up your targeting zone, selecting a postcard template, and configuring your send settings.

## What is a Targeting Zone?

A targeting zone is a geographic area you define by entering a center address and a radius (in miles) or a count of addresses. DoorKnocker finds all residential and/or commercial addresses within that zone so you know exactly where your postcards will go.

## How do I create a Targeting Zone?

Go to Targeting → Targeting Zones → Create Targeting Zone. Enter a center address (or latitude/longitude), choose radius mode or count mode, set your search parameters, and click Find Addresses. Once addresses are found, click Create Zone.

## What is address verification?

Address verification checks each address in your zone against the postal database to confirm it is deliverable. Verified addresses are shown in green; undeliverable addresses are shown in red. Verification uses PostGrid.

## How do I validate addresses in my campaign?

On the campaign creation page, go to the Targeting step. After selecting or creating a zone, click "Validate Addresses." A progress indicator will show as each address is checked. Verified addresses turn green.

## What postcard sizes are available?

DoorKnocker supports standard postcard sizes. You can choose from available templates or create a custom design. Templates are managed in the Templates section.

## How do I create a postcard template?

Go to Templates in the left sidebar. Click "Create Template" and use the design editor to set up your postcard — add text, images, and your return address. Save the template and it will be available when creating campaigns.

## How do I send postcards?

Once your campaign has a targeting zone with verified addresses and a postcard template selected, go to the final step of campaign creation and click "Send." You will be shown a cost estimate before confirming.

## What does a campaign cost?

The cost depends on how many postcards you send. Each postcard has a per-unit cost. You can see the estimated total on the campaign overview before sending. Billing is handled through Stripe.

## How do I see how my campaign is performing?

Go to Analytics in the left sidebar. You can see campaign-level stats including how many postcards were sent, delivery status, and other metrics. Individual campaign analytics are also available on the campaign detail page.

## Can I filter addresses by residential or commercial?

Yes. When creating a targeting zone, you can choose to include residential addresses, commercial addresses, or both. This filter is set in the zone creation flow under Filtering Options.

## How do I use radius mode vs count mode?

- Radius mode: finds all addresses within a specific radius (in miles) from your center point.
- Count mode: finds the closest N addresses to your center point, up to your specified count.

## What is a sandbox campaign?

The sandbox mode lets you test campaigns with a flat fee rather than paying per postcard. Use it to test your targeting and template without committing to a live send.

## How do I invite team members?

Go to Settings → Team. Click "Invite Member," enter their email and role, and they will receive an invitation. Roles available: Admin, Marketer, Technician.

## Can I have multiple organizations?

Yes. DoorKnocker supports multiple organizations under one account. You can switch between organizations using the organization switcher in the sidebar.

## How do I update my billing information?

Go to Settings → Billing. You can view your billing history, update your payment method, and manage your subscription through the Stripe billing portal.

## What if I get an "Unable to find the address" error?

This usually means the address could not be geocoded. Try entering the address in a different format, or use latitude/longitude coordinates directly (e.g., 32.7767, -96.7970). Make sure the address is a valid US address.

## How do I view all addresses in a campaign zone?

On the campaign detail page, scroll to the Targeting section. The map will show all addresses in your zone. Green markers are verified; red markers are unverified or undeliverable. You can also see the count in the zone stats.

## What browsers are supported?

DoorKnocker works best in modern browsers: Chrome, Firefox, Edge, and Safari. Internet Explorer is not supported.

## How do I contact support?

Use this support chat, or email us at support@adlerone.com.
