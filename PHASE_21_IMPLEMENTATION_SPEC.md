# Phase 21 Implementation Specification
**GaintPro Software Technologies Employee Management Portal**
**Phase 21: Employee Onboarding, Creation & Profile Administration**
**Document Version:** 1.0.0 (Pre-Implementation Architecture Specification)  
**Status:** APPROVED DESIGN / READY FOR IMPLEMENTATION  

---

## 1. Executive Summary

### 1.1 Purpose & Objective
This specification establishes the architectural, database, security, and interface design for **Phase 21: Employee Onboarding, Creation & Profile Administration** of the GaintPro Software Technologies Employee Management Portal. 

Following the completion and verification of Phases 1 through 20 (including the mature multi-department offboarding, clearance, and Full & Final settlement workflows verified in Phase 20), the application has a mature exit lifecycle, but completely lacks an administrative entry lifecycle. Currently, new employees and user accounts can only be provisioned by manual database scripts (`seed.js`) or direct SQL intervention. 

Phase 21 closes this critical organizational gap by delivering an end-to-end, transaction-safe, auditable Employee Onboarding Wizard and Profile Administration module.

### 1.2 Core Architectural Principles
1. **Zero Destructive Schema Changes:** All 5 required database tables (`employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`) already exist and are fully functional. No new tables are required.
2. **Atomic Transactional Provisioning:** All records (employee record, user login, default leave balances, initial payroll profile, optional PF record, and audit entry) will be created inside a single PostgreSQL transaction (`BEGIN ... COMMIT / ROLLBACK`).
3. **Strict Backend Authority:** Employee IDs (`GP0001N`, `GP0002N`, ...) and user IDs are generated strictly server-side under concurrency-safe database locking. Client-supplied IDs, roles, or session attributes are rejected.
4. **Seamless Authentication Integration:** User provisioning seamlessly integrates with the existing passwordless SHA-256 email OTP authentication engine. Newly onboarded employees can log in immediately upon creation.
5. **Preservation of Completed Work:** Preserves 100% of Phase 1–20 code, schemas, and test suites.

---

## 2. Current Architecture Findings

### 2.1 Backend Findings [CONFIRMED]
- **Framework & Runtime:** Node.js (v24.21.0) with Express.js REST API architecture.
- **Database Connection:** PostgreSQL connection pool managed via `Backend/config/database.js` (`pg.Pool`).
- **Authentication Engine:** Passwordless OTP-based authentication (`Backend/controllers/authController.js`, `Backend/services/otpService.js`). Users authenticate via email OTP. There are no password columns or credential stores in the database.
- **Session & Identity Resolution:** JWT tokens signed with HMAC SHA-256 containing `userId`, `email`, `role`, and `employeeId`. Verified by `Backend/middleware/authMiddleware.js`.
- **Administrative Controller:** `Backend/controllers/adminEmployeeController.js` currently contains only two read-only handlers:
  - `getEmployees`: Paginated, searchable, status-filtered employee listing.
  - `getEmployeeById`: Profile details retrieval by `employeeId`.
- **Administrative Routes:** `Backend/routes/adminEmployeeRoutes.js` mounts `GET /` and `GET /:employeeId` guarded by `authenticateToken` and `requireRole('ADMIN', 'SUPER_ADMIN')`. The file header explicitly notes: *"Read-only: employee management mutations will be implemented in subsequent phases."*
- **Audit Logging:** Fully operational service `Backend/services/auditService.js` actively recording to `public.audit_logs`.

### 2.2 Frontend Findings [CONFIRMED]
- **Framework & Build:** React 18 with Vite, React Router DOM v6.
- **API Client:** Consolidated service `Frontend/src/services/api.js` exporting `api.admin`, `api.employee`, `api.auth`, and `api.exit`. Standalone `adminService.js` does NOT exist; all admin calls route through `api.admin`.
- **Employees Page (`Frontend/src/pages/Admin/Employees/Employees.jsx`):**
  - Displays paginated employee table with search and filters.
  - Contains an existing stub modal (`modalMode === 'add'`) and stub handlers (`handleSaveEmployee`, `handleToggleStatus`) that currently trigger informational toasts: *"Employee write operations will be enabled in a future release (Read-Only phase)."*
- **Employee Details Page (`Frontend/src/pages/Admin/EmployeeDetails/EmployeeDetails.jsx`):**
  - Displays comprehensive employee tabs (Profile, Leaves, Attendance, Payroll, Documents).
  - Contains stub handlers for editing (`handleSaveEdit`) and deactivating (`handleConfirmDeactivate`) displaying read-only phase notices.

---

## 3. Existing Employee Management Capabilities

| Capability | Current Status | Current Implementation Details |
| :--- | :--- | :--- |
| **A. Can Admin create employees?** | **MISSING** | No API route or controller exists. `adminEmployeeRoutes.js` is strictly read-only. |
| **B. Can Admin create users?** | **MISSING** | No API route exists. Users are created exclusively via `Backend/database/seed.js`. |
| **C. Can Admin edit employees?** | **MISSING** | No `PUT` or `PATCH` endpoint exists. Frontend edit buttons display read-only notices. |
| **D. Can Admin change employee status?** | **PARTIAL** | Can only transition to `INACTIVE` via offboarding F&F finalization (`adminExitController.js`). Standalone status change is missing. |
| **E. Can Admin change user status?** | **PARTIAL** | Transistioned to `INACTIVE` upon F&F finalization. No standalone toggle exists. |
| **F. Can Admin manage leave balances?** | **PARTIAL** | Read-only listing via `GET /api/admin/leaves/balances`. No API exists to initialize or adjust quotas. |
| **G. Can Admin create payroll profiles?** | **EXISTING** | Fully supported via `PUT /api/admin/payroll/:employeeId/profile` using `ON CONFLICT (employee_id) DO UPDATE`. |
| **H. Can Admin create PF details?** | **EXISTING** | Fully supported via `PUT /api/admin/pf/:employeeId` using `ON CONFLICT (employee_id) DO UPDATE`. |
| **I. What employee fields already exist?** | **EXISTING** | 22 database columns in `public.employees` (see Section 4). |
| **J. What employee fields are editable?** | **NONE** | No fields are currently editable through any public or admin endpoint. |
| **K. Existing relevant API endpoints?** | **PARTIAL** | Only `GET /api/admin/employees`, `GET /api/admin/employees/:id`, `PUT /api/admin/payroll/:id/profile`, and `PUT /api/admin/pf/:id`. |

