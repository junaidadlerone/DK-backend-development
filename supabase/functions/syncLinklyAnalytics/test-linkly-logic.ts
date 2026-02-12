// Mock types
interface LinklyTrafficData {
    traffic: Array<{
        y: number;
        t: string;
    }>;
}

// Config from User
const LINKLY_API_KEY = "ogIivdy75aUk1bTzk8XXow==";
const LINKLY_WORKSPACE_ID = "339418";
const CAMPAIGN_ID = "9a2e4efd-ebe2-4aa1-9810-8150d0a2c2ff"; // From user's JSON
const POSTGRID_TRACKER_ID = "37347971"; // From user's request
const POSTCARDS_SENT = 20; // From user's JSON

async function runTest() {
    console.log("🚀 Starting Linkly Logic Test...");

    const linklyUrl =
        `https://app.linklyhq.com/api/v1/workspace/${LINKLY_WORKSPACE_ID}/clicks?link_id=${POSTGRID_TRACKER_ID}&bots=false&unique=false&format=json&timezone=America%2FNew_York&frequency=day&api_key=${
            encodeURIComponent(LINKLY_API_KEY)
        }`;

    console.log(`[Campaign ${CAMPAIGN_ID}] Requesting Linkly data...`);
    console.log(
        `[Campaign ${CAMPAIGN_ID}] URL: ${
            linklyUrl.replace(LINKLY_API_KEY, "MASKED_KEY")
        }`,
    );

    try {
        const linklyResponse = await fetch(linklyUrl, {
            method: "GET",
            headers: {
                "accept": "application/json",
            },
        });

        if (!linklyResponse.ok) {
            const errorText = await linklyResponse.text();
            console.error(
                `Linkly API error: Status ${linklyResponse.status} - ${errorText}`,
            );
            return;
        }

        const linklyData: LinklyTrafficData = await linklyResponse.json();
        console.log(
            `[Campaign ${CAMPAIGN_ID}] Raw Data Received:`,
            JSON.stringify(linklyData, null, 2),
        );

        // Logic Check
        const totalClicks = linklyData.traffic.reduce(
            (sum, item) => sum + item.y,
            0,
        );
        console.log(
            `[Campaign ${CAMPAIGN_ID}] Calculated Total Clicks: ${totalClicks}`,
        );

        let scanRate = 0;
        if (POSTCARDS_SENT > 0) {
            scanRate = (totalClicks / POSTCARDS_SENT) * 100;
        }

        const costPerPostcard = 3;
        const assumedRevenuePerLead = 1000;
        let estimatedROI = 0;

        const totalCost = POSTCARDS_SENT * costPerPostcard;
        const estimatedRevenue = totalClicks * assumedRevenuePerLead;

        if (totalCost > 0) {
            estimatedROI = ((estimatedRevenue - totalCost) / totalCost) * 100;
        }

        console.log(`[Campaign ${CAMPAIGN_ID}] Final Metrics to Update:`);
        console.log(`- leads_gen: ${totalClicks}`);
        console.log(`- scan_rate: ${scanRate.toFixed(2)}%`);
        console.log(`- roi: ${estimatedROI.toFixed(2)}%`);
    } catch (error) {
        console.error("Error executing fetch:", error);
    }
}

runTest();
