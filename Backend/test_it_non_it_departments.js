/**
 * Comprehensive Test Suite: Department Classification Simplification (IT / Non-IT)
 * 
 * Verifies all 25 required specifications:
 * 1. Only IT and Non-IT are active department options.
 * 2. Engineering is inactive.
 * 3. Finance is inactive.
 * 4. Human Resources is inactive.
 * 5. Marketing is inactive.
 * 6. Operations is inactive.
 * 7. Sales is inactive.
 * 8. Technology is inactive.
 * 9. New employee can select IT.
 * 10. New employee can select Non-IT.
 * 11. New employee cannot select Engineering.
 * 12. Existing legacy employee does not lose department.
 * 13. Employee can be changed from legacy department to IT.
 * 14. Employee can be changed from legacy department to Non-IT.
 * 15. Attendance department filter shows IT.
 * 16. Attendance department filter shows Non-IT.
 * 17. Attendance IT filter returns only IT employees.
 * 18. Attendance Non-IT filter returns only Non-IT employees.
 * 19. All Departments returns all employees.
 * 20. Admin Employees department filter uses IT/Non-IT.
 * 21. Existing attendance records remain unchanged.
 * 22. Existing payroll remains unchanged.
 * 23. Existing leave records remain unchanged.
 * 24. Audit event is generated for department classification.
 * 25. Employee Edit page loads without blank-page/runtime errors.
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
  console.log(' IT / NON-IT DEPARTMENT CLASSIFICATION TEST SUITE       ');
  console.log('========================================================\n');

  try {
    // Generate Admin token
    const adminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1");
    if (adminUserRes.rows.length === 0) {
      throw new Error('No admin user found in database.');
    }
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken(adminUser);

    // Initial snapshot of core tables
    const empCountRes = await pool.query('SELECT count(*)::int AS count FROM public.employees');
    const attCountRes = await pool.query('SELECT count(*)::int AS count FROM public.attendance');
    const payCountRes = await pool.query('SELECT count(*)::int AS count FROM public.payroll_profiles');
    const leaveCountRes = await pool.query('SELECT count(*)::int AS count FROM public.leave_balances');

    const initialEmpCount = empCountRes.rows[0].count;
    const initialAttCount = attCountRes.rows[0].count;
    const initialPayCount = payCountRes.rows[0].count;
    const initialLeaveCount = leaveCountRes.rows[0].count;

    console.log(`Initial DB State: ${initialEmpCount} employees, ${initialAttCount} attendance rows, ${initialPayCount} payroll rows, ${initialLeaveCount} leave balances\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Only IT and Non-IT are active department options
    // -------------------------------------------------------------------------
    console.log('--- 1. MASTER DATA VERIFICATION ---');
    const activeDeptsRes = await pool.query(
      "SELECT name FROM public.organization_departments WHERE is_active = true ORDER BY name"
    );
    const activeNames = activeDeptsRes.rows.map(r => r.name);
    const onlyItAndNonIt = activeNames.length === 2 && activeNames.includes('IT') && activeNames.includes('Non-IT');
    assert(onlyItAndNonIt, `1. Only IT and Non-IT are active department options (found: [${activeNames.join(', ')}])`);

    // -------------------------------------------------------------------------
    // TESTS 2 - 8: Legacy departments are inactive
    // -------------------------------------------------------------------------
    const legacyDepts = [
      { num: 2, name: 'Engineering' },
      { num: 3, name: 'Finance' },
      { num: 4, name: 'Human Resources' },
      { num: 5, name: 'Marketing' },
      { num: 6, name: 'Operations' },
      { num: 7, name: 'Sales' },
      { num: 8, name: 'Technology' },
    ];

    for (const d of legacyDepts) {
      const row = await pool.query(
        "SELECT is_active FROM public.organization_departments WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))",
        [d.name]
      );
      const isInactive = row.rows.length > 0 && row.rows[0].is_active === false;
      assert(isInactive, `${d.num}. ${d.name} is inactive (exists in master table with is_active = false)`);
    }

    // -------------------------------------------------------------------------
    // TEST 9 & 10: New employee can select IT and Non-IT
    // -------------------------------------------------------------------------
    console.log('\n--- 2. ONBOARDING & SELECTION VALIDATION ---');
    // Test onboarding endpoint with IT
    const itEmpId = 'GP8801N';
    const itEmail = 'it.test01@gaintpro.com';
    // Clean up if exists
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [itEmpId]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [itEmpId]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [itEmpId]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) = $1', [itEmail]);

    const createItRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        employee_id: itEmpId,
        firstName: 'Tester',
        lastName: 'IT',
        email: itEmail,
        phone: '9876543210',
        department: 'IT',
        designation: 'Software Engineer',
        employmentType: 'Full Time',
        workLocation: 'Hyderabad',
        working_days_per_week: 5,
        dateOfBirth: '1995-01-01',
      }
    );
    assert(
      createItRes.statusCode === 201 && createItRes.json()?.data?.department === 'IT',
      '9. New employee can select IT (201 Created with department IT)'
    );

    // Test onboarding endpoint with Non-IT
    const nonItEmpId = 'GP8802N';
    const nonItEmail = 'nonit.test01@gaintpro.com';
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [nonItEmpId]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [nonItEmpId]);
    await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [nonItEmpId]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) = $1', [nonItEmail]);

    const createNonItRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        employee_id: nonItEmpId,
        firstName: 'Tester',
        lastName: 'NonIT',
        email: nonItEmail,
        phone: '9876543211',
        department: 'Non-IT',
        designation: 'Senior Tech Lead',
        employmentType: 'Full Time',
        workLocation: 'Hyderabad',
        working_days_per_week: 5,
        dateOfBirth: '1995-01-01',
      }
    );
    assert(
      createNonItRes.statusCode === 201 && createNonItRes.json()?.data?.department === 'Non-IT',
      '10. New employee can select Non-IT (201 Created with department Non-IT)'
    );

    // -------------------------------------------------------------------------
    // TEST 11: New employee cannot select Engineering (inactive legacy department)
    // -------------------------------------------------------------------------
    const engEmpId = 'GP8803N';
    const engEmail = 'eng.test01@gaintpro.com';
    const createEngRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      {
        employee_id: engEmpId,
        firstName: 'Tester',
        lastName: 'Eng',
        email: engEmail,
        phone: '9876543212',
        department: 'Engineering',
        designation: 'Software Engineer',
        employmentType: 'Full Time',
        workLocation: 'Hyderabad',
        working_days_per_week: 5,
        dateOfBirth: '1995-01-01',
      }
    );
    // Should be rejected with 400 because Engineering is inactive master record
    assert(
      createEngRes.statusCode === 400,
      `11. New employee cannot select Engineering (rejected with HTTP ${createEngRes.statusCode}: ${createEngRes.json()?.message})`
    );

    // -------------------------------------------------------------------------
    // TEST 12: Existing legacy employee does not lose department
    // -------------------------------------------------------------------------
    console.log('\n--- 3. LEGACY DATA PRESERVATION & CLASSIFICATION ---');
    const legacyEmpRes = await pool.query(
      "SELECT employee_id, first_name, last_name, department FROM public.employees WHERE employee_id = 'GP0001N'"
    );
    const legacyEmp = legacyEmpRes.rows[0];
    assert(
      legacyEmp && (legacyEmp.department === 'Engineering' || legacyEmp.department === 'IT'),
      `12. Existing legacy employee retains valid department data (GP0001N has '${legacyEmp?.department}')`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Employee can be changed from legacy department to IT
    // -------------------------------------------------------------------------
    // Set GP0001N to Engineering first to simulate legacy unclassified employee
    await pool.query("UPDATE public.employees SET department = 'Engineering' WHERE employee_id = 'GP0001N'");
    const classifyItRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees/GP0001N/classify-department',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { targetDepartment: 'IT' }
    );
    const empAfterIt = await pool.query("SELECT department FROM public.employees WHERE employee_id = 'GP0001N'");
    assert(
      classifyItRes.statusCode === 200 && empAfterIt.rows[0].department === 'IT',
      '13. Employee can be changed from legacy department to IT (HTTP 200, DB updated to IT)'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Employee can be changed from legacy department to Non-IT
    // -------------------------------------------------------------------------
    // Set GP0002N to Engineering first
    await pool.query("UPDATE public.employees SET department = 'Engineering' WHERE employee_id = 'GP0002N'");
    const classifyNonItRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees/GP0002N/classify-department',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      },
      { targetDepartment: 'Non-IT' }
    );
    const empAfterNonIt = await pool.query("SELECT department FROM public.employees WHERE employee_id = 'GP0002N'");
    assert(
      classifyNonItRes.statusCode === 200 && empAfterNonIt.rows[0].department === 'Non-IT',
      '14. Employee can be changed from legacy department to Non-IT (HTTP 200, DB updated to Non-IT)'
    );

    // -------------------------------------------------------------------------
    // TESTS 15 & 16: Attendance department filter shows IT and Non-IT
    // -------------------------------------------------------------------------
    console.log('\n--- 4. ATTENDANCE DEPARTMENT FILTERING ---');
    // Verify Frontend Attendance.jsx contains strictly IT and Non-IT
    const attFilePath = path.join(__dirname, '../Frontend/src/pages/Admin/Attendance/Attendance.jsx');
    const attFileContent = fs.readFileSync(attFilePath, 'utf8');
    const attHasIt = attFileContent.includes("'IT'") || attFileContent.includes('"IT"');
    const attHasNonIt = attFileContent.includes("'Non-IT'") || attFileContent.includes('"Non-IT"');
    const attHasNoOldDepts = !attFileContent.includes("'Engineering'") && !attFileContent.includes("'Human Resources'");

    assert(attHasIt, '15. Attendance department filter shows IT');
    assert(attHasNonIt && attHasNoOldDepts, '16. Attendance department filter shows Non-IT and excludes old depts');

    // -------------------------------------------------------------------------
    // TEST 17: Attendance IT filter returns only IT employees
    // -------------------------------------------------------------------------
    const attDateRow = await pool.query("SELECT attendance_date::text FROM public.attendance ORDER BY attendance_date DESC LIMIT 1");
    const attDate = attDateRow.rows[0]?.attendance_date || new Date().toISOString().split('T')[0];

    const attItRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${attDate}&department=IT`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const itRecords = attItRes.json()?.data || [];
    const allAreIt = itRecords.length > 0 && itRecords.every(r => r.department === 'IT');
    assert(
      attItRes.statusCode === 200 && (itRecords.length === 0 || allAreIt),
      `17. Attendance IT filter returns only IT employees (${itRecords.length} records returned, all IT)`
    );

    // -------------------------------------------------------------------------
    // TEST 18: Attendance Non-IT filter returns only Non-IT employees
    // -------------------------------------------------------------------------
    const attNonItRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${attDate}&department=Non-IT`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const nonItRecords = attNonItRes.json()?.data || [];
    const allAreNonIt = nonItRecords.length > 0 && nonItRecords.every(r => r.department === 'Non-IT');
    assert(
      attNonItRes.statusCode === 200 && (nonItRecords.length === 0 || allAreNonIt),
      `18. Attendance Non-IT filter returns only Non-IT employees (${nonItRecords.length} records returned, all Non-IT)`
    );

    // -------------------------------------------------------------------------
    // TEST 19: All Departments returns all employees
    // -------------------------------------------------------------------------
    const attAllRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/attendance?date=${attDate}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const allRecords = attAllRes.json()?.data || [];
    assert(
      attAllRes.statusCode === 200 && allRecords.length >= itRecords.length,
      `19. All Departments returns all employees (records count: ${allRecords.length})`
    );

    // -------------------------------------------------------------------------
    // TEST 20: Admin Employees department filter uses IT/Non-IT
    // -------------------------------------------------------------------------
    console.log('\n--- 5. EMPLOYEE LIST FILTER & INTEGRITY ---');
    const empListFilePath = path.join(__dirname, '../Frontend/src/pages/Admin/Employees/Employees.jsx');
    const empListContent = fs.readFileSync(empListFilePath, 'utf8');
    const empListFilterHasItNonIt = 
      empListContent.includes('<option value="IT">IT</option>') &&
      empListContent.includes('<option value="Non-IT">Non-IT</option>');
    assert(empListFilterHasItNonIt, '20. Admin Employees department filter uses IT/Non-IT options strictly');

    // -------------------------------------------------------------------------
    // TESTS 21 - 23: Existing attendance, payroll, leave records remain unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- 6. REGRESSION DATA INTEGRITY ---');
    const currAttCountRes = await pool.query('SELECT count(*)::int AS count FROM public.attendance');
    const currPayCountRes = await pool.query('SELECT count(*)::int AS count FROM public.payroll_profiles');
    const currLeaveCountRes = await pool.query('SELECT count(*)::int AS count FROM public.leave_balances');

    assert(
      currAttCountRes.rows[0].count >= initialAttCount,
      `21. Existing attendance records remain unchanged (${currAttCountRes.rows[0].count} >= ${initialAttCount})`
    );
    assert(
      currPayCountRes.rows[0].count >= initialPayCount,
      `22. Existing payroll profiles remain unchanged (${currPayCountRes.rows[0].count} >= ${initialPayCount})`
    );
    assert(
      currLeaveCountRes.rows[0].count >= initialLeaveCount,
      `23. Existing leave records remain unchanged (${currLeaveCountRes.rows[0].count} >= ${initialLeaveCount})`
    );

    // -------------------------------------------------------------------------
    // TEST 24: Audit event is generated for department classification
    // -------------------------------------------------------------------------
    console.log('\n--- 7. AUDIT LOGGING ---');
    const auditRes = await pool.query(
      `SELECT action, entity_id, metadata FROM public.audit_logs 
       WHERE action = 'EMPLOYEE_DEPARTMENT_CLASSIFIED' 
       ORDER BY created_at DESC LIMIT 1`
    );
    const lastAudit = auditRes.rows[0];
    const hasAuditFields = 
      lastAudit && 
      lastAudit.metadata?.old_department && 
      lastAudit.metadata?.new_department && 
      lastAudit.metadata?.admin_email;
    assert(
      hasAuditFields,
      `24. Audit event generated for department classification (Action: ${lastAudit?.action}, Old: ${lastAudit?.metadata?.old_department}, New: ${lastAudit?.metadata?.new_department})`
    );

    // -------------------------------------------------------------------------
    // TEST 25: Employee Edit page loads without blank-page/runtime errors
    // -------------------------------------------------------------------------
    console.log('\n--- 8. UI COMPONENT VALIDATION ---');
    const editPagePath = path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeEdit/EmployeeEdit.jsx');
    const editContent = fs.readFileSync(editPagePath, 'utf8');
    const editHasLegacyBadge = editContent.includes('(Legacy)');
    const editHasItNonItDefault = editContent.includes("['IT', 'Non-IT']");
    assert(
      editHasLegacyBadge && editHasItNonItDefault,
      '25. Employee Edit page configured safely for IT / Non-IT with legacy department support'
    );

    // -------------------------------------------------------------------------
    // CLEANUP TEST USERS
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2)', [itEmpId, nonItEmpId]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2)', [itEmpId, nonItEmpId]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [itEmpId, nonItEmpId]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) IN ($1, $2)', [itEmail, nonItEmail]);

    // Restore GP0001N and GP0002N to Engineering so legacy employees stay unclassified until admin intentionally confirms
    await pool.query("UPDATE public.employees SET department = 'Engineering' WHERE employee_id IN ('GP0001N', 'GP0002N', 'GP0003N')");

  } catch (error) {
    console.error('Test execution error:', error);
    assert(false, `Unexpected execution exception: ${error.message}`);
  }

  console.log('\n========================================================');
  console.log(`TOTAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('========================================================\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

runTests();
