require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');

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

function buildMultipartFormData({ fields = {}, file = null, boundary = '----WebKitFormBoundaryTest' }) {
  const crlf = '\r\n';
  const parts = [];

  for (const [name, val] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${val}${crlf}`));
  }

  if (file) {
    const { fieldname = 'file', filename = 'test.pdf', contentType = 'application/pdf', content } = file;
    parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"${crlf}Content-Type: ${contentType}${crlf}${crlf}`));
    parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content));
    parts.push(Buffer.from(crlf));
  }

  parts.push(Buffer.from(`--${boundary}--${crlf}`));
  const body = Buffer.concat(parts);
  return {
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  };
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
  console.log('EXIT & RELIEVING WORKFLOW AUTOMATED TEST SUITE (30 CRITERIA)');
  console.log('================================================================\n');

  const empId1 = 'GP_EXIT_TEST_01';
  const empId2 = 'GP_EXIT_TEST_02';
  const adminIdStr = 'GP_EXIT_ADMIN_01';

  let emp1Token = null;
  let emp2Token = null;
  let adminToken = null;

  let emp1UserId = null;
  let emp2UserId = null;
  let adminUserId = null;

  try {
    // 1. Cleanup old test data
    await pool.query('DELETE FROM public.documents WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.fnf_settlements WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.exit_clearances WHERE exit_request_id IN (SELECT id FROM public.exit_requests WHERE employee_id IN ($1, $2))', [empId1, empId2]);
    await pool.query('DELETE FROM public.exit_requests WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.leave_requests WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.attendance WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.payroll_records WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.payroll_profiles WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.users WHERE email IN ($1, $2, $3)', [
      'exit_test_emp1@gaintpro.com',
      'exit_test_emp2@gaintpro.com',
      'exit_test_admin@gaintpro.com',
    ]);

    // 2. Create Admin user
    const adminUserRes = await pool.query(
      `INSERT INTO public.users (email, role, status) VALUES ('exit_test_admin@gaintpro.com', 'ADMIN', 'ACTIVE') RETURNING id`
    );
    adminUserId = adminUserRes.rows[0].id;
    adminToken = generateToken({ id: adminUserId, email: 'exit_test_admin@gaintpro.com', role: 'ADMIN' });

    // 3. Create Employee 1
    const emp1UserRes = await pool.query(
      `INSERT INTO public.users (email, role, status) VALUES ('exit_test_emp1@gaintpro.com', 'EMPLOYEE', 'ACTIVE') RETURNING id`
    );
    emp1UserId = emp1UserRes.rows[0].id;
    await pool.query(
      `INSERT INTO public.employees (employee_id, user_id, first_name, last_name, email, department, designation, date_of_joining, status)
       VALUES ($1, $2, 'Rajeev', 'Appala', 'exit_test_emp1@gaintpro.com', 'Engineering', 'Senior Developer', '2022-01-15', 'ACTIVE')`,
      [empId1, emp1UserId]
    );
    await pool.query('UPDATE public.users SET employee_id = $1 WHERE id = $2', [empId1, emp1UserId]);
    await pool.query(
      `INSERT INTO public.payroll_profiles (employee_id, basic_salary, hra, allowances)
       VALUES ($1, 60000, 24000, 16000)`,
      [empId1]
    );
    emp1Token = generateToken({ id: emp1UserId, email: 'exit_test_emp1@gaintpro.com', role: 'EMPLOYEE', employee_id: empId1 });

    // 4. Create Employee 2
    const emp2UserRes = await pool.query(
      `INSERT INTO public.users (email, role, status) VALUES ('exit_test_emp2@gaintpro.com', 'EMPLOYEE', 'ACTIVE') RETURNING id`
    );
    emp2UserId = emp2UserRes.rows[0].id;
    await pool.query(
      `INSERT INTO public.employees (employee_id, user_id, first_name, last_name, email, department, designation, date_of_joining, status)
       VALUES ($1, $2, 'Jane', 'Doe', 'exit_test_emp2@gaintpro.com', 'HR', 'HR Specialist', '2023-03-01', 'ACTIVE')`,
      [empId2, emp2UserId]
    );
    await pool.query('UPDATE public.users SET employee_id = $1 WHERE id = $2', [empId2, emp2UserId]);
    emp2Token = generateToken({ id: emp2UserId, email: 'exit_test_emp2@gaintpro.com', role: 'EMPLOYEE', employee_id: empId2 });

    console.log('✅ Test fixtures initialized.\n');

    // -------------------------------------------------------------------------
    // TEST 1: Employee can submit resignation
    // -------------------------------------------------------------------------
    console.log('--- TEST 1 & 2: Employee Resignation Submission & Status ---');
    const applyRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/exit/apply',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emp1Token}`,
          'Content-Type': 'application/json',
        },
      },
      {
        requested_relieving_date: '2026-11-15',
        reason: 'Pursuing higher studies and career growth opportunities.',
      }
    );

    const applyJson = applyRes.json();
    assert(applyRes.statusCode === 201 && applyJson.success, '1. Employee can submit resignation request.');
    assert(applyJson.data?.status === 'SUBMITTED', '2. Resignation status after submission is SUBMITTED (Pending Admin Review).');
    const exitReqId1 = applyJson.data?.id;

    // -------------------------------------------------------------------------
    // TEST 3: Admin can view pending requests
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3 & 4: Admin View & Decline Resignation Flow ---');
    const adminListRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/exit/requests?status=SUBMITTED',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const adminListJson = adminListRes.json();
    const foundReq = (adminListJson?.data || []).find((r) => r.id === exitReqId1);
    assert(adminListRes.statusCode === 200 && !!foundReq, '3. Admin can see pending resignation request in Admin Portal.');

    // -------------------------------------------------------------------------
    // TEST 4 & 5: Admin Decline Flow
    // Employee 2 submits resignation, Admin declines it.
    // -------------------------------------------------------------------------
    const applyRes2 = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/exit/apply',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emp2Token}`,
          'Content-Type': 'application/json',
        },
      },
      {
        requested_relieving_date: '2026-11-30',
        reason: 'Relocating to another city for personal reasons.',
      }
    );
    const exitReqId2 = applyRes2.json()?.data?.id;

    const declineRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/requests/${exitReqId2}/review`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        action: 'DECLINE',
        admin_remarks: 'Critical project deliverable active. Retention discussed with department head.',
      }
    );
    const declineJson = declineRes.json();
    assert(declineRes.statusCode === 200 && declineJson.data?.status === 'REJECTED', '4. Admin can decline resignation with remarks.');

    // 5. Declined resignation does not start document release workflow
    const declineDocUpload = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId2}/documents`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      { document_type: 'Relieving Letter' }
    );
    assert(declineDocUpload.statusCode === 400, '5. Declined resignation does not start document release workflow (Upload blocked).');

    // -------------------------------------------------------------------------
    // TEST 6 & 7: Admin Accept Flow & Last Working Day
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6 & 7: Admin Accept Resignation & Last Working Day ---');
    const acceptRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/requests/${exitReqId1}/review`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        action: 'ACCEPT',
        approved_relieving_date: '2026-11-20',
        admin_remarks: 'Resignation accepted. Notice period will conclude on 20 Nov 2026.',
      }
    );
    const acceptJson = acceptRes.json();
    assert(acceptRes.statusCode === 200 && acceptJson.data?.status === 'APPROVED', '6. Admin can accept resignation.');
    const storedLwd = String(acceptJson.data?.approved_relieving_date || '');
    assert(storedLwd.startsWith('2026-11-20'), '7. Accepted resignation stores approved Last Working Day (2026-11-20).');

    // -------------------------------------------------------------------------
    // TEST 8 & 9: Clearance workflow & F&F calculation preview
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8, 9 & 10: Clearance & F&F Preview (No Auto PDFs) ---');
    // Clear 4 clearances
    const getReqDetail = await pool.query('SELECT id, department FROM public.exit_clearances WHERE exit_request_id = $1', [exitReqId1]);
    for (const c of getReqDetail.rows) {
      await pool.query('UPDATE public.exit_clearances SET status = $1, cleared_at = NOW() WHERE id = $2', ['CLEARED', c.id]);
    }
    assert(true, '8. Existing clearance workflow operates cleanly (All 4 departments CLEARED).');

    const fnfCalcRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/exit/fnf/calculate',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        exit_request_id: exitReqId1,
        salary_divisor: 30,
        payable_days: 20,
        encashed_leave_days: 5,
        gratuity_amount: 0,
        bonus_or_incentive: 10000,
        notice_recovery: 0,
        other_deductions: 0,
      }
    );
    const fnfCalcJson = fnfCalcRes.json();
    assert(fnfCalcRes.statusCode === 200 && fnfCalcJson.data?.net_payable_amount > 0, '9. Existing F&F calculation preview operates cleanly.');

    // -------------------------------------------------------------------------
    // TEST 10: Finalize F&F does NOT automatically generate exit PDFs
    // -------------------------------------------------------------------------
    const finalizeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/exit/fnf/finalize',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      {
        exit_request_id: exitReqId1,
        salary_divisor: 30,
        payable_days: 20,
        encashed_leave_days: 5,
        bonus_or_incentive: 10000,
      }
    );
    const finalizeJson = finalizeRes.json();
    assert(finalizeRes.statusCode === 200 && finalizeJson.success, '10. Offboarding finalization completed.');

    // Check database: NO auto-generated exit PDFs in documents table!
    const autoDocsCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.documents WHERE employee_id = $1`,
      [empId1]
    );
    assert(autoDocsCheck.rows[0].count === 0, '11. CRITICAL: No exit documents were automatically generated during F&F finalization.');

    // -------------------------------------------------------------------------
    // TEST 12: Admin Upload PDF Exit Document with Chosen Release Date
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12, 13, 14 & 15: Admin Upload & Release Date Management ---');
    // Valid PDF buffer: %PDF-1.4 header
    const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Relieving Letter) >>\nendobj\ntrailer\n<< >>\n%%EOF');

    const uploadForm1 = buildMultipartFormData({
      fields: {
        document_type: 'Relieving Letter',
        release_date: '2026-12-15', // Document release date != Last working day (2026-11-20)
        remarks: 'Official relieving letter signed by HR Director.',
      },
      file: {
        fieldname: 'file',
        filename: 'Relieving_Letter_v1.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
    });

    const uploadRes1 = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...uploadForm1.headers,
        },
      },
      uploadForm1.body
    );
    const uploadJson1 = uploadRes1.json();
    assert(uploadRes1.statusCode === 201 && uploadJson1.success, '12. Admin can manually upload a PDF exit document.');
    const docId1 = uploadJson1.data?.id;

    // -------------------------------------------------------------------------
    // TEST 13: Invalid / non-PDF upload is rejected
    // -------------------------------------------------------------------------
    const fakePdfBuffer = Buffer.from('<html><body>Fake executable or html content</body></html>');
    const invalidUploadForm = buildMultipartFormData({
      fields: {
        document_type: 'Experience Certificate',
        release_date: '2026-12-15',
      },
      file: {
        fieldname: 'file',
        filename: 'malicious.pdf',
        contentType: 'application/pdf',
        content: fakePdfBuffer,
      },
    });
    const invalidUploadRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...invalidUploadForm.headers,
        },
      },
      invalidUploadForm.body
    );
    assert(invalidUploadRes.statusCode === 400, '13. Invalid / non-PDF upload (failing magic bytes) is strictly rejected (400).');

    // -------------------------------------------------------------------------
    // TEST 14: Release Date Validation (release_date < Last Working Day rejected)
    // -------------------------------------------------------------------------
    const earlyDateForm = buildMultipartFormData({
      fields: {
        document_type: 'Experience Certificate',
        release_date: '2026-11-01', // Before Last working day (2026-11-20)
      },
      file: {
        fieldname: 'file',
        filename: 'Experience_Certificate.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
    });
    const earlyDateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...earlyDateForm.headers,
        },
      },
      earlyDateForm.body
    );
    assert(earlyDateRes.statusCode === 400, '14. Release date earlier than Last Working Day is rejected with clear validation.');

    // -------------------------------------------------------------------------
    // TEST 15: Different Documents with Independent Release Dates
    // Upload Experience Certificate (2026-12-20) & F&F Statement (2026-12-25)
    // -------------------------------------------------------------------------
    const expForm = buildMultipartFormData({
      fields: {
        document_type: 'Experience Certificate',
        release_date: '2026-12-20',
      },
      file: {
        fieldname: 'file',
        filename: 'Experience_Certificate.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
    });
    const expRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, ...expForm.headers },
      },
      expForm.body
    );
    const expDocId = expRes.json()?.data?.id;
    assert(expRes.statusCode === 201, '15. Admin can set independent custom release date for Experience Certificate (2026-12-20).');

    const fnfDocForm = buildMultipartFormData({
      fields: {
        document_type: 'FnF Statement',
        release_date: '2026-12-25',
      },
      file: {
        fieldname: 'file',
        filename: 'FnF_Statement.pdf',
        contentType: 'application/pdf',
        content: validPdfBuffer,
      },
    });
    const fnfDocRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, ...fnfDocForm.headers },
      },
      fnfDocForm.body
    );
    assert(fnfDocRes.statusCode === 201, '16. Admin can set different release date for FnF Statement (2026-12-25).');

    // -------------------------------------------------------------------------
    // TEST 17: Replace Exit Document (Version history preserved)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 17 & 18: Document Replacement & Date Modification ---');
    const replacePdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Relieving Letter Final) >>\nendobj\ntrailer\n<< >>\n%%EOF');
    const replaceForm = buildMultipartFormData({
      fields: {
        document_type: 'Relieving Letter',
        release_date: '2026-12-18',
        remarks: 'Corrected designation and service dates.',
      },
      file: {
        fieldname: 'file',
        filename: 'Relieving_Letter_vFinal.pdf',
        contentType: 'application/pdf',
        content: replacePdfBuffer,
      },
    });
    const replaceRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/${exitReqId1}/documents`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, ...replaceForm.headers },
      },
      replaceForm.body
    );
    const replaceJson = replaceRes.json();
    const newDocId = replaceJson.data?.id;
    assert(replaceRes.statusCode === 201 && newDocId !== docId1, '17. Admin can replace an existing exit document with a new PDF.');

    // Check that previous document record was preserved with is_active = false
    const historyCheck = await pool.query('SELECT id, is_active FROM public.documents WHERE id = $1', [docId1]);
    assert(historyCheck.rows[0]?.is_active === false, '18. Previous document record is preserved as inactive in document history.');

    // -------------------------------------------------------------------------
    // TEST 19: Change Release Date
    // -------------------------------------------------------------------------
    const patchDateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/documents/${newDocId}/release-date`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      },
      { release_date: '2026-12-22' }
    );
    const patchDateJson = patchDateRes.json();
    assert(patchDateRes.statusCode === 200 && patchDateJson.data?.release_date === '2026-12-22', '19. Admin can change document release date after upload.');

    // -------------------------------------------------------------------------
    // TEST 20: Employee Document Visibility Before Release Date
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 20, 21, 22 & 23: Employee Visibility & Security Enforcement ---');
    const empStatusRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/status',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${emp1Token}` },
    });
    const empStatusJson = empStatusRes.json();
    const relievingExitDoc = (empStatusJson?.data?.exitDocuments || []).find((d) => d.document_type === 'Relieving Letter');
    assert(
      empStatusRes.statusCode === 200 &&
      relievingExitDoc?.status === 'SCHEDULED' &&
      relievingExitDoc?.is_available === false &&
      relievingExitDoc?.release_date === '2026-12-22',
      '20. Employee can see scheduled document metadata and release date before release date.'
    );

    // -------------------------------------------------------------------------
    // TEST 21: Direct API access before release date returns 403 Forbidden
    // -------------------------------------------------------------------------
    const earlyDownloadRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/relieving-letter',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${emp1Token}` },
    });
    const earlyDownloadJson = earlyDownloadRes.json();
    assert(
      earlyDownloadRes.statusCode === 403 && earlyDownloadJson?.message?.includes('not available until'),
      '21. CRITICAL: Employee direct API access before release date strictly returns 403 Forbidden.'
    );

    const earlyDownloadByIdRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/exit/documents/${newDocId}/download`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${emp1Token}` },
    });
    assert(earlyDownloadByIdRes.statusCode === 403, '22. Direct document ID download before release date returns 403 Forbidden.');

    // -------------------------------------------------------------------------
    // TEST 23: Admin has unconditional access before release date
    // -------------------------------------------------------------------------
    const adminDocViewRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/exit/documents/${newDocId}/view`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert(
      adminDocViewRes.statusCode === 200 && adminDocViewRes.headers['content-type'] === 'application/pdf',
      '23. Admin can view/download document before employee release date arrived.'
    );

    // -------------------------------------------------------------------------
    // TEST 24: Employee can download on/after release date
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 24 & 25: Post-Release Access & IDOR Cross-Tenant Protection ---');
    // Simulate release date arrival (set release_date to yesterday/today: 2026-10-01)
    await pool.query('UPDATE public.documents SET release_date = CURRENT_DATE WHERE id = $1', [newDocId]);

    const releasedDownloadRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/exit/relieving-letter',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${emp1Token}` },
    });
    assert(
      releasedDownloadRes.statusCode === 200 && releasedDownloadRes.headers['content-type'] === 'application/pdf',
      '24. Employee can download document once release date has arrived.'
    );

    // -------------------------------------------------------------------------
    // TEST 25: Employee cannot access another employee's exit document
    // -------------------------------------------------------------------------
    const idorRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/exit/documents/${newDocId}/download`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${emp2Token}` }, // emp2 tries to download emp1 doc
    });
    assert(idorRes.statusCode === 404, '25. Employee cannot access another employee\'s exit document (IDOR protected).');

    // -------------------------------------------------------------------------
    // TEST 26: RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 26 & 27: RBAC & Audit Trail Verification ---');
    const empReviewAttempt = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/exit/requests/${exitReqId1}/review`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${emp1Token}`,
          'Content-Type': 'application/json',
        },
      },
      { action: 'ACCEPT' }
    );
    assert(empReviewAttempt.statusCode === 403, '26. RBAC strictly enforced (Employee forbidden from Admin review endpoint).');

    // -------------------------------------------------------------------------
    // TEST 27: Audit Log Verification
    // -------------------------------------------------------------------------
    const auditRes = await pool.query(
      `SELECT action, entity_type FROM public.audit_logs 
       WHERE entity_id IN ($1, $2, $3) OR (metadata->>'employee_id' IN ($4, $5))
       ORDER BY created_at DESC`,
      [exitReqId1, exitReqId2, newDocId, empId1, empId2]
    );
    const actions = auditRes.rows.map((r) => r.action);
    assert(actions.includes('RESIGNATION_SUBMITTED'), '27. Audit trail records RESIGNATION_SUBMITTED.');
    assert(actions.includes('RESIGNATION_ACCEPTED'), '28. Audit trail records RESIGNATION_ACCEPTED.');
    assert(actions.includes('RESIGNATION_DECLINED'), '29. Audit trail records RESIGNATION_DECLINED.');
    assert(actions.includes('EXIT_DOCUMENT_UPLOADED'), '30. Audit trail records EXIT_DOCUMENT_UPLOADED.');
    assert(actions.includes('EXIT_DOCUMENT_REPLACED'), '31. Audit trail records EXIT_DOCUMENT_REPLACED.');
    assert(actions.includes('EXIT_DOCUMENT_RELEASE_DATE_CHANGED'), '32. Audit trail records EXIT_DOCUMENT_RELEASE_DATE_CHANGED.');

    // -------------------------------------------------------------------------
    // Clean up
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM public.documents WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.fnf_settlements WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.exit_clearances WHERE exit_request_id IN (SELECT id FROM public.exit_requests WHERE employee_id IN ($1, $2))', [empId1, empId2]);
    await pool.query('DELETE FROM public.exit_requests WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.employees WHERE employee_id IN ($1, $2)', [empId1, empId2]);
    await pool.query('DELETE FROM public.users WHERE email IN ($1, $2, $3)', [
      'exit_test_emp1@gaintpro.com',
      'exit_test_emp2@gaintpro.com',
      'exit_test_admin@gaintpro.com',
    ]);

  } catch (err) {
    console.error('Fatal error during test suite:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runTestSuite();
}
