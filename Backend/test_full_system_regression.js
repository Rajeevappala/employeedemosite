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

async function runRegression() {
  console.log('========================================================');
  console.log('       FULL SYSTEM REGRESSION TEST SUITE');
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
    // 1. Setup Auth tokens
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

    const crossEmpToken = generateToken({
      userId: '00000000-0000-0000-0000-000000000099',
      email: 'other@test.com',
      role: 'EMPLOYEE',
      employeeId: 'GP9999X',
    });

    console.log('--- 1. AUTHENTICATION & CORE SECURITY ---');
    // Health check
    const resHealth = await makeRequest({ hostname: 'localhost', port: PORT, path: '/api/health', method: 'GET' });
    assert(resHealth.statusCode === 200 && resHealth.json()?.success === true, 'Health check returns 200');

    // /api/auth/me
    const resMeEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resMeEmp.statusCode === 200 && (resMeEmp.json()?.user?.email === empUser.email || resMeEmp.json()?.data?.user?.email === empUser.email), 'Employee /api/auth/me returns 200');

    const resMeAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resMeAdmin.statusCode === 200 && (resMeAdmin.json()?.user?.email === adminUser.email || resMeAdmin.json()?.data?.user?.email === adminUser.email), 'Admin /api/auth/me returns 200');

    console.log('\n--- 2. EMPLOYEE PORTAL REGRESSION ---');
    // Profile
    const resProfile = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resProfile.statusCode === 200 && resProfile.json()?.data?.employee_id === 'GP0001N', 'Employee Profile returns 200');

    // Documents
    const resDocs = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resDocs.statusCode === 200 && Array.isArray(resDocs.json()?.data), 'Employee Documents returns 200');

    // PF Details
    const resPF = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/pf',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resPF.statusCode === 200 && resPF.json()?.success === true, 'Employee PF Details returns 200');

    // Attendance
    const resAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/attendance?month=2026-09',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resAtt.statusCode === 200 && resAtt.json()?.success === true, 'Employee Attendance returns 200');

    // Leaves
    const resLeaves = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/leaves',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resLeaves.statusCode === 200 && resLeaves.json()?.success === true, 'Employee Leaves returns 200');

    console.log('\n--- 3. EMPLOYEE PAYSLIPS (PHASE 14) ---');
    // Payslips list
    const resPayslips = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resPayslips.statusCode === 200 && resPayslips.json()?.success === true, 'Employee Payslips returns 200');
    const payslipItems = resPayslips.json()?.data?.items || [];
    assert(payslipItems.length > 0, `Payslips list contains active items (found ${payslipItems.length})`);

    const payslipSept2026 = payslipItems.find((s) => s.month === 9 && s.year === 2026);
    assert(payslipSept2026 != null, 'Found finalized payslip for September 2026');
    assert(payslipSept2026?.payroll?.working_days === 26, 'Verified working days: 26');
    assert(parseFloat(payslipSept2026?.payroll?.net_salary) === 37500, 'Verified net salary: ₹37,500.00');

    // Payslip View
    const resViewSlip = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${payslipSept2026.id}/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resViewSlip.statusCode === 200 && resViewSlip.headers['content-type'] === 'application/pdf', 'Payslip View returns 200 application/pdf');

    // Payslip Download
    const resDlSlip = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${payslipSept2026.id}/download`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resDlSlip.statusCode === 200 && resDlSlip.headers['content-type'] === 'application/pdf', 'Payslip Download returns 200 application/pdf');

    // Cross-Employee Isolation
    const resCross = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${payslipSept2026.id}/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${crossEmpToken}` },
    });
    assert(resCross.statusCode === 404, 'Cross-employee payslip view returns 404 (not disclosed)');

    console.log('\n--- 4. ADMIN PORTAL REGRESSION ---');
    // Admin Employees
    const resAdminEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminEmp.statusCode === 200 && Array.isArray(resAdminEmp.json()?.data?.employees || resAdminEmp.json()?.data), 'Admin Employees returns 200');

    // Admin Documents
    const resAdminDocs = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminDocs.statusCode === 200 && resAdminDocs.json()?.success === true, 'Admin Documents returns 200');

    // Admin Attendance
    const resAdminAtt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=2026-09-15',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminAtt.statusCode === 200 && resAdminAtt.json()?.success === true, 'Admin Attendance returns 200');

    // Admin Leaves
    const resAdminLeaves = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminLeaves.statusCode === 200 && resAdminLeaves.json()?.success === true, 'Admin Leaves returns 200');

    // Admin PF
    const resAdminPF = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/pf',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminPF.statusCode === 200 && resAdminPF.json()?.success === true, 'Admin PF returns 200');

    // Admin Payroll records
    const resAdminPayroll = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll?year=2026&month=9',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminPayroll.statusCode === 200 && resAdminPayroll.json()?.success === true, 'Admin Payroll records returns 200');

    // Admin Payroll history
    const resAdminHistory = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/history',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminHistory.statusCode === 200 && resAdminHistory.json()?.success === true, 'Admin Payroll history returns 200');

    // Admin Attendance Summary
    const resAdminAttSumm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/attendance-summary?year=2026&month=9',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminAttSumm.statusCode === 200 && resAdminAttSumm.json()?.success === true, 'Admin Attendance Summary returns 200');

    // Admin Payslip Generation Idempotency Check
    const resGeneratePayslip = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/GP0001N/2026/9/generate-payslip',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {}
    );
    assert(
      resGeneratePayslip.statusCode === 200 && resGeneratePayslip.json()?.success === true,
      'Admin Payslip generation endpoint is intact and returns 200'
    );

    // Admin Dashboard (Phase 15)
    const resAdminDash = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=9&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminDash.statusCode === 200 && resAdminDash.json()?.success === true, 'Admin Dashboard returns 200');
    assert(resAdminDash.json()?.data?.employees?.total != null, 'Admin Dashboard contains employee summary metrics');
    assert(resAdminDash.json()?.data?.attendance?.total_workforce != null, 'Admin Dashboard contains attendance metrics');
    assert(resAdminDash.json()?.data?.payroll?.gross_salary != null, 'Admin Dashboard contains payroll financial breakdown');

    console.log('\n--- 5. RBAC & SECURITY ENFORCEMENT ---');
    // Employee accessing Admin Dashboard -> 403
    const resEmpAdminDash = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAdminDash.statusCode === 403, 'Employee token accessing Admin Dashboard returns 403');

    // Employee accessing Admin Payroll -> 403
    const resEmpAdminPayroll = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAdminPayroll.statusCode === 403, 'Employee token accessing Admin Payroll returns 403');

    // Employee accessing Admin Documents -> 403
    const resEmpAdminDocs = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAdminDocs.statusCode === 403, 'Employee token accessing Admin Documents returns 403');

    // Direct access to private storage -> 404
    const resDirectStorage = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/storage/private/documents/GP0001N/2026/10/28dcffc0-3c36-4374-8641-39351b8eef1d.pdf',
      method: 'GET',
    });
    assert(resDirectStorage.statusCode === 404, 'Direct HTTP access to private storage directory is blocked (404)');

    // ========================================================
    // 16. PHASE 16 — EMPLOYEE DASHBOARD
    // ========================================================
    console.log('\n--- 16. Phase 16 — Employee Dashboard Integration ---');

    // 16.1 Unauthenticated Employee Dashboard -> 401
    const resUnauthEmpDash = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
    });
    assert(resUnauthEmpDash.statusCode === 401, 'Unauthenticated Employee Dashboard access returns 401');

    // 16.2 Admin token accessing Employee Dashboard -> 403
    const resAdminEmpDash = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminEmpDash.statusCode === 403, 'Admin token accessing Employee Dashboard returns 403');

    // 16.3 Authenticated Employee Dashboard -> 200
    const resEmpDash = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpDash.statusCode === 200, 'Employee Dashboard returns 200 for authenticated employee');
    const empDashData = resEmpDash.json()?.data;
    assert(empDashData?.profile?.employee_id === empUser.employee_id, 'Employee Dashboard returns authenticated employee profile');
    assert(typeof empDashData?.counts?.document_count === 'number', 'Employee Dashboard returns document count');
    assert(empDashData?.today_attendance !== undefined, 'Employee Dashboard returns today_attendance');
    assert(empDashData?.attendance_summary !== undefined, 'Employee Dashboard returns monthly attendance summary');
    assert(Array.isArray(empDashData?.recent_attendance), 'Employee Dashboard returns recent attendance logs array');
    assert(empDashData?.leave_summary !== undefined, 'Employee Dashboard returns leave summary');
    assert(Array.isArray(empDashData?.recent_leaves), 'Employee Dashboard returns recent leaves array');
    assert(Array.isArray(empDashData?.recent_documents), 'Employee Dashboard returns recent documents array');

    // 16.4 Verify zero data leak
    const empDashStr = JSON.stringify(resEmpDash.json());
    assert(
      !empDashStr.includes('storage_key') && !empDashStr.includes('password_hash'),
      'Employee Dashboard does not leak storage_key or password_hash'
    );

    // ========================================================
    // 17. PHASE 17 — NOTIFICATIONS & ANNOUNCEMENTS
    // ========================================================
    console.log('\n--- 17. Phase 17 — Notifications & Announcements ---');

    // 17.1 Admin Announcements List
    const resAdminAnnList = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/announcements',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminAnnList.statusCode === 200, 'Admin can list announcements (200)');
    const adminAnnData = resAdminAnnList.json()?.data;
    assert(Array.isArray(adminAnnData?.announcements), 'Admin announcements list contains announcements array');
    assert(adminAnnData?.summary !== undefined, 'Admin announcements list contains summary metrics');
    assert(adminAnnData?.pagination !== undefined, 'Admin announcements list contains pagination metadata');

    // 17.2 Admin Announcements Creation
    const resCreateAnn = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/announcements',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        title: 'Regression Test Notice',
        content: 'This is a temporary regression announcement for testing lifecycle.',
        priority: 'High',
        target_type: 'ALL',
        status: 'DRAFT',
      }
    );
    assert(resCreateAnn.statusCode === 201, 'Admin can create announcement (201)');
    const createdAnn = resCreateAnn.json()?.data;
    const testAnnId = createdAnn?.id;
    assert(Boolean(testAnnId), 'Created announcement returns valid ID');

    // 17.3 Admin Announcements Get by ID
    const resGetAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/announcements/${testAnnId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resGetAnn.statusCode === 200, 'Admin can fetch announcement by ID (200)');
    assert(resGetAnn.json()?.data?.title === 'Regression Test Notice', 'Fetched announcement matches created title');

    // 17.4 Admin Announcements Update
    const resUpdateAnn = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/announcements/${testAnnId}`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        title: 'Regression Test Notice (Updated)',
        content: 'Updated content for regression testing.',
        priority: 'Urgent',
        target_type: 'ALL',
      }
    );
    assert(resUpdateAnn.statusCode === 200, 'Admin can update announcement (200)');
    assert(resUpdateAnn.json()?.data?.priority === 'Urgent', 'Updated announcement has updated priority');

    // 17.5 Admin Announcements Publish
    const resPublishAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/announcements/${testAnnId}/publish`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resPublishAnn.statusCode === 200, 'Admin can publish announcement (200)');
    assert(resPublishAnn.json()?.data?.status === 'PUBLISHED', 'Published announcement has status=PUBLISHED');

    // 17.6 Admin Announcements Archive
    const resArchiveAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/announcements/${testAnnId}/archive`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resArchiveAnn.statusCode === 200, 'Admin can archive announcement (200)');
    assert(resArchiveAnn.json()?.data?.status === 'ARCHIVED', 'Archived announcement has status=ARCHIVED');

    // 17.7 Admin Announcements Delete
    const resDeleteAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/announcements/${testAnnId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resDeleteAnn.statusCode === 200, 'Admin can delete announcement (200)');

    // 17.8 Employee RBAC: Employee cannot access Admin Announcements
    const resEmpAccessAdminAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/announcements',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAccessAdminAnn.statusCode === 403, 'Employee access to Admin Announcements returns 403 Forbidden');

    // 17.9 Admin RBAC: Admin cannot access Employee Announcements
    const resAdminAccessEmpAnn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/announcements',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdminAccessEmpAnn.statusCode === 403, 'Admin access to Employee Announcements returns 403 Forbidden');

    // 17.10 Employee Announcements List
    const resEmpAnnList = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/announcements',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpAnnList.statusCode === 200, 'Employee can list visible announcements (200)');
    const empAnnData = resEmpAnnList.json()?.data;
    assert(Array.isArray(empAnnData?.announcements), 'Employee announcements contains array');
    assert(typeof empAnnData?.unread_count === 'number', 'Employee announcements response includes unread_count');

    // 17.11 Employee Announcements Unread Count endpoint
    const resEmpUnreadCount = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/announcements/unread-count',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpUnreadCount.statusCode === 200, 'Employee can get unread count via /unread-count (200)');
    assert(typeof resEmpUnreadCount.json()?.unread_count === 'number', 'Unread count is a numeric value');

    // 17.12 Employee Targeting Security: Employee in Engineering cannot see Marketing announcements
    const mktAnnRes = await pool.query(
      `INSERT INTO public.announcements (
         title, content, priority, target_type, target_department, status, publish_at, created_by
       ) VALUES (
         'Marketing Only Campaign', 'Campaign strategy notice for marketing.', 'Normal', 'DEPARTMENT', 'Marketing', 'PUBLISHED', NOW(), $1
       ) RETURNING id`,
      [adminUser.id]
    );
    const mktAnnId = mktAnnRes.rows[0].id;

    const resEmpListAfterMkt = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/announcements',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const foundMktInList = resEmpListAfterMkt.json()?.data?.announcements?.some((a) => a.id === mktAnnId);
    assert(!foundMktInList, 'Employee in Engineering does NOT see Marketing-targeted announcement');

    // 17.13 Employee Detail Security: Probing unauthorized announcement returns 404
    const resEmpGetMktDetail = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/announcements/${mktAnnId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmpGetMktDetail.statusCode === 404, 'Employee probing unauthorized department announcement returns 404 (not 403)');

    // Clean up test marketing announcement
    await pool.query(`DELETE FROM public.announcements WHERE id = $1`, [mktAnnId]);

    // 17.14 Employee Announcements Mark Read & Idempotency
    if (empAnnData?.announcements?.length > 0) {
      const targetAnn = empAnnData.announcements[0];
      const resMarkRead = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/announcements/${targetAnn.id}/read`,
        method: 'POST',
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(resMarkRead.statusCode === 200, 'Employee can mark announcement as read (200)');
      assert(resMarkRead.json()?.is_read === true, 'Response confirms is_read=true');

      // Idempotent call
      const resMarkReadAgain = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/announcements/${targetAnn.id}/read`,
        method: 'POST',
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(resMarkReadAgain.statusCode === 200, 'Mark as read is idempotent (second call returns 200)');
    }

    // 17.15 Employee Dashboard Integration with Phase 17
    assert(
      Array.isArray(empDashData?.latest_announcements),
      'Employee Dashboard includes latest_announcements array'
    );
    assert(
      typeof empDashData?.unread_announcements_count === 'number',
      'Employee Dashboard includes unread_announcements_count'
    );

    console.log(`\n========================================================`);
    console.log(`REGRESSION SUMMARY: ${passed} passed, ${failed} failed`);
    console.log(`========================================================`);
  } catch (err) {
    console.error('Regression error:', err);
    failed++;
  } finally {
    await pool.end();
  }
}

runRegression();
