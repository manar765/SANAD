# SANAD Project Phases

> A practical implementation roadmap based on `CONTEXT.md`.

## Project Goal

Build SANAD (سَنَد), an Arabic-first RTL platform that manages the complete in-kind assistance lifecycle:

```text
Donor → Donation → Inventory → Beneficiary → Verification → Recommendation → Human Decision → Distribution
```

The system supports staff decisions with organized information, deterministic rules, and AI-assisted extraction. It must never allow AI to make the final eligibility or distribution decision.

## Delivery Strategy

Build the smallest complete operational workflow first, then add AI, analytics, and hardening. Every phase should leave the project in a runnable state.

---

## Phase 0 — Foundation and Alignment

**Goal:** Make the current skeleton consistent with the project context.

### Tasks

- Confirm SQLite as the database, replacing the current PostgreSQL-oriented setup.
- Define environment variables and update `.env.example`.
- Establish the `public/` frontend structure.
- Configure Express to serve the frontend at `http://localhost:3000`.
- Add a working health-check endpoint.
- Confirm Arabic RTL defaults:
  - `<html lang="ar" dir="rtl">`
  - IBM Plex Sans Arabic
  - Deep teal visual identity
  - Responsive base layout
- Add a simple error-handling strategy for API failures.

### Deliverable

The application starts successfully and displays a basic Arabic RTL shell with a working backend health check.

### Completion Criteria

- `npm start` runs without database configuration errors.
- `GET /api/health` returns a successful response.
- The frontend is served through Express.
- No React, Vue, Angular, Next.js, EJS, or frontend framework is introduced.

---

## Phase 1 — Frontend Application Shell

**Goal:** Create the reusable Arabic SaaS layout used by all pages.

### Tasks

- Build the component loader using `fetch()`.
- Create shared components:
  - Sidebar
  - Header
  - Footer
  - Notification area
  - Buttons, badges, alerts, tables, modals, and empty states
- Create the main page layout and responsive navigation.
- Add initial pages:
  - Login
  - Dashboard placeholder
  - Donations placeholder
  - Inventory placeholder
  - Beneficiaries placeholder
  - Distributions placeholder
- Centralize API calls in `public/js/api.js`.
- Add Arabic labels and RTL-friendly spacing, forms, tables, and navigation.

### Deliverable

A navigable, responsive frontend shell with reusable HTML components.

### Completion Criteria

- Shared components load through JavaScript.
- Pages do not duplicate the complete sidebar and header markup.
- Layout works on desktop, tablet, and mobile.
- All major user-facing text is Arabic.

---

## Phase 2 — Database and Authentication

**Goal:** Establish secure persistence and access control.

### Tasks

- Create the initial SQLite schema for:
  - Organizations
  - Users
  - Roles
  - Audit logs
- Add database initialization and migrations.
- Add seed data for development.
- Implement password hashing.
- Implement login and logout.
- Add session management.
- Add role-based authorization for:
  - Organization Admin
  - Manager
  - Staff
  - Volunteer
- Add server-side input validation and consistent API error responses.

### Deliverable

Users can securely log in and access only the operations allowed by their roles.

### Completion Criteria

- Passwords are never stored in plain text.
- Protected API routes reject unauthenticated requests.
- Restricted operations reject unauthorized roles.
- Important authentication and permission actions are auditable.

---

## Phase 3 — Donations and Inventory

**Goal:** Track donated items and their real available quantities.

### Tasks

- Create donation and inventory tables with relational links.
- Implement donation APIs:
  - Create
  - List
  - View
  - Update
  - Delete where safe
- Add donation fields:
  - Donor
  - Category
  - Item
  - Quantity
  - Condition
  - Received date
  - Expiration date
  - Notes
- Generate unique donation IDs such as `DON-1024`.
- Implement inventory totals:
  - Original quantity
  - Distributed quantity
  - Available quantity
- Add search, filtering, category views, and status badges.
- Detect low stock, out of stock, surplus, and shortage conditions.

### Deliverable

Staff can register donations and see reliable current inventory.

### Completion Criteria

- Inventory quantities are calculated on the backend.
- Negative available quantities are impossible.
- Inventory changes are traceable to donation or distribution records.
- Frontend-only quantity updates are not trusted.

---

## Phase 4 — Beneficiaries and Needs

**Goal:** Create complete, searchable beneficiary records.

### Tasks

- Create tables for beneficiaries, household data, needs, and support history.
- Implement beneficiary APIs:
  - Create
  - List
  - View
  - Update
- Add search by beneficiary ID, name, and phone.
- Add structured needs with priorities:
  - Low
  - Medium
  - High
- Build the beneficiary profile page with sections for:
  - Basic information
  - Household information
  - Needs
  - Verification status
  - Notes
  - Previous support
  - Distribution history
- Display support history directly inside the beneficiary profile.

### Deliverable

Staff can find a beneficiary and understand their current needs and previous support.

### Completion Criteria

- Beneficiary records are persisted in SQLite.
- Needs are structured rather than stored only as free text.
- Previous distributions are visible from the profile.
- Sensitive information is not unnecessarily exposed in list views.

---

## Phase 5 — Verification and Rule-Based Recommendations

**Goal:** Help staff review cases consistently without replacing human judgment.

### Tasks

- Build the verification workflow.
- Show:
  - Current needs
  - Family information
  - Previous support
  - Last support date
  - Verification status
  - Relevant inventory
- Display recent-support warnings without automatically blocking assistance.
- Implement backend priority rules.
- Store rule inputs and recommendation explanations.
- Generate recommendations containing:
  - Priority level
  - Reasons
  - Suggested inventory items
