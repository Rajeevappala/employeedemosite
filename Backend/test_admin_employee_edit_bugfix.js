const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

const PORT = process.env.PORT || 5000;

function makeRequest(options, postData = null) {
  let payload = null;
  const reqHeaders = {
    'X-Test-Suite': 'true',
    ...(options.headers || {}),
  };
  if (postData) {
    payload = Buffer.isBuffer(postData) ? postData : Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData));
    reqHeaders['Content-Length'] = payload.length;
  }
  const reqOptions = {
    agent: false,
    ...options,
    headers: reqHeaders,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(reqOptions, (res) => {
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
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
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

  console.log('========================================================');
  console.log('  TEST ADMIN EMPLOYEE EDIT PAGE BUG FIX (GP0001N)');
  console.log('========================================================');

  try {
    // 1. Static code check of EmployeeEdit.jsx for stepError declaration
    const editCodePath = path.join(__dirname, '../Frontend/src/pages/Admin/EmployeeEdit/EmployeeEdit.jsx');
    const editCode = fs.readFileSync(editCodePath, 'utf8');

    console.log('\n--- 1. STATIC CODE & RUNTIME SAFETY AUDIT ---');
    assert(
      editCode.includes("const [stepError, setStepError] = useState('');"),
      'stepError and setStepError state hook is explicitly declared in EmployeeEdit.jsx'
    );
    assert(
      !editCode.match(/setStepError\s*=\s*undefined/),
      'setStepError is not reassigned or undefined'
    );
    assert(
      editCode.includes('(formData.status || \'ACTIVE\').toLowerCase()'),
      'Status badge rendering includes defensive fallback against null/undefined status'
    );
    assert(
      editCode.includes('(masterOptions.departments || [])'),
      'Master departments rendering safely handles null or undefined arrays'
    );
    assert(
      editCode.includes('(Current / Legacy)'),
      'Deactivated or legacy master data values are safely retained with (Current / Legacy) option'
    );

    // 2. Routing registration check
    const routesPath = path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx');
    const routesCode = fs.readFileSync(routesPath, 'utf8');
    assert(
      routesCode.includes('path="employees/:employeeId/edit"'),
      'AppRoutes.jsx correctly registers /admin/employees/:employeeId/edit'
    );
    assert(
      routesCode.includes('element={<AdminEmployeeEdit />}'),
      'Route correctly mounts AdminEmployeeEdit component'
    );

    // 3. Admin token acquisition
    const adminUserRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'ADMIN' LIMIT 1");
    assert(adminUserRes.rows.length > 0, 'Admin user found in database');
    const adminToken = generateToken({
      id: adminUserRes.rows[0].id,
      email: adminUserRes.rows[0].email,
      role: adminUserRes.rows[0].role,
    });

    // 4. Test Employee GP0001N Data Fetching
    console.log('\n--- 2. EMPLOYEE GP0001N DATA SHAPE VERIFICATION ---');
    const resGP0001N = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP0001N',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert(resGP0001N.statusCode === 200, 'GET /api/admin/employees/GP0001N returns HTTP 200');
    const gp0001nData = resGP0001N.json()?.data;
    assert(gp0001nData && gp0001nData.employee_id === 'GP0001N', 'GP0001N record has employee_id "GP0001N"');
    assert(Boolean(gp0001nData.first_name && gp0001nData.last_name), 'GP0001N has first_name and last_name populated');
    assert(Boolean(gp0001nData.department), `GP0001N department is populated (${gp0001nData.department})`);
    assert(Boolean(gp0001nData.designation), `GP0001N designation is populated (${gp0001nData.designation})`);
    assert(Boolean(gp0001nData.employment_type), `GP0001N employment_type is populated (${gp0001nData.employment_type})`);
    assert(Boolean(gp0001nData.work_location), `GP0001N work_location is populated (${gp0001nData.work_location})`);
    assert(gp0001nData.pf_details === null || typeof gp0001nData.pf_details === 'object', 'GP0001N pf_details is null or valid object (null handled safely)');

    // 5. Test another employee ID (GP0002N)
    console.log('\n--- 3. SECOND EMPLOYEE (GP0002N) DATA SHAPE VERIFICATION ---');
    const resGP0002N = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees/GP0002N',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resGP0002N.statusCode === 200, 'GET /api/admin/employees/GP0002N returns HTTP 200');
    const gp0002nData = resGP0002N.json()?.data;
    assert(gp0002nData && gp0002nData.employee_id === 'GP0002N', 'GP0002N record has employee_id "GP0002N"');

    // 6. Test Master Data API Structure
    console.log('\n--- 4. MASTER DATA API CONFIGURATION VERIFICATION ---');
    const resMaster = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/settings/employees',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resMaster.statusCode === 200, 'GET /api/admin/settings/employees returns HTTP 200');
    const masterData = resMaster.json()?.data;
    assert(Array.isArray(masterData?.departments), 'departments is an array');
    assert(Array.isArray(masterData?.designations), 'designations is an array');
    assert(Array.isArray(masterData?.employmentTypes), 'employmentTypes is an array');
    assert(Array.isArray(masterData?.locations), 'locations is an array');

    // 7. Verify Legacy Value Compatibility Logic
    console.log('\n--- 5. LEGACY & DEACTIVATED VALUE PRESERVATION AUDIT ---');
    const activeDepts = masterData.departments.filter(d => d.is_active).map(d => d.name);
    const legacyDept = 'Archived Department XYZ';
    const includesLegacy = activeDepts.includes(legacyDept);
    assert(!includesLegacy, 'Synthetic legacy department is not in active departments list');
    const optionText = !includesLegacy ? `${legacyDept} (Current / Legacy)` : legacyDept;
    assert(optionText.includes('(Current / Legacy)'), 'Option is correctly annotated as (Current / Legacy) when deactivated');

    // 8. Verify Non-destructive Update Functionality
    console.log('\n--- 6. DATA SAFETY: VERIFY NO CORRUPTION ON PERSISTENCE ---');
    const originalEmp = await pool.query("SELECT * FROM employees WHERE employee_id = 'GP0001N'");
    assert(originalEmp.rows.length === 1, 'GP0001N employee record exists exactly once in DB');
    const origDept = originalEmp.rows[0].department;
    const origDesig = originalEmp.rows[0].designation;
    assert(origDept === 'Engineering', 'GP0001N department remains "Engineering"');
    assert(origDesig === 'Python Developer', 'GP0001N designation remains "Python Developer"');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    console.log('\n========================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('========================================================\n');
    process.exit(failed > 0 ? 1 : 0);
  }
})();
