/**
 * Test Suite: Admin Settings – Employee Configuration (Phase 5)
 * 
 * Verifies all 42 required specifications:
 * 1. Route /admin/settings/employees in AppRoutes.jsx
 * 2. Settings card links correctly
 * 3. Page files exist
 * 4. Unauthenticated requests return 401
 * 5. Employee requests return 403
 * 6. Admin access works (200)
 * 7. Super Admin access works (200)
 * 8. Existing employee master values discovered correctly
 * 9. Departments can be listed
 * 10. Departments can be created
 * 11. Duplicate department rejected with 409
 * 12. Department can be updated
 * 13. Department can be deactivated
 * 14. Designations can be listed
 * 15. Designations can be created
 * 16. Duplicate designation rejected with 409
 * 17. Designation can be updated
 * 18. Designation can be deactivated
 * 19. Employment types can be listed
 * 20. Employment types can be created
 * 21. Duplicate employment type rejected with 409
 * 22. Employment type can be updated
 * 23. Employment type can be deactivated
 * 24. Work locations can be listed
 * 25. Work locations can be created
 * 26. Duplicate location rejected with 409
 * 27. Location can be updated
 * 28. Location can be deactivated
 * 29. Invalid input rejected (400)
 * 30. Invalid UUID rejected (400)
 * 31. Nonexistent record returns 404
 * 32. Referenced master data cannot be dangerously deleted (409 Conflict)
 * 33. Employee count / usage information is accurate
 * 34. Existing employee records remain unchanged
 * 35. Existing leave balances unchanged
 * 36. Existing attendance unchanged
 * 37. Existing payroll unchanged
 * 38. Existing holiday functionality unchanged
 * 39. Existing employee creation works
 * 40. Existing employee edit works
 * 41. Audit logs generated
 * 42. No sensitive information logged
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json: () => json,
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      if (typeof postData === 'string') {
        req.write(postData);
      } else {
        req.write(JSON.stringify(postData));
      }
    }
    req.end();
  });
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function runTests() {
  console.log('========================================================');
  console.log(' EMPLOYEE CONFIGURATION MODULE - 42 REQUIREMENTS        ');
  console.log('========================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Route in AppRoutes.jsx
    // -------------------------------------------------------------------------
    console.log('--- 1. ROUTING & FILE SYSTEM INTEGRITY ---');
    const appRoutesPath = path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');
    assert(
      appRoutesContent.includes('settings/employees') &&
      appRoutesContent.includes('AdminEmployeeConfiguration'),
      '1. Route /admin/settings/employees is registered in AppRoutes.jsx'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Settings landing page card link
    // -------------------------------------------------------------------------
    const settingsLandingPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Settings.jsx');
    const settingsLandingContent = fs.readFileSync(settingsLandingPath, 'utf8');
    assert(
      settingsLandingContent.includes("link: '/admin/settings/employees'") &&
      settingsLandingContent.includes("id: 'employee-config'"),
      "2. Settings landing page card links to '/admin/settings/employees'"
    );

    // -------------------------------------------------------------------------
    // TEST 3: Page files exist
    // -------------------------------------------------------------------------
    const jsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/EmployeeConfiguration/EmployeeConfiguration.jsx');
    const cssPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/EmployeeConfiguration/EmployeeConfiguration.css');
    assert(
      fs.existsSync(jsxPath) && fs.existsSync(cssPath),
      '3. EmployeeConfiguration.jsx and EmployeeConfiguration.css files exist on filesystem'
    );

    // --- SETUP AUTH TOKENS ---
    const adminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1");
    const superAdminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role = 'SUPER_ADMIN' LIMIT 1");
    const empUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role = 'EMPLOYEE' LIMIT 1");

    if (adminUserRes.rows.length === 0 || empUserRes.rows.length === 0) {
      throw new Error('Required test users (ADMIN, EMPLOYEE) missing in database.');
    }

    const adminUser = adminUserRes.rows[0];
    const superAdminUser = superAdminUserRes.rows[0] || adminUser;
    const empUser = empUserRes.rows[0];

    const adminToken = generateToken({ userId: adminUser.id, role: 'ADMIN', email: adminUser.email });
    const superAdminToken = generateToken({ userId: superAdminUser.id, role: 'SUPER_ADMIN', email: superAdminUser.email });
    const empToken = generateToken({ userId: empUser.id, role: 'EMPLOYEE', email: empUser.email });

    // Capture initial baseline snapshots
    const initialEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const initialEmpCount = parseInt(initialEmpCountRes.rows[0].count, 10);

    const initialAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const initialAttendanceCount = parseInt(initialAttendanceCountRes.rows[0].count, 10);

    const initialPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const initialPayrollCount = parseInt(initialPayrollCountRes.rows[0].count, 10);

    const initialLeaveBalancesRes = await pool.query('SELECT employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance FROM public.leave_balances ORDER BY employee_id');
    const initialBalances = initialLeaveBalancesRes.rows;

    // -------------------------------------------------------------------------
    // TEST 4: Unauthenticated GET returns 401
    // -------------------------------------------------------------------------
    console.log('\n--- 2. RBAC & PERMISSION ENFORCEMENT ---');
    const unauthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
    });
    assert(
      unauthRes.statusCode === 401,
      '4. Unauthenticated request to /api/admin/settings/employees returns HTTP 401'
    );

    // -------------------------------------------------------------------------
    // TEST 5: Employee GET returns 403
    // -------------------------------------------------------------------------
    const empRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      empRes.statusCode === 403,
      '5. Employee access returns HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Admin access works (200)
    // -------------------------------------------------------------------------
    const adminRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminData = adminRes.json();
    assert(
      adminRes.statusCode === 200 && adminData?.success === true,
      '6. Admin GET /api/admin/settings/employees succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Super Admin access works (200)
    // -------------------------------------------------------------------------
    const superAdminRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(
      superAdminRes.statusCode === 200 && superAdminRes.json()?.success === true,
      '7. Super Admin GET /api/admin/settings/employees succeeds with HTTP 200'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Existing employee master values discovered correctly
    // -------------------------------------------------------------------------
    const masterDepts = adminData?.data?.departments || [];
    const masterDesigs = adminData?.data?.designations || [];
    const masterEmpTypes = adminData?.data?.employmentTypes || [];
    const masterLocs = adminData?.data?.locations || [];

    const hasEng = masterDepts.some((d) => d.name === 'Engineering');
    const hasLead = masterDesigs.some((d) => d.name === 'Senior Tech Lead');
    const hasFullTime = masterEmpTypes.some((et) => et.name === 'Full Time');
    const hasHyd = masterLocs.some((l) => l.name === 'Hyderabad' || l.name === 'Hyderabad HQ');

    assert(
      hasEng && hasLead && hasFullTime && hasHyd,
      '8. Existing employee master values discovered correctly and seeded into master collections'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Departments can be listed
    // -------------------------------------------------------------------------
    console.log('\n--- 3. DEPARTMENTS CRUD & SAFETY ---');
    const listDeptsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/departments',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      listDeptsRes.statusCode === 200 && Array.isArray(listDeptsRes.json()?.data),
      '9. Departments list endpoint returns HTTP 200 with data array'
    );

    // -------------------------------------------------------------------------
    // TEST 10: Department can be created
    // -------------------------------------------------------------------------
    const testDeptName = 'Data Science & AI';
    await pool.query('DELETE FROM public.organization_departments WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [testDeptName]);

    const createDeptRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/departments',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: testDeptName, description: 'AI research and advanced analytics' }
    );
    const createdDept = createDeptRes.json()?.data;
    assert(
      createDeptRes.statusCode === 201 && createdDept?.name === testDeptName,
      '10. Department can be created successfully (201 Created)'
    );

    // -------------------------------------------------------------------------
    // TEST 11: Duplicate department rejected with 409
    // -------------------------------------------------------------------------
    const dupDeptRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/departments',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: '  data science & ai  ', description: 'Duplicate casing check' }
    );
    assert(
      dupDeptRes.statusCode === 409,
      '11. Duplicate department (case-insensitive & trimmed) rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 12: Department can be updated
    // -------------------------------------------------------------------------
    const updateDeptRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/departments/${createdDept.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: 'Applied AI & Data Science', description: 'Updated analytics division' }
    );
    assert(
      updateDeptRes.statusCode === 200 && updateDeptRes.json()?.data?.name === 'Applied AI & Data Science',
      '12. Department name and description updated successfully (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 13: Department can be deactivated
    // -------------------------------------------------------------------------
    const deactDeptRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/departments/${createdDept.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { is_active: false }
    );
    assert(
      deactDeptRes.statusCode === 200 && deactDeptRes.json()?.data?.is_active === false,
      '13. Department deactivated successfully (is_active: false)'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Designations can be listed
    // -------------------------------------------------------------------------
    console.log('\n--- 4. DESIGNATIONS CRUD & SAFETY ---');
    const listDesigsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/designations',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      listDesigsRes.statusCode === 200 && Array.isArray(listDesigsRes.json()?.data),
      '14. Designations list endpoint returns HTTP 200 with data array'
    );

    // -------------------------------------------------------------------------
    // TEST 15: Designation can be created
    // -------------------------------------------------------------------------
    const testDesigName = 'DevOps Architect';
    await pool.query('DELETE FROM public.organization_designations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [testDesigName]);

    const createDesigRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/designations',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: testDesigName, description: 'Cloud infrastructure and CI/CD automation' }
    );
    const createdDesig = createDesigRes.json()?.data;
    assert(
      createDesigRes.statusCode === 201 && createdDesig?.name === testDesigName,
      '15. Designation can be created successfully (201 Created)'
    );

    // -------------------------------------------------------------------------
    // TEST 16: Duplicate designation rejected with 409
    // -------------------------------------------------------------------------
    const dupDesigRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/designations',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: '  devops architect  ' }
    );
    assert(
      dupDesigRes.statusCode === 409,
      '16. Duplicate designation (case-insensitive & trimmed) rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 17: Designation can be updated
    // -------------------------------------------------------------------------
    const updateDesigRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/designations/${createdDesig.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: 'Principal DevOps Architect' }
    );
    assert(
      updateDesigRes.statusCode === 200 && updateDesigRes.json()?.data?.name === 'Principal DevOps Architect',
      '17. Designation updated successfully (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 18: Designation can be deactivated
    // -------------------------------------------------------------------------
    const deactDesigRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/designations/${createdDesig.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { is_active: false }
    );
    assert(
      deactDesigRes.statusCode === 200 && deactDesigRes.json()?.data?.is_active === false,
      '18. Designation deactivated successfully (is_active: false)'
    );

    // -------------------------------------------------------------------------
    // TEST 19: Employment types can be listed
    // -------------------------------------------------------------------------
    console.log('\n--- 5. EMPLOYMENT TYPES CRUD & SAFETY ---');
    const listEmpTypesRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/employment-types',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      listEmpTypesRes.statusCode === 200 && Array.isArray(listEmpTypesRes.json()?.data),
      '19. Employment types list endpoint returns HTTP 200 with data array'
    );

    // -------------------------------------------------------------------------
    // TEST 20: Employment type can be created
    // -------------------------------------------------------------------------
    const testEmpTypeName = 'Seasonal Contract';
    await pool.query('DELETE FROM public.organization_employment_types WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [testEmpTypeName]);

    const createEmpTypeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/employment-types',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: testEmpTypeName, description: 'Short-term seasonal engagement' }
    );
    const createdEmpType = createEmpTypeRes.json()?.data;
    assert(
      createEmpTypeRes.statusCode === 201 && createdEmpType?.name === testEmpTypeName,
      '20. Employment type can be created successfully (201 Created)'
    );

    // -------------------------------------------------------------------------
    // TEST 21: Duplicate employment type rejected with 409
    // -------------------------------------------------------------------------
    const dupEmpTypeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/employment-types',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: '  seasonal contract  ' }
    );
    assert(
      dupEmpTypeRes.statusCode === 409,
      '21. Duplicate employment type rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 22: Employment type can be updated
    // -------------------------------------------------------------------------
    const updateEmpTypeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/employment-types/${createdEmpType.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: 'Temporary Seasonal Contract' }
    );
    assert(
      updateEmpTypeRes.statusCode === 200 && updateEmpTypeRes.json()?.data?.name === 'Temporary Seasonal Contract',
      '22. Employment type updated successfully (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 23: Employment type can be deactivated
    // -------------------------------------------------------------------------
    const deactEmpTypeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/employment-types/${createdEmpType.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { is_active: false }
    );
    assert(
      deactEmpTypeRes.statusCode === 200 && deactEmpTypeRes.json()?.data?.is_active === false,
      '23. Employment type deactivated successfully (is_active: false)'
    );

    // -------------------------------------------------------------------------
    // TEST 24: Work locations can be listed
    // -------------------------------------------------------------------------
    console.log('\n--- 6. WORK LOCATIONS CRUD & SAFETY ---');
    const listLocsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/locations',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      listLocsRes.statusCode === 200 && Array.isArray(listLocsRes.json()?.data),
      '24. Work locations list endpoint returns HTTP 200 with data array'
    );

    // -------------------------------------------------------------------------
    // TEST 25: Work location can be created
    // -------------------------------------------------------------------------
    const testLocName = 'Chennai Tech Hub';
    await pool.query('DELETE FROM public.organization_work_locations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [testLocName]);

    const createLocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/locations',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        name: testLocName,
        city: 'Chennai',
        state: 'Tamil Nadu',
        country: 'India',
        address: 'OMR Cyber City, Phase 2',
        description: 'New technical development center',
      }
    );
    const createdLoc = createLocRes.json()?.data;
    assert(
      createLocRes.statusCode === 201 && createdLoc?.name === testLocName,
      '25. Work location can be created successfully (201 Created)'
    );

    // -------------------------------------------------------------------------
    // TEST 26: Duplicate location rejected with 409
    // -------------------------------------------------------------------------
    const dupLocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/locations',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: '  chennai tech hub  ' }
    );
    assert(
      dupLocRes.statusCode === 409,
      '26. Duplicate work location rejected with HTTP 409 Conflict'
    );

    // -------------------------------------------------------------------------
    // TEST 27: Location can be updated
    // -------------------------------------------------------------------------
    const updateLocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/locations/${createdLoc.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: 'Chennai Tech Hub - OMR', city: 'Chennai' }
    );
    assert(
      updateLocRes.statusCode === 200 && updateLocRes.json()?.data?.name === 'Chennai Tech Hub - OMR',
      '27. Work location updated successfully (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 28: Location can be deactivated
    // -------------------------------------------------------------------------
    const deactLocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/locations/${createdLoc.id}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { is_active: false }
    );
    assert(
      deactLocRes.statusCode === 200 && deactLocRes.json()?.data?.is_active === false,
      '28. Work location deactivated successfully (is_active: false)'
    );

    // -------------------------------------------------------------------------
    // TEST 29: Invalid input rejected (400)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. VALIDATION, INTEGRITY & CONSTRAINTS ---');
    const emptyNameRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/settings/employees/departments',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { name: '   ' }
    );
    assert(
      emptyNameRes.statusCode === 400,
      '29. Whitespace/empty entity name rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 30: Invalid UUID rejected (400)
    // -------------------------------------------------------------------------
    const invalidUuidRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/departments/not-a-valid-uuid',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    });
    assert(
      invalidUuidRes.statusCode === 400,
      '30. Malformed UUID parameter rejected with HTTP 400 Bad Request'
    );

    // -------------------------------------------------------------------------
    // TEST 31: Nonexistent record returns 404
    // -------------------------------------------------------------------------
    const notFoundRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/departments/00000000-0000-0000-0000-000000000000',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, { name: 'Nonexistent Dept' });
    assert(
      notFoundRes.statusCode === 404,
      '31. Nonexistent record ID returns HTTP 404 Not Found'
    );

    // -------------------------------------------------------------------------
    // TEST 32: Referenced master data cannot be deleted (409 Conflict)
    // -------------------------------------------------------------------------
    // Find the master record for "Engineering" which is assigned to active employees
    const engRow = await pool.query("SELECT id FROM public.organization_departments WHERE name = 'Engineering' LIMIT 1");
    if (engRow.rows.length > 0) {
      const deleteEngRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/settings/employees/departments/${engRow.rows[0].id}`,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert(
        deleteEngRes.statusCode === 409 && deleteEngRes.json()?.message?.includes('assigned to'),
        '32. Actively referenced master department protected against deletion with HTTP 409 Conflict'
      );
    } else {
      assert(false, '32. Engineering department row expected in master table');
    }

    // -------------------------------------------------------------------------
    // TEST 33: Employee count / usage information is accurate
    // -------------------------------------------------------------------------
    const engCountRes = await pool.query("SELECT count(*)::int FROM public.employees WHERE LOWER(TRIM(department)) = 'engineering'");
    const expectedEngCount = engCountRes.rows[0].count;

    const getEngRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees/departments?search=Engineering',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const engApiRow = getEngRes.json()?.data?.find((d) => d.name === 'Engineering');
    assert(
      engApiRow && engApiRow.employee_count === expectedEngCount,
      `33. Usage count is dynamically aggregated and matches database (${engApiRow?.employee_count} === ${expectedEngCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 34: Existing employee records remain unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- 8. HISTORICAL INTEGRITY & REGRESSION SAFETY ---');
    const postEmpCountRes = await pool.query('SELECT count(*) FROM public.employees');
    const postEmpCount = parseInt(postEmpCountRes.rows[0].count, 10);
    assert(
      postEmpCount === initialEmpCount,
      `34. Existing employee records count completely unchanged (${postEmpCount} === ${initialEmpCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 35: Existing leave balances unchanged
    // -------------------------------------------------------------------------
    const postBalancesRes = await pool.query('SELECT employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance FROM public.leave_balances ORDER BY employee_id');
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
      '35. Existing employee leave balances are completely untouched and unchanged'
    );

    // -------------------------------------------------------------------------
    // TEST 36: Existing attendance unchanged
    // -------------------------------------------------------------------------
    const postAttendanceCountRes = await pool.query('SELECT count(*) FROM public.attendance');
    const postAttendanceCount = parseInt(postAttendanceCountRes.rows[0].count, 10);
    assert(
      postAttendanceCount === initialAttendanceCount,
      `36. Attendance table records count completely unchanged (${postAttendanceCount} === ${initialAttendanceCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 37: Existing payroll unchanged
    // -------------------------------------------------------------------------
    const postPayrollCountRes = await pool.query('SELECT count(*) FROM public.payroll_records');
    const postPayrollCount = parseInt(postPayrollCountRes.rows[0].count, 10);
    assert(
      postPayrollCount === initialPayrollCount,
      `37. Existing payroll records count unchanged (${postPayrollCount} === ${initialPayrollCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 38: Existing holiday functionality unchanged
    // -------------------------------------------------------------------------
    const holidayRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/holidays?year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      holidayRes.statusCode === 200 && Array.isArray(holidayRes.json()?.data),
      '38. Existing holiday calendar settings endpoint operates normally (200 OK)'
    );

    // -------------------------------------------------------------------------
    // TEST 39: Existing employee creation works
    // -------------------------------------------------------------------------
    const testOnboardEmpId = 'GP9988N';
    const testOnboardEmail = 'onboard.test.9988@gaintpro.com';

    // Clean up test employee if left over
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) = $1', [testOnboardEmail]);

    const onboardRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        employee_id: testOnboardEmpId,
        firstName: 'TestOnboard',
        lastName: 'Engineer',
        email: testOnboardEmail,
        department: 'IT',
        designation: 'Software Engineer',
        employmentType: 'Full Time',
        workLocation: 'Hyderabad',
        working_days_per_week: 5,
        dateOfBirth: '1995-05-15',
        phone: '9876543299',
      }
    );
    assert(
      onboardRes.statusCode === 201 && onboardRes.json()?.success === true,
      '39. Employee creation wizard works seamlessly with master data options (201 Created)'
    );

    // -------------------------------------------------------------------------
    // TEST 40: Existing employee edit works
    // -------------------------------------------------------------------------
    const editEmpRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/employees/${testOnboardEmpId}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        department: 'Non-IT',
        designation: 'Senior Tech Lead',
        workLocation: 'Bangalore',
      }
    );
    assert(
      editEmpRes.statusCode === 200 && editEmpRes.json()?.data?.department === 'Non-IT',
      '40. Employee edit operation successfully updates master data fields (200 OK)'
    );

    // Clean up test onboard employee
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [testOnboardEmpId]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) = $1', [testOnboardEmail]);

    // -------------------------------------------------------------------------
    // TEST 41: Audit logs generated
    // -------------------------------------------------------------------------
    console.log('\n--- 9. AUDIT LOGGING & SECURITY CHECKS ---');
    const auditRes = await pool.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs 
       WHERE action IN ('DEPARTMENT_CREATED', 'DESIGNATION_CREATED', 'EMPLOYMENT_TYPE_CREATED', 'WORK_LOCATION_CREATED')
       ORDER BY created_at DESC LIMIT 4`
    );
    assert(
      auditRes.rows.length >= 4,
      '41. Audit log events generated for master data mutations (DEPARTMENT_CREATED, etc.)'
    );

    // -------------------------------------------------------------------------
    // TEST 42: No sensitive info logged
    // -------------------------------------------------------------------------
    const recentLogsRes = await pool.query(
      `SELECT metadata FROM public.audit_logs 
       WHERE created_at >= NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 20`
    );
    let sensitiveFound = false;
    for (const row of recentLogsRes.rows) {
      const metaStr = JSON.stringify(row.metadata || {}).toLowerCase();
      if (
        metaStr.includes('password') ||
        metaStr.includes('jwt') ||
        metaStr.includes('bearer') ||
        metaStr.includes('secret') ||
        metaStr.includes('otp')
      ) {
        sensitiveFound = true;
        break;
      }
    }
    assert(
      !sensitiveFound,
      '42. Zero sensitive credentials, passwords, tokens, or hashes present in audit logs'
    );

    // Clean up created test master records
    await pool.query('DELETE FROM public.organization_departments WHERE id = $1', [createdDept.id]);
    await pool.query('DELETE FROM public.organization_designations WHERE id = $1', [createdDesig.id]);
    await pool.query('DELETE FROM public.organization_employment_types WHERE id = $1', [createdEmpType.id]);
    await pool.query('DELETE FROM public.organization_work_locations WHERE id = $1', [createdLoc.id]);

  } catch (error) {
    console.error('\n❌ FATAL TEST ERROR:', error);
    failedTests++;
  } finally {
    console.log('\n========================================================');
    console.log(`TOTAL TESTS: ${totalTests}`);
    console.log(`PASSED: ${passedTests}`);
    console.log(`FAILED: ${failedTests}`);
    console.log('========================================================\n');
    await pool.end();
    process.exit(failedTests === 0 ? 0 : 1);
  }
}

runTests();
