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
  console.log('  ORGANIZATION SETTINGS MODULE - 25 CORE REQUIREMENTS   ');
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
    // Pre-test Baseline Snapshots (to verify regression neutrality)
    // -------------------------------------------------------------------------
    const initialEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const initialAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const initialPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const initialLeaveCountRes = await pool.query('SELECT count(*) FROM public.leave_requests');

    const initialEmpCount = parseInt(initialEmpCountRes.rows[0].count, 10);
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
    // TEST 1: Organization settings route exists in AppRoutes.jsx
    // -------------------------------------------------------------------------
    console.log('\n--- 1. ROUTING & FILE SYSTEM INTEGRITY ---');
    const appRoutesPath = path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');
    assert(
      appRoutesContent.includes('<Route path="settings/organization" element={<AdminOrganizationSettings />} />'),
      '1. Organization settings route exists in AppRoutes.jsx (/admin/settings/organization)'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Organization settings page component and stylesheet load
    // -------------------------------------------------------------------------
    const orgSettingsJsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Organization/OrganizationSettings.jsx');
    const orgSettingsCssPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Organization/OrganizationSettings.css');
    assert(
      fs.existsSync(orgSettingsJsxPath) && fs.existsSync(orgSettingsCssPath),
      '2. Organization settings page files (OrganizationSettings.jsx & .css) exist and are present'
    );

    // -------------------------------------------------------------------------
    // TEST 3: Settings -> Organization navigation works (Settings landing card is clickable)
    // -------------------------------------------------------------------------
    const settingsLandingJsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Settings.jsx');
    const settingsLandingContent = fs.readFileSync(settingsLandingJsxPath, 'utf8');
    assert(
      settingsLandingContent.includes('/admin/settings/organization') &&
      settingsLandingContent.includes('to={section.link}'),
      '3. Settings landing page provides a direct clickable link to /admin/settings/organization'
    );

    // -------------------------------------------------------------------------
    // TEST 4: GET organization settings requires authentication
    // -------------------------------------------------------------------------
    console.log('\n--- 2. RBAC & SECURITY VERIFICATION ---');
    const unauthGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/organization',
      method: 'GET',
    });
    assert(
      unauthGetRes.statusCode === 401,
      `4. Unauthenticated GET receives 401 Unauthorized (got ${unauthGetRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Employee receives 403 Forbidden
    // -------------------------------------------------------------------------
    const empGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/organization',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empGetRes.statusCode === 403,
      `5. Employee receives 403 Forbidden on GET (got ${empGetRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Admin can GET settings
    // -------------------------------------------------------------------------
    const adminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/organization',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminGetRes.statusCode === 200,
      `6. Admin can GET organization settings (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin can GET settings
    // -------------------------------------------------------------------------
    const superAdminGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/organization',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(
      superAdminGetRes.statusCode === 200,
      `7. Super Admin can GET organization settings (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 8 & 9: Default organization name & country
    // -------------------------------------------------------------------------
    const initialData = adminGetRes.json()?.data || {};
    assert(
      initialData.organization_name === 'GaintPro Software Technologies',
      `8. Default organization name is "GaintPro Software Technologies" (got "${initialData.organization_name}")`
    );
    assert(
      initialData.country === 'India',
      `9. Default country is "India" (got "${initialData.country}")`
    );

    // -------------------------------------------------------------------------
    // TEST 10: PUT requires authentication
    // -------------------------------------------------------------------------
    const unauthPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      },
      { organization_name: 'Test Unauth' }
    );
    assert(
      unauthPutRes.statusCode === 401,
      `10. Unauthenticated PUT receives 401 Unauthorized (got ${unauthPutRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 11: Employee cannot update settings (403)
    // -------------------------------------------------------------------------
    const empPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${empToken}`,
        },
      },
      { organization_name: 'Employee Tamper Attempt' }
    );
    assert(
      empPutRes.statusCode === 403,
      `11. Employee receives 403 Forbidden on PUT (got ${empPutRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 12: Admin can update settings
    // -------------------------------------------------------------------------
    console.log('\n--- 3. DATA PERSISTENCE & MUTATION ---');
    const updatePayload1 = {
      organization_name: 'GaintPro Software Technologies',
      legal_name: 'GaintPro Software Technologies Private Limited',
      address_line_1: 'Plot 42, Hitech City Phase 2',
      address_line_2: 'Cyber Towers 5th Floor',
      city: 'Hyderabad',
      state: 'Telangana',
      postal_code: '500081',
      country: 'India',
      phone: '+91 9876543210',
      email: 'contact@gaintpro.com',
      website: 'https://gaintpro.com',
    };

    const adminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      updatePayload1
    );
    assert(
      adminPutRes.statusCode === 200,
      `12. Admin can update settings successfully (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Super Admin can update settings
    // -------------------------------------------------------------------------
    const superAdminPutRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
      },
      updatePayload1
    );
    assert(
      superAdminPutRes.statusCode === 200,
      `13. Super Admin can update settings successfully (status 200)`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Required organization name validation works
    // -------------------------------------------------------------------------
    console.log('\n--- 4. SERVER-SIDE VALIDATION RULES ---');
    const emptyNameRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...updatePayload1, organization_name: '   ' }
    );
    assert(
      emptyNameRes.statusCode === 400 &&
      emptyNameRes.json()?.message?.includes('Organization name is required'),
      `14. Server rejects empty/whitespace organization name with 400 (got ${emptyNameRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Email validation works
    // -------------------------------------------------------------------------
    const invalidEmailRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...updatePayload1, email: 'not-a-valid-email' }
    );
    assert(
      invalidEmailRes.statusCode === 400 &&
      invalidEmailRes.json()?.message?.toLowerCase().includes('email'),
      `15. Server rejects invalid email format with 400 (got ${invalidEmailRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 16: Website validation works
    // -------------------------------------------------------------------------
    const invalidWebsiteRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...updatePayload1, website: 'not a url' }
    );
    assert(
      invalidWebsiteRes.statusCode === 400 &&
      invalidWebsiteRes.json()?.message?.toLowerCase().includes('website'),
      `16. Server rejects invalid website URL format with 400 (got ${invalidWebsiteRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 17: Postal code validation works
    // -------------------------------------------------------------------------
    const invalidPostalRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      { ...updatePayload1, country: 'India', postal_code: '123' }
    );
    assert(
      invalidPostalRes.statusCode === 400 &&
      invalidPostalRes.json()?.message?.toLowerCase().includes('postal code'),
      `17. Server rejects invalid 3-digit Indian postal code with 400 (got ${invalidPostalRes.statusCode})`
    );

    // -------------------------------------------------------------------------
    // TEST 18: Data persists after update
    // -------------------------------------------------------------------------
    console.log('\n--- 5. PERSISTENCE, SINGLETON & AUDIT TRAIL ---');
    const verifyGetRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/organization',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const persistedData = verifyGetRes.json()?.data || {};
    assert(
      persistedData.legal_name === 'GaintPro Software Technologies Private Limited' &&
      persistedData.city === 'Hyderabad' &&
      persistedData.postal_code === '500081',
      `18. Data persists and matches updated values on subsequent GET`
    );

    // -------------------------------------------------------------------------
    // TEST 19: Repeated update does not create duplicate organization records
    // -------------------------------------------------------------------------
    for (let i = 0; i < 3; i++) {
      await makeRequest(
        {
          hostname: 'localhost',
          port: PORT,
          path: '/api/admin/settings/organization',
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { ...updatePayload1, legal_name: `GaintPro Test Iteration ${i}` }
      );
    }
    const orgCountRes = await pool.query('SELECT count(*) FROM public.organization_settings');
    const orgRowCount = parseInt(orgCountRes.rows[0].count, 10);
    assert(
      orgRowCount === 1,
      `19. Singleton constraint holds: total organization rows is exactly 1 (found ${orgRowCount})`
    );

    // Restore official data
    await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/organization',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
      updatePayload1
    );

    // -------------------------------------------------------------------------
    // TEST 20: Audit log is created
    // -------------------------------------------------------------------------
    const auditRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action = 'ORGANIZATION_SETTINGS_UPDATED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert(
      auditRes.rows.length > 0 &&
      auditRes.rows[0].entity_type === 'ORGANIZATION_SETTINGS' &&
      auditRes.rows[0].metadata?.fields_changed !== undefined,
      `20. Audit log entry recorded with action ORGANIZATION_SETTINGS_UPDATED and safe metadata`
    );

    // -------------------------------------------------------------------------
    // TEST 21: Existing employee data remains unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- 6. REGRESSION INTEGRITY CHECKS ---');
    const postEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const postEmpCount = parseInt(postEmpCountRes.rows[0].count, 10);
    assert(
      postEmpCount === initialEmpCount,
      `21. Existing employee data unchanged (before: ${initialEmpCount}, after: ${postEmpCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 22: Existing attendance data remains unchanged
    // -------------------------------------------------------------------------
    const postAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const postAttendanceCount = parseInt(postAttendanceCountRes.rows[0].count, 10);
    assert(
      postAttendanceCount === initialAttendanceCount,
      `22. Existing attendance data unchanged (before: ${initialAttendanceCount}, after: ${postAttendanceCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 23: Existing payroll data remains unchanged
    // -------------------------------------------------------------------------
    const postPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const postPayrollCount = parseInt(postPayrollCountRes.rows[0].count, 10);
    assert(
      postPayrollCount === initialPayrollCount,
      `23. Existing payroll data unchanged (before: ${initialPayrollCount}, after: ${postPayrollCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 24: Existing leave data remains unchanged
    // -------------------------------------------------------------------------
    const postLeaveCountRes = await pool.query('SELECT count(*) FROM public.leave_requests');
    const postLeaveCount = parseInt(postLeaveCountRes.rows[0].count, 10);
    assert(
      postLeaveCount === initialLeaveCount,
      `24. Existing leave data unchanged (before: ${initialLeaveCount}, after: ${postLeaveCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 25: Existing holiday functionality remains unchanged
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
      `25. Existing attendance & holiday query API responds normally (status 200)`
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
