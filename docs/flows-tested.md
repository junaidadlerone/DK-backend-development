# DoorKnocker — Playwright Crawl Results

**Date**: 2026-06-17T07:32:05.108Z
**Test account**: playwright@mailinator.com

## Auth Strategy
Signed up via Supabase REST API → called app login Edge Function → injected token into browser localStorage (persist:doorKnockerRoot).
This bypasses the email OTP flow for automation purposes.

## Flows Tested

- **Auth**: Signed up and injected token → http://localhost:5173/dashboard
- **Dashboard**: http://localhost:5173/dashboard
- **Campaign Create**: 1 steps. ID: none (no zones/templates yet)
- **Team**: Invite dialog captured
- **Profile**: Captured
- **Sandbox**: Audience builder captured
- **Agency**: Overview, Team, Templates captured

## All Routes Documented

/login, /signup, /verify-email, /onboarding,
/dashboard, /campaigns, /campaigns/create, /campaigns/:id,
/targeting/zones, /targeting/zones/create, /targeting/addresses, /targeting/exclusions,
/templates, /templates/editor,
/analytics, /analytics/overview, /analytics/campaign-performance, /analytics/roi-cost-analytics, /analytics/engagement-deep-dive,
/referrals, /referrals/create, /team, /settings, /profile,
/sandbox/campaign-audience, /agency/overview

## Stripe Test Cards
- Success: 4242 4242 4242 4242 | 12/26 | 123
- Auth required: 4000 0025 0000 3155
- Declined: 4000 0000 0000 9995

## Knowledge Base Files (44 files)

- CHANGE_CAMPAIGN_STATUS_API.md
- README.md
- SEND_WELCOME_EMAIL_CRON.md
- SIGNATURE_API_SUMMARY.md
- TEMPLATE_MANUAL_EDIT_FEATURE.md
- faq.md
- features/campaign-creation-flow.md
- features/campaign-creation.md
- features/targeting-zone-creation.md
- flows-tested.md
- getAnalyticsV2.md
- getting-started.md
- pages/agency-overview.md
- pages/agency-team.md
- pages/agency-templates.md
- pages/analytics-campaign-performance.md
- pages/analytics-engagement.md
- pages/analytics-overview.md
- pages/analytics-roi.md
- pages/analytics.md
- pages/billing.md
- pages/campaign-detail.md
- pages/campaigns.md
- pages/dashboard.md
- pages/login.md
- pages/onboarding.md
- pages/profile.md
- pages/referrals-create.md
- pages/referrals.md
- pages/sandbox-audience.md
- pages/settings-billing.md
- pages/settings-notifications.md
- pages/settings-organization.md
- pages/settings.md
- pages/signup.md
- pages/targeting-addresses.md
- pages/targeting-exclusions.md
- pages/targeting-zones.md
- pages/team-invite.md
- pages/team.md
- pages/template-editor.md
- pages/templates.md
- pages/verify-email.md
- user_story_v1.3.md
