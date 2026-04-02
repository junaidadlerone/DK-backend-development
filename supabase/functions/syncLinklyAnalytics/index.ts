import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Sync Linkly Analytics Cron Job
 * Runs daily to fetch click analytics from Linkly and update campaign metrics
 *
 * Process:
 * 1. Fetch all campaigns with tracker_id (not null)
 * 2. For each campaign, call Linkly API to get click stats
 * 3. Calculate total leads (sum of all y values)
 * 4. Calculate scan_rate = (leads_gen / postcards_sent) * 100
 * 5. Calculate estimated ROI = ((revenue - cost) / cost) * 100
 *    - Cost: postcards_sent * $3 per postcard
 *    - Revenue: leads_gen * $1000 assumed revenue per lead
 * 6. Update campaign with new metrics (leads_gen, scan_rate, roi)
 */

interface LinklyTrafficData {
  traffic: Array<{
    y: number;
    t: string;
  }>;
}

Deno.serve(async (req) => {
  console.log("Starting Linkly analytics sync...");

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    const linklyApiKey = Deno.env.get("LINKLY_API_KEY");
    const linklyWorkspaceId = Deno.env.get("LINKLY_WORKSPACE_ID");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!linklyApiKey || !linklyWorkspaceId) {
      console.error("Linkly credentials not found in headers or environment");
      return new Response(
        JSON.stringify({
          error:
            "Missing Linkly credentials (x-linkly-api-key, x-linkly-workspace-id headers or env vars)",
          success: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!serviceRoleKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY not set in environment");
      return new Response(
        JSON.stringify({
          error: "Missing SUPABASE_SERVICE_ROLE_KEY in environment",
          success: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fetch all campaigns that have a postgrid_tracker_id
    const { data: campaigns, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, postgrid_tracker_id, postcards_sent, leads_gen")
      .not("postgrid_tracker_id", "is", null);

    if (fetchError) {
      console.error("Error fetching campaigns:", fetchError);
      return new Response(
        JSON.stringify({
          error: `Failed to fetch campaigns: ${fetchError.message}`,
          details: fetchError,
          success: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!campaigns || campaigns.length === 0) {
      console.log("No campaigns with tracker_id found");
      return new Response(
        JSON.stringify({
          message: "No campaigns to sync",
          success: true,
          synced: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(`Found ${campaigns.length} campaigns to sync`);

    let successCount = 0;
    let errorCount = 0;
    const errorMessages: string[] = [];

    // Process each campaign
    for (const campaign of campaigns) {
      try {
        console.log(
          `Syncing campaign ${campaign.id} with tracker ${campaign.postgrid_tracker_id}`,
        );

        // Call Linkly API to get click stats
        const linklyUrl =
          `https://app.linklyhq.com/api/v1/workspace/${linklyWorkspaceId}/clicks?link_id=${campaign.postgrid_tracker_id}&bots=false&unique=false&format=json&timezone=America%2FNew_York&frequency=day&api_key=${encodeURIComponent(linklyApiKey)}`;

        console.log(`[Campaign ${campaign.id}] Requesting Linkly data...`);
        console.log(
          `[Campaign ${campaign.id}] URL: ${linklyUrl.replace(linklyApiKey, 'MASKED_KEY')}`,
        );

        const linklyResponse = await fetch(linklyUrl, {
          method: "GET",
          headers: {
            "accept": "application/json",
          },
        });

        if (!linklyResponse.ok) {
          const errorText = await linklyResponse.text();
          const errorMsg = `Campaign ${campaign.id}: Linkly API ${linklyResponse.status} - ${errorText}`;
          console.error(errorMsg);
          errorMessages.push(errorMsg);
          errorCount++;
          continue;
        }

        const linklyData: LinklyTrafficData = await linklyResponse.json();

        // Log the raw traffic data to verify structure and values
        console.log(
          `[Campaign ${campaign.id}] Raw Linkly Response Traffic Length: ${linklyData.traffic?.length}`,
        );
        if (linklyData.traffic && linklyData.traffic.length > 0) {
          const lastDay = linklyData.traffic[linklyData.traffic.length - 1];
          console.log(
            `[Campaign ${campaign.id}] Last day data: ${
              JSON.stringify(lastDay)
            }`,
          );
        } else {
          console.log(
            `[Campaign ${campaign.id}] Traffic array is empty or undefined.`,
          );
        }

        // Calculate total leads (sum of all y values)
        const totalClicks = linklyData.traffic.reduce(
          (sum, item) => sum + item.y,
          0,
        );
        console.log(
          `[Campaign ${campaign.id}] Calculated Total Clicks: ${totalClicks}`,
        );

        // Calculate scan_rate = (leads_gen / postcards_sent) * 100
        let scanRate = 0;
        if (campaign.postcards_sent > 0) {
          scanRate = (totalClicks / campaign.postcards_sent) * 100;
        }

        // Calculate estimated ROI
        // Cost: postcards_sent * $3 per postcard
        // Revenue: leads_gen * $1000 assumed revenue per lead
        // ROI = ((revenue - cost) / cost) * 100
        const costPerPostcard = 3;
        const assumedRevenuePerLead = 1000;
        let estimatedROI = 0;

        const totalCost = campaign.postcards_sent * costPerPostcard;
        const estimatedRevenue = totalClicks * assumedRevenuePerLead;

        if (totalCost > 0) {
          estimatedROI = ((estimatedRevenue - totalCost) / totalCost) * 100;
        }

        console.log(
          `[Campaign ${campaign.id}] Updating metrics - Leads: ${totalClicks}, Scan Rate: ${scanRate}, ROI: ${estimatedROI}`,
        );

        // Update campaign with new metrics
        const { error: updateError } = await supabase
          .from("campaigns")
          .update({
            leads_gen: totalClicks,
            scan_rate: parseFloat(scanRate.toFixed(2)),
            roi: parseFloat(estimatedROI.toFixed(2)),
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaign.id);

        if (updateError) {
          const errorMsg = `Campaign ${campaign.id}: DB update error - ${updateError.message}`;
          console.error(errorMsg);
          errorMessages.push(errorMsg);
          errorCount++;
        } else {
          console.log(
            `Successfully synced campaign ${campaign.id}: ${totalClicks} leads, ${
              scanRate.toFixed(2)
            }% scan rate, ${estimatedROI.toFixed(2)}% ROI`,
          );
          // console.log(`Update result:`, updateData);
          successCount++;
        }

        // Add 1 second delay to avoid Linkly Rate Limits (429)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        const errorMsg = `Campaign ${campaign.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errorMessages.push(errorMsg);
        errorCount++;
      }
    }

    console.log(
      `Sync complete: ${successCount} successful, ${errorCount} errors`,
    );

    return new Response(
      JSON.stringify({
        message: "Linkly analytics sync completed",
        success: true,
        synced: successCount,
        errors: errorCount,
        total: campaigns.length,
        errorMessages: errorMessages,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in syncLinklyAnalytics:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        success: false,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