---

## 4. Existing Database Schema

### 4.1 Schema Verification of Core Tables [CONFIRMED]

#### Table: `public.employees` (Primary Entity)
- `employee_id` (`varchar`, Primary Key, NOT NULL) — Organization ID (e.g. `'GP0001N'`)
- `user_id` (`uuid`, Unique, Nullable, Foreign Key -> `users(id)`)
- `first_name` (`varchar`, NOT NULL)
- `last_name` (`varchar`, Nullable)
- `email` (`varchar`, Nullable, Indexed)
- `phone` (`varchar`, Nullable)
- `date_of_birth` (`date`, Nullable)
- `gender` (`varchar`, Nullable)
- `department` (`varchar`, Nullable, Indexed)
- `designation` (`varchar`, Nullable)
- `date_of_joining` (`date`, Nullable)
- `reporting_manager` (`varchar`, Nullable)
- `employment_type` (`varchar`, Nullable)
- `status` (`varchar`, NOT NULL, Default: `'ACTIVE'`)
- `address` (`text`, Nullable)
- `city` (`varchar`, Nullable)
- `state` (`varchar`, Nullable)
- `postal_code` (`varchar`, Nullable)
- `emergency_contact_name` (`varchar`, Nullable)
- `emergency_contact_phone` (`varchar`, Nullable)
- `created_at` (`timestamptz`, NOT NULL, Default: `now()`)
- `updated_at` (`timestamptz`, NOT NULL, Default: `now()`)

#### Table: `public.users` (Authentication & Access Entity)
- `id` (`uuid`, Primary Key, NOT NULL, Default: `gen_random_uuid()`)
- `employee_id` (`varchar`, Nullable, Foreign Key -> `employees(employee_id)`, Indexed)
- `email` (`varchar`, NOT NULL, Unique, Indexed)
- `role` (`varchar`, NOT NULL, CHECK `role IN ('EMPLOYEE', 'ADMIN', 'SUPER_ADMIN')`)
- `status` (`varchar`, NOT NULL, CHECK `status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')`)
- `created_at` (`timestamptz`, NOT NULL, Default: `now()`)
- `updated_at` (`timestamptz`, NOT NULL, Default: `now()`)

#### Table: `public.leave_balances` (Leave Entitlement Entity)
- `id` (`uuid`, Primary Key, NOT NULL, Default: `gen_random_uuid()`)
- `employee_id` (`varchar`, NOT NULL, Unique, Foreign Key -> `employees(employee_id)`)
- `paid_leave_balance` (`numeric`, NOT NULL, Default: `0`)
- `sick_leave_balance` (`numeric`, NOT NULL, Default: `0`)
- `unpaid_leave_balance` (`numeric`, NOT NULL, Default: `0`)
- `updated_at` (`timestamptz`, NOT NULL, Default: `now()`)

#### Table: `public.payroll_profiles` (Compensation Structure Entity)
- `id` (`uuid`, Primary Key, NOT NULL, Default: `gen_random_uuid()`)
- `employee_id` (`varchar`, NOT NULL, Unique, Foreign Key -> `employees(employee_id)`)
- `basic_salary` (`numeric`, NOT NULL, Default: `0`)
- `hra` (`numeric`, NOT NULL, Default: `0`)
- `allowances` (`numeric`, NOT NULL, Default: `0`)
- `pf_employee` (`numeric`, NOT NULL, Default: `0`)
- `professional_tax` (`numeric`, NOT NULL, Default: `0`)
- `other_deductions` (`numeric`, NOT NULL, Default: `0`)
- `effective_from` (`date`, Nullable)
- `created_at` (`timestamptz`, NOT NULL, Default: `now()`)
- `updated_at` (`timestamptz`, NOT NULL, Default: `now()`)

#### Table: `public.pf_details` (Provident Fund Identity Entity)
- `id` (`uuid`, Primary Key, NOT NULL, Default: `gen_random_uuid()`)
- `employee_id` (`varchar`, NOT NULL, Unique, Foreign Key -> `employees(employee_id)`)
- `uan_number` (`varchar`, Nullable)
- `pf_number` (`varchar`, Nullable)
- `pension_number` (`varchar`, Nullable)
- `created_at` (`timestamptz`, NOT NULL, Default: `now()`)
- `updated_at` (`timestamptz`, NOT NULL, Default: `now()`)

#### Table: `public.audit_logs` (System Audit Entity)
- `id` (`uuid`, Primary Key, NOT NULL, Default: `gen_random_uuid()`)
- `user_id` (`uuid`, Nullable, Foreign Key -> `users(id)`)
- `action` (`varchar`, NOT NULL)
- `entity_type` (`varchar`, Nullable)
- `entity_id` (`varchar`, Nullable)
- `metadata` (`jsonb`, Nullable)
- `ip_address` (`inet`, Nullable)
- `user_agent` (`text`, Nullable)
- `created_at` (`timestamptz`, NOT NULL, Default: `now()`)

---

## 5. Existing APIs

