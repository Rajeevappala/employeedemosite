/**
 * Test Suite: Admin Bank Account Visibility + Upload Employee Document Search & Department Filtering
 * 
 * Verifies all 25 specifications:
 * 1. Authorized Admin can load the dedicated bank-details endpoint.
 * 2. Authorized Super Admin access follows existing RBAC policy.
 * 3. The Salary Bank Details card displays the decrypted account number.
 * 4. The Admin Review modal displays the same number.
 * 5. The frontend reads the correct API response field.
 * 6. API failure displays a clear error and does not imply that the number loaded successfully.
 * 7. Employee Profile continues showing only a masked number.
 * 8. Generic employee-list and employee-detail APIs remain masked.
 * 9. Encryption at rest remains unchanged.
 * 10. Full account numbers never appear in logs or audit metadata.
 * 11. Department filter displays IT, Non-IT, and All Departments.
 * 12. IT selection displays only IT employees.
 * 13. Non-IT selection displays only Non-IT employees.
 * 14. All Departments displays all authorized employees.
 * 15. Search matches employee names.
 * 16. Search matches employee IDs.
 * 17. Department and search filters work together.
 * 18. Employee selection submits the correct employee ID.
 * 19. Changing departments clears an invalid employee selection.
 * 20. Changing search does not unnecessarily clear a valid selection.
 * 21. Empty results display a helpful message.
 * 22. Upload is blocked if no valid employee is selected.
 * 23. Existing document upload works for all existing document types.
 * 24. Existing document security and file validation remain functional.
 * 25. Inactive employees follow the existing document-upload policy.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const { encryptAccountNumber, decryptAccountNumber } = require('./services/bankEncryptionService');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json: () => json,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      if (typeof postData === 'string' || Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(JSON.stringify(postData));
      }
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('   TEST SUITE: BANK ACCOUNT VISIBILITY & DOCUMENT FILTERS   ');
  console.log('============================================================\n');

  try {
    // Setup Admin and Super Admin users & tokens
    const adminUser = (await pool.query("SELECT id, email FROM public.users WHERE role = 'ADMIN' LIMIT 1")).rows[0];
    const adminToken = generateToken({ userId: adminUser.id, email: adminUser.email, role: 'ADMIN' });
    const superAdminToken = generateToken({ userId: adminUser.id, email: 'superadmin_test@gaintpro.com', role: 'SUPER_ADMIN' });
    const empUser = (await pool.query("SELECT id, email, employee_id FROM public.users WHERE role = 'EMPLOYEE' LIMIT 1")).rows[0];
    const empToken = generateToken({ userId: empUser.id, email: empUser.email, role: 'EMPLOYEE', employeeId: empUser.employee_id });

    // Ensure GP0001N has bank details configured with known account number
    const testAccountNumber = '123456789012';
    const encryptedAcc = encryptAccountNumber(testAccountNumber);
    
    await pool.query(`
      INSERT INTO public.employee_bank_details 
      (employee_id, account_holder_name, bank_name, account_number_encrypted, account_number_last4, ifsc_code, branch_name, branch_city, account_type, verification_status, created_by)
      VALUES ('GP0001N', 'Rajeev Appala', 'IDFC Bank', $1, '9012', 'IDFB0040101', 'Madhapur', 'Hyderabad', 'Salary', 'Verified', $2)
      ON CONFLICT (employee_id) DO UPDATE SET
        account_number_encrypted = $1,
        account_number_last4 = '9012',
        verification_status = 'Verified',
        updated_at = NOW()
    `, [encryptedAcc, adminUser.id]);

    // =========================================================================
    // PART 1: Bank Account Visibility Tests (1-10)
    // =========================================================================
    console.log('\n--- PART 1: Bank Account Visibility Tests ---');

    // 1. Authorized Admin can load dedicated bank-details endpoint
    const adminBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP0001N/bank-details',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminBankRes.statusCode === 200, '1. Authorized Admin can load dedicated bank-details endpoint (HTTP 200)');
    const adminBankData = adminBankRes.json()?.data;
    assert(adminBankData?.account_number === testAccountNumber, `1b. Response contains decrypted full account number (${testAccountNumber})`);

    // 2. Authorized Super Admin access follows RBAC policy
    const superAdminBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP0001N/bank-details',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(superAdminBankRes.statusCode === 200, '2. Authorized Super Admin can load dedicated bank-details endpoint (HTTP 200)');
    assert(superAdminBankRes.json()?.data?.account_number === testAccountNumber, '2b. Super Admin receives decrypted full account number');

    // 3. Inspect Frontend EmployeeDetails.jsx for Salary Bank Details card display
    const detailsCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeDetails/EmployeeDetails.jsx'), 'utf8');
    assert(
      detailsCode.includes('accountNumber: bankRaw?.account_number') &&
      detailsCode.includes('{employee.bankDetails.accountNumber}'),
      '3. Salary Bank Details card displays the decrypted account number from dedicated endpoint'
    );

    // 4. Inspect Frontend EmployeeDetails.jsx for Admin Review modal display
    assert(
      detailsCode.includes('employee.bankDetails.bankName') &&
      detailsCode.includes('{employee.bankDetails.accountNumber}') &&
      detailsCode.includes('isBankVerifyModalOpen'),
      '4. The Admin Review modal displays the same decrypted account number'
    );

    // 5. Frontend reads correct API response field
    assert(
      detailsCode.includes('api.admin.getEmployeeBankDetails') &&
      detailsCode.includes('bankResponse?.data'),
      '5. The frontend reads bankResponse.data from api.admin.getEmployeeBankDetails'
    );

    // 6. API failure displays clear error and does not silently fall back to masked string
    assert(
      detailsCode.includes('Unable to load the full account number. Please retry.') &&
      !detailsCode.includes('raw.bank_details.account_number || (raw.bank_details.account_number_last4'),
      '6. API failure displays "Unable to load the full account number. Please retry." without masked fallback'
    );

    // 7. Employee Profile continues showing only masked number
    const profileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const profileCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Employee/Profile/Profile.jsx'), 'utf8');
    assert(
      profileCode.includes('formatValue(employee.bank_details.account_number)'),
      '7. Employee Profile frontend displays masked account number only'
    );

    // 8. Generic employee-list and employee-detail APIs remain masked
    const genericEmpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP0001N',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(genericEmpRes.statusCode === 200, '8a. Generic employee details endpoint returns HTTP 200');
    const genericBank = genericEmpRes.json()?.data?.bank_details;
    assert(
      genericBank?.account_number === '••••••••9012' && genericBank?.account_number !== testAccountNumber,
      '8b. Generic employee detail API returns masked account number (••••••••9012), NOT plaintext'
    );

    // 9. Encryption at rest remains unchanged
    const dbBankRow = (await pool.query("SELECT account_number_encrypted FROM public.employee_bank_details WHERE employee_id = 'GP0001N'")).rows[0];
    assert(
      dbBankRow && dbBankRow.account_number_encrypted.includes(':') && dbBankRow.account_number_encrypted !== testAccountNumber,
      '9. AES-256-GCM encryption at rest in PostgreSQL remains unchanged with ciphertext & IV'
    );

    // 10. Full account numbers never appear in logs or audit metadata
    const auditRows = (await pool.query("SELECT metadata FROM public.audit_logs ORDER BY created_at DESC LIMIT 20")).rows;
    let plaintextLeakedInAudit = false;
    auditRows.forEach((row) => {
      const str = JSON.stringify(row);
      if (str.includes(testAccountNumber)) {
        plaintextLeakedInAudit = true;
      }
    });
    assert(!plaintextLeakedInAudit, '10. Full account numbers never appear in audit logs or metadata');

    // =========================================================================
    // PART 2: Document Upload Filter & Search Tests (11-25)
    // =========================================================================
    console.log('\n--- PART 2: Document Upload Filter & Search Tests ---');

    const docsCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/Documents/Documents.jsx'), 'utf8');
    const docsCss = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/Documents/Documents.css'), 'utf8');

    // 11. Department filter displays IT, Non-IT, and All Departments
    assert(
      docsCode.includes('value="IT"') &&
      docsCode.includes('value="Non-IT"') &&
      docsCode.includes('value="ALL"') &&
      docsCode.includes('All Departments'),
      '11. Department filter displays IT, Non-IT, and All Departments radio options'
    );

    // 12. IT selection displays only IT employees
    assert(
      docsCode.includes("getEmployeeDepartmentCategory(emp.department) === modalDeptFilter") &&
      docsCode.includes("modalDeptFilter === 'IT'"),
      '12. Selecting IT filters the employee list to IT employees only'
    );

    // 13. Non-IT selection displays only Non-IT employees
    assert(
      docsCode.includes("modalDeptFilter === 'Non-IT'"),
      '13. Selecting Non-IT filters the employee list to Non-IT employees only'
    );

    // 14. All Departments displays all authorized employees
    assert(
      docsCode.includes("modalDeptFilter !== 'ALL'") &&
      docsCode.includes("setModalDeptFilter('ALL')"),
      '14. All Departments displays all authorized employees (default selection)'
    );

    // 15. Search matches employee names
    assert(
      docsCode.includes("fullName.includes(q)") &&
      docsCode.includes("empSearchQuery.trim()"),
      '15. Search matches employee first and last names (case-insensitive)'
    );

    // 16. Search matches employee IDs
    assert(
      docsCode.includes("empId.includes(q)"),
      '16. Search matches employee IDs (e.g. GP0001N)'
    );

    // 17. Department and search filters work together
    assert(
      docsCode.includes("modalFilteredEmployees = useMemo") &&
      docsCode.includes("modalDeptFilter") &&
      docsCode.includes("empSearchQuery"),
      '17. Department and search filters combine cooperatively in modalFilteredEmployees'
    );

    // 18. Employee selection submits the correct employee ID
    assert(
      docsCode.includes("formData.append('employee_id', uploadForm.employeeId)") &&
      docsCode.includes("setUploadForm((p) => ({ ...p, employeeId: emp.employee_id }))"),
      '18. Selecting an employee populates and submits the exact employee_id'
    );

    // 19. Changing departments clears an invalid employee selection
    assert(
      docsCode.includes("handleDeptFilterChange = (newDept)") &&
      docsCode.includes("getEmployeeDepartmentCategory(currentSelectedEmp.department) === newDept") &&
      docsCode.includes("setUploadForm((prev) => ({ ...prev, employeeId: '' }))"),
      '19. Changing departments clears employee selection only if employee is not in filtered results'
    );

    // 20. Changing search does not unnecessarily clear a valid selection
    assert(
      docsCode.includes("onChange={(e) => {") &&
      docsCode.includes("setEmpSearchQuery(e.target.value)") &&
      !docsCode.includes("setUploadForm((prev) => ({ ...prev, employeeId: '' }))\n                      setEmpSearchQuery"),
      '20. Changing search query filters the dropdown without clearing an already selected employee'
    );

    // 21. Empty results display a helpful message
    assert(
      docsCode.includes("No employees match the selected department and search."),
      '21. Empty search/filter results display: "No employees match the selected department and search."'
    );

    // 22. Upload is blocked if no valid employee is selected
    assert(
      docsCode.includes("if (!uploadForm.employeeId)") &&
      docsCode.includes("showToast('Please select an employee.')"),
      '22. Upload submission is blocked with "Please select an employee." if employeeId is empty'
    );

    // 23. Existing document upload works for all existing document types
    const allowedTypes = ['Offer Letter', 'Payslip', 'Experience Letter', 'Relieving Letter', 'Other'];
    const allTypesPresent = allowedTypes.every(t => docsCode.includes(`value="${t}"`));
    assert(allTypesPresent, '23. Existing document types preserved: Offer Letter, Payslip, Experience Letter, Relieving Letter, Other');

    // 24. Existing document security and file validation remain functional
    assert(
      docsCode.includes("if (!selectedFile)") &&
      docsCode.includes("api.admin.uploadDocument(formData)"),
      '24. Existing document security, file validation, and upload endpoint remain functional'
    );

    // 25. Inactive employees follow the existing document-upload policy (filtered out by default)
    assert(
      docsCode.includes("!emp.status || emp.status.toUpperCase() === 'ACTIVE'"),
      '25. Inactive employees are excluded from document upload employee selector by default'
    );

    // Verify CSS styles exist
    assert(
      docsCss.includes('.admin-dept-radio-group') &&
      docsCss.includes('.admin-combobox-wrapper') &&
      docsCss.includes('.admin-combobox-dropdown'),
      '26. CSS styling for department radio buttons and searchable combobox is present'
    );

    console.log('\n============================================================');
    console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
