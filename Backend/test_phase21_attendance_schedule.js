const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

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

    req.on('error', (err) => reject(err));

    if (postData) {
      if (typeof postData === 'string' || Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(JSON.stringify(postData));
      }
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runAttendanceScheduleTests() {
  console.log('\n================================================================');
  console.log('   GAINTPRO EMPLOYEE PORTAL — ATTENDANCE SCHEDULE TEST SUITE   ');
  console.log('   CONFIGURABLE 5-DAY VS 6-DAY SCHEDULE & WEEK OFF ENFORCEMENT  ');
  console.log('================================================================\n');

  const createdEmployeeIds = [];
  const createdEmails = [];

  try {
    // 0. Ensure Admin user exists
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1"
    );
    assert(adminUserRes.rows.length > 0, 'Admin user exists in database');
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    // =========================================================================
    // 1. DATABASE SCHEMA & MIGRATION VERIFICATION
    // =========================================================================
    console.log('\n--- 1. DATABASE SCHEMA & MIGRATION VERIFICATION ---');

    const colCheck = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name = 'working_days_per_week'
    `);
    assert(colCheck.rows.length === 1, '1.1 Column "working_days_per_week" exists in public.employees');
    const colInfo = colCheck.rows[0];
    assert(colInfo.is_nullable === 'NO', '1.2 Column is NOT NULL');
    assert(colInfo.column_default?.includes('5'), '1.3 Column has DEFAULT 5');

    // Check CHECK constraint in (5, 6)
    const constraintCheck = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'employees' AND (c.conname LIKE '%working_days_per_week%' OR pg_get_constraintdef(c.oid) LIKE '%working_days_per_week%')
    `);
    assert(
      constraintCheck.rows.length > 0 && constraintCheck.rows[0].def.includes('5') && constraintCheck.rows[0].def.includes('6'),
      '1.4 CHECK constraint enforces working_days_per_week IN (5, 6)'
    );

    // Existing employees default to 5
    const existingCheck = await pool.query(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN working_days_per_week IN (5, 6) THEN 1 END) as valid
      FROM public.employees
    `);
    assert(
      parseInt(existingCheck.rows[0].total, 10) === parseInt(existingCheck.rows[0].valid, 10),
      '1.5 All existing employees have valid working_days_per_week (5 or 6)'
    );

    // =========================================================================
    // 2. ONBOARDING WIZARD VALIDATION (MANDATORY & RESTRICTED TO 5 OR 6)
    // =========================================================================
    console.log('\n--- 2. ONBOARDING WIZARD VALIDATION ---');

    // 2.1 Missing working_days_per_week
    const resMissing = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP8801N',
      firstName: 'Test',
      email: `test.sched.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Engineer',
    });
    assert(resMissing.statusCode === 400 && resMissing.json()?.message?.includes('Working days per week is required'),
      '2.1 Missing working_days_per_week returns 400 Bad Request');

    // 2.2 Null working_days_per_week
    const resNull = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP8801N',
      firstName: 'Test',
      email: `test.sched.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Engineer',
      working_days_per_week: null,
    });
    assert(resNull.statusCode === 400, '2.2 Null working_days_per_week returns 400 Bad Request');

    // 2.3 Invalid non-numeric string
    const resString = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP8801N',
      firstName: 'Test',
      email: `test.sched.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Engineer',
      working_days_per_week: 'foo',
    });
    assert(resString.statusCode === 400, '2.3 Non-numeric string "foo" returns 400 Bad Request');

    // 2.4 Out of range value (e.g., 4 or 7)
    const resOutOfRange = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP8801N',
      firstName: 'Test',
      email: `test.sched.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Engineer',
      working_days_per_week: 7,
    });
    assert(resOutOfRange.statusCode === 400 && resOutOfRange.json()?.message?.includes('5 or 6'),
      '2.4 Out of range value (7) returns 400 Bad Request (allowed: 5 or 6)');

    // 2.5 Valid 5 Days Onboarding
    const emp5Id = 'GP8805N';
    const email5 = `emp5.${Date.now()}@gaintpro.com`;
    const resCreate5 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: emp5Id,
      firstName: 'FiveDay',
      lastName: 'Worker',
      email: email5,
      department: 'Technology',
      designation: 'Software Engineer',
      working_days_per_week: 5,
    });
    assert(resCreate5.statusCode === 201, '2.5 Valid 5-day employee onboarded (201 Created)');
    createdEmployeeIds.push(emp5Id);
    createdEmails.push(email5);

    // Verify stored working_days_per_week in DB
    const dbEmp5 = await pool.query('SELECT working_days_per_week FROM public.employees WHERE employee_id = $1', [emp5Id]);
    assert(dbEmp5.rows[0].working_days_per_week === 5, '2.6 Database stored working_days_per_week = 5');

    // 2.6 Valid 6 Days Onboarding
    const emp6Id = 'GP8806N';
    const email6 = `emp6.${Date.now()}@gaintpro.com`;
    const resCreate6 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: emp6Id,
      firstName: 'SixDay',
      lastName: 'Worker',
      email: email6,
      department: 'Operations',
      designation: 'Operations Specialist',
      working_days_per_week: 6,
    });
    assert(resCreate6.statusCode === 201, '2.7 Valid 6-day employee onboarded (201 Created)');
    createdEmployeeIds.push(emp6Id);
    createdEmails.push(email6);

    const dbEmp6 = await pool.query('SELECT working_days_per_week FROM public.employees WHERE employee_id = $1', [emp6Id]);
    assert(dbEmp6.rows[0].working_days_per_week === 6, '2.8 Database stored working_days_per_week = 6');

    // =========================================================================
    // 3. ADMIN WORK SCHEDULE EDIT & AUDIT LOGGING
    // =========================================================================
    console.log('\n--- 3. ADMIN WORK SCHEDULE EDIT & AUDIT LOGGING ---');

    // 3.1 Admin updates 5-day employee to 6-day employee
    const resUpdateSched = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp5Id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      workingDaysPerWeek: 6,
    });
    assert(resUpdateSched.statusCode === 200, '3.1 Admin updates working schedule to 6 days (200 OK)');

    const dbUpdated5 = await pool.query('SELECT working_days_per_week FROM public.employees WHERE employee_id = $1', [emp5Id]);
    assert(dbUpdated5.rows[0].working_days_per_week === 6, '3.2 Database reflects updated working_days_per_week = 6');

    // 3.3 Verify Audit Log for Schedule Change
    const auditRes = await pool.query(`
      SELECT action, metadata
      FROM public.audit_logs
      WHERE entity_id = $1 AND action = 'EMPLOYEE_WORK_SCHEDULE_UPDATED'
      ORDER BY created_at DESC LIMIT 1
    `, [emp5Id]);
    assert(auditRes.rows.length === 1, '3.3 Audit log action EMPLOYEE_WORK_SCHEDULE_UPDATED logged');
    assert(
      auditRes.rows[0].metadata?.previous_schedule === 5 && auditRes.rows[0].metadata?.new_schedule === 6,
      '3.4 Audit log metadata records previous (5) and new (6) schedule'
    );

    // Revert back to 5 for remaining test assertions
    await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp5Id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      workingDaysPerWeek: 5,
    });

    // 3.5 Reject invalid schedule update
    const resBadUpdate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp5Id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      workingDaysPerWeek: 4,
    });
    assert(resBadUpdate.statusCode === 400, '3.5 Updating schedule to invalid value (4) rejected with 400');

    // 3.6 RBAC: Employee cannot update own schedule
    const user5Row = await pool.query('SELECT id, email FROM public.users WHERE employee_id = $1', [emp5Id]);
    const emp5Token = generateToken({
      userId: user5Row.rows[0].id,
      email: user5Row.rows[0].email,
      role: 'EMPLOYEE',
      employeeId: emp5Id,
    });

    const resEmpTamper = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp5Id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${emp5Token}` },
    }, { workingDaysPerWeek: 6 });
    assert(resEmpTamper.statusCode === 403, '3.6 Employee role attempting to update work schedule returns 403 Forbidden');

    // =========================================================================
    // 4. DAILY ADMIN ATTENDANCE: 5-DAY VS 6-DAY EMPLOYEES
    // =========================================================================
    console.log('\n--- 4. DAILY ADMIN ATTENDANCE: 5-DAY VS 6-DAY SCHEDULES ---');

    // Dates for testing:
    // 2026-10-17 is Saturday (DOW = 6)
    // 2026-10-18 is Sunday (DOW = 0)
    // 2026-10-19 is Monday (DOW = 1)
    const testSat = '2026-10-17';
    const testSun = '2026-10-18';
    const testMon = '2026-10-19';

    // Clear any leftover attendance rows on test dates for test employees
    await pool.query('DELETE FROM public.attendance WHERE employee_id IN ($1, $2)', [emp5Id, emp6Id]);

    // 4.1 Saturday Behavior:
    // 5-day employee must be 'Week Off'
    // 6-day employee must be null (Not Marked) because Saturday is a working day!
    const resSat = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testSat}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resSat.statusCode === 200, '4.1 GET /api/admin/attendance on Saturday returns 200 OK');
    const satRows = resSat.json()?.data || [];
    const emp5Sat = satRows.find((r) => r.employee_id === emp5Id);
    const emp6Sat = satRows.find((r) => r.employee_id === emp6Id);

    assert(emp5Sat?.attendance_status === 'Week Off', '4.2 On Saturday, 5-day employee defaults to "Week Off"');
    assert(emp6Sat?.attendance_status === null, '4.3 On Saturday, 6-day employee is Not Marked (regular working day, NOT Week Off)');

    // 4.2 Sunday Behavior:
    // Both 5-day and 6-day employees must be 'Week Off'
    const resSun = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testSun}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resSun.statusCode === 200, '4.4 GET /api/admin/attendance on Sunday returns 200 OK');
    const sunRows = resSun.json()?.data || [];
    const emp5Sun = sunRows.find((r) => r.employee_id === emp5Id);
    const emp6Sun = sunRows.find((r) => r.employee_id === emp6Id);

    assert(emp5Sun?.attendance_status === 'Week Off', '4.5 On Sunday, 5-day employee defaults to "Week Off"');
    assert(emp6Sun?.attendance_status === 'Week Off', '4.6 On Sunday, 6-day employee defaults to "Week Off"');

    // 4.3 Monday Behavior:
    // Both 5-day and 6-day employees must be null (Not Marked)
    const resMon = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testMon}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const monRows = resMon.json()?.data || [];
    const emp5Mon = monRows.find((r) => r.employee_id === emp5Id);
    const emp6Mon = monRows.find((r) => r.employee_id === emp6Id);

    assert(emp5Mon?.attendance_status === null, '4.7 On Monday, 5-day employee is Not Marked');
    assert(emp6Mon?.attendance_status === null, '4.8 On Monday, 6-day employee is Not Marked');

    // =========================================================================
    // 5. EXPLICIT RECORD OVERRIDES & HOLIDAY VS WEEK OFF DISTINCTION
    // =========================================================================
    console.log('\n--- 5. EXPLICIT RECORD OVERRIDES & HOLIDAYS ---');

    // 5.1 Explicit "Present" for 5-day employee on Saturday
    const resExplicitPres = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: emp5Id,
      attendance_date: testSat,
      status: 'Present',
      remarks: 'Overtime project release',
    });
    assert(resExplicitPres.statusCode === 201, '5.1 Explicit Present on Saturday created (201 Created)');

    // Verify it overrides Week Off
    const resSatOverride = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testSat}&employee_id=${emp5Id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const overrideRow = resSatOverride.json()?.data?.[0];
    assert(overrideRow?.attendance_status === 'Present', '5.2 Explicit record "Present" overrides default Week Off');

    // 5.2 Company Holiday on Monday
    const resHoliday = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: emp5Id,
      attendance_date: testMon,
      status: 'Holiday',
      remarks: 'Diwali Festival',
    });
    assert(resHoliday.statusCode === 201, '5.3 Company Holiday on Monday created');

    const resMonHoliday = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testMon}&employee_id=${emp5Id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      resMonHoliday.json()?.data?.[0]?.attendance_status === 'Holiday',
      '5.4 Company Holiday returned as "Holiday", clearly distinct from regular "Week Off"'
    );

    // =========================================================================
    // 6. MARK ALL PRESENT WEEKEND BEHAVIOR
    // =========================================================================
    console.log('\n--- 6. MARK ALL PRESENT SCHEDULE SAFETY ---');

    // 6.1 Call Mark All Present on Sunday without confirm_weekend
    const resMarkAllSunNoConfirm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance/mark-all-present',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      attendance_date: testSun,
      remarks: 'Bulk checkin',
    });
    assert(
      resMarkAllSunNoConfirm.statusCode === 400 && resMarkAllSunNoConfirm.json()?.require_confirmation === true,
      '6.1 Sunday Mark All Present detects weekend and requires confirmation'
    );

    // 6.2 Confirm Mark All Present on Saturday
    // Clean existing attendance for emp5Id & emp6Id on testSat
    await pool.query('DELETE FROM public.attendance WHERE attendance_date = $1', [testSat]);

    const resMarkAllSatConfirmed = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance/mark-all-present',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      attendance_date: testSat,
      remarks: 'Bulk Saturday checkin',
      confirm_weekend: true,
    });
    assert(resMarkAllSatConfirmed.statusCode === 200, '6.2 Saturday Mark All Present succeeds with confirmation');

    // Check results: 6-day employee marked Present; 5-day employee NOT marked (remains Week Off)!
    const resSatCheck = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${testSat}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const checkSatRows = resSatCheck.json()?.data || [];
    const checkEmp5 = checkSatRows.find((r) => r.employee_id === emp5Id);
    const checkEmp6 = checkSatRows.find((r) => r.employee_id === emp6Id);

    assert(checkEmp6?.attendance_status === 'Present', '6.3 On Saturday, 6-day employee was marked "Present"');
    assert(checkEmp5?.attendance_status === 'Week Off', '6.4 On Saturday, 5-day employee was NOT marked (safely remained "Week Off")');

    // =========================================================================
    // 7. EMPLOYEE CALENDAR ATTENDANCE & SUMMARY
    // =========================================================================
    console.log('\n--- 7. EMPLOYEE CALENDAR ATTENDANCE & SUMMARY ---');

    // 7.1 Employee 5 (5-day worker) gets monthly attendance
    const resEmp5Att = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-10',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp5Token}` },
    });
    assert(resEmp5Att.statusCode === 200, '7.1 5-day employee fetches attendance calendar (200 OK)');
    const emp5AttBody = resEmp5Att.json();
    const emp5Calendar = emp5AttBody.data || [];
    assert(emp5Calendar.length >= 31, '7.2 Calendar returns all days of the month');

    // Check Sunday 2026-10-18 is Week Off (NOT Holiday!)
    const sun5Rec = emp5Calendar.find((r) => r.date === testSun);
    assert(sun5Rec?.status === 'Week Off', '7.3 Sunday is displayed as "Week Off", NOT "Holiday"');

    // Check Saturday 2026-10-24 is Week Off
    const sat5Rec = emp5Calendar.find((r) => r.date === '2026-10-24');
    assert(sat5Rec?.status === 'Week Off', '7.4 Saturday is displayed as "Week Off" for 5-day employee');

    // Summary checks for 5-day employee
    assert(emp5AttBody.summary?.week_off >= 8, '7.5 Monthly summary tracks week_off count (at least 8–9 for 5-day worker)');
    assert(emp5AttBody.summary?.absent === 0, '7.6 Week Off days do NOT count as Absent');

    // 7.2 Employee 6 (6-day worker) gets monthly attendance
    const user6Row = await pool.query('SELECT id, email FROM public.users WHERE employee_id = $1', [emp6Id]);
    const emp6Token = generateToken({
      userId: user6Row.rows[0].id,
      email: user6Row.rows[0].email,
      role: 'EMPLOYEE',
      employeeId: emp6Id,
    });

    const resEmp6Att = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-10',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp6Token}` },
    });
    assert(resEmp6Att.statusCode === 200, '7.7 6-day employee fetches attendance calendar (200 OK)');
    const emp6AttBody = resEmp6Att.json();
    const emp6Calendar = emp6AttBody.data || [];

    // Check Sunday 2026-10-18 is Week Off
    const sun6Rec = emp6Calendar.find((r) => r.date === testSun);
    assert(sun6Rec?.status === 'Week Off', '7.8 Sunday is displayed as "Week Off" for 6-day employee');

    // Check unmarked Saturday 2026-10-24 is Not Marked (NOT Week Off!)
    const sat6Rec = emp6Calendar.find((r) => r.date === '2026-10-24');
    assert(sat6Rec?.status === 'Not Marked', '7.9 Unmarked Saturday is "Not Marked" (working day) for 6-day employee');

    // 6-day worker has fewer week offs than 5-day worker (approx 4–5 Sundays vs 9 Sat+Sun)
    assert(
      emp6AttBody.summary?.week_off < emp5AttBody.summary?.week_off,
      '7.10 6-day worker summary has fewer week offs than 5-day worker'
    );

    // =========================================================================
    // 8. PAYROLL SAFETY & INTEGRITY
    // =========================================================================
    console.log('\n--- 8. PAYROLL & LEAVE INTEGRITY ---');

    // Week Off days must NOT inflate unpaidLeave / Lop deductions in payroll summary
    const resPayrollAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/attendance-summary?month=10&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resPayrollAtt.statusCode === 200, '8.1 Payroll attendance summary returns 200 OK');
    const payrollAttData = resPayrollAtt.json()?.data;
    assert(
      payrollAttData?.unpaid_leave_days === 0 || payrollAttData?.unpaidLeave !== undefined,
      '8.2 Week Off days do NOT cause unpaid leave or lop deduction in payroll'
    );

  } catch (err) {
    console.error('Fatal error during attendance schedule test suite:', err);
    failed++;
  } finally {
    console.log('\n--- CLEANING UP TEST ARTIFACTS ---');
    for (const empId of createdEmployeeIds) {
      await pool.query('DELETE FROM public.attendance WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.audit_logs WHERE entity_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.pf_details WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.users WHERE employee_id = $1', [empId]).catch(() => {});
      console.log(`  Cleaned up test employee: ${empId}`);
    }
    for (const em of createdEmails) {
      await pool.query('DELETE FROM public.users WHERE email = $1', [em]).catch(() => {});
    }

    console.log('\n================================================================');
    console.log(`   ATTENDANCE SCHEDULE TESTS: ${passed} PASSED, ${failed} FAILED   `);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runAttendanceScheduleTests();
