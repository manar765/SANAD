# SANAD | سَنَد

## Complete Project Context

## 1. Project Overview

**SANAD (سَنَد)** is an Arabic-first web platform for organizing and managing in-kind donations for student associations, small charities, and local community initiatives.

The platform organizes the complete lifecycle of in-kind assistance:

**Donor → Donation → Inventory → Beneficiary → Verification → Recommendation → Distribution**

SANAD aims to reduce randomness, avoid unnecessary duplicate support, improve visibility into beneficiary needs, and maintain a clear record of every donation and distribution.

The system helps organizations:

* Register and track donations.
* Manage available inventory.
* Register beneficiaries.
* Track beneficiary needs.
* View previous support history.
* Verify beneficiaries before providing assistance.
* Detect recent or duplicated support.
* Analyze beneficiary information.
* Extract structured information from case notes using AI.
* Apply deterministic business rules.
* Generate priority recommendations.
* Track distributions.
* Maintain an auditable history.
* Identify inventory shortages and surpluses.
* Analyze organizational activity through dashboards and reports.

SANAD does **not** automatically decide who deserves assistance.

The system provides information, rules, and recommendations to help staff make better decisions.

The final decision always remains with an authorized human staff member.

---

# 2. Core Concept

The central workflow of SANAD is:

```text
Organize Information
        ↓
Understand Needs
        ↓
Check Previous Support
        ↓
Analyze Conditions
        ↓
Generate Recommendation
        ↓
Human Decision
        ↓
Distribution
        ↓
Update Inventory
        ↓
Update Support History
```

The complete system connects:

```text
Donor
  ↓
Donation
  ↓
Inventory
  ↓
Beneficiary
  ↓
Verification
  ↓
AI-Assisted Extraction
  ↓
Business Rules
  ↓
Priority Recommendation
  ↓
Human Decision
  ↓
Distribution
  ↓
Support History
```

---

# 3. Main Problem

Small charities, student associations, and local initiatives often manage donations using:

* Excel files.
* Paper records.
* WhatsApp messages.
* Separate spreadsheets.
* Manually maintained lists.

This creates problems such as:

* Duplicate support.
* Difficulty finding previous assistance.
* Lack of real-time inventory information.
* Donation surplus in one category and shortage in another.
* Difficulty identifying urgent beneficiaries.
* Lack of traceability.
* No unified beneficiary profile.
* No centralized distribution history.

SANAD provides one centralized system for managing this information.

---

# 4. Target Users

Primary users include:

* Organization administrators.
* Charity staff.
* Student association administrators.
* Initiative coordinators.
* Volunteers.
* Distribution staff.

The primary user is a staff member who needs to manage donations and make informed distribution decisions.

---

# 5. Language Requirement

## Arabic-First Platform

The entire user interface should be primarily written in **Arabic**.

Arabic is not a later translation.

The interface must be designed as an Arabic RTL product from the beginning.

All major UI elements should be Arabic:

```text
لوحة التحكم
التبرعات
المخزون
المستفيدون
التحقق
التوزيعات
التوصيات
التقارير
الإشعارات
المستخدمون والصلاحيات
الإعدادات
```

The HTML root must use:

```html
<html lang="ar" dir="rtl">
```

The platform must support native RTL layouts.

Technical terms may remain in English when appropriate, especially:

* API
* AI
* ID
* Email
* Phone
* SQL
* HTTP

But normal user-facing text should remain Arabic.

---

# 6. Typography

Recommended primary Arabic font:

**IBM Plex Sans Arabic**

Alternative:

**Noto Sans Arabic**

Typography should prioritize readability and professional SaaS-style UI.

Avoid decorative Arabic fonts.

---

# 7. Technical Stack

The project intentionally uses traditional web technologies.

## Frontend

Use only:

* HTML5
* CSS3
* Vanilla JavaScript

Do NOT use:

* React
* Vue
* Angular
* Next.js
* Svelte
* Frontend frameworks

The frontend should remain understandable and demonstrate strong knowledge of native web development.

---

## Frontend Component Architecture

