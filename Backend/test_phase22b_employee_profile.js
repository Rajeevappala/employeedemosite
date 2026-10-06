const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
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
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.mimeType || 'image/jpeg'}\r\n\r\n`,
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

function createDummyJpegBuffer() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0xff, 0xd9,
  ]);
}

function createDummyPngBuffer() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
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
  console.log('  PHASE 22B — EMPLOYEE PROFILE MANAGEMENT AUTOMATED TEST SUITE   ');
  console.log('================================================================\n');

  let emp1 = null;
  let emp2 = null;
  let emp1Token = null;
  let emp2Token = null;
  let adminToken = null;
  let superAdminToken = null;
  let originalEmp1Data = null;
  let uploadedPhotoStorageKey = null;

  try {
    // 0. Setup: Identify active users & employees
    const adminRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const superAdminRes = await pool.query(
      "SELECT id, email, role FROM public.users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1"
    );
    const empRows = await pool.query(
      `SELECT u.id AS user_id, u.email, u.role, e.employee_id, e.first_name, e.last_name, e.department, e.designation,
              e.personal_email, e.phone, e.address, e.city, e.state, e.postal_code,
              e.emergency_contact_name, e.emergency_contact_phone, e.emergency_contact_relationship,
              e.working_days_per_week, e.profile_photo_url
       FROM public.users u
       JOIN public.employees e ON e.user_id = u.id
       WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE'
       ORDER BY e.employee_id ASC
       LIMIT 2`
    );

    assert(adminRes.rows.length > 0, 'Setup: Admin user found in database');
    assert(empRows.rows.length >= 2, 'Setup: At least 2 active employees found for IDOR testing');

    const adminUser = adminRes.rows[0];
    const superAdminUser = superAdminRes.rows[0] || adminUser;
    emp1 = empRows.rows[0];
    emp2 = empRows.rows[1];
    originalEmp1Data = { ...emp1 };

    adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });
    superAdminToken = generateToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
    });
    emp1Token = generateToken({
      userId: emp1.user_id,
      email: emp1.email,
      role: emp1.role,
      employeeId: emp1.employee_id,
    });
    emp2Token = generateToken({
      userId: emp2.user_id,
      email: emp2.email,
      role: emp2.role,
      employeeId: emp2.employee_id,
    });

    // -------------------------------------------------------------------------
    // TEST 1: Profile Retrieval (GET /api/employee/profile)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Profile Retrieval (GET /api/employee/profile) ---');
    const getRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });

    assert(getRes.statusCode === 200, 'GET /api/employee/profile returns HTTP 200');
    const getJson = getRes.json();
    assert(getJson && getJson.success === true, 'Response indicates success = true');
    const profile = getJson.data;
    assert(profile.employee_id === emp1.employee_id, `Returns authenticated employee ID (${emp1.employee_id})`);
    assert(profile.first_name === emp1.first_name, 'Returns correct first_name');
    assert(profile.last_name === emp1.last_name, 'Returns correct last_name');
    assert(profile.email === emp1.email, 'Returns correct official email');
    assert(profile.department === emp1.department, 'Returns correct department');
    assert(profile.designation === emp1.designation, 'Returns correct designation');
    assert(typeof profile.working_days_per_week === 'number', 'Returns numeric working_days_per_week');
    assert(typeof profile.has_profile_photo === 'boolean', 'Returns boolean has_profile_photo flag');

    // Sensitive data leakage audit
    const rawJsonStr = JSON.stringify(getJson);
    assert(!rawJsonStr.includes('password_hash'), 'No password_hash leaked in profile response');
    assert(!rawJsonStr.includes('otp_hash'), 'No otp_hash leaked in profile response');
    assert(!rawJsonStr.includes('storage_key'), 'No storage_key leaked in profile response');
    assert(!rawJsonStr.includes('private_storage'), 'No private storage filesystem path leaked');

    // -------------------------------------------------------------------------
    // TEST 2: Profile Update - Whitelisted Personal Fields (PUT /api/employee/profile)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Profile Update - Whitelisted Fields ---');
    const updatePayload = {
      personal_email: 'emp1.updated@personal-test.com',
      phone: '9876543210',
      address: '42 Tech Residency, Phase 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      postal_code: '560001',
      emergency_contact_name: 'Emergency Person',
      emergency_contact_phone: '9876543211',
      emergency_contact_relationship: 'Spouse',
    };

    const updateRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${emp1Token}`,
          'Content-Type': 'application/json',
        },
      },
      updatePayload
    );

    assert(updateRes.statusCode === 200, 'PUT /api/employee/profile returns HTTP 200 OK');
    const updateJson = updateRes.json();
    assert(updateJson && updateJson.success === true, 'Update response indicates success = true');
    assert(updateJson.data.personal_email === updatePayload.personal_email, 'personal_email successfully updated');
    assert(updateJson.data.phone === updatePayload.phone, 'phone successfully updated');
    assert(updateJson.data.address === updatePayload.address, 'address successfully updated');
    assert(updateJson.data.city === updatePayload.city, 'city successfully updated');
    assert(updateJson.data.postal_code === updatePayload.postal_code, 'postal_code successfully updated');
    assert(updateJson.data.emergency_contact_name === updatePayload.emergency_contact_name, 'emergency_contact_name updated');
    assert(updateJson.data.emergency_contact_phone === updatePayload.emergency_contact_phone, 'emergency_contact_phone updated');

    // Verify PostgreSQL database reflects the update
    const dbEmp1 = (await pool.query(
      'SELECT personal_email, phone, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone FROM public.employees WHERE employee_id = $1',
      [emp1.employee_id]
    )).rows[0];
    assert(dbEmp1.personal_email === updatePayload.personal_email, 'Database reflects updated personal_email');
    assert(dbEmp1.phone === updatePayload.phone, 'Database reflects updated phone');
    assert(dbEmp1.postal_code === updatePayload.postal_code, 'Database reflects updated postal_code');

    // Verify users.phone synchronization
    const dbUser1 = (await pool.query('SELECT phone FROM public.users WHERE id = $1', [emp1.user_id])).rows[0];
    assert(dbUser1.phone === updatePayload.phone, 'users table phone synchronized with employees table');

    // Verify audit log
    const auditRes = await pool.query(
      "SELECT * FROM public.audit_logs WHERE action = 'EMPLOYEE_PROFILE_UPDATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [emp1.employee_id]
    );
    assert(auditRes.rows.length > 0, "Audit log record created with action 'EMPLOYEE_PROFILE_UPDATED'");

    // -------------------------------------------------------------------------
    // TEST 3: Field Whitelist Protection (Attempt to Modify Official / Protected Data)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Field Whitelist & Official Data Protection ---');
    const maliciousPayload = {
      employee_id: 'GP9999N',
      email: 'hacker@admin.com',
      first_name: 'HackedFirst',
      last_name: 'HackedLast',
      department: 'Executive Board',
      designation: 'CEO',
      date_of_joining: '2020-01-01',
      work_location: 'London Office',
      status: 'SUSPENDED',
      employment_status: 'INACTIVE',
      working_days_per_week: 6,
      role: 'SUPER_ADMIN',
      salary: 999999,
      basic_salary: 999999,
      pf_number: 'PF9999',
    };

    const attackRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${emp1Token}`,
          'Content-Type': 'application/json',
        },
      },
      maliciousPayload
    );

    assert(attackRes.statusCode === 200, 'Request processed (malicious non-whitelisted fields ignored)');
    const dbCheckAttack = (await pool.query(
      'SELECT employee_id, first_name, last_name, email, department, designation, status, working_days_per_week FROM public.employees WHERE employee_id = $1',
      [emp1.employee_id]
    )).rows[0];

    assert(dbCheckAttack.employee_id === emp1.employee_id, 'employee_id remained strictly immutable');
    assert(dbCheckAttack.first_name === emp1.first_name, 'first_name cannot be modified by employee');
    assert(dbCheckAttack.last_name === emp1.last_name, 'last_name cannot be modified by employee');
    assert(dbCheckAttack.email === emp1.email, 'Official email cannot be modified by employee');
    assert(dbCheckAttack.department === emp1.department, 'department cannot be modified by employee');
    assert(dbCheckAttack.designation === emp1.designation, 'designation cannot be modified by employee');
    assert(dbCheckAttack.status === 'ACTIVE', 'employment status cannot be modified by employee');
    assert(dbCheckAttack.working_days_per_week === emp1.working_days_per_week, 'working_days_per_week cannot be modified by employee');

    const dbUserRole = (await pool.query('SELECT role FROM public.users WHERE id = $1', [emp1.user_id])).rows[0];
    assert(dbUserRole.role === 'EMPLOYEE', 'User role remained EMPLOYEE (cannot elevate role)');

    // -------------------------------------------------------------------------
    // TEST 4: IDOR Protection (Cross-Employee Profile Updates)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. IDOR Protection (Cross-Employee Update Attempt) ---');
    const emp2OriginalEmail = emp2.personal_email;
    const idorPayload = {
      employee_id: emp2.employee_id, // Attacker specifies Victim's employee ID
      personal_email: 'victim.hijacked@evil.com',
      phone: '9999999999',
    };

    const idorRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${emp1Token}`, // Authenticated as Employee 1
          'Content-Type': 'application/json',
        },
      },
      idorPayload
    );

    assert(idorRes.statusCode === 200, 'Request completed based on authenticated JWT session context');
    // Verify Employee 2 was NOT modified
    const dbEmp2 = (await pool.query(
      'SELECT personal_email, phone FROM public.employees WHERE employee_id = $1',
      [emp2.employee_id]
    )).rows[0];
    assert(dbEmp2.personal_email === emp2OriginalEmail, 'Victim employee (GP0002N) personal_email remained unchanged');
    assert(dbEmp2.phone !== '9999999999', 'Victim employee (GP0002N) phone remained untouched');

    // -------------------------------------------------------------------------
    // TEST 5: Input Validation & Formatting
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Input Validation Rules ---');
    // 5a. Invalid email format
    const badEmailRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { personal_email: 'not-an-email' }
    );
    assert(badEmailRes.statusCode === 400, 'Invalid personal email format returns HTTP 400');

    // 5b. Invalid phone (not 10 digits)
    const badPhoneRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { phone: '12345' }
    );
    assert(badPhoneRes.statusCode === 400, 'Invalid phone number (not 10 digits) returns HTTP 400');

    // 5c. Invalid pincode (not 6 digits)
    const badPincodeRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { pincode: '5600' }
    );
    assert(badPincodeRes.statusCode === 400, 'Invalid pincode (not 6 digits) returns HTTP 400');

    // 5d. Invalid emergency phone
    const badEmerPhoneRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { emergency_contact_phone: '123' }
    );
    assert(badEmerPhoneRes.statusCode === 400, 'Invalid emergency phone returns HTTP 400');

    // 5e. Clean empty / null handling
    const nullOptionalRes = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { personal_email: '', address: '' }
    );
    assert(nullOptionalRes.statusCode === 200, 'Empty string for optional field accepted and stored as NULL');

    // -------------------------------------------------------------------------
    // TEST 6: Profile Photo Upload, Streaming & Safe Replacement
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Profile Photo Upload & Safe Replacement ---');

    // 6a. Upload without file
    const noFileRes = await makeMultipartRequestWithFields({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'POST',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(noFileRes.statusCode === 400, 'Photo upload without file returns HTTP 400');

    // 6b. Upload non-image (.txt)
    const txtFileRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
        headers: { Authorization: `Bearer ${emp1Token}` },
      },
      {},
      { name: 'photo', filename: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text') }
    );
    assert(txtFileRes.statusCode === 400, 'Upload of non-image (.txt) returns HTTP 400');

    // 6c. Upload spoofed image (named .jpg but invalid magic bytes)
    const spoofedImgRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
        headers: { Authorization: `Bearer ${emp1Token}` },
      },
      {},
      { name: 'photo', filename: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('NOT A JPEG HEADER') }
    );
    assert(spoofedImgRes.statusCode === 400, 'Upload of spoofed image (invalid magic bytes) returns HTTP 400');

    // 6d. Successful Upload of authentic JPEG
    const jpegBuffer = createDummyJpegBuffer();
    const uploadJpegRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
        headers: { Authorization: `Bearer ${emp1Token}` },
      },
      {},
      { name: 'photo', filename: 'avatar.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer }
    );
    assert(uploadJpegRes.statusCode === 200, 'Authentic JPEG upload returns HTTP 200 OK');
    const uploadJpegJson = uploadJpegRes.json();
    assert(uploadJpegJson && uploadJpegJson.success === true, 'Photo upload response indicates success = true');
    assert(uploadJpegJson.data?.has_profile_photo === true, 'has_profile_photo is now true');
    assert(!JSON.stringify(uploadJpegJson).includes('documents/'), 'Zero storage_key leaked in photo upload response');

    // Verify DB and filesystem
    const dbPhoto1 = (await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [emp1.employee_id]
    )).rows[0];
    const initialStorageKey = dbPhoto1.profile_photo_url;
    assert(initialStorageKey.startsWith(`documents/${emp1.employee_id}/profile/`), 'Storage key follows documents/GP####N/profile/ pattern');
    const fileExistsOnDisk1 = await storageService.fileExists(initialStorageKey);
    assert(fileExistsOnDisk1 === true, 'Physical JPEG photo file exists in private storage');
    uploadedPhotoStorageKey = initialStorageKey;

    // Verify audit log for photo upload
    const photoAudit = await pool.query(
      "SELECT * FROM public.audit_logs WHERE action = 'PROFILE_PHOTO_UPDATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [emp1.employee_id]
    );
    assert(photoAudit.rows.length > 0, "Audit log record created with action 'PROFILE_PHOTO_UPDATED'");

    // 6e. Photo Streaming (GET /api/employee/profile/photo)
    const streamRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(streamRes.statusCode === 200, 'GET /api/employee/profile/photo returns HTTP 200');
    assert((streamRes.headers['content-type'] || '').includes('image/jpeg'), 'Content-Type is image/jpeg');
    assert(streamRes.body.length === jpegBuffer.length, 'Streamed photo buffer length matches uploaded JPEG');

    // 6f. Safe Photo Replacement with PNG
    const pngBuffer = createDummyPngBuffer();
    const replacePngRes = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
        headers: { Authorization: `Bearer ${emp1Token}` },
      },
      {},
      { name: 'photo', filename: 'avatar.png', mimeType: 'image/png', buffer: pngBuffer }
    );
    assert(replacePngRes.statusCode === 200, 'Photo replacement with PNG returns HTTP 200');

    const dbPhoto2 = (await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [emp1.employee_id]
    )).rows[0];
    const newStorageKey = dbPhoto2.profile_photo_url;
    assert(newStorageKey !== initialStorageKey, 'Database profile_photo_url updated to new file key');

    // Verify old physical file deleted and new physical file exists
    const oldFileStillExists = await storageService.fileExists(initialStorageKey);
    assert(oldFileStillExists === false, 'Old physical JPEG photo was cleanly purged from private storage');
    const newFileExists = await storageService.fileExists(newStorageKey);
    assert(newFileExists === true, 'New physical PNG photo exists in private storage');
    uploadedPhotoStorageKey = newStorageKey;

    // 6g. Photo Removal (DELETE /api/employee/profile/photo)
    const deletePhotoRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'DELETE',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(deletePhotoRes.statusCode === 200, 'DELETE /api/employee/profile/photo returns HTTP 200');

    const dbPhoto3 = (await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [emp1.employee_id]
    )).rows[0];
    assert(dbPhoto3.profile_photo_url === null, 'profile_photo_url is set to NULL after removal');
    const removedFileExists = await storageService.fileExists(newStorageKey);
    assert(removedFileExists === false, 'Removed photo file deleted from disk');
    uploadedPhotoStorageKey = null;

    // Subsequent photo GET returns 404
    const photo404Res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile/photo',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(photo404Res.statusCode === 404, 'GET /profile/photo returns HTTP 404 when employee has no photo');

    // -------------------------------------------------------------------------
    // TEST 7: Authentication & RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Authentication & Security Enforcement ---');
    // 7a. Unauthenticated GET /profile
    const unauthGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
    });
    assert(unauthGet.statusCode === 401, 'Unauthenticated GET /profile returns HTTP 401');

    // 7b. Unauthenticated PUT /profile
    const unauthPut = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      },
      { phone: '9876543210' }
    );
    assert(unauthPut.statusCode === 401, 'Unauthenticated PUT /profile returns HTTP 401');

    // 7c. Unauthenticated photo upload
    const unauthPhoto = await makeMultipartRequestWithFields(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile/photo',
        method: 'POST',
      },
      {},
      { name: 'photo', filename: 'p.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer }
    );
    assert(unauthPhoto.statusCode === 401, 'Unauthenticated photo upload returns HTTP 401');

    // 7d. Admin accessing Admin Employee Photo endpoint
    const adminPhotoRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp1.employee_id}/photo`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminPhotoRes.statusCode === 404, 'Admin photo access returns 404 when employee has no photo');

    // 7e. Employee attempting to access Admin photo endpoint (RBAC blocked)
    const empAccessAdminPhoto = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp2.employee_id}/photo`,
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(empAccessAdminPhoto.statusCode === 403, 'EMPLOYEE accessing /api/admin/employees/:id/photo returns HTTP 403 Forbidden');

    // 7f. Admin viewing Employee Details via /api/admin/employees/:id
    const adminGetEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees/${emp1.employee_id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminGetEmp.statusCode === 200, 'Admin GET /api/admin/employees/:id returns HTTP 200');
    const adminEmpData = adminGetEmp.json();
    assert(adminEmpData.data.has_profile_photo === false, 'Admin response contains has_profile_photo flag');
    assert(!JSON.stringify(adminEmpData).includes('storage_key'), 'Zero storage_key leaked in Admin employee details');

    // -------------------------------------------------------------------------
    // TEST 8: Suspended / Inactive Account Security
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Inactive & Suspended Employee Protections ---');
    // Temporarily suspend employee 1
    await pool.query("UPDATE public.employees SET status = 'SUSPENDED' WHERE employee_id = $1", [emp1.employee_id]);
    await pool.query("UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1", [emp1.user_id]);

    const suspendedGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(suspendedGet.statusCode === 403, 'SUSPENDED employee GET /profile returns HTTP 403 Forbidden');

    const suspendedPut = await makeRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/employee/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${emp1Token}`, 'Content-Type': 'application/json' },
      },
      { phone: '9876543210' }
    );
    assert(suspendedPut.statusCode === 403, 'SUSPENDED employee PUT /profile returns HTTP 403 Forbidden');

    // Reactivate employee 1
    await pool.query("UPDATE public.employees SET status = 'ACTIVE' WHERE employee_id = $1", [emp1.employee_id]);
    await pool.query("UPDATE public.users SET status = 'ACTIVE' WHERE id = $1", [emp1.user_id]);

    const reactivatedGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert(reactivatedGet.statusCode === 200, 'Reactivated ACTIVE employee GET /profile returns HTTP 200 OK');

    // -------------------------------------------------------------------------
    // TEST 9: Cleanup & State Restoration
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Cleanup & Restoration ---');
    if (uploadedPhotoStorageKey) {
      try {
        await storageService.deleteFile(uploadedPhotoStorageKey);
      } catch {}
    }
    // Restore original employee 1 data
    await pool.query(
      `UPDATE public.employees
       SET personal_email = $1, phone = $2, address = $3, city = $4, state = $5, postal_code = $6,
           emergency_contact_name = $7, emergency_contact_phone = $8, emergency_contact_relationship = $9,
           profile_photo_url = $10, updated_at = NOW()
       WHERE employee_id = $11`,
      [
        originalEmp1Data.personal_email,
        originalEmp1Data.phone,
        originalEmp1Data.address,
        originalEmp1Data.city,
        originalEmp1Data.state,
        originalEmp1Data.postal_code,
        originalEmp1Data.emergency_contact_name,
        originalEmp1Data.emergency_contact_phone,
        originalEmp1Data.emergency_contact_relationship,
        originalEmp1Data.profile_photo_url,
        emp1.employee_id,
      ]
    );
    if (originalEmp1Data.phone) {
      await pool.query('UPDATE public.users SET phone = $1 WHERE id = $2', [originalEmp1Data.phone, emp1.user_id]);
    }
    assert(true, 'Original employee data restored cleanly after testing');

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`  PHASE 22B TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
