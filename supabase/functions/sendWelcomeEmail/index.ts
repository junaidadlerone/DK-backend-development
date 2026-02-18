import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import nodemailer from "npm:nodemailer@6.9.13";
import { WELCOME_EMAIL_HTML } from "./email-template.ts";

/**
 * Send Welcome Email Edge Function
 * Sends welcome emails to new users who haven't received one yet
 *
 * Business Rules:
 * - Designed to be called via cron job (every 5 minutes)
 * - Queries profiles table for users created in last 10 minutes
 * - Only sends email if welcome_email_sent flag is false/null
 * - Marks users as emailed after successful send
 * - Uses Custom SMTP (Outlook/Office365)
 * - Loads HTML template from WebSocket/welcome_email.html
 *
 * Environment Variables Required:
 * - SMTP_USER: SMTP Username (e.g. supabase@texasgrowthfactory.com)
 * - SMTP_PASS: SMTP Password
 *
 * No request body needed (cron job)
 */

interface EmailPayload {
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

    // SMTP Configuration
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT"));
    const smtpSender = Deno.env.get("SMTP_FROM");

    if (!smtpUser || !smtpPass) {
        console.error("SMTP credentials are missing");
        return errorResponse(
            "CONFIG_ERROR",
            "Email service is not configured",
            500
        );
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false, // true for 465, false for other ports. Outlook uses STARTTLS on 587
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
        tls: {
            ciphers: 'SSLv3'
        }
    });

    // Find users who registered in the last 10 minutes and haven't received welcome email
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: newUsers, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name, created_at")
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

    // Load welcome email template from database
    const { data: templateData, error: templateError } = await supabase
      .from("email_templates")
      .select("subject, content")
      .eq("name", "welcome-email")
      .eq("is_active", true)
      .single();

    if (templateError || !templateData) {
      console.warn("Welcome email template not found in database or error fetching it, using fallback:", templateError);
    }

    const emailSubject = templateData?.subject || "Welcome to DoorKnocker - Your Account is Ready";
    const emailHtml = templateData?.content || WELCOME_EMAIL_HTML;

    // Send emails to each new user
    const emailResults = [];
    const userIdsToUpdate = [];

    for (const userProfile of newUsers) {
      try {
        // Fetch user email from auth.users
        const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userProfile.id);

        if (authError || !authUser.user || !authUser.user.email) {
            console.error(`Could not find auth user for profile ${userProfile.id}:`, authError);
            emailResults.push({
                user_id: userProfile.id,
                success: false,
                error: "Auth user not found or no email"
            });
            continue;
        }

        const userEmail = authUser.user.email;

        // Send email via Nodemailer
        const info = await transporter.sendMail({
            from: `"DoorKnocker" <${smtpSender}>`, // Sender address
            to: userEmail,
            subject: emailSubject,
            html: emailHtml,
        });

        console.log(`Successfully sent welcome email to ${userEmail}. MessageId: ${info.messageId}`);
        emailResults.push({
            user_id: userProfile.id,
            email: userEmail,
            success: true,
            resend_id: info.messageId // Keeping key name for compatibility or rename to messageId
        });
        userIdsToUpdate.push(userProfile.id);

      } catch (emailError) {
        console.error(`Error sending email to user ${userProfile.id}:`, emailError);
        emailResults.push({
          user_id: userProfile.id,
          success: false,
          error: emailError
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
