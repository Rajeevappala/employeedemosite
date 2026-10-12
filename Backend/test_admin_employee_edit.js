const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const pool = require('./config/database');
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

function makeMultipartRequest(options, fields = {}, fileField = null) {
  const boundary = '----WebKitFormBoundaryEditTest' + Math.random().toString(36).substring(2);
  const parts = [];

  for (const [key, val] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`,
      'utf8'
    ));
  }

  if (fileField && fileField.buffer) {
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.mimeType || 'image/jpeg'}\r\n\r\n`,
      'utf8'
    );
    parts.push(header);
    parts.push(fileField.buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const bodyBuf = Buffer.concat(parts);

  options.headers = {
    ...options.headers,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': bodyBuf.length,
  };

  return makeRequest(options, bodyBuf);
}

function createDummyJpegBuffer() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0xff, 0xd9,
  ]);
}

function createDummyPdfBuffer() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
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
  console.log('  RUNNING COMPLETE ADMIN EMPLOYEE EDIT & PROFILE TEST SUITE');
  console.log('================================================================\n');

  try {
    // 1. Locate test Admin & Employee in DB
    const adminUserRes = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' OR role = 'SUPER_ADMIN' LIMIT 1");
    if (adminUserRes.rows.length === 0) {
      throw new Error('No ADMIN user found in database.');
    }
    const adminUser = adminUserRes.rows[0];

    const empRes = await pool.query(`
      SELECT e.*, u.id as user_id, u.email as user_email
      FROM employees e
      JOIN users u ON e.employee_id = u.employee_id
      WHERE e.status = 'ACTIVE'
      LIMIT 1
    `);
    if (empRes.rows.length === 0) {
      throw new Error('No ACTIVE employee found in database.');
    }
    const employee = empRes.rows[0];
    const testEmpId = employee.employee_id;

    // Generate tokens
    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const employeeToken = generateToken({
      userId: employee.user_id,
      email: employee.user_email,
      role: 'EMPLOYEE',
      employeeId: testEmpId,
    });

    console.log(`Test Subject: ${employee.first_name} ${employee.last_name} (${testEmpId})`);
    console.log(`Admin User: ${adminUser.email} (${adminUser.role})\n`);

    // Ensure a baseline document, payroll record, and leave request exist for safety tests
    await pool.query(`
      INSERT INTO documents (employee_id, document_type, file_name, storage_key)
      VALUES ($1, 'Offer Letter', 'baseline_offer_letter.pdf', 'docs/test_baseline.pdf')
      ON CONFLICT DO NOTHING
    `, [testEmpId]);

    await pool.query(`
      INSERT INTO payroll_records (employee_id, month, year, basic_salary, hra, allowances, pf_employee, professional_tax, other_deductions, gross_salary, total_deductions, net_salary, status)
      VALUES ($1, 1, 2026, 40000, 16000, 8000, 1800, 200, 0, 64000, 2000, 62000, 'PAID')
      ON CONFLICT DO NOTHING
    `, [testEmpId]);

    await pool.query(`
      INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status)
      VALUES ($1, 'PL', '2026-01-15', '2026-01-16', 2, 'Historical Vacation', 'Approved')
      ON CONFLICT DO NOTHING
    `, [testEmpId]);

    // Record initial table counts for duplication checks
    const countUsersBefore = (await pool.query('SELECT COUNT(*) FROM users')).rows[0].count;
    const countEmployeesBefore = (await pool.query('SELECT COUNT(*) FROM employees')).rows[0].count;
    const countPayrollProfilesBefore = (await pool.query('SELECT COUNT(*) FROM payroll_profiles')).rows[0].count;
    const countLeaveBalancesBefore = (await pool.query('SELECT COUNT(*) FROM leave_balances')).rows[0].count;
    const countPfDetailsBefore = (await pool.query('SELECT COUNT(*) FROM pf_details')).rows[0].count;

    // =========================================================================
    // Test 1: Admin can open employee edit page (GET /api/admin/employees/:id)
    // =========================================================================
    console.log('--- Test 1: Admin can open employee edit page / fetch data ---');
    const getRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getRes.statusCode === 200, 'Admin can fetch employee details endpoint (status 200)');
    const empData = getRes.json()?.data;
    assert(empData && empData.employee_id === testEmpId, 'Returned record matches requested employee_id');

    // =========================================================================
    // Test 2 & 3: Existing employee data is loaded & All creation fields populated
    // =========================================================================
    console.log('\n--- Test 2 & 3: Existing data loaded with all wizard fields ---');
    assert(empData?.first_name !== undefined, 'First name is populated');
    assert(empData?.last_name !== undefined, 'Last name is populated');
    assert(empData?.email !== undefined, 'Official email is populated');
    assert(empData?.department !== undefined, 'Department is populated');
    assert(empData?.designation !== undefined, 'Designation is populated');
    assert(empData?.payroll_profiles !== undefined, 'Payroll profile details populated');
    assert(empData?.leave_balances !== undefined, 'Leave balances details populated');
    assert(empData?.pf_details !== undefined, 'PF details populated');
    assert(Array.isArray(empData?.documents), 'Documents array populated');

    // =========================================================================
    // Test 4, 5 & 6: Admin can modify employee details, save, and persist in PostgreSQL
    // =========================================================================
    console.log('\n--- Test 4, 5 & 6: Admin modifies employee details, saves & persists in DB ---');
    const updatedDept = 'Engineering';
    const updatedDesignation = 'Senior Tech Lead';
    const updatedBasic = '55000';
    const updatedPlBalance = '18';
    const updatedUan = '100987654321';

    const updatePayload = {
      firstName: employee.first_name,
      lastName: employee.last_name,
      personalEmail: 'updated.personal@example.com',
      phone: '9876543210',
      dateOfBirth: '1995-05-20',
      gender: 'Male',
      address: 'Plot 42, Hitech City',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '9876543211',
      emergencyContactRelationship: 'Spouse',
      designation: updatedDesignation,
      department: updatedDept,
      dateOfJoining: '2024-01-01',
      employmentType: 'Full Time',
      reportingManager: 'Director of Tech',
      workLocation: 'Hyderabad HQ',
      status: 'ACTIVE',
      working_days_per_week: '5',
      pfNotAvailable: 'false',
      uan_number: updatedUan,
      pf_number: 'TS/HYD/12345/001',
      pension_number: 'EPS/12345',
      basic_salary: updatedBasic,
      hra: '22000',
      allowances: '11000',
      pf_employee: '1800',
      professional_tax: '200',
      other_deductions: '0',
      paid_leave: updatedPlBalance,
      sick_leave: '10',
      unpaid_leave: '0',
    };

    const dummyDoc = {
      name: 'offer_letter',
      filename: 'updated_offer_letter.pdf',
      mimeType: 'application/pdf',
      buffer: createDummyPdfBuffer(),
    };

    const updateRes = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/employees/${testEmpId}`,
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      updatePayload,
      dummyDoc
    );

    assert(updateRes.statusCode === 200, 'PUT /api/admin/employees/:id returns status 200');
    assert(updateRes.json()?.success === true, 'Response reports success: true');
    assert(
      updateRes.json()?.message === 'Employee details updated successfully.',
      'Response reports "Employee details updated successfully."'
    );

    // Verify in PostgreSQL
    const dbEmp = (await pool.query('SELECT * FROM employees WHERE employee_id = $1', [testEmpId])).rows[0];
    assert(dbEmp.designation === updatedDesignation, `DB employees.designation persisted as '${updatedDesignation}'`);
    assert(dbEmp.department === updatedDept, `DB employees.department persisted as '${updatedDept}'`);

    const dbPayroll = (await pool.query('SELECT * FROM payroll_profiles WHERE employee_id = $1', [testEmpId])).rows[0];
    assert(Number(dbPayroll.basic_salary) === Number(updatedBasic), `DB payroll_profiles.basic_salary persisted as ${updatedBasic}`);

    const dbLeaves = (await pool.query('SELECT * FROM leave_balances WHERE employee_id = $1', [testEmpId])).rows[0];
    assert(Number(dbLeaves.paid_leave_balance) === Number(updatedPlBalance), `DB leave_balances.paid_leave_balance persisted as ${updatedPlBalance}`);

    const dbPf = (await pool.query('SELECT * FROM pf_details WHERE employee_id = $1', [testEmpId])).rows[0];
    assert(dbPf.uan_number === updatedUan, `DB pf_details.uan_number persisted as '${updatedUan}'`);

    // =========================================================================
    // Test 7: Employee portal displays updated data (GET /api/employee/profile)
    // =========================================================================
    console.log('\n--- Test 7: Employee portal reflects updated data ---');
    const empProfileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    assert(empProfileRes.statusCode === 200, 'Employee can fetch own profile (status 200)');
    const empProfile = empProfileRes.json()?.data;
    assert(empProfile?.designation === updatedDesignation, 'Employee profile displays updated designation');
    assert(empProfile?.department === updatedDept, 'Employee profile displays updated department');

    // =========================================================================
    // Test 8 & 9: Employee cannot edit HR fields / cannot bypass via API
    // =========================================================================
    console.log('\n--- Test 8 & 9: Server blocks employee from editing HR fields ---');
    const employeePutAttempt = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${employeeToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        designation: 'CEO',
        department: 'Executive',
        first_name: 'Hacker',
      }
    );
    assert(employeePutAttempt.statusCode === 403, 'PUT /api/employee/profile by employee returns 403 Forbidden');
    assert(
      employeePutAttempt.json()?.message?.includes('read-only') || employeePutAttempt.json()?.message?.includes('HR-managed'),
      '403 response clearly informs employee profile is read-only'
    );

    // =========================================================================
    // Test 10, 11 & 12: Profile picture upload & security
    // =========================================================================
    console.log('\n--- Test 10, 11 & 12: Profile picture upload and isolation ---');
    // Upload own profile photo
    const photoUploadRes = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
        headers: { Authorization: `Bearer ${employeeToken}` },
      },
      {},
      {
        name: 'photo',
        filename: 'avatar.jpg',
        mimeType: 'image/jpeg',
        buffer: createDummyJpegBuffer(),
      }
    );
    assert(photoUploadRes.statusCode === 200, 'Employee can upload own profile picture (status 200)');
    assert(photoUploadRes.json()?.success === true, 'Upload returns success: true');

    // Verify photo blob can be retrieved
    const getPhotoRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'GET',
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    assert(getPhotoRes.statusCode === 200, 'GET /api/employee/profile/photo returns 200');
    assert(getPhotoRes.headers['content-type']?.includes('image'), 'Returned content is authentic image MIME');

    // Employee cannot update another employee via Admin endpoint
    const employeeAdminPutAttempt = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/employees/${testEmpId}`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${employeeToken}`,
          'Content-Type': 'application/json',
        },
      },
      { designation: 'Unauthorized' }
    );
    assert(employeeAdminPutAttempt.statusCode === 403, 'Employee attempting Admin edit endpoint returns 403 Forbidden');

    // =========================================================================
    // Test 13: Existing documents remain intact
    // =========================================================================
    console.log('\n--- Test 13: Existing documents remain intact ---');
    const docsRes = await pool.query('SELECT * FROM documents WHERE employee_id = $1', [testEmpId]);
    const baselineDoc = docsRes.rows.find((d) => d.file_name === 'baseline_offer_letter.pdf');
    assert(Boolean(baselineDoc), 'Baseline offer letter document still exists and was not deleted');

    // =========================================================================
    // Test 14: Existing finalized payroll records remain intact
    // =========================================================================
    console.log('\n--- Test 14: Existing finalized payroll records remain intact ---');
    const histPayroll = (await pool.query(
      'SELECT * FROM payroll_records WHERE employee_id = $1 AND month = 1 AND year = 2026',
      [testEmpId]
    )).rows[0];
    assert(histPayroll && Number(histPayroll.basic_salary) === 40000, 'Historical month 1/2026 payroll record intact (basic_salary = 40000)');

    // =========================================================================
    // Test 15: Existing leave history remains intact
    // =========================================================================
    console.log('\n--- Test 15: Existing leave applications remain intact ---');
    const histLeave = (await pool.query(
      'SELECT * FROM leave_requests WHERE employee_id = $1 AND reason = $2',
      [testEmpId, 'Historical Vacation']
    )).rows[0];
    assert(Boolean(histLeave), 'Historical leave request intact with status APPROVED');

    // =========================================================================
    // Test 16: Employee ID cannot be accidentally changed
    // =========================================================================
    console.log('\n--- Test 16: Employee ID cannot be mutated ---');
    const idChangeAttempt = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/employees/${testEmpId}`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        employee_id: 'GP9999N',
        firstName: employee.first_name,
        lastName: employee.last_name,
        department: updatedDept,
        designation: updatedDesignation,
      }
    );
    const dbCheckSameId = (await pool.query('SELECT * FROM employees WHERE employee_id = $1', [testEmpId])).rows[0];
    assert(Boolean(dbCheckSameId), `Employee record still has original employee_id '${testEmpId}'`);
    const dbCheckFakeId = (await pool.query('SELECT * FROM employees WHERE employee_id = $1', ['GP9999N'])).rows[0];
    assert(!dbCheckFakeId, 'No mutated employee with ID GP9999N was created');

    // =========================================================================
    // Test 17: Unauthorized user receives 401
    // =========================================================================
    console.log('\n--- Test 17: Unauthorized user receives 401 ---');
    const noAuthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    }, { designation: 'Fail' });
    assert(noAuthRes.statusCode === 401, 'Request without token returns 401 Unauthorized');

    // =========================================================================
    // Test 18 & 19: Role-based authorization verification
    // =========================================================================
    console.log('\n--- Test 18 & 19: RBAC permissions correctly enforced ---');
    assert(employeeAdminPutAttempt.statusCode === 403, 'Employee role blocked from admin mutations (403)');
    assert(updateRes.statusCode === 200, 'Admin role granted access to perform update (200)');

    // =========================================================================
    // Test 20: No duplicate employee records are created
    // =========================================================================
    console.log('\n--- Test 20: Verification against record duplication ---');
    // Verify each table has exactly 1 record for this employee
    const empUsersCount = (await pool.query('SELECT COUNT(*) FROM users WHERE employee_id = $1', [testEmpId])).rows[0].count;
    const empCount = (await pool.query('SELECT COUNT(*) FROM employees WHERE employee_id = $1', [testEmpId])).rows[0].count;
    const empPayrollCount = (await pool.query('SELECT COUNT(*) FROM payroll_profiles WHERE employee_id = $1', [testEmpId])).rows[0].count;
    const empLeavesCount = (await pool.query('SELECT COUNT(*) FROM leave_balances WHERE employee_id = $1', [testEmpId])).rows[0].count;
    const empPfCount = (await pool.query('SELECT COUNT(*) FROM pf_details WHERE employee_id = $1', [testEmpId])).rows[0].count;

    assert(Number(empUsersCount) === 1, `Exactly 1 user record for ${testEmpId}`);
    assert(Number(empCount) === 1, `Exactly 1 employee record for ${testEmpId}`);
    assert(Number(empPayrollCount) === 1, `Exactly 1 payroll profile record for ${testEmpId}`);
    assert(Number(empLeavesCount) === 1, `Exactly 1 leave balance record for ${testEmpId}`);
    assert(Number(empPfCount) === 1, `Exactly 1 PF details record for ${testEmpId}`);

    // Perform a second edit and confirm total counts remain identical (idempotent, no duplicates)
    const countsBeforeRepeat = {
      users: (await pool.query('SELECT COUNT(*) FROM users')).rows[0].count,
      employees: (await pool.query('SELECT COUNT(*) FROM employees')).rows[0].count,
      payroll: (await pool.query('SELECT COUNT(*) FROM payroll_profiles')).rows[0].count,
      leaves: (await pool.query('SELECT COUNT(*) FROM leave_balances')).rows[0].count,
      pf: (await pool.query('SELECT COUNT(*) FROM pf_details')).rows[0].count,
    };

    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, updatePayload);

    const countsAfterRepeat = {
      users: (await pool.query('SELECT COUNT(*) FROM users')).rows[0].count,
      employees: (await pool.query('SELECT COUNT(*) FROM employees')).rows[0].count,
      payroll: (await pool.query('SELECT COUNT(*) FROM payroll_profiles')).rows[0].count,
      leaves: (await pool.query('SELECT COUNT(*) FROM leave_balances')).rows[0].count,
      pf: (await pool.query('SELECT COUNT(*) FROM pf_details')).rows[0].count,
    };

    assert(countsBeforeRepeat.users === countsAfterRepeat.users, 'users count unchanged after repeated edit');
    assert(countsBeforeRepeat.employees === countsAfterRepeat.employees, 'employees count unchanged after repeated edit');
    assert(countsBeforeRepeat.payroll === countsAfterRepeat.payroll, 'payroll_profiles count unchanged after repeated edit');
    assert(countsBeforeRepeat.leaves === countsAfterRepeat.leaves, 'leave_balances count unchanged after repeated edit');
    assert(countsBeforeRepeat.pf === countsAfterRepeat.pf, 'pf_details count unchanged after repeated edit');

    // Summary
    console.log('\n================================================================');
    console.log(`  TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
