require('dotenv').config();
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
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
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log(' LEAVE MANAGEMENT SETTINGS MODULE - 30 REQUIREMENTS    ');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Baseline Snapshots for Regression Safety
    // -------------------------------------------------------------------------
    const initialEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const initialBalancesRes = await pool.query(
      'SELECT employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance FROM public.leave_balances ORDER BY employee_id'
    );
    const initialLeaveRequestsRes = await pool.query(
      'SELECT id, employee_id, leave_type, status, days FROM public.leave_requests ORDER BY id'
    );
    const initialAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const initialPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');

    const initialEmpCount = parseInt(initialEmpCountRes.rows[0].count, 10);
    const initialBalances = initialBalancesRes.rows;
    const initialLeaveRequests = initialLeaveRequestsRes.rows;
    const initialAttendanceCount = parseInt(initialAttendanceCountRes.rows[0].count, 10);
    const initialPayrollCount = parseInt(initialPayrollCountRes.rows[0].count, 10);

    // Fetch test users
    const adminUserRes = await pool.query(
      `SELECT u.id, u.email, u.role FROM public.users u WHERE u.role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1`
    );
    if (adminUserRes.rows.length === 0) {
      throw new Error('No ADMIN user found in database');
    }
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    const superAdminToken = generateToken({
      id: adminUser.id,
      email: 'superadmin@gaintpro.com',
      role: 'SUPER_ADMIN',
    });

    const empUserRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u 
       JOIN public.employees e ON e.user_id = u.id 
       WHERE u.role = 'EMPLOYEE' AND e.status = 'ACTIVE' LIMIT 1`
    );
    if (empUserRes.rows.length === 0) {
      throw new Error('No ACTIVE EMPLOYEE user found in database');
    }
    const empUser = empUserRes.rows[0];
    const empToken = generateToken({
      id: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employee_id: empUser.employee_id,
    });

    // -------------------------------------------------------------------------
    // TEST 1: Leave Settings Route Exists
    // -------------------------------------------------------------------------
    console.log('--- 1. ROUTING & FRONTEND ARCHITECTURE ---');
    const appRoutesPath = path.join(__dirname, '..', 'Frontend', 'src', 'routes', 'AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');
    assert(
      appRoutesContent.includes('settings/leave') &&
      appRoutesContent.includes('AdminLeaveSettings'),
      '1. Route /admin/settings/leave is registered in AppRoutes.jsx'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Settings Card Links to Leave Settings
    // -------------------------------------------------------------------------
    const settingsPagePath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'Settings.jsx');
    const settingsPageContent = fs.readFileSync(settingsPagePath, 'utf8');
    assert(
      settingsPageContent.includes("link: '/admin/settings/leave'") &&
      settingsPageContent.includes("id: 'leaves'"),
      "2. Settings landing page card links to '/admin/settings/leave'"
    );

    // -------------------------------------------------------------------------
    // TEST 3: Page files exist
    // -------------------------------------------------------------------------
    const leaveJsxPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'Leave', 'LeaveSettings.jsx');
    const leaveCssPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'Leave', 'LeaveSettings.css');
    assert(
      fs.existsSync(leaveJsxPath) && fs.existsSync(leaveCssPath),
      '3. LeaveSettings.jsx and LeaveSettings.css files exist on filesystem'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Unauthenticated GET returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- 2. RBAC & PERMISSION ENFORCEMENT ---');
    const unauthGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/leave',
      method: 'GET',
    });
    assert(
      unauthGetRes.statusCode === 401,
      '4. Unauthenticated GET /api/admin/settings/leave returns HTTP 401'
    );

    // -------------------------------------------------------------------------
    // TEST 5: Employee GET returns 403
    // -------------------------------------------------------------------------
    const empGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/leave',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empGetRes.statusCode === 403,
      '5. Employee GET /api/admin/settings/leave returns HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Admin GET succeeds
    // -------------------------------------------------------------------------
    const adminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/leave',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminGetData = adminGetRes.json();
    assert(
      adminGetRes.statusCode === 200 && adminGetData?.success === true,
      '6. Admin GET /api/admin/settings/leave succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin GET succeeds
    // -------------------------------------------------------------------------
    const superAdminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/leave',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const superAdminGetData = superAdminGetRes.json();
    assert(
      superAdminGetRes.statusCode === 200 && superAdminGetData?.success === true,
      '7. Super Admin GET /api/admin/settings/leave succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Existing leave types represented correctly
    // -------------------------------------------------------------------------
    const leaveTypes = adminGetData?.data?.leave_types || [];
    assert(
      leaveTypes.includes('PL') &&
      leaveTypes.includes('Sick Leave') &&
      leaveTypes.includes('UPL') &&
      leaveTypes.length === 3,
      '8. Existing leave types (PL, Sick Leave, UPL) accurately exposed without inventing extra types'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Existing defaults are preserved
    // -------------------------------------------------------------------------
    const initialConfig = adminGetData?.data || {};
    assert(
      initialConfig.default_annual_paid_leave >= 0 &&
      initialConfig.default_annual_sick_leave >= 0 &&
      typeof initialConfig.allow_carry_forward === 'boolean' &&
      typeof initialConfig.require_admin_approval === 'boolean',
      '9. Default organization leave settings safely initialized and preserved'
    );

    // -------------------------------------------------------------------------
    // TEST 10: Unauthenticated PUT returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- 3. SERVER-SIDE VALIDATION & MUTATION ---');
    const unauthPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      },
      { default_annual_paid_leave: 20 }
    );
    assert(
      unauthPutRes.statusCode === 401,
      '10. Unauthenticated PUT /api/admin/settings/leave returns HTTP 401'
    );

    // -------------------------------------------------------------------------
    // TEST 11: Employee PUT returns 403
    // -------------------------------------------------------------------------
    const empPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${empToken}`,
        },
      },
      { default_annual_paid_leave: 20 }
    );
    assert(
      empPutRes.statusCode === 403,
      '11. Employee PUT /api/admin/settings/leave returns HTTP 403 Forbidden'
    );

    // Valid update payload
    const validUpdatePayload = {
      default_annual_paid_leave: 20,
      default_annual_sick_leave: 12,
      default_annual_unpaid_leave: 0,
      allow_carry_forward: true,
      max_carry_forward_days: 6,
      allow_negative_balance: false,
      require_admin_approval: true,
      minimum_leave_notice_days: 2,
      maximum_continuous_leave_days: 10,
    };

    // -------------------------------------------------------------------------
    // TEST 12: Admin can update settings
    // -------------------------------------------------------------------------
    const adminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      validUpdatePayload
    );
    assert(
      adminPutRes.statusCode === 200 && adminPutRes.json()?.success === true,
      '12. Admin PUT /api/admin/settings/leave successfully updates configuration (200)'
    );

    // -------------------------------------------------------------------------
    // TEST 13: Super Admin can update settings
    // -------------------------------------------------------------------------
    const superAdminPutPayload = {
      ...validUpdatePayload,
      default_annual_paid_leave: 21,
    };
    const superAdminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
      },
      superAdminPutPayload
    );
    assert(
      superAdminPutRes.statusCode === 200 && superAdminPutRes.json()?.data?.default_annual_paid_leave === 21,
      '13. Super Admin PUT /api/admin/settings/leave successfully updates configuration (200)'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Invalid leave allocation rejected
    // -------------------------------------------------------------------------
    const invalidAllocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_annual_paid_leave: 'twenty-one' }
    );
    assert(
      invalidAllocRes.statusCode === 400 &&
      invalidAllocRes.json()?.message?.includes('Paid Leave annual allocation must be an integer'),
      '14. Non-integer leave allocation rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 15: Negative allocation rejected
    // -------------------------------------------------------------------------
    const negativeAllocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_annual_sick_leave: -5 }
    );
    assert(
      negativeAllocRes.statusCode === 400 &&
      negativeAllocRes.json()?.message?.includes('Sick Leave annual allocation must be an integer between 0 and 365'),
      '15. Negative leave allocation rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 16: Invalid carry-forward value rejected
    // -------------------------------------------------------------------------
    const invalidCarryRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, allow_carry_forward: 'not-a-bool' }
    );
    const negativeCarryDaysRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, max_carry_forward_days: -1 }
    );
    assert(
      invalidCarryRes.statusCode === 400 && negativeCarryDaysRes.statusCode === 400,
      '16. Invalid carry forward values rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 17: Invalid notice days rejected
    // -------------------------------------------------------------------------
    const invalidNoticeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, minimum_leave_notice_days: -2 }
    );
    assert(
      invalidNoticeRes.statusCode === 400 &&
      invalidNoticeRes.json()?.message?.includes('Minimum leave notice must be an integer between 0 and 365 days'),
      '17. Invalid negative notice days rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 18: Invalid maximum continuous leave rejected
    // -------------------------------------------------------------------------
    const invalidContinuousRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, maximum_continuous_leave_days: 0 }
    );
    assert(
      invalidContinuousRes.statusCode === 400 &&
      invalidContinuousRes.json()?.message?.includes('Maximum continuous leave must be an integer between 1 and 365 days'),
      '18. Invalid continuous leave (<= 0) rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 19: Data persists
    // -------------------------------------------------------------------------
    console.log('\n--- 4. PERSISTENCE, SINGLETON & AUDIT TRAIL ---');
    const verifyGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/leave',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const persisted = verifyGetRes.json()?.data || {};
    assert(
      persisted.default_annual_paid_leave === 21 &&
      persisted.default_annual_sick_leave === 12 &&
      persisted.allow_carry_forward === true &&
      persisted.max_carry_forward_days === 6 &&
      persisted.minimum_leave_notice_days === 2 &&
      persisted.maximum_continuous_leave_days === 10,
      '19. Data persists accurately on subsequent GET requests'
    );

    // Restore standard defaults
    const standardLeavePayload = {
      default_annual_paid_leave: 18,
      default_annual_sick_leave: 10,
      default_annual_unpaid_leave: 0,
      allow_carry_forward: true,
      max_carry_forward_days: 5,
      allow_negative_balance: false,
      require_admin_approval: true,
      minimum_leave_notice_days: 1,
      maximum_continuous_leave_days: 14,
    };
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      standardLeavePayload
    );

    // -------------------------------------------------------------------------
    // TEST 20: Singleton constraint maintained
    // -------------------------------------------------------------------------
    for (let i = 0; i < 3; i++) {
      await makeRequest(
        {
          hostname: 'localhost',
          port: PORT,
          path: '/api/admin/settings/leave',
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { ...standardLeavePayload, max_carry_forward_days: 5 + i }
      );
    }
    const singletonCountRes = await pool.query('SELECT count(*) FROM public.organization_leave_settings');
    const singletonCount = parseInt(singletonCountRes.rows[0].count, 10);
    assert(
      singletonCount === 1,
      `20. Singleton constraint maintained: organization_leave_settings row count is exactly 1 (found ${singletonCount})`
    );

    // Reset back to standard
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      standardLeavePayload
    );

    // -------------------------------------------------------------------------
    // TEST 21: Audit log created
    // -------------------------------------------------------------------------
    const auditRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'LEAVE_SETTINGS_UPDATED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditRes.rows.length > 0 &&
      auditRes.rows[0].entity_type === 'LEAVE_SETTINGS' &&
      Array.isArray(auditRes.rows[0].metadata?.fields_changed),
      '21. Audit log created with action LEAVE_SETTINGS_UPDATED and fields_changed metadata'
    );

    // -------------------------------------------------------------------------
    // TEST 22: No-op update does not create duplicate audit event
    // -------------------------------------------------------------------------
    const auditCountBefore = parseInt(
      (await pool.query("SELECT count(*) FROM public.audit_logs WHERE action = 'LEAVE_SETTINGS_UPDATED'")).rows[0].count,
      10
    );
    // Send identical payload
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/leave',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      standardLeavePayload
    );
    const auditCountAfter = parseInt(
      (await pool.query("SELECT count(*) FROM public.audit_logs WHERE action = 'LEAVE_SETTINGS_UPDATED'")).rows[0].count,
      10
    );
    assert(
      auditCountBefore === auditCountAfter,
      '22. No-op update with identical settings does not generate duplicate audit event'
    );

    // -------------------------------------------------------------------------
    // TEST 23: Existing employee leave balances unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- 5. EMPLOYEE BALANCE & HISTORICAL DATA PROTECTION ---');
    const postBalancesRes = await pool.query(
      'SELECT employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance FROM public.leave_balances ORDER BY employee_id'
    );
    const postBalances = postBalancesRes.rows;
    let balancesIntact = postBalances.length === initialBalances.length;
    for (let i = 0; i < initialBalances.length; i++) {
      if (
        initialBalances[i].employee_id !== postBalances[i].employee_id ||
        Number(initialBalances[i].paid_leave_balance) !== Number(postBalances[i].paid_leave_balance) ||
        Number(initialBalances[i].sick_leave_balance) !== Number(postBalances[i].sick_leave_balance) ||
        Number(initialBalances[i].unpaid_leave_balance) !== Number(postBalances[i].unpaid_leave_balance)
      ) {
        balancesIntact = false;
        break;
      }
    }
    assert(
      balancesIntact,
      '23. Existing employee leave balances are completely untouched and unchanged in leave_balances'
    );

    // -------------------------------------------------------------------------
    // TEST 24: Existing leave requests unchanged
    // -------------------------------------------------------------------------
    const postLeaveRequestsRes = await pool.query(
      'SELECT id, employee_id, leave_type, status, days FROM public.leave_requests ORDER BY id'
    );
    const postLeaveRequests = postLeaveRequestsRes.rows;
    let requestsIntact = postLeaveRequests.length === initialLeaveRequests.length;
    for (let i = 0; i < initialLeaveRequests.length; i++) {
      if (
        initialLeaveRequests[i].id !== postLeaveRequests[i].id ||
        initialLeaveRequests[i].status !== postLeaveRequests[i].status ||
        initialLeaveRequests[i].days !== postLeaveRequests[i].days
      ) {
        requestsIntact = false;
        break;
      }
    }
    assert(
      requestsIntact,
      '24. Historical leave requests are completely unmodified (pending, approved, rejected intact)'
    );

    // -------------------------------------------------------------------------
    // TEST 25: Existing attendance unchanged
    // -------------------------------------------------------------------------
    const postAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const postAttendanceCount = parseInt(postAttendanceCountRes.rows[0].count, 10);
    assert(
      postAttendanceCount === initialAttendanceCount,
      `25. Existing attendance records unchanged (before: ${initialAttendanceCount}, after: ${postAttendanceCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 26: Existing payroll unchanged
    // -------------------------------------------------------------------------
    const postPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const postPayrollCount = parseInt(postPayrollCountRes.rows[0].count, 10);
    assert(
      postPayrollCount === initialPayrollCount,
      `26. Existing payroll records count unchanged (before: ${initialPayrollCount}, after: ${postPayrollCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 27: Existing Holiday behavior unchanged
    // -------------------------------------------------------------------------
    const holidayCheckRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=2026-10-08',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      holidayCheckRes.statusCode === 200,
      '27. Existing attendance & holiday query API operates normally (status 200)'
    );

    // -------------------------------------------------------------------------
    // TEST 28: Existing Bulk Holiday Marking still works
    // -------------------------------------------------------------------------
    const bulkHolidayTestDate = '2026-11-12';
    // Clear in case of prior test runs
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [bulkHolidayTestDate]);
    const bulkHolidayRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/attendance/mark-holiday',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { attendance_date: bulkHolidayTestDate, remarks: 'Test Organization Holiday' }
    );
    assert(
      bulkHolidayRes.statusCode === 200,
      '28. Existing Bulk Holiday Marking endpoint functions normally (status 200)'
    );
    // Cleanup test holiday
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [bulkHolidayTestDate]);

    // -------------------------------------------------------------------------
    // TEST 29: Employee leave API still works
    // -------------------------------------------------------------------------
    const empLeaveRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/leaves',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empLeaveRes.statusCode === 200 && Array.isArray(empLeaveRes.json()?.data),
      '29. Employee leave API GET /api/employee/leaves operates normally (status 200)'
    );

    // -------------------------------------------------------------------------
    // TEST 30: Admin leave API still works
    // -------------------------------------------------------------------------
    const adminLeavesRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves?page=1&limit=10',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminLeavesRes.statusCode === 200 && Array.isArray(adminLeavesRes.json()?.data),
      '30. Admin leave API GET /api/admin/leaves operates normally (status 200)'
    );

  } catch (error) {
    console.error('Test suite error:', error);
    failed++;
  } finally {
    console.log('\n========================================================');
    console.log(`TOTAL TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);
    console.log('========================================================');
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
