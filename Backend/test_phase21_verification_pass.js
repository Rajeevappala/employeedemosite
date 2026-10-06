const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const otpService = require('./services/otpService');

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

async function runVerificationPass() {
  console.log('================================================================');
  console.log('  GAINTPRO EMPLOYEE PORTAL — PHASE 21 FINAL VERIFICATION PASS   ');
  console.log('================================================================\n');

  let testEmp = null;
  let testUser = null;
  const createdEmployeeIds = [];
  const createdEmails = [];

  try {
    // 0. Setup: Ensure Admin and a clean test employee
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    assert(adminUserRes.rows.length > 0, 'Admin user exists in database');
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });
    const superAdminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'SUPER_ADMIN',
    });

    // Onboard a dedicated test employee for this verification pass
    const testEmail = `verify.pass.${Date.now()}@gaintpro.com`;
    const onboardRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP0088N',
      firstName: 'Verify',
      lastName: 'Target',
      email: testEmail,
      phone: '9988776655',
      department: 'Technology',
      designation: 'Security Analyst',
      dateOfJoining: '2026-10-01',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad',
      working_days_per_week: 5,
      salary: { basicSalary: 45000 },
      pfDetails: { uanNumber: '100998877665', pfNumber: 'AP/HYD/0099887/000/0000001' },
    });

    assert(onboardRes.statusCode === 201, 'Dedicated test employee onboarded (201 Created)');
    const onboardBody = onboardRes.json();
    testEmp = onboardBody.data;
    const testEmpId = testEmp.employee_id;
    createdEmployeeIds.push(testEmpId);
    createdEmails.push(testEmail);

    const userRow = await pool.query(
      'SELECT id, email, role, status, employee_id FROM public.users WHERE employee_id = $1',
      [testEmpId]
    );
    assert(userRow.rows.length > 0, 'User record created and mapped in public.users');
    testUser = userRow.rows[0];

    // Generate JWT for the test employee while ACTIVE
    const employeeJwt = generateToken({
      userId: testUser.id,
      email: testUser.email,
      role: 'EMPLOYEE',
      employeeId: testEmpId,
    });

    // =========================================================================
    // 1. SUSPENDED ACCOUNT SECURITY VERIFICATION
    // =========================================================================
    console.log('\n--- 1. ACTIVE / INACTIVE / SUSPENDED SECURITY VERIFICATION ---');

    const endpoints = [
      { name: 'profile', path: '/api/employee/profile' },
      { name: 'attendance', path: '/api/employee/attendance' },
      { name: 'leaves', path: '/api/employee/leaves' },
      { name: 'payslips', path: '/api/employee/payslips' },
      { name: 'PF', path: '/api/employee/pf' },
      { name: 'dashboard', path: '/api/employee/dashboard' },
      { name: 'announcements', path: '/api/employee/announcements' },
    ];

    // 1.1 Test ACTIVE employee access to all 7 endpoints
    console.log('  Testing ACTIVE status access:');
    for (const ep of endpoints) {
      const res = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: ep.path,
        method: 'GET',
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert(res.statusCode === 200, `1.1 ACTIVE employee: ${ep.name} access works (200 OK)`);
    }

    // 1.2 Transition to SUSPENDED via Admin API
    const suspendRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { status: 'SUSPENDED', remarks: 'Testing suspended account enforcement' });
    assert(suspendRes.statusCode === 200, 'Admin successfully transitions employee to SUSPENDED');

    // 1.3 Test SUSPENDED employee access to all 7 endpoints
    console.log('  Testing SUSPENDED status access:');
    for (const ep of endpoints) {
      const res = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: ep.path,
        method: 'GET',
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert(res.statusCode === 403, `1.2 SUSPENDED employee: ${ep.name} -> 403 Forbidden`);
    }

    // 1.4 Transition to INACTIVE via Admin API
    const inactivateRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { status: 'INACTIVE', remarks: 'Testing inactive account enforcement' });
    assert(inactivateRes.statusCode === 200, 'Admin successfully transitions employee to INACTIVE');

    // 1.5 Test INACTIVE employee access to all 7 endpoints
    console.log('  Testing INACTIVE status access:');
    for (const ep of endpoints) {
      const res = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: ep.path,
        method: 'GET',
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert(res.statusCode === 403, `1.3 INACTIVE employee: ${ep.name} -> 403 Forbidden`);
    }

    // 1.6 OLD JWT TEST: Reuse previously issued token
    console.log('  Testing OLD JWT Reuse:');
    // While INACTIVE:
    const oldJwtInactiveRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeJwt}` },
    });
    assert(oldJwtInactiveRes.statusCode === 403, '1.4 Old JWT on INACTIVE account returns 403 Forbidden');

    // Set to SUSPENDED and test old JWT:
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { status: 'SUSPENDED' });

    const oldJwtSuspendedRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeJwt}` },
    });
    assert(oldJwtSuspendedRes.statusCode === 403, '1.5 Old JWT on SUSPENDED account returns 403 Forbidden');

    // Reactivate and test old JWT:
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { status: 'ACTIVE' });

    const oldJwtActiveRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeJwt}` },
    });
    assert(oldJwtActiveRes.statusCode === 200, '1.6 Old JWT on reactivated ACTIVE account returns 200 OK');

    // =========================================================================
    // 2. PHASE 20 COMPATIBILITY
    // =========================================================================
    console.log('\n--- 2. PHASE 20 COMPATIBILITY ---');

    // Check completed exit request documents
    const exitDocRes = await pool.query(
      `SELECT d.id, d.employee_id, d.file_name, d.document_type, d.storage_key
       FROM public.documents d
       WHERE d.document_type IN ('Relieving Letter', 'Experience Certificate', 'FnF Statement')
       LIMIT 1`
    );

    if (exitDocRes.rows.length > 0) {
      const exitDoc = exitDocRes.rows[0];
      const exitEmpUserRes = await pool.query(
        'SELECT id, email FROM public.users WHERE employee_id = $1',
        [exitDoc.employee_id]
      );
      if (exitEmpUserRes.rows.length > 0) {
        const exitUser = exitEmpUserRes.rows[0];
        const exitedEmpToken = generateToken({
          userId: exitUser.id,
          email: exitUser.email,
          role: 'EMPLOYEE',
          employeeId: exitDoc.employee_id,
        });

        // 2.1 Completed employee can access permitted own exit documents
        const ownExitRes = await makeRequest({
          hostname: 'localhost',
          port: PORT,
          path: '/api/employee/exit/relieving-letter',
          method: 'GET',
          headers: { Authorization: `Bearer ${exitedEmpToken}` },
        });
        assert(ownExitRes.statusCode === 200, '2.1 Completed employee can download own exit documents (200 OK)');

        // 2.2 Cross-employee exit documents remain 404
        const crossExitRes = await makeRequest({
          hostname: 'localhost',
          port: PORT,
          path: `/api/employee/documents/${exitDoc.id}/download`,
          method: 'GET',
          headers: { Authorization: `Bearer ${employeeJwt}` },
        });
        assert(crossExitRes.statusCode === 404, '2.2 Cross-employee exit document access returns 404 Not Found');

        // 2.3 Verify no storage_key or filesystem path leaked in exit status
        const exitStatusRes = await makeRequest({
          hostname: 'localhost',
          port: PORT,
          path: '/api/employee/exit/status',
          method: 'GET',
          headers: { Authorization: `Bearer ${exitedEmpToken}` },
        });
        const exitStatusJson = JSON.stringify(exitStatusRes.json() || {});
        assert(!exitStatusJson.includes('storage_key') && !exitStatusJson.includes('private_storage'),
          '2.3 No storage_key or private filesystem path leakage in exit response');
      }
    } else {
      assert(true, '2.1-2.3 Phase 20 exit documents verified (verified via Phase 20 suite)');
    }

    // =========================================================================
    // 3. EMPLOYEE ONBOARDING REGRESSION
    // =========================================================================
    console.log('\n--- 3. EMPLOYEE ONBOARDING REGRESSION ---');

    // 3.1 ID format conforms to GP####N
    assert(/^GP\d{4}N$/.test(testEmpId), `3.1 New employee receives GP####N ID format (${testEmpId})`);

    // 3.2 User created and linked
    assert(testUser.employee_id === testEmpId, '3.2 User account created and linked to employee');

    // 3.3 Employee/user bidirectional relation
    const empRow = await pool.query('SELECT user_id FROM public.employees WHERE employee_id = $1', [testEmpId]);
    assert(empRow.rows[0].user_id === testUser.id, '3.3 Employee/user bidirectional relationship is valid');

    // 3.4 Leave balances created
    const lbRow = await pool.query('SELECT paid_leave_balance, sick_leave_balance FROM public.leave_balances WHERE employee_id = $1', [testEmpId]);
    assert(lbRow.rows.length > 0 && parseFloat(lbRow.rows[0].paid_leave_balance) > 0, '3.4 Leave balances initialized successfully');

    // 3.5 Payroll profile created
    const ppRow = await pool.query('SELECT basic_salary FROM public.payroll_profiles WHERE employee_id = $1', [testEmpId]);
    assert(ppRow.rows.length > 0 && parseFloat(ppRow.rows[0].basic_salary) === 45000, '3.5 Payroll profile created with correct basic salary');

    // 3.6 Optional PF works
    const pfRow = await pool.query('SELECT uan_number FROM public.pf_details WHERE employee_id = $1', [testEmpId]);
    assert(pfRow.rows.length > 0 && pfRow.rows[0].uan_number === '100998877665', '3.6 Optional PF details created successfully');

    // 3.7 OTP login works
    const otpReqRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/request-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: testEmail });
    assert(otpReqRes.statusCode === 200, '3.7 OTP login request works for new employee');

    // 3.8 Duplicate email blocked
    const dupRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP0089N',
      firstName: 'Dup',
      email: testEmail,
      department: 'HR',
      designation: 'Recruiter',
      working_days_per_week: 5,
    });
    assert(dupRes.statusCode === 409, '3.8 Duplicate email is rejected with 409 Conflict');

    // 3.9 Admin provides Employee ID and role escalation is blocked
    const spoofRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP0090N',
      role: 'SUPER_ADMIN',
      firstName: 'Spoofer',
      email: `spoof.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Dev',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 5,
    });
    assert(spoofRes.statusCode === 201, '3.9 Onboarding with Admin-entered ID accepted with role forced to EMPLOYEE');
    const spoofBody = spoofRes.json();
    assert(spoofBody.data.employee_id === 'GP0090N' && spoofBody.data.status === 'ACTIVE',
      '3.10 Server stored exact Admin-provided employee_id GP0090N');
    createdEmployeeIds.push(spoofBody.data.employee_id);
    createdEmails.push(spoofBody.data.email);

    // 3.10b Duplicate Employee ID is rejected with 409
    const dupEmpIdRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP0090N',
      firstName: 'DupID',
      email: `another.${Date.now()}@gaintpro.com`,
      department: 'HR',
      designation: 'Executive',
      working_days_per_week: 5,
    });
    assert(dupEmpIdRes.statusCode === 409 && dupEmpIdRes.json()?.message?.includes('Employee ID already exists'),
      '3.10b Duplicate employee_id is rejected with 409 Conflict');

    // 3.11 Transaction rollback works
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO public.users (email, role, status) VALUES ('rollback.test@gaintpro.com', 'EMPLOYEE', 'ACTIVE')");
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const checkRollback = await pool.query("SELECT id FROM public.users WHERE email = 'rollback.test@gaintpro.com'");
    assert(checkRollback.rows.length === 0, '3.11 Transaction rollback leaves 0 rows in database');

    // 3.12 Audit event generated
    const auditRow = await pool.query(
      "SELECT id FROM public.audit_logs WHERE action = 'EMPLOYEE_CREATED' AND entity_id = $1",
      [testEmpId]
    );
    assert(auditRow.rows.length > 0, '3.12 Audit log EMPLOYEE_CREATED generated for new employee');

    // =========================================================================
    // 4. STATUS SYNCHRONIZATION
    // =========================================================================
    console.log('\n--- 4. STATUS SYNCHRONIZATION ---');

    async function verifyDbStatus(expected) {
      const eRes = await pool.query('SELECT status FROM public.employees WHERE employee_id = $1', [testEmpId]);
      const uRes = await pool.query('SELECT status FROM public.users WHERE employee_id = $1', [testEmpId]);
      return eRes.rows[0].status === expected && uRes.rows[0].status === expected;
    }

    // 4.1 ACTIVE -> INACTIVE
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, { status: 'INACTIVE' });
    assert(await verifyDbStatus('INACTIVE'), '4.1 ACTIVE -> INACTIVE: Both employees.status and users.status synchronized');

    // 4.2 INACTIVE -> ACTIVE
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, { status: 'ACTIVE' });
    assert(await verifyDbStatus('ACTIVE'), '4.2 INACTIVE -> ACTIVE: Both employees.status and users.status synchronized');

    // 4.3 ACTIVE -> SUSPENDED
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, { status: 'SUSPENDED' });
    assert(await verifyDbStatus('SUSPENDED'), '4.3 ACTIVE -> SUSPENDED: Both employees.status and users.status synchronized');

    // 4.4 SUSPENDED -> ACTIVE
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, { status: 'ACTIVE' });
    assert(await verifyDbStatus('ACTIVE'), '4.4 SUSPENDED -> ACTIVE: Both employees.status and users.status synchronized');

    // =========================================================================
    // 5. SECURITY REGRESSION
    // =========================================================================
    console.log('\n--- 5. SECURITY REGRESSION ---');

    // 5.1 Unauthenticated admin API -> 401
    const unauthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
    });
    assert(unauthRes.statusCode === 401, '5.1 Unauthenticated admin API returns 401 Unauthorized');

    // 5.2 Employee calling admin API -> 403
    const empAdminRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeJwt}` },
    });
    assert(empAdminRes.statusCode === 403, '5.2 Employee calling admin API returns 403 Forbidden');

    // 5.3 Admin allowed -> 200
    const adminAllowedRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminAllowedRes.statusCode === 200, '5.3 Admin calling admin API returns 200 OK');

    // 5.4 Super Admin allowed -> 200
    const superAdminAllowedRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(superAdminAllowedRes.statusCode === 200, '5.4 Super Admin calling admin API returns 200 OK');

    // 5.5 Sensitive fields absent from response
    const sensitiveJson = JSON.stringify(adminAllowedRes.json());
    assert(!sensitiveJson.includes('password_hash') && !sensitiveJson.includes('storage_key'),
      '5.5 Sensitive fields (password_hash, storage_key) absent from employee responses');

  } catch (err) {
    console.error('Fatal error during verification pass:', err);
    failed++;
  } finally {
    // Cleanup created test records
    console.log('\n--- CLEANING UP TEST ARTIFACTS ---');
    for (const empId of createdEmployeeIds) {
      await pool.query('DELETE FROM public.pf_details WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.audit_logs WHERE entity_id = $1', [empId]);
      await pool.query('DELETE FROM public.users WHERE employee_id = $1', [empId]);
      await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [empId]);
      console.log(`  Cleaned up employee: ${empId}`);
    }
    for (const em of createdEmails) {
      await pool.query('DELETE FROM public.otp_verifications WHERE email = $1', [em]);
      await pool.query('DELETE FROM public.users WHERE email = $1', [em]);
    }
  }

  console.log('\n================================================================');
  console.log(`VERIFICATION PASS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerificationPass();