The project will use a simple **JavaScript Component Loader** to prevent duplication of common HTML.

Do NOT use EJS.

Do NOT use a server-side template engine.

Reusable HTML fragments will live in separate HTML files and be loaded into pages using JavaScript.

Example:

```text
public/
├── pages/
├── components/
└── js/
    └── component-loader.js
```

The component system is intentionally simple.

It should NOT become a custom frontend framework.

Do not implement unnecessary concepts such as:

* Virtual DOM
* State manager
* Lifecycle framework
* Event bus
* Complex rendering engine

The purpose of the Component Loader is only to reuse HTML structures.

---

# 8. Component Loader

Example project structure:

```text
public/
├── components/
│   ├── sidebar.html
│   ├── header.html
│   ├── footer.html
│   ├── modal.html
│   ├── stat-card.html
│   ├── priority-card.html
│   └── support-history.html
│
├── js/
│   └── component-loader.js
│
└── pages/
    ├── dashboard.html
    ├── donations.html
    └── beneficiaries.html
```

A page may contain:

```html
<div id="sidebar"></div>

<div class="app">

    <div id="header"></div>

    <main>
        <!-- Page-specific content -->
    </main>

    <div id="footer"></div>

</div>
```

The JavaScript loader inserts the reusable components.

Example:

```javascript
async function loadComponent(selector, path) {
    const element = document.querySelector(selector);

    if (!element) return;

    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`Failed to load component: ${path}`);
    }

    element.innerHTML = await response.text();
}
```

The shared layout can then be loaded with:

```javascript
async function loadLayout() {
    await Promise.all([
        loadComponent("#sidebar", "/components/sidebar.html"),
        loadComponent("#header", "/components/header.html"),
        loadComponent("#footer", "/components/footer.html")
    ]);
}
```

This keeps the frontend framework-free while preventing repeated HTML.

---

# 9. Important Component Loader Rule

The Component Loader is a **frontend utility**.

It is not part of the backend.

Its job is only:

```text
HTML File
   ↓
JavaScript fetch()
   ↓
DOM
```

Express is NOT responsible for rendering the components.

Express is only responsible for backend functionality such as:

* APIs.
* Authentication.
* Authorization.
* Database access.
* Business logic.
* AI integration.
* Inventory operations.

The architecture should clearly separate these responsibilities.

---

# 10. Static Server Requirement

Because the Component Loader uses `fetch()` to load HTML files, the frontend should normally be served through an HTTP server.

Do not rely on opening HTML files directly using:

```text
file:///
```

The development environment should use:

```text
http://localhost:3000
```

Express may serve the static frontend files.

This does not mean the Component Loader depends on Express.

The Component Loader remains frontend JavaScript.

---

# 11. Backend

Use:

* Node.js
* Express.js

Express provides:

* REST APIs.
* Authentication.
* Authorization.
* Validation.
* Business logic.
* Database access.
* AI API integration.
* Error handling.

Express should NOT be used as an HTML template renderer.

The frontend remains regular HTML files.

---

# 12. Database

Use:

**SQLite**

SQLite is sufficient for the graduation-project scope.

Important entities include:

```text
users
organizations
donations
inventory
beneficiaries
beneficiary_needs
support_history
distributions
distribution_items
priority_rules
ai_assessments
notifications
audit_logs
```

---

# 13. High-Level Architecture

The system architecture is:

```text
                         SANAD
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       FRONTEND                       BACKEND
             │                           │
     HTML + CSS + JS                Node.js
             │                       Express.js
     Component Loader                    │
             │                           │
             └───────────┬───────────────┘
                         │
                        API
                         │
                ┌────────┴────────┐
                ▼                 ▼
             SQLite            AI API
                │                 │
                │                 ▼
                │        Structured Information
                │                 │
                └────────┬────────┘
                         ▼
                  Business Rules
                         │
                         ▼
                   Recommendation
                         │
                         ▼
                  Human Decision
```

---

# 14. Recommended Project Structure

The recommended project structure is:

