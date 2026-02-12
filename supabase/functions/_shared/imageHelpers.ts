/**
 * Helper functions for fetching image URLs from referral galleries
 */

/**
 * Fetches the first image URL from a referral's gallery
 * @param supabase - Supabase client
 * @param referralId - Referral ID to fetch gallery for
 * @returns Image URL or empty string if no images
 */
export async function getImageUrlForReferral(
  supabase: any,
  referralId: string | null
): Promise<string> {
  if (!referralId) {
    return "";
  }

  const { data: gallery } = await supabase
    .from("gallery")
    .select("images")
    .eq("referral_id", referralId)
    .single();

  if (gallery && gallery.images && Array.isArray(gallery.images) && gallery.images.length > 0) {
    return gallery.images[0].url || "";
  }

  return "";
}

/**
 * Fetches image URLs for multiple referrals in a single query
 * @param supabase - Supabase client
 * @param referralIds - Array of referral IDs
 * @returns Map of referral_id to image URL
 */
export async function getImageUrlsForReferrals(
  supabase: any,
  referralIds: string[]
): Promise<Record<string, string>> {
  if (referralIds.length === 0) {
    return {};
  }

  const { data: galleries } = await supabase
    .from("gallery")
    .select("referral_id, images")
    .in("referral_id", referralIds);

  const imageUrlMap: Record<string, string> = {};
  if (galleries) {
    for (const gallery of galleries) {
      if (gallery.images && Array.isArray(gallery.images) && gallery.images.length > 0) {
        imageUrlMap[gallery.referral_id] = gallery.images[0].url || "";
      }
    }
  }

  return imageUrlMap;
}
