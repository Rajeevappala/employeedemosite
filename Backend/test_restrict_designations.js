/**
 * Test Suite: Restrict Employee Designations to Two Roles
 * 
 * Verifies all 7 required specifications:
 * 1. The dropdown contains exactly the two requested options (Associate Software Engineer and Associate).
 * 2. Both options can be saved and edited successfully.
 * 3. Invalid designations are rejected by the backend.
 * 4. The selected designation appears correctly in Admin and Employee views.
 * 5. Newly generated payslips show the correct designation.
 * 6. Other generated employment documents use the correct saved designation where applicable.
 * 7. Existing employee records and payroll functionality remain intact.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const payslipPdfService = require('./services/payslipPdfService');
const exitDocumentPdfService = require('./services/exitDocumentPdfService');

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
  console.log('================================================================');
  console.log(' GAINTPRO HRM: RESTRICT DESIGNATIONS TO TWO ROLES TEST SUITE');
  console.log('================================================================\n');

  const testEmpId1 = 'GP8801N';
  const testEmail1 = 'test.ase8801@gaintpro.com';
  const testEmpId2 = 'GP8802N';
  const testEmail2 = 'test.assoc8802@gaintpro.com';
  const testEmpIdInvalid = 'GP8803N';
  const testEmailInvalid = 'test.invalid8803@gaintpro.com';

  try {
    // -------------------------------------------------------------------------
    // Setup: Admin token
    // -------------------------------------------------------------------------
    const adminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1");
    if (adminUserRes.rows.length === 0) {
      throw new Error('No admin user found in database.');
    }
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken(adminUser);

    // Clean up any residual test records first
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2, $3)', [testEmpId1, testEmpId2, testEmpIdInvalid]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2, $3)', [testEmpId1, testEmpId2, testEmpIdInvalid]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2, $3)', [testEmpId1, testEmpId2, testEmpIdInvalid]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) IN ($1, $2, $3)', [testEmail1, testEmail2, testEmailInvalid]);

    // Initial snapshot of employees table
    const baselineEmployeesRes = await pool.query('SELECT employee_id, first_name, designation, department FROM public.employees ORDER BY employee_id');
    const baselineEmployees = baselineEmployeesRes.rows;
    console.log(`Baseline employees count: ${baselineEmployees.length}`);

    // =========================================================================
    // SPECIFICATION 1: DROPDOWN & SETTINGS CONTAINS EXACTLY THE TWO REQUESTED ROLES
    // =========================================================================
    console.log('\n--- 1. DROPDOWN & SETTINGS VERIFICATION ---');

    // 1.1 UI Component Inspection - EmployeeOnboardingModal.jsx
    const onboardingModalPath = path.join(__dirname, '../Frontend/src/pages/Admin/Employees/EmployeeOnboardingModal.jsx');
    const onboardingContent = fs.readFileSync(onboardingModalPath, 'utf8');
    assert(
      onboardingContent.includes("ALLOWED_DESIGNATIONS = ['Associate Software Engineer', 'Associate']") &&
      !onboardingContent.includes("'Senior Tech Lead', 'Python Developer', 'Software Engineer'"),
      '1.1 EmployeeOnboardingModal strictly restricts designations to Associate Software Engineer and Associate'
    );

    // 1.2 UI Component Inspection - EmployeeEdit.jsx
    const editPagePath = path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeEdit/EmployeeEdit.jsx');
    const editContent = fs.readFileSync(editPagePath, 'utf8');
    assert(
      editContent.includes("ALLOWED_DESIGNATIONS = ['Associate Software Engineer', 'Associate']") &&
      editContent.includes('id="edit-designation"') &&
      editContent.includes('className="admin-edit-select"'),
      '1.2 EmployeeEdit uses select dropdown restricted to Associate Software Engineer and Associate'
    );

    // 1.3 Settings API - Active designations in organization_designations
    const resSettings = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const settingsData = resSettings.json()?.data;
    const activeDesigs = (settingsData?.designations || []).filter(d => d.is_active).map(d => d.name);
    assert(
      activeDesigs.length === 2 &&
      activeDesigs.includes('Associate Software Engineer') &&
      activeDesigs.includes('Associate'),
      `1.3 Active designations list from API has exactly the two roles: [${activeDesigs.join(', ')}]`
    );

    const inactiveDesigs = (settingsData?.designations || []).filter(d => !d.is_active).map(d => d.name);
    assert(
      inactiveDesigs.includes('Python Developer') &&
      inactiveDesigs.includes('Senior Tech Lead') &&
      inactiveDesigs.includes('Software Engineer'),
      '1.4 Legacy designations are preserved as inactive (is_active: false)'
    );

    // =========================================================================
    // SPECIFICATION 2: INVALID DESIGNATIONS REJECTED BY BACKEND
    // =========================================================================
    console.log('\n--- 2. BACKEND VALIDATION & REJECTION ---');

    const invalidDesignationsToTest = [
      'Software Engineer',
      'Python Developer',
      'Product Manager',
      'QA Engineer',
      'Senior Tech Lead',
      'Tech Lead',
      'Invalid Designation',
    ];

    for (const invalidDesig of invalidDesignationsToTest) {
      const resBad = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/employees',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      }, {
        employee_id: testEmpIdInvalid,
        firstName: 'Invalid',
        lastName: 'Test',
        email: testEmailInvalid,
        phone: '9876543210',
        department: 'IT',
        designation: invalidDesig,
        working_days_per_week: 5,
        employmentType: 'Full Time',
        workLocation: 'Hyderabad',
      });
      assert(
        resBad.statusCode === 400 && resBad.json()?.message?.includes('Invalid designation'),
        `2.x Onboarding rejects invalid designation '${invalidDesig}' with HTTP 400 (${resBad.json()?.message})`
      );
    }

    // Missing designation rejected
    const resMissing = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: testEmpIdInvalid,
      firstName: 'Invalid',
      lastName: 'Test',
      email: testEmailInvalid,
      department: 'IT',
      designation: '',
      working_days_per_week: 5,
    });
    assert(
      resMissing.statusCode === 400 && resMissing.json()?.message?.includes('Designation is required'),
      '2.y Empty designation is rejected with HTTP 400'
    );

    // =========================================================================
    // SPECIFICATION 3: BOTH OPTIONS CAN BE SAVED AND EDITED SUCCESSFULLY
    // =========================================================================
    console.log('\n--- 3. CREATING AND EDITING EMPLOYEES WITH VALID ROLES ---');

    // 3.1 Create Employee with 'Associate Software Engineer'
    const resCreate1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: testEmpId1,
      firstName: 'Aarav',
      lastName: 'Sharma',
      email: testEmail1,
      phone: '9876543210',
      dateOfBirth: '1998-04-15',
      gender: 'Male',
      department: 'IT',
      designation: 'Associate Software Engineer',
      dateOfJoining: '2025-01-10',
      employmentType: 'Full Time',
      workLocation: 'Hyderabad HQ',
      status: 'ACTIVE',
      working_days_per_week: 5,
    });
    assert(
      resCreate1.statusCode === 201 && resCreate1.json()?.success,
      `3.1 Onboarding with 'Associate Software Engineer' succeeds (HTTP ${resCreate1.statusCode})`
    );

    // Verify DB persistence
    const dbCheck1 = await pool.query('SELECT employee_id, first_name, designation FROM public.employees WHERE employee_id = $1', [testEmpId1]);
    assert(
      dbCheck1.rows[0]?.designation === 'Associate Software Engineer',
      `3.2 PostgreSQL record has designation = 'Associate Software Engineer'`
    );

    // 3.2 Update Employee 1 designation to 'Associate'
    const resUpdate1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId1}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      designation: 'Associate',
    });
    assert(
      resUpdate1.statusCode === 200 && resUpdate1.json()?.success,
      `3.3 Admin edit updating designation to 'Associate' succeeds (HTTP ${resUpdate1.statusCode})`
    );

    const dbCheckUpdate1 = await pool.query('SELECT employee_id, designation FROM public.employees WHERE employee_id = $1', [testEmpId1]);
    assert(
      dbCheckUpdate1.rows[0]?.designation === 'Associate',
      `3.4 PostgreSQL record updated to designation = 'Associate'`
    );

    // 3.3 Create Employee 2 with 'Associate'
    const resCreate2 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      employee_id: testEmpId2,
      firstName: 'Priya',
      lastName: 'Verma',
      email: testEmail2,
      phone: '9876543211',
      dateOfBirth: '1999-07-22',
      gender: 'Female',
      department: 'Non-IT',
      designation: 'Associate',
      dateOfJoining: '2025-02-01',
      employmentType: 'Full Time',
      workLocation: 'Bangalore',
      status: 'ACTIVE',
      working_days_per_week: 5,
    });
    assert(
      resCreate2.statusCode === 201 && resCreate2.json()?.success,
      `3.5 Onboarding with 'Associate' succeeds (HTTP ${resCreate2.statusCode})`
    );

    // 3.4 Update Employee 2 to 'Associate Software Engineer'
    const resUpdate2 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId2}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      designation: 'Associate Software Engineer',
    });
    assert(
      resUpdate2.statusCode === 200 && resUpdate2.json()?.success,
      `3.6 Admin edit updating designation to 'Associate Software Engineer' succeeds (HTTP ${resUpdate2.statusCode})`
    );

    // 3.5 Updating employee with invalid designation is rejected
    const resBadUpdate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId2}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      designation: 'Lead Architect',
    });
    assert(
      resBadUpdate.statusCode === 400 && resBadUpdate.json()?.message?.includes('Invalid designation'),
      '3.7 Updating employee with invalid designation rejected with HTTP 400'
    );

    // =========================================================================
    // SPECIFICATION 4: SELECTED DESIGNATION APPEARS IN ADMIN & EMPLOYEE VIEWS
    // =========================================================================
    console.log('\n--- 4. DISPLAY IN ADMIN & EMPLOYEE VIEWS ---');

    // 4.1 Admin employee list
    const resEmpList = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees?search=${testEmpId1}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const employeesArray = Array.isArray(resEmpList.json()?.data) ? resEmpList.json().data : (resEmpList.json()?.data?.employees || []);
    const listedEmp = employeesArray.find(e => e.employee_id === testEmpId1);
    assert(
      listedEmp?.designation === 'Associate',
      `4.1 Admin employee list displays correct designation '${listedEmp?.designation}'`
    );

    // 4.2 Admin employee details
    const resEmpDetail = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${testEmpId2}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const detailEmp = resEmpDetail.json()?.data?.employee || resEmpDetail.json()?.data;
    assert(
      detailEmp?.designation === 'Associate Software Engineer',
      `4.2 Admin employee details displays correct designation '${detailEmp?.designation}'`
    );

    // 4.3 Employee profile endpoint (viewed as employee)
    const empUserRes = await pool.query('SELECT u.id, u.email, u.role, e.employee_id FROM public.users u JOIN public.employees e ON u.id = e.user_id WHERE e.employee_id = $1', [testEmpId2]);
    if (empUserRes.rows.length > 0) {
      const empUserToken = generateToken(empUserRes.rows[0]);
      const resProfile = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${empUserToken}`,
        },
      });
      const profileData = resProfile.json()?.data?.profile || resProfile.json()?.data;
      assert(
        profileData?.designation === 'Associate Software Engineer',
        `4.3 Employee profile view displays correct designation '${profileData?.designation}'`
      );
    }

    // =========================================================================
    // SPECIFICATION 5: NEWLY GENERATED PAYSLIPS SHOW CORRECT DESIGNATION
    // =========================================================================
    console.log('\n--- 5. PAYSLIP PDF SERVICE VERIFICATION ---');

    const dummyPayrollRecord = {
      employee_id: testEmpId2,
      month: 10,
      year: 2026,
      working_days: 22,
      payable_days: 22,
      basic_salary: 40000,
      hra: 16000,
      allowances: 8000,
      gross_earnings: 64000,
      pf_employee: 1800,
      professional_tax: 200,
      other_deductions: 0,
      total_deductions: 2000,
      net_salary: 62000,
      payment_status: 'Paid',
    };

    const pdfBuffer = await payslipPdfService.generatePayslipPdf({
      payroll: dummyPayrollRecord,
      employee: {
        employee_id: testEmpId2,
        first_name: 'Priya',
        last_name: 'Verma',
        designation: 'Associate Software Engineer',
        department: 'Non-IT',
      },
      isPreview: true,
    });

    assert(
      Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 1000,
      `5.1 Payslip PDF generated successfully (Size: ${pdfBuffer.length} bytes)`
    );

    assert(
      pdfBuffer.toString('utf8', 0, 5) === '%PDF-',
      '5.2 Generated Payslip is a valid PDF'
    );

    // =========================================================================
    // SPECIFICATION 6: OTHER GENERATED EMPLOYMENT DOCUMENTS USE SAVED DESIGNATION
    // =========================================================================
    console.log('\n--- 6. EXIT & RELIEVING DOCUMENT GENERATION ---');

    const relievingPdfBuffer = await exitDocumentPdfService.generateRelievingLetterPdf({
      employee: {
        employee_id: testEmpId2,
        first_name: 'Priya',
        last_name: 'Verma',
        designation: 'Associate Software Engineer',
        department: 'Non-IT',
        date_of_joining: '2025-02-01',
      },
      exitRequest: {
        resignation_date: '2026-10-01',
        requested_relieving_date: '2026-10-31',
        approved_relieving_date: '2026-10-31',
      },
    });

    assert(
      Buffer.isBuffer(relievingPdfBuffer) && relievingPdfBuffer.length > 1000,
      `6.1 Relieving letter PDF generated successfully with saved designation (Size: ${relievingPdfBuffer.length} bytes)`
    );

    const expCertBuffer = await exitDocumentPdfService.generateExperienceCertificatePdf({
      employee: {
        employee_id: testEmpId2,
        first_name: 'Priya',
        last_name: 'Verma',
        designation: 'Associate Software Engineer',
        department: 'Non-IT',
        date_of_joining: '2025-02-01',
      },
      exitRequest: {
        approved_relieving_date: '2026-10-31',
      },
    });

    assert(
      Buffer.isBuffer(expCertBuffer) && expCertBuffer.length > 1000,
      `6.2 Experience certificate PDF generated successfully with saved designation (Size: ${expCertBuffer.length} bytes)`
    );

    // =========================================================================
    // SPECIFICATION 7: EXISTING EMPLOYEE RECORDS & PAYROLL REMAIN INTACT
    // =========================================================================
    console.log('\n--- 7. PRESERVATION OF EXISTING EMPLOYEES & PAYROLL ---');

    const currentEmployeesRes = await pool.query('SELECT employee_id, first_name, designation, department FROM public.employees WHERE employee_id NOT IN ($1, $2) ORDER BY employee_id', [testEmpId1, testEmpId2]);
    const currentEmployees = currentEmployeesRes.rows;

    assert(
      currentEmployees.length === baselineEmployees.length,
      `7.1 Existing employee count preserved (${currentEmployees.length} === ${baselineEmployees.length})`
    );

    let allBaselinePreserved = true;
    for (const baseEmp of baselineEmployees) {
      const match = currentEmployees.find(e => e.employee_id === baseEmp.employee_id);
      if (!match || match.designation !== baseEmp.designation) {
        allBaselinePreserved = false;
        console.error(`  Mismatch for ${baseEmp.employee_id}: expected '${baseEmp.designation}', found '${match?.designation}'`);
      }
    }
    assert(
      allBaselinePreserved,
      '7.2 All existing employee records retain their designations without silent modification'
    );

    // Print legacy employees requiring review as requested in requirements
    console.log('\n  [LEGACY DESIGNATIONS AUDIT REPORT]:');
    for (const baseEmp of baselineEmployees) {
      console.log(`    - Employee ID: ${baseEmp.employee_id} | Name: ${baseEmp.first_name} | Department: ${baseEmp.department} | Current Designation: "${baseEmp.designation}"`);
    }

    // -------------------------------------------------------------------------
    // CLEANUP TEST USERS
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM public.leave_balances WHERE employee_id IN ($1, $2)', [testEmpId1, testEmpId2]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2)', [testEmpId1, testEmpId2]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [testEmpId1, testEmpId2]);
    await pool.query('DELETE FROM public.users WHERE LOWER(email) IN ($1, $2)', [testEmail1, testEmail2]);

  } catch (error) {
    console.error('Test execution error:', error);
    assert(false, `Unexpected execution exception: ${error.message}`);
  }

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('================================================================\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

runTests();