```text
SANAD/
│
├── public/
│   │
│   ├── pages/
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── donations.html
│   │   ├── inventory.html
│   │   ├── beneficiaries.html
│   │   ├── beneficiary-profile.html
│   │   ├── verification.html
│   │   ├── distributions.html
│   │   ├── reports.html
│   │   └── settings.html
│   │
│   ├── components/
│   │   ├── sidebar.html
│   │   ├── header.html
│   │   ├── footer.html
│   │   ├── modal.html
│   │   ├── stat-card.html
│   │   ├── priority-card.html
│   │   └── support-history.html
│   │
│   ├── css/
│   │   ├── variables.css
│   │   ├── base.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   └── pages/
│   │
│   └── js/
│       ├── app.js
│       ├── component-loader.js
│       ├── api.js
│       ├── utils/
│       ├── components/
│       └── pages/
│           ├── dashboard.js
│           ├── donations.js
│           ├── inventory.js
│           ├── beneficiaries.js
│           └── distributions.js
│
├── server/
│   ├── app.js
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   ├── rules/
│   ├── utils/
│   └── database/
│
├── package.json
└── README.md
```

---

# 15. Page vs Component Philosophy

A major project principle is:

> **Page for a workflow. Component for reusable UI.**

Not every feature should become a separate HTML page.

A page should represent a meaningful destination or workflow.

A component should represent a reusable UI element or a smaller section of a workflow.

Examples:

```text
Sidebar
→ Component

Header
→ Component

Footer
→ Component

Notification Dropdown
→ Component

Priority Card
→ Component

Support History
→ Component

AI Analysis
→ Component / Section

Distribution Confirmation
→ Modal

Add Donation
→ Modal or dedicated page depending on complexity
```

Do NOT create separate pages simply because a feature exists.

---

# 16. Main Pages

The application should aim for approximately **8–10 main pages**, not dozens of pages.

Core pages:

```text
1. Login
2. Dashboard
3. Donations
4. Inventory
5. Beneficiaries
6. Beneficiary Profile
7. Verification
8. Distributions
9. Reports
10. Settings
```

Additional workflows can be implemented as:

* Modals.
* Drawers.
* Sections.
* Tabs.
* Components.

This keeps the project manageable and prevents excessive duplication.

---

# 17. Dashboard

The dashboard provides a high-level overview.

Display:

### التبرعات

Total received donations.

### المخزون المتاح

Current available inventory.

### المستفيدون

Total registered beneficiaries.

### التوزيعات

Completed distributions.

Additional sections:

* Recent donations.
* Recent distributions.
* Low-stock items.
* Surplus items.
* High-priority beneficiaries.
* Most requested needs.
* Recent activity.

The dashboard should be information-dense but not overwhelming.

---

# 18. Donations Module

Staff can register donations.

Donation fields:

```text
Donor
Category
Item
Quantity
Condition
Received Date
Expiration Date
Notes
```

Every donation receives a unique ID.

Example:

```text
DON-1024
```

The system tracks:

```text
Original Quantity
Distributed Quantity
Available Quantity
```

Available quantity should update automatically after distributions.

---

# 19. Inventory Module

Inventory represents currently available donated items.

Example:

```text
شنط مدرسية

الإجمالي: 50
تم التوزيع: 18
المتاح: 32
```

Inventory supports:

* Search.
* Filtering.
* Categories.
* Quantity tracking.
* Low-stock status.
* Out-of-stock status.
* Surplus detection.
* Distribution tracking.

Statuses:

```text
متاح
مخزون منخفض
نفد المخزون
فائض
```

---

# 20. Beneficiaries Module

Each beneficiary has a profile.

Example:

```text
المستفيد #102

الاسم:
أحمد حسن

عدد أفراد الأسرة:
5

عدد الأطفال:
3

عدد الأطفال في سن الدراسة:
3

حالة العمل:
لا يعمل
```

The profile contains:

* Basic information.
* Household information.
* Needs.
* Verification status.
* Previous support.
* Distribution history.
* Notes.
* AI assessment.
* Priority recommendation.

---

# 21. Beneficiary Needs

Needs should be structured.

Examples:

