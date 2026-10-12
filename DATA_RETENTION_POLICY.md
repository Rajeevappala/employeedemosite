# GaintPro HRM — Data Retention and Account Deletion Policy

## 1. Overview and Purpose
This document establishes the official Data Retention and Account Deletion Policy for the GaintPro Software Technologies Human Resource Management (HRM) Portal. It specifies how employee and administrator data are handled upon account termination or permanent deletion, balancing personal data privacy principles with statutory and legal record-keeping obligations in India.

---

## 2. Statutory and Regulatory Compliance Framework
Under Indian statutory laws and standard financial compliance requirements:
1. **Income Tax Act, 1961 (Section 44AA & Rule 6F):** Books of accounts, payroll registers, salary statements, and tax deduction records must be retained for a mandatory minimum period of **8 years** following the end of the relevant assessment year.
2. **Employees' Provident Funds and Miscellaneous Provisions Act, 1952:** Records concerning wages, provident fund contributions, and statutory employee deductions must be retained for inspection and compliance audits.
3. **The Digital Personal Data Protection (DPDP) Act, 2023:** Personal data must not be retained beyond the period necessary for fulfilling the purpose for which it was processed, except where retention is legally mandated.

---

## 3. Data Classification and Retention Schedules

| Data Category | Specific Elements | Action on Account Deletion | Retention Period | Storage Location |
| :--- | :--- | :--- | :--- | :--- |
| **Personal Identity Data** | Full name, personal email, phone number, gender, date of birth, residential address | **Permanently Deleted** | None (erased upon deletion) | `public.employees`, `public.users` |
| **Private Files & KYC Documents** | Profile photos, resumes, educational certificates, ID proofs, relieving letters | **Permanently Deleted** (files wiped from private storage) | None (erased upon deletion) | Local Private Storage / `public.documents` |
| **Banking Credentials** | Encrypted bank account numbers, IFSC codes, bank branch details | **Permanently Deleted** | None (erased upon deletion) | `public.employee_bank_details` |
| **Daily Attendance & Time Tracking** | Clock-in timestamps, attendance status, biometric logs, daily remarks | **Permanently Deleted** | None (erased upon deletion) | `public.attendance` |
| **Leave Management** | Leave applications, approval history, leave balances, reason notes | **Permanently Deleted** | None (erased upon deletion) | `public.leave_requests`, `public.leave_balances` |
| **Offboarding Clearances** | Resignation requests, departmental clearance checklists, FNF working notes | **Permanently Deleted** | None (erased upon deletion) | `public.exit_requests`, `public.exit_clearances`, `public.fnf_settlements` |
| **Statutory Payroll Ledger** | Gross salary, basic pay, HRA, statutory allowances, PF deductions, Professional Tax, net pay, disbursement timestamp | **Archived to Statutory Ledger** | **8 Years** from disbursement | `public.statutory_payroll_archive` |
| **Audit Logs** | Administrative actions, timestamps, actor ID, action category | **Retained Anonymously** (target PII stripped) | Indefinite (internal audit) | `public.audit_logs` |

---

## 4. Account Deletion Safeguards

### 4.1 Employee Account Deletion
- Accessible by authorized administrators (`role = 'ADMIN'`).
- Requires entering the exact Employee ID as confirmation and checking the explicit authorization checkbox.
- Before deleting records from active tables, all processed payroll entries are atomically archived into `public.statutory_payroll_archive` with `retention_until = NOW() + INTERVAL '8 years'`.
- Associated physical files (uploaded private documents and photos) are deleted from the server filesystem.
- The corresponding authentication user account (`role = 'EMPLOYEE'`) and OTP sessions are removed.

### 4.2 Administrator Account Deletion
- Accessible by any administrator (`role = 'ADMIN'`) with equal permissions.
- **Protection Against Self-Deletion:** An administrator cannot delete their own account.
- **Protection of Last Active Administrator:** The system prevents the deletion or deactivation of the last active administrator account to prevent lockout.
- Requires typing the exact administrator email address as confirmation and checking the explicit authorization checkbox.
- Any announcements authored by the deleted administrator are reassigned to the executing administrator to preserve operational communications without foreign-key constraint violations.
- Active authentication tokens and OTP verification records are revoked immediately.

---

## 5. Security & Verification
1. All deletions are transactional (`BEGIN ... COMMIT`) to ensure complete atomicity and prevent orphaned records.
2. Deletion activities are logged to `public.audit_logs` with the actor's ID and timestamp.
3. Access tokens for deleted accounts are invalidated immediately upon deletion.
