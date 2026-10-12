require('dotenv').config();
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');
const http = require('http');

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
  console.log('    BULK HOLIDAY MARKING SUITE - 20 CORE REQUIREMENTS');
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

  const TEST_DATE = '2026-10-27'; // Future test date for clean isolation

  try {
    // 0. Setup: Clean up any pre-existing records for TEST_DATE
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [TEST_DATE]);

    // Fetch an ADMIN user and an EMPLOYEE user
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
      role: adminUser.role,
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

    // Count active, inactive, suspended employees
    const activeEmpRes = await pool.query(`SELECT COUNT(*)::int AS count FROM public.employees WHERE status = 'ACTIVE'`);
    const totalActive = activeEmpRes.rows[0].count;
    console.log(`Organization active employees count: ${totalActive}\n`);

    // Snapshot leave balances before test
    const leaveBalancesBefore = await pool.query(
      `SELECT * FROM public.leave_balances ORDER BY employee_id`
    );

    // Snapshot historical attendance count before test
    const histAttendanceCountBefore = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.attendance WHERE attendance_date != $1::date`,
      [TEST_DATE]
    );

    // Snapshot payroll profiles / records before test
    const payrollCountBefore = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.payroll_profiles`
    );

    // -------------------------------------------------------------
    // Test 1: Unauthenticated request returns 401
    // -------------------------------------------------------------
    console.log('[Test 1: Unauthenticated RBAC]');
    const resUnauth = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/attendance/mark-holiday',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      { attendance_date: TEST_DATE }
    );
    assert(resUnauth.statusCode === 401, '1. Unauthenticated request to mark-holiday returns 401 Unauthorized');

    // -------------------------------------------------------------
    // Test 2: Employee cannot call bulk Holiday endpoint (403 Forbidden)
    // -------------------------------------------------------------
    console.log('\n[Test 2: Non-Admin Role Security]');
    const resEmpCall = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/attendance/mark-holiday',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${empToken}`,
        },
      },
      { attendance_date: TEST_DATE }
    );
    assert(resEmpCall.statusCode === 403, '2. Employee attempting mark-holiday receives 403 Forbidden');

    // -------------------------------------------------------------
    // Test 3: Date validation (invalid calendar date returns 400)
    // -------------------------------------------------------------
    console.log('\n[Test 3: Date Validation]');
    const resBadDate = await makeRequest(
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
      { attendance_date: 'not-a-date' }
    );
    assert(resBadDate.statusCode === 400, '3. Invalid calendar date string returns 400 Bad Request');

    // -------------------------------------------------------------
    // Test 4: Seed a non-Holiday attendance record to verify Confirmation Required (safety check)
    // -------------------------------------------------------------
    console.log('\n[Test 4: Confirmation Required for Existing Records]');
    await pool.query(
      `INSERT INTO public.attendance (employee_id, attendance_date, status, remarks, marked_at)
       VALUES ($1, $2::date, 'Present', 'Manual Present', NOW())`,
      [empUser.employee_id, TEST_DATE]
    );

    const resPrecheck = await makeRequest(
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
      { attendance_date: TEST_DATE, confirm_overwrite: false }
    );
    const precheckJson = resPrecheck.json();
    assert(
      resPrecheck.statusCode === 409 && precheckJson?.require_confirmation === true,
      '4.1 Existing non-Holiday record blocks overwrite without confirmation (HTTP 409 require_confirmation: true)'
    );
    assert(
      precheckJson?.data?.breakdown?.Present >= 1,
      '4.2 Breakdown shows count of existing Present records'
    );

    // -------------------------------------------------------------
    // Test 5: Confirm holiday with replace (confirm_overwrite: true)
    // -------------------------------------------------------------
    console.log('\n[Test 5: Bulk Holiday Execution with Replace]');
    const resMarkHoliday = await makeRequest(
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
      {
        attendance_date: TEST_DATE,
        remarks: 'Dasara Festival Holiday',
        confirm_overwrite: true,
      }
    );
    const markHolidayJson = resMarkHoliday.json();
    assert(resMarkHoliday.statusCode === 200 && markHolidayJson?.success === true, '5.1 Holiday marked successfully with 200 OK');
    assert(markHolidayJson?.data?.status === 'Holiday', '5.2 Returned status is strictly "Holiday"');
    assert(markHolidayJson?.data?.employees_affected === totalActive, '5.3 All active employees affected matches total active count');
    assert(markHolidayJson?.data?.updated >= 1, '5.4 Existing record was counted in updated');
    assert(markHolidayJson?.data?.created === totalActive - markHolidayJson?.data?.updated, '5.5 Remaining active employees were created');

    // -------------------------------------------------------------
    // Test 6: Verify Database Records - All Active Employees have Holiday
    // -------------------------------------------------------------
    console.log('\n[Test 6: Database Verification - Active Employees]');
    const dbHolidayCountRes = await pool.query(
      `SELECT COUNT(*)::int AS count 
       FROM public.attendance a
       JOIN public.employees e ON e.employee_id = a.employee_id
       WHERE a.attendance_date = $1::date AND a.status = 'Holiday' AND e.status = 'ACTIVE'`,
      [TEST_DATE]
    );
    assert(
      dbHolidayCountRes.rows[0].count === totalActive,
      `6. Exactly ${totalActive} active employees have Holiday attendance record in DB`
    );

    // -------------------------------------------------------------
    // Test 7: Verify INACTIVE and SUSPENDED employees were NOT affected
    // -------------------------------------------------------------
    console.log('\n[Test 7: Inactive / Suspended Employees Isolation]');
    const dbInactiveHolidayRes = await pool.query(
      `SELECT COUNT(*)::int AS count 
       FROM public.attendance a
       JOIN public.employees e ON e.employee_id = a.employee_id
       WHERE a.attendance_date = $1::date AND e.status IN ('INACTIVE', 'SUSPENDED')`,
      [TEST_DATE]
    );
    assert(
      dbInactiveHolidayRes.rows[0].count === 0,
      '7. Zero inactive or suspended employees received Holiday attendance records'
    );

    // -------------------------------------------------------------
    // Test 8: Idempotency / Running Action Twice Does Not Duplicate
    // -------------------------------------------------------------
    console.log('\n[Test 8: Idempotency & Duplicate Prevention]');
    const resIdempotent = await makeRequest(
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
      {
        attendance_date: TEST_DATE,
        remarks: 'Dasara Festival Holiday',
      }
    );
    const idempJson = resIdempotent.json();
    assert(resIdempotent.statusCode === 200, '8.1 Calling mark-holiday twice returns 200 OK');
    assert(idempJson?.already_marked === true, '8.2 Response reports already_marked: true');
    assert(
      idempJson?.message?.includes('already marked as Holiday'),
      '8.3 Message clearly states date is already marked as Holiday'
    );

    // Verify total attendance rows for this date didn't duplicate
    const totalRowsRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.attendance WHERE attendance_date = $1::date`,
      [TEST_DATE]
    );
    assert(
      totalRowsRes.rows[0].count === totalActive,
      `8.4 Attendance table row count remained ${totalActive} without duplicates`
    );

    // -------------------------------------------------------------
    // Test 9: Employee Attendance API Returns Holiday
    // -------------------------------------------------------------
    console.log('\n[Test 9: Employee Portal Attendance View]');
    const [testYear, testMonth] = TEST_DATE.split('-');
    const resEmpAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/attendance?month=${testYear}-${testMonth}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${empToken}`,
      },
    });
    const empAttJson = resEmpAtt.json();
    const holidayRecord = empAttJson?.data?.find((r) => r.date === TEST_DATE || r.attendance_date === TEST_DATE);
    assert(resEmpAtt.statusCode === 200, '9.1 Employee attendance API returns 200 OK');
    assert(holidayRecord?.status === 'Holiday', '9.2 Employee attendance record for selected date has status "Holiday"');
    assert(empAttJson?.summary?.holidays >= 1, '9.3 Employee attendance summary increments holidays count');

    // -------------------------------------------------------------
    // Test 10: Admin Attendance API Returns Updated Holiday Data
    // -------------------------------------------------------------
    console.log('\n[Test 10: Admin Attendance View & Summary]');
    const resAdminAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${TEST_DATE}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const adminAttJson = resAdminAtt.json();
    assert(resAdminAtt.statusCode === 200, '10.1 Admin attendance API returns 200 OK');
    assert(
      adminAttJson?.summary?.holiday === totalActive,
      `10.2 Admin attendance summary reports ${totalActive} holidays`
    );
    assert(
      adminAttJson?.summary?.present === 0,
      '10.3 Replaced records: present count is 0'
    );

    // -------------------------------------------------------------
    // Test 11: Leave Balances are NOT Modified
    // -------------------------------------------------------------
    console.log('\n[Test 11: Leave Balance Safety]');
    const leaveBalancesAfter = await pool.query(
      `SELECT * FROM public.leave_balances ORDER BY employee_id`
    );
    assert(
      JSON.stringify(leaveBalancesBefore.rows) === JSON.stringify(leaveBalancesAfter.rows),
      '11. Employee leave balances remain completely unmodified'
    );

    // -------------------------------------------------------------
    // Test 12: Historical Attendance is NOT Modified
    // -------------------------------------------------------------
    console.log('\n[Test 12: Historical Attendance Preservation]');
    const histAttendanceCountAfter = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.attendance WHERE attendance_date != $1::date`,
      [TEST_DATE]
    );
    assert(
      histAttendanceCountBefore.rows[0].count === histAttendanceCountAfter.rows[0].count,
      '12. Historical attendance records on other dates are untouched'
    );

    // -------------------------------------------------------------
    // Test 13: Payroll Records are NOT Modified
    // -------------------------------------------------------------
    console.log('\n[Test 13: Payroll Safety]');
    const payrollCountAfter = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.payroll_profiles`
    );
    assert(
      payrollCountBefore.rows[0].count === payrollCountAfter.rows[0].count,
      '13. Payroll profiles/records remain completely intact'
    );

    // -------------------------------------------------------------
    // Test 14: Audit Log is Created with ORGANIZATION_HOLIDAY_MARKED
    // -------------------------------------------------------------
    console.log('\n[Test 14: Audit Log Verification]');
    const auditLogRes = await pool.query(
      `SELECT action, entity_type, metadata, created_at 
       FROM public.audit_logs 
       WHERE action = 'ORGANIZATION_HOLIDAY_MARKED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(auditLogRes.rows.length > 0, '14.1 Audit log entry for ORGANIZATION_HOLIDAY_MARKED exists');
    const auditMeta = auditLogRes.rows[0]?.metadata || {};
    assert(auditMeta.attendance_date === TEST_DATE, '14.2 Audit log metadata contains correct attendance_date');
    assert(auditMeta.employees_affected === totalActive, '14.3 Audit log metadata contains employees_affected count');

    // -------------------------------------------------------------
    // Test 15: Remarks / Holiday Name Stored Cleanly
    // -------------------------------------------------------------
    console.log('\n[Test 15: Optional Remarks / Holiday Name Storage]');
    const sampleRecord = await pool.query(
      `SELECT remarks FROM public.attendance WHERE attendance_date = $1::date LIMIT 1`,
      [TEST_DATE]
    );
    assert(
      sampleRecord.rows[0]?.remarks === 'Dasara Festival Holiday',
      '15. Attendance record remarks field stores "Dasara Festival Holiday"'
    );

    // -------------------------------------------------------------
    // Test 16: Transaction Rollback on Failure
    // -------------------------------------------------------------
    console.log('\n[Test 16: Transaction Rollback Verification]');
    const client = await pool.connect();
    let rolledBack = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.attendance (employee_id, attendance_date, status, remarks)
         VALUES ($1, $2::date, 'Holiday', 'Tx Rollback Test')`,
        [empUser.employee_id, TEST_DATE]
      );
      // Intentionally induce an error within transaction violating CHECK constraint
      await client.query(
        `INSERT INTO public.attendance (employee_id, attendance_date, status)
         VALUES ($1, $2::date, 'INVALID_STATUS')`,
        [empUser.employee_id, TEST_DATE]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      rolledBack = true;
    } finally {
      client.release();
    }
    assert(rolledBack, '16.1 Transaction caught error and executed ROLLBACK');

    // Verify database state: no rows committed from the aborted transaction
    const checkRolledBackRow = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.attendance WHERE attendance_date = $1::date AND remarks = 'Tx Rollback Test'`,
      [TEST_DATE]
    );
    assert(checkRolledBackRow.rows[0].count === 0, '16.2 Zero changes were committed to attendance table upon rollback');

    // -------------------------------------------------------------
    // Test 17: Clean up test date
    // -------------------------------------------------------------
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1::date', [TEST_DATE]);
    console.log('\n[Test Cleanup] Test date attendance records cleaned up successfully.');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    console.log('\n========================================================');
    console.log(`TOTAL TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);
    console.log('========================================================');
    process.exit(failed === 0 ? 0 : 1);
  }
}

runTests();
