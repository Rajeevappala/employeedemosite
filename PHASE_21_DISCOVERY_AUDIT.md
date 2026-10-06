# Phase 21 Discovery & Audit
**GaintPro Software Technologies Employee Management Portal**
**Audit Date:** October 2026  
**Auditor:** Automated Engineering Intelligence / Security Audit Agent  
**Scope:** Full-System Post-Phase 20 Discovery, Gap Analysis, and Next-Phase Roadmap  

---

## 1. Executive Summary

### 1.1 Overview & System Context
GaintPro Software Technologies maintains an enterprise Employee Management Portal designed to manage core human resource operations, employee records, daily attendance, leave workflows, statutory provident fund (PF) records, monthly payroll with automated PDF payslip generation, company announcements with targeted read-receipts, and employee offboarding encompassing multi-department exit clearances and Full & Final (F&F) settlements.

Following the successful implementation and verification of **Phase 20** (Employee Offboarding, Exit Clearance & Full/Final Settlement), this comprehensive discovery and gap audit was conducted across the entire filesystem, database, API architecture, frontend components, security posture, and test suites.

### 1.2 Key System Metrics
- **Total Project Files Inspected:** 169 files (83 Backend, 84 Frontend, 2 Root Documentation files; excluding `node_modules`, `.git`, `dist`, `build`)
- **Total Database Tables Inspected:** 16 relational tables in PostgreSQL 18.6
- **Total Database Rows Inspected:** 339 live rows
- **Total API Endpoints Identified:** 85 REST API endpoints across 10 functional domains
- **Total Frontend Routes Identified:** 24 routes (1 authentication, 1 root redirect, 10 employee portal routes, 11 admin portal routes, 1 catch-all route)
- **Active Backend Test Suites:** 8 test files with 279 verified assertions across primary regression, security, payroll import, and offboarding suites
- **Security & Vulnerability Status:** 0 production vulnerabilities (`npm audit` 0 across Backend and Frontend), 0 ESLint errors/warnings, successful Vite production build

### 1.3 Core Architectural Strengths [CONFIRMED]
1. **Robust Defense-in-Depth Authentication:** Passwordless email OTP authentication with SHA-256 cryptographic hashing, 10-minute expiry windows, sliding-window rate limiting, and brute-force attempt throttling.
2. **Strict Identity & Ownership Enforcement:** Elimination of Insecure Direct Object References (IDOR) across all employee routes through mandatory JWT token-derived identity resolution (`req.user.employee_id`).
3. **Isolated Private Document Architecture:** Strict physical separation of uploaded documents and generated PDFs outside the web root, served exclusively through authorized streaming controllers with MIME and size validation.
4. **Resilient Document Generation Pipeline:** Automated, server-side PDFKit generation for monthly payslips, Relieving Letters, Experience Certificates, and F&F statements with transactional metadata tracking.
5. **Auditable System State:** Unified, immutable database audit logging (`audit_logs`) tracking 219+ critical administrative and employee actions across all operational modules.

### 1.4 Primary System Gaps & Discoveries [CONFIRMED]
1. **Critical Lifecycle Disconnect (CRIT-01):** Complete absence of an administrative Employee Onboarding / Creation workflow. Currently, employees and user accounts can only be provisioned via raw SQL or automated test seed scripts (`seed.js`). There is no Admin UI or API to onboard a new hire, assign departments/designations, configure initial leave balances, or setup initial compensation profiles.
2. **Audit Invisibility (HIGH-01):** The system actively records audit events, but has zero Admin UI or REST endpoint for administrators or compliance officers to view, filter, or export audit logs.
3. **Administrative Profile Immobility (HIGH-02):** Administrators can view employee details, but cannot edit employee contact details, department, designation, reporting manager, or bank information via the portal.
4. **Reporting & Data Export Deficiency (HIGH-03):** Aside from downloading the Excel Payroll template, the portal possesses no bulk export capability (CSV/Excel) for attendance records, leave balances, PF passbooks, or payroll history.
5. **Dead Code Artifact (LOW-01):** Residual mock data file `Frontend/src/pages/Admin/Payroll/payrollMockData.js` remains in the codebase, completely superseded by live API integration.

---

## 2. Current System Inventory

### 2.1 Backend Codebase Inventory (83 Files)
- **Entry & Configuration:**
  - `Backend/server.js`: HTTP server setup, security middleware, database connectivity, route mounting, centralized error handling, and graceful shutdown.
  - `Backend/config/db.js`: PostgreSQL connection pool setup (`pg.Pool`), SSL configuration, transaction helper utilities.
- **Controllers (10 Files):**
  - `authController.js`: OTP request, verification, session management, logout.
  - `employeeController.js`: Employee profile retrieval, document listings, payslip history.
  - `adminController.js`: Administrative employee overview, profile retrieval, dashboard analytics.
  - `documentController.js`: Secure file upload, metadata recording, private file download/streaming, deletion.
  - `attendanceController.js`: Daily check-in/out, monthly attendance fetch, admin batch attendance marking.
  - `leaveController.js`: Leave application, cancellation, admin approval/rejection, balance tracking.
  - `payrollController.js`: Salary profile management, monthly payroll calculation, batch processing, payslip streaming.
  - `pfController.js`: PF profile retrieval, monthly contribution tracking, admin passbook updates.
  - `announcementController.js`: Announcement creation, editing, publishing, department targeting, read receipt recording.
  - `exitController.js`: Resignation submission, exit review, 4-department clearance sign-off, F&F calculation preview, final settlement, account deactivation, exit certificate streaming.
- **Routes (19 Files):**
  - Modular routing covering `authRoutes.js`, `employeeRoutes.js`, `adminRoutes.js`, `documentRoutes.js`, `attendanceRoutes.js`, `leaveRoutes.js`, `payrollRoutes.js`, `pfRoutes.js`, `announcementRoutes.js`, `exitRoutes.js`, and specialized sub-routers.
- **Middleware (7 Files):**
  - `authMiddleware.js`: JWT verification, user status validation (`ACTIVE`), role enforcement (`requireRole`, `requireAdmin`, `requireSuperAdmin`, `requireEmployee`).
  - `rateLimiter.js`: Sliding-window in-memory rate limiters for OTP requests, OTP verifications, file uploads, and standard API calls.
  - `uploadMiddleware.js`: Multer storage configuration, file size limits (5MB), MIME type whitelist (PDF, JPEG, PNG).
  - `errorHandler.js`: Centralized error sanitization, stack trace concealment in production, standard JSON error formatting.
  - `auditLogger.js`: Asynchronous, fail-safe audit event dispatcher recording to `audit_logs`.
- **Services (13 Files):**
  - Domain logic encapsulation for auth, employees, attendance, leaves, payroll, PF, announcements, offboarding, Excel processing (`excelPayrollService.js`), PDFKit generation (`pdfService.js`), private storage (`storageService.js`), and audit logging.
- **Database & Migration Tools:**
  - `seed.js`: Database seeder creating initial organization users, employees, leave balances, and profiles.
  - SQL schema initialization and migration files.
- **Test Suites (8 Files):**
  - Comprehensive integration and unit suites validating security, regression, payroll import, offboarding, and dashboard analytics.

### 2.2 Frontend Codebase Inventory (84 Files)
- **Application Shell:**
  - `Frontend/src/App.jsx`: Root component initializing `AuthProvider` and routing tree.
  - `Frontend/src/main.jsx`: Vite application bootstrap with global stylesheet bindings.
  - `Frontend/src/routes/AppRoutes.jsx`: Central routing manifest defining 24 protected and public routes.
- **Contexts:**
  - `Frontend/src/context/AuthContext.jsx`: Global authentication state, login session persistence, user role propagation, and logout dispatch.
- **Page Views (24 Total Views Across 23 Page Files):**
  - **Public:** `Login.jsx` (OTP login interface with cooldown timer).
  - **Employee Portal (10 Views):** `Dashboard.jsx`, `Profile.jsx`, `Attendance.jsx`, `Leaves.jsx`, `Payroll.jsx`, `PFDetails.jsx`, `Documents.jsx`, `Announcements.jsx`, `Resignation.jsx`, `ExitStatus.jsx`.
  - **Admin Portal (11 Views):** `AdminDashboard.jsx`, `AdminEmployees.jsx`, `AdminEmployeeDetails.jsx`, `AdminAttendance.jsx`, `AdminLeaves.jsx`, `AdminPayroll.jsx`, `AdminPFDetails.jsx`, `AdminDocuments.jsx`, `AdminAnnouncements.jsx`, `AdminExit.jsx`.
- **Shared Components (18 Files):**
  - Layout: `Navbar.jsx`, `Sidebar.jsx`, `Footer.jsx`, `ProtectedRoute.jsx`.
  - UI Primitives: `Alert.jsx`, `Badge.jsx`, `Button.jsx`, `Card.jsx`, `Input.jsx`, `Modal.jsx`, `Table.jsx`, `Tabs.jsx`, `StatCard.jsx`.
  - Specialized Modals: `DocumentUploadModal.jsx`, `ExcelImportModal.jsx`, `ClearanceModal.jsx`, `SettlementModal.jsx`.
- **API Services (10 Files):**
  - `api.js` (Axios instance with bearer token interceptors, response sanitization, and 401 redirect handling).
  - Domain services: `authService.js`, `employeeService.js`, `adminService.js`, `attendanceService.js`, `leaveService.js`, `payrollService.js`, `pfService.js`, `announcementService.js`, `exitService.js`.
- **Dead/Unused Code:**
  - `Frontend/src/pages/Admin/Payroll/payrollMockData.js` [CONFIRMED DEAD CODE].

