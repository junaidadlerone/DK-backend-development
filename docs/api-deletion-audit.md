# Backend API Deletion Audit

> Generated: 2026-06-23
> Scope: REST edge functions + WebSocket Cloud Run services
> Excluded: CloudRun `syncPostcardStatuses` background worker (user request)
> Strictness: CONSERVATIVE — flagged only when zero references found anywhere

---

## TL;DR

- Total backend APIs scanned: 179 (170 REST + 9 WebSocket)
- **USED by frontend**: 143
- **INTERNAL-only (kept)**: 10
- **Deletion candidates**: 21
- **Needs manual review**: 5

**HOW TO USE THIS REPORT:**
1. Read §1 (Deletion candidates).
2. For each entry you want to KEEP, move it to §2 (EXCEPTIONS) by editing this file.
3. Ping back with "process the audit" — I will delete every function still in §1 that is NOT in §2.

---

## 1. Deletion candidates

These are functions with zero FE references AND zero internal callers AND no cron / webhook / heartbeat / WS-edge tie-ins. Survived the adversarial refute pass.

| Function | Type | OpenAPI? | Refute reason |
| --- | --- | --- | --- |
| addAddressToZoneById | REST | yes | No genuine usage found: FE has zero references, no relative imports, only docs and self-error-log mentions. |
| createNewUniversalTemplate | REST | yes | No active usage; not registered in supabase/config.toml; only OpenAPI + problem_statement.md descriptive mentions. |
| createNewUniversalTemplateBundle | REST | yes | No callers in FE or BE; only self-reference, config.toml registration, openapi docs, and a design doc. |
| daily-briefing | REST | no | No external usage anywhere; real handler but FE zero references, no cron schedules it, no internal imports. |
| disableMultiOrg | REST | yes | Real handler but no FE or BE invokes it — only openapi.yaml docs and config.toml registration. |
| discoveraddresses-test | WS | no | FE has zero references; only docs/openapi.yaml + frontend-discoveraddresses-guide.md mention the dev URL. |
| enableMultiOrg | REST | yes | No active caller — multiOrgService.ts does not invoke it; only docs, config.toml, migration comments, and stale code comments. |
| find-addresses-openmaps | WS | no | FE points to findadresses-test Cloud Run instead; uses Nominatim directly. Only ref is a Claude permission allowlist. |
| getAllCampaignStatus | REST | yes | No active usage anywhere; FE uses a distinct `getCampaignStatuses` instead. Only self-impl, config.toml, openapi spec. |
| getAllCurrencies | REST | yes | No callers in FE or BE; FE uses hardcoded currencies array in SystemPreferencesTab.tsx. |
| getAllTimeZones | REST | yes | No genuine usage; FE SystemPreferencesTab uses a hardcoded local array, not this API. |
| getCampaignStep | REST | yes | No genuine usage — FE zero refs, no BE imports, only self-definition, config.toml, openapi entry, dev-only test script. |
| getPropertyCategories | REST | yes | No genuine caller — FE zero refs; BE refs limited to config.toml, self-file, docs, and informational comments in discoveraddresses WS. |
| keepAlive | REST | no | Real handler but no caller — no pg_cron, no GitHub workflow, no FE ref. Stale docs/README.md mentions a never-wired cron. |
| saveUserPreferences | REST | yes | No usage anywhere in FE or BE; only self-impl, self-logged error message, and openapi.yaml. |
| sendEmail | REST | no | No usage found in either repo; self-header marks it as a SMTP test utility with no callers. |
| sendMaintenanceCompletedEmail | REST | yes | No invocations anywhere — FE zero refs, no internal BE import, no pg_cron, no deploy script. |
| syncLinklyAnalytics | REST | no | No active code path invokes it — only stale test-local.sh, a Claude permissions entry, and the function's own index.ts. |
| unarchiveClearedNotifications | REST | yes | No usage in FE or BE besides self-impl and openapi.yaml entry. |
| unarchiveNotificationById | REST | yes | No FE or BE callers; only self-file and openapi.yaml spec definition. |
| verifyAddressList | REST | no | No external usage anywhere — only hit is a self-referential console.error log string inside its own index.ts. |

---

## 2. EXCEPTIONS (user-editable)

Move entries from §1 to here to rescue them. Format:
```
- [ ] functionName — reason to keep
```

(Initially empty — user fills in.)

---

