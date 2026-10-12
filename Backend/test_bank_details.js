const path = require('path');
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.NODE_ENV = 'test';
const fs = require('fs');
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const {
  encryptAccountNumber,
  decryptAccountNumber,
  maskAccountNumber,
  isValidIFSC,
  isValidAccountNumber,
} = require('./services/bankEncryptionService');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  options.headers = {
    'X-Test-Suite': 'true',
    ...(options.headers || {}),
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json: () => {
            try {
              return JSON.parse(body.toString('utf8'));
            } catch {
              return null;
            }
          },
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

async function runBankDetailsTests() {
  console.log('====================================================');
  console.log('   GAINTPRO EMPLOYEE PORTAL — BANK DETAILS TEST SUITE');
  console.log('   EMPLOYEE PROFILE CLEANUP + SECURE BANK DETAILS   ');
  console.log('====================================================\n');

  try {
    // 0. Fetch test users
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const empUsersRes = await pool.query(
      "SELECT id, email, role, employee_id FROM public.users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' AND employee_id IS NOT NULL LIMIT 2"
    );

    assert(adminUserRes.rows.length > 0, 'Admin user exists in database');
    assert(empUsersRes.rows.length > 0, 'Employee user exists in database');

    const adminUser = adminUserRes.rows[0];
    const empUser1 = empUsersRes.rows[0];
    const empUser2 = empUsersRes.rows[1] || empUser1;

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    const emp1Token = generateToken({
      userId: empUser1.id,
      email: empUser1.email,
      role: 'EMPLOYEE',
      employeeId: empUser1.employee_id,
    });

    const emp2Token = generateToken({
      userId: empUser2.id,
      email: empUser2.email,
      role: 'EMPLOYEE',
      employeeId: empUser2.employee_id,
    });

    // Clean any prior test bank details for emp1
    await pool.query('DELETE FROM public.employee_bank_details WHERE employee_id = $1', [
      empUser1.employee_id,
    ]);

    // -------------------------------------------------------------------------
    // TEST 1: Employee Profile no longer displays READ-ONLY badges
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Profile Read-Only Badges Removed ---');
    const profilePath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Employee', 'Profile', 'Profile.jsx');
    const profileContent = fs.readFileSync(profilePath, 'utf8');
    const badgeCount = (profileContent.match(/readonly-badge/g) || []).length;
    const badgeTextCount = (profileContent.match(/>Read-only</g) || []).length;
    assert(badgeCount === 0 && badgeTextCount === 0, '1. Employee Profile no longer contains visible "readonly-badge" or "Read-only" tags');

    // -------------------------------------------------------------------------
    // TEST 2: Existing profile fields remain protected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Existing Profile Fields Remain Protected ---');
    const initialEmpCheck = await pool.query(
      'SELECT first_name, last_name, email FROM public.employees WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    const originalFirstName = initialEmpCheck.rows[0]?.first_name;

    const updateProfileAttempt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      first_name: 'HACKED_FIRST_NAME',
      last_name: 'HACKED_LAST_NAME',
      email: 'hacked@email.com',
    });

    const afterEmpCheck = await pool.query(
      'SELECT first_name, last_name, email FROM public.employees WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    assert(
      afterEmpCheck.rows[0]?.first_name === originalFirstName,
      '2. Protected employee profile fields (first_name, last_name, official email) remain non-editable and protected'
    );

    // -------------------------------------------------------------------------
    // TEST 3: Bank Details route loads
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Bank Details Route Loads ---');
    const getInitialBank = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const initialBankJson = getInitialBank.json();
    assert(
      getInitialBank.statusCode === 200 && initialBankJson && initialBankJson.success === true,
      '3. GET /api/employee/bank-details route loads successfully with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 4: New bank-detail forms default to IDFC Bank
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Default to IDFC Bank on New Records ---');
    const submitDefaultBank = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Test Holder One',
      // bank_name omitted -> must default to IDFC Bank
      account_number: '123456789012',
      confirm_account_number: '123456789012',
      ifsc_code: 'IDFB0040101',
      branch_name: 'Hitec City',
      branch_city: 'Hyderabad',
      branch_state: 'Telangana',
      account_type: 'Salary',
    });
    const defaultBankJson = submitDefaultBank.json();
    assert(
      (submitDefaultBank.statusCode === 200 || submitDefaultBank.statusCode === 201) &&
        defaultBankJson?.data?.bank_name === 'IDFC Bank',
      '4. New bank-detail forms default to "IDFC Bank" when bank_name is not explicitly supplied'
    );

    // -------------------------------------------------------------------------
    // TEST 5: IDFC Bank is saved correctly
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: IDFC Bank Saved to Database Correctly ---');
    const dbCheck1 = await pool.query(
      'SELECT bank_name, verification_status FROM public.employee_bank_details WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    assert(
      dbCheck1.rows[0]?.bank_name === 'IDFC Bank' && dbCheck1.rows[0]?.verification_status === 'Pending',
      '5. "IDFC Bank" is persisted in the database with verification status "Pending"'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Existing saved bank selection is preserved
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Existing Saved Bank Selection is Preserved on Update ---');
    // Set bank to another value directly in DB to test preservation
    await pool.query(
      "UPDATE public.employee_bank_details SET bank_name = 'HDFC Bank' WHERE employee_id = $1",
      [empUser1.employee_id]
    );
    // Employee updates branch city without specifying bank_name
    const updatePreserveBank = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Test Holder One',
      branch_city: 'Secunderabad',
    });
    const updatePreserveJson = updatePreserveBank.json();
    assert(
      updatePreserveJson?.data?.bank_name === 'HDFC Bank',
      '6. Existing saved bank selection ("HDFC Bank") is preserved when updating details'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Opening an existing record does not reset the bank to IDFC Bank
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Re-fetching Existing Record Preserves Bank ---');
    const fetchAgain = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const fetchAgainJson = fetchAgain.json();
    assert(
      fetchAgainJson?.data?.bank_name === 'HDFC Bank',
      '7. Opening/retrieving an existing record does not reset the bank to IDFC Bank'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Existing unsupported bank values preserved without data loss
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Legacy/Unsupported Bank Values Preserved ---');
    await pool.query(
      "UPDATE public.employee_bank_details SET bank_name = 'State Bank of India' WHERE employee_id = $1",
      [empUser1.employee_id]
    );
    const updateLegacy = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      branch_name: 'Gachibowli Main',
    });
    const updateLegacyJson = updateLegacy.json();
    assert(
      updateLegacyJson?.data?.bank_name === 'State Bank of India',
      '8. Unsupported/legacy bank values ("State Bank of India") are preserved without data loss'
    );

    // Reset back to IDFC Bank for remaining tests
    await pool.query(
      "UPDATE public.employee_bank_details SET bank_name = 'IDFC Bank' WHERE employee_id = $1",
      [empUser1.employee_id]
    );

    // -------------------------------------------------------------------------
    // TEST 9: Employee can submit valid bank details
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Valid Bank Details Submission ---');
    const submitFullValid = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Rajeev Kumar Appala',
      bank_name: 'IDFC Bank',
      account_number: '987654321012',
      confirm_account_number: '987654321012',
      ifsc_code: 'IDFB0040101',
      branch_name: 'Madhapur Branch',
      branch_city: 'Hyderabad',
      branch_state: 'Telangana',
      account_type: 'Salary',
    });
    const submitFullJson = submitFullValid.json();
    assert(
      submitFullValid.statusCode === 200 && submitFullJson?.success === true,
      '9. Employee can submit full valid bank details with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 10: Invalid IFSC is rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Invalid IFSC is Rejected ---');
    const badIfscRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Rajeev Kumar',
      ifsc_code: 'INVALID_IFSC_123',
    });
    assert(
      badIfscRes.statusCode === 400 && isValidIFSC('INVALID_IFSC_123') === false,
      '10. Invalid IFSC code format is rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 11: Invalid or missing required fields are rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: Missing Required Fields Rejected ---');
    // Clear record to test new record validation
    await pool.query('DELETE FROM public.employee_bank_details WHERE employee_id = $1', [
      empUser1.employee_id,
    ]);
    const missingHolder = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_number: '987654321012',
      ifsc_code: 'IDFB0040101',
    });
    assert(
      missingHolder.statusCode === 400,
      '11. Missing required field (account_holder_name) is rejected with HTTP 400'
    );

    // -------------------------------------------------------------------------
    // TEST 12: Mismatched account-number confirmation is rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12: Mismatched Account Confirmation Rejected ---');
    const mismatchRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Rajeev Kumar',
      account_number: '123456789012',
      confirm_account_number: '999999999999', // Mismatched!
      ifsc_code: 'IDFB0040101',
    });
    assert(
      mismatchRes.statusCode === 400,
      '12. Mismatched account number confirmation is rejected with HTTP 400'
    );

    // Submit valid record again for subsequent tests
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Rajeev Kumar Appala',
      bank_name: 'IDFC Bank',
      account_number: '987654321012',
      confirm_account_number: '987654321012',
      ifsc_code: 'IDFB0040101',
      branch_name: 'Madhapur Branch',
      account_type: 'Salary',
    });

    // -------------------------------------------------------------------------
    // TEST 13: Employee cannot access another employee's details
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 13: Employee ID spoofing prevented ---');
    // Employee 1 attempts to pass Employee 2's ID in query or body
    const spoofAttempt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/bank-details?employee_id=${empUser2.employee_id}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const spoofJson = spoofAttempt.json();
    assert(
      spoofJson?.data?.employee_id === empUser1.employee_id,
      "13. Employee identity derived strictly from session; cannot access another employee's bank details"
    );

    // -------------------------------------------------------------------------
    // TEST 14: Employee cannot access admin-only review endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 14: Employee Cannot Access Admin Review Endpoints ---');
    const empReviewAttempt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${empUser1.employee_id}/bank-details/verify`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      verification_status: 'Verified',
    });
    assert(
      empReviewAttempt.statusCode === 403,
      '14. Employee forbidden (HTTP 403) from accessing admin-only review endpoints'
    );

    // -------------------------------------------------------------------------
    // TEST 15: Admin authorization works
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 15: Admin Authorization Works ---');
    const adminGetBank = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${empUser1.employee_id}/bank-details`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(
      adminGetBank.statusCode === 200,
      '15. Admin authorization works: Admin can retrieve employee bank details summary'
    );

    // -------------------------------------------------------------------------
    // TEST 16: Unauthorized access returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 16: Unauthorized Access Returns 401 ---');
    const noTokenRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'GET',
    });
    assert(
      noTokenRes.statusCode === 401,
      '16. Unauthenticated request without token returns HTTP 401 Unauthorized'
    );

    // -------------------------------------------------------------------------
    // TEST 17: Forbidden access returns 403
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 17: Forbidden Access Returns 403 ---');
    const adminAsEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`, // Admin calling employee endpoint
      },
    });
    assert(
      adminAsEmp.statusCode === 403,
      '17. Incorrect role access returns HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------------------
    // TEST 18: Account numbers are masked in ordinary responses
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 18: Account Numbers are Masked in Responses ---');
    const empResp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const empBank = empResp.json()?.data;
    assert(
      empBank?.account_number.startsWith('••••') &&
        empBank?.account_number.endsWith('1012') &&
        !empBank?.account_number.includes('98765432'),
      '18. Account numbers are strictly masked (••••••••1012) in responses'
    );

    // -------------------------------------------------------------------------
    // TEST 19: Account numbers do not appear in audit logs
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 19: Sensitive Account Numbers Omitted from Audit Logs ---');
    const auditRes = await pool.query(
      "SELECT metadata FROM public.audit_logs WHERE entity_type = 'BANK_DETAILS' ORDER BY created_at DESC LIMIT 5"
    );
    let fullAccountFound = false;
    for (const row of auditRes.rows) {
      const metaStr = JSON.stringify(row.metadata || {});
      if (metaStr.includes('987654321012')) {
        fullAccountFound = true;
      }
    }
    assert(
      !fullAccountFound,
      '19. Plaintext account numbers do NOT appear in any audit log entries or metadata'
    );

    // -------------------------------------------------------------------------
    // TEST 20: Encryption/decryption works correctly
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 20: AES-256-GCM Encryption / Decryption ---');
    const testPlain = '554433221100';
    const encrypted = encryptAccountNumber(testPlain);
    const decrypted = decryptAccountNumber(encrypted);
    const dbRaw = await pool.query(
      'SELECT account_number_encrypted FROM public.employee_bank_details WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    const isEncryptedInDb = dbRaw.rows[0]?.account_number_encrypted.includes(':');
    assert(
      decrypted === testPlain && isEncryptedInDb && dbRaw.rows[0]?.account_number_encrypted !== '987654321012',
      '20. AES-256-GCM encryption & decryption roundtrip works and database stores encrypted ciphertext'
    );

    // -------------------------------------------------------------------------
    // TEST 21: Existing bank details preserved on partial updates
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 21: Partial Update Preserves Account & Other Fields ---');
    const partialUpdate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      branch_city: 'Cyberabad',
    });
    const partialJson = partialUpdate.json();
    assert(
      partialJson?.data?.branch_city === 'Cyberabad' &&
        partialJson?.data?.account_number_last4 === '1012' &&
        partialJson?.data?.ifsc_code === 'IDFB0040101',
      '21. Existing account encryption, IFSC, and bank details preserved on partial updates'
    );

    // -------------------------------------------------------------------------
    // TEST 22: Duplicate records prevented according to data model
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 22: Duplicate Records Prevented ---');
    const countBefore = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM public.employee_bank_details WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    // POST again should update existing row without creating duplicate
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/bank-details',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${emp1Token}`,
      },
    }, {
      account_holder_name: 'Rajeev Kumar Appala',
      branch_city: 'Hyderabad',
    });
    const countAfter = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM public.employee_bank_details WHERE employee_id = $1',
      [empUser1.employee_id]
    );
    assert(
      countBefore.rows[0]?.cnt === 1 && countAfter.rows[0]?.cnt === 1,
      '22. Unique constraint prevents duplicate bank detail records for an employee'
    );

    // -------------------------------------------------------------------------
    // TEST 23: Review and verification transitions work
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 23: Admin Verification Workflow Transitions ---');
    const verifyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${empUser1.employee_id}/bank-details/verify`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      verification_status: 'Verified',
      admin_remarks: 'Bank passbook copy verified by Accounts.',
    });
    const verifyJson = verifyRes.json();
    assert(
      verifyRes.statusCode === 200 &&
        verifyJson?.data?.verification_status === 'Verified' &&
        verifyJson?.data?.admin_remarks === 'Bank passbook copy verified by Accounts.',
      '23. Admin can verify submitted bank details with remarks ("Verified")'
    );

    // Test rejection transition
    const rejectRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${empUser1.employee_id}/bank-details/verify`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      verification_status: 'Rejected',
      admin_remarks: 'Name mismatch on statement.',
    });
    const rejectJson = rejectRes.json();
    assert(
      rejectRes.statusCode === 200 && rejectJson?.data?.verification_status === 'Rejected',
      '23b. Admin can transition status to "Rejected" with administrative remarks'
    );

    // -------------------------------------------------------------------------
    // TEST 24: Existing profile-photo upload continues working
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 24: Profile Photo Functionality Maintained ---');
    const photoGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    assert(
      photoGetRes.statusCode === 200 || photoGetRes.statusCode === 404,
      '24. Profile photo retrieval endpoint continues working cleanly'
    );

    // -------------------------------------------------------------------------
    // TEST 25: Existing payroll, PF, attendance, leave unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 25: Existing Modules Unchanged ---');
    const pfRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/pf',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const leavesRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/leaves',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    const attendanceRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    assert(
      pfRes.statusCode === 200 && leavesRes.statusCode === 200 && attendanceRes.statusCode === 200,
      '25. Existing PF, Leave, Attendance and Payroll APIs continue operating with 200 OK'
    );

    // -------------------------------------------------------------------------
    // TEST 26: Frontend Onboarding Wizard & Edit Wizard include Bank Details
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 26: Frontend Wizard Step Verification ---');
    const onboardWizardPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Employees', 'EmployeeOnboardingModal.jsx');
    const onboardContent = fs.readFileSync(onboardWizardPath, 'utf8');
    assert(
      onboardContent.includes("label: 'Bank Details'") &&
      onboardContent.includes('IDFC Bank') &&
      onboardContent.includes('bankAccountNumber') &&
      onboardContent.includes('bankConfirmAccountNumber'),
      '26a. EmployeeOnboardingModal.jsx contains dedicated Step 5 "Bank Details" with IDFC Bank default'
    );

    const editWizardPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'EmployeeEdit', 'EmployeeEdit.jsx');
    const editContent = fs.readFileSync(editWizardPath, 'utf8');
    assert(
      editContent.includes("label: 'Bank Details'") &&
      editContent.includes('bankAccountHolderName') &&
      editContent.includes('bankAccountNumber'),
      '26b. EmployeeEdit.jsx contains dedicated Step 5 "Bank Details" wizard step'
    );

    // -------------------------------------------------------------------------
    // TEST 27: Admin Onboarding with Bank Details links atomically & encrypts at rest
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 27: Admin Onboarding with Bank Details ---');
    const testEmpId1 = 'GP8881N';
    const testEmail1 = 'test.onboard.bank1@gaintpro.com';

    // Cleanup before test
    await pool.query('DELETE FROM public.employee_bank_details WHERE employee_id = $1', [testEmpId1]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [testEmpId1]);
    await pool.query('DELETE FROM public.users WHERE email = $1', [testEmail1]);

    const onboardRes1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employeeId: testEmpId1,
      firstName: 'Onboard',
      lastName: 'Tester',
      email: testEmail1,
      phone: '9888811111',
      dateOfBirth: '1992-05-15',
      gender: 'Male',
      department: 'IT',
      designation: 'Software Engineer',
      dateOfJoining: '2026-02-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      status: 'ACTIVE',
      working_days_per_week: 5,
      address: '101 Cyber Towers',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Emergency Contact',
      emergencyContactPhone: '9888822222',
      emergencyContactRelationship: 'Spouse',
      bankNotAvailable: false,
      bankAccountHolderName: 'Onboard Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '123456789012',
      bankConfirmAccountNumber: '123456789012',
      bankIfscCode: 'IDFB0001001',
      bankBranchName: 'Hitec City',
      bankBranchCity: 'Hyderabad',
      bankBranchState: 'Telangana',
      bankAccountType: 'Salary',
    });

    const onboardJson1 = onboardRes1.json();
    assert(onboardRes1.statusCode === 201, '27a. Admin successfully creates employee with bank details (HTTP 201)');
    assert(
      onboardJson1?.data?.bank_details?.account_number === '••••••••9012' &&
      onboardJson1?.data?.bank_details?.bank_name === 'IDFC Bank' &&
      onboardJson1?.data?.bank_details?.verification_status === 'Pending',
      '27b. Onboarding response returns masked bank details and Pending verification status'
    );
    assert(
      !JSON.stringify(onboardJson1).includes('123456789012'),
      '27c. Plaintext account number is NEVER leaked in onboarding response JSON'
    );

    // Verify DB encryption at rest
    const dbBankRes1 = await pool.query(
      'SELECT * FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    assert(dbBankRes1.rows.length === 1, '27d. Bank record is linked to generated employee ID in database');
    const dbBankRow1 = dbBankRes1.rows[0];
    assert(
      dbBankRow1.account_number_last4 === '9012' &&
      dbBankRow1.account_number_encrypted !== '123456789012' &&
      dbBankRow1.account_number_encrypted.includes(':'),
      '27e. Account number is encrypted at rest (contains AES-GCM IV and ciphertext)'
    );
    assert(
      decryptAccountNumber(dbBankRow1.account_number_encrypted) === '123456789012',
      '27f. Encrypted account number in database decrypts accurately using bankEncryptionService'
    );

    // -------------------------------------------------------------------------
    // TEST 28: Newly onboarded employee profile displays bank details automatically
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 28: Employee Profile Bank Details Automatic Display ---');
    const newEmpUserRes = await pool.query(
      'SELECT id, email, employee_id FROM public.users WHERE employee_id = $1',
      [testEmpId1]
    );
    const newEmpUser = newEmpUserRes.rows[0];
    const newEmpToken = generateToken({
      userId: newEmpUser.id,
      email: newEmpUser.email,
      role: 'EMPLOYEE',
      employeeId: newEmpUser.employee_id,
    });

    const newEmpProfileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${newEmpToken}`,
      },
    });
    const newEmpProfileJson = newEmpProfileRes.json();
    assert(newEmpProfileRes.statusCode === 200, '28a. Employee profile loads with HTTP 200 OK');
    assert(
      newEmpProfileJson?.data?.bank_details?.account_number === '••••••••9012' &&
      newEmpProfileJson?.data?.bank_details?.bank_name === 'IDFC Bank' &&
      newEmpProfileJson?.data?.bank_details?.ifsc_code === 'IDFB0001001' &&
      newEmpProfileJson?.data?.bank_details?.account_type === 'Salary',
      '28b. Employee profile automatically displays saved bank details with masked account number'
    );
    assert(
      !JSON.stringify(newEmpProfileJson).includes('123456789012'),
      '28c. Employee profile response never exposes complete plaintext account number'
    );

    // -------------------------------------------------------------------------
    // TEST 29: Account number confirmation mismatch on onboarding rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 29: Confirmation Mismatch Validation on Onboarding ---');
    const testEmpId2 = 'GP8882N';
    const testEmail2 = 'test.onboard.mismatch@gaintpro.com';
    const onboardMismatchRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employeeId: testEmpId2,
      firstName: 'Mismatch',
      lastName: 'Tester',
      email: testEmail2,
      phone: '9888833333',
      dateOfBirth: '1992-05-15',
      gender: 'Male',
      department: 'IT',
      designation: 'Software Engineer',
      dateOfJoining: '2026-02-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      status: 'ACTIVE',
      working_days_per_week: 5,
      address: '101 Cyber Towers',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Contact',
      emergencyContactPhone: '9888844444',
      emergencyContactRelationship: 'Friend',
      bankNotAvailable: false,
      bankAccountHolderName: 'Mismatch Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '123456789012',
      bankConfirmAccountNumber: '123456789099', // Mismatch!
      bankIfscCode: 'IDFB0001001',
    });
    assert(onboardMismatchRes.statusCode === 400, '29a. Mismatched account number confirmation is rejected with HTTP 400');
    const emp2Check = await pool.query('SELECT employee_id FROM public.employees WHERE employee_id = $1', [testEmpId2]);
    assert(emp2Check.rows.length === 0, '29b. No employee or bank records created when confirmation mismatches');

    // -------------------------------------------------------------------------
    // TEST 30: Invalid IFSC on onboarding rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 30: Invalid IFSC Validation on Onboarding ---');
    const testEmpId3 = 'GP8883N';
    const testEmail3 = 'test.onboard.ifsc@gaintpro.com';
    const onboardIfscRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employeeId: testEmpId3,
      firstName: 'IFSC',
      lastName: 'Tester',
      email: testEmail3,
      phone: '9888855555',
      dateOfBirth: '1992-05-15',
      gender: 'Male',
      department: 'IT',
      designation: 'Software Engineer',
      dateOfJoining: '2026-02-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      status: 'ACTIVE',
      working_days_per_week: 5,
      address: '101 Cyber Towers',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Contact',
      emergencyContactPhone: '9888866666',
      emergencyContactRelationship: 'Friend',
      bankNotAvailable: false,
      bankAccountHolderName: 'IFSC Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '123456789012',
      bankConfirmAccountNumber: '123456789012',
      bankIfscCode: 'INVALID_IFSC_CODE', // Invalid format!
    });
    assert(onboardIfscRes.statusCode === 400, '30. Invalid IFSC code format on onboarding is rejected with HTTP 400');

    // -------------------------------------------------------------------------
    // TEST 31: Onboarding without bank details succeeds & profile shows empty state
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 31: Onboarding without Bank Details (Empty State) ---');
    const testEmpId4 = 'GP8884N';
    const testEmail4 = 'test.onboard.nobank@gaintpro.com';

    await pool.query('DELETE FROM public.employee_bank_details WHERE employee_id = $1', [testEmpId4]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [testEmpId4]);
    await pool.query('DELETE FROM public.users WHERE email = $1', [testEmail4]);

    const onboardNoBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employeeId: testEmpId4,
      firstName: 'NoBank',
      lastName: 'Tester',
      email: testEmail4,
      phone: '9888877777',
      dateOfBirth: '1994-08-20',
      gender: 'Female',
      department: 'IT',
      designation: 'QA Engineer',
      dateOfJoining: '2026-02-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      status: 'ACTIVE',
      working_days_per_week: 5,
      address: '202 Cyber City',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Contact',
      emergencyContactPhone: '9888888888',
      emergencyContactRelationship: 'Parent',
      bankNotAvailable: true, // Optional workflow skipped
    });
    assert(onboardNoBankRes.statusCode === 201, '31a. Onboarding without bank details succeeds with HTTP 201');

    const noBankDbCheck = await pool.query(
      'SELECT * FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId4]
    );
    assert(noBankDbCheck.rows.length === 0, '31b. No fake or invalid bank record created when banking is skipped');

    const noBankEmpUserRes = await pool.query(
      'SELECT id, email, employee_id FROM public.users WHERE employee_id = $1',
      [testEmpId4]
    );
    const noBankToken = generateToken({
      userId: noBankEmpUserRes.rows[0].id,
      email: noBankEmpUserRes.rows[0].email,
      role: 'EMPLOYEE',
      employeeId: testEmpId4,
    });
    const noBankProfileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${noBankToken}`,
      },
    });
    const noBankProfileJson = noBankProfileRes.json();
    assert(
      noBankProfileJson?.data?.bank_details === null,
      '31c. Employee profile returns bank_details = null (clear empty state for UI)'
    );

    // -------------------------------------------------------------------------
    // TEST 32: Unrelated Admin Employee Edit preserves saved bank details
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 32: Unrelated Admin Edit Preserves Bank Details ---');
    const updateUnrelatedRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      designation: 'Principal Tech Lead',
      workLocation: 'Bangalore',
    });
    assert(updateUnrelatedRes.statusCode === 200, '32a. Admin can update unrelated employee fields with HTTP 200');

    const dbBankCheckAfterEdit = await pool.query(
      'SELECT * FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    assert(
      dbBankCheckAfterEdit.rows.length === 1 &&
      dbBankCheckAfterEdit.rows[0].account_number_last4 === '9012' &&
      dbBankCheckAfterEdit.rows[0].bank_name === 'IDFC Bank',
      '32b. Existing saved bank details preserved intact during unrelated employee edits'
    );

    // -------------------------------------------------------------------------
    // TEST 33: Preserving custom bank name & masked account number on Admin edit
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 33: Custom Bank Selection and Masked Retain in Edit ---');
    const updateBankCustomRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      bankName: 'Kotak Mahindra Bank',
      bankAccountNumber: '••••••••9012', // Masked string submitted
      bankConfirmAccountNumber: '••••••••9012',
      bankAccountHolderName: 'Onboard Tester',
      bankIfscCode: 'KKBK0000123',
      bankAccountType: 'Salary',
      bankBranchName: 'Gachibowli',
    });
    assert(updateBankCustomRes.statusCode === 200, '33a. Admin can update bank details using masked account number');

    const dbBankCheckCustom = await pool.query(
      'SELECT * FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    const customBankRow = dbBankCheckCustom.rows[0];
    assert(
      customBankRow.bank_name === 'Kotak Mahindra Bank' &&
      customBankRow.account_number_last4 === '9012' &&
      decryptAccountNumber(customBankRow.account_number_encrypted) === '123456789012',
      '33b. Custom bank name is saved and existing account number encryption is preserved'
    );

    // Another unrelated edit must not reset Kotak Mahindra Bank to IDFC Bank
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      designation: 'Senior Principal Engineer',
    });
    const dbBankCheckPreserve = await pool.query(
      'SELECT bank_name FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    assert(
      dbBankCheckPreserve.rows[0].bank_name === 'Kotak Mahindra Bank',
      '33c. Saved non-default bank name is never reset to IDFC Bank on unrelated edits'
    );

    // -------------------------------------------------------------------------
    // TEST 34: Atomic rollback on failed onboarding leaves no orphan bank records
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 34: Atomic Transaction & Rollback Behavior ---');
    const testEmpId5 = 'GP8885N';
    // Duplicate testEmail1 to force conflict
    const onboardConflictRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employeeId: testEmpId5,
      firstName: 'Conflict',
      lastName: 'Tester',
      email: testEmail1, // Duplicate email!
      phone: '9888899999',
      dateOfBirth: '1995-01-01',
      gender: 'Male',
      department: 'IT',
      designation: 'Software Engineer',
      dateOfJoining: '2026-02-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      status: 'ACTIVE',
      working_days_per_week: 5,
      address: '303 Cyber Towers',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Contact',
      emergencyContactPhone: '9888800000',
      emergencyContactRelationship: 'Friend',
      bankNotAvailable: false,
      bankAccountHolderName: 'Conflict Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '987654321099',
      bankConfirmAccountNumber: '987654321099',
      bankIfscCode: 'IDFB0001001',
    });
    assert(onboardConflictRes.statusCode === 409, '34a. Duplicate email onboarding is rejected with HTTP 409 Conflict');

    const orphanBankCheck = await pool.query(
      'SELECT id FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId5]
    );
    assert(orphanBankCheck.rows.length === 0, '34b. Database transaction rolled back: no orphan bank records exist');

    // -------------------------------------------------------------------------
    // TEST 35: Authorized Admin Retrieves Full Decrypted Account Number
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 35: Admin Account Number Visibility on Dedicated Review Endpoint ---');
    const adminBankReviewRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}/bank-details`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(adminBankReviewRes.statusCode === 200, '35a. Admin retrieves employee bank details successfully (HTTP 200)');
    const adminBankReviewJson = adminBankReviewRes.json();
    assert(
      adminBankReviewJson?.data?.account_number === '123456789012',
      '35b. Authorized Admin views complete decrypted account number (123456789012)'
    );
    assert(
      adminBankReviewJson?.data?.account_number_last4 === '9012',
      '35c. account_number_last4 is preserved accurately (9012)'
    );

    // -------------------------------------------------------------------------
    // TEST 36: Admin Access Follows Equal Authorization Policy
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 36: Admin Bank Details Access ---');
    const admin2Token = generateToken({
      userId: adminUser.id,
      email: 'sairajeevappala1@gmail.com',
      role: 'ADMIN',
    });
    const adminBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}/bank-details`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${admin2Token}`,
      },
    });
    assert(adminBankRes.statusCode === 200, '36a. Admin retrieves bank details successfully (HTTP 200)');
    const adminBankJson = adminBankRes.json();
    assert(
      adminBankJson?.data?.account_number === '123456789012',
      '36b. Admin views complete decrypted account number'
    );

    // -------------------------------------------------------------------------
    // TEST 37: Unauthorized Access Blocked from Full Account Number
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 37: Unauthorized Requests Cannot Retrieve Full Account Number ---');
    const empUnauthorizedBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}/bank-details`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${emp1Token}`,
      },
    });
    assert(empUnauthorizedBankRes.statusCode === 403, '37a. Employee forbidden (HTTP 403) from admin bank-details endpoint');

    const anonBankRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}/bank-details`,
      method: 'GET',
    });
    assert(anonBankRes.statusCode === 401, '37b. Unauthenticated request rejected with HTTP 401');

    // -------------------------------------------------------------------------
    // TEST 38: Employee Profile API Strictly Returns Masked Account Number
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 38: Employee Profile API Returns Masked Account Number Only ---');
    const newEmpUserToken = generateToken({
      userId: (await pool.query('SELECT id FROM public.users WHERE email = $1', [testEmail1])).rows[0].id,
      email: testEmail1,
      role: 'EMPLOYEE',
      employee_id: testEmpId1,
    });
    const empOwnProfileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${newEmpUserToken}`,
      },
    });
    assert(empOwnProfileRes.statusCode === 200, '38a. Employee profile loads with HTTP 200');
    const empOwnProfileJson = empOwnProfileRes.json();
    assert(
      empOwnProfileJson?.data?.bank_details?.account_number === '••••••••9012',
      '38b. Employee profile returns masked account number (••••••••9012)'
    );
    assert(
      !JSON.stringify(empOwnProfileJson).includes('123456789012'),
      '38c. Complete plaintext account number is NEVER exposed in employee profile response'
    );

    // -------------------------------------------------------------------------
    // TEST 39: Generic Employee Detail & List APIs Do Not Expose Full Account Number
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 39: Generic Employee APIs Do Not Return Full Account Numbers ---');
    const genericEmpDetailRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(genericEmpDetailRes.statusCode === 200, '39a. Generic employee details endpoint returns HTTP 200');
    const genericEmpJson = genericEmpDetailRes.json();
    assert(
      genericEmpJson?.data?.bank_details?.account_number === '••••••••9012',
      '39b. Generic employee details response masks account number'
    );
    assert(
      !JSON.stringify(genericEmpJson).includes('123456789012'),
      '39c. Generic employee detail does NOT leak plaintext full account number'
    );

    // -------------------------------------------------------------------------
    // TEST 40: Employee Edit Rejects Mismatched Confirmation on New Account Number
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 40: Employee Edit Rejects Mismatched Account Confirmation ---');
    const editMismatchRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      firstName: 'Onboarded',
      lastName: 'Tester',
      bankNotAvailable: false,
      bankAccountHolderName: 'Onboarded Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '112233445566',
      bankConfirmAccountNumber: '112233445577', // Mismatched!
      bankIfscCode: 'IDFB0001001',
    });
    assert(editMismatchRes.statusCode === 400, '40a. Employee Edit rejects mismatched account number confirmation with HTTP 400');

    // Verify existing bank record was not corrupted
    const editCheckRes = await pool.query(
      'SELECT account_number_last4 FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    assert(editCheckRes.rows[0]?.account_number_last4 === '9012', '40b. Existing account details preserved safely after rejected edit');

    // -------------------------------------------------------------------------
    // TEST 41: Employee Edit Masked Account Number Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 41: Employee Edit Masked Account Number Preservation ---');
    const editMaskedRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      firstName: 'Onboarded',
      lastName: 'TesterUpdated',
      bankNotAvailable: false,
      bankAccountHolderName: 'Onboarded Tester',
      bankName: 'IDFC Bank',
      bankAccountNumber: '••••••••9012', // Masked preservation!
      bankIfscCode: 'IDFB0001001',
    });
    assert(editMaskedRes.statusCode === 200, '41a. Employee Edit succeeds when preserving masked account number (HTTP 200)');
    const dbBankAfterMaskedEdit = await pool.query(
      'SELECT account_number_encrypted, account_number_last4 FROM public.employee_bank_details WHERE employee_id = $1',
      [testEmpId1]
    );
    assert(
      decryptAccountNumber(dbBankAfterMaskedEdit.rows[0].account_number_encrypted) === '123456789012',
      '41b. Original decrypted account number retained intact in database'
    );

    // -------------------------------------------------------------------------
    // TEST 42: Decryption Failure Handled Safely Without Leaking Secrets
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 42: Decryption Failure Handled Safely ---');
    // Temporarily corrupt encryption in test record to verify safe fallback
    await pool.query(
      "UPDATE public.employee_bank_details SET account_number_encrypted = 'invalid:hex:payload' WHERE employee_id = $1",
      [testEmpId1]
    );
    const corruptedReviewRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}/bank-details`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(corruptedReviewRes.statusCode === 200, '42a. API returns HTTP 200 safely on decryption error');
    const corruptedJson = corruptedReviewRes.json();
    assert(
      corruptedJson?.data?.account_number === '••••••••9012' ||
      corruptedJson?.data?.account_number_error === 'Unable to load the full account number. Please retry.',
      '42b. Decryption fallback returns safe masked string or sanitized error without crashing or exposing ciphertext'
    );
    assert(
      !JSON.stringify(corruptedJson).includes('invalid:hex:payload'),
      '42c. Ciphertext/corrupt payload is NOT leaked in the response'
    );

    // Restore valid encrypted number
    await pool.query(
      'UPDATE public.employee_bank_details SET account_number_encrypted = $1 WHERE employee_id = $2',
      [encryptAccountNumber('123456789012'), testEmpId1]
    );

    // -------------------------------------------------------------------------
    // TEST 43: Frontend Architecture & Source Code Assertions
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 43: Frontend Architecture & Verification ---');
    const sidebarCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/components/Sidebar/Sidebar.jsx'), 'utf8');
    assert(
      !sidebarCode.includes("path: '/employee/bank-details'"),
      '43a. Sidebar.jsx employeeNavItems no longer contains /employee/bank-details'
    );

    const routesCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx'), 'utf8');
    assert(
      routesCode.includes('path="bank-details" element={<Navigate to="/employee/profile" replace />}'),
      '43b. AppRoutes.jsx redirects bank-details route to /employee/profile'
    );

    const onboardingCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/Employees/EmployeeOnboardingModal.jsx'), 'utf8');
    assert(
      onboardingCode.includes('isBankMismatch'),
      '43c. EmployeeOnboardingModal.jsx derives isBankMismatch live validation state'
    );
    assert(
      onboardingCode.includes('Account numbers do not match.'),
      '43d. EmployeeOnboardingModal.jsx displays "Account numbers do not match." message'
    );
    assert(
      onboardingCode.includes('disabled={submitting || (currentStep === 5 && isBankMismatch)}'),
      '43e. EmployeeOnboardingModal.jsx disables Next Step button when mismatch exists'
    );

    const editCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeEdit/EmployeeEdit.jsx'), 'utf8');
    assert(
      editCode.includes('isEditBankMismatch'),
      '43f. EmployeeEdit.jsx derives isEditBankMismatch live validation state'
    );
    assert(
      editCode.includes('Account numbers do not match.'),
      '43g. EmployeeEdit.jsx displays "Account numbers do not match." message'
    );
    assert(
      editCode.includes('disabled={submitting || (currentStep === 5 && isEditBankMismatch)}'),
      '43h. EmployeeEdit.jsx disables Next Step button when mismatch exists'
    );

    const profileCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Employee/Profile/Profile.jsx'), 'utf8');
    assert(
      profileCode.includes('aria-labelledby="bank-details-title"'),
      '43i. Employee Profile.jsx retains Bank Details section'
    );
    assert(
      profileCode.includes('formatValue(employee.bank_details.account_number)'),
      '43j. Employee Profile.jsx displays masked account number'
    );

    const detailsCode = fs.readFileSync(path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeDetails/EmployeeDetails.jsx'), 'utf8');
    assert(
      detailsCode.includes('api.admin.getEmployeeBankDetails'),
      '43k. Admin EmployeeDetails.jsx calls dedicated getEmployeeBankDetails for authorized review'
    );

    // -------------------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM public.employee_bank_details WHERE employee_id IN ($1, $2, $3, $4, $5)', [
      testEmpId1, testEmpId2, testEmpId3, testEmpId4, testEmpId5
    ]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2, $3, $4, $5)', [
      testEmpId1, testEmpId2, testEmpId3, testEmpId4, testEmpId5
    ]);
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2, $3, $4, $5)', [
      testEmpId1, testEmpId2, testEmpId3, testEmpId4, testEmpId5
    ]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2, $3, $4, $5)', [
      testEmpId1, testEmpId2, testEmpId3, testEmpId4, testEmpId5
    ]);
    await pool.query('DELETE FROM public.users WHERE email IN ($1, $2, $3, $4)', [
      testEmail1, testEmail2, testEmail3, testEmail4
    ]);

    // Summary
    console.log('\n====================================================');
    console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

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

if (require.main === module) {
  runBankDetailsTests();
}

module.exports = runBankDetailsTests;