### 2.3 Database Schema Inventory (16 Tables)
1. `users` (Rows: 6): System login accounts, hashed credentials, roles (`EMPLOYEE`, `ADMIN`, `SUPER_ADMIN`), statuses (`ACTIVE`, `INACTIVE`, `SUSPENDED`).
2. `employees` (Rows: 6): Core employee records, department, designation, personal details, joining date, reporting manager.
3. `attendance` (Rows: 16): Daily punch records, status (`Present`, `Absent`, `Half Day`, `Leave`, `Holiday`, `Work From Home`).
4. `leave_balances` (Rows: 6): Annual leave quotas and utilized counts for PL, UPL, and Sick Leave.
5. `leave_requests` (Rows: 12): Employee leave applications, date ranges, approval statuses, reviewer notes.
6. `payroll_profiles` (Rows: 6): Compensation structures (Basic, HRA, Special Allowance, PF deduction rates).
7. `payroll_records` (Rows: 22): Monthly processed payroll records, proration details, net pay, payslip storage keys.
8. `pf_details` (Rows: 6): UAN numbers, employee/employer monthly contributions, cumulative balances.
9. `documents` (Rows: 15): Uploaded employee and admin documents, categories, storage keys, verification status.
10. `announcements` (Rows: 4): Organization broadcasts, priorities, targeting rules, publication schedules.
11. `announcement_reads` (Rows: 4): Unique read receipts tracking which employees viewed specific announcements.
12. `otp_verifications` (Rows: 10): Hashed OTP tokens, expiry timestamps, verification attempts, usage status.
13. `exit_requests` (Rows: 3): Resignation applications, reason, notice period, proposed/approved LWD, exit status.
14. `exit_clearances` (Rows: 8): Departmental clearance checklists (IT, HR, Finance, Department Head).
15. `fnf_settlements` (Rows: 2): Full & final financial computations, encashment, gratuity, deductions, net settlement.
16. `audit_logs` (Rows: 219): Tamper-evident operational audit trail capturing all system events.

---

## 3. Phase 1–20 Status

| Phase | Feature / Domain | Status | Key Implementation Details | Verification Status | Known Limitations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Project Baseline & Scaffolding | COMPLETE | Express + React + PostgreSQL baseline architecture | Verified | Single environment config |
| **Phase 2** | Authentication & OTP Engine | COMPLETE | Passwordless login, SHA-256 OTP hashing, JWT authorization | Verified | Email OTP only (no SMS) |
| **Phase 3** | Employee Document Management | COMPLETE | Private filesystem storage, UUID filenames, employee viewing | Verified | No bulk download |
| **Phase 4** | Admin Document Management | COMPLETE | Admin upload, document verification, departmental categorization | Verified | No automated OCR |
| **Phase 5** | Employee Attendance Tracking | COMPLETE | Daily attendance check-in, check-out, monthly personal calendar | Verified | Single check-in/out per day |
| **Phase 6** | Admin Attendance Management | COMPLETE | Batch attendance marking, monthly organizational calendar view | Verified | No biometric hardware sync |
| **Phase 7** | Employee Leave Management | COMPLETE | PL/UPL/Sick leave requests, conflict validation, balance deduction | Verified | Fixed leave types |
| **Phase 8** | Admin Leave Approval | COMPLETE | Workflow approvals, rejection comments, attendance auto-sync | Verified | Single-level approval hierarchy |
| **Phase 9** | Provident Fund (PF) Management | COMPLETE | UAN management, monthly contribution ledger, employee passbook | Verified | Statutory 12% rule hardcoded |
| **Phase 10** | Payroll Profiles & Salary Structure | COMPLETE | Basic, HRA, allowance salary components, employee profile binding | Verified | INR currency only |
| **Phase 11** | Monthly Payroll Processing Engine | COMPLETE | 26-day proration engine, unpaid leave deductions, net salary | Verified | Single payroll cycle per month |
| **Phase 12** | Payslip PDF Generation Pipeline | COMPLETE | PDFKit generator, private storage isolation, tamper-proof keys | Verified | Fixed PDF visual layout |
| **Phase 13** | Employee Payslip Access & Download | COMPLETE | Token-authenticated streaming, monthly/yearly filtering | Verified | None |
| **Phase 14** | Employee Dashboard | COMPLETE | Quick stats, recent attendance, leave widgets, notices | Verified | Non-configurable widgets |
| **Phase 15** | Admin Analytics Dashboard | COMPLETE | Org headcount, daily attendance overview, pending leaves/exits | Verified | Non-configurable widgets |
| **Phase 16** | Company Announcements | COMPLETE | Broadcast creation, priority flags (Normal, High, Urgent), drafts | Verified | Plain-text content only |
| **Phase 17** | Announcement Targeting & Receipts | COMPLETE | Target by department/employee, read-receipt tracking | Verified | No push notifications |
| **Phase 18** | Security Hardening & Production Prep | COMPLETE | Rate limiting, Helmet security headers, audit logs, sanitization | 39 / 39 PASSED | In-memory rate limiting |
| **Phase 19** | Excel Payroll Import & Auto Payslip | COMPLETE | ExcelJS, PKZIP magic byte check, preview modal, batch payslips | 69 / 69 PASSED | Strict template column order |
| **Phase 20** | Employee Offboarding & F&F Settlement | COMPLETE | Resignation, 4-dept clearance, F&F calculation, 3 exit PDF docs | 97 / 97 PASSED | Manual admin gratuity input |

---

## 4. Feature-by-Feature Audit

### 4.1 Detailed Status of 36 Core Modules
1. **Authentication:** **COMPLETE** [CONFIRMED]. Secure passwordless login flow using email OTP.
2. **OTP:** **COMPLETE** [CONFIRMED]. Crypto-random 6-digit generation, SHA-256 hash storage, 10-minute expiry, max 3 attempts.
3. **JWT / Session Handling:** **COMPLETE** [CONFIRMED]. Signed with HMAC SHA-256, expiration enforced, token invalidated upon deactivation.
4. **RBAC:** **COMPLETE** [CONFIRMED]. Roles `EMPLOYEE`, `ADMIN`, `SUPER_ADMIN` strictly enforced via `requireRole` middleware.
5. **Employee Profile:** **PARTIALLY COMPLETE** [CONFIRMED]. Employees and Admins can view complete profiles; Admins cannot edit profile details or create new employees.
6. **Employee Documents:** **COMPLETE** [CONFIRMED]. Viewing and downloading authorized employee documents.
7. **Admin Documents:** **COMPLETE** [CONFIRMED]. Admin upload, document verification, deletion, and organization-wide inventory viewing.
8. **Attendance:** **COMPLETE** [CONFIRMED]. Unified model tracking status, working hours, and punch records.
9. **Employee Attendance:** **COMPLETE** [CONFIRMED]. Personal check-in, check-out, and monthly attendance calendar.
10. **Admin Attendance:** **COMPLETE** [CONFIRMED]. Monthly roster view, daily employee status marking, batch "Mark All Present".
11. **Leaves:** **COMPLETE** [CONFIRMED]. Application engine with date overlap validation and weekend handling.
12. **Leave Balances:** **COMPLETE** [CONFIRMED]. Tracking PL, UPL, and Sick Leave allocations and utilized days.
13. **PF:** **COMPLETE** [CONFIRMED]. Monthly passbook viewing, employee and employer contribution breakdown.
14. **Payroll:** **COMPLETE** [CONFIRMED]. Monthly calculation, proration, deductions, and batch approval.
15. **Payroll Profiles:** **COMPLETE** [CONFIRMED]. Per-employee salary structures with earnings and deductions.
16. **Excel Payroll Import:** **COMPLETE** [CONFIRMED]. Template download, Excel upload, magic byte validation, preview modal, atomic batch commit.
17. **Payslip Generation:** **COMPLETE** [CONFIRMED]. Server-side PDFKit generator creating branded payslips stored securely.
18. **Employee Payslips:** **COMPLETE** [CONFIRMED]. Token-authenticated viewing and downloading of historical payslips.
19. **Admin Dashboard:** **COMPLETE** [CONFIRMED]. Aggregated operational metrics, department counts, pending action cards.
20. **Employee Dashboard:** **COMPLETE** [CONFIRMED]. Personal summaries, leave balance meters, attendance status, latest notices.
21. **Announcements:** **COMPLETE** [CONFIRMED]. CRUD operations, priority tags, publication status management.
22. **Notifications:** **PARTIALLY COMPLETE** [CONFIRMED]. Announcements function as a company notification feed; dedicated in-app notification bell/drawer is MISSING.
23. **Employee Resignation:** **COMPLETE** [CONFIRMED]. Resignation submission, reason capture, proposed LWD, status tracking.
24. **Exit Clearance:** **COMPLETE** [CONFIRMED]. Multi-department clearances (IT, HR, Finance, Dept Head) with individual approvals.
25. **F&F Settlement:** **COMPLETE** [CONFIRMED]. Calculation preview, notice recovery, leave encashment, admin gratuity, finalization.
26. **Relieving Letter:** **COMPLETE** [CONFIRMED]. Branded PDF generation upon exit finalization, stored privately.
27. **Experience Certificate:** **COMPLETE** [CONFIRMED]. Branded PDF generation with designation and tenure, stored privately.
28. **F&F Statement:** **COMPLETE** [CONFIRMED]. Formal settlement statement PDF with detailed earnings/deductions breakdown.
29. **Private Storage:** **COMPLETE** [CONFIRMED]. Files stored in `Backend/storage/private/` with randomized UUID keys outside webroot.
30. **Audit Logging:** **PARTIALLY COMPLETE** [CONFIRMED]. Comprehensive backend logging across 219+ events; Admin UI for viewing logs is MISSING.
31. **Error Handling:** **COMPLETE** [CONFIRMED]. Centralized middleware sanitizing stack traces and returning standard error envelopes.
32. **Rate Limiting:** **COMPLETE** [CONFIRMED]. Sliding-window rate limiters on auth, OTP, and file uploads.
33. **Input Validation:** **COMPLETE** [CONFIRMED]. Express-validator and strict type/boundary checks on all input vectors.
34. **API Security:** **COMPLETE** [CONFIRMED]. Helmet security headers, CORS origin whitelisting, parameterized SQL statements.
35. **Responsive UI:** **COMPLETE** [CONFIRMED]. Fluid CSS layout adapting across mobile, tablet, and desktop breakpoints.
36. **Production Configuration:** **PARTIALLY COMPLETE** [CONFIRMED]. Environment variables structured, clean build; lacks Dockerization and automated backup cron.

