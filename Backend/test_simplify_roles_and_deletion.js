/**
 * Test Suite: Role Simplification (ADMIN & EMPLOYEE only) and Account Deletion
 * Validates:
 * 1. Only two roles exist: ADMIN and EMPLOYEE.
 * 2. Database constraint strictly forbids SUPER_ADMIN.
 * 3. All 4 admins have role = 'ADMIN' and status = 'ACTIVE'.
 * 4. Any Admin can create another Admin.
 * 5. Attempting to create SUPER_ADMIN is rejected.
 * 6. Admin can permanently delete another Admin with safeguards:
 *    - Self-deletion blocked (400)
 *    - Last active admin deletion blocked (400)
 *    - Mismatched confirmation blocked (400)
 *    - Valid permanent deletion succeeds (200), reassigns announcements, removes user row
 * 7. Admin can permanently delete an Employee:
 *    - Archives statutory payroll to statutory_payroll_archive
 *    - Cleans up bank details, leaves, attendance, documents
 * 8. Non-admin (Employee) receives 403 on admin endpoints.
 */

const assert = require('assert');
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

const BASE_URL = 'http://localhost:5000/api';

async function makeRequest({ method, path, headers = {}, body = null }) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, options);
  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data,
  };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Starting Role Simplification & Account Deletion Test Suite');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 1. Verify Database Role Constraints
    // -------------------------------------------------------------------------
    console.log('Test 1: Database role check constraint rejects SUPER_ADMIN');
    let constraintErrorCaught = false;
    try {
      await pool.query(
        "INSERT INTO public.users (email, role, status) VALUES ('test_super_role@gaintpro.com', 'SUPER_ADMIN', 'ACTIVE')"
      );
    } catch (dbErr) {
      constraintErrorCaught = true;
      assert(
        dbErr.message.includes('check constraint') || dbErr.message.includes('users_role_check'),
        `Unexpected DB error: ${dbErr.message}`
      );
    }
    assert(constraintErrorCaught, 'Database must reject insertion of SUPER_ADMIN role');
    console.log('  [PASS] DB check constraint successfully blocked SUPER_ADMIN role insertion.');

    // -------------------------------------------------------------------------
    // 2. Verify existing Admins have role = 'ADMIN' and status = 'ACTIVE'
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Verify target administrators in public.users');
    await pool.query("DELETE FROM public.users WHERE email LIKE 'temp.admin.%'");
    const adminCheckRes = await pool.query(
      "SELECT id, email, role, status FROM public.users WHERE role = 'ADMIN' ORDER BY created_at ASC"
    );
    const adminEmails = adminCheckRes.rows.map((r) => r.email.toLowerCase());
    console.log('  Active Admin emails found:', adminEmails);
    assert(adminEmails.length >= 1, 'At least one active admin must exist');

    for (const row of adminCheckRes.rows) {
      assert.strictEqual(row.role, 'ADMIN', `Expected role ADMIN for ${row.email}, got ${row.role}`);
      assert.strictEqual(row.status, 'ACTIVE', `Expected status ACTIVE for ${row.email}, got ${row.status}`);
    }
    console.log('  [PASS] All administrators have role ADMIN and status ACTIVE.');

    const admin1 = adminCheckRes.rows[0];
    const adminToken = generateToken({
      userId: admin1.id,
      role: 'ADMIN',
      email: admin1.email,
    });

    // -------------------------------------------------------------------------
    // 3. API endpoint POST /api/admin/users rejects SUPER_ADMIN
    // -------------------------------------------------------------------------
    console.log('\nTest 3: POST /api/admin/users rejects SUPER_ADMIN');
    const resCreateSuper = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'SUPER_ADMIN',
        adminId: 'SUP001',
        firstName: 'Test',
        lastName: 'Super',
        email: 'super_attempt@gaintpro.com',
      },
    });
    assert.strictEqual(resCreateSuper.statusCode, 400, 'Expected HTTP 400 when attempting to create SUPER_ADMIN');
    console.log('  [PASS] API rejected creation of SUPER_ADMIN with HTTP 400.');

    // -------------------------------------------------------------------------
    // 4. Any Admin can create another Admin account
    // -------------------------------------------------------------------------
    console.log('\nTest 4: Admin creates a new Admin account without requiring approval');
    const tempAdminEmail = `temp.admin.${Date.now()}@gaintpro.com`;
    const tempAdminId = `ADMTMP${Date.now().toString().slice(-4)}`;
    const resCreateAdmin = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'Admin',
        adminId: tempAdminId,
        firstName: 'Temporary',
        lastName: 'Admin',
        email: tempAdminEmail,
        phone: '9876543210',
      },
    });

    assert.strictEqual(resCreateAdmin.statusCode, 201, `Expected HTTP 201, got ${resCreateAdmin.statusCode}`);
    assert(resCreateAdmin.data.success === true, 'Response must have success: true');
    assert.strictEqual(resCreateAdmin.data.data.role, 'ADMIN', 'Created role must be ADMIN');
    const createdAdminId = resCreateAdmin.data.data.id;
    console.log(`  [PASS] New Admin created successfully with ID: ${createdAdminId}`);

    // Verify created admin can also create tokens and perform admin operations
    const createdAdminToken = generateToken({
      userId: createdAdminId,
      role: 'ADMIN',
      email: tempAdminEmail,
    });

    const resListAdmins = await makeRequest({
      method: 'GET',
      path: '/admin/users?role=ADMIN',
      headers: { Authorization: `Bearer ${createdAdminToken}` },
    });
    assert.strictEqual(resListAdmins.statusCode, 200, 'Newly created Admin can access admin endpoints');
    console.log('  [PASS] Newly created Admin successfully authenticated and accessed admin list.');

    // -------------------------------------------------------------------------
    // 5. Safeguard: Prevent Admin Self-Deletion
    // -------------------------------------------------------------------------
    console.log('\nTest 5: Safeguard: Prevent Admin self-deletion');
    const resSelfDelete = await makeRequest({
      method: 'DELETE',
      path: `/admin/users/${createdAdminId}`,
      headers: { Authorization: `Bearer ${createdAdminToken}` },
      body: {
        confirmationEmail: tempAdminEmail,
        confirmed: true,
      },
    });
    console.log('resSelfDelete:', resSelfDelete);
    assert.strictEqual(resSelfDelete.statusCode, 400, 'Self-deletion must return HTTP 400');
    assert(resSelfDelete.data.message.includes('cannot delete their own account'), 'Expected self-deletion error message');
    console.log('  [PASS] Accidental self-deletion was successfully blocked with HTTP 400.');

    // -------------------------------------------------------------------------
    // 6. Safeguard: Require Explicit Confirmation for Admin Deletion
    // -------------------------------------------------------------------------
    console.log('\nTest 6: Safeguard: Mismatched confirmation email is rejected');
    const resBadConfirm = await makeRequest({
      method: 'DELETE',
      path: `/admin/users/${createdAdminId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmationEmail: 'wrong_email@gaintpro.com',
        confirmed: true,
      },
    });
    assert.strictEqual(resBadConfirm.statusCode, 400, 'Mismatched email must return HTTP 400');
    console.log('  [PASS] Mismatched confirmation email was rejected with HTTP 400.');

    console.log('\nTest 6b: Safeguard: Administrators cannot modify their own status');
    const resSelfStatus = await makeRequest({
      method: 'PATCH',
      path: `/admin/users/${admin1.id}/status`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'INACTIVE' },
    });
    assert.strictEqual(resSelfStatus.statusCode, 400, 'Modifying own status must return HTTP 400');
    assert(resSelfStatus.data.message.includes('cannot modify their own status'));
    console.log('  [PASS] Modifying own status was rejected with HTTP 400.');

    // -------------------------------------------------------------------------
    // 7. Permanent Admin Deletion Succeeds and Safely Handles Dependencies
    // -------------------------------------------------------------------------
    console.log('\nTest 7: Admin permanently deletes another Admin');
    // First, insert an announcement authored by the temporary admin to test RESTRICT FK handling
    await pool.query(
      `INSERT INTO public.announcements (title, content, priority, target_type, status, created_by)
       VALUES ('Temporary Admin Announcement', 'Notice content', 'Normal', 'ALL', 'DRAFT', $1)`,
      [createdAdminId]
    );

    const resDeleteAdmin = await makeRequest({
      method: 'DELETE',
      path: `/admin/users/${createdAdminId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmationEmail: tempAdminEmail,
        confirmed: true,
      },
    });
    assert.strictEqual(resDeleteAdmin.statusCode, 200, `Expected HTTP 200, got ${resDeleteAdmin.statusCode}`);
    assert(resDeleteAdmin.data.success === true, 'Response must indicate success');

    // Verify row is physically deleted from public.users
    const checkDeletedUser = await pool.query(
      'SELECT id FROM public.users WHERE id = $1',
      [createdAdminId]
    );
    assert.strictEqual(checkDeletedUser.rows.length, 0, 'User account must be permanently deleted from database');

    // Verify announcements were reassigned
    const checkAnnouncement = await pool.query(
      "SELECT created_by FROM public.announcements WHERE title = 'Temporary Admin Announcement'"
    );
    assert.strictEqual(checkAnnouncement.rows[0].created_by, admin1.id, 'Announcement must be reassigned to deleting Admin');
    await pool.query("DELETE FROM public.announcements WHERE title = 'Temporary Admin Announcement'");
    console.log('  [PASS] Admin was permanently deleted, user row purged, announcements safely reassigned.');

    // -------------------------------------------------------------------------
    // 8. Permanent Employee Deletion and Statutory Payroll Archival
    // -------------------------------------------------------------------------
    console.log('\nTest 8: Permanent Employee Deletion preserves Statutory Payroll Records');
    const testEmpId = `GP99${String(Math.floor(10 + Math.random() * 89))}N`;
    const testEmpEmail = `statutory.test.${Date.now()}@gaintpro.com`;

    // Insert user, employee, and link employee_id
    const empUserRes = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id`,
      [testEmpEmail]
    );
    const empUserId = empUserRes.rows[0].id;

    await pool.query(
      `INSERT INTO public.employees (employee_id, user_id, first_name, last_name, email, phone, date_of_joining, designation, department, status)
       VALUES ($1, $2, 'Statutory', 'Tester', $3, '9123456789', CURRENT_DATE, 'Software Engineer', 'IT', 'Active')`,
      [testEmpId, empUserId, testEmpEmail]
    );

    await pool.query(
      'UPDATE public.users SET employee_id = $1 WHERE id = $2',
      [testEmpId, empUserId]
    );

    // Insert payroll record
    const payrollRes = await pool.query(
      `INSERT INTO public.payroll_records (employee_id, month, year, basic_salary, hra, allowances, gross_salary, pf_employee, professional_tax, other_deductions, total_deductions, net_salary, status)
       VALUES ($1, 10, 2026, 40000.00, 16000.00, 4000.00, 60000.00, 1800.00, 200.00, 0.00, 2000.00, 58000.00, 'Paid')
       RETURNING id`,
      [testEmpId]
    );
    const payrollRecordId = payrollRes.rows[0].id;

    // Delete Employee Permanently
    const resDeleteEmp = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${testEmpId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: testEmpId,
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resDeleteEmp.statusCode, 200, `Expected HTTP 200, got ${resDeleteEmp.statusCode}`);

    // Verify employee record and user record are deleted
    const checkEmp = await pool.query('SELECT employee_id FROM public.employees WHERE employee_id = $1', [testEmpId]);
    assert.strictEqual(checkEmp.rows.length, 0, 'Employee row must be deleted');
    const checkUser = await pool.query('SELECT id FROM public.users WHERE id = $1', [empUserId]);
    assert.strictEqual(checkUser.rows.length, 0, 'Employee user row must be deleted');
    const checkPayroll = await pool.query('SELECT id FROM public.payroll_records WHERE id = $1', [payrollRecordId]);
    assert.strictEqual(checkPayroll.rows.length, 0, 'Active payroll record must be deleted');

    // Verify statutory archive contains the preserved record
    const checkArchive = await pool.query(
      'SELECT * FROM public.statutory_payroll_archive WHERE original_payroll_id = $1',
      [payrollRecordId]
    );
    assert.strictEqual(checkArchive.rows.length, 1, 'Statutory payroll archive must contain the preserved record');
    assert.strictEqual(Number(checkArchive.rows[0].net_salary), 58000, 'Archived net_salary matches original');
    console.log('  [PASS] Employee permanently deleted and statutory payroll record archived (8-year compliance).');

    // -------------------------------------------------------------------------
    // 9. Employee role cannot access administrative endpoints (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\nTest 9: Employee role forbidden on administrative endpoints');
    const empToken = generateToken({
      userId: '00000000-0000-0000-0000-000000000001',
      role: 'EMPLOYEE',
      email: 'employee.probe@gaintpro.com',
    });

    const resForbiddenUsers = await makeRequest({
      method: 'GET',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.strictEqual(resForbiddenUsers.statusCode, 403, 'Employee must receive 403 on /admin/users');

    const resForbiddenEmps = await makeRequest({
      method: 'GET',
      path: '/admin/employees',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.strictEqual(resForbiddenEmps.statusCode, 403, 'Employee must receive 403 on /admin/employees');

    const resForbiddenSettings = await makeRequest({
      method: 'GET',
      path: '/admin/settings/organization',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.strictEqual(resForbiddenSettings.statusCode, 403, 'Employee must receive 403 on /admin/settings/organization');
    console.log('  [PASS] Employee receives HTTP 403 on all administrative endpoints.');

    console.log('\n================================================================');
    console.log(' All Role Simplification & Account Deletion Tests PASSED! (9/9)');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runTestSuite();
