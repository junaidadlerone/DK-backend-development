# Getting Started with DoorKnocker

## Welcome

DoorKnocker is a web platform for running door-to-door marketing campaigns. This guide walks you through setting up your first campaign from scratch.

## Step 1: Set Up Your Organization

After signing up, you will be asked to create or join an organization. An organization is your workspace — all campaigns, zones, and templates belong to an organization.

- Go to Settings → Organization to update your organization name, logo, and details.
- Invite team members from Settings → Team.

## Step 2: Create a Targeting Zone

A targeting zone defines the geographic area you want to reach.

1. Go to **Targeting → Targeting Zones** in the left sidebar.
2. Click **Create Targeting Zone**.
3. Enter a **center address** (street address or latitude,longitude).
4. Choose **Radius mode** (e.g. 0.5 miles) or **Count mode** (e.g. 100 closest addresses).
5. Choose whether to include residential, commercial, or all addresses.
6. Click **Find Addresses**. DoorKnocker will locate all addresses in your zone.
7. Review the results on the map, then click **Create Zone** to save.

## Step 3: Create a Postcard Template

Your template is the design that will be printed and mailed to each address.

1. Go to **Templates** in the sidebar.
2. Click **Create Template**.
3. Design your postcard using the editor — add text, your logo, images, and a call to action.
4. Enter your return address.
5. Save the template.

## Step 4: Create a Campaign

A campaign links your targeting zone and postcard template together.

1. Go to **Campaigns** in the sidebar.
2. Click **Create Campaign**.
3. Enter a campaign name.
4. In the **Targeting** step, select an existing zone or create a new one.
5. Click **Validate Addresses** to check which addresses are deliverable (this may take a few minutes).
6. In the **Postcard** step, select your template.
7. Review the cost estimate and click **Send** to launch your campaign.

## Step 5: Monitor Your Campaign

After sending, you can track your campaign from the campaign detail page:

- Go to **Campaigns** and click your campaign name.
- See the number of postcards sent, delivery status, and zone map.
- For deeper analytics, go to **Analytics** in the sidebar.

## Key Concepts

**Targeting Zone**: A geographic area defined by a center point and either a radius or an address count. Zones are reusable across campaigns.

**Address Verification**: DoorKnocker checks each address against the postal database. Verified addresses (green) are deliverable. Undeliverable addresses (red) are filtered out before sending.

**Templates**: Reusable postcard designs. One template can be used in multiple campaigns.

**Campaign**: The combination of a targeting zone, a postcard template, and a send action. Campaigns track how many postcards were sent and their delivery status.

**Sandbox Mode**: A test mode that lets you run a campaign for a flat fee without sending real postcards. Useful for testing your setup.

## Roles and Permissions

- **Admin**: Full access — can manage organization, billing, team, campaigns, zones, and templates.
- **Marketer**: Can create and manage campaigns, zones, and templates.
- **Technician**: Limited access for operational tasks.

## Tips

- Use radius mode for neighborhood blitzes; use count mode when you want to control exact postcard volume.
- Validate addresses before sending to avoid paying for undeliverable mail.
- Save frequently used designs as templates to speed up future campaigns.
- Use the sandbox to test a new market before committing to a full send.
