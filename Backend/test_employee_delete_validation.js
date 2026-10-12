/**
 * Test Suite: Employee Permanent Delete Validation & Safeguards
 * Tests:
 * 1. Mismatching confirmation ID rejection (HTTP 400)
 * 2. Missing confirmation ID rejection (HTTP 400)
 * 3. Unchecked confirmation checkbox rejection (HTTP 400)
 * 4. Whitespace trimming and case-insensitive matching ("  gp...  " vs "GP...")
 * 5. Non-admin role forbidden (HTTP 403)
 * 6. Successful permanent deletion when exact ID matches & checkbox is checked (HTTP 200)
 * 7. Audit log recorded for deletion operation
 * 8. Frontend validation unit tests (matching/mismatching IDs, casing, whitespace, checkbox state)
 */

const assert = require('assert');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

const BASE_URL = 'http://localhost:5000/api';

async function makeRequest({ method, path, headers = {}, body = null }) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, options);
  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data,
  };
}

async function createTestEmployee(empId, email) {
  const userRes = await pool.query(
    `INSERT INTO public.users (email, role, status)
     VALUES ($1, 'EMPLOYEE', 'ACTIVE')
     RETURNING id`,
    [email]
  );
  const userId = userRes.rows[0].id;

  await pool.query(
    `INSERT INTO public.employees (employee_id, user_id, first_name, last_name, email, phone, date_of_joining, designation, department, status)
     VALUES ($1, $2, 'Test', 'DeleteUser', $3, '9876543210', CURRENT_DATE, 'QA Engineer', 'Technology', 'Active')`,
    [empId, userId, email]
  );

  await pool.query(
    `UPDATE public.users SET employee_id = $1 WHERE id = $2`,
    [empId, userId]
  );

  return { userId, empId, email };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Starting Employee Permanent Delete Validation Test Suite');
  console.log('================================================================\n');

  // Obtain admin credentials for testing
  const adminRes = await pool.query(
    `SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1`
  );
  assert(adminRes.rows.length > 0, 'At least one active admin must exist');
  const adminUser = adminRes.rows[0];
  const adminToken = generateToken({
    userId: adminUser.id,
    role: 'ADMIN',
    email: adminUser.email,
  });

  const empToken = generateToken({
    userId: '00000000-0000-0000-0000-000000000099',
    role: 'EMPLOYEE',
    email: 'forbidden.employee@gaintpro.com',
  });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Frontend validation logic test
    // -------------------------------------------------------------------------
    console.log('Test 1: Frontend helper validation logic (matching, whitespace, case, checkbox)');
    const validateDeletion = (empRecord, inputId, isChecked, isDeleting = false) => {
      const targetEmpId = String(
        empRecord?.employee_id ||
        empRecord?.employeeId ||
        empRecord?.id ||
        ''
      ).trim();
      const normalizedTargetEmpId = targetEmpId.toUpperCase();
      const typedConfirmEmpId = (inputId || '').trim();
      const normalizedTypedEmpId = typedConfirmEmpId.toUpperCase();
      const isEmpIdMatched = Boolean(normalizedTargetEmpId && normalizedTypedEmpId === normalizedTargetEmpId);
      const isDeleteEnabled = Boolean(isEmpIdMatched && isChecked && !isDeleting);
      return { targetEmpId, isEmpIdMatched, isDeleteEnabled };
    };

    const mockEmp1 = { employee_id: 'GP0004N', first_name: 'John' };
    const mockEmp2 = { employeeId: 'GP0005N', first_name: 'Jane' };
    const mockEmp3 = { id: 'GP0006N', first_name: 'Bob' };

    // Exact match & checked
    assert.strictEqual(validateDeletion(mockEmp1, 'GP0004N', true).isDeleteEnabled, true);
    // Lowercase & whitespace match
    assert.strictEqual(validateDeletion(mockEmp1, '  gp0004n  ', true).isDeleteEnabled, true);
    // Mismatch ID
    assert.strictEqual(validateDeletion(mockEmp1, 'GP9999N', true).isDeleteEnabled, false);
    assert.strictEqual(validateDeletion(mockEmp1, 'GP9999N', true).isEmpIdMatched, false);
    // Unchecked checkbox
    assert.strictEqual(validateDeletion(mockEmp1, 'GP0004N', false).isDeleteEnabled, false);
    assert.strictEqual(validateDeletion(mockEmp1, 'GP0004N', false).isEmpIdMatched, true);
    // Alternate record property names
    assert.strictEqual(validateDeletion(mockEmp2, 'gp0005n', true).isDeleteEnabled, true);
    assert.strictEqual(validateDeletion(mockEmp3, 'gp0006n', true).isDeleteEnabled, true);
    // While deleting (in-flight request)
    assert.strictEqual(validateDeletion(mockEmp1, 'GP0004N', true, true).isDeleteEnabled, false);
    console.log('  [PASS] Frontend validation simulation passed all scenarios.');

    // -------------------------------------------------------------------------
    // Test 2: Mismatched Employee ID rejected by API (400)
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Backend rejects mismatched confirmation Employee ID with HTTP 400');
    const emp1 = await createTestEmployee(`GPDEL1_${Date.now() % 100000}`, `emp1_${Date.now()}@test.com`);
    const resMismatch = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp1.empId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: 'INCORRECT_ID',
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resMismatch.statusCode, 400, `Expected 400, got ${resMismatch.statusCode}`);
    assert.strictEqual(resMismatch.data.success, false);
    assert(resMismatch.data.message.includes('does not match'), 'Message must explain mismatch');
    console.log('  [PASS] Mismatched confirmation ID correctly rejected with 400.');

    // -------------------------------------------------------------------------
    // Test 3: Unchecked confirmation checkbox rejected by API (400)
    // -------------------------------------------------------------------------
    console.log('\nTest 3: Backend rejects unchecked confirmation checkbox with HTTP 400');
    const resUnchecked = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp1.empId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: emp1.empId,
        confirmCheckbox: false,
      },
    });
    assert.strictEqual(resUnchecked.statusCode, 400, `Expected 400, got ${resUnchecked.statusCode}`);
    assert.strictEqual(resUnchecked.data.success, false);
    assert(resUnchecked.data.message.includes('checkbox'), 'Message must mention checkbox requirement');
    console.log('  [PASS] Unchecked confirmation checkbox correctly rejected with 400.');

    // -------------------------------------------------------------------------
    // Test 4: Missing confirmation Employee ID rejected by API (400)
    // -------------------------------------------------------------------------
    console.log('\nTest 4: Backend rejects empty confirmation Employee ID with HTTP 400');
    const resMissing = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp1.empId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: '',
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resMissing.statusCode, 400, `Expected 400, got ${resMissing.statusCode}`);
    assert.strictEqual(resMissing.data.success, false);
    console.log('  [PASS] Empty confirmation ID correctly rejected with 400.');

    // -------------------------------------------------------------------------
    // Test 5: Non-admin role forbidden (403)
    // -------------------------------------------------------------------------
    console.log('\nTest 5: Non-admin employee token receives HTTP 403');
    const resForbidden = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp1.empId}`,
      headers: { Authorization: `Bearer ${empToken}` },
      body: {
        confirmEmployeeId: emp1.empId,
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resForbidden.statusCode, 403, `Expected 403, got ${resForbidden.statusCode}`);
    console.log('  [PASS] Non-admin token properly forbidden with HTTP 403.');

    // -------------------------------------------------------------------------
    // Test 6: Whitespace and case-insensitive matching succeeds (HTTP 200)
    // -------------------------------------------------------------------------
    console.log('\nTest 6: Deletion succeeds with lowercase and padded whitespace confirmation');
    const paddedLowerId = `   ${emp1.empId.toLowerCase()}   `;
    const resSuccessCase = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp1.empId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: paddedLowerId,
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resSuccessCase.statusCode, 200, `Expected 200, got ${resSuccessCase.statusCode}`);
    assert.strictEqual(resSuccessCase.data.success, true);

    // Verify employee record and user record were removed
    const checkEmp1 = await pool.query('SELECT employee_id FROM public.employees WHERE employee_id = $1', [emp1.empId]);
    assert.strictEqual(checkEmp1.rows.length, 0, 'Employee row must be deleted');
    const checkUser1 = await pool.query('SELECT id FROM public.users WHERE id = $1', [emp1.userId]);
    assert.strictEqual(checkUser1.rows.length, 0, 'User row must be deleted');
    console.log('  [PASS] Employee permanently deleted using case-insensitive and trimmed ID.');

    // -------------------------------------------------------------------------
    // Test 7: Exact match permanent deletion and audit log verification
    // -------------------------------------------------------------------------
    console.log('\nTest 7: Exact match permanent deletion and audit logging');
    const emp2 = await createTestEmployee(`GPDEL2_${Date.now() % 100000}`, `emp2_${Date.now()}@test.com`);
    const resSuccessExact = await makeRequest({
      method: 'DELETE',
      path: `/admin/employees/${emp2.empId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        confirmEmployeeId: emp2.empId,
        confirmCheckbox: true,
      },
    });
    assert.strictEqual(resSuccessExact.statusCode, 200, `Expected 200, got ${resSuccessExact.statusCode}`);
    assert.strictEqual(resSuccessExact.data.success, true);

    // Verify audit log (allow async recordAuditLog to persist)
    await new Promise((r) => setTimeout(r, 200));
    const auditRes = await pool.query(
      `SELECT * FROM public.audit_logs 
       WHERE action = 'EMPLOYEE_PERMANENTLY_DELETED' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [emp2.empId]
    );
    assert(auditRes.rows.length > 0, 'Audit log entry must be created for EMPLOYEE_PERMANENTLY_DELETED');
    assert.strictEqual(auditRes.rows[0].user_id, adminUser.id, 'Audit log must record performing admin');
    console.log('  [PASS] Audit log verified for employee permanent deletion.');

    console.log('\n================================================================');
    console.log(' ALL EMPLOYEE PERMANENT DELETE VALIDATION TESTS PASSED! (7/7)');
    console.log('================================================================\n');
  } finally {
    // End test
  }
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] Test suite encountered an error:', err);
    process.exit(1);
  });