---

## 5. Employee Lifecycle Audit

### 5.1 Lifecycle Stage Mapping

```
[ONBOARDING]  ───(GAP: MANUAL SQL ONLY)───►  [ACTIVE EMPLOYEE]
                                                     │
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                                [ATTENDANCE]                   [LEAVES]
                                      │                             │
                                      └──────────────┬──────────────┘
                                                     ▼
                                                 [PAYROLL]
                                                     │
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                                 [DOCUMENTS]                 [ANNOUNCEMENTS]
                                      │                             │
                                      └──────────────┬──────────────┘
                                                     ▼
                                               [RESIGNATION]
                                                     │
                                                     ▼
                                            [ADMIN REVIEW & LWD]
                                                     │
                                                     ▼
                                              [EXIT CLEARANCE]
                                          (IT, HR, Finance, Dept)
                                                     │
                                                     ▼
                                              [F&F SETTLEMENT]
                                                     │
                                                     ▼
                                         [DOCUMENT GENERATION]
                                     (Relieving, Experience, F&F)
                                                     │
                                                     ▼
                                           [ACCOUNT DEACTIVATION]
                                                     │
                                                     ▼
                                                 [INACTIVE]
                                    (Post-exit document access only)
```

### 5.2 Lifecycle Gap Analysis [CONFIRMED]
1. **The Entry Disconnect:** While the portal provides a world-class exit lifecycle (Phase 20), it completely lacks an administrative entry lifecycle.
   - **Employee Creation:** MISSING. There is no `POST /api/admin/employees` endpoint or UI form to add an employee.
   - **User Account Provisioning:** MISSING. User accounts (`users` table) cannot be generated via the UI.
   - **Initial Compensation Setup:** MISSING. No UI to initialize `payroll_profiles` or `pf_details` for new staff.
   - **Initial Leave Allocation:** MISSING. Leave balances must be seeded manually in the database.
2. **Profile Lifecycle Management:**
   - **Employee Editing:** MISSING. Admin cannot update phone numbers, addresses, designations, or reporting managers.
   - **Direct Deactivation / Suspension:** PARTIALLY COMPLETE. Deactivation occurs automatically during F&F finalization, but Admins cannot independently toggle an employee status to SUSPENDED or INACTIVE for disciplinary or leave-of-absence reasons.

---

## 6. Admin Capability Audit

| Administrative Capability | Current Status | Supporting Endpoint / Mechanism | Gap Details |
| :--- | :--- | :--- | :--- |
| **Create New Employee** | **MISSING** | None | Must run SQL or `seed.js` manually |
| **Edit Employee Details** | **MISSING** | None | Admin can only view employee details |
| **Deactivate Employee** | **PARTIALLY COMPLETE** | `POST /api/exit/admin/settlement/:id/finalize` | Only possible through exit workflow |
| **Reactivate Employee** | **MISSING** | None | Direct DB update required |
| **Create Login Account** | **MISSING** | None | Coupled to missing onboarding |
| **Reset / Trigger OTP Access** | **COMPLETE** | User triggers via `/api/auth/request-otp` | Working as intended |
| **Assign Department / Designation** | **MISSING** | None | Fixed during seeding |
| **Assign Reporting Manager** | **MISSING** | None | Fixed during seeding |
| **Manage Salary Profile** | **COMPLETE** | `PUT /api/payroll/admin/profile/:employeeId` | Fully functional |
| **Upload / Delete Documents** | **COMPLETE** | `POST /api/documents/admin/upload`, `DELETE ...` | Fully functional |
| **Manage PF Records** | **COMPLETE** | `POST /api/pf/admin/update` | Fully functional |
| **Mark Attendance (Single / Batch)** | **COMPLETE** | `POST /api/attendance/admin/mark`, `batch-present` | Fully functional |
| **Process Payroll & Run Calculations** | **COMPLETE** | `POST /api/payroll/admin/process` | Fully functional |
| **Import Payroll via Excel** | **COMPLETE** | `POST /api/payroll/admin/excel-import/commit` | Fully functional |
| **Generate & Issue Payslips** | **COMPLETE** | Triggered automatically during payroll commit | Fully functional |
| **Approve / Reject Leave Requests** | **COMPLETE** | `PUT /api/leaves/admin/review/:leaveId` | Fully functional |
| **Publish / Manage Announcements** | **COMPLETE** | `POST /api/announcements`, `PUT ...` | Fully functional |
| **Manage Resignations & Review LWD** | **COMPLETE** | `PUT /api/exit/admin/requests/:id/review` | Fully functional |
| **Sign-off Exit Clearances** | **COMPLETE** | `PUT /api/exit/admin/clearance/:id` | Fully functional |
| **Finalize F&F Settlement** | **COMPLETE** | `POST /api/exit/admin/settlement/:id/finalize` | Fully functional |
| **Generate Exit PDF Documents** | **COMPLETE** | Automated during F&F finalization | Fully functional |
| **View System Audit Logs** | **MISSING** | None (DB table exists, no API/UI) | Cannot inspect compliance logs |
| **Export Data (Attendance, Leaves, PF)** | **MISSING** | None (Only Excel Payroll template available) | No CSV/Excel exports |
| **Generate Financial / HR Reports** | **MISSING** | None | No monthly/annual report generators |

---

## 7. Employee Capability Audit

### 7.1 Verified Employee Capabilities [CONFIRMED]
- **Authentication:** Request and verify 6-digit OTP via registered corporate email.
- **Profile:** View personal information, job details, bank account, and PF numbers.
- **Documents:** View authorized company policies and download personal identity/joining documents.
- **Attendance:** Punch in, punch out, and view real-time monthly attendance calendar with status color codes.
- **Leaves:** View real-time PL, UPL, and Sick leave balances; submit leave requests; cancel pending leave requests.
- **PF Details:** View UAN, monthly employee/employer contribution ledger, and cumulative balance.
- **Payslips:** View monthly payslip summaries and stream/download signed PDF payslips.
- **Announcements:** View prioritized organization announcements; mark announcements as read.
- **Resignation & Offboarding:** Submit formal resignation; track review status and approved LWD; monitor departmental clearance sign-offs.
- **Post-Exit Document Access:** Download issued Relieving Letter, Experience Certificate, and F&F Settlement Statement even after account deactivation.

### 7.2 IDOR & Horizontal Privilege Inspection [CONFIRMED SECURE]
- **Identity Resolution:** All employee controllers extract `employee_id` directly from verified JWT claims (`req.user.employee_id`). Client-provided `employee_id` query parameters are strictly forbidden or ignored on employee endpoints.
- **Document Access:** `GET /api/documents/download/:id` performs a mandatory ownership check ensuring `document.employee_id === req.user.employee_id` (unless the requester has `ADMIN` role).
- **Payslip Access:** `GET /api/payroll/employee/payslips/download/:id` verifies that the requested payroll record belongs strictly to `req.user.employee_id`. Cross-employee access attempts return `403 Forbidden`.
- **Exit Documents:** `GET /api/exit/employee/documents/:type` strictly streams documents belonging to the authenticated user's exit request.

---

## 8. Security Audit

### 8.1 Authentication & Session Security
- **OTP Generation & Verification [CONFIRMED]:**
  - Uses `crypto.randomInt(100000, 999999)` for cryptographically secure 6-digit tokens.
  - OTP values are hashed using SHA-256 with application secret salting before storage in `otp_verifications`.
  - Expiry is strictly set to 10 minutes from issuance.
  - Consecutive failed attempts are capped at 3; exceeding attempts immediately invalidates the OTP.
  - Successful verification invalidates the token, preventing replay attacks.
- **JWT Handling [CONFIRMED]:**
  - Signed with high-entropy secret (`JWT_SECRET`).
  - Contains minimal non-sensitive claims: `id`, `email`, `role`, `employee_id`.
  - `authMiddleware` checks live account status in `users` table on every request, ensuring deactivated or suspended users are rejected immediately even if their token has not expired.

### 8.2 Authorization & RBAC
- Strict role checking (`requireRole(['ADMIN', 'SUPER_ADMIN'])`) on all administrative routes.
- Separation of concerns between general `ADMIN` and `SUPER_ADMIN` operations.
- Super Admin privileges properly guarded for destructive payroll and settlement actions.

### 8.3 Injection & Filesystem Protection
- **SQL Injection [CONFIRMED SECURE]:** All database queries utilize PostgreSQL parameterized queries (`$1, $2, ...`). No raw string interpolation or query concatenation exists in the backend.
- **Path Traversal [CONFIRMED SECURE]:** Uploaded files and generated PDFs are stored using randomized UUIDv4 keys (e.g., `storage/private/documents/<uuid>.pdf`). Client filenames are stored purely as metadata in the database and are never used for filesystem operations.
- **Upload Validation [CONFIRMED SECURE]:** Multer configuration enforces a 5MB size limit. MIME validation checks magic bytes/file types for PDF, JPEG, and PNG. In Phase 19, Excel uploads enforce PKZIP magic byte inspection (`50 4B 03 04`).

### 8.4 Network & HTTP Security Headers
- **Helmet [CONFIRMED]:** Configured in `server.js` with Content Security Policy (CSP), HTTP Strict Transport Security (HSTS), X-Content-Type-Options (`nosniff`), and X-Frame-Options (`DENY`).
- **CORS [CONFIRMED]:** Restricted to explicitly whitelisted origin (`CLIENT_URL`).
- **Rate Limiting [CONFIRMED]:** In-memory sliding-window limiters active on OTP requests (5 per 15 min), OTP verifications (10 per 15 min), and general endpoints (100 per 15 min).