## 3. USED — frontend consumers

| Function | Type | FE evidence (file:line) |
| --- | --- | --- |
| addPaymentMethod | REST | src/services/paymentMethodsService.ts:186 |
| address-verification-test | WS | src/services/addressVerificationWebSocket.ts:3 |
| addressverification | WS | src/services/addressVerificationWebSocket.ts:3 |
| changePhotoTypeById | REST | src/services/galleryService.ts:47 |
| chargePaymentMethod | REST | src/services/paymentMethodsService.ts:315 |
| chat | REST | src/components/chat/DoorKnockerChat.tsx:387 |
| clearNotificationById | REST | src/services/notificationService.ts:135 |
| clearNotifications | REST | src/services/notificationService.ts:123 |
| completeOnboarding | REST | src/services/authService.ts:103 |
| completeOnboardingV3 | REST | src/services/authService.ts:118 |
| createCampaign | REST | src/services/campaignService.ts:154 |
| createCampaignV2 | REST | src/services/campaignService.ts:171 |
| createNewTemplate | REST | src/services/campaignTemplateService.ts:12; src/services/templateEditorService.ts:8; src/services/templateService.ts:156 |
| createNewTemplateBundle | REST | src/services/templateBundleService.ts:342 |
| createNewTemplateBundleV3 | REST | src/services/templateBundleService.ts:254 |
| createOrganization | REST | src/services/multiOrgService.ts:361 |
| createPostCardFromTemplate | REST | src/services/postcardService.ts:7 |
| createReferral | REST | src/services/referralService.ts:34 |
| createUser | REST | src/services/userService.ts:57 |
| createUserV3 | REST | src/services/multiOrgService.ts:379 |
| deleteAddressZone | REST | src/services/addressService.ts:85 |
| deleteCampaign | REST | src/services/campaignService.ts:181 |
| deleteCSVAddresses | REST | src/services/addressListService.ts:135 |
| deleteImage | REST | src/services/galleryService.ts:55; src/services/referralService.ts:156 |
| deleteOrganization | REST | src/services/organizationService.ts:82 |
| deletePaymentMethod | REST | src/services/paymentMethodsService.ts:214 |
| deleteReferral | REST | src/services/referralService.ts:58 |
| deleteSignatureById | REST | src/services/referralService.ts:191 |
| deleteTemplate | REST | src/services/templateService.ts:192 |
| deleteTemplateBundle | REST | src/services/templateBundleService.ts:166 |
| deleteUser | REST | src/services/userService.ts:83 |
| deleteUserV3 | REST | src/services/multiOrgService.ts:395 |
| editAddress | REST | src/services/addressListService.ts:97 |
| editAgencySettings | REST | src/services/multiOrgService.ts:468 |
| editCampaignV2 | REST | src/services/campaignService.ts:142 |
| editUserV3 | REST | src/services/multiOrgService.ts:431 |
| excludeAddress | REST | src/services/addressService.ts:120 |
| findaddresses | WS | src/services/addressWebSocket.ts:5 |
| findadresses-test | WS | src/services/addressWebSocket.ts:5 |
| forgotPassword | REST | src/services/authService.ts:40 |
| generateOtp | REST | src/services/authService.ts:90 |
| getAddressesFromZone | REST | src/services/addressService.ts:46; src/services/addressWebSocket.ts:100 |
| getAddressZoneById | REST | src/services/addressService.ts:59 |
| getAgencyAccountOrganizationMembers | REST | src/services/multiOrgService.ts:370 |
| getAgencyOverview | REST | src/services/multiOrgService.ts:444 |
| getAgencySettings | REST | src/services/multiOrgService.ts:456 |
| getAllAddresses | REST | src/services/addressService.ts:93; src/services/addressService.ts:98 |
| getAllAddressZones | REST | src/services/addressService.ts:71 |
| getAllCampaigns | REST | src/services/campaignService.ts:36 |
| getAllConsents | REST | src/services/campaignService.ts:199 |
| getAllCountries | REST | src/services/organizationService.ts:98 |
| getAllFonts | REST | src/services/appContentService.ts:70 |
| getAllJobs | REST | src/services/referralService.ts:82 |
| getAllJobStatus | REST | src/services/referralService.ts:90 |
| getAllReferrals | REST | src/services/referralService.ts:24 |
| getAllStates | REST | src/services/referralService.ts:98 |
| getAllTemplatesBundles | REST | src/services/templateBundleService.ts:96 |
| getAllTemplatesBundlesV3 | REST | src/services/templateBundleService.ts:187 |
| getAnalytics | REST | src/services/analyticsService.ts:49; src/services/analyticsService.ts:54; src/services/analyticsService.ts:59 |
| ⚠️ getAnalytics note | — | Dynamic-discriminator endpoint — single URL, server routes on `type` field. Do NOT delete even if only one literal grep hit appears. |
| getAnalyticsPageData | REST | src/services/analyticsService.ts:88 |
| getAnalyticsV2 | REST | src/services/analyticsService.ts:94; src/services/analyticsService.ts:102; src/services/analyticsService.ts:110 |
| ⚠️ getAnalyticsV2 note | — | Dynamic-discriminator endpoint — single URL, server routes on `type` field. Do NOT delete even if only one literal grep hit appears. |
| getAppContent | REST | src/services/appContentService.ts:65 |
| getBillingHistory | REST | src/services/billingService.ts:128; src/services/billingService.ts:158 |
| getCampaignById | REST | src/services/campaignService.ts:109 |
| getCampaignHistory | REST | src/services/campaignService.ts:100 |
| getCampaignInformationByReferralId | REST | src/services/referralService.ts:108 |
| getCampaignStatuses | REST | src/services/campaignService.ts:191 |
| getChatHistory | REST | src/components/chat/DoorKnockerChat.tsx:170 |
| getChatSessions | REST | src/components/chat/DoorKnockerChat.tsx:194 |
| getCompanyLogo | REST | src/services/appContentService.ts:93 |
| getCoordinates | REST | src/services/addressListService.ts:146 |
| getCSVAddressListById | REST | src/services/addressListService.ts:185 |
| getCSVAddressListDetails | REST | src/services/addressListService.ts:87 |
| getIndustry | REST | src/services/organizationService.ts:57 |
| getMaintainenceStatus | REST | src/services/maintenanceService.ts:17 |
| getMergeVariables | REST | src/services/mergeVariablesService.ts:29 |
| getNotifications | REST | src/services/notificationService.ts:71 |
| getNotificationStatus | REST | src/services/notificationService.ts:90 |
| getOnboardingDetails | REST | src/services/authService.ts:203 |
| getOnboardingDetailsV3 | REST | services/authService.ts:170 |
| getOnboardingStep | REST | services/authService.ts:124 |
| getOnboardingStepV3 | REST | services/authService.ts:133 |
| getOrganization | REST | services/organizationService.ts:65 |
| getOrganizationV3 | REST | services/multiOrgService.ts:417 |
| getPaymentHistoryForCampaign | REST | services/paymentMethodsService.ts:352 |
| getPaymentMethods | REST | services/paymentMethodsService.ts:130 |
| getPhotoGallery | REST | services/galleryService.ts:15; services/referralService.ts:121 |
| getPostCardById | REST | services/postcardService.ts:15 |
| getReferralById | REST | services/referralService.ts:42 |
| getReferralHistory | REST | services/referralService.ts:74 |
| getSignatureById | REST | services/referralService.ts:183 |
| getTemplateBundleById | REST | services/templateBundleService.ts:119; services/templateService.ts:134 |
| getTemplateBundleByIdV3 | REST | services/templateBundleService.ts:239 |
| getTemplateBundleHistory | REST | src/services/templateBundleService.ts:127 |
| getTemplateById | REST | src/services/templateService.ts:126 |
| getTemplateHistory | REST | src/services/templateService.ts:205 |
| getUser | REST | src/services/userService.ts:66 |
| getUserOrganizations | REST | src/services/multiOrgService.ts:346 |
| getUserV3 | REST | src/services/multiOrgService.ts:405 |
| importAddressList | REST | src/services/addressListService.ts:63 |
| launchReadyCampaign | REST | src/services/campaignService.ts:251 |
| linkQRCodeToCampaign | REST | src/services/campaignService.ts:269 |
| login | REST | src/services/authService.ts:31 |
| loginWithGoogle | REST | src/services/authService.ts:75 |
| logout | REST | src/services/authService.ts:36 |
| postcardsendingsocket | WS | src/utils/websocketClient.ts:7 |
| postcardsendingsocket-test | WS | src/utils/websocketClient.ts:7 |
| recoverOrganization | REST | src/services/organizationService.ts:90 |
| refreshToken | REST | src/services/authService.ts:65 |
| removeAllDuplicateAddresses | REST | src/services/addressListService.ts:108 |
| removeAllInvalidAddresses | REST | src/services/addressListService.ts:121 |
| resetPassword | REST | src/services/authService.ts:46 |
| revokeUserAccessV3 | REST | src/services/multiOrgService.ts:387 |
| saveOrganization | REST | src/services/organizationService.ts:73 |
| searchCampaign | REST | src/services/campaignService.ts:92 |
| searchReferral | REST | src/services/referralService.ts:66 |
| searchTemplateBundles | REST | src/services/templateBundleService.ts:111 |
| setDefaultPaymentMethod | REST | src/services/paymentMethodsService.ts:158 |
| setMaintenanceEmailStatus | REST | src/services/maintenanceService.ts:45 |
| shareTemplateBundleV3 | REST | src/services/templateBundleService.ts:319 |
| signUp | REST | src/services/authService.ts:26 |
| signUpWithGoogle | REST | src/services/authService.ts:70 |
| submitReview | REST | src/components/chat/ReviewPrompt.tsx:23 |
| switchOrganization | REST | src/services/multiOrgService.ts:335 |
| switchToAgencyAccount | REST | src/services/multiOrgService.ts:484 |
| toggleNotificationStatus | REST | src/services/notificationService.ts:108 |
| unshareTemplateBundleV3 | REST | src/services/templateBundleService.ts:330 |
| updateAddressZoneById | REST | src/services/addressService.ts:77 |
| updateBrandingSettings | REST | src/services/appContentService.ts:85 |
| updateCampaignById | REST | src/services/campaignService.ts:126 |
| updateCampaignVerification | REST | src/services/addressListService.ts:200 |
| updateCompanyLogo | REST | src/services/appContentService.ts:104; src/services/appContentService.ts:113 |
| updatePassword | REST | src/services/authService.ts:95 |
| updateReferralById | REST | src/services/referralService.ts:50 |
| updateTemplate | REST | src/services/templateEditorService.ts:19; src/services/templateService.ts:186 |
| updateTemplateBundle | REST | src/services/templateBundleService.ts:158 |
| updateTemplateBundleV3 | REST | src/services/templateBundleService.ts:304 |
| updateUser | REST | src/services/userService.ts:74 |
| uploadImage | REST | src/services/galleryService.ts:35; src/services/referralService.ts:138 |
| uploadSignature | REST | src/services/referralService.ts:173 |
| validateCouponCode | REST | src/services/paymentMethodsService.ts:336 |
| verifyAddresses | REST | src/services/addressService.ts:52 |
| verifyOtp | REST | src/services/authService.ts:85 |

