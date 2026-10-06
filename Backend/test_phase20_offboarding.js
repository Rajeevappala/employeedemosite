require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');
const otpService = require('./services/otpService');

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
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
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

async function runTestSuite() {
  console.log('================================================================');
  console.log('PHASE 20 OFFBOARDING & F&F AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  const testEmpId = 'GP_TEST_EXIT_01';
  const testEmpId2 = 'GP_TEST_EXIT_02';
  const testAdminId = 'GP_TEST_ADMIN_01';

  let testUserId = null;
  let testUserId2 = null;
  let adminUserId = null;

  let empToken = null;
  let empToken2 = null;
  let adminToken = null;

  const createdStorageKeys = [];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Fixtures
    // -------------------------------------------------------------------------
    console.log('--- Setting up test fixtures ---');

    // Clean up previous runs if any
    await pool.query('DELETE FROM public.exit_requests WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.leave_requests WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.attendance WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.payroll_records WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.documents WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
    await pool.query('DELETE FROM public.users WHERE email IN ($1, $2, $3)', [
      'exit_test_emp1@gaintpro.com',
      'exit_test_emp2@gaintpro.com',
      'exit_test_admin@gaintpro.com',
    ]);

    // Insert Admin User
    const adminUserRes = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ('exit_test_admin@gaintpro.com', 'ADMIN', 'ACTIVE')
       RETURNING id`
    );
    adminUserId = adminUserRes.rows[0].id;
    adminToken = generateToken({ userId: adminUserId, email: 'exit_test_admin@gaintpro.com', role: 'ADMIN' });

    // Insert Test Employee 1
    const empUserRes = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ('exit_test_emp1@gaintpro.com', 'EMPLOYEE', 'ACTIVE')
       RETURNING id`
    );
    testUserId = empUserRes.rows[0].id;

    await pool.query(
      `INSERT INTO public.employees (
        employee_id, user_id, first_name, last_name, email, department, designation, date_of_joining, status
       ) VALUES ($1, $2, 'Rohan', 'Verma', 'exit_test_emp1@gaintpro.com', 'Technology', 'Senior Software Engineer', '2020-03-15', 'ACTIVE')`,
      [testEmpId, testUserId]
    );

    await pool.query(
      `UPDATE public.users SET employee_id = $1 WHERE id = $2`,
      [testEmpId, testUserId]
    );

    await pool.query(
      `INSERT INTO public.payroll_profiles (employee_id, basic_salary, hra, allowances, pf_employee, professional_tax)
       VALUES ($1, 45000.00, 18000.00, 7000.00, 1800.00, 200.00)`,
      [testEmpId]
    );

    await pool.query(
      `INSERT INTO public.leave_balances (employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance)
       VALUES ($1, 18.00, 12.00, 0.00)`,
      [testEmpId]
    );

    // Insert approved PL days to test encashment net
    await pool.query(
      `INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, days, status)
       VALUES ($1, 'PL', '2026-05-10', '2026-05-14', 4.00, 'Approved')`,
      [testEmpId]
    );

    // Insert future leave to test auto-cancellation
    await pool.query(
      `INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, days, status)
       VALUES ($1, 'PL', '2026-11-20', '2026-11-22', 2.00, 'Approved')`,
      [testEmpId]
    );

    // Insert attendance records for October 2026
    const attDates = [
      { d: '2026-10-01', s: 'Present' },
      { d: '2026-10-02', s: 'Holiday' },
      { d: '2026-10-05', s: 'Present' },
      { d: '2026-10-06', s: 'Work From Home' },
      { d: '2026-10-07', s: 'Half Day' },
      { d: '2026-10-08', s: 'Leave' },
      { d: '2026-10-09', s: 'Present' },
      { d: '2026-10-12', s: 'Present' },
      { d: '2026-10-13', s: 'Present' },
      { d: '2026-10-14', s: 'Present' },
      { d: '2026-10-15', s: 'Present' }, // Relieving day
    ];

    for (const item of attDates) {
      await pool.query(
        `INSERT INTO public.attendance (employee_id, attendance_date, status)
         VALUES ($1, $2, $3)`,
        [testEmpId, item.d, item.s]
      );
    }

    // Historical payroll record to verify preservation
    await pool.query(
      `INSERT INTO public.payroll_records (
        employee_id, month, year, working_days, payable_days, basic_salary, hra, allowances,
        gross_salary, pf_employee, professional_tax, total_deductions, net_salary, status
      ) VALUES ($1, 9, 2026, 26, 26, 45000, 18000, 7000, 70000, 1800, 200, 2000, 68000, 'Paid')`,
      [testEmpId]
    );

    empToken = generateToken({
      userId: testUserId,
      email: 'exit_test_emp1@gaintpro.com',
      role: 'EMPLOYEE',
      employeeId: testEmpId,
    });

    // Insert Test Employee 2 (for IDOR tests)
    const empUserRes2 = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ('exit_test_emp2@gaintpro.com', 'EMPLOYEE', 'ACTIVE')
       RETURNING id`
    );
    testUserId2 = empUserRes2.rows[0].id;

    await pool.query(
      `INSERT INTO public.employees (
        employee_id, user_id, first_name, last_name, email, department, designation, date_of_joining, status
       ) VALUES ($1, $2, 'Sneha', 'Patel', 'exit_test_emp2@gaintpro.com', 'HR', 'HR Specialist', '2022-01-10', 'ACTIVE')`,
      [testEmpId2, testUserId2]
    );

    await pool.query(
      `UPDATE public.users SET employee_id = $1 WHERE id = $2`,
      [testEmpId2, testUserId2]
    );

    empToken2 = generateToken({
      userId: testUserId2,
      email: 'exit_test_emp2@gaintpro.com',
      role: 'EMPLOYEE',
      employeeId: testEmpId2,
    });

    console.log('✅ Test fixtures successfully established.\n');

    // -------------------------------------------------------------------------
    // 1. Authentication & RBAC Tests
    // -------------------------------------------------------------------------
    console.log('--- 1. Authentication & RBAC ---');

    // 1. Unauthenticated request to employee exit apply
    const unauthApply = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert(unauthApply.statusCode === 401, 'Unauthenticated request to employee exit apply returns 401');

    // 2. Unauthenticated request to admin exit requests
    const unauthAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/requests',
      method: 'GET',
    });
    assert(unauthAdmin.statusCode === 401, 'Unauthenticated request to admin exit returns 401');

    // 3. Employee accessing admin exit route returns 403
    const empOnAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/requests',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empOnAdmin.statusCode === 403, 'Employee attempting to access admin exit endpoint returns 403 Forbidden');

    // 4. Admin accessing employee exit apply returns 403
    const adminOnEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { requested_relieving_date: '2026-10-15', reason: 'Admin test' });
    assert(adminOnEmp.statusCode === 403, 'Admin attempting to access employee apply endpoint returns 403 Forbidden');

    // -------------------------------------------------------------------------
    // 2. Input Validation Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Resignation Input Validation ---');

    // 5. Missing requested date returns 400
    const valNoDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { reason: 'Pursuing higher education' });
    assert(valNoDate.statusCode === 400, 'Missing requested relieving date returns 400 Bad Request');

    // 6. Invalid date format returns 400
    const valBadDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { requested_relieving_date: '15-10-2026', reason: 'Pursuing higher education' });
    assert(valBadDate.statusCode === 400, 'Invalid date format returns 400 Bad Request');

    // 7. Past relieving date returns 400
    const valPastDate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { requested_relieving_date: '2020-01-01', reason: 'Pursuing higher education' });
    assert(valPastDate.statusCode === 400, 'Past relieving date returns 400 Bad Request');

    // 8. Short reason (< 10 chars) returns 400
    const valShortReason = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { requested_relieving_date: '2026-10-15', reason: 'Leaving' });
    assert(valShortReason.statusCode === 400, 'Reason under 10 characters returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 3. Resignation Submission & Clearances
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Resignation Submission & Auto-Clearances ---');

    // 9. Valid resignation submission returns 201
    const applyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      requested_relieving_date: '2026-10-15',
      reason: 'Pursuing higher education opportunities abroad.',
    });
    const applyData = applyRes.json();
    assert(applyRes.statusCode === 201, 'Valid resignation returns 201 Created');
    assert(applyData?.success === true, 'Resignation response indicates success');
    assert(applyData?.data?.status === 'SUBMITTED', 'Exit request status is SUBMITTED');
    assert(applyData?.data?.employee_id === testEmpId, 'Exit request binds strictly to authenticated JWT employee_id');

    const exitRequestId = applyData?.data?.id;

    // 10. Verify 4 clearance records created in database
    const clrDb = await pool.query(
      'SELECT department, status FROM public.exit_clearances WHERE exit_request_id = $1 ORDER BY department ASC',
      [exitRequestId]
    );
    assert(clrDb.rows.length === 4, 'Exactly 4 clearance records created for exit request');
    const depts = clrDb.rows.map((r) => r.department);
    assert(
      depts.includes('IT') && depts.includes('FINANCE') && depts.includes('HR') && depts.includes('DEPARTMENT_HEAD'),
      'All 4 required departments (IT, FINANCE, HR, DEPARTMENT_HEAD) are present'
    );
    assert(clrDb.rows.every((r) => r.status === 'PENDING'), 'All 4 clearances initialized with status PENDING');

    // 11. Duplicate active resignation rejection returns 409
    const dupRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      requested_relieving_date: '2026-10-20',
      reason: 'Second duplicate resignation attempt',
    });
    assert(dupRes.statusCode === 409, 'Duplicate resignation while an active one exists returns 409 Conflict');

    // 12. Employee status endpoint returns active request and clearances
    const statusRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const statusData = statusRes.json();
    assert(statusRes.statusCode === 200, 'Employee get exit status returns 200 OK');
    assert(statusData?.data?.exitRequest?.id === exitRequestId, 'Status returns correct active exit request');
    assert(statusData?.data?.clearances?.length === 4, 'Status returns all 4 clearances');

    // -------------------------------------------------------------------------
    // 4. Withdrawal Lifecycle Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Withdrawal Lifecycle ---');

    // 13. Employee can withdraw SUBMITTED request
    const withdrawRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/withdraw',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(withdrawRes.statusCode === 200, 'Employee can withdraw SUBMITTED request (returns 200)');
    assert(withdrawRes.json()?.data?.status === 'WITHDRAWN', 'Status successfully changed to WITHDRAWN');

    // 14. After withdrawal, re-applying succeeds (201)
    const reapplyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      requested_relieving_date: '2026-10-15',
      reason: 'Re-applying formally after discussion with manager.',
    });
    assert(reapplyRes.statusCode === 201, 'Re-applying after withdrawal succeeds (returns 201)');
    const activeExitId = reapplyRes.json()?.data?.id;

    // -------------------------------------------------------------------------
    // 5. Admin Review & State Machine
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Admin Review & State Machine ---');

    // 15. Admin lists exit requests
    const listRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/requests?status=SUBMITTED',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(listRes.statusCode === 200, 'Admin can list exit requests with status filter');
    const hasActive = listRes.json()?.data?.some((r) => r.id === activeExitId);
    assert(hasActive, 'Active exit request appears in admin list');

    // 16. Admin transitions to UNDER_REVIEW
    const underReviewRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/requests/${activeExitId}/review`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { action: 'UNDER_REVIEW' });
    assert(underReviewRes.statusCode === 200, 'Admin can transition request to UNDER_REVIEW');
    assert(underReviewRes.json()?.data?.status === 'UNDER_REVIEW', 'Status updated to UNDER_REVIEW');

    // 17. Approval without approved relieving date fails (400)
    const badApproveRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/requests/${activeExitId}/review`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { action: 'APPROVE', approved_relieving_date: 'invalid-date' });
    assert(badApproveRes.statusCode === 400, 'Approval with invalid date returns 400');

    // 18. Valid Approval succeeds
    const approveRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/requests/${activeExitId}/review`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      action: 'APPROVE',
      approved_relieving_date: '2026-10-15',
      admin_remarks: 'Resignation accepted. Serving standard notice period.',
    });
    assert(approveRes.statusCode === 200, 'Admin can approve exit request with relieving date');
    assert(approveRes.json()?.data?.status === 'APPROVED', 'Status updated to APPROVED');

    // 19. Employee CANNOT withdraw an APPROVED request (400)
    const withdrawApproved = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/withdraw',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(withdrawApproved.statusCode === 400, 'Employee cannot withdraw an APPROVED exit request (returns 400)');

    // -------------------------------------------------------------------------
    // 6. Clearance Matrix Updates
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Clearance Matrix Updates ---');

    // Get active clearances
    const activeClrsRes = await pool.query(
      'SELECT id, department, status FROM public.exit_clearances WHERE exit_request_id = $1',
      [activeExitId]
    );
    const activeClrs = activeClrsRes.rows;

    const itClr = activeClrs.find((c) => c.department === 'IT');
    const finClr = activeClrs.find((c) => c.department === 'FINANCE');
    const hrClr = activeClrs.find((c) => c.department === 'HR');
    const deptHeadClr = activeClrs.find((c) => c.department === 'DEPARTMENT_HEAD');

    // 20. Update IT clearance to CLEARED
    const clrItRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${itClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'CLEARED', remarks: 'Laptop and charger returned in good condition.' });
    assert(clrItRes.statusCode === 200, 'Admin can update IT clearance to CLEARED');
    assert(clrItRes.json()?.data?.status === 'CLEARED', 'IT clearance status reflects CLEARED');

    // 21. Update Finance clearance to CLEARED
    const clrFinRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${finClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'CLEARED', remarks: 'No outstanding travel advances or corporate card dues.' });
    assert(clrFinRes.statusCode === 200, 'Admin can update Finance clearance to CLEARED');

    // 22. Update HR clearance to WAIVED
    const clrHrRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${hrClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'WAIVED', remarks: 'ID badge waiver approved.' });
    assert(clrHrRes.statusCode === 200, 'Admin can update HR clearance to WAIVED');

    // 23. Invalid clearance status returns 400
    const badClrStatus = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${deptHeadClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'INVALID_STATUS' });
    assert(badClrStatus.statusCode === 400, 'Invalid clearance status returns 400 Bad Request');

    // 23b. Update clearance to REJECTED without remarks (or < 5 chars) returns 400
    const rejectNoRemarks = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${deptHeadClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'REJECTED', remarks: 'bad' });
    assert(rejectNoRemarks.statusCode === 400, 'Updating clearance to REJECTED without remarks returns 400');

    // 23c. Update clearance to REJECTED with valid remarks succeeds
    const rejectValid = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${deptHeadClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'REJECTED', remarks: 'Handover documentation is incomplete.' });
    assert(rejectValid.statusCode === 200, 'Admin can update clearance to REJECTED with valid remarks');
    assert(rejectValid.json()?.data?.status === 'REJECTED', 'Clearance status reflects REJECTED');

    // -------------------------------------------------------------------------
    // 7. F&F Calculation Preview Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 7. F&F Settlement Calculation Engine ---');

    // 24. Calculate F&F preview with default gratuity (0.00)
    const fnfDefaultRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/fnf/calculate',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      exit_request_id: activeExitId,
      salary_divisor: 30,
      payable_days: 10,
      encashed_leave_days: 14,
    });
    const bDef = fnfDefaultRes.json()?.data;
    assert(fnfDefaultRes.statusCode === 200, 'F&F calculation preview with default gratuity returns 200 OK');
    assert(bDef?.gratuity?.gratuity_amount === 0, 'Default gratuity amount is 0.00 when not explicitly entered');
    assert(bDef?.gratuity?.is_eligible === undefined, 'No automatic statutory gratuity eligibility flag is returned');
    assert(bDef?.gratuity?.suggested_amount === undefined, 'No automatic statutory gratuity recommendation formula is returned');

    // 24b. Calculate F&F preview with explicit admin-provided gratuity
    const fnfCalcRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/fnf/calculate',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      exit_request_id: activeExitId,
      salary_divisor: 30,
      payable_days: 10,
      encashed_leave_days: 14,
      gratuity_amount: 50000,
      bonus_or_incentive: 10000,
      notice_recovery: 5000,
      other_deductions: 2000,
    });
    const fnfData = fnfCalcRes.json();
    assert(fnfCalcRes.statusCode === 200, 'F&F calculation preview returns 200 OK');
    assert(fnfData?.success === true, 'Calculation preview indicates success');

    const b = fnfData?.data;
    // Monthly gross = 45000 + 18000 + 7000 = 70000
    // Prorated salary = (70000 * 10) / 30 = 23333.33
    assert(Math.abs(b?.prorated_salary - 23333.33) < 0.1, `Prorated salary correctly calculated (~23333.33, got ${b?.prorated_salary})`);

    // Available PL = 18 - 4 (used) = 14
    assert(b?.leave_encashment?.available_pl_days === 14, `Available PL correctly detected (14 days, got ${b?.leave_encashment?.available_pl_days})`);
    // Daily Basic = 45000 / 30 = 1500
    // Leave encashment = 1500 * 14 = 21000
    assert(b?.leave_encashment?.leave_encashment_amount === 21000, `Leave encashment amount correctly computed (21000, got ${b?.leave_encashment?.leave_encashment_amount})`);

    // Tenure: 2020-03-15 to 2026-10-15 = 6 years (informational display only)
    assert(b?.tenure?.years >= 6, `Tenure correctly computed for informational display (>= 6 years, got ${b?.tenure?.years})`);
    assert(b?.gratuity?.gratuity_amount === 50000, 'Admin-entered gratuity amount is authoritative and preserved');

    // Total Earnings = 23333.33 + 21000 + 50000 + 10000 = 104333.33
    assert(Math.abs(b?.total_earnings - 104333.33) < 0.1, `Total earnings correctly totaled (~104333.33, got ${b?.total_earnings})`);
    // Total Deductions = 5000 + 2000 = 7000
    assert(b?.total_deductions === 7000, `Total deductions correctly totaled (7000, got ${b?.total_deductions})`);
    // Net Payable = 104333.33 - 7000 = 97333.33
    assert(Math.abs(b?.net_payable_amount - 97333.33) < 0.1, `Net settlement payable correctly computed (~97333.33, got ${b?.net_payable_amount})`);

    // 25. Calculation preview did NOT alter exit request or employee status
    const reqCheck1 = await pool.query('SELECT status FROM public.exit_requests WHERE id = $1', [activeExitId]);
    assert(reqCheck1.rows[0].status === 'APPROVED', 'Calculation preview did NOT mutate exit_requests status');

    const empCheck1 = await pool.query('SELECT status FROM public.employees WHERE employee_id = $1', [testEmpId]);
    assert(empCheck1.rows[0].status === 'ACTIVE', 'Calculation preview did NOT deactivate employee');

    // -------------------------------------------------------------------------
    // 8. Finalization Safety & Atomic Transaction
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Finalization Safety & Atomic Commit ---');

    // 26. Finalization FAILS if any clearance is still PENDING (deptHeadClr is still PENDING)
    const finalizeBlocked = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/fnf/finalize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      exit_request_id: activeExitId,
      salary_divisor: 30,
      payable_days: 10,
      encashed_leave_days: 14,
    });
    assert(finalizeBlocked.statusCode === 400, 'Finalization blocked when clearances are pending (returns 400)');
    assert(
      finalizeBlocked.json()?.message?.includes('pending or rejected clearances exist'),
      'Informative error message indicating pending clearances'
    );

    // 27. Update remaining clearance (DEPARTMENT_HEAD) to CLEARED
    const clrDeptRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/clearance/${deptHeadClr.id}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'CLEARED', remarks: 'Knowledge transfer and code repository access handed over.' });
    assert(clrDeptRes.statusCode === 200, 'Department Head clearance updated to CLEARED');

    // 28. Finalization SUCCEEDS now that all clearances are CLEARED/WAIVED
    const finalizeRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/fnf/finalize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      exit_request_id: activeExitId,
      salary_divisor: 30,
      payable_days: 10,
      encashed_leave_days: 14,
      gratuity_amount: 50000,
      bonus_or_incentive: 10000,
      notice_recovery: 5000,
      other_deductions: 2000,
    });
    const finalData = finalizeRes.json();
    assert(finalizeRes.statusCode === 200, 'Finalization succeeds when all clearances are CLEARED or WAIVED (returns 200)');
    assert(finalData?.success === true, 'Finalization response confirms success');
    assert(finalData?.data?.relieving_document_id !== undefined, 'Relieving document ID returned');
    assert(finalData?.data?.experience_document_id !== undefined, 'Experience certificate document ID returned');
    assert(finalData?.data?.settlement_document_id !== undefined, 'Settlement statement document ID returned');

    // 29. Database verification of atomic finalization
    const reqFinal = await pool.query('SELECT status, completed_at FROM public.exit_requests WHERE id = $1', [activeExitId]);
    assert(reqFinal.rows[0].status === 'COMPLETED', 'exit_requests status transitioned to COMPLETED');
    assert(reqFinal.rows[0].completed_at !== null, 'exit_requests completed_at timestamp populated');

    const fnfFinal = await pool.query('SELECT status, net_payable_amount FROM public.fnf_settlements WHERE exit_request_id = $1', [activeExitId]);
    assert(fnfFinal.rows[0].status === 'FINALIZED', 'fnf_settlements status set to FINALIZED');
    assert(Math.abs(fnfFinal.rows[0].net_payable_amount - 97333.33) < 0.1, 'fnf_settlements net_payable_amount committed accurately');

    // 30. employees.status transitioned to INACTIVE
    const empFinal = await pool.query('SELECT status FROM public.employees WHERE employee_id = $1', [testEmpId]);
    assert(empFinal.rows[0].status === 'INACTIVE', 'employees.status atomically transitioned to INACTIVE');

    // 31. users.status transitioned to INACTIVE
    const userFinal = await pool.query('SELECT status FROM public.users WHERE id = $1', [testUserId]);
    assert(userFinal.rows[0].status === 'INACTIVE', 'users.status atomically transitioned to INACTIVE');

    // 32. Future leaves cancelled
    const futureLeaveCheck = await pool.query(
      `SELECT status FROM public.leave_requests WHERE employee_id = $1 AND start_date > '2026-10-15'`,
      [testEmpId]
    );
    assert(futureLeaveCheck.rows[0].status === 'Cancelled', 'Future leaves after relieving date automatically cancelled');

    // 33. Documents registered in public.documents
    const docsRes = await pool.query(
      `SELECT document_type, file_name, storage_key FROM public.documents WHERE employee_id = $1`,
      [testEmpId]
    );
    const docTypes = docsRes.rows.map((d) => d.document_type);
    assert(docTypes.includes('Relieving Letter'), "public.documents includes 'Relieving Letter'");
    assert(docTypes.includes('Experience Certificate'), "public.documents includes 'Experience Certificate'");
    assert(docTypes.includes('FnF Statement'), "public.documents includes 'FnF Statement'");

    // 34. Physical files exist in private storage
    for (const d of docsRes.rows) {
      createdStorageKeys.push(d.storage_key);
      const fileBuf = await storageService.getFile(d.storage_key);
      assert(Buffer.isBuffer(fileBuf) && fileBuf.length > 0, `Physical file readable from private storage: ${d.document_type}`);
    }

    // -------------------------------------------------------------------------
    // 9. Post-Deactivation Security & IDOR
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Security, Deactivation & IDOR ---');

    // 35. Deactivated user cannot request new OTP
    const otpAttempt = await otpService.requestOtp('exit_test_emp1@gaintpro.com');
    // Generic response returned, but verify NO OTP record was created in database
    const otpRecords = await pool.query('SELECT id FROM public.otp_verifications WHERE user_id = $1', [testUserId]);
    assert(otpRecords.rows.length === 0, 'No active OTP records exist for deactivated user in otp_verifications');

    // 35b. Old JWT cannot access general employee APIs after deactivation (returns 403)
    const resProfile = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resProfile.statusCode === 403, 'Old JWT of deactivated employee cannot access /api/employee/profile (403)');

    const resAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resAtt.statusCode === 403, 'Old JWT of deactivated employee cannot access /api/employee/attendance (403)');

    const resLeaves = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/leaves',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resLeaves.statusCode === 403, 'Old JWT of deactivated employee cannot access /api/employee/leaves (403)');

    const resPayslips = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resPayslips.statusCode === 403, 'Old JWT of deactivated employee cannot access /api/employee/payslips (403)');

    const resPf = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/pf',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resPf.statusCode === 403, 'Old JWT of deactivated employee cannot access /api/employee/pf (403)');

    // 36. Employee can download their own Relieving Letter
    const dlRelieving = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/relieving-letter',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(dlRelieving.statusCode === 200, 'Exited employee can download their own Relieving Letter');
    assert(dlRelieving.headers['content-type'] === 'application/pdf', 'Relieving Letter returned as application/pdf');

    // 37. Employee can download their own Experience Certificate
    const dlExp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/experience-certificate',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(dlExp.statusCode === 200, 'Exited employee can download their own Experience Certificate');

    // 38. Employee can download their own F&F Statement
    const dlFnf = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/fnf-statement',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(dlFnf.statusCode === 200, 'Exited employee can download their own F&F Statement');

    // 39. Cross-Employee IDOR: Employee 2 cannot download Employee 1's Relieving Letter
    const idorRelieving = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/relieving-letter',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken2}` },
    });
    assert(idorRelieving.statusCode === 404, 'Employee 2 attempting to access Employee 1 exit document returns 404 Not Found');

    // 40. Admin can inspect exit documents by exit request ID
    const adminDlRelieving = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/${activeExitId}/relieving-letter`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminDlRelieving.statusCode === 200, 'Admin can download employee relieving letter by request ID');

    // -------------------------------------------------------------------------
    // 10. Idempotency & Repeat Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Idempotency & Repeat Protection ---');

    // 41. Repeated finalization on already COMPLETED exit request returns 400
    const repeatFinalize = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/fnf/finalize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      exit_request_id: activeExitId,
    });
    assert(repeatFinalize.statusCode === 400, 'Repeated finalization on already COMPLETED exit request returns 400');
    assert(
      repeatFinalize.json()?.message?.includes("must be in 'APPROVED' status"),
      'Rejects repeat finalization with state validation error'
    );

    // 42. Inactive employee cannot submit a new resignation
    const inactiveApply = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/apply',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, {
      requested_relieving_date: '2026-11-01',
      reason: 'Attempting to re-apply after deactivation',
    });
    assert(inactiveApply.statusCode === 403, 'Inactive employee cannot submit a new resignation request (returns 403)');

    // -------------------------------------------------------------------------
    // 11. Historical Data Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Historical Data Integrity ---');

    // 43. Historical payroll record remains 100% intact
    const payrollHist = await pool.query(
      `SELECT month, year, net_salary, status FROM public.payroll_records WHERE employee_id = $1`,
      [testEmpId]
    );
    assert(payrollHist.rows.length === 1, 'Historical payroll record is preserved');
    assert(payrollHist.rows[0].net_salary == 68000, 'Historical payroll financial numbers are unchanged');

    // 44. Historical attendance records remain 100% intact
    const attHist = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.attendance WHERE employee_id = $1`,
      [testEmpId]
    );
    assert(attHist.rows[0].count === attDates.length, 'All historical attendance records preserved intact');

    // 45. Historical approved leaves prior to relieving date are preserved
    const pastLeaveCheck = await pool.query(
      `SELECT status FROM public.leave_requests WHERE employee_id = $1 AND start_date = '2026-05-10'`,
      [testEmpId]
    );
    assert(pastLeaveCheck.rows[0].status === 'Approved', 'Historical approved leave remains in Approved status');

    // -------------------------------------------------------------------------
    // 12. Audit Trail Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Audit Trail Verification ---');

    // 46. Verify audit logs were captured
    const auditRes = await pool.query(
      `SELECT action FROM public.audit_logs WHERE metadata->>'employee_id' = $1 OR entity_id = $1`,
      [testEmpId]
    );
    const actions = auditRes.rows.map((a) => a.action);
    assert(actions.includes('EXIT_REQUEST_SUBMITTED'), "Audit log records 'EXIT_REQUEST_SUBMITTED'");
    assert(actions.includes('EXIT_REQUEST_REVIEWED'), "Audit log records 'EXIT_REQUEST_REVIEWED'");
    assert(actions.includes('EMPLOYEE_OFFBOARDING_FINALIZED'), "Audit log records 'EMPLOYEE_OFFBOARDING_FINALIZED'");

    console.log('\n================================================================');
    console.log(`PHASE 20 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('Fatal error during Phase 20 test suite execution:', err);
    failed++;
  } finally {
    // Clean up physical test storage files
    for (const key of createdStorageKeys) {
      try {
        await storageService.deleteFile(key);
      } catch {
        // Safe catch on cleanup
      }
    }

    // Clean up database test fixtures
    try {
      await pool.query('DELETE FROM public.exit_requests WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.leave_requests WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.attendance WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.payroll_records WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.documents WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [testEmpId, testEmpId2]);
      await pool.query('DELETE FROM public.users WHERE email IN ($1, $2, $3)', [
        'exit_test_emp1@gaintpro.com',
        'exit_test_emp2@gaintpro.com',
        'exit_test_admin@gaintpro.com',
      ]);
    } catch {
      // Safe catch
    }

    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTestSuite();