- Reuse the recommendation component in beneficiary profiles and distribution review.

### Deliverable

Staff receive transparent, deterministic recommendations before making a decision.

### Completion Criteria

- Rules run on the backend.
- Recommendations explain their reasons.
- Recent support informs staff but does not automatically deny assistance.
- The UI clearly states that the final decision belongs to authorized staff.

---

## Phase 6 — Distribution Workflow

**Goal:** Complete and record the assistance process safely.

### Tasks

- Build the distribution workflow:
  1. Select beneficiary.
  2. Review beneficiary data.
  3. Review previous support.
  4. Review recommendation.
  5. Select available items.
  6. Enter quantities.
  7. Review the operation.
  8. Confirm distribution.
- Create distributions and distribution items tables.
- Generate unique IDs such as `DIST-2084`.
- Validate every requested quantity on the backend:
  - Requested quantity must be less than or equal to available quantity.
- Update inventory and support history in one database transaction.
- Record staff member, date, notes, and related donations where applicable.
- Add a confirmation modal and success/error feedback.

### Deliverable

Staff can complete a traceable distribution without corrupting inventory.

### Completion Criteria

- Distribution confirmation updates all related records atomically.
- Insufficient inventory is rejected server-side.
- Every distribution has a unique ID.
- The donation → inventory → distribution → beneficiary chain is traceable.

---

## Phase 7 — AI-Assisted Note Extraction

**Goal:** Reduce manual data entry while keeping staff in control.

### Tasks

- Add `POST /api/ai/analyze`.
- Send unstructured case notes to an external AI API through the backend.
- Request structured output for:
  - Family size
  - Number of children
  - School-age children
  - Employment status
  - Needs
- Validate the returned JSON on the server.
- Display extracted fields as editable values.
- Label AI-generated content clearly in Arabic:
  - `تم استخراج هذه البيانات بواسطة الذكاء الاصطناعي`
- Require staff review and confirmation before saving extracted data.
- Handle missing API keys, invalid responses, timeouts, and provider errors.

### Deliverable

Staff can use AI to extract structured information from notes and review it before saving.

### Completion Criteria

- AI is used only for extraction support.
- AI output cannot directly approve or deny assistance.
- Invalid or incomplete output is rejected safely.
- The system remains usable when the AI provider is unavailable.

---

## Phase 8 — Dashboard, Reports, Notifications, and Audit History

**Goal:** Give organizations visibility into activity and operational needs.

### Tasks

- Build the dashboard with:
  - Total donations
  - Available inventory
  - Beneficiary count
  - Completed distributions
  - Recent donations
  - Recent distributions
  - Low-stock items
  - Surplus items
  - High-priority beneficiaries
  - Recent activity
- Add reports for:
  - Donation totals
  - Distribution totals
  - Distribution rate
  - Beneficiary count
  - Most requested needs
  - Shortages and surpluses
  - Activity over time
- Add header notifications for important events.
- Complete audit logging for important create, update, delete, login, and distribution actions.
- Add filters by date, category, and status where useful.

### Deliverable

Managers can understand organizational activity and inventory needs from one dashboard.

### Completion Criteria

- Dashboard figures are derived from database data.
- Reports do not expose unnecessary personal information.
- Important actions have user, entity, action, and timestamp data.
- Notifications communicate status without requiring a dedicated page.

---

## Phase 9 — Security, Testing, and Delivery

**Goal:** Prepare SANAD for reliable demonstration and deployment.

### Tasks

- Test authentication and role restrictions.
- Test validation at API boundaries.
- Test distribution transactions and insufficient-inventory rejection.
- Test recommendation rules with representative cases.
- Test AI failure and invalid-response paths.
- Test RTL layout and responsive behavior.
- Test loading, empty, success, and error states.
- Review session security and sensitive-data exposure.
- Add production environment configuration.
- Document setup, database initialization, seed accounts, and API behavior.
- Perform an end-to-end test of the primary journey.

### Deliverable

A documented, demonstrable SANAD release that follows the architecture and safety principles in `CONTEXT.md`.

### Completion Criteria

The following journey works end to end:

```text
Login
  ↓
Dashboard
  ↓
Search Beneficiary
  ↓
Review Needs and Support History
  ↓
Review Recommendation
  ↓
Select Inventory
  ↓
Confirm Distribution
  ↓
Update Inventory and History
  ↓
View Updated Dashboard
```

---

## Recommended Implementation Order

Prioritize these milestones if time is limited:

1. Phase 0 — Foundation
2. Phase 1 — Frontend shell
3. Phase 2 — Database and authentication
4. Phase 3 — Donations and inventory
5. Phase 4 — Beneficiaries and needs
6. Phase 6 — Distribution workflow
7. Phase 5 — Verification and recommendations
8. Phase 8 — Dashboard and audit history
9. Phase 7 — AI extraction
10. Phase 9 — Final hardening

The first usable product milestone is reached after **Phase 6**. At that point, SANAD can manage donations, inventory, beneficiaries, and real distributions. AI and advanced reporting should come afterward rather than delaying the core workflow.

## Project Rules

- Arabic-first UI with native RTL support.
- Vanilla HTML, CSS, and JavaScript only on the frontend.
- Node.js and Express for the backend.
- SQLite for persistence.
- Server-side validation for security and business rules.
- AI supports extraction only; authorized staff make final decisions.
- Every distribution updates inventory and support history.
- Every important action is auditable.
- Prefer pages for major workflows and components/modals for smaller interactions.
- Avoid speculative abstractions and unnecessary dependencies.
