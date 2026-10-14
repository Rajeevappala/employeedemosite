require('dotenv').config();
const { validateEnvironment } = require('./config/envValidator');
const { generateToken, verifyToken } = require('./utils/tokenUtils');
const otpService = require('./services/otpService');

async function run() {
  console.log('================================================================');
  console.log(' GAINTPRO HRM — SECRET CONFIGURATION & PRODUCTION GUARDS TEST');
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

  // Preserve original env variables for restoration
  const origEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // 1. Current Environment Configuration Audit (.env)
    // -------------------------------------------------------------------------
    console.log('--- 1. Current Environment Configuration Audit ---');
    const jwtSecret = process.env.JWT_SECRET;
    const otpSecret = process.env.OTP_SECRET;

    assert(Boolean(jwtSecret && jwtSecret.trim()), 'JWT_SECRET is configured and non-empty in .env');
    assert(Boolean(otpSecret && otpSecret.trim()), 'OTP_SECRET is configured and non-empty in .env');
    assert(jwtSecret && jwtSecret.length >= 32, `JWT_SECRET meets production length threshold (length: ${jwtSecret ? jwtSecret.length : 0} >= 32)`);
    assert(otpSecret && otpSecret.length >= 16, `OTP_SECRET meets production length threshold (length: ${otpSecret ? otpSecret.length : 0} >= 16)`);
    assert(jwtSecret !== otpSecret, 'JWT_SECRET and OTP_SECRET are independently generated and distinct');

    // -------------------------------------------------------------------------
    // 2. Production Fallback Guards: tokenUtils.js
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Production Fallback Guards (tokenUtils.js) ---');
    // Test that production throws on missing JWT_SECRET
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;

    let jwtMissingThrew = false;
    try {
      generateToken({ test: 1 });
    } catch (err) {
      jwtMissingThrew = true;
      assert(err.message.includes('JWT_SECRET must be configured'), 'tokenUtils throws in production when JWT_SECRET is missing');
    }
    assert(jwtMissingThrew, 'tokenUtils never silently uses development fallback for JWT in production');

    // Test that production throws on weak JWT_SECRET (< 32 chars)
    process.env.JWT_SECRET = 'short_secret_under_32_chars';
    let jwtWeakThrew = false;
    try {
      generateToken({ test: 1 });
    } catch (err) {
      jwtWeakThrew = true;
      assert(err.message.includes('must be at least 32 characters'), 'tokenUtils throws in production when JWT_SECRET is < 32 characters');
    }
    assert(jwtWeakThrew, 'tokenUtils enforces minimum 32 characters in production');

    // Test that production throws on whitespace-only JWT_SECRET
    process.env.JWT_SECRET = '   ';
    let jwtWhitespaceThrew = false;
    try {
      generateToken({ test: 1 });
    } catch (err) {
      jwtWhitespaceThrew = true;
      assert(err.message.includes('JWT_SECRET must be configured'), 'tokenUtils throws in production on whitespace-only secret');
    }
    assert(jwtWhitespaceThrew, 'tokenUtils rejects whitespace-only JWT secret in production');

    // -------------------------------------------------------------------------
    // 3. Production Fallback Guards: otpService.js
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Production Fallback Guards (otpService.js) ---');
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_SECRET;
    delete process.env.SESSION_SECRET;

    let otpMissingThrew = false;
    try {
      otpService.hashOtp('123456');
    } catch (err) {
      otpMissingThrew = true;
      assert(err.message.includes('OTP_SECRET'), 'otpService throws in production when OTP_SECRET is missing');
    }
    assert(otpMissingThrew, 'otpService never silently uses development fallback salt in production');

    // Test that production throws on weak OTP_SECRET (< 16 chars)
    process.env.OTP_SECRET = 'short_salt';
    let otpWeakThrew = false;
    try {
      otpService.hashOtp('123456');
    } catch (err) {
      otpWeakThrew = true;
      assert(err.message.includes('must be at least 16 characters'), 'otpService throws in production when OTP_SECRET is < 16 characters');
    }
    assert(otpWeakThrew, 'otpService enforces minimum 16 characters in production');

    // Test that production throws on whitespace-only OTP_SECRET
    process.env.OTP_SECRET = '   ';
    let otpWhitespaceThrew = false;
    try {
      otpService.hashOtp('123456');
    } catch (err) {
      otpWhitespaceThrew = true;
      assert(err.message.includes('OTP_SECRET'), 'otpService throws in production on whitespace-only OTP secret');
    }
    assert(otpWhitespaceThrew, 'otpService rejects whitespace-only OTP secret in production');

    // -------------------------------------------------------------------------
    // 4. Token & Hash Behavior with Active Environment Secrets
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Active Token Signing & Verification ---');
    // Restore original configured environment
    process.env = { ...origEnv };

    const testPayload = { userId: 'test-user-id-123', email: 'test@gaintpro.com', role: 'ADMIN' };
    const signedToken = generateToken(testPayload, 3600);
    assert(typeof signedToken === 'string' && signedToken.split('.').length === 3, 'generateToken returns valid 3-part JWT structure');

    const decoded = verifyToken(signedToken);
    assert(decoded.userId === testPayload.userId, 'verifyToken successfully verifies token signed with active JWT_SECRET');
    assert(decoded.role === testPayload.role, 'Decoded token matches original role payload');

    const testOtpHash = otpService.hashOtp('654321');
    assert(typeof testOtpHash === 'string' && testOtpHash.length === 64, 'hashOtp generates standard SHA-256 hex string with active OTP_SECRET');
    assert(otpService.verifyOtpHash('654321', testOtpHash), 'verifyOtpHash correctly verifies candidate against hash');
    assert(!otpService.verifyOtpHash('111111', testOtpHash), 'verifyOtpHash rejects mismatched candidate');

    // -------------------------------------------------------------------------
    // 5. Startup Warning Suppression Check in Development
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Development Startup Warning Suppression ---');
    // Intercept console.warn to verify that no warnings are emitted when secrets are configured
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    validateEnvironment();
    console.warn = origWarn;

    const secretWarnings = warnings.filter(w => w.includes('JWT_SECRET') || w.includes('OTP_SECRET'));
    assert(secretWarnings.length === 0, `No missing secret warnings emitted during development startup (warnings: ${secretWarnings.length})`);

    console.log('\n================================================================');
    console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    process.env = origEnv;
  }
}

run();
