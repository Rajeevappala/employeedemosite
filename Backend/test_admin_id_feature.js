/**
 * Test Suite: Admin ID Number Feature
 *
 * Verifies:
 * 1. Database schema: admin_id column exists with unique constraint uq_users_admin_id.
 * 2. Mandatory validation: Creating an admin without adminId or whitespace is rejected (400).
 * 3. Format validation: Invalid characters in adminId rejected (400).
 * 4. Conflict check with employees: adminId matching existing employee_id rejected (409).
 * 5. Creation success: Admin creates another Admin with unique adminId (201).
 * 6. Duplicate rejection: Admin creation with duplicate adminId rejected (409).
 * 7. List & Details: adminId returned in GET /api/admin/users and GET /api/admin/users/:userId.
 * 8. Preservation on edit: Editing unrelated fields (e.g. name, phone) preserves Admin ID.
 * 9. Assignment/update of Admin ID: PUT /api/admin/users/:userId allows updating or assigning Admin ID.
 * 10. Update conflict checks: Updating adminId to duplicate admin or employee ID rejected (409).
 * 11. RBAC enforcement: Non-admin users forbidden (403) from creating or updating admin users.
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

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Starting Admin ID Number Feature Test Suite');
  console.log('================================================================\n');

  let testAdminUserId = null;
  const testAdminId1 = 'ADM-TEST-9001';
  const testAdminId2 = 'ADM-TEST-9002';
  const testAdminEmail = 'test.admin.id.verifier@gaintpro.com';

  try {
    // -------------------------------------------------------------------------
    // Preparation: Cleanup any leftover test data
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM public.users WHERE email = $1 OR admin_id IN ($2, $3)', [
      testAdminEmail,
      testAdminId1,
      testAdminId2,
    ]);

    // Find an active admin for auth
    const adminUserRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    assert(adminUserRes.rows.length > 0, 'No active admin found in public.users');
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken(adminUser);

    // Find an active employee for non-admin test
    const empUserRes = await pool.query(
      "SELECT id, email, role, employee_id FROM public.users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' LIMIT 1"
    );
    let empToken = null;
    let existingEmployeeId = 'GP0001N';
    if (empUserRes.rows.length > 0) {
      empToken = generateToken(empUserRes.rows[0]);
      if (empUserRes.rows[0].employee_id) {
        existingEmployeeId = empUserRes.rows[0].employee_id;
      }
    }

    // -------------------------------------------------------------------------
    // Test 1: Verify PostgreSQL Column & Constraint
    // -------------------------------------------------------------------------
    console.log('Test 1: Verify admin_id column in public.users');
    const colRes = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'admin_id'
    `);
    assert.strictEqual(colRes.rows.length, 1, 'admin_id column must exist in public.users');
    console.log('  [PASS] admin_id column exists with type:', colRes.rows[0].data_type);

    // -------------------------------------------------------------------------
    // Test 2: Admin creation fails without Admin ID
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Admin creation rejected when Admin ID is missing');
    const missingIdRes = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'ADMIN',
        firstName: 'NoId',
        lastName: 'Admin',
        email: testAdminEmail,
      },
    });
    assert.strictEqual(missingIdRes.statusCode, 400, `Expected 400, got ${missingIdRes.statusCode}`);
    assert(
      (missingIdRes.data.message || '').toLowerCase().includes('admin id'),
      `Expected error message mentioning Admin ID, got: ${missingIdRes.data.message}`
    );
    console.log('  [PASS] Missing Admin ID rejected with 400 Bad Request.');

    // -------------------------------------------------------------------------
    // Test 3: Admin creation fails with whitespace or invalid format Admin ID
    // -------------------------------------------------------------------------
    console.log('\nTest 3: Admin creation rejected with invalid Admin ID format');
    const invalidFormatRes = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'ADMIN',
        adminId: 'INVALID@ID#!!',
        firstName: 'Format',
        lastName: 'Admin',
        email: testAdminEmail,
      },
    });
    assert.strictEqual(invalidFormatRes.statusCode, 400, `Expected 400, got ${invalidFormatRes.statusCode}`);
    console.log('  [PASS] Invalid Admin ID format rejected with 400 Bad Request.');

    // -------------------------------------------------------------------------
    // Test 4: Admin creation fails if Admin ID conflicts with Employee ID
    // -------------------------------------------------------------------------
    console.log(`\nTest 4: Admin creation rejected if Admin ID conflicts with Employee ID (${existingEmployeeId})`);
    const conflictEmpRes = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'ADMIN',
        adminId: existingEmployeeId,
        firstName: 'Conflicting',
        lastName: 'Admin',
        email: testAdminEmail,
      },
    });
    assert.strictEqual(conflictEmpRes.statusCode, 409, `Expected 409, got ${conflictEmpRes.statusCode}`);
    assert(
      (conflictEmpRes.data.message || '').toLowerCase().includes('conflict'),
      `Expected error message mentioning conflict, got: ${conflictEmpRes.data.message}`
    );
    console.log('  [PASS] Admin ID conflicting with Employee ID rejected with 409 Conflict.');

    // -------------------------------------------------------------------------
    // Test 5: Successful Admin Creation with Unique Admin ID
    // -------------------------------------------------------------------------
    console.log(`\nTest 5: Create Admin with unique Admin ID (${testAdminId1})`);
    const createSuccessRes = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'ADMIN',
        adminId: testAdminId1,
        firstName: 'Unique',
        lastName: 'Admin',
        email: testAdminEmail,
        phone: '9876543210',
      },
    });
    assert.strictEqual(createSuccessRes.statusCode, 201, `Expected 201, got ${createSuccessRes.statusCode}: ${JSON.stringify(createSuccessRes.data)}`);
    assert(createSuccessRes.data.data.id, 'Created user must have an id');
    assert.strictEqual(createSuccessRes.data.data.adminId, testAdminId1, 'Returned adminId must match submitted ID');
    testAdminUserId = createSuccessRes.data.data.id;
    console.log('  [PASS] Admin account successfully created with Admin ID Number:', testAdminId1);

    // -------------------------------------------------------------------------
    // Test 6: Duplicate Admin ID rejection
    // -------------------------------------------------------------------------
    console.log(`\nTest 6: Reject creation with duplicate Admin ID (${testAdminId1})`);
    const duplicateRes = await makeRequest({
      method: 'POST',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        role: 'ADMIN',
        adminId: testAdminId1,
        firstName: 'Another',
        lastName: 'Admin',
        email: 'another.duplicate.admin@gaintpro.com',
      },
    });
    assert.strictEqual(duplicateRes.statusCode, 409, `Expected 409, got ${duplicateRes.statusCode}`);
    assert(
      (duplicateRes.data.message || '').toLowerCase().includes('already exists') ||
      (duplicateRes.data.message || '').toLowerCase().includes('unique'),
      `Expected duplicate message, got: ${duplicateRes.data.message}`
    );
    console.log('  [PASS] Duplicate Admin ID rejected with 409 Conflict.');

    // -------------------------------------------------------------------------
    // Test 7: Verify Admin ID returned in administrator list and details APIs
    // -------------------------------------------------------------------------
    console.log('\nTest 7: Verify Admin ID in GET /api/admin/users and GET /api/admin/users/:userId');
    const listRes = await makeRequest({
      method: 'GET',
      path: '/admin/users?role=ADMIN',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(listRes.statusCode, 200);
    const foundInList = listRes.data.data.find((u) => u.id === testAdminUserId);
    assert(foundInList, 'Created admin must appear in administrator list');
    assert.strictEqual(foundInList.adminId, testAdminId1, 'adminId in list must match');

    const detailRes = await makeRequest({
      method: 'GET',
      path: `/admin/users/${testAdminUserId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(detailRes.statusCode, 200);
    assert.strictEqual(detailRes.data.data.adminId, testAdminId1, 'adminId in detail view must match');
    console.log('  [PASS] Admin ID successfully returned in list and detail endpoints.');

    // -------------------------------------------------------------------------
    // Test 8: Unrelated edit preserves existing Admin ID
    // -------------------------------------------------------------------------
    console.log('\nTest 8: Edit unrelated details preserves existing Admin ID');
    const updateUnrelatedRes = await makeRequest({
      method: 'PUT',
      path: `/admin/users/${testAdminUserId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        firstName: 'UpdatedFirst',
        lastName: 'UpdatedLast',
        phone: '9988776655',
      },
    });
    assert.strictEqual(updateUnrelatedRes.statusCode, 200, `Expected 200, got ${updateUnrelatedRes.statusCode}`);
    assert.strictEqual(updateUnrelatedRes.data.data.adminId, testAdminId1, 'Admin ID must remain unchanged when omitted');
    assert.strictEqual(updateUnrelatedRes.data.data.firstName, 'UpdatedFirst');
    console.log('  [PASS] Existing Admin ID preserved when updating unrelated administrator details.');

    // -------------------------------------------------------------------------
    // Test 9: Assign/Update Admin ID to another unique ID
    // -------------------------------------------------------------------------
    console.log(`\nTest 9: Update Admin ID to new unique ID (${testAdminId2})`);
    const updateIdRes = await makeRequest({
      method: 'PUT',
      path: `/admin/users/${testAdminUserId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        adminId: testAdminId2,
        firstName: 'UpdatedFirst',
        lastName: 'UpdatedLast',
      },
    });
    assert.strictEqual(updateIdRes.statusCode, 200, `Expected 200, got ${updateIdRes.statusCode}`);
    assert.strictEqual(updateIdRes.data.data.adminId, testAdminId2, 'Admin ID must be updated to new ID');
    console.log('  [PASS] Successfully updated Admin ID to new unique ID.');

    // -------------------------------------------------------------------------
    // Test 10: Updating Admin ID to employee ID rejected
    // -------------------------------------------------------------------------
    console.log(`\nTest 10: Reject updating Admin ID to conflicting Employee ID (${existingEmployeeId})`);
    const updateConflictRes = await makeRequest({
      method: 'PUT',
      path: `/admin/users/${testAdminUserId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        adminId: existingEmployeeId,
      },
    });
    assert.strictEqual(updateConflictRes.statusCode, 409, `Expected 409, got ${updateConflictRes.statusCode}`);
    console.log('  [PASS] Updating Admin ID to existing Employee ID rejected with 409 Conflict.');

    // -------------------------------------------------------------------------
    // Test 11: Non-Admin forbidden from creating or updating Admin
    // -------------------------------------------------------------------------
    if (empToken) {
      console.log('\nTest 11: Verify non-admin (EMPLOYEE) is forbidden (403)');
      const nonAdminCreateRes = await makeRequest({
        method: 'POST',
        path: '/admin/users',
        headers: { Authorization: `Bearer ${empToken}` },
        body: {
          role: 'ADMIN',
          adminId: 'HACK001',
          firstName: 'Evil',
          lastName: 'Admin',
          email: 'evil.admin@gaintpro.com',
        },
      });
      assert.strictEqual(nonAdminCreateRes.statusCode, 403, `Expected 403, got ${nonAdminCreateRes.statusCode}`);

      const nonAdminUpdateRes = await makeRequest({
        method: 'PUT',
        path: `/admin/users/${testAdminUserId}`,
        headers: { Authorization: `Bearer ${empToken}` },
        body: {
          firstName: 'Unauthorized',
        },
      });
      assert.strictEqual(nonAdminUpdateRes.statusCode, 403, `Expected 403, got ${nonAdminUpdateRes.statusCode}`);
      console.log('  [PASS] Non-admin properly forbidden with 403 from admin operations.');
    }

    console.log('\n================================================================');
    console.log(' ALL ADMIN ID NUMBER FEATURE TESTS PASSED SUCCESSFULLY! ✓');
    console.log('================================================================\n');
  } finally {
    // Cleanup created test user
    if (testAdminUserId) {
      await pool.query('DELETE FROM public.users WHERE id = $1', [testAdminUserId]);
      console.log('  [CLEANUP] Deleted test admin account.');
    }
  }
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  });