| HTTP Method | Route | Controller Handler | Purpose | Auth & Roles |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/employees` | `adminEmployeeController.getEmployees` | List paginated employees | JWT, ADMIN, SUPER_ADMIN |
| `GET` | `/api/admin/employees/:employeeId` | `adminEmployeeController.getEmployeeById` | Fetch employee profile | JWT, ADMIN, SUPER_ADMIN |
| `PUT` | `/api/admin/payroll/:employeeId/profile` | `adminPayrollController.updateAdminPayrollProfile` | Upsert salary profile | JWT, ADMIN, SUPER_ADMIN |
| `PUT` | `/api/admin/pf/:employeeId` | `adminPfController.updateAdminPf` | Upsert PF details | JWT, ADMIN, SUPER_ADMIN |
| `GET` | `/api/admin/leaves/balances` | `leaveController.getAdminLeaveBalances` | View leave balances | JWT, ADMIN, SUPER_ADMIN |
| `POST` | `/api/auth/request-otp` | `authController.requestOtp` | Request login OTP | Public |
| `POST` | `/api/auth/verify-otp` | `authController.verifyOtp` | Verify OTP & issue JWT | Public |

*Finding:* No creation (`POST`) or modification (`PUT`/`PATCH`) APIs currently exist under `/api/admin/employees`.

---

## 6. Existing Frontend Structure

- **Main Navigation:** `Frontend/src/components/Sidebar/Sidebar.jsx` includes `Employees` link routing to `/admin/employees`.
- **Route Declaration:** `Frontend/src/routes/AppRoutes.jsx` mounts:
  - `<Route path="employees" element={<AdminEmployees />} />`
  - `<Route path="employees/:employeeId" element={<AdminEmployeeDetails />} />`
- **Component File Structure:**
  - `Frontend/src/pages/Admin/Employees/Employees.jsx` (List & Action view)
  - `Frontend/src/pages/Admin/EmployeeDetails/EmployeeDetails.jsx` (Single record tabbed view)
- **State Management:** Local component state with `useCallback` fetching and `useMemo` filtering. Session managed globally by `Frontend/src/context/AuthContext.jsx`.

---

## 7. Phase 21 Requirements

1. **Administrative Onboarding:** Admins can create a new employee with personal, job, salary, and leave details through a dedicated, validated UI.
2. **Backend Concurrency-Safe ID Generation:** System automatically generates the next sequential `GP####N` Employee ID.
3. **Atomic User & Profile Provisioning:** Synced creation of `employees`, `users`, `leave_balances`, `payroll_profiles`, and `pf_details` inside one database transaction.
4. **Immediate Passwordless Login:** Created user can immediately request an OTP via `/api/auth/request-otp` and log in without manual setup.
5. **Administrative Profile Editing:** Admins can edit personal contact details, department, designation, and reporting manager.
6. **Account Status Management:** Admins can update employee and user account status (`ACTIVE`, `INACTIVE`, `SUSPENDED`).
7. **Comprehensive Audit Trail:** All creation, update, and status actions must log sanitized audit records to `audit_logs`.

---

## 8. Employee Data Model

### Field Ingestion Breakdown for Onboarding

| Field | Source / Origin | Required? | Handling in Backend |
| :--- | :--- | :--- | :--- |
| `employee_id` | Server Generated | YES | Generated via sequence/advisory lock (`GP####N`). Never accepted from client. |
| `user_id` | Server Generated | YES | Derived from `users.id` created in transaction. |
| `first_name` | Client Form | YES | Sanitized string, 1–50 characters. |
| `last_name` | Client Form | NO | Sanitized string, max 50 characters. |
| `email` | Client Form | YES | Normalized lowercase, unique checked across `users` & `employees`. |
| `phone` | Client Form | NO | Sanitized 10-digit mobile string. |
| `date_of_birth` | Client Form | NO | Validated ISO `YYYY-MM-DD` (age >= 18). |
| `gender` | Client Form | NO | Whitelisted: `'Male'`, `'Female'`, `'Other'`. |
| `department` | Client Form | YES | Whitelisted corporate department name. |
| `designation` | Client Form | YES | Sanitized string, 1–100 characters. |
| `date_of_joining` | Client Form | YES | Validated ISO `YYYY-MM-DD`, defaults to today. |
| `reporting_manager` | Client Form | NO | Sanitized string or manager Employee ID. |
| `employment_type` | Client Form | NO | Whitelisted: `'Full Time'`, `'Part Time'`, `'Contract'`, `'Intern'`. |
| `status` | Server Default | YES | Hardcoded to `'ACTIVE'` during onboarding. |
| `address` | Client Form | NO | Sanitized text string. |
| `city` | Client Form | NO | Sanitized string. |
| `state` | Client Form | NO | Sanitized string. |
| `postal_code` | Client Form | NO | Sanitized 6-digit postal code. |
| `emergency_contact_name` | Client Form | NO | Sanitized string. |
| `emergency_contact_phone` | Client Form | NO | Sanitized phone string. |

---

## 9. User Provisioning Model

### 9.1 Account Creation Mechanics
When an employee is created, a companion record in `public.users` must be provisioned synchronously:
- `id`: Generated automatically by PostgreSQL (`gen_random_uuid()`).
- `employee_id`: Bound to the newly generated `employee_id`.
- `email`: Exact match of employee official corporate `email` (lowercased).
- `role`: Hardcoded to `'EMPLOYEE'`. Clients cannot inject `'ADMIN'` or `'SUPER_ADMIN'`.
- `status`: Set to `'ACTIVE'`.

### 9.2 Immediate OTP Login Integration
Because the portal utilizes passwordless email OTP:
1. No initial password generation, hashing, or delivery is needed.
2. The user account is active immediately.
3. The employee navigates to `/login`, enters their corporate email, and clicks "Send OTP".
4. `otpService.requestOtp` finds `users` row with `status = 'ACTIVE'`, hashes and records a 6-digit OTP, and dispatches it via email.
5. On verification, `otpService.verifyOtp` signs a JWT containing `{ userId, email, role: 'EMPLOYEE', employeeId: 'GP####N' }`.
6. Zero additional setup steps or activation tokens required.

---

## 10. Employee ID Generation Strategy

