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
  console.log(' HOLIDAY CALENDAR SETTINGS MODULE - 34 REQUIREMENTS     ');
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

  let testHolidayId1 = null;
  let testHolidayId2 = null;

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
    // TEST 1: Holiday Settings Route Exists
    // -------------------------------------------------------------------------
    console.log('--- 1. ROUTING & FILE SYSTEM INTEGRITY ---');
    const appRoutesPath = path.join(__dirname, '..', 'Frontend', 'src', 'routes', 'AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');
    assert(
      appRoutesContent.includes('settings/holidays') &&
      appRoutesContent.includes('AdminHolidayCalendar'),
      '1. Route /admin/settings/holidays is registered in AppRoutes.jsx'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Settings Card Links Correctly
    // -------------------------------------------------------------------------
    const settingsPagePath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'Settings.jsx');
    const settingsPageContent = fs.readFileSync(settingsPagePath, 'utf8');
    assert(
      settingsPageContent.includes("link: '/admin/settings/holidays'") &&
      settingsPageContent.includes("id: 'holidays'"),
      "2. Settings landing page card links to '/admin/settings/holidays'"
    );

    // -------------------------------------------------------------------------
    // TEST 3: Holiday Calendar Page Files Exist
    // -------------------------------------------------------------------------
    const holidayJsxPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'HolidayCalendar', 'HolidayCalendar.jsx');
    const holidayCssPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Settings', 'HolidayCalendar', 'HolidayCalendar.css');
    assert(
      fs.existsSync(holidayJsxPath) && fs.existsSync(holidayCssPath),
      '3. HolidayCalendar.jsx and HolidayCalendar.css files exist on filesystem'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Unauthenticated GET returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- 2. RBAC & PERMISSION ENFORCEMENT ---');
    const unauthGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays',
      method: 'GET',
    });
    assert(
      unauthGetRes.statusCode === 401,
      '4. Unauthenticated GET /api/admin/settings/holidays returns HTTP 401'
    );

    // -------------------------------------------------------------------------
    // TEST 5: Employee GET returns 403
    // -------------------------------------------------------------------------
    const empGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empGetRes.statusCode === 403,
      '5. Employee GET /api/admin/settings/holidays returns HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Admin GET succeeds
    // -------------------------------------------------------------------------
    const adminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminGetData = adminGetRes.json();
    assert(
      adminGetRes.statusCode === 200 && adminGetData?.success === true,
      '6. Admin GET /api/admin/settings/holidays succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin GET succeeds
    // -------------------------------------------------------------------------
    const superAdminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const superAdminGetData = superAdminGetRes.json();
    assert(
      superAdminGetRes.statusCode === 200 && superAdminGetData?.success === true,
      '7. Super Admin GET /api/admin/settings/holidays succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Empty state works
    // -------------------------------------------------------------------------
    // When querying a future year with no holidays (e.g. 2099)
    const emptyYearRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays?year=2099',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      emptyYearRes.statusCode === 200 && Array.isArray(emptyYearRes.json()?.data) && emptyYearRes.json()?.data.length === 0,
      '8. Empty state works: querying year without holidays returns empty array without error'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Admin can create holiday
    // -------------------------------------------------------------------------
    console.log('\n--- 3. MUTATION, VALIDATION & DUPLICATE PROTECTION ---');
    const testDate1 = '2026-10-20';
    // Clear test date in case of previous run
    await pool.query('DELETE FROM public.organization_holidays WHERE holiday_date = $1::date', [testDate1]);

    const createRes1 = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/holidays',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: 'Dasara',
        holiday_date: testDate1,
        description: 'Organization holiday for Dasara festival',
      }
    );
    const createData1 = createRes1.json();
    assert(
      createRes1.statusCode === 201 && createData1?.success === true && createData1?.data?.holiday_name === 'Dasara',
      '9. Admin can create organization holiday (201 Created)'
    );
    testHolidayId1 = createData1?.data?.id;

    // -------------------------------------------------------------------------
    // TEST 10: Super Admin can create holiday
    // -------------------------------------------------------------------------
    const testDate2 = '2026-11-08';
    await pool.query('DELETE FROM public.organization_holidays WHERE holiday_date = $1::date', [testDate2]);

    const createRes2 = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/holidays',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
      },
      {
        holiday_name: 'Diwali',
        holiday_date: testDate2,
        description: 'Festival of Lights observance',
      }
    );
    const createData2 = createRes2.json();
    assert(
      createRes2.statusCode === 201 && createData2?.success === true && createData2?.data?.holiday_name === 'Diwali',
      '10. Super Admin can create organization holiday (201 Created)'
    );
    testHolidayId2 = createData2?.data?.id;

    // -------------------------------------------------------------------------
    // TEST 11: Missing holiday name rejected
    // -------------------------------------------------------------------------
    const missingNameRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/holidays',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: '   ',
        holiday_date: '2026-12-25',
      }
    );
    assert(
      missingNameRes.statusCode === 400 &&
      missingNameRes.json()?.message?.includes('Holiday name is required'),
      '11. Missing holiday name rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 12: Invalid date rejected
    // -------------------------------------------------------------------------
    const invalidDateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/holidays',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: 'Invalid Date Holiday',
        holiday_date: '2026-02-31',
      }
    );
    assert(
      invalidDateRes.statusCode === 400 &&
      invalidDateRes.json()?.message?.includes('A valid holiday date in YYYY-MM-DD format is required'),
      '12. Invalid calendar date (e.g. Feb 31) rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 13: Duplicate holiday date rejected with 409
    // -------------------------------------------------------------------------
    const duplicateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/holidays',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: 'Duplicate Dasara',
        holiday_date: testDate1,
      }
    );
    assert(
      duplicateRes.statusCode === 409 &&
      duplicateRes.json()?.message?.includes('An organization holiday already exists for this date'),
      '13. Duplicate holiday date rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Admin can update holiday
    // -------------------------------------------------------------------------
    const updateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/holidays/${testHolidayId1}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: 'Vijayadashami (Dasara)',
        holiday_date: testDate1,
        description: 'Updated celebration description',
      }
    );
    const updateData = updateRes.json();
    assert(
      updateRes.statusCode === 200 &&
      updateData?.data?.holiday_name === 'Vijayadashami (Dasara)' &&
      updateData?.data?.description === 'Updated celebration description',
      '14. Admin can update organization holiday (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 15: Date conflict during update rejected
    // -------------------------------------------------------------------------
    // Trying to update testHolidayId1's date to testDate2 (which belongs to Diwali)
    const conflictUpdateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/holidays/${testHolidayId1}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      {
        holiday_name: 'Conflict Date Holiday',
        holiday_date: testDate2,
      }
    );
    assert(
      conflictUpdateRes.statusCode === 409 &&
      conflictUpdateRes.json()?.message?.includes('An organization holiday already exists for this date'),
      '15. Date conflict during update rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 16: Admin can delete holiday
    // -------------------------------------------------------------------------
    const deleteRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/settings/holidays/${testHolidayId2}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteRes.statusCode === 200 && deleteRes.json()?.success === true,
      '16. Admin can delete organization holiday (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 17: Nonexistent holiday returns 404
    // -------------------------------------------------------------------------
    const nonExistentRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays/00000000-0000-0000-0000-000000000000',
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      nonExistentRes.statusCode === 404 &&
      nonExistentRes.json()?.message?.includes('Organization holiday not found'),
      '17. Nonexistent holiday ID returns HTTP 404 Not Found'
    );

    // -------------------------------------------------------------------------
    // TEST 18: Holiday data persists
    // -------------------------------------------------------------------------
    console.log('\n--- 4. PERSISTENCE, CONSTRAINTS & AUDIT TRAIL ---');
    const persistGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays?year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const foundHoliday = persistGetRes.json()?.data?.find((h) => h.id === testHolidayId1);
    assert(
      foundHoliday && foundHoliday.holiday_name === 'Vijayadashami (Dasara)',
      '18. Holiday data persists accurately on subsequent GET requests'
    );

    // -------------------------------------------------------------------------
    // TEST 19: Database unique constraint prevents duplicate dates
    // -------------------------------------------------------------------------
    let directDbError = null;
    try {
      await pool.query(
        `INSERT INTO public.organization_holidays (holiday_date, holiday_name)
         VALUES ($1::date, 'Direct DB Conflict')`,
        [testDate1]
      );
    } catch (err) {
      directDbError = err;
    }
    assert(
      directDbError && directDbError.code === '23505',
      '19. Database UNIQUE constraint (uq_organization_holidays_date) strictly prevents duplicate holiday dates'
    );

    // -------------------------------------------------------------------------
    // TEST 20: Audit log HOLIDAY_CREATED generated
    // -------------------------------------------------------------------------
    const auditCreatedRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'HOLIDAY_CREATED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditCreatedRes.rows.length > 0 &&
      auditCreatedRes.rows[0].entity_type === 'ORGANIZATION_HOLIDAY' &&
      auditCreatedRes.rows[0].metadata?.holiday_name !== undefined,
      '20. Audit log HOLIDAY_CREATED generated with organization holiday metadata'
    );

    // -------------------------------------------------------------------------
    // TEST 21: Audit log HOLIDAY_UPDATED generated
    // -------------------------------------------------------------------------
    const auditUpdatedRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'HOLIDAY_UPDATED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditUpdatedRes.rows.length > 0 &&
      auditUpdatedRes.rows[0].entity_type === 'ORGANIZATION_HOLIDAY' &&
      auditUpdatedRes.rows[0].metadata?.holiday_name === 'Vijayadashami (Dasara)',
      '21. Audit log HOLIDAY_UPDATED generated with updated holiday metadata'
    );

    // -------------------------------------------------------------------------
    // TEST 22: Audit log HOLIDAY_DELETED generated
    // -------------------------------------------------------------------------
    const auditDeletedRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'HOLIDAY_DELETED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditDeletedRes.rows.length > 0 &&
      auditDeletedRes.rows[0].entity_type === 'ORGANIZATION_HOLIDAY' &&
      auditDeletedRes.rows[0].metadata?.holiday_name === 'Diwali',
      '22. Audit log HOLIDAY_DELETED generated with deleted holiday details'
    );

    // -------------------------------------------------------------------------
    // TEST 23: Existing attendance count unchanged after creating holiday
    // -------------------------------------------------------------------------
    console.log('\n--- 5. ATTENDANCE, LEAVE, PAYROLL & REGRESSION SAFETY ---');
    const midAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const midAttendanceCount = parseInt(midAttendanceCountRes.rows[0].count, 10);
    assert(
      midAttendanceCount === initialAttendanceCount,
      `23. Existing attendance records unchanged after holiday definition creation (before: ${initialAttendanceCount}, current: ${midAttendanceCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 24: Existing leave balances unchanged
    // -------------------------------------------------------------------------
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
      '24. Existing employee leave balances are completely untouched and unchanged'
    );

    // -------------------------------------------------------------------------
    // TEST 25: Existing leave requests unchanged
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
      '25. Historical leave requests are completely unmodified'
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
    // TEST 27: Existing Week Off behavior unchanged
    // -------------------------------------------------------------------------
    const weekOffCheckRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=2026-10-18', // Sunday
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const sundayRecords = weekOffCheckRes.json()?.data || [];
    const hasWeekOff = sundayRecords.some((r) => r.attendance_status === 'Week Off' || r.status === 'Week Off');
    assert(
      weekOffCheckRes.statusCode === 200 && hasWeekOff,
      '27. Existing Week Off behavior unchanged: Sunday resolves as Week Off for scheduled workers'
    );

    // -------------------------------------------------------------------------
    // TEST 28: Existing Bulk Holiday Marking still works
    // -------------------------------------------------------------------------
    const bulkHolidayTestDate = '2026-12-31';
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
      { attendance_date: bulkHolidayTestDate, remarks: 'New Year Eve Observance' }
    );
    assert(
      bulkHolidayRes.statusCode === 200 && bulkHolidayRes.json()?.data?.status === 'Holiday',
      '28. Existing Bulk Holiday Marking endpoint functions normally (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 29: Existing employee attendance API still works
    // -------------------------------------------------------------------------
    const empAttRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-12',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const decRecords = empAttRes.json()?.data || [];
    const dec31Holiday = decRecords.find((r) => (r.date || r.attendance_date) === bulkHolidayTestDate);
    assert(
      empAttRes.statusCode === 200 && dec31Holiday?.status === 'Holiday',
      '29. Employee attendance API returns Holiday on marked date without regression'
    );

    // -------------------------------------------------------------------------
    // TEST 30: Existing admin attendance API still works
    // -------------------------------------------------------------------------
    const adminAttRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${bulkHolidayTestDate}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminAttRes.statusCode === 200 && adminAttRes.json()?.summary?.holiday === initialEmpCount,
      '30. Admin attendance API reports correct Holiday summary metrics (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 31: Bulk Holiday Marking remains idempotent
    // -------------------------------------------------------------------------
    const bulkIdempRes = await makeRequest(
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
      { attendance_date: bulkHolidayTestDate, remarks: 'New Year Eve Observance' }
    );
    assert(
      bulkIdempRes.statusCode === 200 && bulkIdempRes.json()?.already_marked === true,
      '31. Bulk Holiday Marking remains completely idempotent when called repeatedly'
    );

    // -------------------------------------------------------------------------
    // TEST 32: Existing overwrite confirmation behavior remains intact
    // -------------------------------------------------------------------------
    // Seed a Present record on test date 2026-11-20
    const conflictDate = '2026-11-20';
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [conflictDate]);
    await pool.query(
      `INSERT INTO public.attendance (employee_id, attendance_date, status)
       VALUES ('GP0001N', $1::date, 'Present')`,
      [conflictDate]
    );
    const overwriteBlockRes = await makeRequest(
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
      { attendance_date: conflictDate, remarks: 'Test Holiday' }
    );
    assert(
      overwriteBlockRes.statusCode === 409 && overwriteBlockRes.json()?.require_confirmation === true,
      '32. Overwrite protection remains intact: blocks unconfirmed overwrite with HTTP 409 and require_confirmation'
    );
    // Clean up conflict date attendance
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [conflictDate]);

    // -------------------------------------------------------------------------
    // TEST 33: Historical attendance remains unchanged after holiday deletion
    // -------------------------------------------------------------------------
    // Check attendance on bulkHolidayTestDate still exists even after deleting holiday
    const attOnHolidayBefore = (
      await pool.query('SELECT count(*) FROM public.attendance WHERE attendance_date = $1::date', [bulkHolidayTestDate])
    ).rows[0].count;

    // Delete holiday if one existed on that date
    await pool.query('DELETE FROM public.organization_holidays WHERE holiday_date = $1::date', [bulkHolidayTestDate]);

    const attOnHolidayAfter = (
      await pool.query('SELECT count(*) FROM public.attendance WHERE attendance_date = $1::date', [bulkHolidayTestDate])
    ).rows[0].count;
    assert(
      parseInt(attOnHolidayBefore, 10) > 0 && attOnHolidayBefore === attOnHolidayAfter,
      '33. Historical attendance remains completely unchanged when holiday definition is deleted'
    );
    // Cleanup test attendance
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [bulkHolidayTestDate]);

    // -------------------------------------------------------------------------
    // TEST 34: No duplicate holiday records created
    // -------------------------------------------------------------------------
    const allHolidaysInDb = (await pool.query('SELECT holiday_date, count(*) FROM public.organization_holidays GROUP BY holiday_date HAVING count(*) > 1')).rows;
    assert(
      allHolidaysInDb.length === 0,
      '34. No duplicate holiday records exist across all dates in database'
    );

    // Cleanup test holiday
    if (testHolidayId1) {
      await pool.query('DELETE FROM public.organization_holidays WHERE id = $1::uuid', [testHolidayId1]);
    }

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
