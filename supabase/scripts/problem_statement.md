<aside>
📌

This document scopes the migration of Clean Air Epoxy from TGF-managed DoorKnocker+ campaigns to a self-service multi-tenant model for the corporate parent and their dealer network, and validates the agency/dealer pattern that will be reused for the realtor vertical. It is the authoritative reference for the discovery and delivery work that follows.

</aside>

## 1) Executive summary

### 1.1 One-sentence problem statement

Clean Air Epoxy (corporate parent with a growing dealer network) currently relies on TGF-run campaigns and has no visibility into QR scan and postcard performance; the platform already supports the agency-parent / sub-org model, universal templates, and a reporting dashboard, so the work is to enable Rick's dealers onto these existing features, audit the dashboard's zero-data reading, and validate the pattern end-to-end for the realtor vertical.

### 1.2 Why this matters (business impact)

- Unblocks the client (Rick), who is actively training dealers and wants them operating the platform themselves with TGF in a coaching role.
- Resolves an immediate trust risk: postcards have been mailed but the dashboard shows ~zero scans and ~zero data.
- Establishes the multi-tenant agency/dealer pattern needed to scale into the realtor vertical (TGF's stated "white whale" target market).
- Reduces TGF managed-service load per account, enabling Andy and team to support more accounts.
- Creates leverage: one corporate parent → many dealers, all under shared templates and consolidated reporting.

### 1.3 Scope of this document

This document scopes the Clean Air Epoxy multi-tenant transition and the platform enablement work that surfaces it — not the holiday promo or neighborhood BBQ event Rick mentioned. It defines:

- The existing platform capabilities to leverage (agency/sub-org model, universal templates, analytics dashboards) and the gaps to close (onboarding flow, dashboard data accuracy, UX for context-switching)
- The current-state issues (zero scan/data reading, no dealer access path configured)
- The success criteria for handing the platform over to Rick and his dealers
- The boundaries between platform work and account-management work (training, coaching, event design)

---

## 2) Background & context

### 2.1 Context

Clean Air Epoxy is an existing TGF DoorKnocker+ client. Andy (TGF account manager) has been running campaigns on the client's behalf — most recently post-install campaigns for Jeff (North Dallas) and Darryl (Scottsdale), mailed the week of Apr 27. The client has since grown to include additional dealers (new dealer Gary in TX, working with Jeff; a Denver team) and is expanding fast. Rick (Clean Air Epoxy corporate) wants to move from TGF running campaigns to dealers running their own, with Rick in a corporate oversight role and TGF as coach/educator.

Two operational concerns surfaced in parallel:

1. A postcard had an address typo on the Cave Creek → Scottsdale send but still arrived — minor, worth logging.
2. Rick reports zero calls so far from the two campaigns, and is asking whether he even has a dashboard to verify QR scans.

Matt (Chief Strategist) has translated Rick's email into a technical ask for Maaz, framing it as a multi-tenant platform requirement that also unlocks the realtor vertical.

### 2.2 Why this transition differs from existing onboarding

Existing onboarding most commonly produces:

- One business → one organization → one operator
- TGF runs campaigns, or a single user does

The platform already supports (but Rick's account has not been configured to use):

- One corporate parent → many dealer sub-organizations (via `organizations.is_agency` flag + `createOrganization` API for sub-orgs)
- An "agency account" view that can list members across child orgs (via `getAgencyAccountOrganizationMembers`)
- Universal templates owned outside any single org and visible to all (via `templates.is_universal` flag + `createNewUniversalTemplate` / `createNewUniversalTemplateBundle`)
- Per-org analytics via `getAnalyticsPageData` / `getAnalyticsV2`

This transition therefore requires:

- Configuring Rick's account as an agency parent and creating sub-orgs for each dealer
- Defining the agency-role permission surface (read across dealers? edit? send campaigns? billing visibility?) — the schema flag exists, but the UX/permissions for cross-org actions need to be verified
- A rolled-up parent-level dashboard view (the per-org dashboard exists; aggregate-across-children may need a thin layer)
- Self-service dealer operation, with TGF in a training/coaching role

### 2.3 Primary decisions this scoping must enable

By the end of this scoping, we must be able to answer:

1) The data model already supports parent → child via `is_agency` + sub-org creation — does it cover Rick's actual hierarchy needs, or is an extension required (e.g. multi-level nesting, billing roll-up)?
2) What does the "agency user" role look like in terms of permissions (read across dealers? edit? send campaigns? billing visibility?) — and does the current `getAgencyAccountOrganizationMembers` surface plus existing RLS cover it, or is more work needed?
3) Universal templates exist (`is_universal` + `createNewUniversalTemplate`) — is the current scoping (global vs per-agency) sufficient, or do we need parent-scoped templates that only Rick's dealers see?
4) Why is the dashboard showing ~zero scans/data — tracking pipeline issue, dashboard query issue, or genuinely low scan volume?
5) What is the minimum viable scope to hand Rick a working multi-tenant setup (mostly configuration + UX validation, not net-new build), and what is Phase 2+?
6) What constraints (PostGrid, Supabase, Stripe, Cloud Run, billing model) bound this work?

