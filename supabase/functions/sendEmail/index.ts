import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";

/**
 * Send Email Test Function
 * Simple function to test SMTP configuration
 * 
 * Payload:
 * {
 *   "to": "email@example.com",
 *   "email": "HTML or Text content",
 *   "subject": "Optional Subject"
 * }
 */

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const { to, email, subject } = await req.json();

    if (!to || !email) {
      return errorResponse("INVALID_INPUT", "Missing 'to' or 'email' fields", 400);
    }

    // Check for SMTP configuration
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") || "DoorKnocker <hello@texasgrowthfactory.com>";

    if (!smtpHost || !smtpUser || !smtpPass) {
      return errorResponse(
        "CONFIG_ERROR",
        "SMTP environment variables are not set",
        500
      );
    }

    // Custom logger to capture SMTP logs
    const logs: string[] = [];
    const logger = {
      level: 'debug',
      debug: (...args: any[]) => logs.push(`DEBUG: ${args.map(a => JSON.stringify(a)).join(' ')}`),
      info: (...args: any[]) => logs.push(`INFO: ${args.map(a => JSON.stringify(a)).join(' ')}`),
      warn: (...args: any[]) => logs.push(`WARN: ${args.map(a => JSON.stringify(a)).join(' ')}`),
      error: (...args: any[]) => logs.push(`ERROR: ${args.map(a => JSON.stringify(a)).join(' ')}`),
    };

    console.log(`Sending email to ${to} via ${smtpHost}:${smtpPort}`);

    // Import Nodemailer dynamically
    const nodemailer = await import("npm:nodemailer@6.9.7");
    
    // Create reusable transporter object
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports (587 uses STARTTLS)
      requireTLS: true, // Force StartTLS for Office 365
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: true,
      },
      logger: logger,
      debug: true // Enable debug output
    });

    // Send email
    const info = await transporter.sendMail({
      from: smtpFrom,
      to: to,
      subject: subject || "Test Email from DoorKnocker",
      html: email, // Assuming 'email' field contains HTML/Text content
      text: email  // Fallback text version
    });

    console.log("Message sent: %s", info.messageId);

    return successResponse({
      status: "success",
      message: "Email sent successfully (Server Accepted)",
      messageId: info.messageId,
      envelope: info.envelope,
      smtpLogs: logs // Return logs to user
    }, 200);

  } catch (error: any) {
    console.error("Error sending email:", error);
    return errorResponse(
      "EMAIL_SEND_FAILED",
      `Failed to send email: ${error.message || String(error)}`,
      500
    );
  }
});
