const path = require('path');
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.NODE_ENV = 'test';
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

async function runPhase21Tests() {
  console.log('====================================================');
  console.log('   GAINTPRO EMPLOYEE PORTAL — PHASE 21 TEST SUITE   ');
  console.log('   EMPLOYEE ONBOARDING, CREATION & PROFILE ADMIN    ');
  console.log('====================================================\n');

  // Test artifacts to clean up
  const createdEmployeeIds = [];
  const createdEmails = [];

  try {
    // 0. Fetch existing Admin and Employee tokens
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const existingEmpRes = await pool.query(
      "SELECT id, email, role, employee_id FROM public.users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' LIMIT 1"
    );

    assert(adminUserRes.rows.length > 0, 'Seed Admin user exists in database');
    assert(existingEmpRes.rows.length > 0, 'Seed Employee user exists in database');

    const adminUser = adminUserRes.rows[0];
    const existingEmp = existingEmpRes.rows[0];

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

    const empToken = generateToken({
      userId: existingEmp.id,
      email: existingEmp.email,
      role: 'EMPLOYEE',
      employeeId: existingEmp.employee_id,
    });

    // -------------------------------------------------------------------------
    // 1. AUTHENTICATION & RBAC ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('\n--- 1. AUTHENTICATION & RBAC ENFORCEMENT ---');

    // 1.1 Unauthenticated request returns 401
    const resNoAuth = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { firstName: 'Test' });
    assert(resNoAuth.statusCode === 401, '1.1 Unauthenticated POST /api/admin/employees returns 401 Unauthorized');

    // 1.2 Employee role calling POST /api/admin/employees returns 403
    const resEmpCreate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
    }, { firstName: 'Test' });
    assert(resEmpCreate.statusCode === 403, '1.2 Employee role calling POST /api/admin/employees returns 403 Forbidden');

    // 1.3 Employee role calling PUT /api/admin/employees/:id returns 403
    const resEmpEdit = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${existingEmp.employee_id}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
    }, { designation: 'Lead' });
    assert(resEmpEdit.statusCode === 403, '1.3 Employee role calling PUT /api/admin/employees/:id returns 403 Forbidden');

    // 1.4 Employee role calling PATCH /api/admin/employees/:id/status returns 403
    const resEmpStatus = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${existingEmp.employee_id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
    }, { status: 'INACTIVE' });
    assert(resEmpStatus.statusCode === 403, '1.4 Employee role calling PATCH /api/admin/employees/:id/status returns 403 Forbidden');

    // -------------------------------------------------------------------------
    // 2. INPUT VALIDATION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- 2. INPUT VALIDATION TESTS ---');

    // 2.0 Missing employee_id
    const resNoEmpId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { firstName: 'Karan', email: 'karan@gaintpro.com', department: 'Engineering', designation: 'Dev' });
    assert(resNoEmpId.statusCode === 400 && resNoEmpId.json()?.message?.includes('Employee ID'), '2.0 Missing employee_id returns 400 Bad Request');

    // 2.0b Invalid employee_id format
    const resBadEmpId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'INVALID', firstName: 'Karan', email: 'karan@gaintpro.com', department: 'Engineering', designation: 'Dev' });
    assert(resBadEmpId.statusCode === 400 && resBadEmpId.json()?.message?.includes('GP####N'), '2.0b Invalid employee_id format returns 400 Bad Request');

    // 2.1 Missing firstName
    const resNoName = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', email: 'valid@gaintpro.com', department: 'Engineering', designation: 'Dev' });
    assert(resNoName.statusCode === 400 && resNoName.json()?.message?.includes('First name'), '2.1 Missing firstName returns 400 Bad Request');

    // 2.2 Missing email
    const resNoEmail = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', department: 'Engineering', designation: 'Dev' });
    assert(resNoEmail.statusCode === 400 && resNoEmail.json()?.message?.includes('Email'), '2.2 Missing email returns 400 Bad Request');

    // 2.3 Invalid email format
    const resBadEmail = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', email: 'not-an-email', department: 'Engineering', designation: 'Dev' });
    assert(resBadEmail.statusCode === 400 && resBadEmail.json()?.message?.includes('email'), '2.3 Invalid email format returns 400 Bad Request');

    // 2.4 Missing department
    const resNoDept = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', email: 'karan@gaintpro.com', designation: 'Dev' });
    assert(resNoDept.statusCode === 400 && resNoDept.json()?.message?.includes('Department'), '2.4 Missing department returns 400 Bad Request');

    // 2.5 Missing designation
    const resNoDesig = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', email: 'karan@gaintpro.com', department: 'Engineering' });
    assert(resNoDesig.statusCode === 400 && resNoDesig.json()?.message?.includes('Designation'), '2.5 Missing designation returns 400 Bad Request');

    // 2.6 Invalid phone (not 10 digits)
    const resBadPhone = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', email: 'karan@gaintpro.com', department: 'Engineering', designation: 'Dev', phone: '123' });
    assert(resBadPhone.statusCode === 400 && resBadPhone.json()?.message?.includes('Phone'), '2.6 Invalid phone (not 10 digits) returns 400 Bad Request');

    // 2.7 Invalid date of birth
    const resBadDob = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, { employee_id: 'GP9901N', firstName: 'Karan', email: 'karan@gaintpro.com', department: 'Engineering', designation: 'Dev', dateOfBirth: '1995-13-45' });
    assert(resBadDob.statusCode === 400 && resBadDob.json()?.message?.includes('birth'), '2.7 Invalid date of birth returns 400 Bad Request');

    // 2.8 Invalid UAN format (not 12 digits)
    const resBadUan = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP9901N',
      firstName: 'Karan',
      email: 'karan@gaintpro.com',
      department: 'Engineering',
      designation: 'Dev',
      pfDetails: { uanNumber: '123' },
    });
    assert(resBadUan.statusCode === 400 && resBadUan.json()?.message?.includes('UAN'), '2.8 Invalid UAN format returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 3. DUPLICATE PROTECTION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- 3. DUPLICATE PROTECTION TESTS ---');

    // 3.1 Duplicate existing user email
    const resDupEmail = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP9902N',
      firstName: 'Duplicate',
      email: existingEmp.email, // already exists
      department: 'Engineering',
      designation: 'Developer',
      working_days_per_week: 5,
    });
    assert(resDupEmail.statusCode === 409 && resDupEmail.json()?.message?.includes('already exists'), '3.1 Submitting existing email returns 409 Conflict');

    // 3.2 Duplicate existing employee_id
    const resDupEmpId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: existingEmp.employee_id, // already exists
      firstName: 'DuplicateID',
      email: `unique.${Date.now()}@gaintpro.com`,
      department: 'Engineering',
      designation: 'Developer',
      working_days_per_week: 5,
    });
    assert(resDupEmpId.statusCode === 409 && resDupEmpId.json()?.message?.includes('Employee ID already exists'), '3.2 Submitting existing employee_id returns 409 Conflict');

    // -------------------------------------------------------------------------
    // 4. SECURITY & MASS ASSIGNMENT CONTROLS
    // -------------------------------------------------------------------------
    console.log('\n--- 4. SECURITY & MASS ASSIGNMENT CONTROLS ---');

    const testEmail1 = `test.employee.${Date.now()}@gaintpro.com`;
    createdEmails.push(testEmail1);

    // 4.1 Admin provides valid Employee ID GP0025N, attempts role escalation
    const resTamper = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP0025N', // Admin enters ID
      role: 'ADMIN',          // forged role privilege escalation
      firstName: 'Siddharth',
      lastName: 'Verma',
      email: testEmail1,
      department: 'Engineering',
      designation: 'Backend Specialist',
      phone: '9876543210',
      dateOfJoining: '2026-10-01',
      working_days_per_week: 5,
      salary: {
        basicSalary: 35000,
        hra: 14000,
        allowances: 6000,
      },
      leaveBalances: {
        paidLeave: 14,
        sickLeave: 10,
      },
      pfDetails: {
        uanNumber: '100123456789',
        pfNumber: 'TS/HYD/12345/678',
      },
    });

    assert(resTamper.statusCode === 201, '4.1 Successful onboarding with Admin-entered ID returns 201 Created');
    const onboardedData = resTamper.json()?.data;
    const generatedId = onboardedData?.employee_id;
    createdEmployeeIds.push(generatedId);

    assert(generatedId === 'GP0025N', `4.2 Server stored exact Admin-provided Employee ID: ${generatedId}`);
    assert(onboardedData?.user?.role === 'EMPLOYEE', '4.3 Server ignored client role and strictly assigned role EMPLOYEE');
    assert(onboardedData?.user?.password === undefined, '4.4 Password or credentials absent from response payload');

    // -------------------------------------------------------------------------
    // 5. ATOMIC DATA MODEL & DATABASE INTEGRITY
    // -------------------------------------------------------------------------
    console.log('\n--- 5. ATOMIC DATA MODEL & DATABASE INTEGRITY ---');

    // 5.1 Check employees table
    const dbEmpRes = await pool.query('SELECT * FROM public.employees WHERE employee_id = $1', [generatedId]);
    assert(dbEmpRes.rows.length === 1 && dbEmpRes.rows[0].first_name === 'Siddharth', '5.1 Employee record verified in public.employees');
    const dbEmp = dbEmpRes.rows[0];

    // 5.2 Check users table
    const dbUserRes = await pool.query('SELECT * FROM public.users WHERE employee_id = $1', [generatedId]);
    assert(dbUserRes.rows.length === 1 && dbUserRes.rows[0].email === testEmail1, '5.2 User account verified in public.users');
    const dbUser = dbUserRes.rows[0];

    // 5.3 Check bidirectional linking
    assert(dbEmp.user_id === dbUser.id && dbUser.employee_id === dbEmp.employee_id, '5.3 Bidirectional circular FK successfully linked');

    // 5.4 Check leave_balances table
    const dbLeaveRes = await pool.query('SELECT * FROM public.leave_balances WHERE employee_id = $1', [generatedId]);
    assert(
      dbLeaveRes.rows.length === 1 && parseFloat(dbLeaveRes.rows[0].paid_leave_balance) === 14,
      '5.4 Leave balances initialized with configured quota (14 PL)'
    );

    // 5.5 Check payroll_profiles table
    const dbPayrollRes = await pool.query('SELECT * FROM public.payroll_profiles WHERE employee_id = $1', [generatedId]);
    assert(
      dbPayrollRes.rows.length === 1 && parseFloat(dbPayrollRes.rows[0].basic_salary) === 35000,
      '5.5 Payroll profile initialized with configured basic salary (35000)'
    );

    // 5.6 Check pf_details table
    const dbPfRes = await pool.query('SELECT * FROM public.pf_details WHERE employee_id = $1', [generatedId]);
    assert(
      dbPfRes.rows.length === 1 && dbPfRes.rows[0].uan_number === '100123456789',
      '5.6 PF details initialized with supplied UAN number'
    );

    // 5.7 Check audit_logs table
    const dbAuditRes = await pool.query(
      "SELECT * FROM public.audit_logs WHERE action = 'EMPLOYEE_CREATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [generatedId]
    );
    assert(dbAuditRes.rows.length === 1, '5.7 Audit log record EMPLOYEE_CREATED successfully logged');

    // -------------------------------------------------------------------------
    // 6. IMMEDIATE AUTHENTICATION & OTP LOGIN FLOW
    // -------------------------------------------------------------------------
    console.log('\n--- 6. IMMEDIATE AUTHENTICATION & OTP LOGIN FLOW ---');

    // 6.1 Request OTP for newly created employee
    const resOtpReq = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/request-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: testEmail1 });
    assert(resOtpReq.statusCode === 200, '6.1 Newly onboarded employee can request OTP via /api/auth/request-otp');

    // 6.2 Fetch OTP from database to simulate user entering code
    const otpRowRes = await pool.query(
      'SELECT id, otp_hash FROM public.otp_verifications WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [testEmail1]
    );
    assert(otpRowRes.rows.length === 1, '6.2 OTP verification record found in database');

    // 6.3 Test authenticated session for newly created user
    const newUserToken = generateToken({
      userId: dbUser.id,
      email: testEmail1,
      role: 'EMPLOYEE',
      employeeId: generatedId,
    });

    const resProfile = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${newUserToken}` },
    });
    assert(resProfile.statusCode === 200 && resProfile.json()?.data?.employee_id === generatedId, '6.3 Newly onboarded employee can access GET /api/employee/profile');

    // -------------------------------------------------------------------------
    // 7. PROFILE EDITING API
    // -------------------------------------------------------------------------
    console.log('\n--- 7. PROFILE EDITING API ---');

    // 7.1 Admin updates allowed profile fields
    const resUpdate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${generatedId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: 'GP9999Z', // client attempt to modify immutable ID
      designation: 'Principal Architect',
      phone: '9988776655',
      city: 'Bengaluru',
      state: 'Karnataka',
    });

    assert(resUpdate.statusCode === 200, '7.1 Admin PUT /api/admin/employees/:id returns 200 OK');
    const updatedData = resUpdate.json()?.data;
    assert(updatedData?.employee_id === generatedId, '7.2 Employee ID remained immutable');
    assert(updatedData?.designation === 'Principal Architect', '7.3 Designation updated to Principal Architect');
    assert(updatedData?.city === 'Bengaluru', '7.4 City updated to Bengaluru');

    // 7.5 Database verification
    const dbUpdateCheck = await pool.query(
      'SELECT designation, city, phone FROM public.employees WHERE employee_id = $1',
      [generatedId]
    );
    assert(
      dbUpdateCheck.rows[0].designation === 'Principal Architect' && dbUpdateCheck.rows[0].phone === '9988776655',
      '7.5 Database reflects updated profile values'
    );

    // 7.6 Audit log entry
    const dbAuditUpdate = await pool.query(
      "SELECT * FROM public.audit_logs WHERE action = 'EMPLOYEE_UPDATED' AND entity_id = $1 LIMIT 1",
      [generatedId]
    );
    assert(dbAuditUpdate.rows.length === 1, '7.6 Audit log record EMPLOYEE_UPDATED successfully logged');

    // -------------------------------------------------------------------------
    // 8. ACCOUNT STATUS MANAGEMENT
    // -------------------------------------------------------------------------
    console.log('\n--- 8. ACCOUNT STATUS MANAGEMENT ---');

    // 8.1 Admin suspends employee
    const resSuspend = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${generatedId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      status: 'SUSPENDED',
      remarks: 'Temporary compliance hold',
    });

    assert(resSuspend.statusCode === 200, '8.1 Admin PATCH /api/admin/employees/:id/status returns 200 OK');
    assert(resSuspend.json()?.data?.status === 'SUSPENDED', '8.2 Response confirms status is SUSPENDED');

    // 8.3 Verify DB synchronization
    const dbStatusEmp = await pool.query('SELECT status FROM public.employees WHERE employee_id = $1', [generatedId]);
    const dbStatusUser = await pool.query('SELECT status FROM public.users WHERE employee_id = $1', [generatedId]);
    assert(dbStatusEmp.rows[0].status === 'SUSPENDED', '8.3 public.employees status is SUSPENDED');
    assert(dbStatusUser.rows[0].status === 'SUSPENDED', '8.4 public.users status is SUSPENDED');

    // 8.5 Verify activeEmployeeMiddleware blocks access with 403
    const resSuspendedAccess = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${newUserToken}` },
    });
    assert(resSuspendedAccess.statusCode === 403, '8.5 Suspended employee calling /api/employee/dashboard returns 403 Forbidden');

    // 8.6 Admin reactivates employee
    const resReactivate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${generatedId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      status: 'ACTIVE',
      remarks: 'Compliance hold cleared',
    });
    assert(resReactivate.statusCode === 200, '8.6 Admin reactivates employee to ACTIVE');

    // 8.7 Verify access restored
    const resRestoredAccess = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${newUserToken}` },
    });
    assert(resRestoredAccess.statusCode === 200, '8.7 Active employee can again access /api/employee/dashboard');

    // -------------------------------------------------------------------------
    // 9. SUPER ADMIN CAPABILITY
    // -------------------------------------------------------------------------
    console.log('\n--- 9. SUPER ADMIN CAPABILITY ---');

    const testEmail2 = `superadmin.onboard.${Date.now()}@gaintpro.com`;
    createdEmails.push(testEmail2);

    const resSuperCreate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
    }, {
      employee_id: 'GP0026N',
      firstName: 'Meera',
      lastName: 'Nair',
      email: testEmail2,
      department: 'Finance',
      designation: 'Financial Analyst',
      working_days_per_week: 5,
    });

    assert(resSuperCreate.statusCode === 201, '9.1 SUPER_ADMIN can onboard employee');
    const superEmpId = resSuperCreate.json()?.data?.employee_id;
    if (superEmpId) createdEmployeeIds.push(superEmpId);

    // -------------------------------------------------------------------------
    // 10. LISTING IN ADMIN EMPLOYEES
    // -------------------------------------------------------------------------
    console.log('\n--- 10. LISTING IN ADMIN EMPLOYEES ---');

    const resList = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees?search=${encodeURIComponent('Siddharth')}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert(resList.statusCode === 200, '10.1 Admin GET /api/admin/employees returns 200 OK');
    const matched = resList.json()?.data?.some((e) => e.employee_id === generatedId);
    assert(matched, '10.2 Newly onboarded employee appears in Admin Employees search list');

  } catch (error) {
    console.error('Fatal test execution error:', error);
    failed++;
  } finally {
    // Cleanup created test records
    console.log('\n--- CLEANING UP TEST ARTIFACTS ---');
    for (const empId of createdEmployeeIds) {
      await pool.query('DELETE FROM public.pf_details WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.audit_logs WHERE entity_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.users WHERE employee_id = $1', [empId]).catch(() => {});
      console.log(`  Cleaned up employee: ${empId}`);
    }
    for (const email of createdEmails) {
      await pool.query('DELETE FROM public.otp_verifications WHERE email = $1', [email]).catch(() => {});
      await pool.query('DELETE FROM public.users WHERE email = $1', [email]).catch(() => {});
    }
    await pool.end();
  }

  console.log('\n====================================================');
  console.log(`   PHASE 21 TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED   `);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase21Tests();
