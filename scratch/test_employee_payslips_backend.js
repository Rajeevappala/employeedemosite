const path = require('path');
require('../Backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../Backend/.env') });
const jwt = require('../Backend/node_modules/jsonwebtoken');
const pool = require('../Backend/config/database');
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET;
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

async function runTests() {
  console.log('--- STARTING EMPLOYEE PAYSLIP BACKEND TESTS ---');
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
    const empUserRes = await pool.query(
      `SELECT u.id, u.email, u.role, e.employee_id 
       FROM public.users u
       JOIN public.employees e ON e.email = u.email
       WHERE u.role = 'EMPLOYEE' AND e.employee_id = 'GP0001N'
       LIMIT 1`
    );
    const empUser = empUserRes.rows[0];

    const adminUserRes = await pool.query(
      `SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1`
    );
    const adminUser = adminUserRes.rows[0];

    // Generate tokens
    const empToken = jwt.sign(
      { id: empUser.id, email: empUser.email, role: 'EMPLOYEE', employee_id: empUser.employee_id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const adminToken = jwt.sign(
      { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Another employee token for cross-employee security test
    const crossEmpToken = jwt.sign(
      { id: '00000000-0000-0000-0000-000000000099', email: 'other@test.com', role: 'EMPLOYEE', employee_id: 'GP9999X' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // TEST 1: Unauthenticated request -> 401
    const resNoAuth = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
    });
    assert(resNoAuth.statusCode === 401, `Unauthenticated request returns 401 (got ${resNoAuth.statusCode})`);

    // TEST 2: Admin token requesting employee endpoint -> 403 Forbidden
    const resAdmin = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resAdmin.statusCode === 403, `Admin token returns 403 on employee payslips endpoint (got ${resAdmin.statusCode})`);

    // TEST 3: Authenticated employee token -> 200 OK
    const resEmp = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmp.statusCode === 200, `Employee token returns 200 (got ${resEmp.statusCode})`);
    const empData = resEmp.json();
    assert(empData && empData.success === true, 'Response contains success: true');
    assert(Array.isArray(empData?.data?.items), 'Response contains data.items array');
    assert(empData?.data?.pagination != null, 'Response contains pagination object');

    // TEST 4: Security - No storage_key or file paths exposed
    const responseString = resEmp.body.toString('utf8');
    assert(!responseString.includes('storage_key'), 'Response strictly excludes storage_key');
    assert(!responseString.includes('storage/private'), 'Response strictly excludes private storage path');
    assert(!responseString.includes('Backend/storage'), 'Response strictly excludes Backend/storage');

    // TEST 5: Verify joined payroll data on real payslip
    const validSlip = empData?.data?.items?.find((item) => item.month === 9 && item.year === 2026);
    assert(validSlip != null, 'Found payslip for Month 9, Year 2026');
    if (validSlip) {
      assert(validSlip.employee_id === 'GP0001N', `Payslip employee_id is GP0001N (got ${validSlip.employee_id})`);
      assert(validSlip.payroll != null, 'Payslip has joined payroll object');
      assert(validSlip.payroll.working_days === 26, `Working days is 26 (got ${validSlip.payroll?.working_days})`);
      assert(validSlip.payroll.payable_days === 26, `Payable days is 26 (got ${validSlip.payroll?.payable_days})`);
      assert(parseFloat(validSlip.payroll.gross_salary) === 40000, `Gross salary is 40000 (got ${validSlip.payroll?.gross_salary})`);
      assert(parseFloat(validSlip.payroll.total_deductions) === 2500, `Deductions is 2500 (got ${validSlip.payroll?.total_deductions})`);
      assert(parseFloat(validSlip.payroll.net_salary) === 37500, `Net salary is 37500 (got ${validSlip.payroll?.net_salary})`);
      assert(validSlip.payroll.status === 'Processed', `Payroll status is Processed (got ${validSlip.payroll?.status})`);
    }

    // TEST 6: Query filter by year & month
    const resFiltered = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips?year=2026&month=9',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resFiltered.statusCode === 200, `Filtered query returns 200 (got ${resFiltered.statusCode})`);
    const filteredData = resFiltered.json();
    assert(filteredData?.data?.items?.length === 1, `Filtered query returns exactly 1 item (got ${filteredData?.data?.items?.length})`);

    // TEST 7: Filter by non-existent year -> empty array
    const resEmptyYear = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips?year=2024',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resEmptyYear.statusCode === 200, 'Non-existent year filter returns 200');
    assert(resEmptyYear.json()?.data?.items?.length === 0, 'Non-existent year filter returns empty items list');
    assert(resEmptyYear.json()?.data?.pagination?.total === 0, 'Pagination total is 0');

    // TEST 8: Parameter pollution / arbitrary employee_id in query is ignored
    const resTamper = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/employee/payslips?employee_id=GP9999X',
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const tamperData = resTamper.json();
    assert(
      tamperData?.data?.items?.every((i) => i.employee_id === 'GP0001N'),
      'employee_id query parameter is strictly ignored (only authenticated user data returned)'
    );

    // TEST 9: Secure PDF View endpoint
    if (validSlip) {
      const resView = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${validSlip.id}/view`,
        method: 'GET',
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(resView.statusCode === 200, `View payslip returns 200 (got ${resView.statusCode})`);
      assert(resView.headers['content-type'] === 'application/pdf', `Content-Type is application/pdf (got ${resView.headers['content-type']})`);
      assert(resView.headers['content-disposition']?.includes('inline'), `Content-Disposition is inline (got ${resView.headers['content-disposition']})`);
      assert(resView.body.length > 1000, `PDF body is received with non-zero bytes (length: ${resView.body.length})`);
    }

    // TEST 10: Secure PDF Download endpoint
    if (validSlip) {
      const resDownload = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${validSlip.id}/download`,
        method: 'GET',
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(resDownload.statusCode === 200, `Download payslip returns 200 (got ${resDownload.statusCode})`);
      assert(resDownload.headers['content-type'] === 'application/pdf', `Content-Type is application/pdf (got ${resDownload.headers['content-type']})`);
      assert(resDownload.headers['content-disposition']?.includes('attachment'), `Content-Disposition is attachment (got ${resDownload.headers['content-disposition']})`);
      assert(resDownload.body.length > 1000, `PDF body is received (length: ${resDownload.body.length})`);
    }

    // TEST 11: Cross-employee access attempt -> returns 404
    if (validSlip) {
      const resCrossView = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${validSlip.id}/view`,
        method: 'GET',
        headers: { Authorization: `Bearer ${crossEmpToken}` },
      });
      assert(resCrossView.statusCode === 404, `Cross-employee view attempt returns 404 (got ${resCrossView.statusCode})`);

      const resCrossDownload = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/employee/payslips/${validSlip.id}/download`,
        method: 'GET',
        headers: { Authorization: `Bearer ${crossEmpToken}` },
      });
      assert(resCrossDownload.statusCode === 404, `Cross-employee download attempt returns 404 (got ${resCrossDownload.statusCode})`);
    }

    // TEST 12: Non-existent document UUID -> 404
    const resNotFound = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/00000000-0000-0000-0000-000000000000/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resNotFound.statusCode === 404, `Non-existent document UUID returns 404 (got ${resNotFound.statusCode})`);

    // TEST 13: Malformed document ID -> 404
    const resMalformed = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/employee/payslips/invalid-uuid/view`,
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(resMalformed.statusCode === 404, `Malformed document ID returns 404 (got ${resMalformed.statusCode})`);

    // TEST 14: Direct access to private storage blocked -> 404
    const resDirectStorage = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/storage/private/documents/GP0001N/2026/10/28dcffc0-3c36-4374-8641-39351b8eef1d.pdf`,
      method: 'GET',
    });
    assert(resDirectStorage.statusCode === 404, `Direct access to private storage directory returns 404 (got ${resDirectStorage.statusCode})`);

    console.log(`\nTests Completed: ${passed} passed, ${failed} failed.`);
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await pool.end();
  }
}

runTests();
