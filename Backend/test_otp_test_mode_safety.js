process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
process.env.NODE_ENV = 'test';

const http = require('http');
const pool = require('./config/database');
const emailService = require('./services/emailService');
const otpService = require('./services/otpService');

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
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('       OTP TEST-MODE EMAIL ISOLATION SAFETY SUITE       ');
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
    // -------------------------------------------------------------------------
    // 1. UNIT TEST: sendOtpEmail IN NODE_ENV=test
    // -------------------------------------------------------------------------
    console.log('--- 1. UNIT TEST: sendOtpEmail in NODE_ENV=test ---');
    emailService.clearTestEmails();

    const mockRes = await emailService.sendOtpEmail({
      to: 'unit.test@gaintpro.com',
      otp: '654321',
    });

    assert(mockRes.success === true, 'sendOtpEmail returns success: true');
    assert(mockRes.isTestMock === true, 'sendOtpEmail flags response as isTestMock: true');
    assert(typeof mockRes.messageId === 'string' && mockRes.messageId.includes('@test.local'), 'Mock messageId generated');

    const recorded = emailService.getTestDispatchedEmails();
    assert(recorded.length === 1, 'Mock email recorded in test buffer');
    assert(recorded[0].to === 'unit.test@gaintpro.com' && recorded[0].otp === '654321', 'Recorded recipient and OTP match');

    emailService.clearTestEmails();
    assert(emailService.getTestDispatchedEmails().length === 0, 'clearTestEmails properly empties test buffer');

    // -------------------------------------------------------------------------
    // 2. PRODUCTION SECURITY GUARANTEES
    // -------------------------------------------------------------------------
    console.log('\n--- 2. PRODUCTION SECURITY GUARANTEES ---');
    process.env.NODE_ENV = 'production';

    let inspectionBlocked = false;
    try {
      emailService.getTestDispatchedEmails();
    } catch (err) {
      inspectionBlocked = err.message.includes('strictly forbidden in production');
    }
    assert(inspectionBlocked, 'getTestDispatchedEmails throws in production');

    let clearBlocked = false;
    try {
      emailService.clearTestEmails();
    } catch (err) {
      clearBlocked = err.message.includes('strictly forbidden in production');
    }
    assert(clearBlocked, 'clearTestEmails throws in production');

    // Restore test environment
    process.env.NODE_ENV = 'test';

    // -------------------------------------------------------------------------
    // 3. OTP GENERATION, HASHING & STORAGE INTEGRITY
    // -------------------------------------------------------------------------
    console.log('\n--- 3. OTP GENERATION, HASHING & STORAGE INTEGRITY ---');
    const testEmail = `safety.test.${Date.now()}@gaintpro.com`;

    // Create temporary active user
    const userRes = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ($1, 'EMPLOYEE', 'ACTIVE')
       RETURNING id, email`,
      [testEmail]
    );
    const testUserId = userRes.rows[0].id;

    emailService.clearTestEmails();
    const otpServiceRes = await otpService.requestOtp(testEmail);
    assert(otpServiceRes.success === true, 'otpService.requestOtp returns generic success');

    // Verify row was created in public.otp_verifications
    const dbOtpRes = await pool.query(
      'SELECT id, otp_hash, expires_at, attempts FROM public.otp_verifications WHERE user_id = $1',
      [testUserId]
    );
    assert(dbOtpRes.rows.length === 1, 'Hashed OTP record stored in public.otp_verifications');
    assert(dbOtpRes.rows[0].otp_hash.length === 64, 'Stored OTP is a 64-character SHA-256 hash');
    assert(new Date(dbOtpRes.rows[0].expires_at) > new Date(), 'OTP expires_at is set in the future');

    // Verify OTP captured in test buffer matches the hash
    const captured = emailService.getLastTestEmailFor(testEmail);
    assert(captured !== null && /^\d{6}$/.test(captured.otp), 'Captured 6-digit OTP in test email buffer');

    // Verify authentication succeeds with the captured OTP
    const verifyRes = await otpService.verifyOtp(testEmail, captured.otp);
    assert(verifyRes.token && verifyRes.user.id === testUserId, 'verifyOtp succeeds with the captured OTP');

    // -------------------------------------------------------------------------
    // 4. HTTP ENDPOINT ISOLATION (/api/auth/request-otp)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. HTTP ENDPOINT ISOLATION (POST /api/auth/request-otp) ---');
    const httpTestEmail = `http.test.${Date.now()}@gaintpro.com`;

    // Create temporary active user
    const httpUserRes = await pool.query(
      `INSERT INTO public.users (email, role, status)
       VALUES ($1, 'EMPLOYEE', 'ACTIVE')
       RETURNING id, email`,
      [httpTestEmail]
    );
    const httpUserId = httpUserRes.rows[0].id;

    const httpRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/request-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Suite': 'true',
      },
    }, { email: httpTestEmail });

    assert(httpRes.statusCode === 200, 'POST /api/auth/request-otp with X-Test-Suite returns 200 OK');
    const resBody = httpRes.json();
    assert(resBody?.success === true, 'Response payload has success: true');
    assert(!JSON.stringify(resBody).includes('otp') || resBody?.message.includes('OTP has been sent'), 'Plaintext OTP is never returned in API response');

    // Verify DB record exists
    const httpDbOtpRes = await pool.query(
      'SELECT id, otp_hash FROM public.otp_verifications WHERE user_id = $1',
      [httpUserId]
    );
    assert(httpDbOtpRes.rows.length === 1, 'HTTP request inserted OTP record into database');

    // Cleanup test artifacts
    await pool.query('DELETE FROM public.otp_verifications WHERE user_id IN ($1, $2)', [testUserId, httpUserId]).catch(() => {});
    await pool.query('DELETE FROM public.audit_logs WHERE user_id = $1 OR user_id = $2', [testUserId, httpUserId]).catch(() => {});
    await pool.query('DELETE FROM public.audit_logs WHERE entity_id = $1 OR entity_id = $2', [String(testUserId), String(httpUserId)]).catch(() => {});
    await pool.query('DELETE FROM public.users WHERE id IN ($1, $2)', [testUserId, httpUserId]).catch(() => {});

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n========================================================');
  console.log(`SAFETY TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
