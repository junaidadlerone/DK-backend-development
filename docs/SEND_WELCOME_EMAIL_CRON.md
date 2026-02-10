# Send Welcome Email Cron Job

## Overview
The `sendWelcomeEmail` function is a cron job that automatically sends welcome emails to newly registered users who haven't received one yet.

## Endpoint
- **URL**: `https://iywivotqnphrjijztxtu.supabase.co/functions/v1/sendWelcomeEmail`
- **Method**: `GET` or `POST`
- **Authentication**: No authentication required (designed for cron jobs)

## Purpose
- Automatically sends welcome emails to users within 10 minutes of registration
- Ensures every new user receives the welcome email exactly once
- Uses the HTML template at `supabase/functions/WebSocket/welcome_email.html`

## How It Works

1. **Query for New Users**: Looks for users created in the last 10 minutes who haven't received a welcome email
2. **Load Email Template**: Reads the HTML template from `WebSocket/welcome_email.html`
3. **Send Emails**: Sends welcome email to each user via Resend API
4. **Mark as Sent**: Updates the `welcome_email_sent` flag in the profiles table

## Database Changes

### Migration: `20260107230824_add_welcome_email_sent_to_profiles.sql`

Added to `profiles` table:
- **Column**: `welcome_email_sent` (BOOLEAN, default: false)
- **Index**: `idx_profiles_welcome_email_pending` for efficient querying
- **Purpose**: Tracks whether a user has received the welcome email

## Email Service

Uses **Resend** (https://resend.com) for sending emails.

### Required Environment Variable
- **`RESEND_API_KEY`**: Your Resend API key

### Setting the API Key
```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
```

## Cron Job Setup

### Recommended Schedule
Run every **5 minutes** to ensure timely delivery.

### Supabase Cron Setup

1. Go to your Supabase project dashboard
2. Navigate to **Database** → **Cron Jobs**
3. Create a new cron job with:
   - **Name**: Send Welcome Emails
   - **Schedule**: `*/5 * * * *` (every 5 minutes)
   - **SQL Command**:
   ```sql
   SELECT
     net.http_post(
       url := 'https://iywivotqnphrjijztxtu.supabase.co/functions/v1/sendWelcomeEmail',
       headers := '{"Content-Type": "application/json"}'::jsonb
     ) AS request_id;
   ```

### Alternative: External Cron Service

You can also use external services like:
- **Cron-job.org**
- **EasyCron**
- **GitHub Actions** (scheduled workflows)
- **Vercel Cron Jobs**

Example cURL command:
```bash
curl -X POST https://iywivotqnphrjijztxtu.supabase.co/functions/v1/sendWelcomeEmail
```

## Response Format

### Success Response
```json
{
  "status": "success",
  "message": "Sent 3 welcome email(s) to new users",
  "emails_sent": 3,
  "total_users_checked": 3,
  "results": [
    {
      "user_id": "uuid-1",
      "email": "user1@example.com",
      "success": true,
      "resend_id": "re_abc123"
    },
    {
      "user_id": "uuid-2",
      "email": "user2@example.com",
      "success": true,
      "resend_id": "re_def456"
    },
    {
      "user_id": "uuid-3",
      "email": "user3@example.com",
      "success": true,
      "resend_id": "re_ghi789"
    }
  ],
  "processingTimeMs": 1234
}
```

### No New Users Response
```json
{
  "status": "success",
  "message": "No new users to send welcome emails to",
  "emails_sent": 0,
  "processingTimeMs": 45
}
```

### Error Response
```json
{
  "status": "error",
  "code": "CONFIG_ERROR",
  "message": "Email service is not configured"
}
```

## Email Template

The welcome email uses the HTML template located at:
- **Path**: `supabase/functions/WebSocket/welcome_email.html`
- **Features**:
  - DoorKnocker branding
  - 3-step onboarding guide
  - Links to dashboard and support
  - Responsive design

### Email Details
- **From**: `DoorKnocker <hello@texasgrowthfactory.com>`
- **Subject**: "Welcome to DoorKnocker - Your Account is Ready"
- **Template**: Static HTML (no variable substitution currently)

## Business Logic

### Time Window
- Checks for users created in the **last 10 minutes**
- This ensures the cron job (running every 5 minutes) catches all new users

### Idempotency
- Only sends email once per user
- Uses `welcome_email_sent` flag to prevent duplicates
- Even if cron job runs multiple times, user only receives one email

### Error Handling
- If email fails to send, user is NOT marked as sent
- Will retry on next cron job execution
- Individual email failures don't stop the batch process
- All errors are logged for debugging

## Monitoring

### Logs to Check
1. **Supabase Edge Function Logs**: View in Supabase Dashboard → Edge Functions → sendWelcomeEmail
2. **Resend Dashboard**: Check delivery status at https://resend.com/dashboard
3. **Database**: Query profiles table for `welcome_email_sent` counts

### Useful Queries

**Count users who haven't received welcome email:**
```sql
SELECT COUNT(*)
FROM profiles
WHERE welcome_email_sent = false OR welcome_email_sent IS NULL;
```

**Recent users and email status:**
```sql
SELECT
  id,
  email,
  full_name,
  created_at,
  welcome_email_sent
FROM profiles
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;
```

## Troubleshooting

### Issue: No Emails Being Sent
1. Check if `RESEND_API_KEY` is set: `supabase secrets list`
2. Verify Resend account is active and has sending quota
3. Check Edge Function logs for errors
4. Ensure cron job is running: Check Supabase Dashboard → Database → Cron Jobs

### Issue: Users Not Marked as Sent
- Check database update query in logs
- Verify RLS policies on profiles table allow updates
- Service role should bypass RLS automatically

### Issue: Duplicate Emails
- Check if `welcome_email_sent` column exists: `\d profiles` in psql
- Verify migration was applied: `SELECT * FROM migrations`
- Check for race conditions if multiple cron jobs running

## Security Considerations

- **No Authentication**: Function accepts unauthenticated requests (safe because it only sends emails to new users)
- **Rate Limiting**: Consider adding rate limiting if abused
- **Email Validation**: Uses existing email validation from profiles table
- **Service Role**: Uses Supabase service role to bypass RLS for reading/updating profiles

## Future Enhancements

Potential improvements:
1. **Email Personalization**: Add user's name to email template
2. **Template Variables**: Support dynamic content in email
3. **Email Preferences**: Allow users to opt out of welcome emails
4. **Retry Logic**: Exponential backoff for failed sends
5. **Email Analytics**: Track open rates and click-through rates
6. **A/B Testing**: Test different email templates
7. **Localization**: Send emails in user's preferred language
