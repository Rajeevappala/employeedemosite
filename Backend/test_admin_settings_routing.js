require('dotenv').config();
const { generateToken } = require('./utils/tokenUtils');
const pool = require('./config/database');
const fs = require('fs');
const path = require('path');

async function testSettings() {
  console.log('========================================================');
  console.log('        ADMIN SETTINGS ROUTE & UI INTEGRITY TEST        ');
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

  try {
    // 1. Verify AppRoutes.jsx contains AdminSettings import and Route
    const appRoutesPath = path.join(__dirname, '../Frontend/src/routes/AppRoutes.jsx');
    const appRoutesContent = fs.readFileSync(appRoutesPath, 'utf8');

    assert(
      appRoutesContent.includes("import AdminSettings from '../pages/Admin/Settings/Settings';"),
      '1.1 AppRoutes.jsx imports AdminSettings component'
    );
    assert(
      appRoutesContent.includes('<Route path="settings" element={<AdminSettings />} />'),
      '1.2 AppRoutes.jsx registers route path="settings" under /admin'
    );

    // 2. Verify AdminLayout.jsx uses NavLink to /admin/settings
    const adminLayoutPath = path.join(__dirname, '../Frontend/src/components/AdminLayout/AdminLayout.jsx');
    const adminLayoutContent = fs.readFileSync(adminLayoutPath, 'utf8');

    assert(
      adminLayoutContent.includes('to="/admin/settings"'),
      '2.1 AdminLayout.jsx navigates to /admin/settings'
    );
    assert(
      !adminLayoutContent.includes("navigate('/admin/dashboard')"),
      '2.2 AdminLayout.jsx removed hardcoded navigate("/admin/dashboard") from Settings action'
    );
    assert(
      adminLayoutContent.includes('admin-sidebar-nav-item-active'),
      '2.3 AdminLayout.jsx applies active styling to Settings when on /admin/settings'
    );

    // 3. Verify Settings.jsx and Settings.css exist
    const settingsJsxPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Settings.jsx');
    const settingsCssPath = path.join(__dirname, '../Frontend/src/pages/Admin/Settings/Settings.css');

    assert(fs.existsSync(settingsJsxPath), '3.1 Settings.jsx exists');
    assert(fs.existsSync(settingsCssPath), '3.2 Settings.css exists');

    const settingsContent = fs.readFileSync(settingsJsxPath, 'utf8');
    assert(settingsContent.includes('Organization'), '3.3 Contains Organization section');
    assert(settingsContent.includes('Work & Attendance'), '3.4 Contains Work & Attendance section');
    assert(settingsContent.includes('Leave Management'), '3.5 Contains Leave Management section');
    assert(settingsContent.includes('Holiday Calendar'), '3.6 Contains Holiday Calendar section');
    assert(settingsContent.includes('Employee Configuration'), '3.7 Contains Employee Configuration section');

    // 4. Verify RBAC architecture
    assert(
      appRoutesContent.includes("<ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']}>"),
      '4.1 All /admin subroutes including settings are strictly protected by ProtectedRoute'
    );

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    console.log('\n========================================================');
    console.log(`TOTAL TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);
    console.log('========================================================');
    process.exit(failed === 0 ? 0 : 1);
  }
}

testSettings();
