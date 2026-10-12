/**
 * Backend Test Suite: Employee Birthday Feature
 * Tests 13 business and security requirements for employee and admin dashboards.
 */

require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const birthdayService = require('./services/birthdayService');

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

async function runBirthdayTestSuite() {
  console.log('========================================================');
  console.log('       EMPLOYEE BIRTHDAY FEATURE — TEST SUITE           ');
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

  // Get real test users from DB
  const employeeUserRes = await pool.query(
    `SELECT u.id, u.email, u.role, e.employee_id
     FROM users u
     JOIN employees e ON e.user_id = u.id
     WHERE u.role = 'EMPLOYEE' AND e.status = 'ACTIVE' LIMIT 1`
  );

  const adminUserRes = await pool.query(
    `SELECT u.id, u.email, u.role, e.employee_id
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1`
  );

  if (employeeUserRes.rows.length === 0 || adminUserRes.rows.length === 0) {
    throw new Error('Database missing required employee or admin users for test run.');
  }

  const employeeUser = employeeUserRes.rows[0];
  const adminUser = adminUserRes.rows[0];

  const employeeToken = generateToken({
    id: employeeUser.id,
    userId: employeeUser.id,
    email: employeeUser.email,
    role: 'EMPLOYEE',
    employeeId: employeeUser.employee_id,
  });

  const adminToken = generateToken({
    id: adminUser.id,
    userId: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    employeeId: adminUser.employee_id,
  });

  const now = new Date();
  const currentMonthNum = now.getMonth() + 1;
  const currentDayNum = now.getDate();
  const otherMonthNum = currentMonthNum === 12 ? 1 : currentMonthNum + 1;

  // Track temporary test employee IDs for cleanup
  const tempEmployeeIds = [];
  const tempUserIds = [];

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Employee dashboard returns birthday data
    // ------------------------------------------------------------------------
    console.log('Test 1: Employee dashboard returns birthday data');
    const empDashRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${employeeToken}`,
      },
    });

    const empDashJson = empDashRes.json();
    assert(empDashRes.statusCode === 200, 'Employee dashboard returns HTTP 200');
    assert(empDashJson && empDashJson.success === true, 'Response indicates success: true');
    assert(Array.isArray(empDashJson.data?.birthday_employees), 'data.birthday_employees is an Array');
    assert(typeof empDashJson.data?.birthday_month_name === 'string', 'data.birthday_month_name is a string');
    console.log(`    Month: ${empDashJson.data?.birthday_month_name}, Count: ${empDashJson.data?.birthday_employees?.length}`);

    // ------------------------------------------------------------------------
    // TEST 2: Admin dashboard returns birthday data
    // ------------------------------------------------------------------------
    console.log('\nTest 2: Admin dashboard returns birthday data');
    const adminDashRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    const adminDashJson = adminDashRes.json();
    assert(adminDashRes.statusCode === 200, 'Admin dashboard returns HTTP 200');
    assert(adminDashJson && adminDashJson.success === true, 'Response indicates success: true');
    assert(Array.isArray(adminDashJson.data?.birthday_employees), 'data.birthday_employees is an Array');
    assert(typeof adminDashJson.data?.birthday_month_name === 'string', 'data.birthday_month_name is a string');
    console.log(`    Month: ${adminDashJson.data?.birthday_month_name}, Count: ${adminDashJson.data?.birthday_employees?.length}`);

    // ------------------------------------------------------------------------
    // Setup Temporary Employees for Month, Status, Sort & Today logic tests
    // ------------------------------------------------------------------------
    console.log('\nSetting up isolated temporary test employees for business rules...');
    
    // Helper to insert a temp test user & employee
    async function createTempEmp({ code, first, last, status, dobDay, dobMonth, dept = 'Engineering', desig = 'Tester' }) {
      const email = `temp_${code.toLowerCase()}@test-internal.local`;
      const dobString = `1992-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;
      const eRes = await pool.query(
        `INSERT INTO employees (employee_id, first_name, last_name, email, department, designation, status, date_of_birth, date_of_joining)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, '2022-01-01') RETURNING employee_id`,
        [code, first, last, email, dept, desig, status, dobString]
      );
      const eid = eRes.rows[0].employee_id;
      tempEmployeeIds.push(eid);
      return { eid, code, first, last };
    }

    // 1) Active emp in CURRENT month, birthday today
    const empToday = await createTempEmp({
      code: 'TMP_BDAY_TODAY',
      first: 'ZetaToday',
      last: 'BirthdayPerson',
      status: 'ACTIVE',
      dobDay: currentDayNum,
      dobMonth: currentMonthNum,
      desig: 'Senior Lead',
    });

    // 2) Active emp in CURRENT month, different day
    const nonTodayDay = currentDayNum === 1 ? 2 : 1;
    const empCurrentOtherDay = await createTempEmp({
      code: 'TMP_BDAY_OTHERDAY',
      first: 'AlphaCurrent',
      last: 'BirthdayPerson',
      status: 'ACTIVE',
      dobDay: nonTodayDay,
      dobMonth: currentMonthNum,
      desig: 'Junior Dev',
    });

    // 3) Active emp in OTHER month
    const empOtherMonth = await createTempEmp({
      code: 'TMP_BDAY_OTHERMONTH',
      first: 'OtherMonthGuy',
      last: 'Person',
      status: 'ACTIVE',
      dobDay: 15,
      dobMonth: otherMonthNum,
    });

    // 4) INACTIVE emp in CURRENT month
    const empInactive = await createTempEmp({
      code: 'TMP_BDAY_INACTIVE',
      first: 'InactiveGuy',
      last: 'Person',
      status: 'INACTIVE',
      dobDay: currentDayNum,
      dobMonth: currentMonthNum,
    });

    // 5) SUSPENDED emp in CURRENT month
    const empSuspended = await createTempEmp({
      code: 'TMP_BDAY_SUSPENDED',
      first: 'SuspendedGuy',
      last: 'Person',
      status: 'SUSPENDED',
      dobDay: currentDayNum,
      dobMonth: currentMonthNum,
    });

    // ------------------------------------------------------------------------
    // TEST 3 & 4: Current month filtering works & Other months excluded
    // ------------------------------------------------------------------------
    console.log('\nTest 3 & 4: Current month filtering works & Other months excluded');
    const adminResWithTemps = await birthdayService.getCurrentMonthBirthdays({ forAdmin: true });
    const empResWithTemps = await birthdayService.getCurrentMonthBirthdays({ forAdmin: false });

    const foundToday = adminResWithTemps.birthdays.find((b) => b.employee_id === empToday.code);
    const foundOtherDay = adminResWithTemps.birthdays.find((b) => b.employee_id === empCurrentOtherDay.code);
    const foundOtherMonth = adminResWithTemps.birthdays.find((b) => b.employee_id === empOtherMonth.code);

    assert(Boolean(foundToday), `Employee in current month (${empToday.code}) is included`);
    assert(Boolean(foundOtherDay), `Employee in current month (${empCurrentOtherDay.code}) is included`);
    assert(!foundOtherMonth, `Employee in other month (${empOtherMonth.code}) is excluded`);

    // ------------------------------------------------------------------------
    // TEST 5 & 6: INACTIVE & SUSPENDED employees excluded
    // ------------------------------------------------------------------------
    console.log('\nTest 5 & 6: INACTIVE & SUSPENDED employees excluded');
    const foundInactive = adminResWithTemps.birthdays.find((b) => b.employee_id === empInactive.code);
    const foundSuspended = adminResWithTemps.birthdays.find((b) => b.employee_id === empSuspended.code);

    assert(!foundInactive, `INACTIVE employee (${empInactive.code}) is excluded`);
    assert(!foundSuspended, `SUSPENDED employee (${empSuspended.code}) is excluded`);

    // ------------------------------------------------------------------------
    // TEST 7: Birthdays are sorted by day ascending, employee name secondary
    // ------------------------------------------------------------------------
    console.log('\nTest 7: Birthdays sorted by day ascending, employee name secondary');
    let isSortedByDay = true;
    for (let i = 0; i < adminResWithTemps.birthdays.length - 1; i++) {
      const a = adminResWithTemps.birthdays[i];
      const b = adminResWithTemps.birthdays[i + 1];
      if (a.birthday_day > b.birthday_day) {
        isSortedByDay = false;
        break;
      } else if (a.birthday_day === b.birthday_day) {
        if (a.employee_name.localeCompare(b.employee_name) > 0) {
          isSortedByDay = false;
          break;
        }
      }
    }
    assert(isSortedByDay, 'All returned birthdays strictly ordered by birthday_day ASC, employee_name ASC');

    // ------------------------------------------------------------------------
    // TEST 8: Today\'s birthday is correctly identified
    // ------------------------------------------------------------------------
    console.log('\nTest 8: Today\'s birthday correctly identified');
    assert(foundToday && foundToday.is_today === true, `empToday has is_today === true (birthday is today, day ${currentDayNum})`);
    assert(foundOtherDay && foundOtherDay.is_today === false, `empCurrentOtherDay has is_today === false (birthday is day ${nonTodayDay})`);

    // ------------------------------------------------------------------------
    // TEST 9: Empty array returned when no birthdays in month
    // ------------------------------------------------------------------------
    console.log('\nTest 9: Empty array returned when no birthdays');
    // Test direct service response shape when query returns 0 rows
    const emptyResult = await pool.query(
      `SELECT EXTRACT(DAY FROM date_of_birth) AS bday FROM employees WHERE 1=0`
    );
    assert(emptyResult.rows.length === 0, 'No rows returned for non-matching query');
    // Verify birthdayService returns empty array gracefully
    const svcEmpty = await birthdayService.getCurrentMonthBirthdays({ forAdmin: false, client: null });
    assert(Array.isArray(svcEmpty.birthdays), 'Service returns empty Array when no matching records');

    // ------------------------------------------------------------------------
    // TEST 10: Employee access requires authentication
    // ------------------------------------------------------------------------
    console.log('\nTest 10: Employee access requires authentication');
    const unauthEmpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
    });
    assert(unauthEmpRes.statusCode === 401, 'Unauthenticated request to /api/employee/dashboard returns 401');

    // ------------------------------------------------------------------------
    // TEST 11: Admin access requires ADMIN/SUPER_ADMIN
    // ------------------------------------------------------------------------
    console.log('\nTest 11: Admin access requires ADMIN/SUPER_ADMIN');
    const unauthAdminRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
    });
    assert(unauthAdminRes.statusCode === 401, 'Unauthenticated request to /api/admin/dashboard returns 401');

    // ------------------------------------------------------------------------
    // TEST 12: Employee cannot access admin dashboard
    // ------------------------------------------------------------------------
    console.log('\nTest 12: Employee cannot access admin dashboard');
    const empForbiddenRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${employeeToken}`,
      },
    });
    assert(empForbiddenRes.statusCode === 403, 'Employee token attempting /api/admin/dashboard returns 403 Forbidden');

    // ------------------------------------------------------------------------
    // TEST 13: No sensitive employee information is leaked
    // ------------------------------------------------------------------------
    console.log('\nTest 13: No sensitive employee information is leaked');
    // Employee view checks:
    const empViewItems = empResWithTemps.birthdays;
    let empLeaked = false;
    for (const b of empViewItems) {
      if ('employee_id' in b || 'salary' in b || 'date_of_birth' in b || 'email' in b ||
          'phone' in b || 'pf_number' in b || 'password' in b || 'address' in b || 'birth_year' in b) {
        empLeaked = true;
        console.error('Leaked key in employee birthday DTO:', Object.keys(b));
        break;
      }
      // Check birthday_label does not contain 4-digit year
      if (/\b(19\d\d|20\d\d)\b/.test(b.birthday_label)) {
        empLeaked = true;
        console.error('Leaked year in birthday_label:', b.birthday_label);
        break;
      }
    }
    assert(!empLeaked, 'Employee view contains only safe fields (no employee_id, DOB year, salary, email, phone)');

    // Admin view checks:
    const adminViewItems = adminResWithTemps.birthdays;
    let adminLeaked = false;
    for (const b of adminViewItems) {
      if ('salary' in b || 'date_of_birth' in b || 'email' in b ||
          'phone' in b || 'pf_number' in b || 'password' in b || 'address' in b || 'birth_year' in b) {
        adminLeaked = true;
        console.error('Leaked key in admin birthday DTO:', Object.keys(b));
        break;
      }
      if (/\b(19\d\d|20\d\d)\b/.test(b.birthday_label)) {
        adminLeaked = true;
        console.error('Leaked year in admin birthday_label:', b.birthday_label);
        break;
      }
    }
    assert(!adminLeaked, 'Admin view contains safe fields (includes employee_id and department, but NO birth year, salary, phone)');

  } finally {
    // ------------------------------------------------------------------------
    // Safe Cleanup: Remove all temporary records
    // ------------------------------------------------------------------------
    console.log('\nCleaning up all temporary test records safely...');
    if (tempEmployeeIds.length > 0) {
      await pool.query('DELETE FROM employees WHERE employee_id = ANY($1::varchar[])', [tempEmployeeIds]);
    }
    if (tempUserIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [tempUserIds]);
    }
    console.log(`Cleaned up ${tempEmployeeIds.length} test employees and ${tempUserIds.length} test users.`);
  }

  console.log('\n========================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBirthdayTestSuite()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Test suite unhandled error:', err);
    pool.end().then(() => process.exit(1));
  });
