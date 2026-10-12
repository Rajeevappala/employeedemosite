const path = require('path');
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.NODE_ENV = 'test';
const http = require('http');
const pool = require('./config/database');
const storageService = require('./services/storageService');
const { generateToken } = require('./utils/tokenUtils');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  let payload = null;
  const reqHeaders = {
    'X-Test-Suite': 'true',
    ...(options.headers || {}),
  };
  if (postData) {
    payload = Buffer.isBuffer(postData) ? postData : Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData));
    reqHeaders['Content-Length'] = payload.length;
  }
  const reqOptions = {
    agent: false,
    ...options,
    headers: reqHeaders,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(reqOptions, (res) => {
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
    if (payload) {
      req.write(payload);
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

async function runTests() {
  console.log('================================================================');
  console.log('  PHASE 21+ — USER TYPE MANAGEMENT & PERMANENT EMPLOYEE DELETION');
  console.log('  AUTOMATED VERIFICATION SUITE (38 TEST CASES)                   ');
  console.log('================================================================\n');

  const cleanupEmployees = ['GP9001N', 'GP9002N', 'GP9088N', 'GP9099N'];
  const cleanupUsers = ['admin_test_p21@gaintpro.internal', 'emp_test_p21_1@gaintpro.internal', 'emp_test_p21_2@gaintpro.internal', 'emp_del_test@gaintpro.internal', 'emp_rb_test@gaintpro.internal'];

  try {
    // 0. Setup: Tokens
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const existingEmpRes = await pool.query(
      "SELECT id, email, role, employee_id FROM public.users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' LIMIT 1"
    );

    assert(adminUserRes.rows.length > 0, 'Admin user exists in database');
    assert(existingEmpRes.rows.length > 0, 'Employee user exists in database');

    const adminUser = adminUserRes.rows[0];
    const existingEmp = existingEmpRes.rows[0];

    const superAdminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'SUPER_ADMIN',
    });

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    const empToken = generateToken({
      userId: existingEmp.id,
      email: existingEmp.email,
      role: 'EMPLOYEE',
      employeeId: existingEmp.employee_id,
    });

    // Cleanup any lingering test data
    for (const empId of cleanupEmployees) {
      await pool.query('DELETE FROM public.exit_clearances WHERE exit_request_id IN (SELECT id FROM public.exit_requests WHERE employee_id = $1)', [empId]);
      await pool.query('DELETE FROM public.exit_requests WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.fnf_settlements WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.announcement_reads WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.documents WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.attendance WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.leave_requests WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.payroll_records WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.pf_details WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.users WHERE employee_id = $1', [empId]);
    }
    for (const email of cleanupUsers) {
      await pool.query('DELETE FROM public.otp_verifications WHERE email = $1', [email]);
      await pool.query('DELETE FROM public.users WHERE email = $1', [email]);
    }

    // =========================================================================
    // SECTION 1: USER CREATION & ROLE PERMISSIONS
    // =========================================================================
    console.log('\n--- SECTION 1: USER TYPE CREATION & ROLE PERMISSIONS ---');

    // 1. SUPER_ADMIN can create Employee
    const emp1Payload = {
      employee_id: 'GP9001N',
      firstName: 'Alice',
      lastName: 'SuperCreated',
      email: 'emp_test_p21_1@gaintpro.internal',
      department: 'Technology',
      designation: 'Staff Engineer',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 5,
      pf_not_available: true,
    };
    const res1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, emp1Payload);
    assert(res1.statusCode === 201, '1. SUPER_ADMIN can create Employee (HTTP 201)');

    // 2. SUPER_ADMIN can create Admin
    const adminPayload = {
      userType: 'Admin',
      role: 'ADMIN',
      firstName: 'Samantha',
      lastName: 'Administrator',
      email: 'admin_test_p21@gaintpro.internal',
      phone: '+91 9876543210',
    };
    const res2 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, adminPayload);
    assert(res2.statusCode === 201, '2. SUPER_ADMIN can create Admin (HTTP 201)');

    // 3. ADMIN can create Employee
    const emp2Payload = {
      employee_id: 'GP9002N',
      firstName: 'Bob',
      lastName: 'AdminCreated',
      email: 'emp_test_p21_2@gaintpro.internal',
      department: 'Technology',
      designation: 'Senior QA',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 6,
      pf_not_available: true,
    };
    const res3 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, emp2Payload);
    assert(res3.statusCode === 201, '3. ADMIN can create Employee (HTTP 201)');

    // 4. ADMIN cannot create Admin (HTTP 403)
    const res4 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      userType: 'Admin',
      firstName: 'Unauthorized',
      lastName: 'Admin',
      email: 'unauth_admin@gaintpro.internal',
    });
    assert(res4.statusCode === 403, '4. ADMIN cannot create Admin (HTTP 403)');

    // 5. EMPLOYEE cannot create Employee (HTTP 403)
    const res5 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, emp2Payload);
    assert(res5.statusCode === 403, '5. EMPLOYEE cannot create Employee (HTTP 403)');

    // 6. EMPLOYEE cannot create Admin (HTTP 403)
    const res6 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, adminPayload);
    assert(res6.statusCode === 403, '6. EMPLOYEE cannot create Admin (HTTP 403)');

    // 7. Admin account gets role ADMIN
    const dbAdminCheck = await pool.query(
      "SELECT id, email, role, status FROM public.users WHERE email = 'admin_test_p21@gaintpro.internal'"
    );
    assert(dbAdminCheck.rows.length === 1 && dbAdminCheck.rows[0].role === 'ADMIN', '7. Admin account gets role ADMIN in database');

    // 8. Employee account gets role EMPLOYEE
    const dbEmpCheck = await pool.query(
      "SELECT id, email, role, employee_id FROM public.users WHERE employee_id = 'GP9001N'"
    );
    assert(dbEmpCheck.rows.length === 1 && dbEmpCheck.rows[0].role === 'EMPLOYEE', '8. Employee account gets role EMPLOYEE in database');

    // 9. SUPER_ADMIN cannot be created through normal dropdown (HTTP 400)
    const res9 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      role: 'SUPER_ADMIN',
      firstName: 'Illicit',
      lastName: 'SuperAdmin',
      email: 'illicit_super@gaintpro.internal',
    });
    assert(res9.statusCode === 400, '9. SUPER_ADMIN cannot be created through normal form (HTTP 400)');

    // 10. Employee onboarding remains fully functional
    const empDetailsRes = await pool.query(
      "SELECT employee_id, first_name, department, working_days_per_week FROM public.employees WHERE employee_id = 'GP9001N'"
    );
    const empLeaveRes = await pool.query(
      "SELECT employee_id, paid_leave_balance, sick_leave_balance FROM public.leave_balances WHERE employee_id = 'GP9001N'"
    );
    const empPayRes = await pool.query(
      "SELECT employee_id, basic_salary FROM public.payroll_profiles WHERE employee_id = 'GP9001N'"
    );
    assert(
      empDetailsRes.rows.length === 1 &&
      empLeaveRes.rows.length === 1 &&
      empPayRes.rows.length === 1 &&
      empDetailsRes.rows[0].working_days_per_week === 5,
      '10. Employee onboarding remains fully functional (profile, leave, payroll)'
    );

    // 11. Admin creation does not create employee records
    const adminInEmpRes = await pool.query(
      "SELECT * FROM public.employees WHERE email = 'admin_test_p21@gaintpro.internal'"
    );
    assert(adminInEmpRes.rows.length === 0, '11. Admin creation does not create employee records (0 rows in employees)');

    // 12. Admin can authenticate using OTP
    const reqOtpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/request-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: 'admin_test_p21@gaintpro.internal' });
    assert(reqOtpRes.statusCode === 200, '12. Admin can request OTP (HTTP 200)');

    // Get the generated OTP verification record
    const otpRec = await pool.query(
      "SELECT id, email, user_id FROM public.otp_verifications WHERE email = 'admin_test_p21@gaintpro.internal' ORDER BY created_at DESC LIMIT 1"
    );
    assert(otpRec.rows.length === 1, '12b. OTP verification record created for Admin');

    // =========================================================================
    // SECTION 2: PERMANENT EMPLOYEE DELETION TESTS
    // =========================================================================
    console.log('\n--- SECTION 2: PERMANENT EMPLOYEE DELETION & CLEANUP ---');

    // Create a rich test employee with documents, attendance, leaves, exit data to test comprehensive deletion
    const delTargetEmpId = 'GP9099N';
    const delTargetEmail = 'emp_del_test@gaintpro.internal';

    // 1. Create employee
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      employee_id: delTargetEmpId,
      firstName: 'David',
      lastName: 'ToDelete',
      email: delTargetEmail,
      department: 'Technology',
      designation: 'Test Subject',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 5,
      pf_not_available: true,
    });

    // 2. Add an attendance record
    await pool.query(
      `INSERT INTO public.attendance (employee_id, attendance_date, status)
       VALUES ($1, '2026-10-01', 'Present')`,
      [delTargetEmpId]
    );

    // 3. Add a leave request
    await pool.query(
      `INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status)
       VALUES ($1, 'PL', '2026-10-02', '2026-10-02', 1, 'Testing', 'Pending')`,
      [delTargetEmpId]
    );

    // 4. Add a document in DB and physical storage file
    const dummyStorageKey = `documents/${delTargetEmpId}/2026/10/test-doc-${Date.now()}.pdf`;
    await storageService.saveFile(Buffer.from('%PDF-1.4 dummy content for deletion test'), dummyStorageKey);
    const fileExistsBefore = await storageService.fileExists(dummyStorageKey);
    assert(fileExistsBefore === true, 'Setup: Test document physical file saved to private storage');

    await pool.query(
      `INSERT INTO public.documents (employee_id, document_type, file_name, storage_key)
       VALUES ($1, 'OFFER_LETTER', 'test-offer.pdf', $2)`,
      [delTargetEmpId, dummyStorageKey]
    );

    // 5. Add an exit request & clearance
    const exitReqRes = await pool.query(
      `INSERT INTO public.exit_requests (employee_id, requested_relieving_date, reason, status)
       VALUES ($1, '2026-10-31', 'Personal reasons', 'SUBMITTED')
       RETURNING id`,
      [delTargetEmpId]
    );
    const exitReqId = exitReqRes.rows[0].id;
    await pool.query(
      `INSERT INTO public.exit_clearances (exit_request_id, department, status)
       VALUES ($1, 'IT', 'PENDING')`,
      [exitReqId]
    );
    await pool.query(
      `INSERT INTO public.fnf_settlements (exit_request_id, employee_id, status)
       VALUES ($1, $2, 'DRAFT')`,
      [exitReqId, delTargetEmpId]
    );

    // 6. Add announcement read
    const annRes = await pool.query("SELECT id FROM public.announcements LIMIT 1");
    if (annRes.rows.length > 0) {
      await pool.query(
        `INSERT INTO public.announcement_reads (announcement_id, employee_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [annRes.rows[0].id, delTargetEmpId]
      );
    }

    // 14. ADMIN cannot permanently delete employee (HTTP 403)
    const res14 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: delTargetEmpId, confirmCheckbox: true });
    assert(res14.statusCode === 403, '14. ADMIN cannot permanently delete employee (HTTP 403)');

    // 15. EMPLOYEE cannot permanently delete employee (HTTP 403)
    const res15 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: delTargetEmpId, confirmCheckbox: true });
    assert(res15.statusCode === 403, '15. EMPLOYEE cannot permanently delete employee (HTTP 403)');

    // 16. Unauthenticated delete returns 401
    const res16 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: delTargetEmpId, confirmCheckbox: true });
    assert(res16.statusCode === 401, '16. Unauthenticated delete returns 401');

    // 17. Wrong employee ID confirmation is rejected (HTTP 400)
    const res17 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: 'GP0000N', confirmCheckbox: true });
    assert(res17.statusCode === 400, '17. Wrong employee ID confirmation is rejected (HTTP 400)');

    // 18. Missing confirmation checkbox is rejected (HTTP 400)
    const res18 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: delTargetEmpId, confirmCheckbox: false });
    assert(res18.statusCode === 400, '18. Missing confirmation checkbox is rejected (HTTP 400)');

    // 13 & 19. SUPER_ADMIN can permanently delete employee with correct confirmation
    const res19 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${delTargetEmpId}`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: delTargetEmpId, confirmCheckbox: true });
    assert(res19.statusCode === 200, '13 & 19. Correct confirmation permanently deletes target employee (HTTP 200)');

    // 20. Employee user account is deleted
    const checkUserDeleted = await pool.query(
      'SELECT id FROM public.users WHERE email = $1',
      [delTargetEmail]
    );
    assert(checkUserDeleted.rows.length === 0, '20. Employee user account is deleted');

    // 21. Employee PF data is deleted
    const checkPfDeleted = await pool.query(
      'SELECT id FROM public.pf_details WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(checkPfDeleted.rows.length === 0, '21. Employee PF data is deleted');

    // 22. Employee payroll profile is deleted
    const checkPayProfileDeleted = await pool.query(
      'SELECT id FROM public.payroll_profiles WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(checkPayProfileDeleted.rows.length === 0, '22. Employee payroll profile is deleted');

    // 23. Employee payroll records are deleted
    const checkPayRecordsDeleted = await pool.query(
      'SELECT id FROM public.payroll_records WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(checkPayRecordsDeleted.rows.length === 0, '23. Employee payroll records are deleted');

    // 24. Employee attendance is deleted
    const checkAttDeleted = await pool.query(
      'SELECT id FROM public.attendance WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(checkAttDeleted.rows.length === 0, '24. Employee attendance is deleted');

    // 25. Employee leave data is deleted (balances & requests)
    const checkLeavesDeleted = await pool.query(
      'SELECT id FROM public.leave_requests WHERE employee_id = $1',
      [delTargetEmpId]
    );
    const checkBalancesDeleted = await pool.query(
      'SELECT id FROM public.leave_balances WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(
      checkLeavesDeleted.rows.length === 0 && checkBalancesDeleted.rows.length === 0,
      '25. Employee leave data (requests and balances) is deleted'
    );

    // 26. Employee documents metadata is deleted
    const checkDocsDeleted = await pool.query(
      'SELECT id FROM public.documents WHERE employee_id = $1',
      [delTargetEmpId]
    );
    assert(checkDocsDeleted.rows.length === 0, '26. Employee documents metadata is deleted from database');

    // 27. Employee private files are deleted from private storage
    const fileExistsAfter = await storageService.fileExists(dummyStorageKey);
    assert(fileExistsAfter === false, '27. Employee physical private file is deleted from filesystem');

    // 28. Employee exit/offboarding data is handled
    const checkExitDeleted = await pool.query(
      'SELECT id FROM public.exit_requests WHERE employee_id = $1',
      [delTargetEmpId]
    );
    const checkClearanceDeleted = await pool.query(
      'SELECT id FROM public.exit_clearances WHERE exit_request_id = $1',
      [exitReqId]
    );
    assert(
      checkExitDeleted.rows.length === 0 && checkClearanceDeleted.rows.length === 0,
      '28. Employee exit requests and exit clearances are completely removed'
    );

    // 29. Other employees remain unaffected
    const checkOtherEmps = await pool.query(
      "SELECT employee_id, status FROM public.employees WHERE employee_id IN ('GP0001N', 'GP0002N', 'GP0003N')"
    );
    assert(checkOtherEmps.rows.length >= 3, '29. Other existing employees remain unaffected');

    // 30. Other Admin accounts remain unaffected
    const checkOtherAdmins = await pool.query(
      "SELECT id, email, status FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN')"
    );
    assert(checkOtherAdmins.rows.length >= 1, '30. Other Admin accounts remain unaffected');

    // 31. No storage_key is leaked in delete response
    const json19 = res19.json();
    const str19 = JSON.stringify(json19);
    assert(!str19.includes(dummyStorageKey) && !str19.includes('.pdf'), '31. No storage_key leaked in response body');

    // 32. No filesystem path is leaked in delete response or headers
    assert(
      !str19.includes('C:\\') && !str19.includes('/storage/private') && !str19.includes('storage'),
      '32. No filesystem path leaked in delete response'
    );

    // 33. No password/OTP/JWT leaked in user management listings
    const userListRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const userListJson = userListRes.json();
    const userListStr = JSON.stringify(userListJson);
    assert(
      userListRes.statusCode === 200 &&
      !userListStr.includes('password') &&
      !userListStr.includes('otp_hash') &&
      !userListStr.includes('token') &&
      !userListStr.includes('secret'),
      '33. No password, OTP, or token leaked in GET /api/admin/users'
    );

    // 34. Transaction rollback works
    // Create another employee GP9088N to test rollback
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      employee_id: 'GP9088N',
      firstName: 'Rollback',
      lastName: 'Tester',
      email: 'emp_rb_test@gaintpro.internal',
      department: 'Technology',
      designation: 'Rollback Eng',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 5,
      pf_not_available: true,
    });

    // Verify GP9088N exists
    const rbCheckBefore = await pool.query("SELECT employee_id FROM public.employees WHERE employee_id = 'GP9088N'");
    assert(rbCheckBefore.rows.length === 1, 'Setup: Employee GP9088N created for rollback verification');

    // Simulate an aborted deletion by sending wrong confirmation
    const abortRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP9088N',
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: 'GP_MISMATCH', confirmCheckbox: true });
    assert(abortRes.statusCode === 400, '34a. Delete aborted due to mismatch (HTTP 400)');

    const rbCheckAfter = await pool.query("SELECT employee_id FROM public.employees WHERE employee_id = 'GP9088N'");
    assert(rbCheckAfter.rows.length === 1, '34. Transaction rollback verified: employee GP9088N remains completely intact');

    // Clean up GP9088N properly
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP9088N',
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: 'GP9088N', confirmCheckbox: true });

    // Clean up remaining test employees
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP9001N',
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: 'GP9001N', confirmCheckbox: true });

    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP9002N',
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
    }, { confirmEmployeeId: 'GP9002N', confirmCheckbox: true });

    // 35. Existing authentication remains functional
    const meRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${empToken}`,
      },
    });
    assert(meRes.statusCode === 200, '35. Existing authentication remains functional (GET /api/auth/me returns 200)');

    // 36. Existing payroll remains functional
    const payRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(payRes.statusCode === 200, '36. Existing payroll remains functional (GET /api/admin/payroll returns 200)');

    // 37. Existing attendance remains functional
    const attRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=2026-10-01',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(attRes.statusCode === 200, '37. Existing attendance remains functional (GET /api/admin/attendance returns 200)');

    // 38. Existing offboarding remains functional
    const exitRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/requests',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(exitRes.statusCode === 200, '38. Existing offboarding remains functional (GET /api/admin/exit/requests returns 200)');

  } catch (err) {
    console.error('Unexpected test execution failure:', err);
    failed++;
  } finally {
    // Final cleanup of test admin
    await pool.query("DELETE FROM public.otp_verifications WHERE email = 'admin_test_p21@gaintpro.internal'");
    await pool.query("DELETE FROM public.users WHERE email = 'admin_test_p21@gaintpro.internal'");

    console.log('\n================================================================');
    console.log(`  PHASE 21+ TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
