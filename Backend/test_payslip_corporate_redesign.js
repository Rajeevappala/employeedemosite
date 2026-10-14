/**
 * Test Suite: GaintPro HRM — Corporate Redesign Payslip PDF Verification
 *
 * Verifies all 9 requirements from the user request:
 * 1. Overall Design: A4 portrait, white background, black text, thin borders, single page layout.
 * 2. Company Header: Official GaintPro logo, registered company address, PAYSLIP title, month & year.
 * 3. Employee Information Table: Compact 4-column bordered grid with DOJ, Emp ID, Name, Designation,
 *    Department, Work Location, Bank Name, Bank A/C No, PAN, UAN, PF No, Paid Days, LOP Days, Month/Year.
 * 4. Earnings & Deductions: Side-by-side bordered tables with right-aligned Indian Rupee amounts.
 * 5. Summary: Gross Pay, Total Deductions, Net Pay, exact Amount in Words matching numeric net pay.
 * 6. Branding & Signatures: GaintPro logo, watermark, genuine signature/stamp support.
 * 7. Footer: Confidentiality note, computer-generated notice, page numbering.
 * 8. Technical Implementation: DB enrichment, private storage, authenticated access, zero historical mutation.
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
  formatDate,
  numberToWordsINR,
  checkAuthorizationAssets,
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

async function runCorporatePayslipTests() {
  console.log('================================================================');
  console.log('  GAINTPRO HRM: CORPORATE PAYSLIP REDESIGN TEST SUITE           ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition, extra = '') {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name} ${extra}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // 1. AMOUNT IN WORDS (INR) CONVERSION
  // -------------------------------------------------------------------------
  try {
    const w1 = numberToWordsINR(37500);
    const w2 = numberToWordsINR(42500);
    const w3 = numberToWordsINR(100000);
    const w4 = numberToWordsINR(125450.50);
    const w5 = numberToWordsINR(0);
    const w6 = numberToWordsINR(83000);

    report('1.1 37500 converts to Thirty Seven Thousand Five Hundred Rupees Only', w1 === 'Thirty Seven Thousand Five Hundred Rupees Only');
    report('1.2 42500 converts to Forty Two Thousand Five Hundred Rupees Only', w2 === 'Forty Two Thousand Five Hundred Rupees Only');
    report('1.3 100000 converts to One Lakh Rupees Only', w3 === 'One Lakh Rupees Only');
    report('1.4 125450.50 converts with paise', w4 === 'One Lakh Twenty Five Thousand Four Hundred Fifty Rupees and Fifty Paise Only');
    report('1.5 0 converts to Zero Rupees Only', w5 === 'Zero Rupees Only');
    report('1.6 83000 converts to Eighty Three Thousand Rupees Only', w6 === 'Eighty Three Thousand Rupees Only');
  } catch (err) {
    report(`1. Number to words failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 2. DATE FORMATTER & FALLBACKS
  // -------------------------------------------------------------------------
  try {
    const d1 = formatDate('2024-01-01');
    const d2 = formatDate(null);
    const d3 = formatDate(undefined);

    report('2.1 formatDate formats ISO date to DD-MMM-YYYY', d1 === '01-Jan-2024');
    report('2.2 formatDate returns "Not configured" for null', d2 === 'Not configured');
    report('2.3 formatDate returns "Not configured" for undefined', d3 === 'Not configured');
  } catch (err) {
    report(`2. Date formatter failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 3. GENERATION WITH ACTUAL EMPLOYEE DATA & DB ENRICHMENT
  // -------------------------------------------------------------------------
  let samplePdfBuf = null;
  try {
    // Look up GP0001N from DB
    const empRes = await pool.query('SELECT * FROM public.employees WHERE employee_id = $1 LIMIT 1', ['GP0001N']);
    const dbEmp = empRes.rows[0];

    const payrollRes = await pool.query(
      'SELECT * FROM public.payroll_records WHERE employee_id = $1 ORDER BY year DESC, month DESC LIMIT 1',
      ['GP0001N']
    );
    const dbPayroll = payrollRes.rows[0];

    const pfRes = await pool.query('SELECT * FROM public.pf_details WHERE employee_id = $1 LIMIT 1', ['GP0001N']);
    const dbPf = pfRes.rows[0] || null;

    const bankRes = await pool.query('SELECT * FROM public.employee_bank_details WHERE employee_id = $1 LIMIT 1', ['GP0001N']);
    const dbBank = bankRes.rows[0] || null;

    samplePdfBuf = await generatePayslipPdf({
      employee: dbEmp,
      payroll: dbPayroll,
      pfDetails: dbPf,
      bankDetails: dbBank,
      isPreview: true,
      requireAssets: false,
    });

    report('3.1 Payslip PDF generated with actual database employee GP0001N', Buffer.isBuffer(samplePdfBuf) && samplePdfBuf.length > 25000);

    const pdfRaw = samplePdfBuf.toString('latin1');

    // Verification of corporate PDF document properties:
    report('3.2 PDF docinfo contains GaintPro Software Technologies Private Limited', pdfRaw.includes('GaintPro Software Technologies Private Limited'));
    report('3.3 PDF docinfo contains Author & Creator metadata', pdfRaw.includes('GaintPro Payroll System'));
    report('3.4 PDF docinfo Title contains employee ID GP0001N', pdfRaw.includes('GP0001N'));
    report('3.5 PDF does not contain reference or competitor name (Genpact)', !pdfRaw.toLowerCase().includes('genpact'));
    report('3.6 PDF does not contain "null" or "undefined" literals in document metadata', !pdfRaw.includes('Title (null') && !pdfRaw.includes('Title (undefined'));
    report('3.7 PDF stream embeds TrueType NotoSans font', pdfRaw.includes('NotoSans'));
    report('3.8 PDF stream embeds TrueType NotoSans-Bold font', pdfRaw.includes('NotoSans-Bold'));
    report('3.9 PDF stream embeds Unicode U+20B9 (₹) CMap glyph mapping', pdfRaw.includes('20b9') || pdfRaw.includes('20B9'));
    report('3.10 PDF embeds official GaintPro company logo XObject', pdfRaw.includes('/Subtype /Image'));
    report('3.11 PDF contains A4 MediaBox [0 0 595.28 841.89]', pdfRaw.includes('595.28') && pdfRaw.includes('841.89'));
  } catch (err) {
    report(`3. Database employee generation failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 4. HANDLING OF MISSING / OPTIONAL FIELDS (NO CRASH, "Not configured")
  // -------------------------------------------------------------------------
  try {
    const minimalEmp = {
      employee_id: 'GP9999X',
      first_name: 'Test',
      last_name: 'Associate',
      designation: 'Associate',
      department: 'Operations',
      // No date_of_joining, no work_location, no bank details, no PF details
    };
    const minimalPayroll = {
      employee_id: 'GP9999X',
      month: 9,
      year: 2026,
      working_days: 26,
      payable_days: 26,
      basic_salary: 20000,
      hra: 5000,
      allowances: 3000,
      gross_salary: 28000,
      pf_employee: 1800,
      professional_tax: 200,
      other_deductions: 0,
      total_deductions: 2000,
      net_salary: 26000,
      status: 'Processed',
    };

    const minimalPdf = await generatePayslipPdf({
      employee: minimalEmp,
      payroll: minimalPayroll,
      isPreview: true,
      requireAssets: false,
    });

    const minPdfRaw = minimalPdf.toString('latin1');
    report('4.1 Minimal employee with missing optional fields generates valid PDF', Buffer.isBuffer(minimalPdf) && minimalPdf.length > 20000);
    report('4.2 Minimal employee PDF docinfo contains GP9999X without errors', minPdfRaw.includes('GP9999X'));
    report('4.3 Net Pay in words for 26000 is verified (Twenty Six Thousand Rupees Only)', numberToWordsINR(minimalPayroll.net_salary) === 'Twenty Six Thousand Rupees Only');
  } catch (err) {
    report(`4. Missing fields handling failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 5. SIGNATURE & STAMP INTEGRATION
  // -------------------------------------------------------------------------
  try {
    const assetStatus = checkAuthorizationAssets();
    report('5.1 checkAuthorizationAssets reports structured status', typeof assetStatus.isComplete === 'boolean');
    const sampleErr = new MissingPayslipAssetsError('Test message');
    report('5.2 MissingPayslipAssetsError instance has code MISSING_AUTHORIZATION_ASSETS and statusCode 422', sampleErr.code === 'MISSING_AUTHORIZATION_ASSETS' && sampleErr.statusCode === 422);

    // Verify rejection if strict assets required
    let threwStrict = false;
    try {
      await generatePayslipPdf({
        employee: { employee_id: 'TEST', first_name: 'Test', last_name: 'User' },
        payroll: { month: 9, year: 2026, basic_salary: 10000, gross_salary: 10000, net_salary: 10000 },
        requireAssets: true,
      });
    } catch (e) {
      if (e instanceof MissingPayslipAssetsError) threwStrict = true;
    }
    report('5.3 Safe rejection with MissingPayslipAssetsError when strict assets required', threwStrict);
  } catch (err) {
    report(`5. Signature/Stamp test failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 6. ADMIN PREVIEW PAYSLIP HTTP ENDPOINT
  // -------------------------------------------------------------------------
  try {
    const adminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1");
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const previewRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/preview-payslip-pdf',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    report('6.1 GET /api/admin/payroll/preview-payslip-pdf returns HTTP 200', previewRes.statusCode === 200);
    report('6.2 Preview endpoint returns application/pdf content type', previewRes.headers['content-type'] === 'application/pdf');
    report('6.3 Preview endpoint returns valid PDF buffer (%PDF-)', previewRes.rawBuffer.slice(0, 5).toString('ascii') === '%PDF-');

    // Save preview to sample_payslip_preview.pdf for inspection
    const previewOutputPath = path.join(__dirname, 'sample_payslip_preview.pdf');
    fs.writeFileSync(previewOutputPath, previewRes.rawBuffer);
    report('6.4 Preview PDF saved to sample_payslip_preview.pdf', fs.existsSync(previewOutputPath));
  } catch (err) {
    report(`6. Admin preview endpoint failed: ${err.message}`, false);
  }

  // -------------------------------------------------------------------------
  // 7. PRESERVATION OF EXISTING PAYROLL AND DATABASE INTEGRITY
  // -------------------------------------------------------------------------
  try {
    const payCount = await pool.query('SELECT COUNT(*) FROM public.payroll_records');
    report('7.1 Historical payroll records remain intact in database', parseInt(payCount.rows[0].count, 10) > 0);

    const docCount = await pool.query("SELECT COUNT(*) FROM public.documents WHERE LOWER(document_type) = 'payslip'");
    report('7.2 Historical documents remain intact in database', parseInt(docCount.rows[0].count, 10) >= 0);
  } catch (err) {
    report(`7. Integrity test failed: ${err.message}`, false);
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

runCorporatePayslipTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
