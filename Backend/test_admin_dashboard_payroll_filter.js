require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');
const storageService = require('./services/storageService');

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
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log(' ADMIN DASHBOARD PAYROLL FILTER & HISTORICAL DATA TESTS');
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
    // 1. Fetch employee & admin users from DB
    const empRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
       LIMIT 1`
    );
    const empUser = empRes.rows[0];

    const otherEmpRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id != 'GP0001N'
       LIMIT 1`
    );
    const otherEmpUser = otherEmpRes.rows[0];

    const adminRes = await pool.query(
      `SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1`
    );
    const adminUser = adminRes.rows[0];

    assert(adminUser != null, 'Admin user found in database');
    assert(empUser != null, 'Employee GP0001N found in database');

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
    });

    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employeeId: empUser.employee_id,
    });

    // ---------------------------------------------------------------
    // Test 1: October 2026 displays correct empty state (0 records)
    // ---------------------------------------------------------------
    console.log('\n--- Test 1: October 2026 Empty State ---');
    const octRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=10&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(octRes.statusCode === 200, `October 2026 returns 200 OK (got ${octRes.statusCode})`);
    const octData = octRes.json()?.data;
    assert(octData?.payroll?.month === 10, 'October month is 10');
    assert(octData?.payroll?.year === 2026, 'October year is 2026');
    assert(octData?.payroll?.total_records === 0, 'October total_records is 0');
    assert(octData?.payroll?.status === 'Not Processed', 'October status is "Not Processed"');
    assert(parseFloat(octData?.payroll?.gross_salary) === 0, 'October gross_salary is 0');
    assert(parseFloat(octData?.payroll?.net_salary) === 0, 'October net_salary is 0');
    assert(parseFloat(octData?.payroll?.total_deductions) === 0, 'October total_deductions is 0');
    assert(Array.isArray(octData?.payroll?.payslips) && octData?.payroll?.payslips.length === 0, 'October payslips array is empty');

    // ---------------------------------------------------------------
    // Test 2: September 2026 loads existing September payroll info
    // ---------------------------------------------------------------
    console.log('\n--- Test 2: September 2026 Payroll Data & Dynamic DB Verification ---');
    // Fetch actual DB totals for September 2026
    const sepDbPayroll = await pool.query(`
      SELECT 
        COUNT(*)::int AS count,
        COALESCE(SUM(gross_salary), 0)::numeric AS gross,
        COALESCE(SUM(total_deductions), 0)::numeric AS deductions,
        COALESCE(SUM(net_salary), 0)::numeric AS net
      FROM public.payroll_records
      WHERE month = 9 AND year = 2026
    `);
    const dbExpected = sepDbPayroll.rows[0];

    const sepRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=9&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(sepRes.statusCode === 200, `September 2026 returns 200 OK (got ${sepRes.statusCode})`);
    const sepData = sepRes.json()?.data;
    assert(sepData?.payroll?.month === 9, 'September month is 9');
    assert(sepData?.payroll?.year === 2026, 'September year is 2026');
    assert(sepData?.payroll?.month_name === 'September', 'September month_name is "September"');
    assert(sepData?.payroll?.total_records === dbExpected.count, `Total records match DB (${sepData?.payroll?.total_records} === ${dbExpected.count})`);
    assert(parseFloat(sepData?.payroll?.gross_salary) === parseFloat(dbExpected.gross), `Gross salary matches DB (${sepData?.payroll?.gross_salary} === ${dbExpected.gross})`);
    assert(parseFloat(sepData?.payroll?.total_deductions) === parseFloat(dbExpected.deductions), `Deductions match DB (${sepData?.payroll?.total_deductions} === ${dbExpected.deductions})`);
    assert(parseFloat(sepData?.payroll?.net_salary) === parseFloat(dbExpected.net), `Net salary matches DB (${sepData?.payroll?.net_salary} === ${dbExpected.net})`);
    assert(sepData?.payroll?.status === 'Completed' || sepData?.payroll?.status === 'Processed', `Status is valid non-empty (${sepData?.payroll?.status})`);
    assert(sepData?.payroll?.batch != null, 'Latest batch metadata is attached');
    assert(sepData?.payroll?.batch?.batch_id != null, `Batch ID is populated: ${sepData?.payroll?.batch?.batch_id}`);

    // Check payslips list
    assert(Array.isArray(sepData?.payroll?.payslips), 'Payroll payslips is an array');
    assert(sepData?.payroll?.payslips.length === dbExpected.count, `Payslips count matches records (${sepData?.payroll?.payslips.length} === ${dbExpected.count})`);
    
    // Check individual payslip attributes
    const firstPayslip = sepData?.payroll?.payslips[0];
    assert(firstPayslip?.employee_id != null, `Payslip has employee_id (${firstPayslip?.employee_id})`);
    assert(firstPayslip?.employee_name != null, `Payslip has employee_name (${firstPayslip?.employee_name})`);
    assert(firstPayslip?.has_payslip === true, 'Payslip has_payslip flag is true');
    assert(firstPayslip?.document_id != null, `Payslip document_id is present: ${firstPayslip?.document_id}`);
    assert(firstPayslip?.is_file_available === true, 'Payslip file physically exists on storage disk');
    assert(firstPayslip?.file_name != null, `Payslip file_name is present: ${firstPayslip?.file_name}`);

    // Verify storage_key is NOT leaked
    assert(!JSON.stringify(sepData?.payroll).includes('storage_key'), 'storage_key is NOT exposed in payroll JSON');

    // ---------------------------------------------------------------
    // Test 3: Switching Between Months
    // ---------------------------------------------------------------
    console.log('\n--- Test 3: Switching Months (January 2026, May 2026, September 2026) ---');
    const janRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=1&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(janRes.statusCode === 200, 'January 2026 returns 200');
    const janData = janRes.json()?.data;
    assert(janData?.payroll?.month === 1, 'January month is 1');
    assert(janData?.payroll?.total_records === 2, `January total_records is 2 (got ${janData?.payroll?.total_records})`);
    assert(parseFloat(janData?.payroll?.gross_salary) === 128000, `January gross is 128000 (got ${janData?.payroll?.gross_salary})`);
    assert(parseFloat(janData?.payroll?.net_salary) === 124000, `January net is 124000 (got ${janData?.payroll?.net_salary})`);

    const mayRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=5&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(mayRes.statusCode === 200, 'May 2026 returns 200');
    const mayData = mayRes.json()?.data;
    assert(mayData?.payroll?.total_records === 0, 'May 2026 has 0 records (empty state)');
    assert(mayData?.payroll?.status === 'Not Processed', 'May 2026 status is "Not Processed"');

    // ---------------------------------------------------------------
    // Test 4: Available Years in response
    // ---------------------------------------------------------------
    console.log('\n--- Test 4: Available Years Metadata ---');
    assert(Array.isArray(sepData?.payroll?.available_years), 'available_years is an array');
    assert(sepData?.payroll?.available_years.includes(2026), 'available_years includes 2026');

    // ---------------------------------------------------------------
    // Test 5: Payslip Viewing & Downloading Security
    // ---------------------------------------------------------------
    console.log('\n--- Test 5: Payslip Viewing & Downloading ---');
    const docId = firstPayslip.document_id;
    const docEmpId = firstPayslip.employee_id;

    // Admin download payslip
    const adminDownloadRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/documents/${docId}/download?employee_id=${docEmpId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminDownloadRes.statusCode === 200, `Admin can download payslip (got ${adminDownloadRes.statusCode})`);
    assert(adminDownloadRes.headers['content-type'] === 'application/pdf', `Content-Type is application/pdf (${adminDownloadRes.headers['content-type']})`);
    assert(adminDownloadRes.body.length > 500, `Downloaded PDF has valid size (${adminDownloadRes.body.length} bytes)`);

    // Admin view payslip (inline)
    const adminViewRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/documents/${docId}/view?employee_id=${docEmpId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminViewRes.statusCode === 200, `Admin can view payslip inline (got ${adminViewRes.statusCode})`);
    assert(adminViewRes.headers['content-disposition']?.includes('inline'), `Content-Disposition is inline (${adminViewRes.headers['content-disposition']})`);

    // ---------------------------------------------------------------
    // Test 6: Role Restrictions and Access Control
    // ---------------------------------------------------------------
    console.log('\n--- Test 6: Role Restrictions & Security ---');
    // Employee attempting to access Admin Dashboard -> 403
    const empDashRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=9&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empDashRes.statusCode === 403, `Employee cannot access admin dashboard (got ${empDashRes.statusCode})`);

    // Employee attempting to access Admin Documents API -> 403
    const empAdminDocRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/documents/${docId}/download`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empAdminDocRes.statusCode === 403, `Employee cannot call admin download endpoint (got ${empAdminDocRes.statusCode})`);

    // ---------------------------------------------------------------
    // Test 7: Parameter Validation & SQL Injection Protection
    // ---------------------------------------------------------------
    console.log('\n--- Test 7: Parameter Validation & SQL Injection Protection ---');
    const sqliRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: "/api/admin/dashboard?month=9%27%20OR%201=1--&year=2026",
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(sqliRes.statusCode === 400, `SQL injection in month parameter blocked with 400 (got ${sqliRes.statusCode})`);

    const invalidYearRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=9&year=1850',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(invalidYearRes.statusCode === 400, `Year out of range returns 400 (got ${invalidYearRes.statusCode})`);

    const invalidMonthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/dashboard?month=13&year=2026',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(invalidMonthRes.statusCode === 400, `Month out of range (13) returns 400 (got ${invalidMonthRes.statusCode})`);

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