---

## 3) Problem definition

### 3.1 Problem statement (expanded)

Clean Air Epoxy is outgrowing the model where TGF runs campaigns on their behalf. Rick needs:

- Each dealer in his network to operate their own campaigns under his corporate umbrella
- A corporate-level view across all dealers without needing full admin access
- Shared templates so dealers don't reinvent design from scratch
- Trustworthy reporting on QR scans and postcard performance

Today:

- The platform supports parent → child orgs (`is_agency` flag + `createOrganization` for sub-orgs), but Rick's account has not been configured this way — his dealers either don't have accounts yet or are registered as standalone orgs with no parent linkage
- An agency-account model exists (`is_agency`, `getAgencyAccountOrganizationMembers`), but the UX flow for an agency user to switch context / act on behalf of a dealer needs to be verified end-to-end
- Universal templates exist (`is_universal` on templates, `createNewUniversalTemplate`, `createNewUniversalTemplateBundle`), but they are global today rather than agency-scoped — every org sees them, which may be too broad for Rick's brand-control needs
- The dashboard is showing ~zero scans/data despite postcards being mailed — the real, urgent issue
- No structured enablement path / SOP exists for Rick to onboard his dealers onto the existing multi-tenant features themselves

Without resolving these, the client stalls on growth, loses trust in the platform's reporting, and the realtor vertical (which needs the same model) cannot be sold confidently.

### 3.2 In-scope problem areas

- Configure Rick's account as an agency parent and migrate his existing dealers into sub-orgs (data already supports this; this is an enablement + possible migration task, not a schema build)
- Validate the agency user role end-to-end: confirm `getAgencyAccountOrganizationMembers` + RLS cover Rick's expected permissions (read across dealers, switch context, send campaigns on behalf of, billing visibility) — extend only where gaps surface
- Decide template-sharing scope: global universal templates exist today; assess whether parent-scoped (agency-only) templates are needed for Rick's brand control, and extend if so
- Dashboard and reporting audit and fix (QR scan tracking, postcard delivery data, attribution) — the dashboards exist (`getAnalyticsPageData`, `getAnalyticsV2`), but the zero-data reading needs a root cause
- Dealer onboarding flow / SOP under a corporate parent
- Validating the pattern for reuse with the realtor vertical

### 3.3 Out-of-scope problem areas

- Designing or running the holiday promo / neighborhood BBQ / community garage sale event (account management / marketing, not platform)
- Building realtor-specific UI or vertical features beyond the shared agency/dealer pattern
- Procurement or pricing changes (may be informed by this work but handled separately)
- Andy's guest-educator sessions with Rick's dealers (account management activity)

---

## 4) Objectives & success criteria

### 4.1 Objectives

- Configure Rick's account as an agency parent (using the existing `is_agency` model) so he can access every dealer underneath him.
- Set up each dealer as a sub-organization with self-service access and the shared template library visible to them.
- Confirm the existing dashboard (`getAnalyticsPageData` / `getAnalyticsV2`) reflects real QR scan and postcard performance — and surface it correctly to Rick's agency view.
- Identify and resolve the root cause of the current near-zero dashboard reading.
- Produce a validated, repeatable agency/dealer setup playbook for the realtor vertical.

### 4.2 Success criteria (definition of done)