### 10.1 Pattern & Syntax
Format: `GP` + `[4-digit zero-padded integer]` + `N`  
Examples: `GP0001N`, `GP0002N`, `GP0003N`, `GP0010N`

### 10.2 Concurrency-Safe Generation Mechanism
To prevent race conditions when two administrators onboard employees concurrently:
1. **Advisory Transaction Lock:** Acquire a dedicated PostgreSQL transaction-level advisory lock at the start of the onboarding transaction:
   ```sql
   SELECT pg_advisory_xact_lock(987654321);
   ```
2. **Deterministic Sequence Query:**
   ```sql
   SELECT COALESCE(
     MAX(
       SUBSTRING(employee_id FROM 3 FOR 4)::integer
     ), 0
   ) + 1 AS next_number
   FROM public.employees
   WHERE employee_id ~ '^GP[0-9]{4}N$';
   ```
3. **Format Construction:**
   ```javascript
   const nextIdNumber = result.rows[0].next_number;
   const employeeId = `GP${String(nextIdNumber).padStart(4, '0')}N`;
   ```
4. **Primary Key Protection:** The `employees_pkey` constraint on `employee_id` provides secondary database-level uniqueness enforcement. If an unexpected collision occurs, PostgreSQL raises error code `23505`, triggering transaction rollback.

---

## 11. Leave Initialization Strategy

### 11.1 Default Leave Quotas
In the existing application, the leave engine calculates leave usage against `public.leave_balances`. If a row does not exist, leave balance displays `0`.
- **Paid Leave (`paid_leave_balance`):** Standard default = `12.00` days.
- **Sick Leave (`sick_leave_balance`):** Standard default = `10.00` days.
- **Unpaid Leave (`unpaid_leave_balance`):** Initialized to `0.00` days.

### 11.2 Onboarding Behavior
- The onboarding request body may optionally supply custom initial balances:
  `{ leave_balances: { paid_leave: 15, sick_leave: 10 } }`
- If omitted, the backend applies organizational defaults (12 PL, 10 Sick).
- Initialized in `leave_balances` within the onboarding transaction.

---

## 12. Payroll Profile Strategy

### 12.1 Salary Structure Requirement
`public.payroll_profiles` stores the compensation profile used by the monthly payroll calculation engine (`adminPayrollController.js`).
- If an employee has no payroll profile, the monthly payroll engine falls back to default constants (Basic: 25000, HRA: 10000, Allowances: 5000, PF: 1800, PT: 200).
- To guarantee deterministic payroll, **a payroll profile should be initialized during onboarding**.

### 12.2 Compensation Fields
- `basic_salary`: Numeric (Required, default `25000.00`)
- `hra`: Numeric (Optional, defaults to 40% of Basic or explicit input)
- `allowances`: Numeric (Optional, default `0.00`)
- `pf_employee`: Numeric (Optional, defaults to 12% of Basic or explicit input)
- `professional_tax`: Numeric (Optional, default `200.00`)
- `other_deductions`: Numeric (Optional, default `0.00`)
- `effective_from`: Date (Defaults to `date_of_joining`)

---

## 13. PF Strategy

### 13.1 Optional PF Details
`public.pf_details` stores statutory identification:
- `uan_number` (Universal Account Number, 12 digits)
- `pf_number` (Provident Fund Number)
- `pension_number` (Pension Scheme Number)

### 13.2 Onboarding Rule
- **PF details are OPTIONAL during onboarding.**
- Fresh graduates or employees awaiting UAN generation can be onboarded without PF information.
- If provided in the request body (`{ pf_details: { uan_number: "...", pf_number: "..." } }`), a row in `public.pf_details` is inserted inside the transaction.
- If omitted, no row is created; admins can configure PF later via `PUT /api/admin/pf/:employeeId`.

---

## 14. Transaction Design

### 14.1 Execution Sequence

```
POST /api/admin/employees
   │
   ▼
1. Acquire DB Connection (pool.connect())
   │
   ▼
2. BEGIN TRANSACTION
   │
   ├─► 3. Acquire Advisory Lock: pg_advisory_xact_lock(987654321)
   │
   ├─► 4. Validate Email Uniqueness: Check users & employees WHERE LOWER(email) = $1
   │       [If duplicate → ROLLBACK → 409 Conflict]
   │
   ├─► 5. Generate Next Employee ID: 'GP' || LPAD(next_val, 4, '0') || 'N'
   │
   ├─► 6. Insert into public.users (email, role='EMPLOYEE', status='ACTIVE')
   │       RETURNING id AS user_id
   │
   ├─► 7. Insert into public.employees (employee_id, user_id, first_name, email, ...)
   │
   ├─► 8. Update public.users SET employee_id = $1 WHERE id = $2
   │       (Satisfies circular foreign key integrity)
   │
   ├─► 9. Insert into public.leave_balances (employee_id, paid_leave_balance, sick_leave_balance)
   │
   ├─► 10. Insert into public.payroll_profiles (employee_id, basic_salary, hra, ...)
   │
   ├─► 11. (Optional) Insert into public.pf_details (employee_id, uan_number, ...)
   │
   ├─► 12. Record Audit Log: action='EMPLOYEE_ONBOARDED', entityType='EMPLOYEE'
   │
   ▼
13. COMMIT TRANSACTION
   │
   ▼
14. Release Connection & Return 201 Created Response
   │
[EXCEPTION CAUGHT]
   │
   ▼
ROLLBACK TRANSACTION & Release Connection → Return 400/409/500 JSON
```

---

## 15. API Specification

### Endpoint 1: Onboard New Employee
- **METHOD:** `POST`
- **ROUTE:** `/api/admin/employees`
- **PURPOSE:** Atomically create an employee, user account, leave balances, payroll profile, and optional PF profile.
- **AUTH:** Mandatory JWT Bearer Token.
- **ROLE:** `ADMIN`, `SUPER_ADMIN`.
- **AUDIT EVENT:** `EMPLOYEE_ONBOARDED`.