---

## 4. INTERNAL-ONLY (auto-kept)

### 4a. Cron-scheduled

| Function | Migration | Schedule |
| --- | --- | --- |
| sendOrganizationDeletedEmail | supabase/migrations/20260604000002_schedule_organization_deletion_cron.sql | `0 0 * * *` (daily) |
| syncNotionKB | supabase/migrations/20260618100000_sync_notion_kb_cron.sql | `0 * * * *` (hourly) |

### 4b. Webhook receivers

| Function | Notes |
| --- | --- |
| stripeWebhook | Receives Stripe webhook callbacks — not called by FE or other BE; entry point is Stripe's signed POST. |

### 4c. keepAlive heartbeat targets

> `keepAlive` itself pings these functions to keep them warm on cold-start-prone Supabase.

| Function |
| --- |
| createCampaign |
| getAddressesFromZone |
| getAllCampaigns |
| getAnalytics |
| login |
| signUp |

### 4d. WebSocket → edge callees

> Called by `postcardsendingsocket` (prod) and `postcardsendingsocket-test` (dev).

| Function | Source |
| --- | --- |
| changeCampaignStatus | supabase/functions/WebSocket/postcardsendingsocket/index.js:561 |
| getCampaignLaunchData | supabase/functions/WebSocket/postcardsendingsocket/index.js:565 |
| getTemplateById | supabase/functions/WebSocket/postcardsendingsocket/index.js:571 |
| storePostcardSends | supabase/functions/WebSocket/postcardsendingsocket/index.js:605 |
| updatePostCardsSentCount | supabase/functions/WebSocket/postcardsendingsocket/index.js:618 |
| updateTemplateBundle | supabase/functions/WebSocket/postcardsendingsocket/index.js:579 |

