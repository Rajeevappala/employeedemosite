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
  console.log('       ADMIN DASHBOARD BACKEND INTEGRATION TESTS');
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
    // 1. Fetch employee & admin users from DB
    const empUserRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
       LIMIT 1`
    );
    const empUser = empUserRes.rows[0];

    const adminUserRes = await pool.query(
      `SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1`
    );
    const adminUser = adminUserRes.rows[0];

    // Generate tokens
    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employeeId: empUser.employee_id,
    });

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const superAdminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'SUPER_ADMIN',
    });

    // TEST 1: Unauthenticated request -> 401
    const resNoAuth = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
    });
    assert(resNoAuth.statusCode === 401, `Unauthenticated request returns 401 (got ${resNoAuth.statusCode})`);

    // TEST 2: Employee token accessing admin dashboard -> 403 Forbidden
    const resEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmp.statusCode === 403, `Employee token returns 403 on admin dashboard (got ${resEmp.statusCode})`);

    // TEST 3: Admin token -> 200 OK
    const resAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdmin.statusCode === 200, `Admin token returns 200 (got ${resAdmin.statusCode})`);
    const data = resAdmin.json()?.data;
    assert(data != null, 'Response contains data object');

    // TEST 4: Super Admin token -> 200 OK
    const resSuperAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(resSuperAdmin.statusCode === 200, `Super Admin token returns 200 (got ${resSuperAdmin.statusCode})`);

    // TEST 5: Verify Employees summary against DB
    const dbEmpRes = await pool.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN UPPER(status) = 'ACTIVE' THEN 1 END)::int AS active,
        COUNT(CASE WHEN UPPER(status) != 'ACTIVE' OR status IS NULL THEN 1 END)::int AS inactive
      FROM public.employees
    `);
    const dbEmp = dbEmpRes.rows[0];
    assert(data?.employees?.total === dbEmp.total, `Employee total matches DB (${data?.employees?.total} vs ${dbEmp.total})`);
    assert(data?.employees?.active === dbEmp.active, `Employee active matches DB (${data?.employees?.active} vs ${dbEmp.active})`);
    assert(data?.employees?.inactive === dbEmp.inactive, `Employee inactive matches DB (${data?.employees?.inactive} vs ${dbEmp.inactive})`);

    // TEST 6: Verify Today's Attendance against DB
    const today = new Date().toISOString().split('T')[0];
    const dbAttRes = await pool.query(`
      SELECT 
        COUNT(e.employee_id)::int AS total_workforce,
        COUNT(CASE WHEN a.status = 'Present' THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)::int AS absent,
        COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int AS half_day,
        COUNT(CASE WHEN a.status = 'Leave' THEN 1 END)::int AS leave,
        COUNT(CASE WHEN a.status = 'Holiday' THEN 1 END)::int AS holiday,
        COUNT(CASE WHEN a.status = 'Work From Home' THEN 1 END)::int AS work_from_home,
        COUNT(CASE WHEN a.id IS NULL THEN 1 END)::int AS not_marked
      FROM public.employees e
      LEFT JOIN public.attendance a
        ON a.employee_id = e.employee_id
       AND a.attendance_date = $1::date
      WHERE UPPER(e.status) = 'ACTIVE'
    `, [today]);
    const dbAtt = dbAttRes.rows[0];
    assert(data?.attendance?.total_workforce === dbAtt.total_workforce, `Attendance total workforce matches DB (${data?.attendance?.total_workforce})`);
    assert(data?.attendance?.present === dbAtt.present, `Attendance present matches DB (${data?.attendance?.present})`);
    assert(data?.attendance?.absent === dbAtt.absent, `Attendance absent matches DB (${data?.attendance?.absent})`);
    assert(data?.attendance?.not_marked === dbAtt.not_marked, `Attendance not_marked matches DB (${data?.attendance?.not_marked})`);

    // TEST 7: Verify Leaves summary against DB
    const dbLeaveRes = await pool.query(`
      SELECT 
        COUNT(CASE WHEN status = 'Pending' THEN 1 END)::int AS pending,
        COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int AS approved,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END)::int AS rejected,
        COUNT(CASE WHEN status = 'Cancelled' THEN 1 END)::int AS cancelled,
        COUNT(*)::int AS total
      FROM public.leave_requests
    `);
    const dbLeave = dbLeaveRes.rows[0];
    assert(data?.leaves?.pending === dbLeave.pending, `Leaves pending matches DB (${data?.leaves?.pending})`);
    assert(data?.leaves?.approved === dbLeave.approved, `Leaves approved matches DB (${data?.leaves?.approved})`);
    assert(data?.leaves?.rejected === dbLeave.rejected, `Leaves rejected matches DB (${data?.leaves?.rejected})`);
    assert(data?.leaves?.total === dbLeave.total, `Leaves total matches DB (${data?.leaves?.total})`);

    // TEST 8: Verify Documents summary against DB
    const dbDocRes = await pool.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN LOWER(document_type) = 'payslip' THEN 1 END)::int AS payslips,
        COUNT(CASE WHEN LOWER(document_type) = 'offer letter' THEN 1 END)::int AS offer_letters,
        COUNT(CASE WHEN LOWER(document_type) NOT IN ('payslip', 'offer letter') THEN 1 END)::int AS other
      FROM public.documents
    `);
    const dbDoc = dbDocRes.rows[0];
    assert(data?.documents?.total === dbDoc.total, `Documents total matches DB (${data?.documents?.total})`);
    assert(data?.documents?.payslips === dbDoc.payslips, `Documents payslips matches DB (${data?.documents?.payslips})`);
    assert(data?.documents?.offer_letters === dbDoc.offer_letters, `Documents offer_letters matches DB (${data?.documents?.offer_letters})`);

    // TEST 9: Verify Department overview against DB
    assert(Array.isArray(data?.departments), 'Departments is an array');
    assert(data?.departments?.length > 0, 'Departments contains real departments');
    assert(data?.departments[0]?.name === 'Engineering', 'First department is Engineering');
    assert(data?.departments[0]?.count === 1, 'Engineering count is 1');
    assert(data?.departments[0]?.percentage === 100, 'Engineering percentage is 100%');

    // TEST 10: Query filter for Payroll: month=9&year=2026
    const resFilteredPayroll = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=9&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resFilteredPayroll.statusCode === 200, `Filtered payroll query returns 200`);
    const filteredData = resFilteredPayroll.json()?.data;
    assert(filteredData?.payroll?.month === 9, 'Filtered payroll month is 9');
    assert(filteredData?.payroll?.year === 2026, 'Filtered payroll year is 2026');
    assert(filteredData?.payroll?.total_records === 1, 'Filtered payroll total_records is 1');
    assert(filteredData?.payroll?.processed === 1, 'Filtered payroll processed is 1');
    assert(parseFloat(filteredData?.payroll?.gross_salary) === 40000, 'Filtered gross salary is 40000');
    assert(parseFloat(filteredData?.payroll?.total_deductions) === 2500, 'Filtered deductions is 2500');
    assert(parseFloat(filteredData?.payroll?.net_salary) === 37500, 'Filtered net salary is 37500');

    // TEST 11: Query filter for Payroll with empty period: month=1&year=2024
    const resEmptyPayroll = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=1&year=2024',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resEmptyPayroll.statusCode === 200, 'Empty payroll period returns 200');
    const emptyData = resEmptyPayroll.json()?.data;
    assert(emptyData?.payroll?.total_records === 0, 'Empty payroll total_records is 0');
    assert(parseFloat(emptyData?.payroll?.net_salary) === 0, 'Empty payroll net_salary is 0.00');

    // TEST 12: Verify Recent Leaves
    assert(Array.isArray(data?.recent_leaves), 'recent_leaves is an array');
    assert(data?.recent_leaves?.length > 0, 'recent_leaves returns real records');
    const firstLeave = data?.recent_leaves[0];
    assert(firstLeave?.employee_id === 'GP0001N', `Recent leave employee_id is GP0001N (${firstLeave?.employee_id})`);
    assert(firstLeave?.employee_name === 'Rajeev Appala', `Recent leave employee_name is Rajeev Appala`);

    // TEST 13: Verify Recent Payroll
    assert(Array.isArray(data?.recent_payroll), 'recent_payroll is an array');
    assert(data?.recent_payroll?.length > 0, 'recent_payroll returns real records');
    const firstPayroll = data?.recent_payroll[0];
    assert(firstPayroll?.employee_id === 'GP0001N', `Recent payroll employee_id is GP0001N`);
    assert(parseFloat(firstPayroll?.net_salary) === 37500, `Recent payroll net_salary is 37500`);

    // TEST 14: Validation - Invalid month -> 400
    const resInvalidMonth = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=13',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resInvalidMonth.statusCode === 400, `Invalid month (13) returns 400 (got ${resInvalidMonth.statusCode})`);

    const resInvalidMonthStr = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=invalid',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resInvalidMonthStr.statusCode === 400, `Invalid month ('invalid') returns 400 (got ${resInvalidMonthStr.statusCode})`);

    // TEST 15: Validation - Invalid year -> 400
    const resInvalidYear = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?year=1800',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resInvalidYear.statusCode === 400, `Invalid year (1800) returns 400 (got ${resInvalidYear.statusCode})`);

    // TEST 16: Validation - Invalid date format -> 400
    const resInvalidDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?date=not-a-date',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resInvalidDate.statusCode === 400, `Invalid date returns 400 (got ${resInvalidDate.statusCode})`);

    // TEST 17: Security - Verify zero sensitive data in response
    const rawResponse = resAdmin.body.toString('utf8');
    assert(!rawResponse.includes('password'), 'Response contains no password');
    assert(!rawResponse.includes('storage_key'), 'Response contains no storage_key');
    assert(!rawResponse.includes('storage/private'), 'Response contains no private storage path');
    assert(!rawResponse.includes('JWT_SECRET'), 'Response contains no secret keys');

    console.log(`\n========================================================`);
    console.log(`ADMIN DASHBOARD BACKEND SUMMARY: ${passed} passed, ${failed} failed`);
    console.log(`========================================================`);
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    await pool.end();
  }
}

runTests();