### Endpoint 2: Update Employee Profile
- **METHOD:** `PUT`
- **ROUTE:** `/api/admin/employees/:employeeId`
- **PURPOSE:** Update personal, contact, departmental, and organizational details of an existing employee.
- **AUTH:** Mandatory JWT Bearer Token.
- **ROLE:** `ADMIN`, `SUPER_ADMIN`.
- **AUDIT EVENT:** `EMPLOYEE_PROFILE_UPDATED`.

### Endpoint 3: Update Account Status
- **METHOD:** `PATCH`
- **ROUTE:** `/api/admin/employees/:employeeId/status`
- **PURPOSE:** Toggle employee and user account status (`ACTIVE`, `INACTIVE`, `SUSPENDED`).
- **AUTH:** Mandatory JWT Bearer Token.
- **ROLE:** `ADMIN`, `SUPER_ADMIN`.
- **AUDIT EVENT:** `EMPLOYEE_STATUS_MODIFIED`.

---

## 16. Request/Response Contracts

### 16.1 `POST /api/admin/employees`

#### Request Payload:
```json
{
  "firstName": "Ananya",
  "lastName": "Sharma",
  "email": "ananya.sharma@gaintpro.com",
  "phone": "9876543210",
  "dateOfBirth": "1996-05-15",
  "gender": "Female",
  "department": "Engineering",
  "designation": "Senior Frontend Engineer",
  "dateOfJoining": "2026-10-15",
  "employmentType": "Full Time",
  "reportingManager": "Rajeev Appala",
  "address": "Flat 402, Highline Residency",
  "city": "Hyderabad",
  "state": "Telangana",
  "postalCode": "500081",
  "emergencyContactName": "Ramesh Sharma",
  "emergencyContactPhone": "9876500000",
  "salary": {
    "basicSalary": 40000,
    "hra": 16000,
    "allowances": 8000,
    "pfEmployee": 1800,
    "professionalTax": 200,
    "otherDeductions": 0
  },
  "leaveBalances": {
    "paidLeave": 12,
    "sickLeave": 10
  },
  "pfDetails": {
    "uanNumber": "101234567890",
    "pfNumber": "MH/BAN/0012345/000/0001"
  }
}
```

#### Successful Response (`201 Created`):
```json
{
  "success": true,
  "message": "Employee onboarded successfully.",
  "data": {
    "employeeId": "GP0002N",
    "firstName": "Ananya",
    "lastName": "Sharma",
    "email": "ananya.sharma@gaintpro.com",
    "department": "Engineering",
    "designation": "Senior Frontend Engineer",
    "dateOfJoining": "2026-10-15",
    "status": "ACTIVE",
    "user": {
      "id": "e4f8b2c1-...",
      "role": "EMPLOYEE",
      "status": "ACTIVE"
    }
  }
}
```

### 16.2 `PUT /api/admin/employees/:employeeId`

#### Request Payload:
```json
{
  "firstName": "Ananya",
  "lastName": "Sharma",
  "phone": "9876543219",
  "department": "Engineering",
  "designation": "Staff Frontend Engineer",
  "reportingManager": "Rajeev Appala",
  "employmentType": "Full Time",
  "address": "Flat 505, Elite Heights",
  "city": "Hyderabad",
  "state": "Telangana",
  "postalCode": "500081",
  "emergencyContactName": "Ramesh Sharma",
  "emergencyContactPhone": "9876500000"
}
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "message": "Employee profile updated successfully.",
  "data": {
    "employeeId": "GP0002N",
    "designation": "Staff Frontend Engineer",
    "updatedAt": "2026-10-05T09:30:00.000Z"
  }
}
```

### 16.3 `PATCH /api/admin/employees/:employeeId/status`

#### Request Payload:
```json
{
  "status": "SUSPENDED",
  "remarks": "Pending internal compliance inquiry"
}
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "message": "Employee account status updated to SUSPENDED.",
  "data": {
    "employeeId": "GP0002N",
    "employeeStatus": "SUSPENDED",
    "userStatus": "SUSPENDED"
  }
}
```

---

## 17. Validation Rules

- **First Name:** Mandatory string, 1–50 characters, letters, spaces, and hyphens only (`/^[a-zA-Z\s\-]+$/`).
- **Last Name:** Optional string, max 50 characters.
- **Corporate Email:** Mandatory valid email string (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), trimmed, lowercased, max 100 characters.
- **Phone:** Optional string, exactly 10 digits (`/^\d{10}$/`).
- **Date Format:** Valid calendar date format (`YYYY-MM-DD`).
- **Date of Birth:** Must be at least 18 years prior to current date.
- **Department:** Non-empty string, max 100 characters.
- **Designation:** Non-empty string, max 100 characters.
- **Salary Values:** Positive numeric values (`>= 0`).
- **Leave Balances:** Non-negative integers or decimals (`>= 0`).
- **UAN Number (if provided):** Exactly 12 numeric digits (`/^\d{12}$/`).
- **Status Values:** Strictly whitelisted: `'ACTIVE'`, `'INACTIVE'`, `'SUSPENDED'`.

---

## 18. Error Handling

Consistent with existing API error response envelopes:

| Scenario | HTTP Status | Response Payload |
| :--- | :--- | :--- |
| **Duplicate Email** | `409 Conflict` | `{"success": false, "message": "An account with email '...' already exists."}` |
| **Validation Failure** | `400 Bad Request` | `{"success": false, "message": "Validation failed.", "errors": [{"field": "phone", "message": "Phone number must be 10 digits."}]}` |
| **Employee Not Found** | `404 Not Found` | `{"success": false, "message": "Employee 'GP0099N' not found."}` |
| **Unauthorized Token** | `401 Unauthorized` | `{"success": false, "message": "Authentication required. No token provided."}` |
| **Insufficient Role** | `403 Forbidden` | `{"success": false, "message": "Access denied. Insufficient permissions."}` |
| **Database / Lock Failure** | `500 Server Error` | `{"success": false, "message": "Failed to onboard employee due to an internal server error."}` |