```text
شنط مدرسية
ملابس
مواد غذائية
بطاطين
مستلزمات طبية
مستلزمات مدرسية
أخرى
```

Needs may have priorities:

```text
منخفضة
متوسطة
عالية
```

---

# 22. Support History

Every distribution must be recorded.

Example:

```text
10 أغسطس 2026
مساعدة غذائية
الكمية: 1
تم التوزيع بواسطة: سارة

15 يوليو 2026
ملابس
الكمية: 2
تم التوزيع بواسطة: أحمد
```

Support history should appear directly inside the beneficiary profile.

It does not need to be a separate page.

---

# 23. Verification

Before distributing assistance, staff can search for the beneficiary.

Search by:

* Beneficiary ID.
* Name.
* Phone.

The system displays:

* Current needs.
* Family information.
* Previous support.
* Last support date.
* Verification status.
* Relevant inventory.
* Priority recommendation.

Example:

```text
تم العثور على مساعدة سابقة.

آخر مساعدة:
مساعدة غذائية

منذ:
10 أيام

يرجى مراجعة سجل المساعدات قبل إجراء التوزيع.
```

The system must NOT automatically block the beneficiary.

It only provides information for the staff member.

---

# 24. AI Integration

AI is a supporting feature, not the core system.

The AI primarily extracts structured information from unstructured case notes.

Example:

```text
الأسرة مكونة من 5 أفراد، عندهم 3 أطفال في المدرسة،
والأب لا يعمل، ومحتاجين شنط وملابس.
```

AI output:

```json
{
    "familySize": 5,
    "children": 3,
    "schoolChildren": 3,
    "employment": "unemployed",
    "needs": [
        "school_bags",
        "clothes"
    ]
}
```

The extracted information must be editable and reviewable.

The UI should clearly identify AI-generated information:

```text
تم استخراج هذه البيانات بواسطة الذكاء الاصطناعي
```

Then provide:

```text
مراجعة وتأكيد
```

---

# 25. AI Safety Principle

AI must NOT make the final eligibility or distribution decision.

Correct architecture:

```text
Staff Notes
    ↓
AI
    ↓
Structured Data
    ↓
Business Rules
    ↓
Priority Analysis
    ↓
Recommendation
    ↓
Human Decision
```

The system should never present an AI result as an unquestionable decision.

---

# 26. Business Rules

Priority is calculated using deterministic rules.

Example:

```text
IF

children >= 3

AND

unemployed = true

AND

needs_school_supplies = true

AND

no_recent_school_support = true

THEN

priority = HIGH
```

Rules should be handled by the backend.

Critical business rules should not be implemented only in frontend JavaScript.

---

# 27. Priority Recommendation

Example:

```text
الأولوية: عالية

السبب:

- الأسرة مكونة من 5 أفراد.
- يوجد 3 أطفال في سن الدراسة.
- الأب لا يعمل.
- توجد حاجة إلى مستلزمات مدرسية.
- لا توجد مساعدة مدرسية حديثة.

التوصية:

شنط مدرسية
مستلزمات مدرسية
ملابس
```

The recommendation is advisory.

The staff member decides whether to proceed.

The recommendation can appear as a reusable component inside:

* Beneficiary Profile.
* Verification workflow.
* Distribution workflow.

It does not need to be its own page.

---

# 28. Distribution Module

The distribution workflow:

```text
اختيار المستفيد
        ↓
مراجعة البيانات
        ↓
مراجعة المساعدات السابقة
        ↓
مراجعة التوصية
        ↓
اختيار الأصناف
        ↓
تحديد الكمية
        ↓
مراجعة العملية
        ↓
تأكيد التوزيع
```

Example:

```text
المستفيد:
#102 أحمد حسن

الأصناف:

شنط مدرسية × 2
ملابس × 1
```

After confirmation:

```text
School Bags:
32 → 30

Clothes:
142 → 141
```

The system updates:

* Inventory.
* Beneficiary support history.
* Distribution records.
* Dashboard statistics.

---

# 29. Distribution Traceability

Every distribution receives a unique ID.

Example:

```text
DIST-2084
```

The record includes:

