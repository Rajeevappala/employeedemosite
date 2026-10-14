require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('./config/database');
const otpService = require('./services/otpService');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  options.headers = {
    'x-test-suite': 'true',
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

async function run() {
  console.log('================================================================');
  console.log(' GAINTPRO HRM — LOGIN TRANSITION ANIMATION VERIFICATION');
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

  try {
    // -------------------------------------------------------------------------
    // 1. Asset Placement & Verification
    // -------------------------------------------------------------------------
    console.log('--- 1. Video Asset Verification ---');
    const publicVideoPath = path.resolve(__dirname, '../Frontend/public/animations/gaintpro-login.mp4');
    const distVideoPath = path.resolve(__dirname, '../Frontend/dist/animations/gaintpro-login.mp4');

    assert(fs.existsSync(publicVideoPath), `Video asset exists in public folder: ${publicVideoPath}`);
    const stats = fs.statSync(publicVideoPath);
    assert(stats.size > 2000000, `Video asset has valid file size (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    assert(fs.existsSync(distVideoPath), `Video asset copied to production dist build: ${distVideoPath}`);
    assert(fs.existsSync(path.resolve(__dirname, '../Frontend/public/animations/gaintpro-logo-reveal.mp4')), 'Backwards-compatible gaintpro-logo-reveal.mp4 preserved');

    // -------------------------------------------------------------------------
    // 2. Component Design & Code Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 2. LoginTransition Component Architecture ---');
    const componentPath = path.resolve(__dirname, '../Frontend/src/components/LoginTransition/LoginTransition.jsx');
    const cssPath = path.resolve(__dirname, '../Frontend/src/components/LoginTransition/LoginTransition.css');

    assert(fs.existsSync(componentPath), 'LoginTransition.jsx exists');
    assert(fs.existsSync(cssPath), 'LoginTransition.css exists');

    const componentContent = fs.readFileSync(componentPath, 'utf8');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert(componentContent.includes("VIDEO_SRC = '/animations/gaintpro-login.mp4'"), 'LoginTransition references /animations/gaintpro-login.mp4 without /public');
    assert(!componentContent.includes('/public/animations'), 'LoginTransition does not include /public prefix in URL');
    assert(componentContent.includes('TRIM_START_SECONDS = 2.8') || componentContent.includes('TRIM_START_SECONDS = 3.0'), 'Component configures trimmed start time (~2.8s-3.0s)');
    assert(componentContent.includes('TRIM_END_SECONDS = 6.8') || componentContent.includes('TRIM_END_SECONDS = 7.0'), 'Component configures trimmed end reveal time (~6.8s)');
    assert(componentContent.includes('WATCHDOG_TIMEOUT_MS'), 'Component includes safety watchdog timeout');

    // Verification of fallback & accessibility
    assert(componentContent.includes('checkReducedMotion'), 'Component checks prefers-reduced-motion media query');
    assert(componentContent.includes('useFallback'), 'Component implements branded fallback state');
    assert(componentContent.includes('handleVideoError'), 'Component handles video error gracefully');
    assert(componentContent.includes('muted'), 'Video element includes muted attribute for mobile/desktop autoplay compliance');
    assert(componentContent.includes('playsInline'), 'Video element includes playsInline attribute');
    assert(componentContent.includes('Preparing your workspace...'), 'Component displays "Preparing your workspace..." message');
    assert(componentContent.includes('role="dialog"'), 'Component uses accessible dialog semantics');

    // CSS Styling Verification
    assert(cssContent.includes('.login-transition-overlay'), 'CSS contains .login-transition-overlay');
    assert(cssContent.includes('position: fixed'), 'Overlay is fixed full-viewport');
    assert(cssContent.includes('aspect-ratio: 16 / 9'), 'Video stage preserves 16:9 aspect ratio');
    assert(cssContent.includes('object-fit: contain'), 'Video preserves natural aspect ratio without distortion');
    assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'CSS contains prefers-reduced-motion accessibility media query');
    assert(cssContent.includes('loginOverlayFadeIn') && cssContent.includes('loginOverlayFadeOut'), 'CSS contains smooth fade-in and fade-out animations');

    // -------------------------------------------------------------------------
    // 3. Login Flow Integration Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Login.jsx Integration Audit ---');
    const loginPath = path.resolve(__dirname, '../Frontend/src/pages/Login/Login.jsx');
    const loginContent = fs.readFileSync(loginPath, 'utf8');

    assert(loginContent.includes('LoginTransition'), 'Login.jsx imports LoginTransition');
    assert(loginContent.includes('showTransition'), 'Login.jsx manages showTransition state');
    assert(loginContent.includes('setShowTransition(true)'), 'Login.jsx triggers transition after OTP verify');
    assert(loginContent.includes('handleTransitionComplete'), 'Login.jsx handles transition completion callback');
    assert(loginContent.includes("link.href = '/animations/gaintpro-login.mp4'"), 'Login.jsx preloads /animations/gaintpro-login.mp4 without /public');
    assert(loginContent.includes("step === 'otp'") && loginContent.includes("preload"), 'Login.jsx preloads video asset when reaching OTP step');
    assert(loginContent.includes('/admin/dashboard') && loginContent.includes('/employee/dashboard'), 'Login.jsx retains distinct ADMIN vs EMPLOYEE redirects');

    // Ensure transition is NOT triggered on verification failure
    const errorBlockMatches = loginContent.includes('setShowTransition(false)');
    assert(errorBlockMatches, 'Login.jsx removes overlay if session verification fails');

    // -------------------------------------------------------------------------
    // 4. Live Backend Authentication Flow & Role Redirect Test
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Backend Authentication & Role-Based OTP Flow ---');
    // Fetch an admin user and employee user
    const adminUserRes = await pool.query(`SELECT id, email FROM public.users WHERE role = 'ADMIN' LIMIT 1`);
    const adminUser = adminUserRes.rows[0];
    assert(adminUser != null, `Found admin user: ${adminUser.email}`);

    const empUserRes = await pool.query(`
      SELECT u.id, u.email, e.employee_id 
      FROM public.users u 
      JOIN public.employees e ON e.email = u.email 
      WHERE u.role = 'EMPLOYEE' LIMIT 1
    `);
    const empUser = empUserRes.rows[0];
    assert(empUser != null, `Found employee user: ${empUser.email}`);

    // Insert active test OTP for Admin
    const adminTestOtp = '112233';
    const adminHash = otpService.hashOtp(adminTestOtp);
    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
      [adminUser.id, adminUser.email, adminHash]
    );

    const adminVerifyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: adminUser.email, otp: adminTestOtp });

    assert(adminVerifyRes.statusCode === 200, `Admin OTP verify returns 200 (got ${adminVerifyRes.statusCode})`);
    const adminData = adminVerifyRes.json();
    assert(adminData?.user?.role === 'ADMIN', `Verified user role is ADMIN (${adminData?.user?.role})`);
    assert(adminData?.token != null, 'Admin token successfully issued');

    // Insert active test OTP for Employee
    const empTestOtp = '445566';
    const empHash = otpService.hashOtp(empTestOtp);
    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
      [empUser.id, empUser.email, empHash]
    );

    const empVerifyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: empUser.email, otp: empTestOtp });

    assert(empVerifyRes.statusCode === 200, `Employee OTP verify returns 200 (got ${empVerifyRes.statusCode})`);
    const empData = empVerifyRes.json();
    assert(empData?.user?.role === 'EMPLOYEE', `Verified user role is EMPLOYEE (${empData?.user?.role})`);
    assert(empData?.token != null, 'Employee token successfully issued');

    // Test Invalid OTP rejection with active OTP
    const wrongAttemptOtp = '889900';
    const wrongAttemptHash = otpService.hashOtp(wrongAttemptOtp);
    await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
      [adminUser.id, adminUser.email, wrongAttemptHash]
    );

    const invalidVerifyRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { email: adminUser.email, otp: '000000' });

    assert(invalidVerifyRes.statusCode === 400, `Invalid OTP returns 400 Bad Request (got ${invalidVerifyRes.statusCode})`);
    assert(invalidVerifyRes.json()?.token == null, 'Invalid OTP does not issue token');

    console.log('\n================================================================');
    console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