### 4e. Other internal chains

| Function | Notes |
| --- | --- |
| auditUniversalTemplates | Referenced from migration supabase/migrations/20260416000003_create_template_audit_reports.sql — backend-only template audit pipeline. |
| discoveraddresses (WS) | Referenced by supabase/functions/getPropertyCategories/index.ts:14 — initiates a search via this WS. |
| sendWelcomeEmail | Referenced from supabase/migrations/20260107230824_add_welcome_email_sent_to_profiles.sql and 20260218034143_create_email_templates.sql — backend-managed welcome email pipeline. |

---

## 5. Frontend orphans (FE→404 risks)

These are FE references to backend endpoint names that have no corresponding edge function in this repo. Each row needs investigation — either add the route or fix the FE.

| Endpoint (FE→404) | FE reference | Action |
| --- | --- | --- |
| createUserV2 | (legacy FE references — search `DoorKnocker_frontend_DEV` for `/createUserV2`) | FE refers to a non-existent endpoint — either add the route or fix the FE. |
| deleteUserV2 | (legacy FE references — search `DoorKnocker_frontend_DEV` for `/deleteUserV2`) | FE refers to a non-existent endpoint — either add the route or fix the FE. |
| getOrganizationV2 | (legacy FE references — search `DoorKnocker_frontend_DEV` for `/getOrganizationV2`) | FE refers to a non-existent endpoint — either add the route or fix the FE. |
| getUserV2 | (legacy FE references — search `DoorKnocker_frontend_DEV` for `/getUserV2`) | FE refers to a non-existent endpoint — either add the route or fix the FE. |
| updateOrganization | (legacy FE references — search `DoorKnocker_frontend_DEV` for `/updateOrganization`) | FE refers to a non-existent endpoint — either add the route or fix the FE. |

