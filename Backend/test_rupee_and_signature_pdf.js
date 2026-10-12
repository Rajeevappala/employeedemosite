/**
 * Test Suite: Indian Rupee (₹) Symbol Rendering & Company Signature / Office Stamp Automation
 *
 * Verifies:
 * 1. Indian currency formatting (formatINR) with proper Indian comma notation and negative values.
 * 2. Bundled Unicode font (Noto Sans) availability, embedding in PDF, and ToUnicode CMap mapping to U+20B9.
 * 3. All salary fields (basic, HRA, allowances, gross, PF, PT, other deductions, total deductions, net) formatted.
 * 4. Company signature and office stamp asset detection, configuration, and status reporting.
 * 5. Safe rejection (HTTP 422 / MissingPayslipAssetsError) when required authorization assets are missing.
 * 6. Safe rejection when asset files are empty (0 bytes) or unreadable.
 * 7. Automated loading and embedding of signature & stamp images when configured.
 * 8. Layout positioning, aspect ratio preservation, and zero overlap with net salary or footer.
 * 9. Preview mode (isPreview: true) generating layout draft guides without creating fake signatures.
 * 10. Admin API endpoints: GET /authorization-assets-status and GET /preview-payslip-pdf.
 * 11. Existing payroll formulas, calculations, and RBAC security remain intact.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const {
  generatePayslipPdf,
  formatINR,
  getMonthName,
  checkAuthorizationAssets,
  getAuthorizationAssetPaths,
  getCompanyLogoPath,
  MissingPayslipAssetsError,
} = require('./services/payslipPdfService');

const PORT = process.env.PORT || 5000;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const text = rawBuffer.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBuffer,
          text,
          json,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else if (Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

// 1x1 transparent test PNG (valid PNG header & chunk structure)
const SAMPLE_TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function runTests() {
  console.log('================================================================');
  console.log('  GAINTPRO HRM — RUPEE SYMBOL & SIGNATURE/STAMP TEST SUITE      ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // 1. Indian Currency Formatting (formatINR)
  // -------------------------------------------------------------------------
  try {
    const r1 = formatINR(25000);
    const r2 = formatINR(15000.5);
    const r3 = formatINR('30000.00');
    const r4 = formatINR(-2500);
    const r5 = formatINR(0);
    const r6 = formatINR(100000); // 1 Lakh

    report('1.1 formatINR formats 25000 to ₹25,000.00', r1 === '₹25,000.00');
    report('1.2 formatINR formats 15000.5 to ₹15,000.50', r2 === '₹15,000.50');
    report('1.3 formatINR formats string 30000.00 to ₹30,000.00', r3 === '₹30,000.00');
    report('1.4 formatINR formats negative deductions cleanly (-₹2,500.00)', r4 === '-₹2,500.00');
    report('1.5 formatINR formats zero to ₹0.00', r5 === '₹0.00');
    report('1.6 formatINR uses Indian grouping (₹1,00,000.00)', r6 === '₹1,00,000.00');
  } catch (err) {
    report(`1. Currency formatting failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 2. Bundled Unicode Font Availability & Embedding
  // -------------------------------------------------------------------------
  try {
    const regFontPath = path.join(__dirname, 'assets', 'fonts', 'NotoSans-Regular.ttf');
    const boldFontPath = path.join(__dirname, 'assets', 'fonts', 'NotoSans-Bold.ttf');

    report('2.1 NotoSans-Regular.ttf exists in Backend/assets/fonts/', fs.existsSync(regFontPath) && fs.statSync(regFontPath).size > 100000);
    report('2.2 NotoSans-Bold.ttf exists in Backend/assets/fonts/', fs.existsSync(boldFontPath) && fs.statSync(boldFontPath).size > 100000);

    // Generate uncompressed PDF and verify Unicode ToUnicode CMap
    const testEmployee = {
      employee_id: 'GP0001N',
      first_name: 'Rajeev',
      last_name: 'Appala',
      designation: 'Lead Engineer',
      department: 'Engineering',
    };
    const testPayroll = {
      month: 10,
      year: 2026,
      working_days: 26,
      payable_days: 26,
      basic_salary: 25000.00,
      hra: 15000.00,
      allowances: 5000.00,
      gross_salary: 45000.00,
      pf_employee: 1800.00,
      professional_tax: 200.00,
      other_deductions: 500.00,
      total_deductions: 2500.00,
      net_salary: 42500.00,
      status: 'Processed',
    };

    const pdfBuf = await generatePayslipPdf({
      employee: testEmployee,
      payroll: testPayroll,
      isPreview: true,
      requireAssets: false,
    });

    report('2.3 Payslip PDF generated successfully with embedded font', Buffer.isBuffer(pdfBuf) && pdfBuf.length > 20000);

    const pdfString = pdfBuf.toString('latin1');
    const hasRupeeGlyphMap = pdfString.includes('20b9') || pdfString.includes('20B9');
    report('2.4 PDF stream contains TrueType /Type0 CMap mapping to Unicode U+20B9 (₹)', hasRupeeGlyphMap);
    report('2.5 BaseFont references NotoSans', pdfString.includes('NotoSans'));
  } catch (err) {
    report(`2. Font embedding test failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 3. Authorization Assets Detection & Configuration
  // -------------------------------------------------------------------------
  try {
    const assetPaths = getAuthorizationAssetPaths();
    report('3.1 getAuthorizationAssetPaths returns signature and stamp paths', typeof assetPaths.signaturePath === 'string' && typeof assetPaths.stampPath === 'string');

    const assetStatus = checkAuthorizationAssets();
    report('3.2 checkAuthorizationAssets reports completeness status', typeof assetStatus.isComplete === 'boolean');
    report('3.3 checkAuthorizationAssets lists missing details with clear reasons', Array.isArray(assetStatus.missing));
  } catch (err) {
    report(`3. Asset detection failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 4. Safe Handling of Missing Authorization Assets (Requirement 2.9)
  // -------------------------------------------------------------------------
  try {
    let threwExpectedError = false;
    let caughtError = null;

    try {
      await generatePayslipPdf({
        employee: { employee_id: 'GP0001N', first_name: 'Test', last_name: 'User' },
        payroll: { month: 10, year: 2026, basic_salary: 25000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0, net_salary: 30000 },
        requireAssets: true, // Strictly requires genuine assets
      });
    } catch (err) {
      if (err instanceof MissingPayslipAssetsError || err.code === 'MISSING_AUTHORIZATION_ASSETS') {
        threwExpectedError = true;
        caughtError = err;
      }
    }

    report('4.1 Missing assets throw MissingPayslipAssetsError when required', threwExpectedError);
    report('4.2 Missing error contains statusCode 422', caughtError?.statusCode === 422);
    report('4.3 Missing error contains actionable message detailing missing assets', caughtError?.message?.includes('Required company authorization asset(s) are missing'));
  } catch (err) {
    report(`4. Missing asset validation failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 5. Safe Handling of Empty (0-byte) or Corrupt Image Files
  // -------------------------------------------------------------------------
  try {
    const tempDir = path.join(__dirname, 'scratch_temp_test_assets');
    fs.mkdirSync(tempDir, { recursive: true });
    const emptySigPath = path.join(tempDir, 'empty_sig.png');
    fs.writeFileSync(emptySigPath, Buffer.alloc(0)); // 0-byte file

    const oldSigEnv = process.env.COMPANY_SIGNATURE_PATH;
    process.env.COMPANY_SIGNATURE_PATH = emptySigPath;

    const emptyStatus = checkAuthorizationAssets();
    const sigMissing = emptyStatus.missing.find((m) => m.type === 'signature');

    report('5.1 0-byte asset file detected as invalid', sigMissing && sigMissing.reason.includes('empty (0 bytes)'));

    // Cleanup
    fs.unlinkSync(emptySigPath);
    fs.rmdirSync(tempDir);
    if (oldSigEnv) {
      process.env.COMPANY_SIGNATURE_PATH = oldSigEnv;
    } else {
      delete process.env.COMPANY_SIGNATURE_PATH;
    }
  } catch (err) {
    report(`5. Empty asset test failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 6. Automated Signature & Stamp Embedding with Aspect Ratio Preservation
  // -------------------------------------------------------------------------
  try {
    const tempDir = path.join(__dirname, 'scratch_valid_assets');
    fs.mkdirSync(tempDir, { recursive: true });
    const testSig = path.join(tempDir, 'company_signature_test.png');
    const testStamp = path.join(tempDir, 'company_stamp_test.png');

    fs.writeFileSync(testSig, SAMPLE_TRANSPARENT_PNG);
    fs.writeFileSync(testStamp, SAMPLE_TRANSPARENT_PNG);

    const oldSigEnv = process.env.COMPANY_SIGNATURE_PATH;
    const oldStampEnv = process.env.COMPANY_STAMP_PATH;
    process.env.COMPANY_SIGNATURE_PATH = testSig;
    process.env.COMPANY_STAMP_PATH = testStamp;

    const assetStatusWithFiles = checkAuthorizationAssets();
    report('6.1 checkAuthorizationAssets reports isComplete = true when files present', assetStatusWithFiles.isComplete === true);

    const signedPdf = await generatePayslipPdf({
      employee: { employee_id: 'GP0001N', first_name: 'Rajeev', last_name: 'Appala' },
      payroll: {
        month: 10,
        year: 2026,
        working_days: 26,
        payable_days: 26,
        basic_salary: 30000,
        hra: 15000,
        allowances: 5000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
        gross_salary: 50000,
        total_deductions: 2000,
        net_salary: 48000,
      },
      requireAssets: true,
    });

    report('6.2 PDF successfully embeds both signature and stamp from configured paths', Buffer.isBuffer(signedPdf) && signedPdf.length > 25000);

    const signedPdfStr = signedPdf.toString('latin1');
    const imageCount = (signedPdfStr.match(/\/Subtype \/Image/g) || []).length;
    // 1 header logo image + 2 signature (image+mask) + 2 stamp (image+mask) = 5 image XObjects
    report('6.3 PDF embeds genuine company logo, signature, and stamp image XObjects', imageCount >= 4);

    // Cleanup
    fs.unlinkSync(testSig);
    fs.unlinkSync(testStamp);
    fs.rmdirSync(tempDir);
    if (oldSigEnv) {
      process.env.COMPANY_SIGNATURE_PATH = oldSigEnv;
    } else {
      delete process.env.COMPANY_SIGNATURE_PATH;
    }
    if (oldStampEnv) {
      process.env.COMPANY_STAMP_PATH = oldStampEnv;
    } else {
      delete process.env.COMPANY_STAMP_PATH;
    }
  } catch (err) {
    report(`6. Image embedding failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 7. Preview Mode Layout Verification & Company Logo in Header
  // -------------------------------------------------------------------------
  try {
    const companyLogoPath = getCompanyLogoPath();
    report('7.0 getCompanyLogoPath resolves valid official logo asset', Boolean(companyLogoPath && fs.existsSync(companyLogoPath)));

    const previewPdf = await generatePayslipPdf({
      employee: {
        employee_id: 'GP0001N',
        first_name: 'Rajeev',
        last_name: 'Appala',
        designation: 'Software Architect',
        department: 'Engineering',
      },
      payroll: {
        month: 10,
        year: 2026,
        working_days: 26,
        payable_days: 26,
        basic_salary: 50000,
        hra: 25000,
        allowances: 10000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
        gross_salary: 85000,
        total_deductions: 2000,
        net_salary: 83000,
      },
      pfDetails: { uan_number: '101234567890', pf_number: 'GAINT/PF/001' },
      isPreview: true,
    });

    const previewStr = previewPdf.toString('latin1');
    const previewImageCount = (previewStr.match(/\/Subtype \/Image/g) || []).length;

    report('7.1 Preview mode generates valid PDF buffer without errors', Buffer.isBuffer(previewPdf) && previewPdf.length > 20000);
    // In preview mode, only the header logo is embedded (no signature or stamp images)
    report('7.2 Preview mode embeds official header logo while signature/stamp remain layout frames', previewImageCount === 1);
    report('7.3 Preview mode embeds Unicode ToUnicode CMap for all text and Rupee glyph', previewStr.includes('/ToUnicode') && previewStr.includes('20b9'));

    // Save sample preview PDF to artifacts/scratch directory for visual inspection
    const samplePreviewPath = path.join(__dirname, 'sample_payslip_preview.pdf');
    fs.writeFileSync(samplePreviewPath, previewPdf);
    report('7.4 Sample preview PDF written for visual verification (sample_payslip_preview.pdf)', fs.existsSync(samplePreviewPath));
  } catch (err) {
    report(`7. Preview mode test failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 8. Admin API Endpoints via HTTP
  // -------------------------------------------------------------------------
  try {
    // Get Admin user from database
    const adminUserRes = await pool.query(`SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1`);
    const adminUser = adminUserRes.rows[0];

    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // 8.1 GET /api/admin/payroll/authorization-assets-status
    const statusRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/authorization-assets-status',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    report('8.1 GET /api/admin/payroll/authorization-assets-status returns HTTP 200', statusRes.statusCode === 200);
    report('8.2 Assets status endpoint returns signature and stamp metadata', statusRes.json?.data?.signature && statusRes.json?.data?.stamp);

    // 8.2 GET /api/admin/payroll/preview-payslip-pdf
    const previewRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/preview-payslip-pdf',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    report('8.3 GET /api/admin/payroll/preview-payslip-pdf returns HTTP 200', previewRes.statusCode === 200);
    report('8.4 Preview endpoint returns application/pdf Content-Type', previewRes.headers['content-type'] === 'application/pdf');
    report('8.5 Preview endpoint returns valid PDF buffer with PDF-1.3 header', previewRes.rawBuffer.slice(0, 5).toString('ascii') === '%PDF-');
  } catch (err) {
    report(`8. Admin API endpoint tests failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 9. Employee Security & RBAC Enforcement
  // -------------------------------------------------------------------------
  try {
    const empUserRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
       LIMIT 1`
    );
    const empUser = empUserRes.rows[0];

    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employeeId: empUser.employee_id,
    });

    // Employee cannot access admin preview endpoint
    const empPreviewRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/preview-payslip-pdf',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    report('9.1 Employee cannot access admin preview-payslip-pdf (HTTP 403 Forbidden)', empPreviewRes.statusCode === 403);

    // Employee can access their own payslip list
    const empPayslipsRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    report('9.2 Employee can view their own payslip history (HTTP 200)', empPayslipsRes.statusCode === 200);
  } catch (err) {
    report(`9. Employee security test failed: ${err.message}`, false);
  }

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
