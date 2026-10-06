require('dotenv').config();
const pool = require('../config/database');

async function seed() {
  const admin = await pool.query("SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1");
  if (admin.rows.length === 0) {
    console.error('No admin user found');
    return;
  }
  const adminId = admin.rows[0].id;

  await pool.query(`
    INSERT INTO announcements (title, content, priority, target_type, target_department, status, publish_at, created_by)
    VALUES 
      (
        'Q3 All Hands Meeting Scheduled',
        'The Q3 all-hands company meeting is scheduled for next Friday at 3:00 PM IST. All team members are requested to attend.',
        'High',
        'ALL',
        NULL,
        'PUBLISHED',
        NOW(),
        $1
      ),
      (
        'Engineering Technical Architecture Review',
        'The Engineering team will be reviewing the microservice migration guidelines this Wednesday. Please review the documentation beforehand.',
        'Normal',
        'DEPARTMENT',
        'Engineering',
        'PUBLISHED',
        NOW(),
        $1
      ),
      (
        'Quarterly Performance Bonus & Payroll Update',
        'Payroll and incentive disbursements for the previous month have been processed successfully. Please review your payslips under the Payslips section.',
        'Urgent',
        'ALL',
        NULL,
        'PUBLISHED',
        NOW(),
        $1
      )
  `, [adminId]);

  console.log('✅ Seeded 3 real announcements successfully');
  await pool.end();
}

seed().catch(err => {
  console.error(err);
  pool.end();
});