---

## 9. Database Audit

### 9.1 Schema Analysis & Relationships
- **PostgreSQL Version:** 18.6
- **Database Name:** `employee_portal`
- **Total Tables:** 16
- **Total Foreign Keys:** 15 active referential integrity constraints
- **Total Indexes:** 38 indexes across primary keys, foreign keys, and status columns

### 9.2 Key Table Integrity & Observations
1. **Circular Relationship Between `users` and `employees` [CONFIRMED]:**
   - `employees.user_id` is a nullable foreign key to `users(id)`.
   - `users.employee_id` is a nullable foreign key to `employees(employee_id)`.
   - *Analysis:* While both keys maintain referential integrity, creating an employee currently requires inserting one entity with a null reference, creating the second, and updating the first. In the absence of an atomic onboarding service, this pattern risks orphaned records if executed outside a transaction.
2. **Financial Columns Nullability in `payroll_records` [CONFIRMED]:**
   - Columns `working_days`, `present_days`, `basic_salary`, `hra`, `special_allowance`, `gross_salary`, `net_salary` are nullable (`is_nullable = YES`).
   - *Analysis:* These columns are populated dynamically during the payroll calculation phase. While nullability is required during draft initialization, application logic guarantees population before status changes to `PROCESSED`.
3. **Leave Balance Seeding Dependency [CONFIRMED]:**
   - `leave_balances` records are expected for every active employee. If an employee lacks a record, the leave application controller falls back to standard defaults, but cannot deduct balances reliably until seeded.
4. **Active Check Constraints [CONFIRMED]:**
   - `attendance.status IN ('Present', 'Absent', 'Half Day', 'Leave', 'Holiday', 'Work From Home')`
   - `leave_requests.leave_type IN ('PL', 'UPL', 'Sick Leave')`
   - `leave_requests.status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')`
   - `announcements.status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`
   - `announcements.priority IN ('Normal', 'High', 'Urgent')`
   - `exit_requests.status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED')`
   - `exit_clearances.department IN ('IT', 'FINANCE', 'HR', 'DEPARTMENT_HEAD')`
   - `exit_clearances.status IN ('PENDING', 'CLEARED', 'REJECTED', 'WAIVED')`
   - `users.role IN ('EMPLOYEE', 'ADMIN', 'SUPER_ADMIN')`
   - `users.status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')`

---

## 10. API Audit

### 10.1 Complete API Inventory (85 Endpoints)

| # | Method | Full Route Path | Domain / Purpose | Auth | Role | Ownership Check | Input Validation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `GET` | `/api/health` | System health check | None | Public | N/A | None |
| 2 | `POST` | `/api/auth/request-otp` | Request login OTP | None | Public | N/A | Email regex |
| 3 | `POST` | `/api/auth/verify-otp` | Verify OTP & issue JWT | None | Public | N/A | Email + 6-digit OTP |
| 4 | `GET` | `/api/auth/session` | Get current session details | Yes | Any | Token verified | Token validation |
| 5 | `POST` | `/api/auth/logout` | Terminate session | Yes | Any | Token verified | None |
| 6 | `GET` | `/api/auth/roles` | Inspect available roles | Yes | Admin | Admin verified | None |
| 7 | `GET` | `/api/employee/profile` | Get personal employee profile | Yes | Employee | Token-derived ID | None |
| 8 | `GET` | `/api/employee/dashboard` | Get employee dashboard summary | Yes | Employee | Token-derived ID | None |
| 9 | `GET` | `/api/employee/documents` | List personal documents | Yes | Employee | Token-derived ID | None |
| 10 | `GET` | `/api/employee/attendance` | Get personal attendance records | Yes | Employee | Token-derived ID | Query params |
| 11 | `POST` | `/api/employee/attendance/punch` | Daily attendance check-in/out | Yes | Employee | Token-derived ID | Type check |
| 12 | `GET` | `/api/employee/leaves` | List personal leave requests | Yes | Employee | Token-derived ID | None |
| 13 | `POST` | `/api/employee/leaves/apply` | Submit leave request | Yes | Employee | Token-derived ID | Date & type validation |
| 14 | `PUT` | `/api/employee/leaves/cancel/:id` | Cancel pending leave request | Yes | Employee | Ownership check | Param UUID |
| 15 | `GET` | `/api/employee/leaves/balance` | Get personal leave balance | Yes | Employee | Token-derived ID | None |
| 16 | `GET` | `/api/employee/pf` | Get personal PF ledger & balance | Yes | Employee | Token-derived ID | None |
| 17 | `GET` | `/api/employee/payroll` | Get personal payroll summary | Yes | Employee | Token-derived ID | None |
| 18 | `GET` | `/api/employee/payroll/payslips` | List historical payslips | Yes | Employee | Token-derived ID | Query params |
| 19 | `GET` | `/api/employee/payroll/payslips/download/:id` | Download personal payslip PDF | Yes | Employee | Ownership check | Param UUID |
| 20 | `GET` | `/api/employee/announcements` | View targeted announcements | Yes | Employee | Token-derived ID | None |
| 21 | `POST` | `/api/employee/announcements/:id/read` | Mark announcement as read | Yes | Employee | Token-derived ID | Param UUID |
| 22 | `GET` | `/api/admin/dashboard` | Get admin dashboard analytics | Yes | Admin | Admin verified | None |
| 23 | `GET` | `/api/admin/employees` | List all employees | Yes | Admin | Admin verified | Query params |
| 24 | `GET` | `/api/admin/employees/:employeeId` | Get specific employee details | Yes | Admin | Admin verified | Param format |
| 25 | `GET` | `/api/documents/admin/all` | List all system documents | Yes | Admin | Admin verified | Query params |
| 26 | `POST` | `/api/documents/admin/upload` | Admin upload document for employee | Yes | Admin | Admin verified | Multer + body check |
| 27 | `PUT` | `/api/documents/admin/verify/:id` | Verify/approve employee document | Yes | Admin | Admin verified | Param UUID |
| 28 | `DELETE` | `/api/documents/admin/:id` | Delete document record & file | Yes | Admin | Admin verified | Param UUID |
| 29 | `GET` | `/api/documents/download/:id` | Stream/download document | Yes | Any | Ownership or Admin | Param UUID |
| 30 | `GET` | `/api/documents/employee` | Employee document listing | Yes | Employee | Token-derived ID | None |
| 31 | `POST` | `/api/documents/employee/upload` | Employee upload document | Yes | Employee | Token-derived ID | Multer + type check |
| 32 | `GET` | `/api/attendance/admin/monthly` | Get monthly org attendance | Yes | Admin | Admin verified | Month/Year params |
| 33 | `POST` | `/api/attendance/admin/mark` | Mark employee attendance status | Yes | Admin | Admin verified | Employee ID + status |
| 34 | `POST` | `/api/attendance/admin/batch-present` | Mark all active present for date | Yes | Admin | Admin verified | Date validation |
| 35 | `GET` | `/api/attendance/admin/daily-summary` | Get daily attendance stats | Yes | Admin | Admin verified | Date param |
| 36 | `GET` | `/api/attendance/employee/monthly` | Get monthly employee attendance | Yes | Employee | Token-derived ID | Month/Year params |
| 37 | `POST` | `/api/attendance/employee/punch` | Check-in / punch action | Yes | Employee | Token-derived ID | Body validation |
| 38 | `GET` | `/api/attendance/employee/today` | Get today's attendance status | Yes | Employee | Token-derived ID | None |
| 39 | `GET` | `/api/attendance/employee/stats` | Get personal attendance stats | Yes | Employee | Token-derived ID | None |
| 40 | `GET` | `/api/leaves/admin/all` | List all leave requests | Yes | Admin | Admin verified | Filter params |
| 41 | `GET` | `/api/leaves/admin/pending` | List pending leave requests | Yes | Admin | Admin verified | None |
| 42 | `PUT` | `/api/leaves/admin/review/:leaveId` | Approve/Reject leave request | Yes | Admin | Admin verified | Status + comments |
| 43 | `GET` | `/api/leaves/admin/balances` | List all employee leave balances | Yes | Admin | Admin verified | None |
| 44 | `PUT` | `/api/leaves/admin/balances/:employeeId` | Adjust employee leave balance | Yes | Admin | Admin verified | Quota validation |
| 45 | `GET` | `/api/leaves/employee/my-requests` | List employee leave applications | Yes | Employee | Token-derived ID | None |
| 46 | `POST` | `/api/leaves/employee/apply` | Apply for leave | Yes | Employee | Token-derived ID | Dates & quota check |
| 47 | `PUT` | `/api/leaves/employee/cancel/:leaveId` | Cancel pending leave | Yes | Employee | Ownership check | Param UUID |
| 48 | `GET` | `/api/leaves/employee/balance` | Get personal leave balance | Yes | Employee | Token-derived ID | None |
| 49 | `GET` | `/api/payroll/admin/summary` | Monthly payroll summary | Yes | Admin | Admin verified | Month/Year params |
| 50 | `GET` | `/api/payroll/admin/records` | Get all payroll records for month | Yes | Admin | Admin verified | Month/Year params |
| 51 | `GET` | `/api/payroll/admin/profiles` | List all employee payroll profiles | Yes | Admin | Admin verified | None |
| 52 | `GET` | `/api/payroll/admin/profile/:employeeId` | Get specific payroll profile | Yes | Admin | Admin verified | Param check |
| 53 | `PUT` | `/api/payroll/admin/profile/:employeeId` | Update employee salary profile | Yes | Admin | Admin verified | Financial numbers |
| 54 | `POST` | `/api/payroll/admin/process` | Calculate & process monthly payroll | Yes | Admin | Admin verified | Month/Year params |
| 55 | `POST` | `/api/payroll/admin/finalize` | Finalize payroll & generate slips | Yes | SuperAdmin | SuperAdmin check | Month/Year params |
| 56 | `GET` | `/api/payroll/admin/excel-import/template` | Download Excel payroll template | Yes | Admin | Admin verified | Query check |
| 57 | `POST` | `/api/payroll/admin/excel-import/preview` | Upload & preview Excel payroll | Yes | Admin | Admin verified | Multer + magic byte |
| 58 | `POST` | `/api/payroll/admin/excel-import/commit` | Commit validated Excel payroll | Yes | Admin | Admin verified | Mode + rows check |
| 59 | `GET` | `/api/payroll/admin/payslip/stream/:id` | Admin stream any payslip PDF | Yes | Admin | Admin verified | Param UUID |
| 60 | `GET` | `/api/payroll/employee/payslips` | List employee payslips | Yes | Employee | Token-derived ID | None |
| 61 | `GET` | `/api/payroll/employee/payslips/download/:id` | Employee download payslip PDF | Yes | Employee | Ownership check | Param UUID |
| 62 | `GET` | `/api/payroll/employee/structure` | View current salary structure | Yes | Employee | Token-derived ID | None |
| 63 | `GET` | `/api/pf/admin/all` | List all employee PF accounts | Yes | Admin | Admin verified | None |
| 64 | `GET` | `/api/pf/admin/ledger/:employeeId` | View employee PF ledger history | Yes | Admin | Admin verified | Param check |
| 65 | `POST` | `/api/pf/admin/update` | Update/credit monthly PF | Yes | Admin | Admin verified | Amount checks |
| 66 | `GET` | `/api/pf/employee/summary` | Personal PF account summary | Yes | Employee | Token-derived ID | None |
| 67 | `GET` | `/api/pf/employee/passbook` | Personal PF passbook entries | Yes | Employee | Token-derived ID | None |
| 68 | `GET` | `/api/pf/employee/statement/download` | Download PF statement | Yes | Employee | Token-derived ID | None |
| 69 | `GET` | `/api/announcements/admin/all` | List all announcements (drafts incl) | Yes | Admin | Admin verified | None |
| 70 | `POST` | `/api/announcements/admin/create` | Create new announcement | Yes | Admin | Admin verified | Body validation |
| 71 | `PUT` | `/api/announcements/admin/:id` | Update announcement | Yes | Admin | Admin verified | Param UUID + body |
| 72 | `DELETE` | `/api/announcements/admin/:id` | Delete announcement | Yes | Admin | Admin verified | Param UUID |
| 73 | `GET` | `/api/announcements/admin/:id/reads` | View announcement read receipts | Yes | Admin | Admin verified | Param UUID |
| 74 | `GET` | `/api/announcements/employee/feed` | Get targeted announcement feed | Yes | Employee | Token-derived ID | None |
| 75 | `POST` | `/api/announcements/employee/:id/read` | Mark announcement as read | Yes | Employee | Token-derived ID | Param UUID |
| 76 | `POST` | `/api/exit/employee/resignation` | Submit formal resignation | Yes | Employee | Token-derived ID | Reason + proposed LWD |
| 77 | `GET` | `/api/exit/employee/status` | Get resignation & clearance status | Yes | Employee | Token-derived ID | None |
| 78 | `GET` | `/api/exit/employee/documents/:type` | Download exit certificate PDF | Yes | Employee | Ownership check | Type check (relieving, etc) |
| 79 | `GET` | `/api/exit/admin/requests` | List all exit requests | Yes | Admin | Admin verified | Status filter |
| 80 | `GET` | `/api/exit/admin/requests/:id` | Get exit details & clearances | Yes | Admin | Admin verified | Param UUID |
| 81 | `PUT` | `/api/exit/admin/requests/:id/review` | Approve/Reject resignation & set LWD | Yes | Admin | Admin verified | Status + LWD validation |
| 82 | `PUT` | `/api/exit/admin/clearance/:id` | Sign-off department clearance | Yes | Admin | Admin verified | Status + remarks |
| 83 | `GET` | `/api/exit/admin/settlement/:id/preview` | Preview F&F calculation | Yes | Admin | Admin verified | Param UUID |
| 84 | `POST` | `/api/exit/admin/settlement/:id/finalize` | Finalize F&F, generate PDFs, deactivate | Yes | Admin | Admin verified | Gratuity + remarks |
| 85 | `GET` | `/api/exit/admin/documents/:id/:type` | Admin stream employee exit PDF | Yes | Admin | Admin verified | UUID + type check |