This transition is "done" when:

- Rick can log in once and switch context between Jeff (N Dallas), Darryl (Scottsdale), Gary (TX), the Denver team, and any future dealer — without re-authenticating — using the existing agency-account flow.
- Each dealer can log in to their own scoped sub-organization and run campaigns.
- Templates created or approved at the parent level are visible to all dealers in that parent (using `is_universal` today, or agency-scoped templates if Phase 2 introduces them).
- The dashboard shows accurate QR scan counts, postcard delivery status, and campaign-level attribution for every campaign sent in the last 90 days.
- The root cause of the current ~zero scan/data reading is identified and resolved (or proven to be accurate — i.e. genuinely zero scans).
- Andy can demo the full flow to the next realtor prospect using the same pattern.
- A short dealer-onboarding SOP exists so Rick can self-onboard new dealers using the existing platform features.

---

## 5) Stakeholders & roles

### 5.1 Roles identified from the thread

- **Economic buyer:** Rick Sampson (Clean Air Epoxy corporate)
- **Decision maker:** Rick Sampson
- **Champion (client side):** Rick Sampson; possibly Chris Rutledge (Rick is delegating campaign comms to him)
- **Operators (client side):** Jeff (N Dallas), Darryl (Scottsdale), Gary (new TX), Denver team, future dealers
- **Admins (client side):** Rick (corporate); dealer-level admins TBD
- **TGF account manager:** Andy Guercio
- **TGF Chief Strategist:** Matt Russell
- **TGF Technical Director:** Maaz Imtiaz
- **TGF Engineering:** Junaid (and others as assigned)
- **IT/security (client side):** Unknown — likely none formal at Clean Air Epoxy's size; confirm
- **End customers (downstream):** Homeowners receiving postcards and scanning QR codes

### 5.2 Role risks to mitigate

- **Partial truth:** Rick described what he wants from a sales/ops perspective; he has not described his exact dealer hierarchy, billing expectations, or whether dealers pay separately or roll up to him.
- **Misaligned incentives:** Dealers may want template freedom; Rick wants template consistency for brand control.
- **Missing approver:** No client-side IT/finance approver identified — billing structure for multi-tenant could surface late.

---

## 6) Current-state discovery

### 6.1 What we know from the thread

- Campaigns are currently run by TGF (Andy) on behalf of the client.
- Two recent campaigns: post-install for Jeff in N Dallas and Darryl in Scottsdale, mailed the week of Apr 27.
- One postcard had an address typo for Cave Creek → Scottsdale but still delivered.
- Rick reports zero calls so far from those campaigns.
- Rick has no dashboard access today, or does not know he has one.
- New dealer Gary is opening a TX territory with Jeff's support.
- The Denver team is operating and Rick says they "love the process".
- Rick is delegating campaign comms to Chris Rutledge.

### 6.2 What we do NOT yet know (must be captured before build)

