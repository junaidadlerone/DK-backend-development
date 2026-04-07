## 1) User Story Statement

As a **Agency owner / Super Admin**, I’ll **enable and manage multiple organizations** by using the **Organizations dropdown** and **org creation flow** so I can manage multiple client orgs under one account **without cross-org data exposure**.

## 2) Dependencies

- Single-org account model exists (a user starts with exactly one org).
- Role model exists that distinguishes **Super Admin/Owner** from non-super-admin users.
- Server-side org scoping exists for all org-scoped reads/writes (org_id enforced on every request).
- Organization Settings supports org deletion (type-to-confirm) and recovery window.
- Org creation flow steps 1–3 already exist.

## 3) Context/Notes

### 3.1 Scope alignment (important)

This story replaces the older “HQ dashboard / full-screen org hub” concept.

- Org selection happens via a **top-bar dropdown**.
- Multi-org is **gated** and controlled by **Super Admins**.

### 3.2 Personas

- **Agency owner / founder (Super Admin):** creates and manages multiple client orgs.
- **Agency operations manager / delivery lead:** switches orgs for day-to-day work, but may not have permissions to create/enable multi-org.

### 3.3 Primary flow: enable multi-org and create a new organization

- Starting state: user is in **single-org mode**.
- Super Admin can enable multi-org from **Settings** (Super Admin-only section).
- User clicks the **Enable Organizations** card (sidebar) to start enabling / adding an org.
- System shows:
    
    1) **Intro modal** (education)
    
    2) **Intent modal** (3 questions; skippable)
    
    3) **Create new organization** flow (confirmation prompt + 4-step creation)
    
- On completion, user is **auto-switched** into the new org.

### 3.4 Organizations dropdown behavior

- After enablement, the top-bar button displays the active org name (e.g., “Organizations · Acme Roofing”).
- Clicking opens the **org list dropdown**.
- Dropdown rules:
    - Show only organizations the user is authorized to access.
    - Highlight the active organization.
    - Provide “Create new organization”.
    - Orgs pending deletion show “Deleting in 30 days” and are not switchable.

### 3.5 Switching rules (tenant isolation)

- Switching orgs must:
    - update the active-org label immediately
    - refresh org-scoped data so lists/search/typeaheads show only active-org data
    - fail closed (if switch fails, keep user in original org context)

### 3.6 Super Admin-only user management visibility

- In Team Management, Super Admins see an extra **Organizations** column that indicates which org(s) each user can access.
- Non-super-admin users do not see this column.

### 3.7 Disable Organizations (Super Admin-only)

- Super Admins can disable Organizations from Settings.
- If multiple orgs exist, disabling requires the user to **delete** extra orgs or **transfer** them to a different owner before disabling.

## 4) Acceptance Criteria (Given/When/Then)

1. **Given** I am a Super Admin in a single-org account, 
**when** I open Settings, 
**then** I see an enable/disable Organizations section that non-super-admin users cannot see.
2. **Given** I am in single-org mode, 
**when** I click the enable Organizations card, 
**then** an intro modal appears and I can exit without creating a new organization.
3. **Given** I proceed from the intro modal, 
**when** the intent modal appears, 
**then** I can answer the 3 questions to continue.
4. **Given** I confirm Create new organization, 
**when** I complete the 4-step creation flow, 
**then** the org is created and I am auto-switched into it.
5. **Given** I have access to Org A and Org B, 
**when** I open the Organizations dropdown, 
**then** I see only Org A and Org B and the active org is highlighted.
6. **Given** I am in Org A, 
**when** I select Org B from the dropdown, 
**then** the active org label updates and all org-scoped lists/search/typeaheads return Org B data only.
7. **Given** an org is pending deletion, 
**when** it appears in the dropdown, 
**then** it is labeled “Deleting in 30 days” and is blocked from switching.
8. **Given** I am a Super Admin, 
**when** I view Team Management, 
**then** I see an Organizations column that indicates each user’s org access.
9. **Given** I am not a Super Admin, 
**when** I view Team Management, 
**then** I do not see the Organizations column.
10. **Given** I initiate deletion in Organization Settings and type-to-confirm, 
**when** deletion is confirmed, 
**then** the org becomes inaccessible and a Recover notification is shown until recovered or permanently deleted.
11. **Given** I attempt to disable Organizations while multiple orgs exist, 
**when** I try to disable, 
**then** I am blocked with instructions to delete extra orgs or transfer ownership first.

## 5) Non-Functional Criteria

### Performance

- Organizations dropdown must open within **< 300ms**.
- Org switch must complete within **< 3s** for typical org sizes.

### Security

- All reads/writes must be server-side scoped to the active org.
- Unauthorized orgs must never appear in the dropdown.

### Auditing & Logging

- Log org switches (actor, from_org, to_org, timestamp).
- Log enable/disable actions (actor, timestamp, result).

### Error handling

- If org switch fails, show an error and keep the user in the original org context.

### Accessibility

- Dropdown and modals are keyboard navigable and WCAG 2.1 AA compliant.
- Focus is managed when opening/closing dropdown and modals.

## 6) Fields

### Enable Organizations card (sidebar)

- Title: Manage multiple organizations
- Supporting description: Keep each client or team separate, switch anytime
- Action: Get Started (click opens intro modal)

### Intro modal

- Content maintained in design files
- Actions: Get Started / Not now

### Intent modal (3 questions)

- Question 1: reason for multiple orgs (single select)
- Question 2: expected org count (single select)
- Question 3: teammate overlap (single select)
- Actions: Continue

### Organizations button (top bar)

- Displays: “Organizations · {Current Org Name}”
- Action: opens org list dropdown

### Org list dropdown

- Rows: org name, active indicator
- Status: “Deleting in 30 days” (non-switchable)
- CTA: Create new organization

### Team Management (Super Admin view)

- Additional column: Organizations (list/count + drill-in)

## 7) Reference Screens

- Feature plan: [Multi-Tenant Organization Setup — Feature Plan](https://www.notion.so/Multi-Tenant-Organization-Setup-Feature-Plan-630dab9a86b34ac19fadf03f81c9e55a?pvs=21)
- [Figma Designs Link](https://www.figma.com/design/hvgDeyfz6lnYD6ByZF6gSs/DoorKnocker---Designs?node-id=2931-2915&t=F9jee8VQwMMwFdsw-4)