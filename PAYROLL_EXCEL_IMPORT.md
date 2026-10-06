# Payroll Excel Import

## 1. Overview

The **Excel Payroll Import** module is a secure administrative feature within the GaintPro Software Technologies Employee Portal. It automates monthly payroll ingestion, salary computation, and employee payslip distribution.

- **Target Audience:** Portal Administrators (`ADMIN` and `SUPER_ADMIN`).
- **Core Purpose:** Eliminates repetitive manual data entry by allowing administrators to upload a structured Excel workbook (`.xlsx`), automatically validate employee details against the human resource database, review preview calculations, and commit salary records in bulk.
- **Server-Side Calculations:** All financial metrics—including Gross Salary, Total Deductions, and Net Salary—are computed strictly on the backend. Client-supplied totals or modified values are disregarded.
- **Automatic Payslip Generation:** Upon successful confirmation, the system automatically creates official PDF payslips, stores them securely in private document storage outside the public web root, and makes them immediately accessible to employees in their portal accounts.

---

## 2. End-to-End Workflow

The Excel payroll import lifecycle follows a structured sequence:

```
Admin Payroll Dashboard
        │
        ▼
Download Official Template (GET /api/admin/payroll/template)
        │
        ▼
Fill Monthly Payroll Data (.xlsx)
        │
        ▼
Upload Excel Workbook (POST /api/admin/payroll/import/preview)
        │
        ▼
Server Validation & Read-Only Preview
        │
        ▼
Select Import Mode (CREATE_ONLY or UPDATE_EXISTING)
        │
        ▼
Confirm Import (POST /api/admin/payroll/import/confirm)
        │
        ▼
Server-Side Calculations & Atomic PostgreSQL Transaction
        │
        ▼
Automatic PDF Payslip Generation (PDFKit) & Private Storage
        │
        ▼
Employee Portal Self-Service (GET /api/employee/payslips)
```

### Preview vs. Confirmation

| Stage | Endpoint | Database Mutation | Payslip Generation | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **PREVIEW** | `POST /api/admin/payroll/import/preview` | **None** (Read-Only) | **None** | Parses file in memory, validates headers, checks employee existence, validates numbers, detects duplicates/existing records, calculates preview figures, and caches a temporary 30-minute session. |
| **CONFIRM** | `POST /api/admin/payroll/import/confirm` | **Atomic Commit** | **Automatic** | Validates the active session, enforces zero-error constraints, executes an atomic PostgreSQL transaction (`BEGIN ... COMMIT`), stores payroll rows, renders PDF payslips, and saves them to private storage. |

---

## 3. Access Control

Access to payroll import and administrative payroll endpoints is enforced through centralized JSON Web Token (JWT) session authentication and Role-Based Access Control (RBAC) middleware:

- **ADMIN:** Full access to template download, file upload preview, import confirmation, payroll record inspection, and payslip generation.
- **SUPER_ADMIN:** Inherits all administrative privileges with full access to import workflows.
- **EMPLOYEE:** Access strictly denied. Attempting to call any `/api/admin/payroll/*` endpoint returns `403 Forbidden`.
- **Unauthenticated Requests:** Requests missing a valid `Bearer <token>` header or supplying an expired/tampered JWT return `401 Unauthorized`.

---

## 4. Excel Template

Administrators download the standardized payroll template via `GET /api/admin/payroll/template`.

- **File Format:** Microsoft Excel OpenXML Spreadsheet (`.xlsx`)
- **MIME Type:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Default Filename:** `Payroll_Import_Template.xlsx`
- **Worksheets:**
  1. `Payroll_Data`: Freeze-paned styled worksheet with dark slate header styling (`#1E293B`) containing the 11 required columns.
  2. `Sample_Data`: Reference worksheet containing a pre-populated valid sample row (`GP0001N`).
  3. `Instructions`: Detailed guidelines specifying required formats, constraint definitions, and business rules.

### Required Column Definitions & Aliases

The system dynamically resolves column headers using normalized matching and case-insensitive aliases:

| Standard Header | Field Key | Supported Aliases | Data Type | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Employee ID** | `employee_id` | `employee id`, `employee_id`, `employeeid`, `empid` | Text | Max 50 chars, must exist in `public.employees` | Unique identifier for employee lookup |
| **Month** | `month` | `month` | Integer | 1 to 12 | Numerical payroll calendar month |
| **Year** | `year` | `year` | Integer | 2000 to 2100 | 4-digit calendar year |
| **Working Days** | `working_days` | `working days`, `working_days`, `workingdays` | Numeric | $\ge 0$ | Standard total working days in the month |
| **Payable Days** | `payable_days` | `payable days`, `payable_days`, `payabledays` | Numeric | $\ge 0$, $\le$ Working Days | Days payable for this employee |
| **Basic Salary** | `basic_salary` | `basic salary`, `basic_salary`, `basicsalary`, `basic` | Numeric | $\ge 0$ | Monthly base salary in INR |
| **HRA** | `hra` | `hra` | Numeric | $\ge 0$ | House Rent Allowance in INR |
| **Allowances** | `allowances` | `allowances`, `allowance` | Numeric | $\ge 0$ | Special and miscellaneous allowances |
| **PF Employee** | `pf_employee` | `pf employee`, `pf_employee`, `pf`, `epf` | Numeric | $\ge 0$ | Employee provident fund contribution |
| **Professional Tax** | `professional_tax` | `professional tax`, `professional_tax`, `pt` | Numeric | $\ge 0$ | State professional tax deduction |
| **Other Deductions** | `other_deductions` | `other deductions`, `other_deductions`, `otherdeductions` | Numeric | $\ge 0$ | Any additional authorized deductions |

---

## 5. Excel File Requirements

The file upload middleware (`uploadSingleExcel`) enforces strict security validation prior to parsing:

- **Supported Extension:** `.xlsx` only.
- **Disallowed Extensions:** `.xlsm` (macro-enabled workbooks), `.xls` (legacy binary), `.csv`, `.tsv`, `.txt`, `.exe`, or scripts are rejected immediately with `400 Bad Request`.
- **Maximum File Size:** `10 MB` enforced by multer memory storage.
- **Magic Byte Signature Verification:** Validates that the buffer begins with the authentic PKZIP header (`0x50 0x4B 0x03 0x04`). Binary files disguised with a `.xlsx` filename are rejected before parsing.
- **Security Rationale:** Prevents remote code execution, macro viruses, denial of service (DoS) through oversized payloads, and MIME-spoofing attacks.

---

## 6. Excel Validation Rules

Validation occurs across five independent dimensions in `excelPayrollService.js`:

### Header Validation
- The workbook must contain the `Payroll_Data` worksheet (or fall back to the first sheet).
- All 11 required columns must be resolved via standard names or aliases.
- If any required column is absent, parsing halts with HTTP `400 Bad Request` explicitly identifying the missing columns.

### Employee Validation
- Extracted `Employee ID` values are queried in batch against `public.employees` using `WHERE employee_id = ANY($1::varchar[])`.
- If an employee does not exist in the database, the row is marked `INVALID` with the message: `Employee ID '<ID>' does not exist in the HRM database.`

### Numeric Validation
- Numeric cells must be valid, finite numbers. Blank cells in required numeric columns return an error.
- Negative values for Basic Salary, HRA, Allowances, PF Employee, Professional Tax, or Other Deductions are strictly rejected (`<Field> cannot be negative.`).
- Working Days must be $\ge 0$.

### Date & Period Validation
- `Month` must be an integer between `1` and `12`.
- `Year` must be an integer between `2000` and `2100`.
- `Payable Days` cannot exceed `Working Days` (`Payable Days (X) cannot exceed Working Days (Y).`).

### Duplicate & Collision Detection
- **Batch Duplicates:** Tracks `${employee_id}_${month}_${year}` within the uploaded file. If the same employee appears more than once for the same period, subsequent entries are flagged `isDuplicateInBatch = true` and marked `INVALID`.
- **Database Collisions:** Queries `public.payroll_records` to identify existing records matching `(employee_id, month, year)`. Records present in PostgreSQL are flagged `existsInDb = true`.

---

## 7. Payroll Calculation

Calculations are executed strictly on the server:

$$\text{Gross Salary} = \text{Basic Salary} + \text{HRA} + \text{Allowances}$$

$$\text{Total Deductions} = \text{PF Employee} + \text{Professional Tax} + \text{Other Deductions}$$

$$\text{Net Salary} = \text{Gross Salary} - \text{Total Deductions}$$

- **Server-Side Enforcement:** Calculations in `excelPayrollService.js` use `Math.round(val * 100) / 100` to guarantee exact 2-decimal-place rounding.
- **Client Zero-Trust:** Client-supplied totals are ignored. The backend recomputes all sums from base earnings and deduction components.