---

## 6. WebSocket service inventory

| WS service | Type | Prod dir | Test twin | Classification | Notes |
| --- | --- | --- | --- | --- | --- |
| findaddresses | Cloud Run | findaddresses | findadresses-test | USED | Deploy URL: `https://findadresses-test-331293375800.europe-west1.run.app`. Typo "findadresses-test" (single 'd') in test twin dir name — preserved for backwards-compat with FE env var. |
| findadresses-test | Cloud Run | — | findadresses-test | USED | Dev mirror of findaddresses; FE's default `VITE_FIND_ADDRESSES_WEBSOCKET_URL` points here. Dir name carries the typo. |
| addressverification | Cloud Run | addressverification | address-verification-test | USED | Address verification socket — FE default URL points to address-verification-test. |
| address-verification-test | Cloud Run | — | address-verification-test | USED | Dev twin of addressverification; FE default `VITE_VERIFY_ADDRESSES_WEBSOCKET_URL` points here. |
| postcardsendingsocket | Cloud Run | postcardsendingsocket | postcardsendingsocket-test | USED | Calls back into 6 edge functions (changeCampaignStatus, getCampaignLaunchData, getTemplateById, storePostcardSends, updatePostCardsSentCount, updateTemplateBundle). |
| postcardsendingsocket-test | Cloud Run | — | postcardsendingsocket-test | USED | Dev twin of postcardsendingsocket; same internal edge callbacks. FE default `VITE_POSTCARD_SENDING_WEBSOCKET_URL` points here. |
| discoveraddresses | Cloud Run | discoveraddresses | discoveraddresses-test | INTERNAL | Referenced internally by getPropertyCategories edge function; not called by FE. |
| discoveraddresses-test | Cloud Run | — | discoveraddresses-test | CANDIDATE | FE has zero references; only docs mention the dev URL. Prod twin is also FE-unused — dev mirror has no consumer. |
| find-addresses-openmaps | Cloud Run | find-addresses-openmaps | — (no test twin) | CANDIDATE | Orphan prod-only — no test twin; FE uses findadresses-test + Nominatim directly. Only ref is a Claude permission allowlist entry. |

---

## 7. Needs manual review

These are candidates where the adversarial pass found ambiguous evidence (a `refute_reason` exists but reasoning was inconclusive, or evidence was found but is potentially stale). Review each before deletion.

