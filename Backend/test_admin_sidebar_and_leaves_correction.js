/**
 * GAINTPRO SOFTWARE TECHNOLOGIES — AUTOMATED VERIFICATION SUITE
 * ADMIN SIDEBAR CORRECTION + LEAVE REQUEST TABLE UI UPDATE
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('./config/database');

const PORT = process.env.PORT || 5000;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json: () => {
            try {
              return JSON.parse(data);
            } catch (e) {
              return null;
            }
          },
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  ADMIN SIDEBAR + LEAVE REQUEST UI VERIFICATION SUITE           ');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: ADMIN SIDEBAR CSS VERIFICATION
    // -------------------------------------------------------------------------
    console.log('--- 1. Admin Sidebar CSS & Layout Verification ---');
    const adminCssPath = path.join(__dirname, '..', 'Frontend', 'src', 'components', 'AdminLayout', 'AdminLayout.css');
    const adminCss = fs.readFileSync(adminCssPath, 'utf8');

    // 1.1 Desktop sidebar starts below header (sticky top: 64px)
    assert(
      adminCss.includes('position: sticky;') &&
      adminCss.includes('top: 64px;') &&
      adminCss.includes('width: 256px;') &&
      adminCss.includes('height: calc(100vh - 64px);'),
      'Admin sidebar on desktop starts below header (top: 64px, width: 256px, height: calc(100vh - 64px))'
    );

    // 1.2 Layout body occupies full remaining viewport height
    assert(
      adminCss.includes('.admin-layout-body {') &&
      adminCss.includes('min-height: calc(100vh - 64px);'),
      'Admin layout body flex container occupies remaining viewport height calc(100vh - 64px)'
    );

    // 1.3 Nav list scrollable independently
    assert(
      adminCss.includes('.admin-sidebar-nav {') &&
      adminCss.includes('overflow-y: auto;'),
      'Admin sidebar navigation list scrolls independently (overflow-y: auto)'
    );

    // 1.4 Full-width header spans 100%
    assert(
      adminCss.includes('.admin-navbar {') &&
      adminCss.includes('width: 100%;') &&
      adminCss.includes('position: sticky;') &&
      adminCss.includes('top: 0;'),
      'Admin navbar header spans full browser width (width: 100%, sticky top: 0)'
    );

    // 1.5 Main content independently scrollable
    assert(
      adminCss.includes('.admin-main-content {') &&
      adminCss.includes('overflow-y: auto;'),
      'Admin main content container scrolls independently'
    );

    // 1.6 Mobile drawer media query preserves mobile layout
    assert(
      adminCss.includes('@media (max-width: 1023px)') &&
      adminCss.includes('transform: translateX(-100%);'),
      'Mobile/tablet drawer (< 1024px) preserves off-canvas slide-out'
    );

    // 1.7 Employee sidebar was NOT broken or altered
    const empSidebarCssPath = path.join(__dirname, '..', 'Frontend', 'src', 'components', 'Sidebar', 'Sidebar.css');
    const empSidebarCss = fs.readFileSync(empSidebarCssPath, 'utf8');
    assert(
      empSidebarCss.includes('.portal-sidebar {') &&
      empSidebarCss.includes('position: sticky;') &&
      empSidebarCss.includes('top: 64px;'),
      'Employee portal sidebar remains completely intact with its working layout'
    );

    // -------------------------------------------------------------------------
    // SECTION 2: LEAVE REQUEST TABLE UI VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Leave Request Table UI Verification ---');
    const leavesJsxPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Leaves', 'Leaves.jsx');
    const leavesJsx = fs.readFileSync(leavesJsxPath, 'utf8');

    // 2.1 Visible table headers check
    const theadMatch = leavesJsx.match(/<thead>([\s\S]*?)<\/thead>/);
    assert(theadMatch !== null, 'Table <thead> element found in Leaves.jsx');
    if (theadMatch) {
      const theadContent = theadMatch[1];
      assert(!theadContent.includes('Request ID'), 'Request ID column header is NOT present in visible table <thead>');
      assert(theadContent.includes('Employee'), 'Employee column header is present');
      assert(theadContent.includes('Employee ID'), 'Employee ID column header is present');
      assert(theadContent.includes('Leave Type'), 'Leave Type column header is present');
      assert(theadContent.includes('Start Date'), 'Start Date column header is present');
      assert(theadContent.includes('End Date'), 'End Date column header is present');
      assert(theadContent.includes('Days'), 'Days column header is present');
      assert(theadContent.includes('Requested On'), 'Requested On column header is present');
      assert(theadContent.includes('Status'), 'Status column header is present');
      assert(theadContent.includes('Actions'), 'Actions column header is present');
    }

    // 2.2 Table body rows check
    const tbodyMatch = leavesJsx.match(/<tbody>([\s\S]*?)<\/tbody>/);
    assert(tbodyMatch !== null, 'Table <tbody> element found in Leaves.jsx');
    if (tbodyMatch) {
      const tbodyContent = tbodyMatch[1];
      assert(!tbodyContent.includes('<span className="admin-id-badge">{req.id}</span>'), 'req.id badge is NOT rendered as a visible table cell in <tbody>');
      assert(tbodyContent.includes('{req.employeeName}'), 'req.employeeName is rendered in table row');
      assert(tbodyContent.includes('{req.employeeId}'), 'req.employeeId is rendered in table row');
      assert(tbodyContent.includes('{req.leaveType}'), 'req.leaveType is rendered in table row');
      assert(tbodyContent.includes('colSpan="9"'), 'Empty and loading states correctly span 9 columns (instead of 10)');
    }

    // 2.3 Leave details modal check
    assert(!leavesJsx.includes('Request ID: {viewRequest.id}'), 'Modal header subtitle does NOT show raw UUID');
    assert(leavesJsx.includes('{viewRequest.employeeName} &bull; {viewRequest.employeeId}'), 'Modal header subtitle cleanly displays employee name and ID');
    assert(!leavesJsx.includes('<span className="doc-meta-lbl">Request ID</span>'), 'Modal metadata grid does NOT contain raw Request ID label');
    assert(leavesJsx.includes('<span className="doc-meta-lbl">Employee</span>'), 'Modal metadata grid contains clean Employee section');
    assert(leavesJsx.includes('<span className="doc-meta-lbl">Employee ID</span>'), 'Modal metadata grid contains clean Employee ID section');

    // 2.4 Internal availability of leave ID
    assert(leavesJsx.includes('key={req.id}'), 'req.id is preserved internally for React reconciliation key');
    assert(leavesJsx.includes('setViewRequest(req)'), 'req object with id is passed to setViewRequest');
    assert(leavesJsx.includes('setApproveRequest(req)'), 'req object with id is passed to setApproveRequest');
    assert(leavesJsx.includes('setRejectRequest(req)'), 'req object with id is passed to setRejectRequest');
    assert(leavesJsx.includes('api.admin.approveLeave'), 'api.admin.approveLeave action remains intact');
    assert(leavesJsx.includes('api.admin.rejectLeave'), 'api.admin.rejectLeave action remains intact');

    // -------------------------------------------------------------------------
    // SECTION 3: BACKEND LEAVE APIS & INTEGRATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Backend Leave APIs & Data Integrity ---');

    // Get Admin user from database
    const adminUser = (
      await pool.query("SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1")
    ).rows[0];
    assert(Boolean(adminUser), `Admin user found in database (${adminUser?.email})`);

    // Generate JWT for admin
    const { generateToken } = require('./utils/tokenUtils');
    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // 3.1 Fetch leaves list via API
    const leavesRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves?page=1&limit=10',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert(leavesRes.statusCode === 200, 'GET /api/admin/leaves returns HTTP 200 OK');
    const leavesJson = leavesRes.json();
    assert(leavesJson && leavesJson.success === true, 'Response indicates success = true');
    assert(Array.isArray(leavesJson.data), 'Response data is an array of leave records');
    assert(Boolean(leavesJson.summary), 'Response includes summary statistics object');
    assert(Boolean(leavesJson.pagination), 'Response includes pagination metadata');

    if (leavesJson.data.length > 0) {
      const sample = leavesJson.data[0];
      assert(Boolean(sample.id), `Leave ID (${sample.id}) is returned by API for internal operations`);
      assert(Boolean(sample.employee_id), `Employee ID (${sample.employee_id}) is returned by API`);
      assert(Boolean(sample.employee_name), `Employee Name (${sample.employee_name}) is returned by API`);
      assert(Boolean(sample.leave_type), `Leave Type (${sample.leave_type}) is returned by API`);
      assert(Boolean(sample.status), `Leave Status (${sample.status}) is returned by API`);
    }

    // 3.2 Fetch leave balances via API
    const balancesRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/balances',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert(balancesRes.statusCode === 200, 'GET /api/admin/leaves/balances returns HTTP 200 OK');
    const balancesJson = balancesRes.json();
    assert(balancesJson && balancesJson.success === true, 'Leave balances response indicates success = true');
    assert(Array.isArray(balancesJson.data), 'Leave balances data is an array');

    // 3.3 Test status filter
    const pendingFilterRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves?status=Pending',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(pendingFilterRes.statusCode === 200, 'Filter ?status=Pending returns HTTP 200 OK');

    // 3.4 Test leave type filter
    const plFilterRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves?leave_type=PL',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(plFilterRes.statusCode === 200, 'Filter ?leave_type=PL returns HTTP 200 OK');

    console.log('\n================================================================');
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test suite execution error:', err);
    process.exit(1);
  }
}

runTests();