---

## 8. Preview API

### Endpoint Specification
- **Method:** `POST`
- **Route:** `/api/admin/payroll/import/preview`
- **Content-Type:** `multipart/form-data`
- **Field Name:** `file`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Rate Limit:** 30 requests per 15 minutes per IP (`excelImportLimiter`)

### Server Behavior
1. Validates upload signature and `.xlsx` extension.
2. Parses workbook into structured memory objects.
3. Performs batch database checks for employee existence and existing payroll records.
4. Generates an in-memory session cached with a 30-minute Time-To-Live (TTL).
5. Records audit event `PAYROLL_EXCEL_PREVIEW`.
6. Returns validated row items and summary counts without modifying database tables.

### Representative Response Structure
```json
{
  "success": true,
  "message": "Excel file validated successfully.",
  "data": {
    "importId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "summary": {
      "totalRows": 1,
      "validRows": 1,
      "invalidRows": 0,
      "existingPayrollRows": 0,
      "duplicateRows": 0
    },
    "rows": [
      {
        "rowNumber": 2,
        "employee_id": "GP0001N",
        "employee_name": "Rohan Kumar",
        "department": "Engineering",
        "month": 11,
        "year": 2026,
        "working_days": 26,
        "payable_days": 26,
        "basic_salary": 25000,
        "hra": 10000,
        "allowances": 5000,
        "gross_salary": 40000,
        "pf_employee": 1800,
        "professional_tax": 200,
        "other_deductions": 500,
        "total_deductions": 2500,
        "net_salary": 37500,
        "status": "VALID",
        "isDuplicateInBatch": false,
        "existsInDb": false,
        "errors": []
      }
    ]
  }
}
```

---

## 9. Import Modes

The system provides two mutually exclusive import modes to handle record collisions:

### CREATE_ONLY (Default)
- **Purpose:** Intended for uploading fresh monthly payroll data.
- **Collision Protection:** If any row in the uploaded file already exists in `public.payroll_records` for that `(employee_id, month, year)`, confirmation is halted with HTTP `409 Conflict`.
- **Error Guidance:** Alerts the administrator that records already exist and suggests switching to `UPDATE_EXISTING` mode.
- **Payslip Idempotency:** Does not overwrite existing payslips.

### UPDATE_EXISTING
- **Purpose:** Intended for salary adjustments, retro-pay recalculations, or corrections.
- **Behavior:** Updates existing records in `public.payroll_records` with newly calculated amounts, updates `updated_at` and `processed_at`, and inserts any new records present in the batch.
- **Payslip Regeneration:** Regenerates PDF payslips in private storage to reflect updated earnings and deductions.

---

## 10. Confirmation API

### Endpoint Specification
- **Method:** `POST`
- **Route:** `/api/admin/payroll/import/confirm`
- **Content-Type:** `application/json`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Rate Limit:** 30 requests per 15 minutes per IP (`excelImportLimiter`)

### Request Payload
```json
{
  "importId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "importMode": "CREATE_ONLY"
}
```

### Server Execution Logic
1. Retrieves cached session using `importId`. If expired or missing, returns `400 Bad Request`.
2. Validates that `invalidRows === 0` and `duplicateRows === 0`.
3. In `CREATE_ONLY` mode, validates that `existingPayrollRows === 0`.
4. Opens a dedicated PostgreSQL client from the connection pool and starts a transaction (`BEGIN`).
5. Executes parameterized `INSERT` or `UPDATE` queries for all rows.
6. Commits the transaction (`COMMIT`).
7. Iterates through committed rows to generate payslip PDFs and registers them in `public.documents`.
8. Deletes the in-memory import session.
9. Records audit events `PAYROLL_EXCEL_IMPORT`, `PAYROLL_BULK_PROCESS`, and `PAYSLIP_BULK_GENERATE`.

### Representative Response Structure
```json
{
  "success": true,
  "message": "Payroll import completed successfully. Processed 1 records (1 created, 0 updated). 1 payslip(s) generated.",
  "data": {
    "totalRows": 1,
    "createdCount": 1,
    "updatedCount": 0,
    "payslipsGenerated": 1,
    "alreadyGeneratedCount": 0,
    "failedCount": 0
  }
}
```

---

## 11. Database Behavior

No new database tables or schema migrations were required for Phase 19. All operations reuse established relational tables:

### `public.payroll_records`
- **Composite Uniqueness:** Enforced by constraint `uq_payroll_records_employee_month_year UNIQUE (employee_id, month, year)`.
- **Columns Written:** `employee_id`, `month`, `year`, `working_days`, `payable_days`, `basic_salary`, `hra`, `allowances`, `gross_salary`, `pf_employee`, `professional_tax`, `other_deductions`, `total_deductions`, `net_salary`, `status = 'Processed'`, `processed_by = <admin_uuid>`, `processed_at = NOW()`, `updated_at = NOW()`.

### `public.documents`
- **Payslip Association:** Records metadata for each generated payslip PDF (`employee_id`, `document_type = 'Payslip'`, `file_name`, `storage_key`, `month`, `year`, `uploaded_by = <admin_uuid>`).
- **Cascade Deletion:** Foreign-keyed to `public.employees(employee_id) ON DELETE CASCADE`.

### `public.audit_logs`
- **Immutable Log:** Records all payroll operations with client IP address, user agent, action code, and sanitized JSONB metadata.

---

## 12. Transaction Safety

Database persistence adheres strictly to ACID guarantees using PostgreSQL transactions:

```sql
BEGIN;
  -- Iterative row insertions / updates
  INSERT INTO public.payroll_records (...) VALUES (...);
COMMIT;
```

- **Rollback Guarantee:** If an unexpected database exception, type mismatch, or constraint violation occurs during row processing, execution jumps to the error handler:
  ```javascript
  await client.query('ROLLBACK').catch(() => {});
  ```
- **Atomicity:** Ensures that either the entire batch of payroll records commits successfully or no rows are written. Partial batches are never left in the database.

---

## 13. Automatic Payslip Generation

Immediately after the PostgreSQL transaction commits, the system automatically triggers payslip generation:

1. **PDF Rendering:** Invokes `generatePayslipPdf` in `payslipPdfService.js`, which uses PDFKit to assemble a formatted A4 document with corporate branding, employee credentials, UAN/PF details, earnings table, deductions table, and net salary.
2. **Private Storage:** The binary PDF buffer is passed to `storageService.saveFile(pdfBuffer, storageKey)`.
3. **Collision-Resistant Keys:** The storage key format (`documents/<employee_id>/<year>/<month>/<uuid>.pdf`) ensures paths cannot collide or be guessed.
4. **Metadata Linkage:** If no previous document existed, a new entry is created in `public.documents` with `document_type = 'Payslip'`.
5. **Idempotency:**
   - In `CREATE_ONLY` mode, if a document and its physical storage file already exist, PDF regeneration is bypassed.
   - In `UPDATE_EXISTING` mode, the storage key is reused, the PDF is regenerated with updated figures, and the physical file is overwritten cleanly.

---

## 14. Employee Payslip Access

Employees access generated payslips via the Employee Portal using dedicated endpoints:

- **List Payslips:** `GET /api/employee/payslips` (supports pagination and optional `year`/`month` filters).
- **Inline PDF View:** `GET /api/employee/payslips/:documentId/view` (streams `application/pdf` with `Content-Disposition: inline`).
- **PDF Download:** `GET /api/employee/payslips/:documentId/download` (streams `application/pdf` with `Content-Disposition: attachment`).

### Access Protections
- **Authentication:** Enforced via `requireRole('EMPLOYEE')`.
- **Identity Scoping:** The query binds strictly to `d.employee_id = req.user.employee_id`.
- **IDOR Defense:** Attempting to view or download a payslip belonging to another employee returns `404 Not Found`.
- **Path Masking:** Internal `storage_key` strings and filesystem paths are omitted from API responses.

---

## 15. Security Controls

The module incorporates defense-in-depth controls established across Phases 1–18:

| Control | Implementation Detail | Verified Security Outcome |
| :--- | :--- | :--- |
| **Authentication** | HMAC-SHA256 JWT validation | Unauthenticated requests receive `401 Unauthorized` |
| **Authorization** | `requireRole('ADMIN', 'SUPER_ADMIN')` | Employees probing admin import receive `403 Forbidden` |
| **Magic Byte Check** | Enforces PKZIP signature `[0x50, 0x4B, 0x03, 0x04]` | Disguised binaries or scripts rejected (`400 Bad Request`) |
| **Extension Whitelist** | Rejects non-`.xlsx` and `.xlsm` | Blocks macro execution and malicious scripts |
| **Upload Limiting** | Max 10 MB in memory buffer | Prevents disk filling and denial of service |
| **Rate Limiting** | 30 requests per 15 minutes per IP | Blocks automated brute-force or spam submissions |
| **SQL Injection** | 100% Parameterized SQL (`$1, $2, ...`) | SQL injection probes safely treated as text literals |
| **Server Calculation** | Recomputes Gross, Deductions, and Net | Manipulated client totals are discarded |
| **Transaction Safety** | PostgreSQL `BEGIN ... COMMIT / ROLLBACK` | Prevents partial or orphaned database records |
| **Private Storage** | Files stored outside web root | Direct public HTTP URL access is impossible (`404`) |
| **IDOR Protection** | Context-bound queries via `req.user` | Cross-employee payslip access returns `404 Not Found` |
| **Path Traversal Defense** | Storage keys validated against root boundary | Relative paths (`../`) and null bytes (`\0`) rejected |
| **Credential Sanitization** | `sanitizeAuditMetadata` masks sensitive fields | Passwords, tokens, and paths never logged or leaked |

---

## 16. Rate Limiting

Rate limiting is governed by `excelImportLimiter` in `rateLimitMiddleware.js`:

- **Window:** 15 minutes (`windowMs = 15 * 60 * 1000`).
- **Quota:** 30 requests per IP address.
- **Protected Endpoints:**
  - `POST /api/admin/payroll/import/preview`
  - `POST /api/admin/payroll/import/confirm`
- **Exceeded Response:** Returns HTTP `429 Too Many Requests` with:
  ```json
  {
    "success": false,
    "message": "Payroll import request limit reached. Please wait a few minutes before trying again."
  }
  ```
- **Test Suite Execution:** Non-production environments permit test automation via header `X-Test-Suite: true` to prevent test flapping.

---

## 17. Audit Logging

Every critical stage of the import lifecycle records an immutable audit entry in `public.audit_logs`:

| Action Code | Entity Type | Trigger Event | Logged Metadata |
| :--- | :--- | :--- | :--- |
| `PAYROLL_EXCEL_PREVIEW` | `PAYROLL` | Completion of Excel preview | `totalRows`, `validRows`, `invalidRows`, `existingPayrollRows`, `duplicateRows` |
| `PAYROLL_EXCEL_IMPORT` | `PAYROLL` | Successful transaction commit | `totalRows`, `createdCount`, `updatedCount`, `importMode` |
| `PAYROLL_BULK_PROCESS` | `PAYROLL` | Bulk payroll database update | `count` (total records committed) |
| `PAYSLIP_BULK_GENERATE` | `DOCUMENT` | Automatic PDF generation | `generatedCount`, `alreadyGeneratedCount` |

All audit entries record the administrator's `user_id`, client IP address, user agent, and timestamp.

---

## 18. Error Handling

The module maps failure conditions to standardized HTTP status codes:

| HTTP Status | Meaning | Typical Trigger | Response Example |
| :--- | :--- | :--- | :--- |
| **400 Bad Request** | Schema or data validation error | Missing file, non-xlsx extension, missing column header, invalid row data | `{"success": false, "message": "Missing required columns: Basic Salary"}` |
| **401 Unauthorized** | Missing or invalid authentication | Request missing Bearer JWT or presenting expired token | `{"success": false, "message": "Authentication required. No token provided."}` |
| **403 Forbidden** | Insufficient permissions | Employee token accessing admin import endpoints | `{"success": false, "message": "Access denied. Insufficient permissions."}` |
| **404 Not Found** | Resource does not exist | Accessing foreign employee payslip (IDOR defense) | `{"success": false, "message": "Payslip document not found."}` |
| **409 Conflict** | Existing record collision | Importing existing records in `CREATE_ONLY` mode | `{"success": false, "message": "Cannot import in 'Create Only' mode: payroll already exists for 1 employee(s)..."}` |
| **429 Too Many Requests** | Rate limit quota exceeded | Exceeding 30 import requests in 15 minutes | `{"success": false, "message": "Payroll import request limit reached..."}` |
| **500 Internal Error** | Unhandled server exception | Database connectivity failure or storage write failure | `{"success": false, "message": "An unexpected internal server error occurred."}` |

---

## 19. Frontend Usage

The administrative interface is integrated into `Frontend/src/pages/Admin/Payroll/Payroll.jsx`:

