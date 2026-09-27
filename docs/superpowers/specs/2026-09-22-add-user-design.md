# Add User (Identity and Role)

Date: 2026-09-22
Status: Approved for user review
Scope: Admin-only user directory with identity + role. No login, PIN, password, locations, HRM, or payroll.

## 1. Problem

Arat POS has three roles (`enterer`, `owner`, `super_admin`) and a permission matrix, but no named people. The current session is a demo chip that cycles those three roles. A Super Admin cannot record who works in the yard.

This slice adds a local user directory and an Add User form that matches the dark magenta admin chrome of the attached Create User screenshot, limited to identity and role.

## 2. Goals

- Super Admin can list users and add a user.
- Persist prefix, first name, email, active flag, and role in the encrypted local snapshot.
- Gate the screen with existing `screen.admin`. Missing key still denies.
- Bangla default copy. No emoji.
- Creating a user does not switch the demo session. The top-bar role chip still cycles the live session.

## 3. Non-goals

- Login, JWT, PIN, password, or service-staff PIN.
- Multi-outlet / multi-shop / location checkboxes.
- Sales commission, max discount, HRM, payroll, bank, social links, custom fields.
- Per-user permission rows. Roles still share the existing caps matrix.
- Editing or deleting users in this slice. Add + list only.
- Voice entry for users.
- Backend auth or `POST /api/users`. The client AES snapshot is the source of truth. Offline only in this slice.

## 4. Domain model

### 4.1 User record

```
User = {
  id: string,                 // uuid
  prefix: "mr" | "mrs" | "miss",
  first_name: string,         // required, trimmed, non-empty
  email: string,              // required, trimmed, unique case-insensitive
  active: boolean,            // default true
  role: "enterer" | "owner" | "super_admin",
  created_at: string,         // ISO timestamp
}
```

No password, last name, username, or location fields.

### 4.2 Pure function `create_user`

```
create_user(existing: User[], draft: UserDraft, now: string) -> User
```

`UserDraft` = `{ prefix, first_name, email, active, role }`.

Rules:

1. Trim `first_name` and `email`. If either is empty after trim, raise `ValueError("name and email required")`.
2. If `email` has no `@`, raise `ValueError("invalid email")`.
3. If any existing user has the same email ignoring case, raise `ValueError("email already exists")`.
4. `prefix` must be `mr` | `mrs` | `miss`. Else raise `ValueError("invalid prefix")`.
5. `role` must be one of the three existing roles. Else raise `ValueError("invalid role")`.
6. `active` defaults to `true` when omitted.
7. Return a new `User` with a new `id` and `created_at = now`. Do not mutate `existing`.

Backend Python and frontend TypeScript implement the same rules independently.

### 4.3 Seed

Hydrate with three named users, one per role, so the list is never empty after onboard:

| id | prefix | first_name | email | role | active |
| --- | --- | --- | --- | --- | --- |
| user-enterer | mr | Enterer | enterer@arat.local | enterer | true |
| user-owner | mrs | Owner | owner@arat.local | owner | true |
| user-admin | mr | Super Admin | admin@arat.local | super_admin | true |

`AppState.users: User[]`. Hydrate missing array to this seed. `backfill` must not wipe users the cashier already added.

### 4.4 Session

`Session` stays `{ role }`. Adding a user never writes `session.role`. The demo chip remains the only session switcher in this slice.

## 5. Persistence

Local AES snapshot only. `AppState.users` hydrates and persists with the rest of the app. No outbox event and no `/api/users` in this slice. Creating a user is available offline immediately.

## 6. RBAC

No new catalog keys. `screen.admin` already exists and is forced allow for `super_admin`, deny for `owner` and `enterer` by default.

- Sidebar Users and Add User: `can(..., "screen.admin")`.
- Owner / enterer hitting the screen: existing forbidden banner and fallback to home.
- Do not add `screen.users`.

## 7. UI

Reuse the dark magenta admin shell from the POS restyle. Do not add password, PIN, location, sales, more-info, HRM, or payroll cards.

### 7.1 Navigation

Sidebar item after Admin (or grouped with it):

- bn: ব্যবহারকারী
- en: Users

Visible only when `screen.admin` allows. Not in the five-item mobile tab bar.

New `Screen` value: `"users"`.

### 7.2 List

Table columns: name (prefix + first name), email, role, status (Active / Inactive), created.

Magenta `+ Add` opens the form. Empty after filter still shows seed users unless all inactive and the filter hides them. Default filter: all.

### 7.3 Form (Add User)

Title:

- bn: নতুন ব্যবহারকারী যোগ করুন
- en: Add user

One card, fields in one row wrapping:

| Field | Required | Control |
| --- | --- | --- |
| Prefix / উপসর্গ | yes | select: Mr / Mrs / Miss |
| First name / প্রথম নাম | yes | text |
| Email / ইমেইল | yes | email |
| Active / সক্রিয় | no | checkbox, default on |
| Role / ভূমিকা | yes | select: Enterer, Owner, Super Admin |

Sticky magenta Save / সংরক্ষণ করুন at the bottom. Back returns to the list without saving.

Validation errors sit under the field. Duplicate email: "ইমেইল ইতিমধ্যে আছে" / "Email already exists".

### 7.4 Copy

| Key | bn | en |
| --- | --- | --- |
| users | ব্যবহারকারী | Users |
| addUser | নতুন ব্যবহারকারী যোগ করুন | Add user |
| prefix | উপসর্গ | Prefix |
| firstName | প্রথম নাম | First name |
| email | ইমেইল | Email |
| active | সক্রিয় | Active |
| inactive | নিষ্ক্রিয় | Inactive |
| prefixMr | জনাব | Mr |
| prefixMrs | বেগম | Mrs |
| prefixMiss | কুমারী | Miss |
| emailExists | ইমেইল ইতিমধ্যে আছে | Email already exists |
| nameEmailRequired | নাম ও ইমেইল লাগবে | Name and email required |

Role labels already exist via the role chip. Reuse them.

No emoji. Info `(i)` icons from the screenshot are omitted; labels are enough.

## 8. Testing

TDD. Failing test first.

Domain (Python + TypeScript):

- Happy path returns a user with trimmed name/email, default active true, new id.
- Empty name or email rejected.
- Invalid email (no `@`) rejected.
- Duplicate email case-insensitive rejected.
- Invalid prefix or role rejected.
- Does not mutate the input list.

Frontend:

- Hydrate missing `users` with the three seed rows.
- `tsc --noEmit` clean.

Existing 69 backend + 54 frontend tests keep passing. No new backend tests unless a later slice adds `/api/users`.

## 9. File map

Create:

- `frontend/src/domain/user.ts`
- `frontend/src/domain/user.test.ts`
- `frontend/src/screens/Users.tsx`

Modify:

- `frontend/src/store/types.ts` — `User`, `AppState.users`, `Screen "users"`
- `frontend/src/store/seed.ts` — three seed users
- `frontend/src/store/offline.ts` — hydrate users
- `frontend/src/i18n/copy.ts`
- `frontend/src/App.tsx` — sidebar link, screen, save handler
- `frontend/src/styles/global.css` — form grid if needed

## 10. Spec coverage

| Requirement | Section |
| --- | --- |
| Identity fields only | 4.1, 7.3 |
| Unique email | 4.2, 7.3 |
| Admin gate, no new RBAC key | 6 |
| No PIN / password / locations / HRM / payroll | 3, 7 |
| Session unchanged on create | 4.4 |
| Dark magenta list + add form | 7 |
| Offline local snapshot | 4.3, 5 |