```text
Distribution ID
Beneficiary
Items
Quantities
Date
Staff Member
Notes
Related Donation
```

The system should make it possible to trace:

```text
Donation
   ↓
Inventory
   ↓
Distribution
   ↓
Beneficiary
```

---

# 30. Reports & Analytics

Reports should include:

* Total donations.
* Total distributions.
* Distribution rate.
* Number of beneficiaries.
* High-priority beneficiaries.
* Most requested needs.
* Inventory shortages.
* Inventory surpluses.
* Donation activity over time.
* Distribution activity over time.

Example:

```text
أكثر الاحتياجات طلبًا

1. مستلزمات مدرسية
2. ملابس
3. مواد غذائية
4. بطاطين
5. مستلزمات طبية
```

---

# 31. Surplus & Shortage Detection

The system compares demand with available inventory.

Example:

```text
مستلزمات مدرسية

الطلب:
120

المتاح:
32

الحالة:
عجز
```

Another example:

```text
ملابس

الطلب:
60

المتاح:
142

الحالة:
فائض
```

This helps the organization identify what types of donations are most needed.

---

# 32. Notifications

Notifications may include:

```text
مخزون الشنط المدرسية منخفض.

تم تسجيل تبرع جديد.

تم تحديث بيانات المستفيد #102.

يوجد مستفيد ذو أولوية عالية يحتاج إلى مراجعة.

مخزون الملابس وصل إلى مستوى فائض.
```

Notifications can appear in the Header as a dropdown or panel.

They do not need a dedicated page unless the notification history becomes large enough to justify one.

---

# 33. Users & Roles

Roles:

### Organization Admin

Full access.

### Manager

Can manage:

* Donations.
* Inventory.
* Beneficiaries.
* Reports.
* Distributions.

### Staff

Can manage:

* Beneficiaries.
* Verification.
* Distributions.

### Volunteer

Limited access to assigned operations.

---

# 34. Audit Logs

Important actions should be logged.

Examples:

```text
User Ahmed created donation DON-1024.

User Sara updated beneficiary #102.

User Mohamed confirmed distribution DIST-2084.
```

Audit logs include:

* User.
* Action.
* Entity.
* Date.
* Time.

---

# 35. UI / UX Direction

The product should look like a modern professional SaaS management platform.

The visual language should communicate:

* Trust.
* Organization.
* Transparency.
* Humanitarian purpose.
* Efficiency.

Avoid:

* Excessive charity clichés.
* Excessive heart icons.
* Generic donation-box illustrations.
* Overly colorful interfaces.
* Excessive gradients.
* Decorative UI that reduces usability.

SANAD is primarily a management system, not a marketing website.

---

# 36. Visual Identity

Primary visual direction:

**Deep Teal / Emerald**

Supporting semantic colors:

```text
Background:
Light neutral

Text:
Dark charcoal

Success:
Green

Warning:
Amber

Danger:
Red

Information:
Blue
```

Colors should have semantic meaning.

Color must not be the only way to communicate status.

---

# 37. RTL Design

RTL is a core requirement.

The platform must correctly support:

* Right-side navigation.
* Right-aligned Arabic text.
* RTL tables.
* RTL forms.
* RTL breadcrumbs.
* RTL dropdowns.
* RTL modals.
* RTL pagination.
* Correct icon placement.
* Correct spacing and alignment.

Do not simply mirror an English interface.

Design components naturally for Arabic reading direction.

---

# 38. Responsive Design

The platform must support:

* Desktop.
* Tablet.
* Mobile.

Desktop:

```text
Sidebar + Main Content
```

Tablet:

```text
Collapsible Sidebar
```

Mobile:

```text
Drawer / Mobile Navigation
```

Tables should become:

* Horizontally scrollable tables.
* Or responsive cards.

Forms should become single-column layouts on smaller screens.

---

# 39. Reusable Components

Reusable frontend components should include:

```text
Sidebar
Header
Footer
Stat Card
Data Table
Search Bar
Filter
Modal
Alert
Badge
Button
Input
Select
Tabs
Breadcrumb
Avatar
Toast
Timeline
Progress Bar
Empty State
Loading State
Priority Card
Support History
AI Assessment
```