1. **Accessing the Module:** Log in as an Administrator and navigate to **Payroll** from the sidebar.
2. **Downloading the Template:** Click the **Download Excel Template** button in the header bar or the Required Columns card. The browser automatically downloads `Payroll_Import_Template.xlsx`.
3. **Preparing the Data:** Open the template in Microsoft Excel, navigate to the `Payroll_Data` worksheet, enter employee payroll details, and save the `.xlsx` file.
4. **Initiating Import:** Click **Import Payroll Excel** in the header actions to launch the 3-step modal.
5. **Step 1 — Upload File:** Drag and drop the `.xlsx` file or browse your device. Click **Validate Excel** to transmit the workbook to the preview endpoint.
6. **Step 2 — Validate & Preview:**
   - **Summary Cards:** Displays Total Rows, Valid Rows, Invalid Rows, Existing in DB, and Duplicates.
   - **Validation Error Box:** If invalid rows are detected, an error banner outlines row numbers and specific issues.
   - **Import Mode:** Choose between **Create Only** (default) or **Update Existing**.
   - **Preview Table:** Inspect calculated Gross Salary, Total Deductions, Net Salary, and status badges.
   - Click **Import & Generate Payroll** (disabled if validation errors exist or mode conflicts occur).
7. **Step 3 — Generated Results:** Review final metrics showing created records, updated records, and generated payslips. Click **View Payroll Records** to close the modal and refresh the table.
8. **Employee Verification:** Employees can log in to their portal account, navigate to **Payslips**, and view or download their payslip PDF.

---

## 20. Testing & Verification

The Excel Payroll Import module was verified through automated test suites:

- **Phase 19 Dedicated Suite (`test_phase19_excel_payroll.js`):** **69 / 69 Passed** (100%)
- **Phase 18 Security Suite (`test_phase18_security.js`):** **39 / 39 Passed** (100%)
- **Full System Regression Suite (`test_full_system_regression.js`):** **74 / 74 Passed** (100%)
- **Total Automated Assertions:** **182 / 182 Passed**
- **Frontend Code Quality (`oxlint`):** **0 errors, 0 warnings** across 39 files
- **Frontend Production Build (`vite build`):** **Successful** (generated in 501ms)
- **Dependency Vulnerabilities (`npm audit`):** **0 vulnerabilities** across Backend and Frontend

*Note: All temporary test records created during test runs were automatically removed upon completion, leaving existing historical payroll records intact.*

---

## 21. API Reference