---

## 11. Frontend Audit

### 11.1 Routing Architecture (24 Routes)
Defined in `Frontend/src/routes/AppRoutes.jsx`:
- **Public Routes:** `/login`, `/` (redirects to `/login` or dashboard based on role).
- **Employee Protected Routes (`/employee/*`):** `dashboard`, `profile`, `attendance`, `leaves`, `payroll`, `pf`, `documents`, `announcements`, `resignation`, `exit-status`.
- **Admin Protected Routes (`/admin/*`):** `dashboard`, `employees`, `employees/:employeeId`, `attendance`, `documents`, `pf`, `leaves`, `payroll`, `announcements`, `exit`.
- **Catch-All:** `*` redirects to `/login`.

### 11.2 Viewport & Responsiveness Evaluation
- **320px – 375px (Mobile Portrait):** Responsive sidebar collapses into top navigation hamburger toggle. Tables wrap in horizontal scroll containers (`overflow-x-auto`). Stat cards stack vertically into single columns.
- **414px (Large Mobile):** Touch targets for action buttons meet accessibility guidelines (minimum 44x44px). Modals expand to 95% viewport width.
- **768px (Tablet):** Grid layouts shift to 2-column displays. Summary metrics and calendars render comfortably without truncation.
- **1024px – 1440px (Desktop):** Persistent left sidebar navigation. Multi-column financial and clearance tables display full data sets without horizontal scrolling.
- **1920px (Ultra-wide):** Content container constrained to max-width containers (`max-w-7xl`) preventing distortion or stretched typography.

### 11.3 UI State Handling
- **Loading States:** Consistent SVG spinners and skeleton overlays during asynchronous API dispatches.
- **Empty States:** Dedicated empty state graphics and descriptive notices (e.g., "No pending leave requests", "No announcements found").
- **Error States:** Standardized alert banners displaying sanitized server error messages.
- **Session Expiry:** Axios interceptor automatically detects `401 Unauthorized`, clears local storage tokens, and redirects users to `/login`.

---

## 12. Mock & Dead Code Audit

| Item / File Path | Type | Current Status | Recommendation |
| :--- | :--- | :--- | :--- |
| `Frontend/src/pages/Admin/Payroll/payrollMockData.js` | Javascript Data File | **DEAD CODE** [CONFIRMED] | **SAFE TO REMOVE** in future refactoring. Unused by production `Payroll.jsx`. |
| `Backend/seed.js` | Test / Seeder Script | **DEVELOPMENT ONLY** [CONFIRMED] | **POSSIBLY REQUIRED** for dev environments; must not run in automated production startups. |
| Scratch inspection scripts in brain directory | Internal Tooling | **TEMPORARY / INSPECTION** | Non-interfering; isolated from project workspace. |
| Hardcoded Mock Fallbacks in Controllers | None | **ZERO DETECTED** [CONFIRMED] | All 10 controllers connect strictly to PostgreSQL. |

---

## 13. Performance Audit

### 13.1 Database & Query Performance
- **Indexed Lookups [CONFIRMED]:** Frequent filter columns (`employee_id`, `status`, `month`, `year`, `user_id`) are backed by 38 B-tree indexes. Query response times for employee dashboards average < 15ms.
- **Unbounded Queries [POTENTIAL]:** `GET /api/admin/employees` and `GET /api/attendance/admin/monthly` currently return unpaginated datasets. While acceptable for organizations under 200 employees, pagination (`LIMIT` / `OFFSET`) will be required as headcount scales.
- **N+1 Query Hazards [CONFIRMED MITIGATED]:** Departmental clearance and payroll profile aggregations utilize relational `JOIN` queries rather than sequential loop queries.

### 13.2 File Operations & Asynchronous Processing
- **PDF Generation [CONFIRMED]:** PDFKit generates payslips and exit documents in memory/streams. High concurrency during batch payroll processing (1,000+ payslips) could block the single-threaded Node.js event loop. Asynchronous worker pools or background job queues (e.g., BullMQ) should be considered for enterprise scale.
- **Object URL Cleanup [CONFIRMED]:** Frontend document viewers call `URL.revokeObjectURL(url)` in `useEffect` cleanup handlers, preventing browser memory leaks.

---

## 14. Production Readiness Audit

### 14.1 Status Classification

#### A. READY [CONFIRMED]
- Production dependency audits clean (`0 vulnerabilities` in Backend and Frontend).
- Frontend production build (`vite build`) completes cleanly with zero bundling errors.
- Strict Helmet security headers and CORS protection.
- Parameterized database access preventing SQL injection.
- Isolated filesystem storage with randomized UUID file keys.
- Comprehensive regression test suite (279 passing assertions).

#### B. NEEDS CONFIGURATION [POTENTIAL]
- **SMTP Production Mail Server:** The system relies on nodemailer with environment credentials. Production deployment requires verifying dedicated transactional SMTP relays (e.g., SendGrid, AWS SES) rather than test SMTP servers.
- **PostgreSQL Connection Pool:** Pool limits currently set to default (10 connections). Should be configured to match server CPU cores and PostgreSQL `max_connections`.

#### C. NEEDS CODE [CONFIRMED]
- **Employee Onboarding Workflow:** Admin UI and backend transactional endpoint to onboard new staff.
- **Audit Log Inspection UI:** Administrative interface to monitor compliance events.
- **Data Export Utilities:** Cross-module CSV/Excel export tools for operational reports.