- Exact dealer count today and 90-day projection.
- Whether each dealer has a separate DoorKnocker+ account today (and if so, are any already linked under Rick via `is_agency`, or are they all standalone?). Resolvable via a Supabase query.
- Billing model: does Rick pay for all dealers, or do dealers pay individually? (The platform's current billing is per-org via Stripe; multi-tenant billing roll-up has not been built.)
- Whether dealers will design their own postcards or only select from approved templates — the platform supports both modes today via universal templates + per-org templates.
- Whether universal templates (global today) are acceptable to Rick or whether he needs agency-scoped templates that only his dealers see.
- What system of record exists for "which dealer canvassed which neighborhood".
- Whether the zero-scan reading is a tracking bug, a dashboard bug, or actual reality.

### 6.3 Workflow capture to-do

Map, end-to-end:

- How a campaign goes from idea → list selection → template → PostGrid send → QR redirect → scan event → dashboard.
- Where in that pipeline the data is being lost (or whether it is accurate).
- How handoffs work between TGF (Andy), Rick (corporate), and a dealer.
- Volumes: postcards per campaign, campaigns per dealer per month, expected scan rates.

### 6.4 Evidence sources to collect

- PostGrid send logs and delivery confirmations for the N Dallas and Scottsdale campaigns.
- QR redirect logs (Cloud Run / Supabase) for those campaigns.
- Dashboard queries powering the current scan count.
- A screenshot of what Rick sees (or doesn't see) when he logs in today.
- Sample postcards mailed (including the one with the typo).

---

## 7) Pain, root cause, and value definition

### 7.1 Pains (as expressed)

- "No calls yet" — possibly campaign effectiveness, possibly tracking gap.
- "Do I have a dashboard?" — visibility gap; Rick is unsure what exists.
- "Each dealer needs to register separately" — onboarding and access friction.
- "We are currently seeing almost zero scans and zero data from postcards that were sent out" (Matt) — trust-eroding reporting issue.
- Rick is doing all the dealer training himself, "until 1-2am every night".

### 7.2 Likely root causes (to be confirmed)

- **Zero scans/data on dashboard:** (a) QR tracking pipeline not firing correctly (PostGrid tracker → redirect → analytics); (b) dashboard query wrong or aggregating incorrectly; (c) genuinely low scan volume on the two campaigns so far; (d) data exists but is not surfaced to the right account / agency view.
- **Each dealer registered separately:** Rick's account has not been configured as an agency parent and his dealers were never created as sub-orgs — the platform supports both, the setup just hasn't happened.
- **Limited template sharing in practice:** universal templates exist but are global. If Rick needs agency-only templates for brand control, that is a new feature; if global is fine, this is purely a configuration / education gap.
- **Rick unsure if he has a dashboard:** onboarding never delivered dashboard access, or UI does not expose it clearly to his role; the dashboard endpoints exist (`getAnalyticsPageData` / `getAnalyticsV2`).

### 7.3 Desired outcomes (job to be done)

- Rick can confidently say "our dealers run their own campaigns and I can see what's working" — without TGF operating every campaign.
- TGF can confidently sell the same pattern to a realtor account without retrofitting.

---

## 8) Success metrics

### 8.1 Metrics framework

| Metric | Baseline | Target | Measurement | Indicator | Horizon |
|---|---|---|---|---|---|
| Dealers operating self-service campaigns | 0 | All Rick's dealers (count TBD) | Platform user activity logs | Leading | 60 days |
| Campaigns run without TGF involvement | 0 | ≥50% within 60 days; ≥80% within 90 days | Campaign creator field | Leading | 90 days |
| Dashboard scan accuracy vs PostGrid + redirect logs | Unknown / suspected low | 100% match on a sampled cohort | Manual audit, then ongoing | Lagging | 30 days |
| Time for Rick to switch between dealer accounts | N/A (impossible today) | <5 seconds, single login | Manual UX test | Lagging | 60 days |
| Realtor vertical pilot using the same pattern | 0 | 1 signed pilot | Sales pipeline | Lagging | 90 days |

### 8.2 Open metric questions

- Do we measure campaign ROI (calls / leads / booked jobs per postcard) at the platform level, or does that stay in the client's CRM?
- Who owns scan-rate benchmarks per vertical (epoxy vs realtor)?

---

## 9) Scope boundaries

### 9.1 In-scope (MVP)

- Configure Rick's account as an agency parent and create/link sub-orgs for each existing dealer (data model already supports this).
- Validate the agency user role end-to-end: read + switch-context across all child dealers via the existing flow; identify write/permission gaps and close them only if found.
- Make Rick's universal templates discoverable to his dealers via the existing `is_universal` mechanism (and decide whether to introduce parent-scoped templates in Phase 2).
- Dashboard fix: ensure QR scans and PostGrid delivery events reach the dashboard for every campaign, scoped per dealer and rolled up per parent.
- Root-cause investigation and fix of the current zero-data reading.

### 9.2 In-scope (Phase 2+)

- Billing model for multi-tenant (per-dealer billing vs parent-pays); current Stripe integration bills per-org.
- Agency-scoped (parent-level) templates as a layer between global universal templates and per-org templates — only if MVP validation shows global universal isn't enough.
- Parent-level rolled-up analytics view (the per-org dashboards exist; aggregation across an agency's children may need a thin layer).
- Dealer-level sub-roles (e.g. dealer owner vs dealer operator).
- Template approval workflow (dealer drafts → corporate approves).
- Realtor-vertical-specific dashboards or template packs.
- Co-brand on postcards (epoxy dealer + realtor co-sponsor scenario Rick raised).

### 9.3 Out of scope

- Designing the holiday promo, neighborhood BBQ, or community garage sale event mechanics.
- TGF account management activities (Andy's coaching/training of dealers).
- Changes to PostGrid pricing or contract.
- Building a CRM for Clean Air Epoxy.

### 9.4 Assumptions

- Rick has the authority to consolidate his dealers under one corporate parent account.
- Dealers are willing to operate within shared templates and a parent-controlled hierarchy.
- PostGrid and the QR redirect service can be queried for historical campaigns to validate the dashboard.

---

## 10) Constraints & non-functional requirements

### 10.1 Known constraints

- **Systems of record:** Supabase (campaigns, users, dealers, templates), PostGrid (postcard sends + delivery), Firebase, Stripe (billing), Google Cloud Run (QR redirect + WebSocket server).
- **Integration targets:** PostGrid (send + delivery webhooks), QR redirect service (scan events), Stripe (per-tenant billing TBD).
- **Auth:** existing auth model must extend to support a parent-user role spanning multiple tenants.
- **Tenant separation:** dealer data must remain isolated except via the parent role.
- **Cost:** GCP + PostGrid + Supabase cost must scale per dealer without blowing up linearly; needs limits/controls.
- **Deployment:** Cloud Run + Supabase + Firebase — no new infrastructure introduction unless justified.

### 10.2 Non-functional unknowns

- PII handling for homeowner addresses on postcard lists (PostGrid handles this today, but multi-tenant means more parties touching that data — confirm).
- Audit log requirements: does Rick want to see which dealer sent which campaign and when?
- Retention: how long do we keep scan events and postcard delivery logs?

---

## 11) Solution class selection

### 11.1 Candidate classes

- **Tooling/config improvement** — primary: configuring Rick's account, creating sub-orgs for dealers, surfacing existing dashboards.
- **Reporting/BI layer** — partial: scan reconciliation and dashboard data fix.
- **Full custom application change** — minimal: schema is already in place; only needed for any gap (e.g. agency-scoped templates, parent-level rolled-up dashboard).
- **Hybrid phased approach** — recommended.

### 11.2 Recommended class

**Hybrid phased approach.**

- **Phase A (1–2 weeks):** audit and fix the zero-scan/data issue. Restores trust before any larger work.
- **Phase B (2–3 weeks):** configure Rick as agency, migrate/create dealer sub-orgs, validate agency-user UX end-to-end, write dealer-onboarding SOP, surface universal templates to dealers. Build only the small gaps that surface (e.g. parent-scoped templates, parent-level dashboard rollup) — not a ground-up multi-tenant rewrite.
- **Phase C:** harden for realtor vertical pilot.

### 11.3 Rationale

- Rick's immediate trust issue is the dashboard. Fixing it first buys credibility while the enablement work proceeds.
- The agency model is already in the schema (`is_agency`, sub-org creation, agency-member listing, universal templates), so Phase B is dominated by configuration, UX validation, and onboarding — not a build from zero.
- Doing both in parallel is possible if a second engineer is available; otherwise sequential.

---

## 12) Feasibility, risks, and unknowns

### 12.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Zero-scan reading is actually accurate (campaign isn't producing scans) | Medium | High | Phase A audit will tell us; if so, this becomes a campaign-effectiveness conversation, not a platform fix |
| Existing dealers are standalone orgs and migrating them to sub-orgs is painful (owner reassignment, data linkage) | Medium | Medium | Supabase query in week 1 to confirm current state; if migration is heavy, prefer creating fresh sub-orgs and carrying forward campaign history rather than reparenting |
| Universal templates (global) aren't acceptable to Rick — he wants templates only his dealers see | Medium | Medium | Confirm during client call; if needed, add agency-scoped template scope in Phase B |
| Dealers resist Rick controlling templates | Low | Medium | Phase 2 template approval workflow + dealer drafts |
| Billing model unclear delays go-live | High | Medium | Defer multi-tenant billing to Phase 2; MVP keeps current per-org Stripe billing |
| Realtor pilot is sold before the pattern is hardened | Medium | High | No realtor commitments until Phase B is shipped and validated with Clean Air Epoxy |

### 12.2 Unknowns register

| Unknown | Why it matters | Owner | Source to verify | Due | Impact if unresolved |
|---|---|---|---|---|---|
| Is the zero-scan dashboard reading a bug or reality? | Determines whether Phase A is a platform fix or a campaign-effectiveness conversation | Junaid | PostGrid logs, QR redirect logs, Supabase | Within 1 week | High |
| Exact dealer count today and 90-day projection | Sizes the multi-tenant model | Andy → Rick | Direct ask | This week | Medium |
| Billing structure (per-dealer vs parent-pays) | Affects Stripe integration scope | Matt → Rick | Direct ask | Phase B kickoff | Medium |
| Whether dealers can edit templates or only consume them | Shapes the template model | Matt → Rick | Direct ask | Phase B kickoff | Medium |
| Does each dealer have their own org today, and are any already linked under Rick via `is_agency`? | Determines migration approach | Junaid + Andy | Supabase query | Within 1 week | Medium |
| Is global universal-template scope sufficient, or does Rick need agency-only templates? | Determines whether a new template scope needs to be built in Phase B | Matt → Rick | Direct ask | Phase B kickoff | Medium |
| Realtor vertical specifics (workflow, co-sponsorship pattern Rick raised) | Avoids over- or under-building the shared pattern | Matt / Frank | Realtor prospect call | Before Phase C | Medium |

---

## 13) Discovery stages, time-boxing, and deliverables

### 13.1 Stage 1 — Internal alignment (this week)

- Junaid + Maaz align on this scoping doc.
- Open questions sent to Andy → Rick.
- Phase A audit started in parallel (read-only investigation of PostGrid logs, QR redirect logs, dashboard query).

### 13.2 Stage 2 — Client validation call

- Andy + Matt schedule a working session with Rick (and Chris Rutledge if appropriate).
- Confirm dealer count, billing model, template control, timeline expectations.
- Walk Rick through the current dashboard to see what he sees.

### 13.3 Stage 3 — Phase A delivery

- **Output:** dashboard reflects accurate data for the N Dallas and Scottsdale campaigns; written root-cause finding.

### 13.4 Stage 4 — Phase B build

- **Output:** Rick configured as agency parent with all dealers as sub-orgs, dealer-onboarding SOP, validated agency-user UX, universal templates discoverable to dealers, and any small platform gaps (parent-scoped templates and/or rolled-up dashboard) closed if surfaced during validation.

### 13.5 Stage 5 — Phase C hardening

- **Output:** realtor-vertical-ready pattern validated against a real prospect.

---

## 14) Required final artifact (scoping package)

- This problem scoping document (validated with Maaz, Matt, Andy)
- Current-state workflow model for a DoorKnocker+ campaign (TGF-run → dealer-run)
- Stakeholder map (above) confirmed with Rick
- Metrics & measurement plan with baselines filled in after Phase A audit
- Constraints register (above) with PII, audit, and retention decisions confirmed
- Risks & unknowns register (above), kept live throughout delivery
- Decision log (solution class = hybrid phased; rationale recorded)

---

## 15) Automation / agent fit

The transcript-analysis system already in progress at TGF should be applied to this kind of engagement:

- Andy's client calls can be transcribed and run through the structured extraction pipeline to produce a draft workflow model, pains list, and open questions.
- The critic-prompt pattern can flag missing roles, missing volumes, and contradictions in client statements.
- Outputs become the first draft of Section 6 (current-state) and Section 7 (pains) for any new scoping doc — including this one on next iteration.

---

## 16) Failure modes this document prevents

- Re-building multi-tenant features that already exist in the schema (`is_agency`, sub-orgs, universal templates, agency-member listing) instead of configuring and validating them.
- Building a multi-tenant overlay before confirming the dashboard data is even being captured correctly.
- Selling the realtor vertical on a pattern that has not been validated with the existing epoxy client.
- Estimating Phase B without knowing the dealer count or billing model.
- Letting the holiday promo and BBQ event creep into platform scope.
- Letting Rick's late-night dealer training become TGF's problem instead of a coaching engagement.
- Shipping a "fix" to the dashboard without a written root cause, leading to recurrence.