| Method | Endpoint | Description | Auth Required | Permitted Roles |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/payroll/template` | Downloads official Excel payroll template (`.xlsx`) | Yes | `ADMIN`, `SUPER_ADMIN` |
| `POST` | `/api/admin/payroll/import/preview` | Uploads and validates workbook, returns preview statistics | Yes | `ADMIN`, `SUPER_ADMIN` |
| `POST` | `/api/admin/payroll/import/confirm` | Commits validated session, writes records, generates payslips | Yes | `ADMIN`, `SUPER_ADMIN` |
| `GET` | `/api/admin/payroll` | Lists monthly payroll records with search and filters | Yes | `ADMIN`, `SUPER_ADMIN` |
| `GET` | `/api/employee/payslips` | Lists authenticated employee's payslip documents | Yes | `EMPLOYEE` |
| `GET` | `/api/employee/payslips/:id/view` | Streams payslip PDF for inline viewing | Yes | `EMPLOYEE` |
| `GET` | `/api/employee/payslips/:id/download` | Streams payslip PDF as file attachment download | Yes | `EMPLOYEE` |

---

## 22. Troubleshooting

| Symptom | Probable Cause | Recommended Resolution |
| :--- | :--- | :--- |
| **"Missing required columns: ..."** | Required column header was renamed, removed, or misspelled in Excel | Download a fresh template and ensure all 11 columns in `Payroll_Data` retain their original titles. |
| **"Employee ID '...' does not exist"** | Employee ID does not match any record in `public.employees` | Verify the Employee ID against the portal's **Employees** directory. Ensure there are no leading or trailing spaces. |
| **"Payable Days cannot exceed Working Days"** | Payable Days value is greater than the standard Working Days | Adjust Payable Days so it is less than or equal to Working Days. |
| **"<Field> cannot be negative"** | A salary or deduction field contains a negative number | Enter non-negative numerical values ($\ge 0$). Deductions should be entered as positive values. |
| **"Duplicate row in Excel for employee..."** | The same employee appears multiple times in the uploaded file | Ensure each employee appears only once per monthly payroll batch. Remove redundant rows. |
| **"Cannot import in 'Create Only' mode..."** | Payroll records for the period already exist in the database | Select **Update Existing** mode to overwrite records, or change the Month/Year if importing a different period. |
| **"Invalid Excel file format"** | Uploaded file is corrupted or not an authentic `.xlsx` spreadsheet | Open and re-save the file in Microsoft Excel or Google Sheets as `.xlsx` (OpenXML format). |
| **"File size exceeds the 10 MB limit"** | Uploaded workbook exceeds 10 MB | Remove extraneous worksheets, high-resolution embedded images, or historical archives from the file. |
| **"Access denied. Insufficient permissions"** | Authenticated account does not possess `ADMIN` or `SUPER_ADMIN` role | Log in with authorized administrator credentials. |
| **"Import session expired or invalid"** | More than 30 minutes elapsed between preview and confirmation | Re-upload and validate the Excel file to generate a fresh import session. |
| **Employee cannot view payslip** | File generation failed or employee is checking wrong month | Check the admin payroll table to ensure status is `Processed` and verify that the month and year match. |

---

## 23. Operational Notes

- **Use the Official Template:** Always generate templates directly via `GET /api/admin/payroll/template` to ensure compatibility with backend column mapping.
- **Header Integrity:** Do not rename, combine, or delete column headers in the `Payroll_Data` worksheet.
- **Review Previews Carefully:** Always review the preview summary cards and check the calculated Gross, Deductions, and Net Salary columns before confirming an import.
- **Intentional Mode Selection:** Use `CREATE_ONLY` for standard monthly payroll. Reserve `UPDATE_EXISTING` for deliberate adjustments or corrections.
- **Filesystem Integrity:** Never manually modify, delete, or add files within the private storage directory (`storage/private/`). Document linkages are managed by PostgreSQL.
- **Audit Logs:** Audit logs are permanent records. High-volume imports or bulk operations can be audited in `public.audit_logs`.

---

## 24. Limitations

- **File Types:** Only `.xlsx` workbooks are supported. Legacy `.xls` binary formats and `.csv` files are rejected.
- **Worksheet Target:** Processing prioritizes worksheets named `Payroll_Data` or `Payroll Data`. If neither exists, the first worksheet is processed.
- **Single File Processing:** One workbook can be validated and confirmed at a time. Multi-file batch uploads are not supported.
- **Session Expiry:** Import preview sessions expire from memory after 30 minutes. Confirmation must occur within this window.
- **Rate Limit Window:** Import requests are capped at 30 requests per 15 minutes per IP.

---

## 25. File Reference

### Backend Components
- `Backend/services/excelPayrollService.js`: Core service handling template workbook generation, buffer parsing, schema validation, employee existence verification, server-side calculations, and memory session management.
- `Backend/middleware/uploadMiddleware.js`: Multer memory storage configuration, file size limits (10 MB), `.xlsx` extension filtering, and PKZIP magic byte validation.
- `Backend/middleware/rateLimitMiddleware.js`: `excelImportLimiter` restricting import requests to 30 per 15 minutes.
- `Backend/controllers/adminPayrollController.js`: Controller implementing `downloadPayrollTemplate`, `previewPayrollImport`, and `confirmPayrollImport`.
- `Backend/routes/adminPayrollRoutes.js`: Route definitions binding endpoints to authentication and RBAC middleware.
- `Backend/services/payslipPdfService.js`: PDFKit document generation creating official salary payslips.
- `Backend/services/storageService.js`: Private local filesystem storage manager with path traversal defense.
- `Backend/services/auditService.js`: Audit logging service with sensitive metadata redaction.
- `Backend/test_phase19_excel_payroll.js`: Automated test suite covering 69 test assertions across all Phase 19 functionality.

### Frontend Components
- `Frontend/src/pages/Admin/Payroll/Payroll.jsx`: Admin Payroll dashboard containing template download triggers, the 3-step import modal, preview tables, and mode controls.
- `Frontend/src/pages/Admin/Payroll/Payroll.css`: Styles for the upload dropzone, stepper tabs, metric cards, preview table, and responsive breakpoints.
- `Frontend/src/services/api.js`: Client API methods (`downloadPayrollTemplate`, `previewPayrollImport`, `confirmPayrollImport`).