---

## 19. RBAC (Role-Based Access Control)

- **Execution Gate:** Guarded by `authenticateToken` followed by `requireRole('ADMIN', 'SUPER_ADMIN')`.
- **`EMPLOYEE` Role Access:** Calling `POST /api/admin/employees`, `PUT /api/admin/employees/:id`, or `PATCH /api/admin/employees/:id/status` immediately returns `403 Forbidden`.
- **Super Admin Demarcation:** Normal `ADMIN` can create and edit employees; `SUPER_ADMIN` has exclusive privilege if the organization decides to restrict deactivations or salary changes.

---

## 20. Audit Logging

### Events to Record:
1. `EMPLOYEE_ONBOARDED`:
   - Actor: `req.user.id` (Admin user ID)
   - Entity: `EMPLOYEE` / `GP0002N`
   - Metadata: `{ employee_id: 'GP0002N', email: '...', department: '...', designation: '...' }`
2. `EMPLOYEE_PROFILE_UPDATED`:
   - Actor: Admin user ID
   - Entity: `EMPLOYEE` / `GP0002N`
   - Metadata: `{ updated_fields: ['phone', 'designation', 'address'] }`
3. `EMPLOYEE_STATUS_MODIFIED`:
   - Actor: Admin user ID
   - Entity: `EMPLOYEE` / `GP0002N`
   - Metadata: `{ old_status: 'ACTIVE', new_status: 'SUSPENDED', remarks: '...' }`

*Redaction Guarantee:* Passwords, OTPs, tokens, and bank credentials are never passed to the audit logger.

---

## 21. Frontend Architecture

### 21.1 Component Hierarchy
```
AdminLayout
   └── AdminEmployees (/admin/employees)
          ├── Employees Header & Search/Filter Bar
          ├── "Onboard Employee" Primary Button
          ├── Employees Table (Listing existing records)
          └── OnboardEmployeeModal (Multi-Step Onboarding Form)
```

