const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

function doRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
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
  console.log('--- STARTING EMPLOYEE DASHBOARD BACKEND TESTS ---');

  // Find employee and admin users from DB
  const empUserRes = await pool.query("SELECT * FROM users WHERE email = 'rajeevappala055@gmail.com'");
  const adminUserRes = await pool.query("SELECT * FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1");

  if (empUserRes.rows.length === 0) {
    throw new Error('Employee user rajeevappala055@gmail.com not found');
  }
  const empUser = empUserRes.rows[0];
  const adminUser = adminUserRes.rows[0];

  const empToken = generateToken({
    userId: empUser.id,
    email: empUser.email,
    role: empUser.role,
    employeeId: empUser.employee_id,
  });

  const adminToken = generateToken({
    userId: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    employeeId: adminUser.employee_id || null,
  });

  // Test 1: Unauthenticated request -> 401
  console.log('Test 1: Unauthenticated GET /api/employee/dashboard');
  const res1 = await doRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/employee/dashboard',
    method: 'GET',
  });
  console.log(`Status: ${res1.status} (expected 401)`);
  if (res1.status !== 401) throw new Error(`Test 1 Failed: Expected 401, got ${res1.status}`);

  // Test 2: Admin role trying to access employee dashboard -> 403
  console.log('Test 2: Admin user access GET /api/employee/dashboard');
  const res2 = await doRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/employee/dashboard',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`Status: ${res2.status} (expected 403)`);
  if (res2.status !== 403) throw new Error(`Test 2 Failed: Expected 403, got ${res2.status}`);

  // Test 3: Authenticated Employee access -> 200
  console.log('Test 3: Employee user access GET /api/employee/dashboard');
  const res3 = await doRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/employee/dashboard',
    method: 'GET',
    headers: { Authorization: `Bearer ${empToken}` },
  });
  console.log(`Status: ${res3.status} (expected 200)`);
  if (res3.status !== 200) {
    console.error('Response:', res3.body);
    throw new Error(`Test 3 Failed: Expected 200, got ${res3.status}`);
  }

  const data = res3.body.data;
  console.log('Dashboard Data Profile:', data.profile);
  console.log('Counts:', data.counts);
  console.log('Today Attendance:', data.today_attendance);
  console.log('Attendance Summary:', data.attendance_summary);
  console.log('Leave Summary:', data.leave_summary);
  console.log('Latest Payslip:', data.latest_payslip);
  console.log('Recent Documents Count:', data.recent_documents.length);
  console.log('PF Summary:', data.pf_summary);

  // Assertions
  if (data.profile.employee_id !== 'GP0001N') throw new Error('Employee ID mismatch');
  if (!data.profile.first_name || !data.profile.last_name) throw new Error('Missing name fields');
  if (typeof data.counts.document_count !== 'number') throw new Error('Document count must be number');
  if (typeof data.leave_summary.pending_count !== 'number') throw new Error('Leave pending_count must be number');
  if (!Array.isArray(data.recent_leaves)) throw new Error('recent_leaves must be array');
  if (!Array.isArray(data.recent_documents)) throw new Error('recent_documents must be array');
  if (!Array.isArray(data.recent_attendance)) throw new Error('recent_attendance must be array');

  // Verify no storage_key leaked
  const str = JSON.stringify(res3.body);
  if (str.includes('storage_key') || str.includes('password_hash') || str.includes('otp_hash')) {
    throw new Error('Sensitive information leaked in API response!');
  }

  // Test 4: Query parameter date filter
  console.log('Test 4: Date parameter filter GET /api/employee/dashboard?date=2026-09-30');
  const res4 = await doRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/employee/dashboard?date=2026-09-30',
    method: 'GET',
    headers: { Authorization: `Bearer ${empToken}` },
  });
  if (res4.status !== 200) throw new Error(`Test 4 Failed: Expected 200, got ${res4.status}`);
  if (res4.body.data.today_attendance.status !== 'Present') {
    throw new Error(`Expected Present for 2026-09-30, got ${res4.body.data.today_attendance.status}`);
  }
  console.log('Test 4 passed: 2026-09-30 today_attendance marked Present correctly');

  // Test 5: Invalid date format
  console.log('Test 5: Invalid date format -> 400');
  const res5 = await doRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/employee/dashboard?date=invalid-date',
    method: 'GET',
    headers: { Authorization: `Bearer ${empToken}` },
  });
  if (res5.status !== 400) throw new Error(`Test 5 Failed: Expected 400, got ${res5.status}`);
  console.log('Test 5 passed: Invalid date returned 400');

  console.log('--- ALL EMPLOYEE DASHBOARD BACKEND TESTS PASSED ---');
  await pool.end();
}

runTests().catch(err => {
  console.error('TEST ERROR:', err);
  pool.end();
  process.exit(1);
});