| Function | Refute reason | Evidence sources |
| --- | --- | --- |
| getAllStatesV2 | FE actively calls `/getAllStatesV2` via `organizationService.getAllStates`, used by EditReferralModal, CreateReferral, and onboarding AddressDetails. | src/services/organizationService.ts:106; src/components/referrals/modals/EditReferralModal.tsx:218; src/pages/referrals/CreateReferral.tsx:385; src/pages/onboarding/steps/AddressDetails.tsx:101 |
| getAllTemplates | `useTemplateSelector` hook calls `getAllTemplates()` which hits `GET /getAllTemplates` for the template selector UI. | src/hooks/useTemplateSelector.ts:46; src/services/templateService.ts:121; src/hooks/useTemplateSelector.ts:2; src/services/templateService.ts:110 |
| syncPostcardStatuses | Real scheduled CRON function with active CloudRun deployment; `postcard_sends` actively depends on it for refreshing PostGrid delivery statuses. | supabase/functions/CloudRun/syncPostcardStatuses/index.js; supabase/functions/syncPostcardStatuses/index.ts; supabase/migrations/20260416000001_create_postcard_sends_table.sql:60; docs/openapi.yaml:21846 |
| transferOrganizationOwnership | Referenced by name in user-facing error messages of `deleteUserV3` and `revokeUserAccessV3` as the required next step; documented in openapi.yaml as public API. Deleting would break the documented workflow even though FE hasn't wired it up. | supabase/functions/deleteUserV3/index.ts:82; supabase/functions/revokeUserAccessV3/index.ts:113; docs/openapi.yaml:19805; supabase/functions/transferOrganizationOwnership/index.ts:1-50 |
| updatePaymentMethod | Actively exercised by the backend Stripe API test script and documented in openapi.yaml; real 191-line Stripe integration handler, not a stub. | supabase/scripts/test-stripe-apis.sh:227; supabase/scripts/test-stripe-apis.sh:475; docs/openapi.yaml:11903; supabase/functions/updatePaymentMethod/index.ts |

---

## 8. Methodology

- **Scan execution**: Per-function fan-out via parallel sub-agents — each function got its own targeted grep across both repos (`dk+_backend` and `DoorKnocker_frontend_DEV`), then an adversarial refute pass attempted to disprove the candidate classification before promotion.
- **Conservative classification rule**: A function is only flagged as a deletion candidate when (a) frontend has zero literal path references (`/funcName`, `.invoke("funcName")`, `functions/v1/funcName`); AND (b) no other backend edge function imports or calls it via relative import or `callEdgeFunction`; AND (c) no `pg_cron` schedule, GitHub workflow, or deploy script references it; AND (d) it is not a webhook receiver, heartbeat target, or WebSocket → edge callee. Any single counter-signal moves it out of CANDIDATE.
- **Repos scanned**:
  - `/Users/junaidtariq/VSCodeProjects/AdlerOne/dk+_backend` (Supabase edge functions + Cloud Run WS + migrations + scripts + docs)
  - `/Users/junaidtariq/VSCodeProjects/AdlerOne/DoorKnocker_frontend_DEV` (React frontend, services, hooks, components, sandbox/mock backend)
- **Patterns matched**: axios path literals (`apiClient.post("/funcName")`, `apiClient.get("/funcName")`, `apiClient.delete`/`patch`), raw `fetch(\`${SUPABASE_URL}/functions/v1/funcName\`)`, `supabase.functions.invoke("funcName")`, WebSocket env-var URLs (`VITE_*_WEBSOCKET_URL`), backend-to-backend `callEdgeFunction(...)`, and migration/cron SQL.
- **Known indirection grep cannot fully cover**: dynamic-discriminator endpoints (`getAnalytics`, `getAnalyticsV2`) — these accept a `type` field and the server routes internally; literal grep undercounts. These are explicitly retained.
- **Edge cases handled**: Frontend sandbox/mock backend (`src/sandbox/campaign-audience/mockBackend.ts`) counts as a valid reference; doc strings and JSDoc comments are NOT counted as usage; self-references inside a function's own `index.ts` (e.g. error logs) are NOT counted.
- **Manual-review bucket**: 5 functions had ambiguous refute evidence (FE call paths hidden behind helpers, scheduled CRON, or referenced by name in backend error messages) — surfaced in §7 instead of auto-deleting.
- **Re-runnability**: Regenerate via the audit workflow rather than hand-editing. The only section meant to be hand-edited is §2 EXCEPTIONS — that is the rescue mechanism between scan and delete.
