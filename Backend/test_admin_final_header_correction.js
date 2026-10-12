/**
 * GAINTPRO SOFTWARE TECHNOLOGIES — AUTOMATED VERIFICATION SUITE
 * FINAL ADMIN HEADER + SIDEBAR UI CORRECTION
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config();
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

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
  console.log('  FINAL ADMIN HEADER + SIDEBAR CORRECTION VERIFICATION SUITE    ');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 1. ADMINLAYOUT.JSX STRUCTURAL VERIFICATION
    // -------------------------------------------------------------------------
    console.log('--- 1. AdminLayout.jsx Structural DOM Hierarchy ---');
    const adminJsxPath = path.resolve(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.jsx');
    const adminJsx = fs.readFileSync(adminJsxPath, 'utf8');

    // 1.1 Header is full-width, direct child of admin-layout, placed BEFORE admin-layout-body
    const headerPos = adminJsx.indexOf('<header className="admin-navbar">');
    const bodyPos = adminJsx.indexOf('<div className="admin-layout-body">');
    const sidebarPos = adminJsx.indexOf('<aside');
    const mainPos = adminJsx.indexOf('<main className="admin-main-content">');

    assert(headerPos !== -1, 'admin-navbar <header> exists in AdminLayout.jsx');
    assert(bodyPos !== -1, 'admin-layout-body <div> exists in AdminLayout.jsx');
    assert(sidebarPos !== -1, 'admin-sidebar <aside> exists in AdminLayout.jsx');
    assert(mainPos !== -1, 'admin-main-content <main> exists in AdminLayout.jsx');

    assert(headerPos < bodyPos, 'Header is rendered BEFORE admin-layout-body (full-width top bar)');
    assert(bodyPos < sidebarPos, 'admin-layout-body wraps the sidebar');
    assert(sidebarPos < mainPos, 'admin-sidebar is placed before admin-main-content inside layout body');

    // 1.2 "admin-right-pane" is completely removed (no vertical split container)
    assert(!adminJsx.includes('admin-right-pane'), 'admin-right-pane is completely removed from AdminLayout.jsx');

    // 1.3 "Navigation" heading is completely removed
    assert(!adminJsx.includes('Navigation</span>'), 'Visible "Navigation" span is removed');
    assert(!adminJsx.includes('admin-sidebar-header-title'), 'admin-sidebar-header-title is removed');
    assert(!adminJsx.includes('admin-sidebar-brand-header'), 'admin-sidebar-brand-header is removed');

    // 1.4 Notification UI is completely removed from Admin header
    assert(!adminJsx.includes('admin-notification-badge-dot'), 'Notification badge dot is removed');
    assert(!adminJsx.includes('admin-navbar-icon-btn'), 'Notification icon button is removed from Admin header');
    assert(!adminJsx.includes('Announcements & Notifications'), 'Announcements notification tooltip/label is removed from Admin header');

    // 1.5 Header branding: Logo + GaintPro HRM Portal + ADMIN badge
    assert(adminJsx.includes('admin-header-brand'), 'admin-header-brand container is present');
    assert(adminJsx.includes('admin-navbar-logo-badge'), 'admin-navbar-logo-badge is present');
    assert(adminJsx.includes('GaintPro HRM Portal'), 'GaintPro HRM Portal brand text is present');
    assert(adminJsx.includes('>ADMIN<'), 'ADMIN badge tag is present');

    // 1.6 Admin Profile: Admin / Administrator with avatar icon
    assert(adminJsx.includes('admin-navbar-user-profile'), 'admin-navbar-user-profile is present');
    assert(adminJsx.includes('admin-navbar-avatar'), 'admin-navbar-avatar is present');
    assert(adminJsx.includes('>Admin</span>'), 'Admin display name is present');
    assert(adminJsx.includes('>Administrator</span>'), 'Administrator role is present');

    // -------------------------------------------------------------------------
    // 2. ADMINLAYOUT.CSS LAYOUT & POSITIONING VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. AdminLayout.css Layout & Positioning ---');
    const adminCssPath = path.resolve(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.css');
    const adminCss = fs.readFileSync(adminCssPath, 'utf8');

    // 2.1 admin-layout is flex column
    assert(
      adminCss.includes('.admin-layout {') &&
      adminCss.includes('display: flex;') &&
      adminCss.includes('flex-direction: column;') &&
      adminCss.includes('width: 100%;'),
      'admin-layout is a full-width column flex container matching EmployeeLayout'
    );

    // 2.2 admin-navbar is sticky top 0, width 100%
    assert(
      adminCss.includes('.admin-navbar {') &&
      adminCss.includes('position: sticky;') &&
      adminCss.includes('top: 0;') &&
      adminCss.includes('height: 64px;') &&
      adminCss.includes('width: 100%;'),
      'admin-navbar spans full browser width (width: 100%, height: 64px, position: sticky, top: 0)'
    );

    // 2.3 admin-layout-body is flex row below header
    assert(
      adminCss.includes('.admin-layout-body {') &&
      adminCss.includes('display: flex;') &&
      adminCss.includes('min-height: calc(100vh - 64px);'),
      'admin-layout-body is a flex container occupying remaining viewport height calc(100vh - 64px)'
    );

    // 2.4 Desktop admin-sidebar begins below header
    assert(
      adminCss.includes('position: sticky;') &&
      adminCss.includes('top: 64px;') &&
      adminCss.includes('width: 256px;') &&
      adminCss.includes('height: calc(100vh - 64px);'),
      'admin-sidebar on desktop starts BELOW header at top: 64px with height: calc(100vh - 64px)'
    );

    // 2.5 admin-sidebar does NOT have top: 0 on desktop
    assert(!adminCss.includes('.admin-sidebar {\n  position: fixed;\n  top: 0;'), 'Desktop sidebar does NOT use top: 0 (does not cover header)');

    // 2.6 admin-main-content flex: 1, scrolls independently
    assert(
      adminCss.includes('.admin-main-content {') &&
      adminCss.includes('flex: 1;') &&
      adminCss.includes('min-width: 0;') &&
      adminCss.includes('overflow-y: auto;'),
      'admin-main-content has flex: 1, min-width: 0, and independent overflow-y: auto'
    );

    // 2.7 Mobile drawer (< 1024px) preserves off-canvas slide-out
    assert(
      adminCss.includes('@media (max-width: 1023px)') &&
      adminCss.includes('.admin-sidebar-open {') &&
      adminCss.includes('transform: translateX(0);'),
      'Mobile drawer (< 1024px) preserves slide-out drawer behavior'
    );

    // -------------------------------------------------------------------------
    // 3. EMPLOYEE PORTAL INTEGRITY VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Employee Portal Layout & Notification Integrity ---');
    const empNavbarPath = path.resolve(__dirname, '../Frontend/src/components/Navbar/Navbar.jsx');
    const empSidebarPath = path.resolve(__dirname, '../Frontend/src/components/Sidebar/Sidebar.jsx');
    const empLayoutPath = path.resolve(__dirname, '../Frontend/src/pages/Employee/EmployeeLayout/EmployeeLayout.jsx');

    const empNavbar = fs.readFileSync(empNavbarPath, 'utf8');
    const empSidebar = fs.readFileSync(empSidebarPath, 'utf8');
    const empLayout = fs.readFileSync(empLayoutPath, 'utf8');

    // 3.1 Employee notifications remain intact
    assert(empNavbar.includes('notification-badge-dot'), 'Employee portal preserves notification dot');
    assert(empNavbar.includes('notification-badge-count'), 'Employee portal preserves notification count badge');
    assert(empNavbar.includes('getUnreadAnnouncementsCount'), 'Employee portal preserves unread count fetching');
    assert(empNavbar.includes('portal-navbar'), 'Employee portal navbar remains intact');
    assert(empSidebar.includes('portal-sidebar'), 'Employee portal sidebar remains intact');
    assert(empLayout.includes('employee-layout'), 'Employee portal layout remains intact');

    // -------------------------------------------------------------------------
    // 4. BACKEND INTEGRATION & HEALTH CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Backend Admin Endpoints Accessibility ---');
    const adminUser = (
      await pool.query("SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1")
    ).rows[0];
    assert(Boolean(adminUser), `Admin user found in database (${adminUser?.email})`);

    const adminToken = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const routesToTest = [
      '/api/admin/dashboard',
      '/api/admin/employees',
      '/api/admin/leaves',
      '/api/admin/payroll',
      '/api/admin/documents',
      '/api/admin/pf',
    ];

    for (const route of routesToTest) {
      const res = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: route,
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert(res.statusCode === 200, `GET ${route} returned HTTP 200 OK`);
    }

    console.log('\n================================================================');
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test suite execution error:', err);
    await pool.end();
    process.exit(1);
  }
}

runTests();
