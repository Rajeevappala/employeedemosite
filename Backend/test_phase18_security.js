require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken, verifyToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');
const { validateMagicBytes } = require('./middleware/uploadMiddleware');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
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

async function runSecuritySuite() {
  console.log('========================================================');
  console.log('       PHASE 18 — SECURITY & HARDENING TEST SUITE       ');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Setup DB tokens & test users
    const empRes = await pool.query(`
      SELECT u.id, u.email, u.role, e.employee_id
      FROM public.users u
      JOIN public.employees e ON e.email = u.email
      WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
      LIMIT 1
    `);
    const empUser = empRes.rows[0];

    const adminRes = await pool.query(`
      SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1
    `);
    const adminUser = adminRes.rows[0];

    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: empUser.role,
      employeeId: empUser.employee_id,
    });
    // Simulated unauthorized employee context (GP9999N)
    const emp2Token = generateToken({
      userId: '00000000-0000-0000-0000-000000000002',
      email: 'attacker.employee@gaintpro.com',
      role: 'EMPLOYEE',
      employeeId: 'GP9999N',
    });
    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // ----------------------------------------------------
    // CATEGORY 1: AUTHENTICATION & JWT SECURITY
    // ----------------------------------------------------
    console.log('--- 1. AUTHENTICATION & JWT INTEGRITY ---');

    // 1.1 Unauthenticated request returns 401
    const unauthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
    });
    assert(unauthRes.statusCode === 401, 'Unauthenticated request to /api/auth/me returns 401');

    // 1.2 Invalid token returns 401
    const invalidTokenRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Authorization: 'Bearer this_is_a_completely_invalid_jwt_token' },
    });
    assert(invalidTokenRes.statusCode === 401, 'Tampered/invalid JWT returns 401');

    // 1.3 Malformed Authorization header returns 401
    const malformedAuthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Authorization: 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=' },
    });
    assert(malformedAuthRes.statusCode === 401, 'Malformed/non-Bearer Authorization header returns 401');

    // 1.4 Expired token returns 401
    const expiredToken = generateToken(empUser, -3600);
    const expiredRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(expiredRes.statusCode === 401, 'Expired JWT returns 401 Unauthorized');

    // ----------------------------------------------------
    // CATEGORY 2: ROLE-BASED ACCESS CONTROL (RBAC)
    // ----------------------------------------------------
    console.log('\n--- 2. ROLE-BASED ACCESS CONTROL (RBAC) ---');

    // 2.1 Employee cannot access admin employees
    const empAdminEmpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empAdminEmpRes.statusCode === 403, 'Employee token accessing /api/admin/employees returns 403');

    // 2.2 Employee cannot access admin payroll
    const empAdminPayrollRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empAdminPayrollRes.statusCode === 403, 'Employee token accessing /api/admin/payroll returns 403');

    // 2.3 Employee cannot access admin announcements create
    const empAdminAnnounceRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/announcements',
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
    }, { title: 'Hacked', content: 'Test' });
    assert(empAdminAnnounceRes.statusCode === 403, 'Employee token POST /api/admin/announcements returns 403');

    // 2.4 Admin cannot access employee self-service endpoints where disallowed
    const adminEmpDashRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminEmpDashRes.statusCode === 403, 'Admin token accessing /api/employee/dashboard returns 403');

    // ----------------------------------------------------
    // CATEGORY 3: INSECURE DIRECT OBJECT REFERENCE (IDOR)
    // ----------------------------------------------------
    console.log('\n--- 3. INSECURE DIRECT OBJECT REFERENCE (IDOR) ---');

    // 3.1 Attacker employee (GP9999N) cannot access Victim employee (GP0001N)'s payslips
    const empDocRes = await pool.query(
      `SELECT id FROM public.documents WHERE employee_id = $1 AND document_type = 'Payslip' LIMIT 1`,
      [empUser.employee_id]
    );
    if (empDocRes.rows.length > 0) {
      const victimDocId = empDocRes.rows[0].id;
      const crossViewRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${victimDocId}/view`,
        method: 'GET',
        headers: { Authorization: `Bearer ${emp2Token}` },
      });
      assert(crossViewRes.statusCode === 404, 'Attacker Employee accessing Victim payslip view returns 404 (IDOR blocked)');

      const crossDownRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${victimDocId}/download`,
        method: 'GET',
        headers: { Authorization: `Bearer ${emp2Token}` },
      });
      assert(crossDownRes.statusCode === 404, 'Attacker Employee downloading Victim payslip returns 404 (IDOR blocked)');
    }

    // 3.2 Attacker employee cannot view Victim's private documents
    const anyDocRes = await pool.query(
      `SELECT id FROM public.documents WHERE employee_id = $1 LIMIT 1`,
      [empUser.employee_id]
    );
    if (anyDocRes.rows.length > 0) {
      const victimDocId = anyDocRes.rows[0].id;
      const crossDocViewRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/documents/${victimDocId}/view`,
        method: 'GET',
        headers: { Authorization: `Bearer ${emp2Token}` },
      });
      assert(crossDocViewRes.statusCode === 404, 'Attacker Employee viewing Victim document returns 404 (IDOR blocked)');
    }

    // 3.2 Employee profile strictly returns authenticated user's profile
    const profileRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const profileJson = profileRes.json();
    assert(
      profileRes.statusCode === 200 && profileJson?.data?.employee_id === empUser.employee_id,
      'Employee profile binds strictly to authenticated session context'
    );

    // 3.3 Employee documents strictly returns authenticated user's documents
    const docsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const docsJson = docsRes.json();
    assert(Array.isArray(docsJson?.data) && docsJson.data.length > 0, 'Authenticated employee receives their documents list');

    // Attacker employee with no documents sees 0 documents
    const attackerDocsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp2Token}` },
    });
    const attackerDocsJson = attackerDocsRes.json();
    assert(attackerDocsJson?.data?.length === 0, 'Attacker employee sees 0 documents from other users (strict scoping)');

    // 3.4 Sensitive storage_key is never exposed in document lists
    const hasLeakedKey = (docsJson?.data || []).some((d) => d.storage_key !== undefined);
    assert(!hasLeakedKey, 'Internal storage_key is completely stripped from employee document responses');

    // ----------------------------------------------------
    // CATEGORY 4: FILE UPLOAD & STORAGE SECURITY
    // ----------------------------------------------------
    console.log('\n--- 4. FILE UPLOAD & STORAGE SECURITY ---');

    // 4.1 Path traversal in storageService is blocked
    let pathTraversalCaught = false;
    try {
      storageService.validateStorageKey('../../../etc/passwd');
    } catch (err) {
      pathTraversalCaught = err.name === 'InvalidStorageKeyError' || err.message.includes('traversal');
    }
    assert(pathTraversalCaught, 'storageService blocks relative path traversal attacks (../)');

    let nullByteCaught = false;
    try {
      storageService.validateStorageKey('documents/test\0.pdf');
    } catch (err) {
      nullByteCaught = err.name === 'InvalidStorageKeyError' || err.message.includes('null-byte');
    }
    assert(nullByteCaught, 'storageService blocks null byte injection attacks (\\0)');

    // 4.2 Direct HTTP access to storage folder returns 404
    const directHttpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/storage/documents/Payslip_GP0001N_September_2026.pdf',
      method: 'GET',
    });
    assert(directHttpRes.statusCode === 404, 'Direct HTTP access to private storage directory is blocked (404)');

    // 4.3 Magic bytes validation rejects executable disguised as PDF
    const fakePdfBytes = Buffer.from('MZ\x90\x00\x03\x00\x00\x00FakePEExecutableData');
    const fakePdfCheck = validateMagicBytes(fakePdfBytes, 'application/pdf');
    assert(fakePdfCheck === false, 'validateMagicBytes rejects executable/PE disguised as PDF');

    const fakeHtmlBytes = Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>');
    const fakeHtmlCheck = validateMagicBytes(fakeHtmlBytes, 'application/pdf');
    assert(fakeHtmlCheck === false, 'validateMagicBytes rejects HTML/XSS disguised as PDF');

    const realPdfBytes = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const realPdfCheck = validateMagicBytes(realPdfBytes, 'application/pdf');
    assert(realPdfCheck === true, 'validateMagicBytes accepts authentic PDF header (%PDF-)');

    const realPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const realPngCheck = validateMagicBytes(realPngBytes, 'image/png');
    assert(realPngCheck === true, 'validateMagicBytes accepts authentic PNG header');

    // ----------------------------------------------------
    // CATEGORY 5: INPUT VALIDATION & SQL INJECTION PROTECTION
    // ----------------------------------------------------
    console.log('\n--- 5. INPUT VALIDATION & SQL INJECTION PROTECTION ---');

    // 5.1 SQL Injection probe in query parameter
    const sqliSearchRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/employees?search=${encodeURIComponent("' OR '1'='1' --")}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(sqliSearchRes.statusCode === 200, "SQL injection in search string is safely parameterized (' OR '1'='1')");

    // 5.2 SQL injection probe in UUID parameter
    const sqliUuidRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/announcements/${encodeURIComponent("1' OR '1'='1")}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(sqliUuidRes.statusCode === 400, 'Malformed/injected UUID parameter returns 400 Bad Request');

    // 5.3 Invalid date format returns 400
    const invalidDateRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/attendance?date=9999-99-99',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(invalidDateRes.statusCode === 400, 'Invalid calendar date returns 400 Bad Request');

    // 5.4 Invalid status enum returns 400
    const invalidStatusRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/00000000-0000-0000-0000-000000000000/status',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { status: 'HACKED_STATUS' });
    assert(invalidStatusRes.statusCode === 400, 'Invalid status enum returns 400 Bad Request');

    // ----------------------------------------------------
    // CATEGORY 6: SECURITY HEADERS & ERROR SANITIZATION
    // ----------------------------------------------------
    console.log('\n--- 6. SECURITY HEADERS & ERROR SANITIZATION ---');

    // 6.1 Helmet security headers verification
    const healthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/health',
      method: 'GET',
    });
    assert(healthRes.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff is set');
    assert(healthRes.headers['x-frame-options'] === 'SAMEORIGIN', 'X-Frame-Options: SAMEORIGIN is set');
    assert(healthRes.headers['x-download-options'] === 'noopen', 'X-Download-Options: noopen is set');
    assert(healthRes.headers['x-xss-protection'] === '0', 'X-XSS-Protection header is properly configured by Helmet');

    // 6.2 Error response does not leak internal stack traces
    const badJsonRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, '{"invalid_json": ');
    const badJsonBody = badJsonRes.body.toString('utf8');
    assert(badJsonRes.statusCode === 400, 'Malformed JSON returns 400 Bad Request');
    assert(!badJsonBody.includes('SyntaxError: Unexpected end of JSON input at JSON.parse'), 'Error does not leak raw stack trace');

    // ----------------------------------------------------
    // CATEGORY 7: AUDIT LOGGING VERIFICATION
    // ----------------------------------------------------
    console.log('\n--- 7. AUDIT LOGGING VERIFICATION ---');

    const auditRes = await pool.query(
      `SELECT action, entity_type, created_at FROM public.audit_logs ORDER BY created_at DESC LIMIT 5`
    );
    assert(auditRes.rows.length > 0, `Audit log table contains records (found ${auditRes.rows.length} recent entries)`);
    const recentActions = auditRes.rows.map((r) => r.action);
    console.log(`     Recent recorded actions: ${recentActions.slice(0, 3).join(', ')}`);

    // ----------------------------------------------------
    // CATEGORY 8: OTP SECURITY & RATE LIMITING
    // ----------------------------------------------------
    console.log('\n--- 8. OTP SECURITY & RATE LIMITING ---');

    // 8.1 Invalid OTP verification attempt returns 400
    const invalidOtpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: 'invalid.otp.probe@gaintpro.com', otp: '999999' });
    assert(invalidOtpRes.statusCode === 400, 'Invalid/expired OTP verification attempt returns 400');

    // 8.2 Non-existent account OTP verification returns 400
    const nonExistentOtpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: 'doesnotexist_abc123@gaintpro.com', otp: '123456' });
    assert(nonExistentOtpRes.statusCode === 400, 'Verification against nonexistent account returns 400 Bad Request');

    // 8.3 Rate limiter exports verification
    const rateLimitMiddleware = require('./middleware/rateLimitMiddleware');
    assert(typeof rateLimitMiddleware.otpRequestLimiter === 'function', 'otpRequestLimiter is configured');
    assert(typeof rateLimitMiddleware.otpVerifyLimiter === 'function', 'otpVerifyLimiter is configured');
    assert(typeof rateLimitMiddleware.authGeneralLimiter === 'function', 'authGeneralLimiter is configured');
    assert(typeof rateLimitMiddleware.fileUploadLimiter === 'function', 'fileUploadLimiter is configured');

    console.log('\n========================================================');
    console.log(`SECURITY TEST SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('========================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Security test suite fatal error:', err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

runSecuritySuite();
