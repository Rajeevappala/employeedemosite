require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken, verifyToken } = require('./utils/tokenUtils');
const otpService = require('./services/otpService');
const fs = require('fs');
const path = require('path');

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

async function runVerificationSuite() {
  console.log('================================================================');
  console.log(' GAINTPRO HRM — LOGOUT, 12-HOUR SESSION & 120s OTP TEST SUITE   ');
  console.log('================================================================\n');

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

  const testUserIds = [];
  const testEmails = [];

  try {
    // -------------------------------------------------------------
    // 1. JWT 12-HOUR EXPIRY CONFIGURATION & GENERATION
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: 12-HOUR JWT EXPIRATION (43,200 SECONDS) ---');

    assert(
      process.env.JWT_EXPIRES_IN === '43200',
      `JWT_EXPIRES_IN environment variable is configured to 43200 (actual: ${process.env.JWT_EXPIRES_IN})`
    );

    const adminPayload = { userId: 99991, email: 'admin.test@gaintpro.com', role: 'ADMIN' };
    const adminToken = generateToken(adminPayload);
    const decodedAdmin = verifyToken(adminToken);

    const tokenDuration = decodedAdmin.exp - decodedAdmin.iat;
    assert(
      tokenDuration === 43200,
      `Generated Admin JWT duration (exp - iat) is exactly 43,200 seconds / 12 hours (actual: ${tokenDuration})`
    );

    const employeePayload = { userId: 99992, email: 'emp.test@gaintpro.com', role: 'EMPLOYEE', employeeId: 'GP0001N' };
    const employeeToken = generateToken(employeePayload);
    const decodedEmp = verifyToken(employeeToken);

    const empDuration = decodedEmp.exp - decodedEmp.iat;
    assert(
      empDuration === 43200,
      `Generated Employee JWT duration is exactly 43,200 seconds / 12 hours (actual: ${empDuration})`
    );

    // -------------------------------------------------------------
    // 2. EXPIRED JWT REJECTION BY AUTH UTILS & PROTECTED ENDPOINTS
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: EXPIRED JWT REJECTION ---');

    const expiredToken = generateToken(employeePayload, -60); // Expired 60s ago
    let verifyErrorCaught = false;
    let verifyErrorMessage = '';
    let verifyStatusCode = 0;
    try {
      verifyToken(expiredToken);
    } catch (err) {
      verifyErrorCaught = true;
      verifyErrorMessage = err.message;
      verifyStatusCode = err.statusCode;
    }

    assert(
      verifyErrorCaught && verifyStatusCode === 401,
      `verifyToken() throws HTTP 401 on expired token (actual status: ${verifyStatusCode})`
    );
    assert(
      verifyErrorMessage.includes('expired'),
      `verifyToken() error message identifies expired session: "${verifyErrorMessage}"`
    );

    // Protected endpoint tests against running server
    const meRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    });

    assert(
      meRes.statusCode === 401,
      `GET /api/auth/me rejects expired JWT with HTTP 401 Unauthorized (actual: ${meRes.statusCode})`
    );
    const meData = meRes.json();
    assert(
      meData && meData.message && meData.message.toLowerCase().includes('expired'),
      `GET /api/auth/me returns clear expired session message: "${meData?.message}"`
    );

    // -------------------------------------------------------------
    // 3. 2-MINUTE (120 SECONDS) OTP VALIDITY & ENFORCEMENT
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: 2-MINUTE (120 SECONDS) OTP LIFECYCLE ---');

    const testEmail = `otp.test.${Date.now()}@gaintpro.com`;
    testEmails.push(testEmail);

    const userInsert = await pool.query(
      `INSERT INTO users (email, role, status) VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id`,
      [testEmail]
    );
    const testUserId = userInsert.rows[0].id;
    testUserIds.push(testUserId);

    // Request OTP in test mode
    const requestResult = await otpService.requestOtp(testEmail, { isTestMode: true });
    assert(requestResult.success, 'OTP requested successfully');

    // Inspect database record for exact expiration interval
    const dbOtpRow = (
      await pool.query(
        `SELECT * FROM otp_verifications WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
        [testEmail]
      )
    ).rows[0];

    assert(Boolean(dbOtpRow), 'Database record found in otp_verifications');
    const createdTime = new Date(dbOtpRow.created_at).getTime();
    const expiresTime = new Date(dbOtpRow.expires_at).getTime();
    const expiryDiffSeconds = Math.round((expiresTime - createdTime) / 1000);

    assert(
      expiryDiffSeconds >= 118 && expiryDiffSeconds <= 122,
      `OTP expires_at is set to exactly 120 seconds / 2 minutes from creation (actual: ${expiryDiffSeconds}s)`
    );

    // Verify rate limit cooldown (60 seconds)
    let cooldownTriggered = false;
    let cooldownErrorMsg = '';
    try {
      await otpService.requestOtp(testEmail, { isTestMode: true });
    } catch (cdErr) {
      cooldownTriggered = cdErr.statusCode === 429;
      cooldownErrorMsg = cdErr.message;
    }
    assert(
      cooldownTriggered,
      `Immediate repeat OTP request triggers 60-second cooldown (429: "${cooldownErrorMsg}")`
    );

    // -------------------------------------------------------------
    // 4. EXPIRED OTP REJECTION ON VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: EXPIRED OTP REJECTION ---');

    // Create a user with an explicitly expired OTP
    const expiredEmail = `otp.expired.${Date.now()}@gaintpro.com`;
    testEmails.push(expiredEmail);

    const expUserInsert = await pool.query(
      `INSERT INTO users (email, role, status) VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id`,
      [expiredEmail]
    );
    testUserIds.push(expUserInsert.rows[0].id);

    // Insert an OTP that expired 10 seconds ago
    const expiredOtpCode = '123456';
    const secret = process.env.OTP_SECRET || process.env.SESSION_SECRET || 'dev_otp_pepper_employee_portal_2026';
    const expiredOtpHash = require('crypto')
      .createHash('sha256')
      .update(`${expiredOtpCode}:${secret}`)
      .digest('hex');

    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at, created_at, attempts)
       VALUES ($1, $2, $3, NOW() - INTERVAL '10 seconds', NOW() - INTERVAL '130 seconds', 0)`,
      [expUserInsert.rows[0].id, expiredEmail, expiredOtpHash]
    );

    let expiredOtpCaught = false;
    let expiredOtpError = '';
    try {
      await otpService.verifyOtp(expiredEmail, expiredOtpCode);
    } catch (expErr) {
      expiredOtpCaught = true;
      expiredOtpError = expErr.message;
    }

    assert(
      expiredOtpCaught && expiredOtpError.toLowerCase().includes('expired'),
      `Expired OTP is rejected by verifyOtp: "${expiredOtpError}"`
    );

    // -------------------------------------------------------------
    // 5. MAXIMUM FAILED ATTEMPTS (5) & REPLAY ATTACK PREVENTION
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: ATTEMPTS LIMIT & USED OTP REJECTION ---');

    const multiAttemptEmail = `otp.attempts.${Date.now()}@gaintpro.com`;
    testEmails.push(multiAttemptEmail);

    const multiUserInsert = await pool.query(
      `INSERT INTO users (email, role, status) VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id`,
      [multiAttemptEmail]
    );
    testUserIds.push(multiUserInsert.rows[0].id);

    const validCandidateOtp = '654321';
    const validCandidateHash = require('crypto')
      .createHash('sha256')
      .update(`${validCandidateOtp}:${secret}`)
      .digest('hex');

    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at, created_at, attempts)
       VALUES ($1, $2, $3, NOW() + INTERVAL '120 seconds', NOW(), 5)`,
      [multiUserInsert.rows[0].id, multiAttemptEmail, validCandidateHash]
    );

    let maxAttemptsCaught = false;
    let maxAttemptsError = '';
    try {
      await otpService.verifyOtp(multiAttemptEmail, validCandidateOtp);
    } catch (err) {
      maxAttemptsCaught = true;
      maxAttemptsError = err.message;
    }

    assert(
      maxAttemptsCaught && maxAttemptsError.toLowerCase().includes('maximum verification attempts exceeded'),
      `OTP with 5 failed attempts is blocked: "${maxAttemptsError}"`
    );

    // Test successful verification and prevention of replay (used OTP)
    const validVerifyEmail = `otp.valid.${Date.now()}@gaintpro.com`;
    testEmails.push(validVerifyEmail);

    const validUserInsert = await pool.query(
      `INSERT INTO users (email, role, status) VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id`,
      [validVerifyEmail]
    );
    testUserIds.push(validUserInsert.rows[0].id);

    const liveOtpCode = '888999';
    const liveOtpHash = require('crypto')
      .createHash('sha256')
      .update(`${liveOtpCode}:${secret}`)
      .digest('hex');

    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at, created_at, attempts)
       VALUES ($1, $2, $3, NOW() + INTERVAL '120 seconds', NOW(), 0)`,
      [validUserInsert.rows[0].id, validVerifyEmail, liveOtpHash]
    );

    // First verification within 120s must succeed
    const verifySuccess = await otpService.verifyOtp(validVerifyEmail, liveOtpCode);
    assert(
      Boolean(verifySuccess && verifySuccess.token),
      'Valid OTP within 120s verifies successfully and issues session token'
    );

    // Verify token issued has 12h expiry
    const issuedPayload = verifyToken(verifySuccess.token);
    assert(
      issuedPayload.exp - issuedPayload.iat === 43200,
      'Session token issued from OTP verification has 12-hour expiry (43,200s)'
    );

    // Replay attempt on the same OTP must fail
    let replayCaught = false;
    try {
      await otpService.verifyOtp(validVerifyEmail, liveOtpCode);
    } catch (replayErr) {
      replayCaught = true;
    }
    assert(replayCaught, 'Reusing a verified OTP is strictly rejected');

    // -------------------------------------------------------------
    // 6. FRONTEND LOGOUT CONFIRMATION MODAL & INTEGRATION AUDIT
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: FRONTEND LOGOUT CONFIRMATION MODAL AUDIT ---');

    const modalPath = path.resolve(__dirname, '../Frontend/src/components/LogoutConfirmModal/LogoutConfirmModal.jsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');

    assert(modalContent.includes('Confirm Logout'), 'LogoutConfirmModal contains title "Confirm Logout"');
    assert(modalContent.includes('Are you sure you want to log out?'), 'LogoutConfirmModal contains message "Are you sure you want to log out?"');
    assert(modalContent.includes('Cancel') && modalContent.includes('Yes, Logout'), 'LogoutConfirmModal contains "Cancel" and "Yes, Logout" buttons');
    assert(modalContent.includes("key === 'Escape'"), 'LogoutConfirmModal closes on Escape key');
    assert(modalContent.includes('isLoggingOut'), 'LogoutConfirmModal handles duplicate click prevention');

    const sidebarPath = path.resolve(__dirname, '../Frontend/src/components/Sidebar/Sidebar.jsx');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    assert(sidebarContent.includes('LogoutConfirmModal'), 'Sidebar integrates LogoutConfirmModal');
    assert(sidebarContent.includes('handleOpenLogout'), 'Sidebar logout button opens confirmation modal');

    const adminLayoutPath = path.resolve(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.jsx');
    const adminLayoutContent = fs.readFileSync(adminLayoutPath, 'utf8');
    assert(adminLayoutContent.includes('LogoutConfirmModal'), 'AdminLayout integrates LogoutConfirmModal');
    assert(adminLayoutContent.includes('admin-header-logout-btn'), 'AdminLayout header has logout button wired to modal');

    const navbarPath = path.resolve(__dirname, '../Frontend/src/components/Navbar/Navbar.jsx');
    const navbarContent = fs.readFileSync(navbarPath, 'utf8');
    assert(navbarContent.includes('LogoutConfirmModal'), 'Navbar integrates LogoutConfirmModal');

    const loginPath = path.resolve(__dirname, '../Frontend/src/pages/Login/Login.jsx');
    const loginContent = fs.readFileSync(loginPath, 'utf8');
    assert(loginContent.includes('otpExpiresIn'), 'Login.jsx maintains otpExpiresIn countdown state');
    assert(loginContent.includes('120'), 'Login.jsx sets initial OTP timer to 120 seconds');
    assert(loginContent.includes('Your session has expired. Please log in again.'), 'Login.jsx displays session expired notice');

  } catch (unexpectedErr) {
    console.error('Unexpected error in test suite:', unexpectedErr);
    failed++;
  } finally {
    // Cleanup created test records
    if (testEmails.length > 0) {
      await pool.query(`DELETE FROM otp_verifications WHERE email = ANY($1)`, [testEmails]).catch(() => {});
    }
    if (testUserIds.length > 0) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [testUserIds]).catch(() => {});
    }
  }

  console.log('\n================================================================');
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerificationSuite()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Fatal test error:', err);
    pool.end();
    process.exit(1);
  });
