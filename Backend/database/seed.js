const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/database');

/**
 * Validates database schema prerequisites before seeding.
 * Stops execution if the schema does not match expected structure.
 */
async function validateSchemaPrerequisites(client) {
  // 1. Confirm users table exists
  const usersTable = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'users';
  `);
  if (usersTable.rows.length === 0) {
    throw new Error("Schema validation error: 'users' table does not exist.");
  }

  // 2. Confirm employees table exists
  const employeesTable = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'employees';
  `);
  if (employeesTable.rows.length === 0) {
    throw new Error("Schema validation error: 'employees' table does not exist.");
  }

  // 3. Confirm employees.employee_id is the primary key
  const empPk = await client.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = 'employees' 
      AND tc.constraint_type = 'PRIMARY KEY';
  `);
  const pkColumn = empPk.rows[0]?.column_name;
  if (pkColumn !== 'employee_id') {
    throw new Error(
      `Schema validation error: employees primary key is '${pkColumn}', expected 'employee_id'.`
    );
  }

  // 4. Confirm employee-owned tables reference employees.employee_id
  const requiredFkTables = [
    'attendance',
    'documents',
    'leave_balances',
    'leave_requests',
    'payroll_profiles',
    'payroll_records',
    'pf_details',
  ];

  const fkCheck = await client.query(`
    SELECT DISTINCT tc.table_name AS src_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu 
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'employees'
      AND ccu.column_name = 'employee_id';
  `);

  const referencingTables = new Set(fkCheck.rows.map((r) => r.src_table));
  for (const table of requiredFkTables) {
    if (!referencingTables.has(table)) {
      throw new Error(
        `Schema validation error: '${table}' does not have a foreign key referencing employees(employee_id).`
      );
    }
  }

  console.log('Schema validation passed: All prerequisite tables and foreign keys are valid.');
}

/**
 * Main seeding function
 */
async function seedDatabase() {
  const client = await pool.connect();
  console.log('Database connected successfully.');

  try {
    console.log('Validating database schema...');
    await validateSchemaPrerequisites(client);

    console.log('\nStarting database seeding in a transaction...');
    await client.query('BEGIN');

    // -------------------------------------------------------------------------
    // 1. ADMIN USER
    // -------------------------------------------------------------------------
    const adminEmail = 'saiganeshm1921@gmail.com';
    const adminRole = 'ADMIN';
    const adminStatus = 'ACTIVE';

    let adminUserId;
    const adminCheck = await client.query(
      'SELECT id, email, role, status FROM users WHERE email = $1',
      [adminEmail]
    );

    if (adminCheck.rows.length === 0) {
      const insertAdmin = await client.query(
        `INSERT INTO users (email, role, status)
         VALUES ($1, $2, $3)
         RETURNING id, email, role, status`,
        [adminEmail, adminRole, adminStatus]
      );
      adminUserId = insertAdmin.rows[0].id;
      console.log(`[CREATED] Admin user: ${adminEmail} (Role: ${adminRole})`);
    } else {
      adminUserId = adminCheck.rows[0].id;
      console.log(`[EXISTS]  Admin user already exists: ${adminEmail}`);
    }

    // -------------------------------------------------------------------------
    // 2. EMPLOYEE USER
    // -------------------------------------------------------------------------
    const employeeEmail = 'rajeevappala055@gmail.com';
    const employeeRole = 'EMPLOYEE';
    const employeeStatus = 'ACTIVE';

    let employeeUserId;
    const employeeUserCheck = await client.query(
      'SELECT id, employee_id, email, role, status FROM users WHERE email = $1',
      [employeeEmail]
    );

    if (employeeUserCheck.rows.length === 0) {
      const insertEmployeeUser = await client.query(
        `INSERT INTO users (email, role, status)
         VALUES ($1, $2, $3)
         RETURNING id, employee_id, email, role, status`,
        [employeeEmail, employeeRole, employeeStatus]
      );
      employeeUserId = insertEmployeeUser.rows[0].id;
      console.log(`[CREATED] Employee user: ${employeeEmail} (Role: ${employeeRole})`);
    } else {
      employeeUserId = employeeUserCheck.rows[0].id;
      console.log(`[EXISTS]  Employee user already exists: ${employeeEmail}`);
    }

    // -------------------------------------------------------------------------
    // 3. EMPLOYEE RECORD (GP0001N)
    // -------------------------------------------------------------------------
    const employeeId = 'GP0001N';
    const firstName = 'Rajeev';
    const lastName = 'Appala';
    const designation = 'Python Developer';
    const department = 'Engineering';

    const employeeCheck = await client.query(
      `SELECT employee_id, user_id, first_name, last_name, email, designation, department, status
       FROM employees WHERE employee_id = $1`,
      [employeeId]
    );

    if (employeeCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO employees (
           employee_id, user_id, first_name, last_name, email,
           designation, department, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          employeeId,
          employeeUserId,
          firstName,
          lastName,
          employeeEmail,
          designation,
          department,
          employeeStatus,
        ]
      );
      console.log(`[CREATED] Employee record: ${employeeId} (${firstName} ${lastName})`);
    } else {
      console.log(`[EXISTS]  Employee record already exists: ${employeeId}`);
      // If user_id is not linked, link it safely
      if (!employeeCheck.rows[0].user_id) {
        await client.query(
          'UPDATE employees SET user_id = $1 WHERE employee_id = $2',
          [employeeUserId, employeeId]
        );
        console.log(`[UPDATED] Linked employee ${employeeId} to user ID.`);
      }
    }

    // -------------------------------------------------------------------------
    // 4. ASSOCIATE EMPLOYEE USER WITH EMPLOYEE_ID
    // -------------------------------------------------------------------------
    await client.query(
      `UPDATE users 
       SET employee_id = $1 
       WHERE id = $2 AND (employee_id IS NULL OR employee_id != $1)`,
      [employeeId, employeeUserId]
    );
    console.log(`[ASSOCIATED] User ${employeeEmail} associated with employee ${employeeId}.`);

    await client.query('COMMIT');
    console.log('Seeding transaction committed successfully.\n');

    // -------------------------------------------------------------------------
    // 5. POST-SEED VERIFICATION
    // -------------------------------------------------------------------------
    console.log('=== VERIFICATION: USERS TABLE ===');
    const usersVerification = await client.query(
      `SELECT id, employee_id, email, role, status
       FROM users
       WHERE email IN ($1, $2)
       ORDER BY role`,
      [adminEmail, employeeEmail]
    );
    console.table(usersVerification.rows);

    console.log('=== VERIFICATION: EMPLOYEES TABLE ===');
    const employeeVerification = await client.query(
      `SELECT employee_id, first_name, last_name, email, designation, department, status
       FROM employees
       WHERE employee_id = $1`,
      [employeeId]
    );
    console.table(employeeVerification.rows);

    console.log('Database seeding and verification completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const sanitizedMessage = error?.message
      ? error.message.replace(/:\/\/[^@]+@/, '://***:***@')
      : 'Unknown seeding error';
    console.error('Seeding failed:', sanitizedMessage);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase();