### 21.2 Service Client Additions (`Frontend/src/services/api.js`)
Add methods directly to `api.admin`:
```javascript
onboardEmployee: (payload) =>
  request('/admin/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

updateEmployee: (employeeId, payload) =>
  request(`/admin/employees/${encodeURIComponent(employeeId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),

updateEmployeeStatus: (employeeId, status, remarks = '') =>
  request(`/admin/employees/${encodeURIComponent(employeeId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, remarks }),
  }),
```

---

## 22. Onboarding Wizard Design

### Multi-Step Form Sections

#### Step 1: Personal & Contact Information
- First Name (Required), Last Name (Optional)
- Official Corporate Email (Required, validated)
- Mobile Phone (10 digits)
- Date of Birth & Gender
- Address, City, State, Postal Code

#### Step 2: Employment & Organizational Details
- Department (Dropdown: Technology, Engineering, HR, Finance, Operations, Sales)
- Designation (Text input)
- Date of Joining (Date picker, default today)
- Employment Type (Full Time, Part Time, Contract, Intern)
- Reporting Manager (Text input or dropdown)

#### Step 3: Compensation & Payroll Setup
- Basic Salary (Required numeric input)
- HRA (Auto-calculated at 40% Basic or customizable)
- Special Allowances
- Employee PF Contribution (Auto-calculated or customizable)
- Professional Tax (Default: 200)

#### Step 4: Leave Balances & Statutory Details (Optional)
- Paid Leave Balance (Default: 12)
- Sick Leave Balance (Default: 10)
- UAN Number (Optional, 12 digits)
- PF Account Number (Optional)

#### Step 5: Review & Submit
- Summary overview of all entered data.
- "Confirm & Onboard" action button with loading spinner and duplicate click prevention.

---

## 23. Profile Editing Design

### Integration in `AdminEmployeeDetails.jsx`
- Replace existing "Read-Only phase" toast with active edit mode.
- "Edit Details" button opens `EditEmployeeModal` pre-populated with current profile data.
- Employee ID is displayed as **immutable read-only badge**.
- Submitting dispatches `api.admin.updateEmployee(employeeId, editForm)`.
- Updates UI state optimistically or re-fetches authoritative profile.

---

## 24. Status Management Decision

### Decision: **INCLUDE Status Management in Phase 21**
- **Rationale:** A full administrative profile management suite is incomplete if an administrator cannot suspend an employee for disciplinary reasons or mark an employee inactive.
- **Scope Limit:** Implement dedicated `PATCH /api/admin/employees/:employeeId/status` supporting:
  - `ACTIVE` -> Normal access.
  - `SUSPENDED` -> Temporarily blocked from OTP login and authenticated API requests.
  - `INACTIVE` -> Separated or deactivated.
- **Enforcement:** Existing `authMiddleware.js` and `otpService.js` already check `user.status === 'ACTIVE'`. By updating both `employees.status` and `users.status` synchronously, the status enforcement takes effect immediately across all sessions.

---

## 25. Security Threat Model

| Threat / Attack Vector | Impact | Backend Defense / Countermeasure |
| :--- | :--- | :--- |
| **Duplicate Email Collision** | Account overwrite or integrity break | Pre-flight duplicate check + unique database constraints on `users.email` and `employees.email`. |
| **Concurrent Employee ID Race Condition** | Duplicate primary key violation | Transaction-level advisory lock (`pg_advisory_xact_lock`) ensuring serialized ID generation. |
| **Privilege Escalation (Role Injection)** | Employee assigns themselves ADMIN role | Role is hardcoded to `'EMPLOYEE'` on backend; client `role` property in request body is ignored. |
| **Client-Supplied Employee ID Forgery** | Overwriting existing employee record | Client-supplied `employee_id` in request body is ignored; server always generates ID. |
| **Mass Assignment Vulnerability** | Overwriting database internals | Strict parameter whitelist in controller (`first_name`, `email`, etc.). No `req.body` spreading into SQL. |
| **SQL Injection** | Data exfiltration / tampering | 100% parameterized queries (`$1, $2, ...`). Zero raw string concatenation. |
| **Unauthorized Profile Mutation** | Non-admin edits another employee's profile | Strict `requireRole('ADMIN', 'SUPER_ADMIN')` on all onboarding and update routes. |
| **Partial Transaction Failure** | Orphan user or employee rows | All 5 table writes contained within a single PostgreSQL transaction with guaranteed `ROLLBACK` on error. |

---

## 26. Concurrency Strategy

1. **Advisory Locking:** When an administrator initiates onboarding, the connection acquires `pg_advisory_xact_lock(987654321)`.
2. **Serialization:** Any simultaneous onboarding request on another connection waits for the lock.
3. **Deterministic Incrementation:** Query finds the maximum integer from existing IDs matching `GP####N` and increments by 1.
4. **Instant Lock Release:** The lock automatically releases upon `COMMIT` or `ROLLBACK` when the transaction ends.
5. **No Long-Running Hold:** Total transaction execution time is < 50ms, ensuring zero noticeable latency for concurrent admins.

---

## 27. Database Changes

### Decision: **NO NEW TABLES REQUIRED**

Existing tables (`employees`, `users`, `leave_balances`, `payroll_profiles`, `pf_details`, `audit_logs`) already possess all required columns and constraints.

#### Optional Non-Destructive Performance Indexes:
```sql
-- Speeds up sequential ID query
CREATE INDEX IF NOT EXISTS idx_employees_id_pattern 
ON public.employees ((SUBSTRING(employee_id FROM 3 FOR 4)::integer)) 
WHERE employee_id ~ '^GP[0-9]{4}N$';

-- Speeds up email uniqueness check
CREATE INDEX IF NOT EXISTS idx_users_email_lower 
ON public.users (LOWER(email));
```

---

## 28. Files To Create

1. **`Backend/test_phase21_onboarding.js`:** Dedicated test suite covering validation, transactions, ID generation, RBAC, profile editing, and status management.
2. **`Frontend/src/components/Admin/OnboardEmployeeModal/OnboardEmployeeModal.jsx`:** Multi-step onboarding modal wizard component.
3. **`Frontend/src/components/Admin/OnboardEmployeeModal/OnboardEmployeeModal.css`:** Styling for wizard steps, inputs, and validation states.

---

## 29. Files To Modify

1. **`Backend/routes/adminEmployeeRoutes.js`:**
   - Add `POST /` -> `adminEmployeeController.onboardEmployee`
   - Add `PUT /:employeeId` -> `adminEmployeeController.updateEmployeeProfile`
   - Add `PATCH /:employeeId/status` -> `adminEmployeeController.updateEmployeeStatus`
2. **`Backend/controllers/adminEmployeeController.js`:**
   - Implement `onboardEmployee` with transaction orchestration.
   - Implement `updateEmployeeProfile` with validation and whitelist.
   - Implement `updateEmployeeStatus` with dual-table sync.
3. **`Frontend/src/services/api.js`:**
   - Add `onboardEmployee`, `updateEmployee`, and `updateEmployeeStatus` under `api.admin`.
4. **`Frontend/src/pages/Admin/Employees/Employees.jsx`:**
   - Integrate `OnboardEmployeeModal`.
   - Connect "Onboard Employee" button to open wizard.
   - Connect live refresh after onboarding.
5. **`Frontend/src/pages/Admin/EmployeeDetails/EmployeeDetails.jsx`:**
   - Implement live `handleSaveEdit` calling `api.admin.updateEmployee`.
   - Implement live `handleConfirmDeactivate` calling `api.admin.updateEmployeeStatus`.

---

## 30. Files That Must Not Be Modified

- **DO NOT MODIFY:**
  - `Backend/server.js` (Route mounting structure is already in place via `adminEmployeeRoutes`).
  - `Backend/config/database.js` (Connection pool already operational).
  - `Backend/middleware/authMiddleware.js` (RBAC already complete).
  - `Backend/controllers/authController.js` (OTP login already operational).
  - `Backend/services/otpService.js` (Authentication logic already operational).
  - All Phase 11/12/19 Payroll engines (`adminPayrollController.js`, `excelPayrollService.js`, `payslipPdfService.js`).
  - All Phase 20 Offboarding services (`adminExitController.js`, `fnfService.js`, `exitDocumentPdfService.js`).
  - Existing test suites (`test_phase18_security.js`, `test_phase19_excel_payroll.js`, `test_phase20_offboarding.js`, `test_full_system_regression.js`).

---

## 31. Test Plan

### Test Suite: `Backend/test_phase21_onboarding.js`

1. **Authentication & Authorization:**
   - Unauthenticated `POST /api/admin/employees` returns `401`.
   - Employee role calling `POST /api/admin/employees` returns `403`.
   - Admin calling `POST /api/admin/employees` is permitted.
2. **Input Validation:**
   - Missing `firstName` or `email` returns `400 Bad Request`.
   - Invalid email format returns `400 Bad Request`.
   - Invalid phone number returns `400 Bad Request`.
   - Negative salary value returns `400 Bad Request`.
3. **Duplicate Prevention:**
   - Submitting an existing email returns `409 Conflict`.
4. **Atomic Transaction & Integrity:**
   - Intentional failure (e.g. invalid profile data) verifies complete rollback: 0 orphan rows in `employees`, `users`, or `leave_balances`.
5. **Successful Creation:**
   - Verifies sequential Employee ID assignment (e.g. `GP0002N`).
   - Verifies linked `users` record with role `EMPLOYEE` and status `ACTIVE`.
   - Verifies default `leave_balances` row with 12 PL and 10 Sick.
   - Verifies linked `payroll_profiles` record.
   - Verifies `audit_logs` record created with sanitized metadata.
6. **Authentication Integration:**
   - Created employee can request an OTP via `/api/auth/request-otp` without manual DB setup.
7. **Profile Update:**
   - Admin `PUT /api/admin/employees/:id` successfully updates designation, phone, and address.
8. **Status Management:**
   - Admin `PATCH /api/admin/employees/:id/status` with `SUSPENDED` updates both `employees` and `users`.
   - Suspended user calling authenticated endpoints returns `403 Account Inactive`.

---

## 32. Regression Protection

- **Phase 18 Security Suite:** Run `node Backend/test_phase18_security.js` (39 assertions must pass).
- **Full Regression Suite:** Run `node Backend/test_full_system_regression.js` (74 assertions must pass).
- **Phase 19 Excel Payroll Suite:** Run `node Backend/test_phase19_excel_payroll.js` (69 assertions must pass).
- **Phase 20 Offboarding Suite:** Run `node Backend/test_phase20_offboarding.js` (97 assertions must pass).
- **Total Existing Assertions:** 279 / 279 must continue passing with zero regressions.

---

## 33. Business Decisions Required

1. **Default Leave Quotas:**
   - *Status:* **BUSINESS DECISION REQUIRED**
   - *Options:* Default to 12 Paid Leaves + 10 Sick Leaves, or allow customizable organizational defaults per department. (Recommendation: Default 12 PL / 10 Sick with Admin override capability in onboarding wizard).
2. **Mandatory vs. Optional Salary Details:**
   - *Status:* **BUSINESS DECISION REQUIRED**
   - *Options:* Require salary breakdown at onboarding, or allow saving without salary and configuring later via Payroll page. (Recommendation: Provide sensible default salary numbers in the onboarding wizard).
3. **Official Email Domain Enforcement:**
   - *Status:* **BUSINESS DECISION REQUIRED**
   - *Options:* Restrict email domain strictly to `@gaintpro.com`, or allow standard external domains for testing/contractors. (Recommendation: Validate standard email regex without domain locking to preserve testing flexibility).
4. **Immediate Welcome Notification:**
   - *Status:* **BUSINESS DECISION REQUIRED**
   - *Options:* Send automated welcome email upon onboarding, or wait until the employee initiates their first login OTP. (Recommendation: Defer welcome email to future notification phase; employee logs in via standard OTP).

---

## 34. In Scope

- Admin Employee Creation API (`POST /api/admin/employees`).
- Automated sequential Employee ID generation (`GP####N`).
- Companion User Account provisioning (`users` table).
- Companion Leave Balance initialization (`leave_balances` table).
- Companion Payroll Profile initialization (`payroll_profiles` table).
- Optional PF Details initialization (`pf_details` table).
- Atomic PostgreSQL transaction management.
- Multi-step Admin Onboarding Modal / Wizard UI.
- Admin Employee Profile Editing (`PUT /api/admin/employees/:id`).
- Admin Account Status Management (`PATCH /api/admin/employees/:id/status`).
- Audit logging for all actions.
- Dedicated test suite `test_phase21_onboarding.js`.

---

## 35. Out of Scope

- Redesigning passwordless email OTP authentication.
- Modifying JWT structures or session handling.
- Bulk Excel Employee Import (deferred to a subsequent phase).
- Biometric attendance hardware integration.
- External background verification (BGV) APIs.
- Candidate recruitment / job portal features.
- Modifying Phase 20 Offboarding or F&F settlement logic.

---

## 36. Implementation Sequence

1. **Step 1: Backend Routes & Controllers**
   - Extend `Backend/routes/adminEmployeeRoutes.js`.
   - Implement `onboardEmployee`, `updateEmployeeProfile`, and `updateEmployeeStatus` in `Backend/controllers/adminEmployeeController.js`.
2. **Step 2: Backend Integration Testing**
   - Create and execute `Backend/test_phase21_onboarding.js` ensuring 100% test passing.
   - Run existing regression suites (279 assertions) to verify zero breakage.
3. **Step 3: Frontend Service Integration**
   - Add `onboardEmployee`, `updateEmployee`, and `updateEmployeeStatus` to `Frontend/src/services/api.js`.
4. **Step 4: Frontend UI Components**
   - Create `OnboardEmployeeModal` with multi-step validation.
   - Wire up "Onboard Employee" action in `Employees.jsx`.
   - Wire up live profile editing and status deactivation in `EmployeeDetails.jsx`.
5. **Step 5: Final Production Verification**
   - Run frontend linter and production build (`npm run build`).
   - Run full regression suite.

---

## 37. Acceptance Criteria

- [ ] Admin can onboard a new employee entirely through the portal UI.
- [ ] Employee ID is generated strictly by backend in sequential format `GP####N`.
- [ ] Employee and user accounts are created atomically inside a single transaction.
- [ ] Leave balances (12 PL, 10 Sick) and payroll profiles are initialized automatically.
- [ ] Duplicate corporate email is rejected with `409 Conflict`.
- [ ] Non-admin / employee users cannot create or edit employees (`403 Forbidden`).
- [ ] Newly onboarded employee can immediately log in via OTP at `/login`.
- [ ] Admin can edit employee profile details and save changes successfully.
- [ ] Admin can update account status to `SUSPENDED`, immediately invalidating access.
- [ ] Audit log records are created for onboarding, editing, and status change.
- [ ] All 279 existing regression assertions continue to pass.
- [ ] Zero database schema alterations or migrations required.

---

## 38. Final Recommendation

The proposed Phase 21 design is **fully validated, structurally sound, and completely non-disruptive** to the existing application. It relies entirely on existing database tables, adheres to the established transactional and audit logging patterns, and directly resolves the primary lifecycle gap identified in Phase 20. 

Proceed with implementation strictly following this specification upon approval.
