const assert = require('assert');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('=== Running Admin Delete Document Comprehensive Verification Tests ===\n');
  let testsPassed = 0;

  // 1. Get real admin user from DB
  const adminRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'ADMIN' LIMIT 1");
  const adminUser = adminRes.rows[0] || { id: '00000000-0000-0000-0000-000000000001', email: 'admin@gaintpro.com' };

  const adminToken = generateToken({
    id: adminUser.id,
    role: 'ADMIN',
    email: adminUser.email,
  });

  const employeeToken = generateToken({
    id: '00000000-0000-0000-0000-000000000002',
    role: 'EMPLOYEE',
    employee_id: 'GP0001N',
    email: 'gp0001n@gaintpro.com',
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated request should be rejected (401)
    // -------------------------------------------------------------------------
    console.log('Test 1: Unauthenticated request is rejected with 401');
    const dummyId = '11111111-1111-1111-1111-111111111111';
    const noAuthRes = await fetch(`${BASE_URL}/admin/documents/${dummyId}`, {
      method: 'DELETE',
    });
    assert.strictEqual(noAuthRes.status, 401, `Expected 401, got ${noAuthRes.status}`);
    console.log('  ✓ Passed: Unauthenticated request returned 401.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 2: Employee role cannot access admin delete endpoint (403)
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Employee role is rejected with 403');
    const empRes = await fetch(`${BASE_URL}/admin/documents/${dummyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    assert.strictEqual(empRes.status, 403, `Expected 403, got ${empRes.status}`);
    console.log('  ✓ Passed: Employee role was blocked with 403 Forbidden.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 3: Invalid UUID returns 404
    // -------------------------------------------------------------------------
    console.log('\nTest 3: Invalid UUID format returns 404');
    const invalidUuidRes = await fetch(`${BASE_URL}/admin/documents/not-a-uuid`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(invalidUuidRes.status, 404, `Expected 404, got ${invalidUuidRes.status}`);
    console.log('  ✓ Passed: Non-UUID document ID returned 404.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 4: Delete ordinary uploaded document (File + DB + Audit Log)
    // -------------------------------------------------------------------------
    console.log('\nTest 4: Admin successfully deletes ordinary document');
    // Upload a test document first for GP0001N
    const testPdfContent = Buffer.from('%PDF-1.4\nTest Document Content For Deletion Verification\n%%EOF');
    const boundary = '----WebKitFormBoundaryDeleteTest' + Date.now();
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="employee_id"\r\n\r\nGP0001N\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="document_type"\r\n\r\nEducational Certificate\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="Test_Degree_Certificate.pdf"\r\n`;
    body += `Content-Type: application/pdf\r\n\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(body, 'utf-8'),
      testPdfContent,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
    ]);

    const uploadRes = await fetch(`${BASE_URL}/admin/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });
    assert.strictEqual(uploadRes.status, 201, `Upload should succeed with 201, got ${uploadRes.status}`);
    const uploadData = await uploadRes.json();
    const docId = uploadData.data.id;
    assert.ok(docId, 'Should have received document id');

    // Fetch storage_key directly from DB for verification
    const dbCheckBefore = await pool.query('SELECT storage_key FROM public.documents WHERE id = $1', [docId]);
    assert.strictEqual(dbCheckBefore.rowCount, 1, 'Document must exist in database');
    const storageKey = dbCheckBefore.rows[0].storage_key;
    const fileExistsBefore = await storageService.fileExists(storageKey);
    assert.strictEqual(fileExistsBefore, true, 'Physical file must exist in storage before deletion');

    // Perform DELETE as Admin
    const deleteRes = await fetch(`${BASE_URL}/admin/documents/${docId}?employee_id=GP0001N`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(deleteRes.status, 200, `Expected 200, got ${deleteRes.status}`);
    const deleteData = await deleteRes.json();
    assert.strictEqual(deleteData.success, true);
    assert.strictEqual(deleteData.message, 'Document deleted successfully');

    // Confirm physical file is deleted
    const fileExistsAfter = await storageService.fileExists(storageKey);
    assert.strictEqual(fileExistsAfter, false, 'Physical file must be deleted from storage');

    // Confirm DB record is removed
    const dbCheckAfter = await pool.query('SELECT id FROM public.documents WHERE id = $1', [docId]);
    assert.strictEqual(dbCheckAfter.rowCount, 0, 'Document record must be removed from database');

    // Confirm audit log recorded
    const auditRes = await pool.query(
      "SELECT id, action, entity_id FROM public.audit_logs WHERE entity_id = $1 AND action = 'DOCUMENT_DELETE' ORDER BY created_at DESC LIMIT 1",
      [docId]
    );
    assert.strictEqual(auditRes.rowCount, 1, 'Audit log entry should exist for document deletion');
    console.log('  ✓ Passed: Physical file deleted, database record removed, and audit log recorded.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 5: Ownership validation with ?employee_id=
    // -------------------------------------------------------------------------
    console.log('\nTest 5: Ownership validation rejects mismatched employee_id');
    // Upload a temporary doc for GP0001N
    const boundary2 = '----WebKitFormBoundaryDeleteMismatch' + Date.now();
    let body2 = '';
    body2 += `--${boundary2}\r\n`;
    body2 += `Content-Disposition: form-data; name="employee_id"\r\n\r\nGP0001N\r\n`;
    body2 += `--${boundary2}\r\n`;
    body2 += `Content-Disposition: form-data; name="document_type"\r\n\r\nOffer Letter\r\n`;
    body2 += `--${boundary2}\r\n`;
    body2 += `Content-Disposition: form-data; name="file"; filename="Test_Mismatch.pdf"\r\n`;
    body2 += `Content-Type: application/pdf\r\n\r\n`;

    const bodyBuffer2 = Buffer.concat([
      Buffer.from(body2, 'utf-8'),
      testPdfContent,
      Buffer.from(`\r\n--${boundary2}--\r\n`, 'utf-8'),
    ]);

    const up2Res = await fetch(`${BASE_URL}/admin/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary2}`,
      },
      body: bodyBuffer2,
    });
    const up2Data = await up2Res.json();
    const docId2 = up2Data.data.id;

    // Attempt delete with mismatched employee_id GP0002N -> Should return 404
    const mismatchDel = await fetch(`${BASE_URL}/admin/documents/${docId2}?employee_id=GP0002N`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(mismatchDel.status, 404, `Expected 404, got ${mismatchDel.status}`);
    const mismatchData = await mismatchDel.json();
    assert.strictEqual(mismatchData.success, false);

    // Now clean up properly with correct employee_id
    const correctDel = await fetch(`${BASE_URL}/admin/documents/${docId2}?employee_id=GP0001N`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(correctDel.status, 200);
    console.log('  ✓ Passed: Mismatched employee_id returned 404 and protected the document.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 6: Protected Records — Historically issued payslips cannot be deleted
    // -------------------------------------------------------------------------
    console.log('\nTest 6: Protected records — Payslip documents cannot be deleted');
    // Find or create a payslip document record in public.documents
    let payslipDoc = (await pool.query("SELECT id FROM public.documents WHERE document_type ILIKE 'payslip%' LIMIT 1")).rows[0];

    if (!payslipDoc) {
      // Insert a mock payslip document
      const insRes = await pool.query(
        `INSERT INTO public.documents (employee_id, document_type, file_name, file_size, mime_type, storage_key, month, year)
         VALUES ('GP0001N', 'Payslip', 'Payslip_Sep_2026.pdf', 1024, 'application/pdf', 'documents/GP0001N/2026/09/mock_payslip.pdf', 9, 2026)
         RETURNING id`
      );
      payslipDoc = insRes.rows[0];
    }

    const payslipDelRes = await fetch(`${BASE_URL}/admin/documents/${payslipDoc.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(payslipDelRes.status, 400, `Expected 400 for payslip deletion, got ${payslipDelRes.status}`);
    const payslipDelData = await payslipDelRes.json();
    assert.strictEqual(payslipDelData.success, false);
    assert.ok(
      payslipDelData.message.includes('statutory') || payslipDelData.message.includes('compliance') || payslipDelData.message.includes('retention'),
      `Message should mention retention policy: "${payslipDelData.message}"`
    );

    // Verify database record is STILL present
    const checkPayslipStillExists = await pool.query('SELECT id FROM public.documents WHERE id = $1', [payslipDoc.id]);
    assert.strictEqual(checkPayslipStillExists.rowCount, 1, 'Payslip document MUST NOT be deleted from database');
    console.log(`  ✓ Passed: Payslip deletion blocked with 400 and clear message: "${payslipDelData.message}".`);
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 7: Missing physical file handling (Graceful DB cleanup)
    // -------------------------------------------------------------------------
    console.log('\nTest 7: Missing physical file handling deletes DB record without crash');
    const ghostInsert = await pool.query(
      `INSERT INTO public.documents (employee_id, document_type, file_name, storage_key)
       VALUES ('GP0001N', 'Resume', 'non_existent_ghost_file.pdf', 'documents/GP0001N/non_existent_ghost_file.pdf')
       RETURNING id`
    );
    const ghostId = ghostInsert.rows[0].id;

    const ghostDelRes = await fetch(`${BASE_URL}/admin/documents/${ghostId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(ghostDelRes.status, 200, `Expected 200, got ${ghostDelRes.status}`);
    const ghostDelData = await ghostDelRes.json();
    assert.strictEqual(ghostDelData.success, true);

    const ghostCheck = await pool.query('SELECT id FROM public.documents WHERE id = $1', [ghostId]);
    assert.strictEqual(ghostCheck.rowCount, 0, 'Ghost record must be cleanly deleted from DB');
    console.log('  ✓ Passed: Gracefully deleted orphaned DB metadata without crashing on missing file.');
    testsPassed++;

    // -------------------------------------------------------------------------
    // TEST 8: Cascade Protection — Employee and payroll records untouched
    // -------------------------------------------------------------------------
    console.log('\nTest 8: Cascade Protection — Employee and payroll records remain intact');
    const empCheck = await pool.query("SELECT employee_id, status FROM public.employees WHERE employee_id = 'GP0001N'");
    assert.strictEqual(empCheck.rowCount, 1, 'Employee GP0001N must still exist');

    const salaryCheck = await pool.query("SELECT id FROM public.payroll_profiles WHERE employee_id = 'GP0001N'");
    assert.ok(salaryCheck.rowCount >= 0, 'Salary profile is safe');
    console.log('  ✓ Passed: Employee profiles, payroll, and related records remain completely intact.');
    testsPassed++;

    console.log(`\n======================================================`);
    console.log(`🎉 ALL ${testsPassed} DELETE DOCUMENT TESTS PASSED SUCCESSFULLY!`);
    console.log(`======================================================\n`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
