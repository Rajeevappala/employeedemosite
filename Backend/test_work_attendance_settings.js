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
  console.log(' WORK & ATTENDANCE SETTINGS MODULE - 30 REQUIREMENTS    ');
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
    const initialEmpSchedulesRes = await pool.query('SELECT employee_id, working_days_per_week FROM public.employees ORDER BY employee_id');
    const initialAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const initialPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const initialLeaveCountRes = await pool.query('SELECT count(*) FROM public.leave_requests');

    const initialEmpCount = parseInt(initialEmpCountRes.rows[0].count, 10);
    const initialEmpSchedules = initialEmpSchedulesRes.rows;
    const initialAttendanceCount = parseInt(initialAttendanceCountRes.rows[0].count, 10);
    const initialPayrollCount = parseInt(initialPayrollCountRes.rows[0].count, 10);
    const initialLeaveCount = parseInt(initialLeaveCountRes.rows[0].count, 10);

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
      throw new Error('No active EMPLOYEE user found in database');
    }
    const empUser = empUserRes.rows[0];
    const empToken = generateToken({
      id: empUser.id,
      email: empUser.email,
      role: empUser.role,
      employee_id: empUser.employee_id,
    });

    // -------------------------------------------------------------------------
    // TEST 1: Work & Attendance route exists
    // -------------------------------------------------------------------------
    console.log('\n--- 1. ROUTING & FILE SYSTEM INTEGRITY ---');
    const appRoutesPath = path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');
    assert(
      appRoutesContent.includes('<Route path="settings/work-attendance" element={<AdminWorkAttendanceSettings />} />'),
      '1. Work & Attendance route exists in AppRoutes.jsx (/admin/settings/work-attendance)'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Settings card links correctly
    // -------------------------------------------------------------------------
    const settingsLandingJsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Settings.jsx');
    const settingsLandingContent = fs.readFileSync(settingsLandingJsxPath, 'utf8');
    assert(
      settingsLandingContent.includes('/admin/settings/work-attendance'),
      '2. Settings landing page provides a direct clickable link to /admin/settings/work-attendance'
    );

    // -------------------------------------------------------------------------
    // TEST 3: Page files exist
    // -------------------------------------------------------------------------
    const workSettingsJsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/WorkAttendance/WorkAttendanceSettings.jsx');
    const workSettingsCssPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/WorkAttendance/WorkAttendanceSettings.css');
    assert(
      fs.existsSync(workSettingsJsxPath) && fs.existsSync(workSettingsCssPath),
      '3. Page files exist: WorkAttendanceSettings.jsx and WorkAttendanceSettings.css'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Unauthenticated GET returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- 2. RBAC & SECURITY VERIFICATION ---');
    const unauthGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/work-attendance',
      method: 'GET',
    });
    assert(
      unauthGetRes.statusCode === 401,
      `4. Unauthenticated GET returns 401 Unauthorized (got ${unauthGetRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Employee GET returns 403
    // -------------------------------------------------------------------------
    const empGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/work-attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empGetRes.statusCode === 403,
      `5. Employee GET returns 403 Forbidden (got ${empGetRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Admin GET succeeds
    // -------------------------------------------------------------------------
    const adminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/work-attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminGetRes.statusCode === 200,
      `6. Admin GET succeeds with status 200`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin GET succeeds
    // -------------------------------------------------------------------------
    const superAdminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/work-attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(
      superAdminGetRes.statusCode === 200,
      `7. Super Admin GET succeeds with status 200`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Defaults are returned correctly
    // -------------------------------------------------------------------------
    const initialConfig = adminGetRes.json()?.data || {};
    assert(
      initialConfig.default_work_week === '5-Day Work Week' &&
      initialConfig.default_work_start_time.startsWith('09:30') &&
      initialConfig.default_work_end_time.startsWith('18:30') &&
      initialConfig.default_break_duration_minutes === 60 &&
      Array.isArray(initialConfig.default_weekly_off_days) &&
      initialConfig.default_weekly_off_days.includes('Sunday') &&
      initialConfig.allow_half_day === true &&
      initialConfig.allow_work_from_home === true,
      `8. Defaults returned correctly (5-Day, 09:30, 18:30, 60m break, weekend offs, rules enabled)`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Unauthenticated PUT returns 401
    // -------------------------------------------------------------------------
    const unauthPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      },
      { default_work_week: '6-Day Work Week' }
    );
    assert(
      unauthPutRes.statusCode === 401,
      `9. Unauthenticated PUT returns 401 Unauthorized (got ${unauthPutRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 10: Employee PUT returns 403
    // -------------------------------------------------------------------------
    const empPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${empToken}`,
        },
      },
      { default_work_week: '6-Day Work Week' }
    );
    assert(
      empPutRes.statusCode === 403,
      `10. Employee PUT returns 403 Forbidden (got ${empPutRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 11: Admin can update settings
    // -------------------------------------------------------------------------
    console.log('\n--- 3. MUTATION & SERVER-SIDE VALIDATION ---');
    const validUpdatePayload = {
      default_work_week: '6-Day Work Week',
      default_work_start_time: '10:00:00',
      default_work_end_time: '19:00:00',
      default_break_duration_minutes: 45,
      default_weekly_off_days: ['Sunday'],
      allow_half_day: true,
      allow_work_from_home: false,
    };

    const adminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      validUpdatePayload
    );
    assert(
      adminPutRes.statusCode === 200,
      `11. Admin can update settings successfully (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 12: Super Admin can update settings
    // -------------------------------------------------------------------------
    const superAdminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
      },
      validUpdatePayload
    );
    assert(
      superAdminPutRes.statusCode === 200,
      `12. Super Admin can update settings successfully (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Invalid work week rejected
    // -------------------------------------------------------------------------
    const invalidWorkWeekRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_work_week: '4-Day Work Week' }
    );
    assert(
      invalidWorkWeekRes.statusCode === 400 &&
      invalidWorkWeekRes.json()?.message?.includes('Invalid work week'),
      `13. Invalid work week ("4-Day Work Week") rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Invalid time rejected
    // -------------------------------------------------------------------------
    const invalidTimeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_work_start_time: '25:70' }
    );
    assert(
      invalidTimeRes.statusCode === 400 &&
      invalidTimeRes.json()?.message?.includes('Invalid time format'),
      `14. Invalid time format ("25:70") rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Identical start/end time rejected
    // -------------------------------------------------------------------------
    const identicalTimeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_work_start_time: '09:00:00', default_work_end_time: '09:00:00' }
    );
    assert(
      identicalTimeRes.statusCode === 400 &&
      identicalTimeRes.json()?.message?.includes('identical'),
      `15. Identical start and end time rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 16: Invalid break duration rejected
    // -------------------------------------------------------------------------
    const invalidBreakRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_break_duration_minutes: -15 }
    );
    assert(
      invalidBreakRes.statusCode === 400 &&
      invalidBreakRes.json()?.message?.includes('Break duration'),
      `16. Negative break duration (-15) rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 17: Invalid weekly off day rejected
    // -------------------------------------------------------------------------
    const invalidDayRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, default_weekly_off_days: ['Funday'] }
    );
    assert(
      invalidDayRes.statusCode === 400 &&
      invalidDayRes.json()?.message?.includes('Invalid weekly off day'),
      `17. Invalid weekly off day name ("Funday") rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 18: Invalid boolean rejected
    // -------------------------------------------------------------------------
    const invalidBoolRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...validUpdatePayload, allow_half_day: 'not-a-bool' }
    );
    assert(
      invalidBoolRes.statusCode === 400 &&
      invalidBoolRes.json()?.message?.includes('allow_half_day must be a boolean'),
      `18. Non-boolean string for allow_half_day rejected with 400 Bad Request`
    );

    // -------------------------------------------------------------------------
    // TEST 19: Data persists after update
    // -------------------------------------------------------------------------
    console.log('\n--- 4. PERSISTENCE, SINGLETON & AUDIT TRAIL ---');
    const verifyGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/work-attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const persisted = verifyGetRes.json()?.data || {};
    assert(
      persisted.default_work_week === '6-Day Work Week' &&
      persisted.default_work_start_time.startsWith('10:00') &&
      persisted.default_work_end_time.startsWith('19:00') &&
      persisted.default_break_duration_minutes === 45 &&
      persisted.default_weekly_off_days.length === 1 &&
      persisted.default_weekly_off_days[0] === 'Sunday' &&
      persisted.allow_work_from_home === false,
      `19. Data persists correctly on subsequent GET request`
    );

    // Restore standard 5-Day configuration
    const standardPayload = {
      default_work_week: '5-Day Work Week',
      default_work_start_time: '09:30:00',
      default_work_end_time: '18:30:00',
      default_break_duration_minutes: 60,
      default_weekly_off_days: ['Saturday', 'Sunday'],
      allow_half_day: true,
      allow_work_from_home: true,
    };
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      standardPayload
    );

    // -------------------------------------------------------------------------
    // TEST 20 & 22: Singleton constraint & No duplicate rows
    // -------------------------------------------------------------------------
    for (let i = 0; i < 3; i++) {
      await makeRequest(
        {
          hostname: 'localhost',
          port: PORT,
          path: '/api/admin/settings/work-attendance',
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { ...standardPayload, default_break_duration_minutes: 50 + i }
      );
    }
    const countRes = await pool.query('SELECT count(*) FROM public.organization_work_settings');
    const settingsRowCount = parseInt(countRes.rows[0].count, 10);
    assert(
      settingsRowCount === 1,
      `20. Singleton constraint holds: total organization_work_settings rows is exactly 1 (found ${settingsRowCount})`
    );
    assert(
      settingsRowCount === 1,
      `22. Repeated updates do not produce duplicate settings records`
    );

    // Reset break duration back to 60
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/work-attendance',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      standardPayload
    );

    // -------------------------------------------------------------------------
    // TEST 21: Audit log generated
    // -------------------------------------------------------------------------
    const auditRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'WORK_ATTENDANCE_SETTINGS_UPDATED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditRes.rows.length > 0 &&
      auditRes.rows[0].entity_type === 'WORK_ATTENDANCE_SETTINGS' &&
      Array.isArray(auditRes.rows[0].metadata?.fields_changed),
      `21. Audit log recorded with action WORK_ATTENDANCE_SETTINGS_UPDATED and fields_changed metadata`
    );

    // -------------------------------------------------------------------------
    // TEST 23 & 24: Existing employee data & schedules unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- 5. EMPLOYEE SCHEDULE PROTECTION & ZERO-REGRESSION ---');
    const postEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const postEmpCount = parseInt(postEmpCountRes.rows[0].count, 10);
    assert(
      postEmpCount === initialEmpCount,
      `23. Existing employee count unchanged (before: ${initialEmpCount}, after: ${postEmpCount})`
    );

    const postEmpSchedulesRes = await pool.query('SELECT employee_id, working_days_per_week FROM public.employees ORDER BY employee_id');
    const postEmpSchedules = postEmpSchedulesRes.rows;
    let schedulesIntact = postEmpSchedules.length === initialEmpSchedules.length;
    for (let i = 0; i < initialEmpSchedules.length; i++) {
      if (
        initialEmpSchedules[i].employee_id !== postEmpSchedules[i].employee_id ||
        initialEmpSchedules[i].working_days_per_week !== postEmpSchedules[i].working_days_per_week
      ) {
        schedulesIntact = false;
        break;
      }
    }
    assert(
      schedulesIntact,
      `24. Employee-specific work schedules are completely untouched and preserved`
    );

    // -------------------------------------------------------------------------
    // TEST 25: Existing attendance count unchanged
    // -------------------------------------------------------------------------
    const postAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const postAttendanceCount = parseInt(postAttendanceCountRes.rows[0].count, 10);
    assert(
      postAttendanceCount === initialAttendanceCount,
      `25. Existing attendance count unchanged (before: ${initialAttendanceCount}, after: ${postAttendanceCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 26: Existing payroll data unchanged
    // -------------------------------------------------------------------------
    const postPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const postPayrollCount = parseInt(postPayrollCountRes.rows[0].count, 10);
    assert(
      postPayrollCount === initialPayrollCount,
      `26. Existing payroll records count unchanged (before: ${initialPayrollCount}, after: ${postPayrollCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 27: Existing leave data unchanged
    // -------------------------------------------------------------------------
    const postLeaveCountRes = await pool.query('SELECT count(*) FROM public.leave_requests');
    const postLeaveCount = parseInt(postLeaveCountRes.rows[0].count, 10);
    assert(
      postLeaveCount === initialLeaveCount,
      `27. Existing leave requests count unchanged (before: ${initialLeaveCount}, after: ${postLeaveCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 28: Existing Holiday functionality unchanged
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
      `28. Existing attendance & holiday query API operates normally (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 29: Bulk Holiday Marking still works
    // -------------------------------------------------------------------------
    const bulkHolidayDryRes = await makeRequest(
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
      { attendance_date: '2026-12-25', remarks: 'Christmas Festival' }
    );
    assert(
      bulkHolidayDryRes.statusCode === 200 || bulkHolidayDryRes.statusCode === 409,
      `29. Existing Bulk Holiday Marking endpoint responds correctly (status ${bulkHolidayDryRes.statusCode})`
    );
    // Cleanup 2026-12-25 if marked
    await pool.query("DELETE FROM public.attendance WHERE attendance_date = '2026-12-25'::date");

    // -------------------------------------------------------------------------
    // TEST 30: Employee attendance API still works
    // -------------------------------------------------------------------------
    const empAttendanceRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-10',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empAttendanceRes.statusCode === 200 &&
      empAttendanceRes.json()?.success === true,
      `30. Employee attendance calendar & summary API functions normally (status 200)`
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
