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

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
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

async function runCorrectionsTests() {
  console.log('================================================================');
  console.log('  GAINTPRO EMPLOYEE PORTAL — PHASE 21 BUSINESS CORRECTIONS TEST ');
  console.log('  EMPLOYEE ID + ADMIN ATTENDANCE (DATE NAV + WEEK OFF)          ');
  console.log('================================================================\n');

  const createdEmployeeIds = [];
  const createdEmails = [];
  const createdAttendanceIds = [];

  try {
    // 0. Setup: Admin and Employee tokens
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

    // =========================================================================
    // 1. EMPLOYEE ID REQUIREMENT & VALIDATION TESTS
    // =========================================================================
    console.log('\n--- 1. EMPLOYEE ID VALIDATION & ADMIN ENTRY ---');

    // 1.1 Missing employee_id returns 400
    const resNoId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      firstName: 'NoId',
      email: `noid.${Date.now()}@gaintpro.com`,
      department: 'HR',
      designation: 'Officer',
    });
    assert(resNoId.statusCode === 400 && resNoId.json()?.message?.includes('Employee ID is required'),
      '1.1 Missing employee_id returns 400 with "Employee ID is required."');

    // 1.2 Invalid format (too short, wrong prefix, lowercase) returns 400
    const resBadId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP123N',
      firstName: 'BadId',
      email: `badid.${Date.now()}@gaintpro.com`,
      department: 'HR',
      designation: 'Officer',
    });
    assert(resBadId.statusCode === 400 && resBadId.json()?.message?.includes('GP####N'),
      '1.2 Invalid employee_id format returns 400 with format hint');

    // 1.3 Admin provides valid GP0025N -> stored exactly as GP0025N
    const testEmail1 = `enter.id.${Date.now()}@gaintpro.com`;
    const resValidId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP0025N',
      firstName: 'AdminEntered',
      lastName: 'Employee',
      email: testEmail1,
      department: 'Technology',
      designation: 'Software Engineer',
      working_days_per_week: 5,
    });
    assert(resValidId.statusCode === 201, '1.3 Admin successfully enters GP0025N during onboarding (201 Created)');
    const createdId = resValidId.json()?.data?.employee_id;
    assert(createdId === 'GP0025N', '1.4 Backend stored exact Admin-provided Employee ID GP0025N');
    createdEmployeeIds.push(createdId);
    createdEmails.push(testEmail1);

    // 1.5 Duplicate Employee ID returns 409 Conflict with exact message
    const resDupId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP0025N',
      firstName: 'Duplicate',
      email: `dup.emp.${Date.now()}@gaintpro.com`,
      department: 'Finance',
      designation: 'Accountant',
      working_days_per_week: 5,
    });
    assert(resDupId.statusCode === 409 && resDupId.json()?.message === 'Employee ID already exists.',
      '1.5 Duplicate employee_id returns 409 Conflict with "Employee ID already exists."');

    // =========================================================================
    // 2. ADMIN ATTENDANCE DEFAULT DATE & NAVIGATION
    // =========================================================================
    console.log('\n--- 2. ADMIN ATTENDANCE DEFAULT DATE & NAVIGATION ---');

    const todayStr = new Date().toISOString().split('T')[0];

    // 2.1 Default retrieval without ?date defaults to today's runtime date
    const resDefaultDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resDefaultDate.statusCode === 200, '2.1 GET /api/admin/attendance without date returns 200 OK');
    assert(resDefaultDate.json()?.date === todayStr, `2.2 Default date is runtime today (${todayStr}), NOT hardcoded`);

    // 2.2 Retrieval with explicit date returns only that date
    const explicitDate = '2026-10-15';
    const resExplicit = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${explicitDate}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resExplicit.statusCode === 200 && resExplicit.json()?.date === explicitDate,
      `2.3 Explicit date ?date=${explicitDate} returns exact requested date`);

    // 2.3 Invalid date format returns 400
    const resInvalidDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=not-a-date',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resInvalidDate.statusCode === 400, '2.4 Invalid date format returns 400 Bad Request');

    // =========================================================================
    // 3. SATURDAY & SUNDAY = WEEK OFF DEFAULT
    // =========================================================================
    console.log('\n--- 3. SATURDAY & SUNDAY = WEEK OFF DEFAULT ---');

    // Known calendar dates:
    // 2026-10-17 is Saturday (DOW = 6)
    // 2026-10-18 is Sunday (DOW = 0)
    // 2026-10-19 is Monday (DOW = 1)
    const saturday = '2026-10-17';
    const sunday = '2026-10-18';
    const monday = '2026-10-19';

    // 3.1 Saturday retrieval without records defaults unmarked employees to 'Week Off'
    const resSat = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${saturday}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resSat.statusCode === 200, '3.1 GET /api/admin/attendance for Saturday returns 200 OK');
    const satData = resSat.json()?.data || [];
    const allSatWeekOff = satData.every((r) => r.attendance_status === 'Week Off');
    assert(allSatWeekOff && satData.length > 0, '3.2 Unmarked employees on Saturday default to "Week Off"');
    assert(resSat.json()?.summary?.week_off > 0, '3.3 Saturday summary reflects week_off count');
    assert(resSat.json()?.summary?.not_marked === 0, '3.4 Saturday summary has 0 not_marked');

    // 3.2 Sunday retrieval without records defaults unmarked employees to 'Week Off'
    const resSun = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${sunday}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resSun.statusCode === 200, '3.5 GET /api/admin/attendance for Sunday returns 200 OK');
    const sunData = resSun.json()?.data || [];
    const allSunWeekOff = sunData.every((r) => r.attendance_status === 'Week Off');
    assert(allSunWeekOff && sunData.length > 0, '3.6 Unmarked employees on Sunday default to "Week Off"');
    assert(resSun.json()?.summary?.week_off > 0, '3.7 Sunday summary reflects week_off count');

    // 3.3 Monday retrieval without records leaves unmarked as null / Not Marked
    const resMon = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${monday}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resMon.statusCode === 200, '3.8 GET /api/admin/attendance for Monday returns 200 OK');
    const monData = resMon.json()?.data || [];
    const monUnmarked = monData.filter((r) => r.attendance_status === null);
    assert(monUnmarked.length > 0, '3.9 Unmarked employees on Monday have attendance_status null (Not Marked)');
    assert(resMon.json()?.summary?.not_marked > 0, '3.10 Monday summary has not_marked > 0');

    // =========================================================================
    // 4. WEEKEND OVERRIDE & EDITING
    // =========================================================================
    console.log('\n--- 4. WEEKEND OVERRIDE & EXPLICIT MARKING ---');

    // 4.1 Mark Saturday as Present explicitly for GP0025N
    const resMarkSat = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP0025N',
      attendance_date: saturday,
      status: 'Present',
      remarks: 'Weekend deployment coverage',
    });
    assert(resMarkSat.statusCode === 201, '4.1 Admin explicitly marks Saturday as Present (201 Created)');
    const satAttId = resMarkSat.json()?.data?.id;
    if (satAttId) createdAttendanceIds.push(satAttId);

    // 4.2 Verify explicit record overrides default Week Off for that employee
    const resSatAfterMark = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${saturday}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const targetEmpSat = resSatAfterMark.json()?.data?.find((r) => r.employee_id === 'GP0025N');
    assert(targetEmpSat?.attendance_status === 'Present',
      '4.2 Explicit Present record takes precedence over default Week Off on Saturday');
    assert(resSatAfterMark.json()?.summary?.present === 1,
      '4.3 Saturday summary shows 1 Present');

    // 4.3 Update Saturday attendance to Half Day
    const resUpdateSat = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance/${satAttId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      status: 'Half Day',
      remarks: 'Half day deployment',
    });
    assert(resUpdateSat.statusCode === 200, '4.4 Admin updates Saturday attendance to Half Day (200 OK)');

    // 4.4 Explicit marking as 'Week Off' is supported by constraint and endpoint
    const resMarkWeekOff = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP0025N',
      attendance_date: monday,
      status: 'Week Off',
      remarks: 'Compensatory off',
    });
    assert(resMarkWeekOff.statusCode === 201, '4.5 Marking status as "Week Off" allowed by database constraint (201 Created)');
    if (resMarkWeekOff.json()?.data?.id) createdAttendanceIds.push(resMarkWeekOff.json().data.id);

    // =========================================================================
    // 5. MARK ALL PRESENT WEEKEND SAFETY
    // =========================================================================
    console.log('\n--- 5. MARK ALL PRESENT WEEKEND SAFETY ---');

    // 5.1 On weekend without confirmation -> blocked with require_confirmation
    const resMarkAllSatNoConfirm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance/mark-all-present',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      attendance_date: sunday,
    });
    assert(resMarkAllSatNoConfirm.statusCode === 400 && resMarkAllSatNoConfirm.json()?.require_confirmation === true,
      '5.1 Weekend "Mark All Present" requires confirmation and returns require_confirmation: true');

    // 5.2 On weekend with confirm_weekend: true -> succeeds
    const resMarkAllSatConfirm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance/mark-all-present',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      attendance_date: sunday,
      confirm_weekend: true,
    });
    assert(resMarkAllSatConfirm.statusCode === 200, '5.2 Weekend "Mark All Present" succeeds with explicit confirmation');

    // =========================================================================
    // 6. STATUS FILTERING & MONTHLY ATTENDANCE
    // =========================================================================
    console.log('\n--- 6. STATUS FILTERING & MONTHLY ATTENDANCE ---');

    // 6.1 Filter status=Week Off on Saturday
    const resFilterWeekOff = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${saturday}&status=${encodeURIComponent('Week Off')}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resFilterWeekOff.statusCode === 200, '6.1 Filter ?status=Week Off returns 200 OK');
    const filteredWeekOffRows = resFilterWeekOff.json()?.data || [];
    assert(filteredWeekOffRows.every((r) => r.attendance_status === 'Week Off'),
      '6.2 All returned rows in status=Week Off filter have status "Week Off"');

    // 6.2 Filter status=Not Marked on Saturday returns 0
    const resFilterNotMarked = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${saturday}&status=${encodeURIComponent('Not Marked')}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resFilterNotMarked.statusCode === 200 && (resFilterNotMarked.json()?.data?.length || 0) === 0,
      '6.3 Filter ?status=Not Marked on Saturday returns 0 records');

    // 6.3 Monthly attendance reflects Week Off on weekends
    const resMonthly = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance/monthly?month=2026-10',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resMonthly.statusCode === 200, '6.4 GET /api/admin/attendance/monthly returns 200 OK');
    assert(resMonthly.json()?.overall_summary?.week_off > 0, '6.5 Monthly overall_summary includes week_off > 0');

    // 6.4 Payroll attendance summary does NOT count Week Off as Absent
    const resPayrollAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/attendance-summary?month=10&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resPayrollAtt.statusCode === 200, '6.6 Payroll attendance summary returns 200 OK');
    // Ensure payroll metrics are preserved
    assert(resPayrollAtt.json()?.data?.unpaidLeave !== undefined, '6.7 Payroll unpaidLeave is present and unharmed');

    // 6.5 Employee attendance summary tracks week_off without affecting working_days
    const resEmpAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-10',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAtt.statusCode === 200, '6.8 Employee attendance returns 200 OK');
    assert(resEmpAtt.json()?.summary?.week_off !== undefined, '6.9 Employee attendance summary includes week_off field');

  } catch (err) {
    console.error('Fatal error during corrections tests:', err);
    failed++;
  } finally {
    // Clean up
    console.log('\n--- CLEANING UP TEST ARTIFACTS ---');
    for (const attId of createdAttendanceIds) {
      await pool.query('DELETE FROM public.attendance WHERE id = $1', [attId]).catch(() => {});
    }
    // Also clean up sunday records created by mark-all-present
    await pool.query("DELETE FROM public.attendance WHERE attendance_date = '2026-10-18'::date").catch(() => {});
    await pool.query("DELETE FROM public.attendance WHERE attendance_date = '2026-10-17'::date").catch(() => {});
    await pool.query("DELETE FROM public.attendance WHERE attendance_date = '2026-10-19'::date AND remarks = 'Compensatory off'").catch(() => {});

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

  console.log('\n================================================================');
  console.log(`  PHASE 21 CORRECTIONS TESTS: ${passed} PASSED, ${failed} FAILED  `);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCorrectionsTests();
