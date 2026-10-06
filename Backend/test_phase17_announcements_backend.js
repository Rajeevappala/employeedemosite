const http = require('http');
const pool = require('./config/database');
const { generateToken } = require('./utils/tokenUtils');

const PORT = process.env.PORT || 5000;

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
  console.log('========================================================');
  console.log('   PHASE 17 ANNOUNCEMENTS & NOTIFICATIONS TEST SUITE');
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
    // Clean test announcements from previous test runs if any
    await pool.query("DELETE FROM public.announcements WHERE title LIKE 'TEST_PH17_%'");

    // Fetch users from DB
    const adminRes = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
    const empRes = await pool.query(
      "SELECT u.*, e.department, e.employee_id FROM users u JOIN employees e ON e.employee_id = u.employee_id WHERE u.email = 'rajeevappala055@gmail.com'"
    );

    if (adminRes.rows.length === 0 || empRes.rows.length === 0) {
      throw new Error('Required test users not found in DB');
    }

    const adminUser = adminRes.rows[0];
    const empUser = empRes.rows[0];

    const adminToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
      employeeId: null,
    });

    const superAdminToken = generateToken({
      userId: adminUser.id,
      email: 'superadmin@gaintpro.com',
      role: 'SUPER_ADMIN',
      employeeId: null,
    });

    const empToken = generateToken({
      userId: empUser.id,
      email: empUser.email,
      role: 'EMPLOYEE',
      employeeId: empUser.employee_id,
    });

    // ------------------------------------------------------------------
    // ADMIN ENDPOINTS
    // ------------------------------------------------------------------
    console.log('--- ADMIN TESTS ---');

    // 1. No token -> 401
    const r1 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'GET'
    });
    assert(r1.status === 401, '1. Admin announcements without token returns 401');

    // 2. Employee token -> 403
    const r2 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r2.status === 403, '2. Admin announcements with Employee token returns 403');

    // 3. Admin token -> 200
    const r3 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r3.status === 200, '3. Admin announcements with Admin token returns 200');

    // 4. Super Admin token -> 200
    const r4 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(r4.status === 200, '4. Admin announcements with Super Admin token returns 200');

    // 15. Invalid priority rejected
    const r15 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { title: 'TEST_PH17_InvPriority', content: 'test', priority: 'Critical' });
    assert(r15.status === 400, '15. Invalid priority rejected with 400');

    // 16. Invalid target rejected
    const r16 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { title: 'TEST_PH17_InvTarget', content: 'test', target_type: 'INVALID_TARGET' });
    assert(r16.status === 400, '16. Invalid target_type rejected with 400');

    // 17. Missing department rejected when DEPARTMENT
    const r17 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { title: 'TEST_PH17_NoDept', content: 'test', target_type: 'DEPARTMENT', target_department: '' });
    assert(r17.status === 400, '17. Missing department rejected with 400');

    // 18. Missing employee rejected when EMPLOYEE
    const r18 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { title: 'TEST_PH17_NoEmp', content: 'test', target_type: 'EMPLOYEE', target_employee_id: '' });
    assert(r18.status === 400, '18. Missing employee_id rejected with 400');

    // 19. Invalid employee rejected when non-existent
    const r19 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, { title: 'TEST_PH17_FakeEmp', content: 'test', target_type: 'EMPLOYEE', target_employee_id: 'NON_EXISTENT_ID' });
    assert(r19.status === 400, '19. Non-existent employee_id rejected with 400');

    // 5. Create announcement
    const r5 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_General Notice',
      content: 'This is a test general announcement for all employees.',
      priority: 'Normal',
      target_type: 'ALL',
      status: 'DRAFT',
    });
    assert(r5.status === 201, '5. Create announcement returns 201');
    const createdDraft = r5.body?.data;
    assert(createdDraft && createdDraft.id, '5. Created announcement has UUID id');

    // 6. Get announcements list
    const r6 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r6.status === 200 && Array.isArray(r6.body?.data?.announcements), '6. Get announcements returns list');

    // 7. Get announcement by ID
    const r7 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/admin/announcements/${createdDraft.id}`, method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r7.status === 200 && r7.body?.data?.title === 'TEST_PH17_General Notice', '7. Get announcement by ID returns correct record');

    // 8. Update announcement
    const r8 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/admin/announcements/${createdDraft.id}`, method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_General Notice Updated',
      priority: 'High',
    });
    assert(r8.status === 200 && r8.body?.data?.title === 'TEST_PH17_General Notice Updated' && r8.body?.data?.priority === 'High', '8. Update announcement succeeds');

    // 9. Publish announcement
    const r9 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/admin/announcements/${createdDraft.id}/publish`, method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r9.status === 200 && r9.body?.data?.status === 'PUBLISHED', '9. Publish announcement sets status to PUBLISHED');

    // 10. Archive announcement
    const r10 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/admin/announcements/${createdDraft.id}/archive`, method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r10.status === 200 && r10.body?.data?.status === 'ARCHIVED', '10. Archive announcement sets status to ARCHIVED');

    // 11. Delete announcement
    const r11 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/admin/announcements/${createdDraft.id}`, method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r11.status === 200, '11. Delete announcement returns 200');

    // 12. Search works
    // Create specific announcements to test search, filters & employee targeting
    const pubAllRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Office Annual Meet',
      content: 'Everyone is invited to the grand annual meet of GaintPro.',
      priority: 'Urgent',
      target_type: 'ALL',
      status: 'PUBLISHED',
    });
    const pubAllId = pubAllRes.body?.data?.id;

    const r12 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements?search=Annual%20Meet', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      r12.status === 200 && r12.body?.data?.announcements.some(a => a.id === pubAllId),
      '12. Search query matches title/content'
    );

    // 13. Filters work
    const r13 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements?status=PUBLISHED&priority=Urgent&target_type=ALL', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      r13.status === 200 && r13.body?.data?.announcements.every(a => a.status === 'PUBLISHED' && a.priority === 'Urgent' && a.target_type === 'ALL'),
      '13. Filters for status, priority, and target_type work accurately'
    );

    // 14. Pagination works
    const r14 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements?page=1&limit=2', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      r14.status === 200 && r14.body?.data?.pagination?.limit === 2 && r14.body?.data?.announcements.length <= 2,
      '14. Pagination limit and page structure working'
    );

    // ------------------------------------------------------------------
    // EMPLOYEE TARGETING & ACCESS TESTS
    // ------------------------------------------------------------------
    console.log('\n--- EMPLOYEE TESTS ---');

    // 20. No token -> 401
    const r20 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements', method: 'GET'
    });
    assert(r20.status === 401, '20. Employee announcements without token returns 401');

    // 21. Admin token -> 403
    const r21 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(r21.status === 403, '21. Employee announcements with Admin token returns 403');

    // 22. Employee token -> 200
    const r22 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r22.status === 200, '22. Employee announcements with Employee token returns 200');

    // 23. Employee receives ALL announcements
    assert(
      r22.body?.data?.announcements.some(a => a.id === pubAllId),
      '23. Employee receives announcement targeted to ALL'
    );

    // 24. Department targeted announcement
    // Emp department is 'Engineering'
    const pubDeptRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Engineering Sprint Review',
      content: 'Code freeze is Friday 5pm for Engineering.',
      priority: 'High',
      target_type: 'DEPARTMENT',
      target_department: 'Engineering',
      status: 'PUBLISHED',
    });
    const pubDeptId = pubDeptRes.body?.data?.id;

    // Another department announcement (e.g. 'Human Resources')
    const otherDeptRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_HR Policy Shift',
      content: 'HR only announcement.',
      priority: 'Normal',
      target_type: 'DEPARTMENT',
      target_department: 'Human Resources',
      status: 'PUBLISHED',
    });
    const otherDeptId = otherDeptRes.body?.data?.id;

    const r24 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    const empAnnounceIds = r24.body?.data?.announcements.map(a => a.id) || [];
    assert(
      empAnnounceIds.includes(pubDeptId) && !empAnnounceIds.includes(otherDeptId),
      '24. Employee receives their department announcements but not other departments'
    );

    // 25. Employee specific targeted announcement
    const pubSelfRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Personal Promotion Notice',
      content: 'Congratulations on your milestone!',
      priority: 'Urgent',
      target_type: 'EMPLOYEE',
      target_employee_id: empUser.employee_id,
      status: 'PUBLISHED',
    });
    const pubSelfId = pubSelfRes.body?.data?.id;

    // Create dummy employee for cross-targeting test if needed, or target another non-existent / dummy
    // Insert another dummy employee in DB temporarily
    await pool.query(`
      INSERT INTO public.employees (employee_id, first_name, last_name, email, department, status)
      VALUES ('GP_TEST99', 'Other', 'Emp', 'other.test99@gaintpro.com', 'Marketing', 'ACTIVE')
      ON CONFLICT (employee_id) DO NOTHING
    `);

    const otherEmpRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Other Employee Private Note',
      content: 'Private message for other employee.',
      priority: 'Normal',
      target_type: 'EMPLOYEE',
      target_employee_id: 'GP_TEST99',
      status: 'PUBLISHED',
    });
    const otherEmpId = otherEmpRes.body?.data?.id;

    const r25 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    const empIds2 = r25.body?.data?.announcements.map(a => a.id) || [];
    assert(
      empIds2.includes(pubSelfId) && !empIds2.includes(otherEmpId),
      '25. Employee receives announcements targeted to their employee_id, but not to others'
    );

    // 26. Draft announcements are hidden
    const draftRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Draft Secret',
      content: 'Draft not yet ready.',
      status: 'DRAFT',
      target_type: 'ALL',
    });
    const draftId = draftRes.body?.data?.id;
    assert(!empIds2.includes(draftId), '26. Draft announcements are hidden from employees');

    // 27. Archived announcements are hidden
    const archiveRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Old Archived Info',
      content: 'Archived content.',
      status: 'ARCHIVED',
      target_type: 'ALL',
    });
    const archiveId = archiveRes.body?.data?.id;
    assert(!empIds2.includes(archiveId), '27. Archived announcements are hidden from employees');

    // 28. Future announcements (publish_at > now) are hidden
    const futureDate = new Date(Date.now() + 86400000 * 5).toISOString(); // 5 days in future
    const futureRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Future Release',
      content: 'Will be published next week.',
      status: 'PUBLISHED',
      publish_at: futureDate,
      target_type: 'ALL',
    });
    const futureId = futureRes.body?.data?.id;
    assert(!empIds2.includes(futureId), '28. Future announcements (publish_at > now) are hidden');

    // 29. Expired announcements (expires_at < now) are hidden
    const pastPublish = new Date(Date.now() - 86400000 * 10).toISOString(); // 10 days ago
    const pastExpiry = new Date(Date.now() - 86400000 * 2).toISOString(); // 2 days ago
    const expiredRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements', method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    }, {
      title: 'TEST_PH17_Expired Coupon',
      content: 'Expired discount coupon.',
      status: 'PUBLISHED',
      publish_at: pastPublish,
      expires_at: pastExpiry,
      target_type: 'ALL',
    });
    const expiredId = expiredRes.body?.data?.id;
    assert(!empIds2.includes(expiredId), '29. Expired announcements (expires_at < now) are hidden');

    // 30. Employee can open authorized announcement
    const r30 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${pubSelfId}`, method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r30.status === 200 && r30.body?.data?.id === pubSelfId, '30. Employee can open authorized announcement (200)');

    // 31. Employee cannot open another employee's targeted announcement (404)
    const r31 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${otherEmpId}`, method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r31.status === 404, '31. Employee opening another employee targeted announcement receives 404');

    // Also check employee opening draft or future announcement receives 404
    const r31b = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${draftId}`, method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r31b.status === 404, '31b. Employee opening draft announcement receives 404');

    // 32. Mark as read works
    const r32 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${pubSelfId}/read`, method: 'PATCH',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r32.status === 200 && r32.body?.read === true, '32. Mark as read returns 200 with read: true');

    const checkDetail = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${pubSelfId}`, method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(checkDetail.body?.data?.is_read === true, '32b. Announcement now has is_read = true');

    // 33. Duplicate mark-read does not create duplicate row or fail
    const r33 = await doRequest({
      hostname: 'localhost', port: PORT, path: `/api/employee/announcements/${pubSelfId}/read`, method: 'PATCH',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r33.status === 200 && r33.body?.read === true, '33. Duplicate mark as read call succeeds idempotently');

    const countReadRows = await pool.query(
      'SELECT COUNT(*) AS total FROM public.announcement_reads WHERE announcement_id = $1 AND employee_id = $2',
      [pubSelfId, empUser.employee_id]
    );
    assert(parseInt(countReadRows.rows[0]?.total, 10) === 1, '33b. Exactly one read record exists in DB');

    // 34. Unread count matches database
    const unreadRes = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements/unread-count', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(unreadRes.status === 200 && typeof unreadRes.body?.data?.unread_count === 'number', '34. Unread count endpoint returns number');

    // 35. unread_only filter works
    const r35 = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/employee/announcements?unread_only=true', method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    assert(r35.status === 200, '35. unread_only filter returns 200');
    const unreadList = r35.body?.data?.announcements || [];
    assert(unreadList.every(a => a.is_read === false), '35b. All items in unread_only list have is_read === false');
    assert(!unreadList.some(a => a.id === pubSelfId), '35c. Read announcement pubSelfId is excluded from unread list');

    // ------------------------------------------------------------------
    // SECURITY TESTS
    // ------------------------------------------------------------------
    console.log('\n--- SECURITY TESTS ---');

    const empRespStr = JSON.stringify(r25.body);
    const adminRespStr = JSON.stringify(r6.body);

    // 36. No password fields
    assert(!empRespStr.includes('password') && !adminRespStr.includes('password'), '36. No password fields leaked');

    // 37. No OTP
    assert(!empRespStr.includes('otp') && !adminRespStr.includes('otp'), '37. No OTP tokens leaked');

    // 38. No JWT
    assert(!empRespStr.includes('jwt') && !adminRespStr.includes('jwt'), '38. No JWT tokens leaked');

    // 39. No storage_key
    assert(!empRespStr.includes('storage_key') && !adminRespStr.includes('storage_key'), '39. No storage_key leaked');

    // 40. No filesystem path
    assert(!empRespStr.includes('C:\\') && !empRespStr.includes('/var/') && !empRespStr.includes('/storage/'), '40. No filesystem path leaked');

    // 41. No SQL error leakage
    const badReq = await doRequest({
      hostname: 'localhost', port: PORT, path: '/api/admin/announcements?page=INVALID_PAGE', method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const badReqStr = JSON.stringify(badReq.body);
    assert(!badReqStr.includes('syntax error') && !badReqStr.includes('pg_') && !badReqStr.includes('SELECT'), '41. No SQL error leakage');

    // 42. No cross-employee leakage
    assert(!empRespStr.includes('GP_TEST99'), '42. No cross-employee announcement or identifier leakage');

    // Cleanup test data
    await pool.query("DELETE FROM public.announcements WHERE title LIKE 'TEST_PH17_%'");
    await pool.query("DELETE FROM public.employees WHERE employee_id = 'GP_TEST99'");

    console.log('\n========================================================');
    console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('========================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
