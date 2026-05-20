// Shared logo upload helper.
// Accepts a base64 data-URL, a raw base64 string, or an already-uploaded URL.
// Uploads base64 payloads to the `CompanyLogos` storage bucket and returns the public URL.
// If `logo` is already an http(s) URL it is passed through unchanged.

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function uploadLogo(
  supabase: any,
  organizationId: string,
  logo: string | null | undefined,
): Promise<string | null> {
  if (!logo) return null;

  // Already a URL — pass through.
  if (!logo.startsWith("data:") && !looksLikeRawBase64(logo)) {
    return logo;
  }

  let fileData: Uint8Array;
  let contentType = "image/png";
  let extension = "png";

  if (logo.startsWith("data:")) {
    const matches = logo.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      contentType = matches[1];
      fileData = decodeBase64(matches[2]);
      const mime = contentType.split("/")[1];
      if (mime) extension = mime;
    } else {
      // Malformed data URL — try treating the whole thing as base64.
      fileData = decodeBase64(logo);
    }
  } else {
    fileData = decodeBase64(logo);
  }

  const fileName = `${organizationId}/logo_${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("CompanyLogos")
    .upload(fileName, fileData, { contentType, upsert: true });

  if (uploadError) {
    console.error("uploadLogo: storage error", uploadError);
    throw new Error("Failed to upload logo");
  }

  const { data: publicUrlData } = supabase.storage
    .from("CompanyLogos")
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

function looksLikeRawBase64(s: string): boolean {
  // Very loose heuristic — only matches strings that have no scheme and look base64-ish.
  // Real URLs start with http(s):// so they'll fail this and pass through above.
  return !s.includes("://") && /^[A-Za-z0-9+/=\r\n]+$/.test(s.slice(0, 200));
}
