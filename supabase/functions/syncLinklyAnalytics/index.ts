import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Analytics Sync Cron Job (PostGrid & Linkly)
 * Runs daily to fetch click analytics from PostGrid and Linkly trackers and update campaign metrics
 *
 * Process:
 * 1. Fetch all campaigns with postgrid_tracker_id (not null)
 * 2. Determine provider based on ID prefix (tracker_ for PostGrid, else Linkly)
 * 3. Fetch analytics data from the respective provider's API
 * 4. Calculate total leads (visitCount for PostGrid, summed y-values for Linkly)
 * 5. Calculate scan_rate = (leads_gen / postcards_sent) * 100
 * 6. Calculate estimated ROI = ((revenue - cost) / cost) * 100
 *    - Cost: postcards_sent * $3 per postcard
 *    - Revenue: leads_gen * $1000 assumed revenue per lead
 * 7. Update campaign with new metrics (leads_gen, scan_rate, roi)
 */

interface PostGridTrackerData {
  id: string;
  uniqueVisitCount: number;
  visitCount: number;
}

Deno.serve(async (req) => {
  console.log("Starting analytics sync (PostGrid)...");

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    const postgridApiKey = Deno.env.get("POSTGRID_POSTCARD_API_KEY") || Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

    if (!postgridApiKey) {
      console.error("PostGrid API Key not found in environment");
      return new Response(
        JSON.stringify({
          error: "Missing PostGrid API Key",
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
      console.log("No campaigns with PostGrid trackers found");
      return new Response(
        JSON.stringify({
          message: "No PostGrid campaigns to sync",
          success: true,
          synced: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(`Found ${campaigns.length} PostGrid campaigns to sync`);

    let successCount = 0;
    let errorCount = 0;
    const errorMessages: string[] = [];

    // Process each campaign
    for (const campaign of campaigns) {
      try {
        const trackerId = campaign.postgrid_tracker_id as string;
        let totalClicks = 0;

        console.log(`[Campaign ${campaign.id}] Fetching PostGrid analytics for tracker ${trackerId}`);
        const postgridUrl = `https://api.postgrid.com/print-mail/v1/trackers/${trackerId}`;
        const pgResponse = await fetch(postgridUrl, {
          headers: { "x-api-key": postgridApiKey }
        });

        if (!pgResponse.ok) {
          const errorText = await pgResponse.text();
          throw new Error(`PostGrid API ${pgResponse.status} - ${errorText}`);
        }

        const pgData: PostGridTrackerData = await pgResponse.json();
        totalClicks = pgData.visitCount || 0;

        console.log(`[Campaign ${campaign.id}] Calculated Total Clicks: ${totalClicks}`);

        // Calculate metrics
        const postcardsSent = campaign.postcards_sent || 0;
        const scanRate = postcardsSent > 0 ? (totalClicks / postcardsSent) * 100 : 0;
        
        // ROI Calculation
        const costPerPostcard = 3;
        const assumedRevenuePerLead = 1000;
        const totalCost = postcardsSent * costPerPostcard;
        const estimatedRevenue = totalClicks * assumedRevenuePerLead;
        const estimatedROI = totalCost > 0 ? ((estimatedRevenue - totalCost) / totalCost) * 100 : 0;

        // Update campaign
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
          throw new Error(`DB update error - ${updateError.message}`);
        }

        console.log(`Successfully synced campaign ${campaign.id} (PostGrid): ${totalClicks} leads`);
        successCount++;

        // Rate limiting delay
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        const errorMsg = `Campaign ${campaign.id}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMsg);
        errorMessages.push(errorMsg);
        errorCount++;
      }
    }

    return new Response(
      JSON.stringify({
        message: "Analytics sync completed",
        success: true,
        synced: successCount,
        errors: errorCount,
        total: campaigns.length,
        errorMessages: errorMessages,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in syncAnalytics:", error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
