const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null, isMultipart = false) {
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
      } else if (typeof postData === 'string') {
        req.write(postData);
      } else {
        req.write(JSON.stringify(postData));
      }
    }
    req.end();
  });
}

function buildMultipartFormData(fields, files, boundary) {
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
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

async function runWizardTests() {
  console.log('================================================================');
  console.log('  GAINTPRO EMPLOYEE PORTAL — PHASE 21 ONBOARDING WIZARD TESTS   ');
  console.log('  8-STEP WIZARD ATOMIC CREATION, STORAGE & VALIDATIONS          ');
  console.log('================================================================\n');

  const createdEmployeeIds = [];
  const createdEmails = [];
  const storageKeysToClean = [];

  try {
    // 0. Setup: Admin user token
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    assert(adminUserRes.rows.length > 0, 'Admin user exists in database');
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    // =========================================================================
    // 1. COMPLETE 8-STEP WIZARD ONBOARDING (JSON Payload)
    // =========================================================================
    console.log('\n--- 1. COMPLETE 8-STEP WIZARD ONBOARDING (JSON PAYLOAD) ---');
    const empId1 = 'GP7701N';
    const email1 = `wizard.emp1.${Date.now()}@gaintpro.com`;

    const fullWizardPayload = {
      // Step 1: Basic Information
      employee_id: empId1,
      firstName: 'Aarav',
      lastName: 'Sharma',
      email: email1,
      personalEmail: 'aarav.personal@gmail.com',
      phone: '9876543210',

      // Step 2: Personal & Contact
      dateOfBirth: '1992-06-15',
      gender: 'Male',
      address: 'Flat 402, Green Meadows',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500081',
      emergencyContactName: 'Priya Sharma',
      emergencyContactPhone: '9876543211',
      emergencyContactRelationship: 'Spouse',

      // Step 3: Employment Details
      department: 'Technology',
      designation: 'Staff Software Engineer',
      dateOfJoining: '2026-03-01',
      employmentType: 'Full Time',
      reportingManager: 'Venkatesh Rao',
      workLocation: 'Hyderabad Office',
      status: 'ACTIVE',
      working_days_per_week: 5,

      // Step 4: PF Details
      pfNotAvailable: false,
      pfDetails: {
        uanNumber: '100987654321',
        pfNumber: 'AP/HYD/12345/678',
        pensionNumber: 'PENS-987654',
      },

      // Step 5: Salary & Payroll
      salary: {
        basicSalary: 60000,
        hra: 24000,
        allowances: 16000,
        pfEmployee: 1800,
        professionalTax: 200,
        otherDeductions: 1000,
      },

      // Step 6: Leave Setup
      leaveBalances: {
        paidLeave: 18,
        sickLeave: 12,
        unpaidLeave: 0,
      },
    };

    const resWizard = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, fullWizardPayload);

    assert(resWizard.statusCode === 201, '1.1 Full 8-step wizard creates employee (201 Created)');
    createdEmployeeIds.push(empId1);
    createdEmails.push(email1);

    const data1 = resWizard.json()?.data;
    assert(data1?.employee_id === empId1, '1.2 Stored exact employee_id GP7701N');
    assert(data1?.personal_email === 'aarav.personal@gmail.com', '1.3 Stored personal_email');
    assert(data1?.payroll_profile?.gross_salary === 100000, '1.4 Calculated gross salary: 60k + 24k + 16k = 100,000');
    assert(data1?.payroll_profile?.total_deductions === 3000, '1.5 Calculated total deductions: 1800 + 200 + 1000 = 3,000');
    assert(data1?.payroll_profile?.net_calculated === 97000, '1.6 Calculated net salary: 100,000 - 3,000 = 97,000');
    assert(data1?.leave_balances?.paid_leave === 18, '1.7 Stored configured paid leave quota (18)');

    // Verify in database tables
    const empDb = await pool.query('SELECT * FROM public.employees WHERE employee_id = $1', [empId1]);
    assert(empDb.rows.length === 1, '1.8 Record found in public.employees');
    const empRow = empDb.rows[0];
    assert(empRow.emergency_contact_relationship === 'Spouse', '1.9 Database stores emergency_contact_relationship');
    assert(empRow.work_location === 'Hyderabad Office', '1.10 Database stores work_location');
    assert(empRow.personal_email === 'aarav.personal@gmail.com', '1.11 Database stores personal_email');

    const pfDb = await pool.query('SELECT * FROM public.pf_details WHERE employee_id = $1', [empId1]);
    assert(pfDb.rows.length === 1 && pfDb.rows[0].uan_number === '100987654321', '1.12 Database stores pf_details record with UAN');

    const payrollDb = await pool.query('SELECT * FROM public.payroll_profiles WHERE employee_id = $1', [empId1]);
    assert(payrollDb.rows.length === 1 && Number(payrollDb.rows[0].basic_salary) === 60000, '1.13 Database stores payroll_profiles record');

    // Verify NO payroll_records were created
    const prCheck = await pool.query('SELECT * FROM public.payroll_records WHERE employee_id = $1', [empId1]);
    assert(prCheck.rows.length === 0, '1.14 No payroll_records created during onboarding');

    // =========================================================================
    // 2. PF DETAILS TOGGLED OFF ("PF details not available now")
    // =========================================================================
    console.log('\n--- 2. PF DETAILS TOGGLED OFF (NO EMPTY RECORD IN PF_DETAILS) ---');
    const empId2 = 'GP7702N';
    const email2 = `wizard.emp2.${Date.now()}@gaintpro.com`;

    const resNoPf = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: empId2,
      firstName: 'Neha',
      lastName: 'Patel',
      email: email2,
      department: 'Finance',
      designation: 'Financial Analyst',
      working_days_per_week: 5,
      pfNotAvailable: true,
      pfDetails: {
        uanNumber: '',
        pfNumber: '',
        pensionNumber: '',
      },
    });

    assert(resNoPf.statusCode === 201, '2.1 Employee created with PF toggled off (201 Created)');
    createdEmployeeIds.push(empId2);
    createdEmails.push(email2);

    const pfEmptyCheck = await pool.query('SELECT * FROM public.pf_details WHERE employee_id = $1', [empId2]);
    assert(pfEmptyCheck.rows.length === 0, '2.2 No empty record inserted into public.pf_details when toggled off');

    // =========================================================================
    // 3. STEP 7 DOCUMENT UPLOADS (MULTIPART FORM DATA)
    // =========================================================================
    console.log('\n--- 3. STEP 7 DOCUMENT UPLOADS (MULTIPART FORM DATA) ---');
    const empId3 = 'GP7703N';
    const email3 = `wizard.emp3.${Date.now()}@gaintpro.com`;

    const boundary = '----WebKitFormBoundaryWizardTest' + Date.now();
    const validPdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF');
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);

    const multipartFields = {
      employee_id: empId3,
      firstName: 'Rohan',
      lastName: 'Mehta',
      email: email3,
      department: 'HR',
      designation: 'HR Executive',
      working_days_per_week: '5',
      address: '123 Park Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      emergencyContactName: 'Kavita Mehta',
      emergencyContactPhone: '9876543212',
      emergencyContactRelationship: 'Mother',
      salary: JSON.stringify({ basicSalary: 45000, hra: 18000, allowances: 7000, pfEmployee: 1800, professionalTax: 200, otherDeductions: 0 }),
      leaveBalances: JSON.stringify({ paidLeave: 12, sickLeave: 10, unpaidLeave: 0 }),
    };

    const multipartFiles = [
      {
        fieldname: 'offer_letter',
        filename: 'Offer_Letter.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
      {
        fieldname: 'aadhaar_card',
        filename: 'Aadhaar_Card.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
      {
        fieldname: 'profile_photo',
        filename: 'Avatar.png',
        contentType: 'image/png',
        content: validPngBuffer,
      },
    ];

    const multipartBody = buildMultipartFormData(multipartFields, multipartFiles, boundary);

    const resMultipart = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
        Authorization: `Bearer ${adminToken}`,
      },
    }, multipartBody);

    assert(resMultipart.statusCode === 201, '3.1 Multipart onboarding with files succeeds (201 Created)');
    createdEmployeeIds.push(empId3);
    createdEmails.push(email3);

    const data3 = resMultipart.json()?.data;
    assert(data3?.documents_count === 3, '3.2 Response indicates 3 documents uploaded');

    const docsDb = await pool.query('SELECT * FROM public.documents WHERE employee_id = $1 ORDER BY created_at ASC', [empId3]);
    assert(docsDb.rows.length === 3, '3.3 Database public.documents contains 3 records for employee');

    const docTypes = docsDb.rows.map(d => d.document_type);
    assert(docTypes.includes('Offer Letter'), '3.4 Documents include "Offer Letter"');
    assert(docTypes.includes('Aadhaar Card'), '3.5 Documents include "Aadhaar Card"');
    assert(docTypes.includes('Profile Photo'), '3.6 Documents include "Profile Photo"');

    // Verify physical storage files exist on disk
    for (const doc of docsDb.rows) {
      storageKeysToClean.push(doc.storage_key);
      const existsOnDisk = await storageService.fileExists(doc.storage_key);
      assert(existsOnDisk, `3.7 Physical file exists in private storage: ${doc.document_type}`);
    }

    // Verify profile photo url on employee record
    const emp3Db = await pool.query('SELECT profile_photo_url FROM public.employees WHERE employee_id = $1', [empId3]);
    assert(emp3Db.rows[0].profile_photo_url?.startsWith('avatars/'), '3.8 Employee profile_photo_url populated with avatar storage key');

    // =========================================================================
    // 4. CORRUPTED FILE MAGIC BYTES REJECTION (SECURITY)
    // =========================================================================
    console.log('\n--- 4. CORRUPTED FILE / MAGIC BYTES REJECTION ---');
    const empId4 = 'GP7704N';
    const email4 = `wizard.emp4.${Date.now()}@gaintpro.com`;

    const fakePdfContent = Buffer.from('NOT A REAL PDF FILE HEADER');
    const badMultipartBody = buildMultipartFormData({
      employee_id: empId4,
      firstName: 'Fake',
      email: email4,
      department: 'Technology',
      designation: 'Tester',
      working_days_per_week: '5',
    }, [{
      fieldname: 'offer_letter',
      filename: 'Fake.pdf',
      contentType: 'application/pdf',
      content: fakePdfContent,
    }], boundary);

    const resBadFile = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': badMultipartBody.length,
        Authorization: `Bearer ${adminToken}`,
      },
    }, badMultipartBody);

    assert(resBadFile.statusCode === 400, '4.1 Corrupted file rejected with 400 Bad Request');
    assert(resBadFile.json()?.message?.includes('signature'), '4.2 Signature error message returned');

    // Verify employee was NOT created
    const badEmpCheck = await pool.query('SELECT * FROM public.employees WHERE employee_id = $1', [empId4]);
    assert(badEmpCheck.rows.length === 0, '4.3 No orphaned employee in database after file validation rejection');

    // =========================================================================
    // 5. TRANSACTIONAL ROLLBACK FILE CLEANUP
    // =========================================================================
    console.log('\n--- 5. TRANSACTIONAL ROLLBACK FILE CLEANUP ---');
    // We simulate a DB conflict with duplicate email while sending valid files.
    // The files must NOT remain orphaned on disk after DB rollback!
    const empId5 = 'GP7705N';
    const dupEmail = email1; // already exists from test 1

    const rollbackBoundary = '----WebKitFormBoundaryRollback' + Date.now();
    const rollbackBody = buildMultipartFormData({
      employee_id: empId5,
      firstName: 'Rollback',
      email: dupEmail, // duplicate email triggers DB 409
      department: 'Technology',
      designation: 'Tester',
      working_days_per_week: '5',
    }, [{
      fieldname: 'offer_letter',
      filename: 'Rollback_Doc.pdf',
      contentType: 'application/pdf',
      content: validPdfBuffer,
    }], rollbackBoundary);

    const resRollback = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${rollbackBoundary}`,
        'Content-Length': rollbackBody.length,
        Authorization: `Bearer ${adminToken}`,
      },
    }, rollbackBody);

    assert(resRollback.statusCode === 409, '5.1 Duplicate email triggers 409 Conflict rollback');

    // Verify no documents record exists for GP7705N
    const rollbackDocs = await pool.query('SELECT * FROM public.documents WHERE employee_id = $1', [empId5]);
    assert(rollbackDocs.rows.length === 0, '5.2 No documents record created in database');

    // =========================================================================
    // 6. VALIDATION & DUPLICATE PROTECTIONS
    // =========================================================================
    console.log('\n--- 6. VALIDATION & DUPLICATE PROTECTIONS ---');

    // 6.1 Duplicate Employee ID check returns 409 Conflict with exact message
    const resDupId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: empId1, // already exists
      firstName: 'DupCheck',
      email: `another.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Dev',
      working_days_per_week: 5,
    });
    assert(resDupId.statusCode === 409, '6.1 Duplicate employee_id returns 409 Conflict');
    assert(resDupId.json()?.message === 'Employee ID already exists.', '6.2 Exact error message: "Employee ID already exists."');

    // 6.2 Invalid Employee ID regex pattern
    const resInvalidId = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: '12345',
      firstName: 'BadPattern',
      email: `badpattern.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Dev',
    });
    assert(resInvalidId.statusCode === 400, '6.3 Invalid employee_id format returns 400 Bad Request');
    assert(resInvalidId.json()?.message?.includes('GP####N'), '6.4 Format hint in error message');

    // 6.3 Invalid UAN number format
    const resInvalidUan = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    }, {
      employee_id: 'GP7706N',
      firstName: 'BadUan',
      email: `baduan.${Date.now()}@gaintpro.com`,
      department: 'Technology',
      designation: 'Dev',
      pfNotAvailable: false,
      pfDetails: { uanNumber: '12345' }, // less than 12 digits
    });
    assert(resInvalidUan.statusCode === 400, '6.5 Invalid UAN format returns 400 Bad Request');
    assert(resInvalidUan.json()?.message?.includes('12 numeric digits'), '6.6 Error message: "UAN number must be exactly 12 numeric digits."');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    // Clean up created test records
    console.log('\n--- CLEANING UP TEST ARTIFACTS ---');
    for (const empId of createdEmployeeIds) {
      await pool.query('DELETE FROM public.attendance WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.documents WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.leave_balances WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.pf_details WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.audit_logs WHERE entity_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.employees WHERE employee_id = $1', [empId]).catch(() => {});
      await pool.query('DELETE FROM public.users WHERE employee_id = $1', [empId]).catch(() => {});
      console.log(`  Cleaned up employee: ${empId}`);
    }

    for (const email of createdEmails) {
      await pool.query('DELETE FROM public.users WHERE email = $1', [email]).catch(() => {});
    }

    for (const key of storageKeysToClean) {
      await storageService.deleteFile(key).catch(() => {});
    }

    console.log('\n================================================================');
    console.log(`  PHASE 21 ONBOARDING WIZARD TESTS: ${passed} PASSED, ${failed} FAILED  `);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runWizardTests();