However, not every small HTML element needs to become a component.

Only extract a component when it:

* Repeats.
* Has independent logic.
* Is sufficiently complex.
* Represents an independent UI pattern.
* Improves maintainability.

Avoid over-engineering.

---

# 40. Frontend JavaScript Architecture

Use modular Vanilla JavaScript.

Recommended structure:

```text
public/js/
│
├── app.js
├── component-loader.js
├── api.js
│
├── utils/
│   ├── formatters.js
│   ├── validators.js
│   └── helpers.js
│
├── components/
│   ├── modal.js
│   ├── toast.js
│   ├── table.js
│   └── dropdown.js
│
└── pages/
    ├── dashboard.js
    ├── donations.js
    ├── inventory.js
    ├── beneficiaries.js
    └── distributions.js
```

Do not put all frontend JavaScript in one large file.

---

# 41. API Communication

The frontend communicates with Express using `fetch()`.

Example:

```javascript
const response = await fetch("/api/beneficiaries/102");

const beneficiary = await response.json();
```

API communication should be centralized where practical.

Example:

```text
api.js
```

can contain functions such as:

```javascript
getBeneficiaries()
getBeneficiary(id)
createBeneficiary(data)
updateBeneficiary(id, data)

getDonations()
createDonation(data)

getInventory()

createDistribution(data)
```

---

# 42. Backend Architecture

Recommended structure:

```text
server/
├── app.js
├── routes/
├── controllers/
├── services/
├── middleware/
├── rules/
├── utils/
└── database/
```

Responsibilities:

### Routes

Define API endpoints.

### Controllers

Handle requests and responses.

### Services

Contain business logic.

### Database

Handle SQLite operations.

### Rules

Contain priority and business rules.

### Middleware

Handle authentication, authorization, validation, and errors.

---

# 43. REST API

Use RESTful APIs.

Examples:

```text
GET    /api/donations
POST   /api/donations
GET    /api/donations/:id
PUT    /api/donations/:id
DELETE /api/donations/:id
```

Beneficiaries:

```text
GET    /api/beneficiaries
POST   /api/beneficiaries
GET    /api/beneficiaries/:id
PUT    /api/beneficiaries/:id
```

Support history:

```text
GET /api/beneficiaries/:id/support-history
```

Verification:

```text
GET /api/beneficiaries/:id/verification
```

AI:

```text
POST /api/ai/analyze
```

Recommendations:

```text
GET /api/beneficiaries/:id/recommendation
```

Distributions:

```text
POST /api/distributions
GET  /api/distributions
GET  /api/distributions/:id
```

---

# 44. Database Relationships

Important relationships:

```text
Organization
    │
    ├── Users
    │
    ├── Donations
    │       │
    │       └── Inventory
    │
    ├── Beneficiaries
    │       │
    │       ├── Needs
    │       └── Support History
    │
    └── Distributions
            │
            ├── Beneficiary
            └── Inventory Items
```

The database should preserve relational integrity.

---

# 45. Inventory Business Rule

Inventory must never be modified only on the frontend.

For a distribution:

```text
Requested Quantity <= Available Quantity
```

The backend must validate this.

The frontend is never trusted for critical business rules.

---

# 46. Security Principles

The system handles beneficiary information and therefore requires:

* Authentication.
* Password hashing.
* Role-based authorization.
* Input validation.
* Server-side validation.
* Secure API endpoints.
* Session management.
* Protection against unauthorized access.
* Audit logs.

Avoid exposing unnecessary beneficiary information in lists.

---

# 47. Main User Journey

The primary workflow is:

```text
Login
  ↓
Dashboard
  ↓
Review Inventory / Priority Cases
  ↓
Search Beneficiary
  ↓
Open Beneficiary Profile
  ↓
Review Needs
  ↓
Review Previous Support
  ↓
Analyze Notes with AI if needed
  ↓
Apply Business Rules
  ↓
Generate Recommendation
  ↓
Staff Review
  ↓
Select Available Items
  ↓
Confirm Distribution
  ↓
Update Inventory
  ↓
Update Support History
  ↓
Update Dashboard / Analytics
```

