require('dotenv').config();
const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

const PORT = process.env.PORT || 5000;

function makeRequest(options) {
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
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

async function runTest() {
  console.log('================================================================');
  console.log('EMPLOYEE LIST ASCENDING SORTING TEST SUITE');
  console.log('================================================================\n');

  // Admin token
  const adminToken = generateToken({
    id: '1ef2686d-21e8-4784-be93-6daab0aecfbc',
    email: 'saiganeshm1921@gmail.com',
    role: 'ADMIN',
  });

  // Test temporary employee IDs to insert
  const tempEmpIds = ['GP0008N', 'GP0009N', 'GP0010N', 'GP0011N', 'GP0020N'];
  const tempUserIds = [];

  try {
    // Cleanup any lingering temp records
    await pool.query('DELETE FROM public.employees WHERE employee_id = ANY($1)', [tempEmpIds]);
    await pool.query('DELETE FROM public.users WHERE email LIKE $1', ['sort_test_%@gaintpro.com']);

    // Insert temporary test employees to verify numeric ordering
    for (let i = 0; i < tempEmpIds.length; i++) {
      const empId = tempEmpIds[i];
      const email = `sort_test_${empId.toLowerCase()}@gaintpro.com`;
      const userRes = await pool.query(
        "INSERT INTO public.users (email, role, status) VALUES ($1, 'EMPLOYEE', 'ACTIVE') RETURNING id",
        [email]
      );
      const userId = userRes.rows[0].id;
      tempUserIds.push(userId);

      await pool.query(
        `INSERT INTO public.employees (
          employee_id, user_id, first_name, last_name, email, department, designation, date_of_joining, status
        ) VALUES ($1, $2, 'SortTest', $3, $4, 'Technology', 'QA Engineer', '2024-01-01', 'ACTIVE')`,
        [empId, userId, `Emp_${empId}`, email]
      );
      await pool.query('UPDATE public.users SET employee_id = $1 WHERE id = $2', [empId, userId]);
    }

    // 1. Basic Ascending Sort Check on Page 1 (limit: 20)
    const res1 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees?page=1&limit=20',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res1.statusCode === 200, 'GET /api/admin/employees returns 200');

    const json1 = res1.json();
    const ids1 = (json1.data || []).map((e) => e.employee_id);
    console.log('  -> All retrieved Employee IDs:', ids1);

    // Verify GP0001N < GP0002N < GP0003N
    const idx1 = ids1.indexOf('GP0001N');
    const idx2 = ids1.indexOf('GP0002N');
    const idx3 = ids1.indexOf('GP0003N');

    assert(idx1 !== -1 && idx2 !== -1 && idx3 !== -1, 'GP0001N, GP0002N, GP0003N exist in response');
    assert(idx1 < idx2, `GP0001N (pos ${idx1}) appears before GP0002N (pos ${idx2})`);
    assert(idx2 < idx3, `GP0002N (pos ${idx2}) appears before GP0003N (pos ${idx3})`);

    // 2. Numeric Sequence Check (GP0009N < GP0010N < GP0011N < GP0020N)
    // Lexicographical ordering would sort GP0010N, GP0011N, GP0020N before GP0009N if not zero-padded,
    // and with variable lengths, numeric sort guarantees numeric ordering:
    const idx8 = ids1.indexOf('GP0008N');
    const idx9 = ids1.indexOf('GP0009N');
    const idx10 = ids1.indexOf('GP0010N');
    const idx11 = ids1.indexOf('GP0011N');
    const idx20 = ids1.indexOf('GP0020N');

    assert(idx8 < idx9, `GP0008N (pos ${idx8}) appears before GP0009N (pos ${idx9})`);
    assert(idx9 < idx10, `GP0009N (pos ${idx9}) appears before GP0010N (pos ${idx10})`);
    assert(idx10 < idx11, `GP0010N (pos ${idx10}) appears before GP0011N (pos ${idx11})`);
    assert(idx11 < idx20, `GP0011N (pos ${idx11}) appears before GP0020N (pos ${idx20})`);

    // Verify completely monotonic numeric ordering across all returned items
    let strictlyAscending = true;
    for (let i = 0; i < ids1.length - 1; i++) {
      const numA = parseInt(ids1[i].replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(ids1[i + 1].replace(/\D/g, ''), 10) || 0;
      if (numA > numB) {
        strictlyAscending = false;
        console.error(`  Out of order: ${ids1[i]} (${numA}) > ${ids1[i + 1]} (${numB})`);
      }
    }
    assert(strictlyAscending, 'All employee IDs in result list follow strictly ascending numeric order');

    // 3. Pagination Ordering Check (Page 1 vs Page 2 with limit=3)
    const page1Res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees?page=1&limit=3',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const page2Res = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees?page=2&limit=3',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const page1Ids = (page1Res.json().data || []).map((e) => e.employee_id);
    const page2Ids = (page2Res.json().data || []).map((e) => e.employee_id);

    console.log('  -> Page 1 IDs (limit 3):', page1Ids);
    console.log('  -> Page 2 IDs (limit 3):', page2Ids);

    assert(page1Ids.length === 3, 'Page 1 returns 3 records');
    assert(page2Ids.length === 3, 'Page 2 returns 3 records');

    const maxPage1Num = Math.max(...page1Ids.map((id) => parseInt(id.replace(/\D/g, ''), 10)));
    const minPage2Num = Math.min(...page2Ids.map((id) => parseInt(id.replace(/\D/g, ''), 10)));
    assert(maxPage1Num < minPage2Num, `Pagination is sorted BEFORE pagination: Page 1 max (${maxPage1Num}) < Page 2 min (${minPage2Num})`);

    // 4. Search Filter with Ascending Order
    const searchRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees?search=SortTest&limit=20',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchIds = (searchRes.json().data || []).map((e) => e.employee_id);
    console.log('  -> Search "SortTest" IDs:', searchIds);

    let searchAscending = true;
    for (let i = 0; i < searchIds.length - 1; i++) {
      const numA = parseInt(searchIds[i].replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(searchIds[i + 1].replace(/\D/g, ''), 10) || 0;
      if (numA > numB) {
        searchAscending = false;
      }
    }
    assert(searchAscending && searchIds.length === 5, 'Search filter maintains ascending numerical Employee ID order');

    // 5. Status Filter with Ascending Order
    const statusRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/employees?status=ACTIVE&limit=20',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const statusIds = (statusRes.json().data || []).map((e) => e.employee_id);
    let statusAscending = true;
    for (let i = 0; i < statusIds.length - 1; i++) {
      const numA = parseInt(statusIds[i].replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(statusIds[i + 1].replace(/\D/g, ''), 10) || 0;
      if (numA > numB) {
        statusAscending = false;
      }
    }
    assert(statusAscending, 'Status filter maintains ascending numerical Employee ID order');

  } finally {
    // Cleanup temp records
    await pool.query('DELETE FROM public.employees WHERE employee_id = ANY($1)', [tempEmpIds]);
    await pool.query('DELETE FROM public.users WHERE email LIKE $1', ['sort_test_%@gaintpro.com']);
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
