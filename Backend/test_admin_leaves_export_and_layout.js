/**
 * GAINTPRO SOFTWARE TECHNOLOGIES — AUTOMATED VERIFICATION SUITE
 * ADMIN LEAVE MANAGEMENT: HORIZONTAL OVERFLOW FIX + EXCEL LEAVE REPORT EXPORT
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const ExcelJS = require('exceljs');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

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
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer: buffer,
          body: buffer.toString('utf8'),
          json: () => {
            try {
              return JSON.parse(buffer.toString('utf8'));
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
  console.log('  ADMIN LEAVES OVERFLOW & EXCEL EXPORT VERIFICATION SUITE       ');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // PART 1: UI LAYOUT & HORIZONTAL OVERFLOW PREVENTION
    // -------------------------------------------------------------------------
    console.log('--- 1. UI Layout & Overflow Prevention Verification ---');

    const leavesCssPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Leaves', 'Leaves.css');
    const leavesCss = fs.readFileSync(leavesCssPath, 'utf8');

    const leavesJsxPath = path.join(__dirname, '..', 'Frontend', 'src', 'pages', 'Admin', 'Leaves', 'Leaves.jsx');
    const leavesJsx = fs.readFileSync(leavesJsxPath, 'utf8');

    // 1. Leave page root sizing and constraint
    assert(
      leavesCss.includes('.admin-leaves-page {') &&
      leavesCss.includes('width: 100%;') &&
      leavesCss.includes('max-width: 100%;') &&
      leavesCss.includes('box-sizing: border-box;') &&
      leavesCss.includes('min-width: 0;'),
      '1. Leaves page uses width: 100%, max-width: 100%, min-width: 0, box-sizing: border-box'
    );
    assert(
      !leavesCss.includes('100vw'),
      '2. No improper width: 100vw inside admin leaves styles'
    );

    // 2. Header responsiveness
    assert(
      leavesCss.includes('.admin-leaves-header {') &&
      leavesCss.includes('justify-content: space-between;') &&
      leavesCss.includes('flex-wrap: wrap;') &&
      leavesCss.includes('.admin-header-actions {'),
      '3. Header contains flex layout with export action group'
    );
    assert(
      leavesCss.includes('.admin-leaves-header {') &&
      leavesCss.includes('flex-direction: column;') &&
      leavesCss.includes('.admin-header-actions .admin-btn {') &&
      leavesCss.includes('width: 100%;'),
      '4. Header responds on mobile: export button stacks full-width below title'
    );

    // 3. Statistics cards grid
    assert(
      leavesCss.includes('.admin-leaves-summary-grid {') &&
      leavesCss.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'),
      '5. Statistics cards use responsive 4-column CSS grid on desktop'
    );
    assert(
      leavesCss.includes('@media (max-width: 1024px)') &&
      leavesCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'),
      '6. Statistics cards respond to 2 columns on tablet viewports'
    );
    assert(
      leavesCss.includes('@media (max-width: 767px)') &&
      leavesCss.includes('grid-template-columns: 1fr;'),
      '7. Statistics cards respond to 1 column on mobile viewports'
    );

    // 4. Responsive filter section
    assert(
      leavesJsx.includes('admin-leaves-filters-grid') &&
      leavesCss.includes('.admin-leaves-filters-grid {') &&
      leavesCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr));'),
      '8. Filters use responsive 5-column CSS grid on desktop'
    );
    assert(
      leavesCss.includes('@media (max-width: 1200px)') &&
      leavesCss.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'),
      '9. Filters respond to 4 columns at <=1200px'
    );
    assert(
      leavesCss.includes('@media (max-width: 900px)') &&
      leavesCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'),
      '10. Filters respond to 2 columns on tablet/medium screens (<=900px)'
    );
    assert(
      leavesCss.includes('@media (max-width: 600px)') &&
      leavesCss.includes('grid-template-columns: 1fr;'),
      '11. Filters respond to 1 column on mobile screens (<=600px)'
    );

    // 5. Filter controls & labels integrity
    assert(
      leavesJsx.includes('htmlFor="leaveEmployeeSearch"') &&
      leavesJsx.includes('htmlFor="leaveStatusFilter"') &&
      leavesJsx.includes('htmlFor="leaveTypeFilter"') &&
      leavesJsx.includes('htmlFor="leaveDeptFilter"') &&
      leavesJsx.includes('htmlFor="leaveDateFilter"'),
      '12. All 5 filter controls (Employee ID, Status, Type, Department, Date) have proper labels'
    );
    assert(
      leavesCss.includes('.admin-filter-group {') &&
      leavesCss.includes('min-width: 0;') &&
      leavesCss.includes('.admin-filter-select {') &&
      leavesCss.includes('width: 100%;'),
      '13. Filter controls allow shrinking with min-width: 0 and width: 100%'
    );

    // 6. Dedicated table scrolling wrapper
    assert(
      leavesJsx.includes('leave-table-wrapper') &&
      leavesCss.includes('.leave-table-wrapper {') &&
      leavesCss.includes('overflow-x: auto;') &&
      leavesCss.includes('max-width: 100%;'),
      '14. Table is wrapped in .leave-table-wrapper with isolated overflow-x: auto'
    );
    assert(
      leavesCss.includes('.leave-table-wrapper .admin-table') &&
      leavesCss.includes('min-width: 800px;'),
      '15. Table inside wrapper has min-width so horizontal scrolling is contained solely to table wrapper'
    );

    // 7. Export button on frontend
    assert(
      leavesJsx.includes('handleExportReport') &&
      leavesJsx.includes('api.admin.exportLeaves'),
      '16. Frontend handles export via api.admin.exportLeaves'
    );
    assert(
      leavesJsx.includes('leave_report_') &&
      leavesJsx.includes('.xlsx'),
      '17. Download filename ends with .xlsx'
    );

    // -------------------------------------------------------------------------
    // PART 2: BACKEND EXCEL EXPORT ENDPOINT & SECURITY VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Backend Excel Export Endpoint & RBAC Verification ---');

    // 2.1 Unauthenticated request -> 401 Unauthorized
    const unauthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export',
      method: 'GET',
    });
    assert(unauthRes.statusCode === 401, '18. Unauthenticated export request returns 401 Unauthorized');

    // 2.2 Employee authenticated request -> 403 Forbidden
    const empUserRes = await pool.query(
      "SELECT u.id, u.email, u.role, u.employee_id FROM public.users u WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' LIMIT 1"
    );
    if (empUserRes.rows.length > 0) {
      const empUser = empUserRes.rows[0];
      const empToken = generateToken({
        id: empUser.id,
        email: empUser.email,
        role: 'EMPLOYEE',
        employee_id: empUser.employee_id,
      });

      const empRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: '/api/admin/leaves/export',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${empToken}`,
        },
      });
      assert(empRes.statusCode === 403, '19. Employee account receives 403 Forbidden on export');
    } else {
      console.log('  ⚠️ [SKIP] No active employee user found to test 403');
    }

    // 2.3 Admin authenticated request -> 200 OK with valid XLSX
    const adminUser = (
      await pool.query("SELECT id, email, role FROM public.users WHERE role = 'ADMIN' LIMIT 1")
    ).rows[0];
    assert(Boolean(adminUser), `Admin user located (${adminUser?.email})`);

    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const exportRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert(exportRes.statusCode === 200, '20. Admin receives HTTP 200 OK from /api/admin/leaves/export');
    assert(
      exportRes.headers['content-type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `21. Response Content-Type is XLSX (${exportRes.headers['content-type']})`
    );
    assert(
      Boolean(exportRes.headers['content-disposition']) &&
      exportRes.headers['content-disposition'].includes('attachment') &&
      exportRes.headers['content-disposition'].includes('.xlsx'),
      `22. Content-Disposition is attachment with .xlsx filename (${exportRes.headers['content-disposition']})`
    );

    // Verify ZIP magic bytes (PK\x03\x04)
    const isZip = exportRes.buffer.length >= 4 &&
      exportRes.buffer[0] === 0x50 &&
      exportRes.buffer[1] === 0x4b &&
      exportRes.buffer[2] === 0x03 &&
      exportRes.buffer[3] === 0x04;
    assert(isZip, '23. Downloaded binary starts with PK ZIP archive magic bytes');

    // 2.4 Verify workbook parsing with ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportRes.buffer);
    assert(Boolean(workbook), '24. Downloaded buffer successfully parsed as Excel workbook');

    const worksheet = workbook.getWorksheet('Leave Report');
    assert(Boolean(worksheet), '25. Worksheet "Leave Report" exists in workbook');

    // Verify first row frozen
    const views = worksheet.views || [];
    const isFrozen = views.some((v) => v.state === 'frozen' && v.ySplit === 1);
    assert(isFrozen, '26. First row is frozen in Excel worksheet views');

    // Verify autoFilter
    assert(Boolean(worksheet.autoFilter), '27. Auto-filter is configured on header row');

    // Verify expected header columns
    const expectedHeaders = [
      'Employee ID',
      'Employee Name',
      'Email',
      'Department',
      'Designation',
      'Leave Type',
      'Start Date',
      'End Date',
      'Total Days',
      'Reason',
      'Status',
      'Admin Comment',
      'Reviewed By',
      'Reviewed At',
      'Applied At',
    ];

    const actualHeaders = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      actualHeaders.push(String(cell.value).trim());
    });

    const allHeadersMatch = expectedHeaders.every((h, i) => actualHeaders[i] === h);
    assert(allHeadersMatch, `28. Header row contains all 15 expected columns: ${actualHeaders.join(', ')}`);

    // Verify header style
    const headerCell = headerRow.getCell(1);
    assert(Boolean(headerCell.font && headerCell.font.bold), '29. Header row font is bold');

    // 2.5 Super Admin can export
    const superAdminToken = generateToken({
      id: adminUser.id,
      email: 'superadmin_test@gaintpro.com',
      role: 'SUPER_ADMIN',
    });
    const superExportRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
      },
    });
    assert(superExportRes.statusCode === 200, '30. Super Admin receives HTTP 200 OK on export');
    const superWb = new ExcelJS.Workbook();
    await superWb.xlsx.load(superExportRes.buffer);
    assert(Boolean(superWb.getWorksheet('Leave Report')), '30b. Super Admin export returns valid Excel workbook');

    // 2.6 Filtered export testing
    // Filter by status=Approved
    const filterStatusRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export?status=Approved',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(filterStatusRes.statusCode === 200, '31. Export with ?status=Approved returns HTTP 200');
    const filterStatusWb = new ExcelJS.Workbook();
    await filterStatusWb.xlsx.load(filterStatusRes.buffer);
    const filterStatusWs = filterStatusWb.getWorksheet('Leave Report');
    let allApproved = true;
    let dataRowCount = 0;
    filterStatusWs.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        dataRowCount++;
        const statusVal = row.getCell(11).value; // Column 11: Status
        if (statusVal && statusVal !== 'Approved') {
          allApproved = false;
        }
      }
    });
    if (dataRowCount > 0) {
      assert(allApproved, '32. All exported records match filtered status "Approved"');
    } else {
      assert(true, '32. No Approved records in DB, export gracefully handled');
    }

    // Filter by leave_type=PL
    const filterTypeRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export?leave_type=PL',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(filterTypeRes.statusCode === 200, '33. Export with ?leave_type=PL returns HTTP 200');

    // 2.7 Empty result export handling (filters matching 0 records)
    const emptyExportRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/export?search=NONEXISTENT_FILTER_KEY_XYZ_12345',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(emptyExportRes.statusCode === 200, '34. Empty result export returns HTTP 200');
    const emptyWb = new ExcelJS.Workbook();
    await emptyWb.xlsx.load(emptyExportRes.buffer);
    const emptyWs = emptyWb.getWorksheet('Leave Report');
    assert(Boolean(emptyWs), '35. Empty result workbook contains valid "Leave Report" worksheet');
    const emptyRowCell = emptyWs.getRow(2).getCell(1);
    assert(
      String(emptyRowCell.value).includes('No leave records found'),
      `36. Empty result worksheet provides clean informative message (${emptyRowCell.value})`
    );

    // -------------------------------------------------------------------------
    // PART 3: EXISTING LEAVE FUNCTIONALITY REGRESSION CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Existing Leave Management Functionality Regression ---');

    // 3.1 GET /api/admin/leaves
    const listRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves?page=1&limit=5',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(listRes.statusCode === 200, '37. GET /api/admin/leaves continues to operate with status 200');
    const listJson = listRes.json();
    assert(listJson && listJson.success === true, '38. Leaves list response indicates success = true');

    // 3.2 GET /api/admin/leaves/balances
    const balRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/leaves/balances',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert(balRes.statusCode === 200, '39. GET /api/admin/leaves/balances operates with status 200');

    // 3.3 GET /api/admin/leaves/:leaveId
    if (listJson.data && listJson.data.length > 0) {
      const leaveId = listJson.data[0].id;
      const singleRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/admin/leaves/${leaveId}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      assert(singleRes.statusCode === 200, `40. GET /api/admin/leaves/:leaveId operates with status 200 (${leaveId})`);
    }

    console.log('\n================================================================');
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