---

# 48. Important UX Principle

SANAD should always help staff answer:

### Who needs help?

Beneficiary information.

### What do they need?

Current needs.

### What have they received before?

Support history.

### What should the staff member consider?

Priority recommendation.

### Who makes the final decision?

The authorized staff member.

---

# 49. Page Reduction Principle

Do not create a page for every feature.

Use this rule:

```text
Major workflow
    ↓
Page

Reusable UI
    ↓
Component

Small interaction
    ↓
Modal / Drawer

Information section
    ↓
Section / Tab

Data
    ↓
API
```

Examples:

```text
Add Donation
→ Modal or dedicated workflow

Edit Donation
→ Modal

Delete Confirmation
→ Modal

AI Assessment
→ Section / Modal

Priority Recommendation
→ Component

Support History
→ Component / Section

Notification History
→ Dropdown / Panel

Distribution Confirmation
→ Modal
```

This keeps the project around 8–10 major pages instead of 20–30 unnecessary pages.

---

# 50. Project Philosophy

SANAD should not become a complicated framework project.

The goal is to demonstrate strong understanding of:

* HTML.
* CSS.
* JavaScript.
* DOM manipulation.
* Fetch API.
* HTTP.
* REST APIs.
* Node.js.
* Express.js.
* SQLite.
* SQL.
* Authentication.
* Authorization.
* CRUD.
* Business logic.
* AI API integration.

The frontend should remain genuinely Vanilla JavaScript.

---

# 51. AI Architecture

The AI integration should remain simple.

The system does not require:

* Machine Learning model training.
* Custom neural networks.
* Complex recommendation models.
* Chatbot architecture.

Instead:

```text
Unstructured Staff Notes
        ↓
AI API
        ↓
Structured JSON
        ↓
Backend Validation
        ↓
Business Rules
        ↓
Recommendation
        ↓
Human Decision
```

This is enough to demonstrate meaningful AI integration.

---

# 52. Core Product Philosophy

SANAD is not:

* A social media platform.
* A donation marketplace.
* A chatbot.
* An AI decision-maker.
* A basic CRUD application.

SANAD is:

**A structured in-kind donation and beneficiary management platform with AI-assisted data extraction and rule-based support recommendations.**

---

# 53. Final Technical Definition

SANAD will be built using:

```text
Frontend:
HTML5
CSS3
Vanilla JavaScript
JavaScript Component Loader

Backend:
Node.js
Express.js

Database:
SQLite

AI:
External AI API through Node.js / Express
```

The project will **not** use:

```text
React
Vue
Angular
Next.js
EJS
```

The frontend will consist of a limited number of meaningful HTML pages.

Reusable UI will be extracted into HTML components and loaded using a lightweight JavaScript Component Loader.

The backend will expose REST APIs and handle:

* Database operations.
* Authentication.
* Authorization.
* Business rules.
* Inventory validation.
* Distribution logic.
* AI integration.
* Audit operations.

The frontend will communicate with the backend using the Fetch API.

---

# 54. Final Project Goal

SANAD should feel like a real professional Arabic SaaS platform for managing humanitarian assistance.

The system should make it possible for an organization to move from:

```text
Scattered Data
```

to:

```text
Organized Data
      ↓
Searchable Beneficiary Records
      ↓
Clear Support History
      ↓
Real-Time Inventory
      ↓
AI-Assisted Information Extraction
      ↓
Deterministic Business Rules
      ↓
Useful Recommendations
      ↓
Human Decision
      ↓
Traceable Distribution
```

The final product should prioritize:

1. Simplicity.
2. Maintainability.
3. Reusability.
4. Arabic RTL UX.
5. Clear architecture.
6. Reliable data relationships.
7. Server-side business logic.
8. Human-controlled decisions.
9. Traceability.
10. Real-world usefulness.

The project should demonstrate that a professional web platform can be built using **native HTML, CSS, and Vanilla JavaScript** while still maintaining a clean architecture through reusable components, REST APIs, and a structured backend.
