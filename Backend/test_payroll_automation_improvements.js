require('dotenv').config();
const http = require('http');
const assert = require('assert');
const ExcelJS = require('exceljs');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');

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
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
    }
    req.end();
  });
}

function makeMultipartRequest(options, fieldName, filename, fileBuffer, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const boundary = '----WebKitFormBoundaryTest' + Math.random().toString(36).substring(2);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const bodyBuf = Buffer.concat([header, fileBuffer, footer]);

  options.headers = {
    ...options.headers,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': bodyBuf.length,
  };

  return makeRequest(options, bodyBuf);
}

async function createTestWorkbook(rows, customHeaders = null, sheetName = 'Payroll_Data') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  const defaultHeaders = [
    { header: 'Employee ID', key: 'employee_id' },
    { header: 'Month', key: 'month' },
    { header: 'Year', key: 'year' },
    { header: 'Working Days', key: 'working_days' },
    { header: 'Payable Days', key: 'payable_days' },
    { header: 'Basic Salary', key: 'basic_salary' },
    { header: 'HRA', key: 'hra' },
    { header: 'Allowances', key: 'allowances' },
    { header: 'PF Employee', key: 'pf_employee' },
    { header: 'Professional Tax', key: 'professional_tax' },
    { header: 'Other Deductions', key: 'other_deductions' },
  ];

  sheet.columns = customHeaders || defaultHeaders;

  if (Array.isArray(rows)) {
    rows.forEach((r) => sheet.addRow(r));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function runPayrollAutomationImprovementTests() {
  console.log('================================================================');
  console.log('  GAINTPRO HRM — PAYROLL & PAYSLIP AUTOMATION TEST SUITE       ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    -> ${err.message}`);
      failed++;
    }
  }

  // 1. Setup Active Employees & Tokens
  const adminUserRes = await pool.query("SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1");
  const adminUser = adminUserRes.rows[0];
  const adminToken = generateToken({
    id: adminUser.id,
    email: adminUser.email,
    role: 'ADMIN',
  });

  const emp1Res = await pool.query(
    "SELECT e.employee_id, u.id as user_id, u.email FROM public.employees e JOIN public.users u ON u.employee_id = e.employee_id WHERE e.status = 'ACTIVE' LIMIT 1"
  );
  const emp1 = emp1Res.rows[0];
  const emp1Token = generateToken({
    id: emp1.user_id,
    email: emp1.email,
    role: 'EMPLOYEE',
    employee_id: emp1.employee_id,
  });

  const emp2Res = await pool.query(
    "SELECT e.employee_id, u.id as user_id, u.email FROM public.employees e JOIN public.users u ON u.employee_id = e.employee_id WHERE e.status = 'ACTIVE' AND e.employee_id != $1 LIMIT 1",
    [emp1.employee_id]
  );
  const emp2 = emp2Res.rows[0] || emp1;
  const emp2Token = generateToken({
    id: emp2.user_id,
    email: emp2.email,
    role: 'EMPLOYEE',
    employee_id: emp2.employee_id,
  });

  const testPeriodMonth = 11;
  const testPeriodYear = 2026;

  // Clean test period records before testing
  await pool.query('DELETE FROM public.documents WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);
  await pool.query('DELETE FROM public.payroll_records WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);
  await pool.query('DELETE FROM public.payroll_batches WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);

  // TEST 1: Role Authorization
  await test('1. Role Authorization: Non-admin (EMPLOYEE) is blocked from admin payroll endpoints (403)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll',
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert.strictEqual(res.statusCode, 403, 'Employee must receive 403 on admin payroll');
  });

  // TEST 2: Missing Required Columns
  await test('2. Excel Validation: Missing required columns rejected with 400 and clear error', async () => {
    const incompleteHeaders = [
      { header: 'Employee ID', key: 'employee_id' },
      { header: 'Month', key: 'month' },
      { header: 'Basic Salary', key: 'basic_salary' },
    ];
    const buf = await createTestWorkbook([{ employee_id: emp1.employee_id, month: testPeriodMonth, basic_salary: 30000 }], incompleteHeaders);
    const res = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'missing_columns.xlsx', buf);

    assert.strictEqual(res.statusCode, 400, 'Must return 400 for missing columns');
    const json = res.json();
    assert.strictEqual(json.success, false);
    assert(json.message.includes('Missing required column') || json.missingColumns?.length > 0, 'Error explains missing columns');
  });

  // TEST 3: Malformed Excel
  await test('3. Excel Validation: Corrupt/empty buffer rejected with 400', async () => {
    const garbageBuf = Buffer.from('NOT_A_VALID_EXCEL_STREAM');
    const res = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'corrupt.xlsx', garbageBuf);

    assert.strictEqual(res.statusCode, 400, 'Must return 400 for corrupted Excel');
  });

  // TEST 4: Invalid and Duplicate Employee IDs
  await test('4. Excel Validation: Non-existent and duplicate employee IDs in file detected with row numbers', async () => {
    const rows = [
      {
        employee_id: 'NON_EXISTENT_9999',
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: 30000,
        hra: 5000,
        allowances: 2000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
      },
      {
        employee_id: emp1.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: 35000,
        hra: 6000,
        allowances: 3000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
      },
      {
        employee_id: emp1.employee_id, // Internal duplicate in file
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: 35000,
        hra: 6000,
        allowances: 3000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
      },
    ];

    const buf = await createTestWorkbook(rows);
    const res = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'invalid_and_dups.xlsx', buf);

    assert.strictEqual(res.statusCode, 200, 'Preview returns 200 with validation summary');
    const json = res.json();
    assert.strictEqual(json.data.summary.totalRows, 3);
    assert(json.data.summary.invalidRows >= 2, 'Invalid rows must include non-existent and duplicates');
    assert.strictEqual(json.data.summary.duplicateRows, 1, 'Duplicate count is 1');
    assert.strictEqual(json.data.batchStatus, 'Validation Failed', 'Batch status set to Validation Failed');

    // Confirm that error messages contain row numbers
    const errorRows = json.data.rows.filter((r) => r.status === 'INVALID');
    assert(errorRows.some((r) => r.errors.some((e) => e.startsWith('Row ') || e.includes('Row 2') || e.includes('Row 4'))), 'Errors prefixed with row numbers');
  });

  // TEST 5: Currency Symbol Sanitization & Negative Amount Handling
  await test('5. Excel Validation: Currency strings (₹, $, commas) stripped; negative amounts rejected', async () => {
    const rows = [
      {
        employee_id: emp1.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: '₹35,000.00',
        hra: '$6,000',
        allowances: ' 3,000 ',
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 500,
      },
      {
        employee_id: emp2.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: -25000, // Negative amount
        hra: 4000,
        allowances: 1000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
      },
    ];

    const buf = await createTestWorkbook(rows);
    const res = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'currency_and_negative.xlsx', buf);

    assert.strictEqual(res.statusCode, 200);
    const json = res.json();
    const row1 = json.data.rows.find((r) => r.employee_id === emp1.employee_id);
    assert.strictEqual(row1.basic_salary, 35000, 'Basic salary sanitized from ₹35,000.00 to 35000');
    assert.strictEqual(row1.hra, 6000, 'HRA sanitized from $6,000 to 6000');
    assert.strictEqual(row1.allowances, 3000, 'Allowances sanitized from 3,000 to 3000');

    const row2 = json.data.rows.find((r) => r.employee_id === emp2.employee_id);
    assert.strictEqual(row2.status, 'INVALID', 'Row with negative salary marked INVALID');
    assert(row2.errors.some((e) => e.includes('negative')), 'Error message explains non-negative requirement');
  });

  // TEST 6: Financial Calculations Server-Side Accuracy
  let validImportId = null;
  let validBatchId = null;
  await test('6. Salary Totals: Server accurately computes Gross, Total Deductions, and Net Salary', async () => {
    const rows = [
      {
        employee_id: emp1.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: 30000,
        hra: 6000,
        allowances: 4000, // Gross = 40,000
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 500, // Total Deductions = 2,500, Net = 37,500
      },
      {
        employee_id: emp2.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 24,
        basic_salary: 25000,
        hra: 5000,
        allowances: 2000, // Gross = 32,000
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0, // Total Deductions = 2,000, Net = 30,000
      },
    ];

    const buf = await createTestWorkbook(rows);
    const res = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'valid_batch.xlsx', buf);

    assert.strictEqual(res.statusCode, 200);
    const json = res.json();
    assert.strictEqual(json.data.summary.validRows, 2);
    assert.strictEqual(json.data.summary.invalidRows, 0);
    assert.strictEqual(json.data.batchStatus, 'Ready for Confirmation');

    // Expected Financial Totals:
    // Total Gross = 40000 + 32000 = 72000
    // Total Deductions = 2500 + 2000 = 4500
    // Total Net = 37500 + 30000 = 67500
    assert.strictEqual(json.data.summary.totalGrossSalary, 72000, 'Total Gross calculated correctly');
    assert.strictEqual(json.data.summary.totalDeductions, 4500, 'Total Deductions calculated correctly');
    assert.strictEqual(json.data.summary.totalNetSalary, 67500, 'Total Net calculated correctly');

    validImportId = json.data.importId;
    validBatchId = json.data.batchId;
    assert(validImportId, 'Returned valid import session ID');
    assert(validBatchId, 'Persisted batch ID in payroll_batches');
  });

  // TEST 7: Batch Confirmation & Reliable Payroll Processing
  let confirmResultData = null;
  await test('7. Batch Processing: Commits records in transaction, generates PDF payslips, marks batch Completed', async () => {
    assert(validImportId, 'Must have validImportId from previous test');

    const res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      importId: validImportId,
      importMode: 'CREATE_ONLY',
    });

    assert.strictEqual(res.statusCode, 200, 'Confirm returns 200');
    const json = res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.createdCount, 2, 'Created 2 payroll records');
    assert.strictEqual(json.data.payslipsGenerated, 2, 'Generated 2 PDF payslips');
    assert.strictEqual(json.data.batchStatus, 'Completed', 'Batch status set to Completed');
    confirmResultData = json.data;

    // Verify batch in database
    const batchCheck = await pool.query('SELECT * FROM public.payroll_batches WHERE id = $1', [validBatchId]);
    assert.strictEqual(batchCheck.rows[0].status, 'Completed', 'DB batch status is Completed');
    assert.strictEqual(parseInt(batchCheck.rows[0].payslips_generated, 10), 2, 'DB payslips_generated is 2');
    assert.strictEqual(parseInt(batchCheck.rows[0].payslips_failed, 10), 0, 'DB payslips_failed is 0');
  });

  // TEST 8: Duplicate DB Prevention in CREATE_ONLY Mode
  await test('8. Duplicate Prevention: CREATE_ONLY rejects re-importing existing payroll records (409)', async () => {
    const rows = [
      {
        employee_id: emp1.employee_id,
        month: testPeriodMonth,
        year: testPeriodYear,
        working_days: 26,
        payable_days: 26,
        basic_salary: 30000,
        hra: 6000,
        allowances: 4000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 500,
      },
    ];

    const buf = await createTestWorkbook(rows);
    const resPreview = await makeMultipartRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, 'file', 'existing_duplicate.xlsx', buf);

    assert.strictEqual(resPreview.statusCode, 200);
    const previewData = resPreview.json().data;
    assert.strictEqual(previewData.summary.existingPayrollRows, 1, 'Detected existing payroll record in DB');

    // Attempt confirm with CREATE_ONLY
    const resConfirm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      importId: previewData.importId,
      importMode: 'CREATE_ONLY',
    });

    assert.strictEqual(resConfirm.statusCode, 409, 'Rejects existing payroll with 409 Conflict in CREATE_ONLY');
  });

  // TEST 9: Batch History API
  await test('9. Batch History API: GET /api/admin/payroll/batches lists batch runs with accurate statuses', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/payroll/batches?month=${testPeriodMonth}&year=${testPeriodYear}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = res.json();
    assert.strictEqual(json.success, true);
    assert(Array.isArray(json.data) && json.data.length > 0, 'Returns list of batches');
    const batch = json.data.find((b) => b.id === validBatchId);
    assert(batch != null, 'Found target batch in history');
    assert.strictEqual(batch.status, 'Completed');
  });

  // TEST 10: Downloadable Processing Report
  await test('10. Processing Report: GET /api/admin/payroll/report generates dual-sheet Excel audit report', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/payroll/report?batchId=${validBatchId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.statusCode, 200, 'Returns 200 for report download');
    assert.strictEqual(
      res.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-type is Excel spreadsheet'
    );
    assert(res.body.length > 1000, 'Report buffer contains valid Excel bytes');

    // Load and inspect workbook sheets
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const summarySheet = workbook.getWorksheet('Batch_Summary');
    const detailsSheet = workbook.getWorksheet('Employee_Details');
    assert(summarySheet != null, 'Workbook has Batch_Summary worksheet');
    assert(detailsSheet != null, 'Workbook has Employee_Details worksheet');
    assert(detailsSheet.rowCount >= 3, 'Details sheet has headers and employee rows');
  });

  // TEST 11: Retry Failed Payslips Endpoint
  await test('11. Payslip Retry: POST /api/admin/payroll/retry-failed-payslips handles retry without duplicating records', async () => {
    // Delete one payslip document physically/from DB to simulate partial failure
    await pool.query(
      "DELETE FROM public.documents WHERE employee_id = $1 AND month = $2 AND year = $3 AND LOWER(document_type) = 'payslip'",
      [emp2.employee_id, testPeriodMonth, testPeriodYear]
    );

    const resRetry = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/retry-failed-payslips',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    }, {
      month: testPeriodMonth,
      year: testPeriodYear,
      batchId: validBatchId,
    });

    assert.strictEqual(resRetry.statusCode, 200, 'Retry returns 200');
    const json = resRetry.json();
    assert.strictEqual(json.data.retriedGenerated, 1, 'Regenerated the 1 missing payslip');
    assert.strictEqual(json.data.alreadyValid, 1, 'Skipped the 1 already existing payslip');

    // Verify document restored
    const docCheck = await pool.query(
      "SELECT id FROM public.documents WHERE employee_id = $1 AND month = $2 AND year = $3 AND LOWER(document_type) = 'payslip'",
      [emp2.employee_id, testPeriodMonth, testPeriodYear]
    );
    assert.strictEqual(docCheck.rows.length, 1, 'Document recreated for employee 2');
  });

  // TEST 12: Secure Employee Portal Access & Isolation
  await test('12. Employee Portal: Employee sees net salary and availability status, cannot access other employee PDF', async () => {
    // 12a. Employee 1 lists own payslips
    const resList = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips?month=${testPeriodMonth}&year=${testPeriodYear}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });

    assert.strictEqual(resList.statusCode, 200);
    const listJson = resList.json();
    const slip1 = listJson.data.items.find((s) => s.month === testPeriodMonth && s.year === testPeriodYear);
    assert(slip1 != null, 'Found payslip for Employee 1');
    assert.strictEqual(slip1.availability_status, 'Available', 'Availability status is Available');
    assert.strictEqual(parseFloat(slip1.payroll.net_salary), 37500, 'Net salary is 37,500');

    // 12b. Employee 1 can view own PDF
    const resViewOwn = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${slip1.id}/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${emp1Token}` },
    });
    assert.strictEqual(resViewOwn.statusCode, 200, 'Can view own PDF');
    assert.strictEqual(resViewOwn.headers['content-type'], 'application/pdf');

    // 12c. Employee 2 attempts to view Employee 1's PDF -> must return 404 (isolation enforced)
    if (emp2.employee_id !== emp1.employee_id) {
      const resCrossAccess = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${slip1.id}/view`,
        method: 'GET',
        headers: { Authorization: `Bearer ${emp2Token}` },
      });
      assert.strictEqual(resCrossAccess.statusCode, 404, 'Cross-employee access returns 404 (isolated)');
    }
  });

  // Cleanup test period
  await pool.query('DELETE FROM public.documents WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);
  await pool.query('DELETE FROM public.payroll_records WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);
  await pool.query('DELETE FROM public.payroll_batches WHERE month = $1 AND year = $2', [testPeriodMonth, testPeriodYear]);

  console.log('\n================================================================');
  console.log(`  AUTOMATION TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPayrollAutomationImprovementTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