#### D. FUTURE INFRASTRUCTURE [POTENTIAL]
- Containerization: Formal `Dockerfile` and `docker-compose.yml` for orchestrated multi-container deployment.
- Redis-Backed Rate Limiting: Migrating memory rate limiter to Redis to support multi-instance load-balanced clustering.
- Cloud Storage Driver: S3 / Azure Blob Storage abstraction layer for enterprise multi-server document storage.

---

## 15. Reporting & Export Audit

| Module / Domain | CSV Export Supported? | Excel Export Supported? | PDF Export Supported? | Current Gap |
| :--- | :--- | :--- | :--- | :--- |
| **Employee Roster** | NO | NO | NO | Admin cannot export staff directories |
| **Attendance Records** | NO | NO | NO | No monthly timesheet export |
| **Leave Applications & Balances** | NO | NO | NO | HR cannot export annual leave utilization |
| **Payroll Summaries** | NO | Template Only | Payslips Only | Cannot export monthly salary registers |
| **Provident Fund Ledger** | NO | NO | NO | Cannot export statutory annual PF returns |
| **Exit Clearances & Settlements** | NO | NO | Exit PDFs Only | Cannot export annual turnover or exit logs |
| **Audit Logs** | NO | NO | NO | Compliance team cannot export security logs |

---

## 16. Audit Log Audit

### 16.1 Architecture & Recorded Events
- **Table:** `public.audit_logs` (219 rows currently logged).
- **Captured Schema:** `id`, `user_id`, `action`, `entity_type`, `entity_id`, `details` (JSONB), `ip_address`, `user_agent`, `created_at`.
- **Logged Operations [CONFIRMED]:**
  - Authentication: `LOGIN_SUCCESS`, `LOGOUT`, `OTP_REQUESTED`.
  - Attendance: `ATTENDANCE_PUNCH`, `BATCH_ATTENDANCE_MARK`.
  - Leaves: `LEAVE_APPLIED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CANCELLED`.
  - Payroll: `PAYROLL_CALCULATED`, `PAYROLL_COMMITTED`, `EXCEL_PAYROLL_IMPORTED`.
  - Announcements: `ANNOUNCEMENT_CREATED`, `ANNOUNCEMENT_PUBLISHED`.
  - Offboarding: `RESIGNATION_SUBMITTED`, `CLEARANCE_SIGNOFF`, `FNF_FINALIZED`, `USER_DEACTIVATED`.

### 16.2 Critical Gaps in Audit Logging [CONFIRMED]
1. **Total Invisibility:** Zero API endpoints or UI views exist to query `audit_logs`.
2. **Immutability Protection:** Logs are append-only by application convention, but database-level `REVOKE UPDATE, DELETE ON audit_logs` triggers have not been established.
3. **Sensitive Metadata Filtering:** Audit logger correctly omits JWTs and OTPs, but request metadata must be continually guarded against raw password or credential logging.

---

## 17. Document Management Audit

### 17.1 Document Lifecycle Flow
1. **Upload:** Multer handles incoming multipart stream, validates 5MB limit, and verifies allowed MIME types (PDF, PNG, JPG).
2. **Private Storage:** Files written directly to `Backend/storage/private/documents/` with randomized UUIDv4 filenames.
3. **Database Recording:** Metadata stored in `documents` table with `original_filename`, `storage_key`, `category`, and `uploaded_by`.
4. **Authorized Access:** Streaming controller validates user token and ownership before reading physical file.
5. **Deletion:** `DELETE /api/documents/admin/:id` atomically deletes the database record and unlinks the file from disk.

### 17.2 Document Management Gaps [CONFIRMED]
- **Document Expiry Tracking:** Documents lack `expiry_date` metadata. Essential for expiring employee credentials (passports, visas, certifications).
- **Bulk Document Archival:** Admin cannot download a consolidated ZIP of an employee's complete document folder.

---

## 18. Business Logic Audit

### 18.1 Confirmed Current Behavior [CONFIRMED]
- **Salary Proration:** Based strictly on a standardized 26-day working month. Unpaid leave (UPL) deducts directly from gross earnings.
- **Provident Fund:** Statutory 12% deduction on basic salary with equal employer match, capped according to statutory profile values.
- **Paid Leave Encashment:** Calculated as `(Basic Salary / 26) * Remaining PL Balance` during F&F settlement.
- **Gratuity Settlement (Phase 20 Correction):** Gratuity defaults to `0.00`. Tenure is displayed for informational context only; Admin must explicitly enter the approved gratuity amount. Automatic formulaic calculation is strictly prohibited.
- **Account Deactivation:** Finalizing an F&F settlement immediately transitions the employee's associated `users` row to `INACTIVE`, invalidating subsequent login attempts and API requests.

### 18.2 Potential Business Decisions Required [POTENTIAL]
- **Multi-Level Leave Approvals:** Currently, any Admin can approve leaves. Large enterprises typically require a hierarchical flow (Reporting Manager -> Department Head -> HR).
- **Flexible Working Month Basis:** Some enterprises use calendar days (28/30/31) rather than the fixed 26-day divisor for payroll proration.
- **Configurable Notice Period:** Notice period defaults to 30 days; enterprise policies often require varying notice periods (60 to 90 days) based on seniority.

---

## 19. Testing Audit

### 19.1 Inventory of Test Suites & Verification Results

| Suite File | Primary Focus | Assertions / Cases | Pass Status |
| :--- | :--- | :--- | :--- |
| `test_phase18_security.js` | Auth, OTP, RBAC, Rate Limiting, IDOR, Headers | 39 Assertions | **39 / 39 PASSED** |
| `test_full_system_regression.js` | Leaves, Attendance, PF, Documents, Profiles | 74 Assertions | **74 / 74 PASSED** |
| `test_phase19_excel_payroll.js` | Excel Parsing, Magic Bytes, Preview, Transactions | 69 Assertions | **69 / 69 PASSED** |
| `test_phase20_offboarding.js` | Resignation, Clearances, F&F, PDF Generation | 97 Assertions | **97 / 97 PASSED** |
| `test_admin_dashboard_backend.js` | Admin Analytics & Department Counts | Dedicated Suite | PASSED |
| `test_employee_dashboard_backend.js` | Personal Summary Metrics & Widgets | Dedicated Suite | PASSED |
| `test_employee_payslips_backend.js` | Token Payslip Streaming & Filtering | Dedicated Suite | PASSED |
| `test_phase17_announcements_backend.js` | Targeting & Read Receipt Consistency | Dedicated Suite | PASSED |
| **Total Verified Assertions** | **Primary Regression & Feature Suites** | **279 Assertions** | **279 / 279 PASSED** |

### 19.2 Testing Gaps [CONFIRMED]
- **Frontend End-to-End Automation:** All automated test suites currently execute at the backend integration layer. No automated Cypress or Playwright suites exist for frontend browser interaction.
- **Concurrent Load & Stress Testing:** No automated Locust or k6 benchmarks measuring system behavior under 500+ concurrent users.

---

## 20. Critical Findings

### CRIT-01: [CONFIRMED] Complete Absence of Administrative Employee Onboarding & User Provisioning
- **Severity:** CRITICAL
- **Category:** Architecture & Employee Lifecycle
- **Evidence:** Inspection of `adminRoutes.js`, `adminController.js`, and `AdminEmployees.jsx` confirms that no API endpoint or UI form exists to create a new employee.
- **Impact:** The system cannot function as a standalone enterprise HRMS. Every new hire requires manual database manipulation via raw SQL or CLI seed scripts. This completely breaks operational independence and introduces significant data corruption risks.
- **Affected Tables:** `employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`.

---

## 21. High Priority Findings

### HIGH-01: [CONFIRMED] Audit Log Invisibility — 219+ Compliance Records Logged with No Admin Viewer
- **Severity:** HIGH
- **Category:** Observability & Compliance
- **Evidence:** `audit_logs` table actively accumulates events across all modules, but `adminRoutes.js` contains no route to query the table, and `Frontend` has no Audit Log page.
- **Impact:** System administrators and security officers cannot audit user activity, investigate security incidents, or produce compliance logs without direct database access.

### HIGH-02: [CONFIRMED] Absence of Administrative Employee Profile Editing
- **Severity:** HIGH
- **Category:** Employee Administration
- **Evidence:** `adminController.js` includes `getEmployeeById` but provides no `updateEmployee` handler. `AdminEmployeeDetails.jsx` is strictly read-only.
- **Impact:** Changes to employee personal details, phone numbers, residential addresses, designations, departments, or bank account details cannot be managed through the application.

### HIGH-03: [CONFIRMED] Complete Absence of Cross-Module Operational Data Exports
- **Severity:** HIGH
- **Category:** Reporting & Business Intelligence
- **Evidence:** No endpoints or UI buttons exist to export attendance rosters, leave histories, PF passbooks, or payroll registers to CSV or Excel format.
- **Impact:** HR and Finance teams are unable to extract operational records for accounting, statutory compliance, or executive management reporting.

### HIGH-04: [CONFIRMED] Memory-Bound Single-Node Rate Limiting
- **Severity:** HIGH
- **Category:** Scalability & Security
- **Evidence:** `rateLimiter.js` utilizes standard in-memory maps.
- **Impact:** If the portal is deployed across multiple load-balanced Node.js instances or container replicas, rate limit quotas will not be shared across nodes, weakening brute-force protection.

---

## 22. Medium Priority Findings

### MED-01: [CONFIRMED] Circular Foreign Key Pattern Between `users` and `employees`
- **Severity:** MEDIUM
- **Category:** Database Design
- **Evidence:** Both `users.employee_id` and `employees.user_id` are cross-referenced nullable foreign keys.
- **Impact:** Introduces coupling during insertion. Requires careful two-phase transactional commits to prevent orphan records.

