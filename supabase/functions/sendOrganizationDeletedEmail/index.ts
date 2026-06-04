import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import nodemailer from "npm:nodemailer@6.9.13";

/**
 * Send Organization Deleted Email Edge Function
 *
 * Owns the full post-recovery-window deletion lifecycle for organizations:
 *   1. Finds organizations whose `deletion_scheduled_at` has elapsed (<= now()).
 *   2. Resolves each owner's email from auth.users.
 *   3. Sends the 'organization-deletion-completed' email.
 *   4. Permanently deletes the organization row (child rows cascade via FKs).
 *
 * The owner email is read BEFORE the row is deleted, so the order matters.
 *
 * Business Rules:
 * - Designed to be triggered by a pg_cron job (daily at 00:00) via pg_net.
 * - Uses the service-role client (bypasses RLS).
 * - Uses Custom SMTP (Outlook/Office365), same as the other email functions.
 *
 * Environment Variables Required:
 * - SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, SMTP_FROM
 *
 * No request body needed (cron job).
 */

interface DeletionResult {
  organization_id: string;
  business_name: string | null;
  email?: string;
  email_sent: boolean;
  deleted: boolean;
  error?: string;
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
      405,
    );
  }

  const startTime = Date.now();

  try {
    // Service-role client (bypasses RLS)
    const supabase = createSupabaseClient();

    // SMTP Configuration
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") ?? "587");
    const smtpSender = Deno.env.get("SMTP_FROM");

    if (!smtpUser || !smtpPass) {
      console.error("SMTP credentials are missing");
      return errorResponse(
        "CONFIG_ERROR",
        "Email service is not configured",
        500,
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // Outlook uses STARTTLS on 587
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        ciphers: "SSLv3",
      },
    });

    // Find organizations whose recovery window has elapsed.
    const nowIso = new Date().toISOString();
    const { data: expiredOrgs, error: fetchError } = await supabase
      .from("organizations")
      .select("id, business_name, owner_id")
      .not("deletion_scheduled_at", "is", null)
      .lte("deletion_scheduled_at", nowIso);

    if (fetchError) {
      console.error("Error fetching expired organizations:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch expired organizations",
        500,
      );
    }

    if (!expiredOrgs || expiredOrgs.length === 0) {
      return successResponse({
        status: "success",
        message: "No organizations are due for deletion",
        emails_sent: 0,
        organizations_deleted: 0,
        processingTimeMs: Date.now() - startTime,
      }, 200);
    }

    // Load the deletion-completed template.
    const { data: templateData, error: templateError } = await supabase
      .from("email_templates")
      .select("subject, content")
      .eq("name", "organization-deletion-completed")
      .eq("is_active", true)
      .single();

    if (templateError || !templateData) {
      console.error(
        "organization-deletion-completed template not found or inactive:",
        templateError,
      );
      return errorResponse(
        "TEMPLATE_NOT_FOUND",
        "Email template 'organization-deletion-completed' is missing or inactive",
        500,
      );
    }

    const results: DeletionResult[] = [];

    for (const org of expiredOrgs) {
      const result: DeletionResult = {
        organization_id: org.id,
        business_name: org.business_name,
        email_sent: false,
        deleted: false,
      };

      try {
        // Resolve owner email BEFORE deleting the org.
        const { data: authUser, error: authError } = await supabase.auth.admin
          .getUserById(org.owner_id);

        const ownerEmail = authUser?.user?.email;

        if (authError || !ownerEmail) {
          console.error(
            `Could not resolve owner email for org ${org.id}:`,
            authError,
          );
          result.error = "Owner email not found";
        } else {
          result.email = ownerEmail;

          // Substitute placeholders.
          const businessName = org.business_name ?? "your organization";
          const html = templateData.content.replaceAll(
            "{{business_name}}",
            businessName,
          );
          const subject = templateData.subject.replaceAll(
            "{{business_name}}",
            businessName,
          );

          const info = await transporter.sendMail({
            from: `"DoorKnocker" <${smtpSender}>`,
            to: ownerEmail,
            subject,
            html,
          });

          console.log(
            `Sent deletion email to ${ownerEmail} for org ${org.id}. MessageId: ${info.messageId}`,
          );
          result.email_sent = true;
        }
      } catch (emailError) {
        console.error(
          `Error sending deletion email for org ${org.id}:`,
          emailError,
        );
        result.error = `Email error: ${(emailError as Error).message}`;
      }

      // Delete the organization regardless of email outcome — the recovery
      // window has elapsed, so the row must be removed. A failed email is logged
      // above but does not block the deletion.
      const { error: deleteError } = await supabase
        .from("organizations")
        .delete()
        .eq("id", org.id);

      if (deleteError) {
        console.error(`Failed to delete org ${org.id}:`, deleteError);
        result.error = (result.error ? result.error + "; " : "") +
          `Delete error: ${deleteError.message}`;
      } else {
        result.deleted = true;
      }

      results.push(result);
    }

    const emailsSent = results.filter((r) => r.email_sent).length;
    const deleted = results.filter((r) => r.deleted).length;

    return successResponse({
      status: "success",
      message:
        `Processed ${results.length} expired organization(s): ${deleted} deleted, ${emailsSent} email(s) sent`,
      emails_sent: emailsSent,
      organizations_deleted: deleted,
      total_processed: results.length,
      results,
      processingTimeMs: Date.now() - startTime,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in sendOrganizationDeletedEmail:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${(error as Error).message}`,
      500,
    );
  }
});
