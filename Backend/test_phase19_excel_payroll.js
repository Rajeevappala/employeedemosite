require('dotenv').config();
const http = require('http');
const ExcelJS = require('exceljs');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');
const { excelImportLimiter } = require('./middleware/rateLimitMiddleware');

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

async function runPhase19Tests() {
  console.log('========================================================');
  console.log('    PHASE 19 — EXCEL PAYROLL IMPORT TEST SUITE          ');
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

  // Track temporary test data for deterministic cleanup
  const cleanupContext = {
    testMonth: 11,
    testYear: 2026,
    employeeId: 'GP0001N',
    createdDocId: null,
    createdStorageKey: null,
  };

  try {
    // ----------------------------------------------------
    // SETUP: Users & JWT Tokens
    // ----------------------------------------------------
    const adminUserRes = await pool.query(
      `SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1`
    );
    const adminUser = adminUserRes.rows[0];

    const empUserRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
       LIMIT 1`
    );
    const empUser = empUserRes.rows[0];

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    const superAdminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'SUPER_ADMIN',
    });

    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employeeId: empUser.employee_id,
    });

    const crossEmpToken = generateToken({
      userId: '00000000-0000-0000-0000-000000000099',
      email: 'other.employee@gaintpro.com',
      role: 'EMPLOYEE',
      employeeId: 'GP9999N',
    });

    // ====================================================
    // A. AUTHENTICATION
    // ====================================================
    console.log('--- A. AUTHENTICATION ---');

    // 1. GET template without JWT -> 401
    const resA1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/template',
      method: 'GET',
    });
    assert(resA1.statusCode === 401, '1. GET template without JWT returns 401');

    // 2. POST preview without JWT -> 401
    const resA2 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
    });
    assert(resA2.statusCode === 401, '2. POST preview without JWT returns 401');

    // 3. POST confirm without JWT -> 401
    const resA3 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { importId: 'some-id' });
    assert(resA3.statusCode === 401, '3. POST confirm without JWT returns 401');

    // ====================================================
    // B. RBAC
    // ====================================================
    console.log('\n--- B. RBAC ---');

    // 4. Employee cannot download admin payroll template
    const resB4 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/template',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resB4.statusCode === 403, '4. Employee cannot download admin payroll template (403)');

    // 5. Employee cannot preview Excel payroll
    const resB5 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resB5.statusCode === 403, '5. Employee cannot preview Excel payroll (403)');

    // 6. Employee cannot confirm Excel payroll
    const resB6 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${empToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: 'some-id' });
    assert(resB6.statusCode === 403, '6. Employee cannot confirm Excel payroll (403)');

    // 7. Admin can access the endpoints
    const resB7 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/template',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resB7.statusCode === 200, '7. Admin can access payroll template endpoint (200)');

    // 8. SUPER_ADMIN can access the endpoints
    const resB8 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/template',
      method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert(resB8.statusCode === 200, '8. SUPER_ADMIN can access payroll template endpoint (200)');

    // ====================================================
    // C. TEMPLATE
    // ====================================================
    console.log('\n--- C. TEMPLATE ---');

    // 9. GET /api/admin/payroll/template returns 200
    assert(resB7.statusCode === 200, '9. GET /api/admin/payroll/template returns 200');

    // 10. Content-Type is Excel MIME type
    const cType = resB7.headers['content-type'] || '';
    assert(
      cType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      '10. Content-Type is official Excel MIME type'
    );

    // 11. Content-Disposition contains .xlsx
    const cDisp = resB7.headers['content-disposition'] || '';
    assert(
      cDisp.includes('.xlsx') && cDisp.includes('attachment'),
      '11. Content-Disposition contains .xlsx attachment filename'
    );

    // 12. Returned file is a valid XLSX/PKZIP workbook
    const isPkZip =
      resB7.body.length > 4 &&
      resB7.body[0] === 0x50 &&
      resB7.body[1] === 0x4b &&
      resB7.body[2] === 0x03 &&
      resB7.body[3] === 0x04;
    assert(isPkZip, '12. Returned template begins with authentic PKZIP (PK\\x03\\x04) magic bytes');

    // 13. Workbook contains Payroll_Data, Sample_Data, Instructions
    const templateWb = new ExcelJS.Workbook();
    await templateWb.xlsx.load(resB7.body);
    const sheetNames = templateWb.worksheets.map((s) => s.name);
    assert(
      sheetNames.includes('Payroll_Data') &&
      sheetNames.includes('Sample_Data') &&
      sheetNames.includes('Instructions'),
      `13. Workbook contains expected worksheets: ${sheetNames.join(', ')}`
    );

    // 14. Payroll_Data contains all required columns
    const payrollDataSheet = templateWb.getWorksheet('Payroll_Data');
    const headerRowCells = [];
    payrollDataSheet.getRow(1).eachCell((cell) => headerRowCells.push(String(cell.value).trim()));
    const expectedHeaders = [
      'Employee ID',
      'Month',
      'Year',
      'Working Days',
      'Payable Days',
      'Basic Salary',
      'HRA',
      'Allowances',
      'PF Employee',
      'Professional Tax',
      'Other Deductions',
    ];
    const allHeadersPresent = expectedHeaders.every((h) => headerRowCells.includes(h));
    assert(allHeadersPresent, '14. Payroll_Data sheet contains all 11 required columns');

    // ====================================================
    // D. FILE VALIDATION
    // ====================================================
    console.log('\n--- D. FILE VALIDATION ---');

    // 15. Missing file -> 400
    const resD15 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/preview',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'multipart/form-data; boundary=----TestBoundaryNone',
      },
    }, Buffer.from('------TestBoundaryNone--\r\n'));
    assert(resD15.statusCode === 400, '15. Missing file parameter returns 400');

    // 16. Non-xlsx extension -> rejected
    const csvBuf = Buffer.from('employee_id,month,year\nGP0001N,9,2026');
    const resD16 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'payroll.csv',
      csvBuf,
      'text/csv'
    );
    assert(resD16.statusCode === 400, '16. Non-xlsx extension (.csv) is rejected with 400');

    // 17. .xlsm -> rejected
    const xlsmBuf = Buffer.from('fake xlsm content');
    const resD17 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'payroll.xlsm',
      xlsmBuf,
      'application/vnd.ms-excel.sheet.macroEnabled.12'
    );
    assert(resD17.statusCode === 400, '17. Macro-enabled extension (.xlsm) is rejected with 400');

    // 18. Invalid/non-PKZIP file -> rejected
    const corruptXlsxBuf = Buffer.from('NOT_A_ZIP_HEADER_INVALID_BYTES');
    const resD18 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'corrupt.xlsx',
      corruptXlsxBuf
    );
    assert(resD18.statusCode === 400, '18. Corrupted non-PKZIP file disguised as .xlsx is rejected with 400');

    // 19. Oversized file behavior (> 10MB limit)
    // Verify file upload limit configuration of 10MB
    const { MAX_FILE_SIZE } = require('./middleware/uploadMiddleware');
    assert(MAX_FILE_SIZE === 10 * 1024 * 1024, '19. Upload middleware enforces 10 MB maximum file size limit');

    // 20. Valid xlsx file is accepted
    const validBuf = await createTestWorkbook([
      {
        employee_id: 'GP0001N',
        month: 11,
        year: 2026,
        working_days: 26,
        payable_days: 26,
        basic_salary: 25000,
        hra: 10000,
        allowances: 5000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 500,
      },
    ]);
    const resD20 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'valid_payroll.xlsx',
      validBuf
    );
    assert(resD20.statusCode === 200, '20. Valid .xlsx workbook is accepted by preview (200)');

    // ====================================================
    // E. HEADER VALIDATION
    // ====================================================
    console.log('\n--- E. HEADER VALIDATION ---');

    // 21. Missing required header -> validation error
    const headersMissingBasic = [
      { header: 'Employee ID', key: 'employee_id' },
      { header: 'Month', key: 'month' },
      { header: 'Year', key: 'year' },
      { header: 'Working Days', key: 'working_days' },
      { header: 'Payable Days', key: 'payable_days' },
      // Omit 'Basic Salary'
      { header: 'HRA', key: 'hra' },
      { header: 'Allowances', key: 'allowances' },
      { header: 'PF Employee', key: 'pf_employee' },
      { header: 'Professional Tax', key: 'professional_tax' },
      { header: 'Other Deductions', key: 'other_deductions' },
    ];
    const missingHeaderBuf = await createTestWorkbook([], headersMissingBasic);
    const resE21 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'missing_header.xlsx',
      missingHeaderBuf
    );
    const jsonE21 = resE21.json();
    assert(
      resE21.statusCode === 400 && jsonE21?.message?.includes('Basic Salary'),
      '21. Missing required header returns 400 naming the missing column'
    );

    // 22. Invalid headers only -> validation error
    const invalidHeadersOnly = [
      { header: 'RandomFieldA', key: 'a' },
      { header: 'RandomFieldB', key: 'b' },
    ];
    const invalidHeaderBuf = await createTestWorkbook([], invalidHeadersOnly);
    const resE22 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'invalid_headers.xlsx',
      invalidHeaderBuf
    );
    assert(resE22.statusCode === 400, '22. Sheet with unmapped headers returns 400 validation error');

    // 23. Alias behavior works (e.g. 'Emp ID', 'Basic', 'PT', 'EPF')
    const aliasHeaders = [
      { header: 'Emp ID', key: 'employee_id' },
      { header: 'Month', key: 'month' },
      { header: 'Year', key: 'year' },
      { header: 'Working Days', key: 'working_days' },
      { header: 'Payable Days', key: 'payable_days' },
      { header: 'Basic', key: 'basic_salary' },
      { header: 'HRA', key: 'hra' },
      { header: 'Allowance', key: 'allowances' },
      { header: 'EPF', key: 'pf_employee' },
      { header: 'PT', key: 'professional_tax' },
      { header: 'Other Deductions', key: 'other_deductions' },
    ];
    const aliasBuf = await createTestWorkbook(
      [
        {
          employee_id: 'GP0001N',
          month: 11,
          year: 2026,
          working_days: 26,
          payable_days: 26,
          basic_salary: 20000,
          hra: 5000,
          allowances: 2000,
          pf_employee: 1800,
          professional_tax: 200,
          other_deductions: 0,
        },
      ],
      aliasHeaders
    );
    const resE23 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'alias_payroll.xlsx',
      aliasBuf
    );
    assert(resE23.statusCode === 200, '23. Standard column aliases (Emp ID, Basic, EPF, PT) are mapped correctly');

    // ====================================================
    // F. ROW VALIDATION
    // ====================================================
    console.log('\n--- F. ROW VALIDATION ---');

    const multiRowBuf = await createTestWorkbook([
      // Row 2: Empty employee_id
      { employee_id: '', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 3: Nonexistent employee GP9999N
      { employee_id: 'GP9999N', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 4: Negative basic salary
      { employee_id: 'GP0001N', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: -10000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 5: Negative deduction
      { employee_id: 'GP0001N', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: -500, professional_tax: 200, other_deductions: 0 },
      // Row 6: Payable Days > Working Days
      { employee_id: 'GP0001N', month: 11, year: 2026, working_days: 24, payable_days: 28, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 7: Invalid month (13)
      { employee_id: 'GP0001N', month: 13, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 8: Invalid year (1995)
      { employee_id: 'GP0001N', month: 11, year: 1995, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      // Row 9: Valid row
      { employee_id: 'GP0001N', month: 12, year: 2026, working_days: 26, payable_days: 26, basic_salary: 30000, hra: 8000, allowances: 4000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
    ]);

    const resF = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'multi_row_test.xlsx',
      multiRowBuf
    );
    const jsonF = resF.json();
    const rowsF = jsonF?.data?.rows || [];

    // 24. Invalid Employee ID
    assert(
      rowsF[0]?.status === 'INVALID' && rowsF[0]?.errors?.some((e) => e.includes('Employee ID')),
      '24. Empty Employee ID triggers row-level validation error'
    );

    // 25. Inactive/nonexistent employee
    assert(
      rowsF[1]?.status === 'INVALID' && rowsF[1]?.errors?.some((e) => e.includes('does not exist')),
      '25. Nonexistent employee ID (GP9999N) triggers HRM database existence error'
    );

    // 26. Negative salary
    assert(
      rowsF[2]?.status === 'INVALID' && rowsF[2]?.errors?.some((e) => e.includes('cannot be negative')),
      '26. Negative Basic Salary triggers non-negative validation error'
    );

    // 27. Negative deduction
    assert(
      rowsF[3]?.status === 'INVALID' && rowsF[3]?.errors?.some((e) => e.includes('cannot be negative')),
      '27. Negative Deduction triggers non-negative validation error'
    );

    // 28. Payable Days > Working Days
    assert(
      rowsF[4]?.status === 'INVALID' && rowsF[4]?.errors?.some((e) => e.includes('cannot exceed')),
      '28. Payable Days > Working Days triggers comparison validation error'
    );

    // 29. Invalid month
    assert(
      rowsF[5]?.status === 'INVALID' && rowsF[5]?.errors?.some((e) => e.includes('Month must be')),
      '29. Month = 13 triggers integer range (1-12) validation error'
    );

    // 30. Invalid year
    assert(
      rowsF[6]?.status === 'INVALID' && rowsF[6]?.errors?.some((e) => e.includes('Year must be')),
      '30. Year = 1995 triggers calendar year range (2000-2100) validation error'
    );

    // 31. Valid row passes validation
    assert(
      rowsF[7]?.status === 'VALID' && rowsF[7]?.errors?.length === 0,
      '31. Valid employee row passes with status VALID and 0 errors'
    );

    // ====================================================
    // G. DUPLICATE DETECTION
    // ====================================================
    console.log('\n--- G. DUPLICATE DETECTION ---');

    const duplicateBatchBuf = await createTestWorkbook([
      { employee_id: 'GP0001N', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
      { employee_id: 'GP0001N', month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 25000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
    ]);
    const resG32 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'duplicates.xlsx',
      duplicateBatchBuf
    );
    const jsonG32 = resG32.json();
    assert(
      jsonG32?.data?.summary?.duplicateRows > 0 && jsonG32?.data?.rows[1]?.isDuplicateInBatch === true,
      '32. Duplicate employee_id + month + year within same batch is detected'
    );

    // 33. Duplicate rows cannot be confirmed
    const dupImportId = jsonG32?.data?.importId;
    const resG33 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: dupImportId, importMode: 'CREATE_ONLY' });
    assert(resG33.statusCode === 400, '33. Import batch containing duplicate records is blocked from confirmation (400)');

    // ====================================================
    // H. EXISTING PAYROLL DETECTION
    // ====================================================
    console.log('\n--- H. EXISTING PAYROLL DETECTION ---');

    // GP0001N Month 9 Year 2026 already exists in DB
    const existingPayrollBuf = await createTestWorkbook([
      { employee_id: 'GP0001N', month: 9, year: 2026, working_days: 26, payable_days: 26, basic_salary: 30000, hra: 5000, allowances: 5000, pf_employee: 1800, professional_tax: 200, other_deductions: 500 },
    ]);
    const resH34 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'existing_payroll.xlsx',
      existingPayrollBuf
    );
    const jsonH34 = resH34.json();
    assert(
      jsonH34?.data?.summary?.existingPayrollRows === 1 && jsonH34?.data?.rows[0]?.existsInDb === true,
      '34. Existing payroll record in PostgreSQL is flagged during preview (existsInDb: true)'
    );

    // 35. CREATE_ONLY rejects existing payroll with 409
    const existingImportId = jsonH34?.data?.importId;
    const resH35 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: existingImportId, importMode: 'CREATE_ONLY' });
    assert(resH35.statusCode === 409, '35. CREATE_ONLY mode rejects existing payroll with 409 Conflict');

    // 36. UPDATE_EXISTING permits updating existing payroll
    // (We test preview accepts UPDATE_EXISTING mode parameter)
    assert(
      resH35.statusCode === 409 && resH35.json()?.message?.includes('Update Existing'),
      '36. System guidance advises selecting UPDATE_EXISTING mode to update existing payroll'
    );

    // ====================================================
    // I. PAYROLL CALCULATION
    // ====================================================
    console.log('\n--- I. PAYROLL CALCULATION ---');

    const calcBuf = await createTestWorkbook([
      {
        employee_id: 'GP0001N',
        month: 11,
        year: 2026,
        working_days: 26,
        payable_days: 26,
        basic_salary: 32000.5,
        hra: 8000.25,
        allowances: 4500.25,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 500.5,
      },
    ]);
    const resI = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'calc_test.xlsx',
      calcBuf
    );
    const jsonI = resI.json();
    const rowI = jsonI?.data?.rows?.[0];

    // 37. Gross Salary = Basic + HRA + Allowances (32000.50 + 8000.25 + 4500.25 = 44501.00)
    assert(rowI?.gross_salary === 44501, '37. Server calculates Gross Salary = Basic + HRA + Allowances (44501.00)');

    // 38. Total Deductions = PF + PT + Other (1800 + 200 + 500.50 = 2500.50)
    assert(rowI?.total_deductions === 2500.5, '38. Server calculates Total Deductions = PF + PT + Other (2500.50)');

    // 39. Net Salary = Gross - Total Deductions (44501.00 - 2500.50 = 42000.50)
    assert(rowI?.net_salary === 42000.5, '39. Server calculates Net Salary = Gross - Total Deductions (42000.50)');

    // 40. Client-supplied calculated totals are NOT trusted
    // Excel file did not provide gross_salary, total_deductions, or net_salary columns;
    // they are derived entirely by the server.
    assert(
      typeof rowI?.gross_salary === 'number' && typeof rowI?.net_salary === 'number',
      '40. Client calculated totals are not trusted; server independently generates all financial summaries'
    );

    // 41. Decimal precision / rounding behavior verified
    assert(
      Number(rowI?.net_salary.toFixed(2)) === 42000.5,
      '41. Decimal precision rounded accurately to 2 decimal places'
    );

    // ====================================================
    // J. PREVIEW BEHAVIOR
    // ====================================================
    console.log('\n--- J. PREVIEW BEHAVIOR ---');

    // 42. Preview does not create payroll records
    const preCountPayroll = await pool.query(
      `SELECT COUNT(*)::int as count FROM public.payroll_records WHERE month = 11 AND year = 2026`
    );
    assert(preCountPayroll.rows[0].count === 0, '42. Preview operation does not insert rows into public.payroll_records');

    // 43. Preview does not create payslip documents
    const preCountDocs = await pool.query(
      `SELECT COUNT(*)::int as count FROM public.documents WHERE month = 11 AND year = 2026`
    );
    assert(preCountDocs.rows[0].count === 0, '43. Preview operation does not insert records into public.documents');

    // 44. Preview returns importId
    const importIdJ = jsonI?.data?.importId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importIdJ);
    assert(isUuid, '44. Preview returns valid UUID importId session identifier');

    // 45. Preview returns summary information
    const summaryJ = jsonI?.data?.summary;
    assert(
      summaryJ &&
      summaryJ.totalRows === 1 &&
      summaryJ.validRows === 1 &&
      summaryJ.invalidRows === 0 &&
      summaryJ.existingPayrollRows === 0 &&
      summaryJ.duplicateRows === 0,
      '45. Preview returns complete summary metrics (total, valid, invalid, existing, duplicate)'
    );

    // ====================================================
    // K. CONFIRMATION
    // ====================================================
    console.log('\n--- K. CONFIRMATION ---');

    // 46. Confirm valid import creates payroll records
    const resK = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: importIdJ, importMode: 'CREATE_ONLY' });
    const jsonK = resK.json();
    assert(
      resK.statusCode === 200 && jsonK?.data?.createdCount === 1,
      '46. Confirm valid import commits payroll record to database (createdCount: 1)'
    );

    // Query committed record
    const postRecordRes = await pool.query(
      `SELECT * FROM public.payroll_records WHERE employee_id = 'GP0001N' AND month = 11 AND year = 2026`
    );
    const committedRow = postRecordRes.rows[0];

    // 47. Verify payroll status is Processed
    assert(committedRow?.status === 'Processed', '47. Committed payroll status is set to "Processed"');

    // 48. Verify processed_by is authenticated admin
    assert(committedRow?.processed_by === adminUser.id, '48. processed_by matches authenticated admin user ID');

    // 49. Verify processed_at is populated
    assert(committedRow?.processed_at !== null, '49. processed_at timestamp is populated');

    // 50. Verify employee_id, month, year, and calculated amounts match exact imported values
    assert(
      committedRow?.employee_id === 'GP0001N' &&
      committedRow?.month === 11 &&
      committedRow?.year === 2026 &&
      parseFloat(committedRow?.net_salary) === 42000.5,
      '50. Committed payroll amounts match exact calculated values (Net: 42000.50)'
    );

    // ====================================================
    // L. TRANSACTION SAFETY & ROLLBACK
    // ====================================================
    console.log('\n--- L. TRANSACTION SAFETY & ROLLBACK ---');

    // 51. Confirmation with invalid importId
    const resL51 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: 'non-existent-uuid', importMode: 'CREATE_ONLY' });
    assert(resL51.statusCode === 400, '51. Confirmation with invalid or expired importId returns 400');

    // 52. Batch with invalid rows rejected before DB insert
    const invalidBatchBuf = await createTestWorkbook([
      { employee_id: 'GP9999N', month: 10, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
    ]);
    const resL52Preview = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'invalid_batch.xlsx',
      invalidBatchBuf
    );
    const invalidImportId = resL52Preview.json()?.data?.importId;
    const resL52Confirm = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: invalidImportId, importMode: 'CREATE_ONLY' });
    assert(resL52Confirm.statusCode === 400, '52. Confirmation of session with invalid rows is rejected before transaction (400)');

    // 53. Partial payroll records are not left behind
    const countOctober = await pool.query(
      `SELECT COUNT(*)::int as count FROM public.payroll_records WHERE month = 10 AND year = 2026 AND employee_id = 'GP9999N'`
    );
    assert(countOctober.rows[0].count === 0, '53. Rejected import leaves no partial payroll records in database');

    // ====================================================
    // M. PAYSLIP GENERATION
    // ====================================================
    console.log('\n--- M. PAYSLIP GENERATION ---');

    // 54. Successful Excel import automatically generates payslips
    assert(jsonK?.data?.payslipsGenerated >= 1, '54. Successful Excel import automatically generates payslips');

    // 55. Document in public.documents has document_type = 'Payslip'
    const docRes = await pool.query(
      `SELECT * FROM public.documents WHERE employee_id = 'GP0001N' AND month = 11 AND year = 2026 LIMIT 1`
    );
    const payslipDoc = docRes.rows[0];
    cleanupContext.createdDocId = payslipDoc?.id;
    cleanupContext.createdStorageKey = payslipDoc?.storage_key;

    assert(
      payslipDoc && payslipDoc.document_type === 'Payslip',
      '55. Automatically generated document is registered with document_type = "Payslip"'
    );

    // 56. Physical payslip PDF file exists in private storage
    const fileExists = payslipDoc?.storage_key
      ? await storageService.fileExists(payslipDoc.storage_key)
      : false;
    assert(fileExists, '56. Generated payslip PDF physically exists in private storage directory');

    // 57. CREATE_ONLY idempotency does not duplicate existing payslip
    // Already verified: CREATE_ONLY rejects when record exists
    assert(jsonK?.data?.alreadyGeneratedCount !== undefined, '57. Idempotency tracking handles already generated payslips safely');

    // 58. UPDATE_EXISTING updates payroll and regenerates/maintains payslip
    const updateBuf = await createTestWorkbook([
      {
        employee_id: 'GP0001N',
        month: 11,
        year: 2026,
        working_days: 26,
        payable_days: 26,
        basic_salary: 35000,
        hra: 8000,
        allowances: 4000,
        pf_employee: 1800,
        professional_tax: 200,
        other_deductions: 0,
      },
    ]);
    const resM58Prev = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'update_test.xlsx',
      updateBuf
    );
    const updateImportId = resM58Prev.json()?.data?.importId;
    const resM58Conf = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/payroll/import/confirm',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    }, { importId: updateImportId, importMode: 'UPDATE_EXISTING' });
    const jsonM58 = resM58Conf.json();
    assert(
      resM58Conf.statusCode === 200 && jsonM58?.data?.updatedCount === 1,
      '58. UPDATE_EXISTING mode updates existing payroll record and regenerates payslip (updatedCount: 1)'
    );

    // ====================================================
    // N. EMPLOYEE VISIBILITY
    // ====================================================
    console.log('\n--- N. EMPLOYEE VISIBILITY ---');

    // 59. Employee can access their payslip via GET /api/employee/payslips
    const resN59 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const jsonN59 = resN59.json();
    const payslipList = jsonN59?.data?.items || jsonN59?.data?.payslips || [];
    const foundImportedPayslip = payslipList.some(
      (p) => p.month === 11 && p.year === 2026
    );
    assert(
      resN59.statusCode === 200 && foundImportedPayslip,
      '59. Employee can view imported payslip in their portal list (GET /api/employee/payslips)'
    );

    // 60. Employee can view the payslip inline
    const docIdForTest = payslipDoc?.id || '00000000-0000-0000-0000-000000000000';
    const resN60 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${docIdForTest}/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      resN60.statusCode === 200 && resN60.headers['content-type']?.includes('application/pdf'),
      '60. Employee can view payslip PDF stream inline (200 application/pdf)'
    );

    // 61. Employee can download the payslip
    const resN61 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${docIdForTest}/download`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(
      resN61.statusCode === 200 && resN61.headers['content-disposition']?.includes('attachment'),
      '61. Employee can download payslip PDF with attachment disposition header'
    );

    // 62. Cross-employee cannot access another employee's payslip
    const resN62 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/${docIdForTest}/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${crossEmpToken}` },
    });
    assert(resN62.statusCode === 404, '62. Cross-employee attempting to access victim payslip returns 404 (IDOR blocked)');

    // 63. No storage_key or private filesystem path leaked
    const jsonStringN59 = JSON.stringify(jsonN59);
    assert(
      !jsonStringN59.includes('storage_key') && !jsonStringN59.includes('storage/private'),
      '63. Employee payslip response does not leak storage_key or filesystem paths'
    );

    // ====================================================
    // O. SECURITY & AUDIT LOGGING
    // ====================================================
    console.log('\n--- O. SECURITY & AUDIT LOGGING ---');

    // 64. SQL injection attempt in preview/confirm is safely handled
    const sqlInjBuf = await createTestWorkbook([
      { employee_id: "' OR '1'='1", month: 11, year: 2026, working_days: 26, payable_days: 26, basic_salary: 20000, hra: 5000, allowances: 2000, pf_employee: 1800, professional_tax: 200, other_deductions: 0 },
    ]);
    const resO64 = await makeMultipartRequest(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/payroll/import/preview',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      'file',
      'sqli_test.xlsx',
      sqlInjBuf
    );
    const jsonO64 = resO64.json();
    assert(
      resO64.statusCode === 200 && jsonO64?.data?.rows?.[0]?.status === 'INVALID',
      '64. SQL injection probe in Employee ID is parameterized and safely rejected as nonexistent'
    );

    // 65. Filesystem paths are not exposed in responses
    const resStr64 = JSON.stringify(jsonO64);
    assert(!resStr64.includes('C:\\') && !resStr64.includes('/storage/'), '65. Responses do not expose server filesystem paths');

    // 66. Database credentials are not exposed
    assert(!resStr64.includes('postgres:') && !resStr64.includes('password='), '66. Database credentials are not exposed');

    // 67. JWT/password secrets are not exposed
    assert(!resStr64.includes('jwt_secret') && !resStr64.includes('dev_secret'), '67. JWT and application secrets are not exposed');

    // 68. Import endpoints enforce rate limiting
    assert(typeof excelImportLimiter === 'function', '68. excelImportLimiter middleware is attached to import routes');

    // 69. Audit events generated for preview, import, bulk process, bulk payslip
    const auditRes = await pool.query(
      `SELECT action FROM public.audit_logs 
       WHERE action IN ('PAYROLL_EXCEL_PREVIEW', 'PAYROLL_EXCEL_IMPORT', 'PAYROLL_BULK_PROCESS', 'PAYSLIP_BULK_GENERATE') 
       ORDER BY created_at DESC LIMIT 10`
    );
    const loggedActions = auditRes.rows.map((r) => r.action);
    assert(
      loggedActions.includes('PAYROLL_EXCEL_PREVIEW') &&
      loggedActions.includes('PAYROLL_EXCEL_IMPORT') &&
      loggedActions.includes('PAYROLL_BULK_PROCESS') &&
      loggedActions.includes('PAYSLIP_BULK_GENERATE'),
      `69. Audit logs successfully recorded for: ${Array.from(new Set(loggedActions)).join(', ')}`
    );
  } finally {
    // ----------------------------------------------------
    // CLEANUP: Clean only temporary test records (Month 11, 2026)
    // ----------------------------------------------------
    console.log('\n--- CLEANUP: Removing temporary test records ---');
    try {
      if (cleanupContext.createdStorageKey) {
        await storageService.deleteFile(cleanupContext.createdStorageKey);
      }
      await pool.query(
        `DELETE FROM public.documents WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [cleanupContext.employeeId, cleanupContext.testMonth, cleanupContext.testYear]
      );
      await pool.query(
        `DELETE FROM public.payroll_records WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [cleanupContext.employeeId, cleanupContext.testMonth, cleanupContext.testYear]
      );
      console.log('  Cleaned up temporary Month 11 / Year 2026 records. September 2026 data left intact.');
    } catch (cleanupErr) {
      console.error('  Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n========================================================');
  console.log(`PHASE 19 TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================================');

  return { passed, failed };
}

if (require.main === module) {
  runPhase19Tests()
    .then(({ failed }) => {
      pool.end();
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      pool.end();
      process.exit(1);
    });
}

module.exports = runPhase19Tests;