### MED-02: [CONFIRMED] Lack of In-App Notification Bell & Alert Drawer
- **Severity:** MEDIUM
- **Category:** User Experience
- **Evidence:** System notifications rely on the Announcements module. Real-time alerts for leave approvals, clearance requests, or payslip releases do not exist.
- **Impact:** Users must manually check individual pages to discover status changes.

### MED-03: [CONFIRMED] Unbounded Record Queries in Admin Employee and Attendance Views
- **Severity:** MEDIUM
- **Category:** Scalability & Performance
- **Evidence:** `GET /api/admin/employees` and `GET /api/attendance/admin/monthly` execute queries without `LIMIT` and `OFFSET` clauses.
- **Impact:** Response times and DOM rendering will degrade as headcount scales beyond a few hundred employees.

### MED-04: [CONFIRMED] Synchronous PDF Generation in Primary Event Loop
- **Severity:** MEDIUM
- **Category:** Backend Performance
- **Evidence:** PDFKit streams documents directly inside the HTTP request lifecycle.
- **Impact:** Batch generation during monthly payroll processing may tie up CPU resources and temporarily increase request latency for concurrent users.

### MED-05: [CONFIRMED] Absence of Automated Document Expiry Tracking
- **Severity:** MEDIUM
- **Category:** Document Compliance
- **Evidence:** `documents` table lacks expiration date metadata and automated renewal reminders.
- **Impact:** Compliance credentials, contracts, and certifications cannot be tracked for expiration.

### MED-06: [CONFIRMED] Static Leave Allocation Model Without Periodic Accrual Engine
- **Severity:** MEDIUM
- **Category:** Leave Business Logic
- **Evidence:** `leave_balances` contains static quotas; no scheduled cron job exists for monthly or yearly quota roll-overs.
- **Impact:** Annual leave balance resets or monthly accruals must be executed manually.

---

## 23. Low Priority Improvements

### LOW-01: [CONFIRMED] Dead Mock Data File `payrollMockData.js`
- **Severity:** LOW
- **Category:** Code Hygiene
- **Evidence:** `Frontend/src/pages/Admin/Payroll/payrollMockData.js` exists in the repository but is unused.
- **Impact:** Harmless, but clutters the frontend codebase.

### LOW-02: [CONFIRMED] Hardcoded Department Options in Frontend Forms
- **Severity:** LOW
- **Category:** Flexibility
- **Evidence:** Departments (`IT`, `HR`, `Finance`, `Operations`) are hardcoded in UI dropdowns rather than loaded from an organizational department table.
- **Impact:** Adding or renaming departments requires code modifications.

### LOW-03: [CONFIRMED] Lack of Rich-Text WYSIWYG Editor for Announcements
- **Severity:** LOW
- **Category:** Content Management
- **Evidence:** `announcements.content` is rendered as plain text.
- **Impact:** Announcements cannot include formatted lists, links, or rich typography.

### LOW-04: [CONFIRMED] Absence of Bulk Document Archival Download (ZIP)
- **Severity:** LOW
- **Category:** Administrative Convenience
- **Evidence:** Admin must download employee documents individually.
- **Impact:** Increases administrative effort during compliance audits.

### LOW-05: [CONFIRMED] Lack of User Interface Theme Customization (Dark Mode)
- **Severity:** LOW
- **Category:** User Interface
- **Evidence:** CSS is strictly light-mode styled.
- **Impact:** Purely visual preference.

---

## 24. Top 5 Phase 21 Candidates

### Candidate 1: Employee Onboarding, Creation & Profile Administration
- **Feature Name:** Full Employee Onboarding & Lifecycle Profile Administration
- **Business Value:** **CRITICAL (Highest)**. Closes the fundamental gap in the employee lifecycle by enabling admins to hire, onboard, configure, and maintain employees directly through the portal.
- **Why Needed:** Eliminates the dependency on direct database manipulation or seed scripts for creating employees, provisioning login accounts, and initializing compensation structures.
- **Current Gap:** No UI or API exists to create employees, assign initial leave quotas, configure salary profiles, or edit employee details.
- **Modules Affected:** Admin Employees, Employee Profiles, Authentication, Leave Balances, Payroll Profiles, Audit Logging.
- **Database Impact:** LOW (Zero schema changes needed; existing tables already support all required fields).
- **Backend Impact:** MEDIUM (New transactional onboarding endpoint `POST /api/admin/employees`, profile update `PUT /api/admin/employees/:id`, status toggle `PATCH ...`).
- **Frontend Impact:** MEDIUM (New "Add Employee" modal/wizard on `AdminEmployees`, edit capabilities on `AdminEmployeeDetails`).
- **Security Impact:** POSITIVE (Strict input validation, role checks, automated passwordless credential provisioning, audit trail).
- **Complexity:** MEDIUM
- **Risk:** LOW
- **Recommended Priority:** **RANK 1 (RECOMMENDED)**

---

### Candidate 2: Audit Log Viewer, Compliance Management & Event Explorer
- **Feature Name:** Compliance Audit Log Viewer & Security Event Explorer
- **Business Value:** **HIGH**. Provides complete security observability and regulatory compliance tracking.
- **Why Needed:** The portal actively records critical actions across 219+ audit records, but offers no mechanism for administrators to inspect them.
- **Current Gap:** Zero API endpoints or UI views exist to search, filter, or review `audit_logs`.
- **Modules Affected:** Admin Portal, Audit Service, Security Middleware.
- **Database Impact:** LOW (Add read indexes on `action`, `created_at`).
- **Backend Impact:** LOW (Add paginated endpoint `GET /api/admin/audit-logs` with date, user, and module filtering).
- **Frontend Impact:** MEDIUM (New dedicated Admin Audit Log screen with search, severity badges, and JSON metadata viewer).
- **Security Impact:** HIGH (Enhances monitoring, incident response, and compliance).
- **Complexity:** LOW
- **Risk:** LOW
- **Recommended Priority:** **RANK 2**

---

### Candidate 3: Enterprise Reporting Engine & Multi-Format Data Exports
- **Feature Name:** Cross-Module Operational Reporting & Export Engine (CSV/Excel)
- **Business Value:** **HIGH**. Empowers HR, payroll managers, and executives to extract structured business intelligence.
- **Why Needed:** HR and Finance cannot currently export attendance timesheets, leave utilization registers, PF passbooks, or historical payroll data.
- **Current Gap:** No data export capability exists outside the Phase 19 payroll Excel template.
- **Modules Affected:** Admin Attendance, Leaves, Payroll, PF, Employees.
- **Database Impact:** NONE (Read-only analytical queries).
- **Backend Impact:** MEDIUM (Add export endpoints using ExcelJS/CSV streams).
- **Frontend Impact:** LOW (Add export triggers and date-range selection modals on admin pages).
- **Security Impact:** MEDIUM (Requires strict Super Admin authorization to prevent unauthorized bulk data exfiltration).
- **Complexity:** MEDIUM
- **Risk:** LOW
- **Recommended Priority:** **RANK 3**

---

### Candidate 4: Document Lifecycle Management, Expiry Tracking & Bulk Archival
- **Feature Name:** Document Compliance Lifecycle, Expiration Tracking & Bulk Archival
- **Business Value:** **MEDIUM**. Automates credential compliance and simplifies audit preparations.
- **Why Needed:** The organization cannot track document validity dates (visas, contracts, certifications) or download consolidated employee document archives.
- **Current Gap:** No expiry metadata, no automated expiration alerts, no bulk ZIP download.
- **Modules Affected:** Admin Documents, Employee Documents, Document Storage.
- **Database Impact:** LOW (Add `expiry_date` column and status to `documents` table).
- **Backend Impact:** MEDIUM (Archival ZIP streaming service using archiver, expiration query filters).
- **Frontend Impact:** MEDIUM (Expiration date inputs, document expiry indicators, bulk download buttons).
- **Security Impact:** LOW (Maintains existing private storage isolation).
- **Complexity:** MEDIUM
- **Risk:** LOW
- **Recommended Priority:** **RANK 4**

---

### Candidate 5: Configurable Leave Policy Engine, Automatic Accrual & Holiday Calendar
- **Feature Name:** Configurable Leave Policy Engine, Accrual Automation & Company Holiday Calendar
- **Business Value:** **MEDIUM**. Eliminates manual leave balance management and improves attendance accuracy.
- **Why Needed:** Leave balances currently require static manual seeding, and holidays must be punched manually on the attendance roster.
- **Current Gap:** No organizational holiday calendar table, no automated monthly leave accrual engine.
- **Modules Affected:** Admin Leaves, Admin Attendance, Employee Dashboard.
- **Database Impact:** MEDIUM (New `holidays` table, leave policy configuration table).
- **Backend Impact:** MEDIUM (Scheduled cron jobs for monthly leave credits, holiday auto-skip in attendance).
- **Frontend Impact:** MEDIUM (Admin holiday management calendar, employee holiday view).
- **Security Impact:** LOW.
- **Complexity:** MEDIUM-HIGH
- **Risk:** MEDIUM
- **Recommended Priority:** **RANK 5**

---

## 25. Recommended Phase 21

### **PHASE 21 SELECTION:**
# **Employee Onboarding, Creation & Profile Administration**

---

## 26. Why This Should Be Phase 21

1. **Closes the Greatest Lifecycle Disconnect:**
   Following the completion of Phase 20 (Offboarding, Clearance, and Settlement), the portal has an extraordinary exit workflow, yet completely lacks an entry workflow. Operating a portal that can offboard an employee but cannot onboard one is logically inverted. Phase 21 establishes symmetry across the employee lifecycle.
2. **Eliminates Critical Operational Dependency on Direct SQL:**
   Currently, adding any employee requires direct developer intervention to execute SQL scripts or database seeders. This is unsustainable for production operations and introduces severe security and data integrity hazards.
3. **High Business & Administrative Value:**
   Empowers HR and System Administrators to hire, configure, and maintain employee accounts independently from day one.
