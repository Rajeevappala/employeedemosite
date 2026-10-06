const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const pool = require('./config/database');
const storageService = require('./services/storageService');
const { generateToken } = require('./utils/tokenUtils');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  let payload = null;
  const reqHeaders = {
    'X-Test-Suite': 'true',
    ...(options.headers || {}),
  };
  if (postData) {
    payload = Buffer.isBuffer(postData) ? postData : Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData));
    reqHeaders['Content-Length'] = payload.length;
  }
  const reqOptions = {
    agent: false,
    ...options,
    headers: reqHeaders,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(reqOptions, (res) => {
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
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function makeMultipartRequestWithFields(options, fields = {}, fileField = null) {
  const boundary = '----WebKitFormBoundaryTest' + Math.random().toString(36).substring(2);
  const parts = [];

  for (const [key, val] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`,
      'utf8'
    ));
  }

  if (fileField && fileField.buffer) {
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.mimeType || 'application/pdf'}\r\n\r\n`,
      'utf8'
    );
    parts.push(header);
    parts.push(fileField.buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const bodyBuf = Buffer.concat(parts);

  options.headers = {
    ...options.headers,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': bodyBuf.length,
  };

  return makeRequest(options, bodyBuf);
}

function createDummyPdfBuffer(content = 'Sample Payslip Document Content') {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length + 30} >>\nstream\nBT /F1 12 Tf 100 700 Td (${content}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000214 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n350\n%%EOF\n`,
    'utf8'
  );
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

async function runTests() {
  console.log('================================================================');
  console.log('  PHASE 22A — SIMPLE MONTHLY PAYSLIP MANAGEMENT AUTOMATED SUITE ');
  console.log('================================================================\n');

  const testMonth = 11;
  const testYear = 2026;
  let testEmpId = null;
  let oldStorageKey = null;
  let uploadedDocId = null;

  try {
    // 0. Setup: Identify tokens
    const superAdminRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const adminRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const empRes = await pool.query(
      "SELECT u.id, u.email, u.role, e.employee_id FROM public.users u JOIN public.employees e ON e.user_id = u.id WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' LIMIT 1"
    );

    assert(adminRes.rows.length > 0, 'Setup: Admin user found in database');
    assert(empRes.rows.length > 0, 'Setup: Employee user found in database');

    const adminUser = adminRes.rows[0];
    const superAdminUser = superAdminRes.rows[0] || adminUser;
    const empUser = empRes.rows[0];
    testEmpId = empUser.employee_id;

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });
    const superAdminToken = generateToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
    });
    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: empUser.role,
      employeeId: empUser.employee_id,
    });

    // Cleanup any pre-existing payslip document for testEmpId in testMonth/testYear
    const existingDoc = await pool.query(
      "SELECT id, storage_key FROM public.documents WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3",
      [testEmpId, testMonth, testYear]
    );
    for (const d of existingDoc.rows) {
      try {
        await storageService.deleteFile(d.storage_key);
      } catch {}
      await pool.query('DELETE FROM public.documents WHERE id = $1', [d.id]);
    }

    // -------------------------------------------------------------------------
    // TEST 1: Query Monthly Payslips (Default Month & Year)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Query Monthly Payslips (Default Parameters) ---');
    const getDefRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/monthly-payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getDefRes.statusCode === 200, 'GET /monthly-payslips returns HTTP 200');
    const defData = getDefRes.json();
    assert(defData && defData.success === true, 'Response indicates success = true');
    assert(defData.data && typeof defData.data.month === 'number', 'Response contains default runtime month');
    assert(defData.data && typeof defData.data.year === 'number', 'Response contains default runtime year');
    assert(defData.data.summary && typeof defData.data.summary.total_employees === 'number', 'Summary contains total_employees count');

    // -------------------------------------------------------------------------
    // TEST 2: Query Monthly Payslips (Explicit Month & Year)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Query Monthly Payslips (Explicit Parameters & Counts) ---');
    const getExpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/payroll/monthly-payslips?month=${testMonth}&year=${testYear}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getExpRes.statusCode === 200, 'GET /monthly-payslips?month=...&year=... returns HTTP 200');
    const expData = getExpRes.json();
    assert(expData.data.month === testMonth, `Returned month matches requested month (${testMonth})`);
    assert(expData.data.year === testYear, `Returned year matches requested year (${testYear})`);

    // Verify DB count of active employees matches summary.total_employees
    const activeEmpCountRes = await pool.query(
      "SELECT COUNT(*) FROM public.employees WHERE status = 'ACTIVE'"
    );
    const expectedTotal = parseInt(activeEmpCountRes.rows[0].count, 10);
    assert(
      expData.data.summary.total_employees === expectedTotal,
      `Summary total_employees (${expData.data.summary.total_employees}) matches actual active employee count in DB (${expectedTotal})`
    );
    assert(
      expData.data.summary.uploaded + expData.data.summary.pending === expData.data.summary.total_employees,
      'Summary check: uploaded + pending strictly equals total_employees'
    );

    // Verify employee record format and zero storage_key leaks
    const foundEmp = expData.data.employees.find((e) => e.employee_id === testEmpId);
    assert(!!foundEmp, `Found test employee (${testEmpId}) in employee list`);
    assert(foundEmp.status === 'Pending', `Initial status for test employee is 'Pending'`);
    assert(!foundEmp.document_id, 'Initial document_id is null');

    // Leak check across all returned employee objects
    const hasStorageKeyLeak = JSON.stringify(expData).includes('storage_key') || JSON.stringify(expData).includes('private_storage');
    assert(!hasStorageKeyLeak, 'Zero storage_key or internal storage path leakage in GET response');

    // -------------------------------------------------------------------------
    // TEST 3: Validation on Upload
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Upload Validation & Rejections ---');

    // 3a. Upload without file
    const noFileRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear }
    );
    assert(noFileRes.statusCode === 400, 'Upload without file is rejected with HTTP 400');

    // 3b. Upload non-PDF file (.txt)
    const textFileRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text content') }
    );
    assert(textFileRes.statusCode === 400, 'Upload of non-PDF (.txt) is rejected with HTTP 400');

    // 3c. Upload spoofed PDF (named .pdf but invalid magic bytes)
    const spoofedPdfRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('NOT A REAL PDF FILE HEADER') }
    );
    assert(spoofedPdfRes.statusCode === 400, 'Upload of spoofed PDF (invalid magic bytes) is rejected with HTTP 400');
    assert(
      spoofedPdfRes.json()?.message?.toLowerCase().includes('corrupted') || spoofedPdfRes.json()?.message?.toLowerCase().includes('pdf'),
      'Rejection message explicitly specifies PDF header / format error'
    );

    // 3d. Upload with non-existent employee_id
    const nonExistentEmpRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: 'GP9999N', month: testMonth, year: testYear },
      { name: 'file', filename: 'payslip.pdf', mimeType: 'application/pdf', buffer: createDummyPdfBuffer('Employee GP9999N Payslip') }
    );
    assert(nonExistentEmpRes.statusCode === 404, 'Upload for non-existent employee returns HTTP 404');

    // -------------------------------------------------------------------------
    // TEST 4: Successful Payslip Upload
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Successful Payslip Upload & DB State ---');
    const validPdfBuffer = createDummyPdfBuffer(`Original payslip content for ${testEmpId} ${testMonth}/${testYear}`);
    const uploadRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: `Payslip_${testEmpId}_${testMonth}_${testYear}.pdf`, mimeType: 'application/pdf', buffer: validPdfBuffer }
    );

    if (uploadRes.statusCode !== 201) {
      console.log('DEBUG uploadRes failed with status:', uploadRes.statusCode, uploadRes.body.toString('utf8'));
    }
    assert(uploadRes.statusCode === 201, 'Valid PDF upload returns HTTP 201 Created');
    const uploadJson = uploadRes.json();
    assert(uploadJson && uploadJson.success === true, 'Upload response indicates success = true');
    assert(!!uploadJson?.data?.document_id, 'Upload response returns created document_id');
    uploadedDocId = uploadJson?.data?.document_id;
    assert(!JSON.stringify(uploadJson).includes('storage_key'), 'Zero storage_key leaked in upload response');

    // Verify DB record
    if (uploadedDocId) {
      const dbDocRes = await pool.query(
        'SELECT id, employee_id, document_type, file_name, storage_key, month, year FROM public.documents WHERE id = $1',
        [uploadedDocId]
      );
      assert(dbDocRes.rows.length === 1, 'Document record exists in public.documents table');
      const docRow = dbDocRes.rows[0];
      assert(docRow.document_type.toUpperCase() === 'PAYSLIP', `Document type is 'PAYSLIP'`);
      assert(docRow.month === testMonth && docRow.year === testYear, `Document month and year match (${testMonth}/${testYear})`);
      assert(docRow.employee_id === testEmpId, `Document employee_id matches (${testEmpId})`);
      oldStorageKey = docRow.storage_key;

      // Verify physical file exists on disk
      const oldFileExists = await storageService.fileExists(oldStorageKey);
      assert(oldFileExists === true, 'Payslip file exists physically in private storage');

      // Verify audit log entry
      const auditRes = await pool.query(
        "SELECT * FROM public.audit_logs WHERE action = 'PAYSLIP_UPLOADED' AND entity_id = $1",
        [uploadedDocId]
      );
      assert(auditRes.rows.length > 0, "Audit log record created with action 'PAYSLIP_UPLOADED'");
    }

    // -------------------------------------------------------------------------
    // TEST 5: Verify Updated Status & Counts
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Verify Updated Status & Summary Counts ---');
    const getAfterUpload = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/payroll/monthly-payslips?month=${testMonth}&year=${testYear}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const afterUploadData = getAfterUpload.json();
    const uploadedEmp = afterUploadData.data.employees.find((e) => e.employee_id === testEmpId);
    assert(uploadedEmp.status === 'Uploaded', `Payslip status is now 'Uploaded'`);
    assert(uploadedEmp.document_id === uploadedDocId, 'Returned document_id matches uploaded document');
    assert(afterUploadData.data.summary.uploaded >= 1, 'Summary uploaded count incremented');

    // -------------------------------------------------------------------------
    // TEST 6: Duplicate Upload Prevention (HTTP 409)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Duplicate Upload Prevention ---');
    const dupRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'duplicate.pdf', mimeType: 'application/pdf', buffer: validPdfBuffer }
    );
    assert(dupRes.statusCode === 409, 'Duplicate upload for same employee and period returns HTTP 409 Conflict');
    assert(
      dupRes.json()?.message?.toLowerCase().includes('already exists'),
      'Conflict error message clearly indicates payslip already exists'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Replace Payslip Workflow
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Replace Payslip Workflow ---');

    // 7a. Rejection when replacing for employee with no existing payslip
    const replaceNonExistentRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/replace',
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: 'GP9999N', month: testMonth, year: testYear },
      { name: 'file', filename: 'rep.pdf', mimeType: 'application/pdf', buffer: validPdfBuffer }
    );
    assert(replaceNonExistentRes.statusCode === 404, 'Replace for employee without existing payslip returns HTTP 404');

    // 7b. Rejection on replace with invalid magic bytes
    const replaceInvalidPdfRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/replace',
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'rep_bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('CORRUPTED NON PDF BYTES') }
    );
    assert(replaceInvalidPdfRes.statusCode === 400, 'Replace with invalid magic bytes is rejected with HTTP 400');

    // 7c. Successful Replace with valid new PDF
    const replacementBuffer = createDummyPdfBuffer(`REPLACED PAYSLIP CONTENT FOR ${testEmpId} - V2`);
    const replaceRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/replace',
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: `Payslip_REPLACED_${testEmpId}.pdf`, mimeType: 'application/pdf', buffer: replacementBuffer }
    );

    assert(replaceRes.statusCode === 200, 'Valid payslip replace returns HTTP 200 OK');
    const replaceJson = replaceRes.json();
    assert(replaceJson && replaceJson.success === true, 'Replace response indicates success = true');
    assert(!JSON.stringify(replaceJson).includes('storage_key'), 'Zero storage_key leaked in replace response');

    // Verify DB update
    const dbRepDocRes = await pool.query(
      'SELECT id, storage_key, file_name, updated_at FROM public.documents WHERE id = $1',
      [uploadedDocId]
    );
    const updatedDocRow = dbRepDocRes.rows[0];
    const newStorageKey = updatedDocRow.storage_key;
    assert(newStorageKey !== oldStorageKey, 'Database storage_key was updated to new file key');

    // Verify old physical file was removed
    const oldFileStillExists = await storageService.fileExists(oldStorageKey);
    assert(oldFileStillExists === false, 'Old physical file was deleted from private storage');

    // Verify new physical file exists
    const newFileExists = await storageService.fileExists(newStorageKey);
    assert(newFileExists === true, 'New physical file exists in private storage');

    // Verify audit log entry for replace
    const auditRepRes = await pool.query(
      "SELECT * FROM public.audit_logs WHERE action = 'PAYSLIP_REPLACED' AND entity_id = $1",
      [uploadedDocId]
    );
    assert(auditRepRes.rows.length > 0, "Audit log record created with action 'PAYSLIP_REPLACED'");

    // -------------------------------------------------------------------------
    // TEST 8: Document View (Inline) and Download
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Document Inline View & Download ---');

    // 8a. Inline view (inline=true)
    const inlineRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/documents/${uploadedDocId}/download?inline=true`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(inlineRes.statusCode === 200, 'Inline document fetch returns HTTP 200');
    assert(
      (inlineRes.headers['content-type'] || '').includes('application/pdf'),
      'Content-Type is application/pdf'
    );
    assert(
      (inlineRes.headers['content-disposition'] || '').startsWith('inline'),
      `Content-Disposition starts with 'inline' (${inlineRes.headers['content-disposition']})`
    );
    assert(
      inlineRes.body.toString('utf8').includes('REPLACED PAYSLIP CONTENT'),
      'Inline document content matches replaced PDF content'
    );

    // 8b. Regular download (attachment)
    const dlRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/documents/${uploadedDocId}/download`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(dlRes.statusCode === 200, 'Download document fetch returns HTTP 200');
    assert(
      (dlRes.headers['content-disposition'] || '').startsWith('attachment'),
      `Content-Disposition starts with 'attachment' (${dlRes.headers['content-disposition']})`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Security & RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Security & RBAC Enforcement ---');

    // 9a. Unauthenticated GET
    const unauthGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/monthly-payslips',
      method: 'GET',
    });
    assert(unauthGet.statusCode === 401, 'Unauthenticated GET /monthly-payslips returns HTTP 401');

    // 9b. EMPLOYEE GET /monthly-payslips
    const empGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/monthly-payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empGet.statusCode === 403, 'EMPLOYEE role GET /monthly-payslips returns HTTP 403 Forbidden');

    // 9c. EMPLOYEE POST upload
    const empUpload = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/upload',
        method: 'POST',
        headers: { Authorization: `Bearer ${empToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'emp_hack.pdf', mimeType: 'application/pdf', buffer: validPdfBuffer }
    );
    assert(empUpload.statusCode === 403, 'EMPLOYEE role POST /upload returns HTTP 403 Forbidden');

    // 9d. EMPLOYEE PUT replace
    const empReplace = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/monthly-payslips/replace',
        method: 'PUT',
        headers: { Authorization: `Bearer ${empToken}` },
      },
      { employee_id: testEmpId, month: testMonth, year: testYear },
      { name: 'file', filename: 'emp_hack_rep.pdf', mimeType: 'application/pdf', buffer: validPdfBuffer }
    );
    assert(empReplace.statusCode === 403, 'EMPLOYEE role PUT /replace returns HTTP 403 Forbidden');

    // 9e. SUPER_ADMIN GET allowed
    const superAdminGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/payroll/monthly-payslips?month=${testMonth}&year=${testYear}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(superAdminGet.statusCode === 200, 'SUPER_ADMIN role GET /monthly-payslips returns HTTP 200');

    // -------------------------------------------------------------------------
    // TEST 10: Cleanup Test Data
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Cleanup & Verification ---');
    if (uploadedDocId) {
      const docToDel = await pool.query('SELECT storage_key FROM public.documents WHERE id = $1', [uploadedDocId]);
      if (docToDel.rows.length > 0) {
        try {
          await storageService.deleteFile(docToDel.rows[0].storage_key);
        } catch {}
      }
      await pool.query('DELETE FROM public.documents WHERE id = $1', [uploadedDocId]);
      await pool.query("DELETE FROM public.audit_logs WHERE entity_id = $1", [uploadedDocId]);
    }
    const cleanCheck = await pool.query('SELECT id FROM public.documents WHERE id = $1', [uploadedDocId]);
    assert(cleanCheck.rows.length === 0, 'Test payslip document cleanly removed after testing');

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`  PHASE 22A TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
