import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import nodemailer from "npm:nodemailer@6.9.13";

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
    console.log(`[sendMaintenanceCompletedEmail] Starting execution. Method: ${req.method}`);
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

    
    // 1. START CONDITION: Check if DoorKnocker is still under maintenance
    const { data: maintenanceData, error: maintenanceError } = await supabase
      .from("maintainence")
      .select('"isUnderMaintainence"')
      .single();

    console.log(`[sendMaintenanceCompletedEmail] Maintenance status: ${maintenanceData?.isUnderMaintainence === true ? 'ACTIVE' : 'INACTIVE'}`);

    if (maintenanceError) {
      console.error("Error checking maintenance status:", maintenanceError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to check maintenance status",
        500
      );
    }

    if (maintenanceData?.isUnderMaintainence === true) {
      console.log("DoorKnocker is still under maintenance. Skipping emails.");
      return successResponse({
        status: "skipped",
        message: "DoorKnocker is still under maintenance. No emails sent.",
        processingTimeMs: Date.now() - startTime
      }, 200);
    }

    // 2. Find users who haven't received the maintenance completed email
    const { data: usersToNotify, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .or("maintenance_email_sent.is.null,maintenance_email_sent.eq.false");

    console.log(`[sendMaintenanceCompletedEmail] Found ${usersToNotify?.length || 0} users to notify.`);

    if (fetchError) {
      console.error("Error fetching users to notify:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch users to notify",
        500
      );
    }

    if (!usersToNotify || usersToNotify.length === 0) {
      return successResponse({
        status: "success",
        message: "No users to notify that maintenance is over",
        emails_sent: 0,
        processingTimeMs: Date.now() - startTime
      }, 200);
    }

    // 3. Load maintenance-over-email template from database
    const { data: templateData, error: templateError } = await supabase
      .from("email_templates")
      .select("subject, content")
      .eq("name", "maintenance-over-email")
      .eq("is_active", true)
      .single();

    if (templateError || !templateData) {
      console.warn("Maintenance over email template not found in database or error fetching it:", templateError);
      return errorResponse(
        "TEMPLATE_ERROR",
        "Maintenance completed email template not found",
        500
      );
    }

    const emailSubject = templateData.subject;
    const emailHtml = templateData.content;

    // 4. Send emails to each user
    const emailResults = [];
    const userIdsToUpdate = [];

    for (const userProfile of usersToNotify) {
      try {
        console.log(`[sendMaintenanceCompletedEmail] Processing user: ${userProfile.id} (${userProfile.full_name || 'No Name'})`);
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
            from: `"DoorKnocker" <${smtpSender}>`,
            to: userEmail,
            subject: emailSubject,
            html: emailHtml,
        });

        console.log(`Successfully sent maintenance completed email to ${userEmail}. MessageId: ${info.messageId}`);
        emailResults.push({
            user_id: userProfile.id,
            email: userEmail,
            success: true,
            messageId: info.messageId
        });
        userIdsToUpdate.push(userProfile.id);

      } catch (emailError: any) {
        console.error(`Error sending email to user ${userProfile.id}:`, emailError);
        emailResults.push({
          user_id: userProfile.id,
          success: false,
          error: emailError.message || emailError
        });
      }
    }

    // 5. Mark users as having received maintenance over email
    if (userIdsToUpdate.length > 0) {
      console.log(`[sendMaintenanceCompletedEmail] Updating ${userIdsToUpdate.length} profiles to flag email as sent.`);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ maintenance_email_sent: true })
        .in("id", userIdsToUpdate);

      if (updateError) {
        console.error("Error updating maintenance_email_sent flag:", updateError);
      }
    }

    const processingTimeMs = Date.now() - startTime;
    const successCount = emailResults.filter(r => r.success).length;

    return successResponse({
      status: "success",
      message: `Sent ${successCount} maintenance completed email(s)`,
      emails_sent: successCount,
      total_users_checked: usersToNotify.length,
      results: emailResults,
      processingTimeMs
    }, 200);

  } catch (error) {
    console.error("Unexpected error in sendMaintenanceCompletedEmail:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});