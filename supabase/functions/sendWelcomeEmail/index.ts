import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Send Welcome Email Edge Function
 * Sends welcome emails to new users who haven't received one yet
 *
 * Business Rules:
 * - Designed to be called via cron job (every 5 minutes)
 * - Queries profiles table for users created in last 10 minutes
 * - Only sends email if welcome_email_sent flag is false/null
 * - Marks users as emailed after successful send
 * - Uses Resend email service
 * - Loads HTML template from WebSocket/welcome_email.html
 *
 * Environment Variables Required:
 * - RESEND_API_KEY: Resend API key for sending emails
 *
 * No request body needed (cron job)
 */

interface ResendEmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Allow both GET and POST (for cron jobs)
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only GET and POST methods are allowed",
      405
    );
  }

  const startTime = Date.now();

  try {
    // Create Supabase client with service role (bypasses RLS)
    const supabase = createSupabaseClient();

    // Get Resend API key from environment
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY environment variable is not set");
      return errorResponse(
        "CONFIG_ERROR",
        "Email service is not configured",
        500
      );
    }

    // Find users who registered in the last 10 minutes and haven't received welcome email
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: newUsers, error: fetchError } = await supabase
      .from("profiles")
      .select("id, email, full_name, created_at")
      .gte("created_at", tenMinutesAgo)
      .or("welcome_email_sent.is.null,welcome_email_sent.eq.false");

    if (fetchError) {
      console.error("Error fetching new users:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch new users",
        500
      );
    }

    if (!newUsers || newUsers.length === 0) {
      return successResponse({
        status: "success",
        message: "No new users to send welcome emails to",
        emails_sent: 0,
        processingTimeMs: Date.now() - startTime
      }, 200);
    }

    // Load welcome email HTML template
    let emailHtml: string;
    try {
      const templatePath = new URL("../WebSocket/welcome_email.html", import.meta.url);
      emailHtml = await Deno.readTextFile(templatePath);
    } catch (readError) {
      console.error("Error reading email template:", readError);
      return errorResponse(
        "TEMPLATE_ERROR",
        "Failed to load email template",
        500
      );
    }

    // Send emails to each new user
    const emailResults = [];
    const userIdsToUpdate = [];

    for (const user of newUsers) {
      try {
        // Prepare email payload
        const emailPayload: ResendEmailPayload = {
          from: "DoorKnocker <hello@texasgrowthfactory.com>",
          to: user.email,
          subject: "Welcome to DoorKnocker - Your Account is Ready",
          html: emailHtml
        };

        // Send email via Resend API
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(emailPayload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to send email to ${user.email}:`, errorText);
          emailResults.push({
            user_id: user.id,
            email: user.email,
            success: false,
            error: errorText
          });
        } else {
          const result = await response.json();
          console.log(`Successfully sent welcome email to ${user.email}`);
          emailResults.push({
            user_id: user.id,
            email: user.email,
            success: true,
            resend_id: result.id
          });
          userIdsToUpdate.push(user.id);
        }
      } catch (emailError) {
        console.error(`Error sending email to ${user.email}:`, emailError);
        emailResults.push({
          user_id: user.id,
          email: user.email,
          success: false,
          error: emailError.message
        });
      }
    }

    // Mark users as having received welcome email
    if (userIdsToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ welcome_email_sent: true })
        .in("id", userIdsToUpdate);

      if (updateError) {
        console.error("Error updating welcome_email_sent flag:", updateError);
        // Don't fail the request, just log the error
      }
    }

    const processingTimeMs = Date.now() - startTime;
    const successCount = emailResults.filter(r => r.success).length;

    return successResponse({
      status: "success",
      message: `Sent ${successCount} welcome email(s) to new users`,
      emails_sent: successCount,
      total_users_checked: newUsers.length,
      results: emailResults,
      processingTimeMs
    }, 200);

  } catch (error) {
    console.error("Unexpected error in sendWelcomeEmail:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
