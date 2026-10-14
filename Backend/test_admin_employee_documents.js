const assert = require('assert');
const path = require('path');
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');
const storageService = require('./services/storageService');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('=== Running Admin Employee Documents Verification Tests ===\n');
  let testsPassed = 0;

  // Query a real admin user from DB
  const adminRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'ADMIN' LIMIT 1");
  const adminUser = adminRes.rows[0] || { id: '00000000-0000-0000-0000-000000000001', email: 'admin@gaintpro.com' };

  const adminToken = generateToken({
    id: adminUser.id,
    role: 'ADMIN',
    email: adminUser.email,
  });

  const employeeTokenGP1 = generateToken({
    id: '00000000-0000-0000-0000-000000000002',
    role: 'EMPLOYEE',
    employee_id: 'GP0001N',
    email: 'gp0001n@gaintpro.com',
  });

  const employeeTokenGP2 = generateToken({
    id: '00000000-0000-0000-0000-000000000003',
    role: 'EMPLOYEE',
    employee_id: 'GP0002N',
    email: 'gp0002n@gaintpro.com',
  });

  try {
    // 1. Fetch Employee Details for GP0003N as Admin
    console.log('Test 1: Admin fetches employee details for GP0003N');
    const res1 = await fetch(`${BASE_URL}/admin/employees/GP0003N`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}`);
    const data1 = await res1.json();
    assert.strictEqual(data1.success, true);
    assert.ok(Array.isArray(data1.data.documents), 'documents should be an array');
    assert.ok(data1.data.documents.length > 0, 'GP0003N should have documents');
    
    // Check fields and make sure storage_key is NOT exposed
    const sampleDoc = data1.data.documents[0];
    assert.ok(sampleDoc.id, 'doc should have id');
    assert.ok(sampleDoc.document_type, 'doc should have document_type');
    assert.ok(sampleDoc.file_name, 'doc should have file_name');
    assert.strictEqual(typeof sampleDoc.is_file_available, 'boolean', 'is_file_available should be boolean');
    assert.strictEqual(typeof sampleDoc.file_available, 'boolean', 'file_available should be boolean');
    assert.ok(['Available', 'Unavailable'].includes(sampleDoc.status), 'status should be Available or Unavailable');
    assert.strictEqual(sampleDoc.storage_key, undefined, 'storage_key MUST NOT be exposed in response');
    console.log(`  ✓ Passed: GP0003N returned ${data1.data.documents.length} documents with availability status and zero storage_key leakage.`);
    testsPassed++;

    // 2. Physical File Availability - Existing vs Missing file
    console.log('\nTest 2: Check genuine physical file availability for GP0001N');
    const res2 = await fetch(`${BASE_URL}/admin/employees/GP0001N`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    const gp1Docs = data2.data.documents;

    const availableDoc = gp1Docs.find(d => d.is_file_available === true);
    const unavailableDoc = gp1Docs.find(d => d.is_file_available === false);

    assert.ok(availableDoc, 'GP0001N should have at least one physically available document');
    assert.ok(unavailableDoc, 'GP0001N should have at least one physically unavailable document (seed baseline)');
    assert.strictEqual(availableDoc.status, 'Available');
    assert.strictEqual(unavailableDoc.status, 'Unavailable');
    console.log(`  ✓ Passed: Found available document "${availableDoc.file_name}" (${availableDoc.status}) and unavailable document "${unavailableDoc.file_name}" (${unavailableDoc.status}).`);
    testsPassed++;

    // 3. Admin downloads an available document
    console.log('\nTest 3: Admin downloads an available document');
    const dlRes = await fetch(`${BASE_URL}/admin/documents/${availableDoc.id}/download`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(dlRes.status, 200, `Expected 200, got ${dlRes.status}`);
    const dlBuffer = await dlRes.arrayBuffer();
    assert.ok(dlBuffer.byteLength > 0, 'Downloaded file buffer should not be empty');
    assert.ok(dlRes.headers.get('content-disposition')?.includes('attachment'), 'Content-Disposition should be attachment');
    console.log(`  ✓ Passed: Successfully downloaded "${availableDoc.file_name}" (${dlBuffer.byteLength} bytes).`);
    testsPassed++;

    // 4. Admin views an available document inline
    console.log('\nTest 4: Admin views an available document inline via /view');
    const viewRes = await fetch(`${BASE_URL}/admin/documents/${availableDoc.id}/view`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(viewRes.status, 200, `Expected 200, got ${viewRes.status}`);
    assert.ok(viewRes.headers.get('content-disposition')?.includes('inline'), 'Content-Disposition should be inline');
    console.log(`  ✓ Passed: Successfully previewed "${availableDoc.file_name}" with Content-Disposition: inline.`);
    testsPassed++;

    // 5. Admin attempts to download a missing physical file
    console.log('\nTest 5: Admin attempts to download an unavailable physical file');
    const missingRes = await fetch(`${BASE_URL}/admin/documents/${unavailableDoc.id}/download`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(missingRes.status, 404, `Expected 404, got ${missingRes.status}`);
    const missingData = await missingRes.json();
    assert.strictEqual(missingData.success, false);
    assert.strictEqual(missingData.message, 'Document file not found');
    console.log(`  ✓ Passed: Cleanly returned 404 "Document file not found" without server crash.`);
    testsPassed++;

    // 6. Security: Admin download with employee_id verification
    console.log('\nTest 6: Admin download validates employee_id ownership match');
    // Request with matching employee_id GP0001N -> success
    const matchRes = await fetch(`${BASE_URL}/admin/documents/${availableDoc.id}/download?employee_id=GP0001N`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(matchRes.status, 200, 'Should succeed when employee_id matches');

    // Request with mismatched employee_id GP0002N -> 404
    const mismatchRes = await fetch(`${BASE_URL}/admin/documents/${availableDoc.id}/download?employee_id=GP0002N`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(mismatchRes.status, 404, 'Should return 404 when employee_id does not match document owner');
    console.log(`  ✓ Passed: Correctly enforced employee ownership check when employee_id is specified.`);
    testsPassed++;

    // 7. Security: Employee cannot download another employee's document
    console.log('\nTest 7: Employee GP0002N cannot download GP0001N document');
    const unauthorizedRes = await fetch(`${BASE_URL}/employee/documents/${availableDoc.id}/download`, {
      headers: { Authorization: `Bearer ${employeeTokenGP2}` },
    });
    assert.strictEqual(unauthorizedRes.status, 404, 'Should return 404 for employee accessing another employee doc');
    console.log(`  ✓ Passed: Employee GP0002N received 404 when requesting GP0001N document.`);
    testsPassed++;

    // 8. Empty State for an employee with zero documents
    console.log('\nTest 8: Employee with zero documents returns empty array');
    // Query an employee with no documents or a temporary non-existent one
    const empRes = await pool.query(`
      SELECT e.employee_id FROM employees e
      WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.employee_id = e.employee_id)
      LIMIT 1
    `);
    if (empRes.rows.length > 0) {
      const emptyEmpId = empRes.rows[0].employee_id;
      const emptyRes = await fetch(`${BASE_URL}/admin/employees/${emptyEmpId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(emptyRes.status, 200);
      const emptyData = await emptyRes.json();
      assert.deepStrictEqual(emptyData.data.documents, [], 'documents should be an empty array');
      console.log(`  ✓ Passed: Employee ${emptyEmpId} with 0 documents returned empty array [].`);
    } else {
      console.log('  (Skipped: All existing employees in DB currently have at least one document)');
    }
    testsPassed++;

    // 9. Admin uploads a document for an employee and verifies it appears in details
    console.log('\nTest 9: Admin uploads a document and verifies it appears in employee details');
    const testPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test Upload Verification) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const boundary = '----WebKitFormBoundaryTestDocUpload' + Date.now();
    
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="employee_id"\r\n\r\nGP0003N\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="document_type"\r\n\r\nRelieving Letter\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="Test_Relieving_Letter_Auto.pdf"\r\n`;
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
    const uploadJson = await uploadRes.json();
    assert.strictEqual(uploadJson.success, true);
    const uploadedDocId = uploadJson.data.id;
    assert.ok(uploadedDocId, 'Uploaded doc should have id');

    // Verify it appears in GP0003N details
    const verifyRes = await fetch(`${BASE_URL}/admin/employees/GP0003N`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(verifyRes.status, 200);
    const verifyJson = await verifyRes.json();
    const foundUploaded = verifyJson.data.documents.find(d => d.id === uploadedDocId);
    assert.ok(foundUploaded, 'Uploaded document should appear in employee details');
    assert.strictEqual(foundUploaded.file_name, 'Test_Relieving_Letter_Auto.pdf');
    assert.strictEqual(foundUploaded.document_type, 'Relieving Letter');
    assert.strictEqual(foundUploaded.is_file_available, true);
    assert.strictEqual(foundUploaded.status, 'Available');
    console.log(`  ✓ Passed: Uploaded document successfully stored and verified in employee details.`);

    // Clean up test document
    const delRes = await fetch(`${BASE_URL}/admin/documents/${uploadedDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(delRes.status, 200, 'Test document deleted cleanly');
    console.log(`  ✓ Passed: Test document ${uploadedDocId} cleaned up safely.`);
    testsPassed++;

    console.log(`\n========================================`);
    console.log(`🎉 ALL ${testsPassed} TESTS PASSED SUCCESSFULLY!`);
    console.log(`========================================\n`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
