# Roles and Permissions

DoorKnocker has four user roles: Owner, Admin, Marketer, and Technician. Each role has a different level of access within an organization.

## The Four Roles

### Owner
- Full access to everything in the organization
- Can delete the organization
- Can transfer ownership to another team member
- One Owner per organization (cannot be shared)
- Cannot be removed by another team member — only transfers away

### Admin
- Full access to all features except:
  - Cannot delete the organization
  - Cannot transfer ownership
- Can add/remove team members and change roles
- Can manage billing (add/remove payment methods, view invoices)
- Best for managers or leads who need full operational control

### Marketer
- Can create and edit campaigns, targeting zones, and referrals
- Can view analytics
- **Cannot** process payments or launch campaigns (Admins must launch)
- **Cannot** invite or remove team members
- **Cannot** view billing history or manage payment methods
- Best for staff who build and manage campaigns but shouldn't touch billing

### Technician
- Can create and manage referrals
- View-only access to most other features
- Cannot create campaigns, zones, or templates
- Cannot view analytics or billing
- Best for field staff who record job completions and homeowner info in the app

---

## Permission Matrix

| Action | Owner | Admin | Marketer | Technician |
|---|---|---|---|---|
| Create/edit campaigns | ✅ | ✅ | ✅ | ❌ |
| Launch campaigns (charge payment) | ✅ | ✅ | ❌ | ❌ |
| Create/edit targeting zones | ✅ | ✅ | ✅ | ❌ |
| Create/edit templates | ✅ | ✅ | ❌ | ❌ |
| Create/manage referrals | ✅ | ✅ | ✅ | ✅ |
| View analytics | ✅ | ✅ | ✅ | ❌ |
| Invite/remove team members | ✅ | ✅ | ❌ | ❌ |
| Change team member roles | ✅ | ✅ | ❌ | ❌ |
| View billing history | ✅ | ✅ | ❌ | ❌ |
| Manage payment methods | ✅ | ✅ | ❌ | ❌ |
| Edit organization settings | ✅ | ✅ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

---

## Common Role Questions

**"I can't launch my campaign."**
Most likely you have the Marketer role. Ask your organization's Admin or Owner to either launch it for you or upgrade your role to Admin.

**"I can't see the Billing tab in Settings."**
Billing is restricted to Admin and Owner. Contact your org admin.

**"Can I have two Owners?"**
No — each organization has exactly one Owner. You can transfer ownership, but not share it.

**"Can an Admin change the Owner's role?"**
No — Admins cannot modify the Owner's role. Only the Owner can transfer ownership.