4. **Zero Destructive Database Alterations:**
   The existing database tables (`employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`) already contain all necessary columns. Implementation requires zero disruptive schema migrations.
5. **Completely Safe & Contained:**
   Building the onboarding and editing endpoints utilizes existing patterns and does not destabilize existing attendance, leave, payroll, or offboarding logic.

---

## 27. Proposed Phase 21 Scope

Phase 21 will deliver a comprehensive, end-to-end Employee Onboarding and Profile Administration system:
- **Interactive Admin Onboarding Wizard:** An intuitive, validated modal/interface on the Admin Employees page allowing administrators to onboard new staff.
- **Atomic Backend Onboarding Service:** A robust PostgreSQL transaction that synchronously provisions the employee profile, user authentication record, default leave balances, initial compensation structure, and PF account.
- **Administrative Profile Management:** An intuitive editor enabling administrators to update employee personal information, job designations, departments, reporting managers, and banking details.
- **Account Status Control:** Administrative capability to independently toggle employee accounts between `ACTIVE`, `INACTIVE`, and `SUSPENDED` with immediate token revocation.
- **Auditable Lifecycle Events:** Full audit trail logging for all employee creation, profile updates, and status transitions.

---

## 28. Features INCLUDED in Phase 21

- **Interactive Admin Onboarding UI:**
  - Multi-tab or multi-step form covering:
    1. Personal Details (Full Name, Personal Email, Phone Number, Date of Birth, Gender, Address).
    2. Corporate / Job Details (Employee ID, Official Email, Department, Designation, Joining Date, Employment Type, Reporting Manager).
    3. Banking & Statutory Details (Bank Account Number, IFSC Code, PAN Number, UAN Number).
    4. Initial Compensation Setup (Basic Salary, HRA, Special Allowance, PF deduction applicability).
- **Transactional Backend Provisioning:**
  - Endpoint `POST /api/admin/employees`.
  - Atomically creates records across 5 tables in a single transaction:
    - Insert into `employees`
    - Insert into `users` (assigning `EMPLOYEE` role and linking credentials)
    - Cross-link `employees.user_id` and `users.employee_id`
    - Insert into `leave_balances` (initial standard quota: 12 PL, 10 Sick, 0 UPL)
    - Insert into `payroll_profiles` (salary breakdown)
    - Insert into `pf_details` (UAN and zero initial balance)
    - Commit audit log entry `EMPLOYEE_ONBOARDED`
  - Automatic rollback on any constraint violation (duplicate ID, duplicate email, invalid data).
- **Admin Employee Profile Editing:**
  - Endpoint `PUT /api/admin/employees/:employeeId`.
  - Edit employee contact details, department, designation, and banking information.
  - Audit log entry `EMPLOYEE_PROFILE_UPDATED`.
- **Administrative Account Status Management:**
  - Endpoint `PATCH /api/admin/employees/:employeeId/status`.
  - Direct status modification (`ACTIVE`, `INACTIVE`, `SUSPENDED`).
  - Immediate session invalidation via `authMiddleware` checks.
  - Audit log entry `EMPLOYEE_STATUS_MODIFIED`.
- **Real-Time Client-Side & Server-Side Validation:**
  - Strict pattern matching on Employee ID (`GP-\d+` or alphanumeric), Email, Phone (10-digit Indian), PAN (format `[A-Z]{5}[0-9]{4}[A-Z]{1}`), and IFSC code.

---

## 29. Features EXCLUDED from Phase 21

- **Bulk Excel Employee Import:** Deferred to a future phase. Phase 21 focuses strictly on single-employee interactive onboarding.
- **Biometric Hardware Integration:** Out of scope.
- **External Background Verification (BGV) APIs:** Out of scope.
- **Public Candidate Recruitment / Job Portal:** Out of scope.
- **Automated Monthly Leave Accrual Engine:** Deferred to Candidate 5.

---

## 30. Expected Database Changes

- **Schema Modifications:** **ZERO NEW TABLES REQUIRED**.
- **Table Structure:** Existing tables (`employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`) already feature all necessary fields.
- **Index Additions (Optional / Non-destructive):**
  - Add index on `employees.created_at` for clean sorting.
  - Add index on `employees.department` for faster filtering.

---

## 31. Expected Backend Changes

- **Routes (`Backend/routes/adminRoutes.js`):**
  - Add `POST /api/admin/employees` (Onboard employee).
  - Add `PUT /api/admin/employees/:employeeId` (Update employee profile).
  - Add `PATCH /api/admin/employees/:employeeId/status` (Update user status).
- **Controllers (`Backend/controllers/adminController.js`):**
  - Add `onboardEmployee` handler.
  - Add `updateEmployeeProfile` handler.
  - Add `updateEmployeeStatus` handler.
- **Services (`Backend/services/employeeService.js`):**
  - Encapsulate `onboardEmployeeTransaction` utilizing PostgreSQL `BEGIN ... COMMIT / ROLLBACK`.
  - Validate uniqueness of `employee_id`, official `email`, and `pan_number`.
- **Validation Middleware (`Backend/middleware/validationMiddleware.js`):**
  - Add strict express-validator schemas for employee onboarding and update payloads.

---

## 32. Expected Frontend Changes

- **Admin Employees Page (`Frontend/src/pages/Admin/Employees/AdminEmployees.jsx`):**
  - Add prominent "Onboard Employee" button in page header.
  - Embed `OnboardEmployeeModal` with tabbed form sections and field validation.
- **New Component (`Frontend/src/components/Admin/OnboardEmployeeModal.jsx`):**
  - Responsive multi-step modal with real-time field error messaging.
- **Admin Employee Details Page (`Frontend/src/pages/Admin/Employees/AdminEmployeeDetails.jsx`):**
  - Add "Edit Profile" action button triggering editable mode or modal.
  - Add "Account Status" dropdown (Active, Inactive, Suspended) with confirmation modal.
- **Service Client (`Frontend/src/services/adminService.js`):**
  - Add `onboardEmployee(data)`, `updateEmployee(id, data)`, `updateEmployeeStatus(id, status)` API calls.

---

## 33. Expected Security Changes

- **Role Authorization:** Strictly restrict onboarding and status editing endpoints to `ADMIN` and `SUPER_ADMIN` roles.
- **Atomic Integrity:** Mandatory transactional execution ensuring no orphan `users` or `employees` exist if an error occurs.
- **Input Sanitization:** Deep trim and XSS sanitization on all string inputs.
- **Deactivation Enforcement:** Immediate token rejection upon status change to `INACTIVE` or `SUSPENDED` verified by `authMiddleware`.
- **Audit Logging:** Every employee creation, edit, and status toggle logged to `audit_logs` with admin `user_id` and request IP.

---

## 34. Expected Tests

A dedicated test suite `Backend/test_phase21_onboarding.js` should be created to verify:
1. **Successful Employee Onboarding:** Full creation of employee, user account, leave balances, payroll profile, and PF details.
2. **Duplicate Employee ID Rejection:** Expect 400 Bad Request when attempting to onboard an existing ID.
3. **Duplicate Email Rejection:** Expect 400 Bad Request when attempting to onboard an existing email.
4. **Transactional Rollback Verification:** Intentional error during profile creation verifies complete rollback with 0 orphan rows.
5. **RBAC Guard Tests:** `EMPLOYEE` role attempting to call `POST /api/admin/employees` receives `403 Forbidden`.
6. **Profile Update Tests:** Verified modification of contact and job details.
7. **Status Modification & Immediate Deactivation:** Status set to `SUSPENDED` verifies that subsequent authenticated API calls return `403 Account Inactive`.
8. **Audit Trail Verification:** Ensure audit log records are accurately written for all events.

---

## 35. Risks & Mitigations

| Identified Risk | Severity | Mitigation Strategy |
| :--- | :--- | :--- |
| **Circular Foreign Key Deadlock** | MEDIUM | Execute insertion strictly in sequence inside transaction: 1) Insert employee with null user_id, 2) Insert user referencing employee_id, 3) Update employee with user_id. |
| **Payload Validation Errors** | LOW | Implement dual client-side and server-side express-validator checks before executing database queries. |
| **Orphan Data on Partial Failure** | HIGH | Wrap all 5 table operations inside a single atomic PostgreSQL transaction (`BEGIN ... COMMIT / ROLLBACK`). |
| **Duplicate Credential Collisions** | MEDIUM | Enforce unique indexes on `users.email` and `employees.employee_id`. |

---

## 36. Dependencies

- Relies on active PostgreSQL tables: `employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`, `audit_logs`.
- Relies on existing backend utilities: `config/db.js`, `middleware/authMiddleware.js`, `services/auditService.js`.
- Relies on existing frontend components: `Modal.jsx`, `Input.jsx`, `Button.jsx`, `Alert.jsx`, `adminService.js`.
- **Zero third-party package dependencies required.**

---

## 37. Implementation Readiness Checklist

- [x] Complete codebase and database inventory finished: **YES**
- [x] All 16 database tables inspected and documented: **YES**
- [x] All 85 API endpoints inventoried and mapped: **YES**
- [x] All 24 frontend routes inspected: **YES**
- [x] Existing regression test suites passing (279 assertions): **YES**
- [x] Target database tables verified ready for onboarding: **YES**
- [x] Zero breaking changes or schema drops required: **YES**
- [x] Zero code or database modifications made during audit: **YES**

---

## 38. Final Recommendation

Following this comprehensive Phase 21 discovery and gap audit, it is unequivocally recommended that **Phase 21 be dedicated to: Employee Onboarding, Creation & Profile Administration**.

Phase 20 brought the employee offboarding, clearance, and F&F settlement lifecycle to production excellence. Implementing Employee Onboarding in Phase 21 will complete the organizational lifecycle loop, granting GaintPro Software Technologies full administrative sovereignty, eliminating manual database seeding, and establishing a complete, enterprise-grade Employee Management Portal.
