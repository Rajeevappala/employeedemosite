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
  console.log('  ADMIN BRANDING & HEADER LAYOUT VERIFICATION SUITE             ');
  console.log('================================================================\n');

  // 1. Inspect AdminLayout.jsx
  console.log('--- 1. AdminLayout.jsx Branding & Placement Verification ---');
  const adminLayoutJsxPath = path.resolve(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.jsx');
  const adminLayoutJsx = fs.readFileSync(adminLayoutJsxPath, 'utf8');

  // Sidebar checks
  const sidebarRegex = /<aside[\s\S]*?className=\{`admin-sidebar[\s\S]*?<\/aside>/;
  const sidebarMatch = adminLayoutJsx.match(sidebarRegex);
  assert(sidebarMatch !== null, 'Sidebar <aside> element found in AdminLayout.jsx');

  if (sidebarMatch) {
    const sidebarContent = sidebarMatch[0];
    assert(!sidebarContent.includes('admin-brand-portal-tag'), 'Sidebar does NOT contain admin-brand-portal-tag');
    assert(!sidebarContent.includes('>Admin<'), 'Sidebar does NOT contain raw "Admin" badge text');
    assert(!sidebarContent.includes('>ADMIN<'), 'Sidebar does NOT contain raw "ADMIN" badge text');
    assert(!sidebarContent.includes('admin-navbar-logo-badge'), 'Sidebar does NOT contain logo badge');
    assert(!sidebarContent.includes('>Navigation<') && !sidebarContent.includes('Navigation</span>'), 'Sidebar does NOT contain visible "Navigation" title');
    assert(sidebarContent.includes('admin-sidebar-close-btn'), 'Sidebar preserves mobile close button');
  }

  // Header checks
  const navbarRegex = /<header className="admin-navbar">[\s\S]*?<\/header>/;
  const navbarMatch = adminLayoutJsx.match(navbarRegex);
  assert(navbarMatch !== null, '<header className="admin-navbar"> found in AdminLayout.jsx');

  if (navbarMatch) {
    const navbarContent = navbarMatch[0];
    assert(navbarContent.includes('admin-header-brand'), 'Navbar contains admin-header-brand container');
    assert(navbarContent.includes('admin-navbar-logo-badge'), 'Navbar contains admin-navbar-logo-badge');
    assert(navbarContent.includes('admin-navbar-logo-icon'), 'Navbar contains admin-navbar-logo-icon SVG');
    assert(navbarContent.includes('GaintPro HRM Portal'), 'Navbar brand text is "GaintPro HRM Portal"');
    assert(navbarContent.includes('>ADMIN<'), 'Navbar contains "ADMIN" tag in uppercase');
    assert(navbarContent.includes('admin-brand-portal-tag'), 'Navbar contains admin-brand-portal-tag badge');
    assert(navbarContent.includes('admin-navbar-right'), 'Navbar contains admin-navbar-right section');
    assert(!navbarContent.includes('admin-navbar-icon-btn'), 'Navbar does NOT contain notification button [Bell completely removed]');
    assert(!navbarContent.includes('admin-notification-badge-dot'), 'Navbar does NOT contain notification dot [Completely removed]');
    assert(navbarContent.includes('admin-navbar-user-profile'), 'Navbar contains user profile section [Admin Profile]');
  }

  // Layout hierarchy check: Full-width Header comes BEFORE admin-layout-body
  const headerIdx = adminLayoutJsx.indexOf('<header className="admin-navbar">');
  const bodyIdx = adminLayoutJsx.indexOf('<div className="admin-layout-body">');
  const asideIdx = adminLayoutJsx.indexOf('<aside');
  assert(headerIdx !== -1 && bodyIdx !== -1 && headerIdx < bodyIdx, 'Full-width header is rendered before admin-layout-body in DOM hierarchy');
  assert(bodyIdx < asideIdx, 'Sidebar <aside> is rendered inside admin-layout-body below header');

  // 2. Inspect AdminLayout.css
  console.log('\n--- 2. AdminLayout.css Positioning & Responsive Verification ---');
  const adminLayoutCssPath = path.resolve(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.css');
  const adminLayoutCss = fs.readFileSync(adminLayoutCssPath, 'utf8');

  assert(adminLayoutCss.includes('position: sticky') && adminLayoutCss.includes('top: 64px'), 'Admin sidebar is sticky below header at top: 64px');
  assert(adminLayoutCss.includes('width: 256px'), 'Admin sidebar desktop width is 256px');
  assert(adminLayoutCss.includes('.admin-navbar {') && adminLayoutCss.includes('width: 100%'), 'Admin navbar header spans full width (width: 100%)');

  // Ensure admin-header-brand styling
  assert(adminLayoutCss.includes('.admin-header-brand'), '.admin-header-brand is defined in CSS');

  // Ensure ADMIN tag is not hidden in media queries
  const smallScreenRegex = /@media\s*\(max-width:\s*639px\)[\s\S]*?\{([\s\S]*?)\n\}/;
  const smallScreenMatch = adminLayoutCss.match(smallScreenRegex);
  if (smallScreenMatch) {
    const cssBlock = smallScreenMatch[1];
    assert(!cssBlock.includes('.admin-brand-portal-tag {\n    display: none;\n  }'), 'ADMIN badge is NOT hidden in max-width: 639px media query');
    assert(cssBlock.includes('display: inline-block !important'), 'ADMIN badge is explicitly inline-block in max-width: 639px media query');
  }

  // 3. Employee Portal Integrity Check
  console.log('\n--- 3. Employee Portal Layout Integrity Verification ---');
  const empNavbarPath = path.resolve(__dirname, '../Frontend/src/components/Navbar/Navbar.jsx');
  const empSidebarPath = path.resolve(__dirname, '../Frontend/src/components/Sidebar/Sidebar.jsx');
  const empLayoutPath = path.resolve(__dirname, '../Frontend/src/pages/Employee/EmployeeLayout/EmployeeLayout.jsx');

  const empNavbar = fs.readFileSync(empNavbarPath, 'utf8');
  const empSidebar = fs.readFileSync(empSidebarPath, 'utf8');
  const empLayout = fs.readFileSync(empLayoutPath, 'utf8');

  assert(empNavbar.includes('GaintPro HRM Portal'), 'Employee portal navbar displays "GaintPro HRM Portal"');
  assert(empNavbar.includes('navbar-logo-badge'), 'Employee portal navbar preserves logo badge');
  assert(empSidebar.includes('portal-sidebar'), 'Employee portal sidebar preserves portal-sidebar');
  assert(empLayout.includes('employee-layout'), 'Employee portal layout preserves employee-layout');

  // 4. Backend Health Check & Admin Authenticated API
  console.log('\n--- 4. Backend Server Health & Admin Access Verification ---');
  const adminUser = (
    await pool.query("SELECT id, email, role FROM public.users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1")
  ).rows[0];
  assert(Boolean(adminUser), `Admin user found in database (${adminUser?.email})`);

  const adminToken = generateToken({
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
  });

  const meRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert(meRes.statusCode === 200, `GET /api/auth/me responded with HTTP ${meRes.statusCode}`);
  const meJson = meRes.json();
  assert(meJson && meJson.success === true, 'Auth check confirmed success = true');

  const empRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/employees?page=1&limit=1',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert(empRes.statusCode === 200, `GET /api/admin/employees responded with HTTP ${empRes.statusCode}`);

  console.log('\n================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  await pool.end();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
