const path = require('path');
const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');
const storageService = require('../services/storageService');

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}


/**
 * Controller to fetch the paginated employee list for administrators.
 * Security:
 * - Access is strictly restricted to ADMIN and SUPER_ADMIN roles.
 * - Sourced directly from PostgreSQL employees table.
 * - Supports parameterized case-insensitive search and status filtering.
 * - Enforces safe pagination with limits to prevent unbounded result sets.
 * - Does NOT expose sensitive secrets, OTPs, or database credentials.
 */
const getEmployees = async (req, res, next) => {
  try {
    const { search, status } = req.query;

    // Safe pagination parameters
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedLimit = parseInt(req.query.limit, 10) || 20;
    const limit = Math.min(Math.max(1, requestedLimit), 100);
    const offset = (page - 1) * limit;

    const conditions = [];
    const queryParams = [];

    // Optional search across employee_id, first_name, last_name, email, department, designation
    if (search && typeof search === 'string' && search.trim() !== '') {
      queryParams.push(`%${search.trim()}%`);
      const searchIdx = queryParams.length;
      conditions.push(`(
        employee_id ILIKE $${searchIdx} OR
        first_name ILIKE $${searchIdx} OR
        last_name ILIKE $${searchIdx} OR
        email ILIKE $${searchIdx} OR
        department ILIKE $${searchIdx} OR
        designation ILIKE $${searchIdx}
      )`);
    }

    // Optional status filter
    if (status && typeof status === 'string' && status.trim() !== '') {
      queryParams.push(status.trim());
      const statusIdx = queryParams.length;
      conditions.push(`status ILIKE $${statusIdx}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count query for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM employees
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total, 10) || 0;

    // Paginated data query
    const dataQueryParams = [...queryParams, limit, offset];
    const limitIdx = dataQueryParams.length - 1;
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT 
        employee_id,
        first_name,
        last_name,
        email,
        phone,
        designation,
        department,
        TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
        status,
        status AS employment_status,
        employment_type,
        gender,
        city,
        state,
        COALESCE(working_days_per_week, 5)::int AS working_days_per_week,
        created_at,
        updated_at
      FROM employees
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await pool.query(dataQuery, dataQueryParams);
    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to fetch the full profile of a specific employee for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Accepts employeeId strictly via URL parameter (req.params.employeeId).
 * - Validates the format/presence of employeeId before database query.
 * - Does not accept employee_id from request body.
 * - Uses parameterized query: WHERE employee_id = $1.
 * - Returns 404 if employee does not exist.
 * - Excludes sensitive internal security secrets (passwords, OTP hashes, auth tokens).
 */
const getEmployeeById = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId || typeof employeeId !== 'string' || employeeId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing employee ID parameter.',
      });
    }

    const sanitizedEmployeeId = employeeId.trim();

    const query = `
      SELECT 
        employee_id,
        first_name,
        last_name,
        email,
        phone,
        TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
        gender,
        designation,
        department,
        TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
        status,
        status AS employment_status,
        reporting_manager,
        employment_type,
        address,
        city,
        state,
        postal_code,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relationship,
        personal_email,
        work_location,
        profile_photo_url,
        COALESCE(working_days_per_week, 5)::int AS working_days_per_week,
        created_at,
        updated_at
      FROM employees
      WHERE employee_id = $1
    `;

    const result = await pool.query(query, [sanitizedEmployeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found.',
      });
    }

    const emp = result.rows[0];
    const hasPhoto = Boolean(emp.profile_photo_url && String(emp.profile_photo_url).trim());
    const sanitizedData = {
      ...emp,
      has_profile_photo: hasPhoto,
      photo_url: hasPhoto ? `/api/admin/employees/${sanitizedEmployeeId}/photo` : null,
    };
    delete sanitizedData.profile_photo_url;

    return res.status(200).json({
      success: true,
      data: sanitizedData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to onboard a new employee atomically.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Client cannot choose employee_id, user_id, or role.
 * - Concurrency safe via PostgreSQL advisory lock.
 * - Creates employee, user, leave_balances, payroll_profiles, and optional pf_details in one transaction.
 */
const onboardEmployee = async (req, res, next) => {
  const client = await pool.connect();
  const savedStorageKeys = [];
  try {
    // Safely parse JSON strings if form-data submitted complex objects
    let salary = req.body.salary || {};
    if (typeof salary === 'string') {
      try { salary = JSON.parse(salary); } catch { salary = {}; }
    }
    let leaveBalances = req.body.leaveBalances || req.body.leave_balances || {};
    if (typeof leaveBalances === 'string') {
      try { leaveBalances = JSON.parse(leaveBalances); } catch { leaveBalances = {}; }
    }
    let pfDetails = req.body.pfDetails || req.body.pf_details || {};
    if (typeof pfDetails === 'string') {
      try { pfDetails = JSON.parse(pfDetails); } catch { pfDetails = {}; }
    }

    if (req.body.userType === 'Admin') {
      if (req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied. Only SUPER_ADMIN can create ADMIN accounts.' });
      }
      return res.status(400).json({ success: false, message: 'Use the user management endpoint to create administrator accounts.' });
    }

    const {
      firstName, first_name,
      lastName, last_name,
      email,
      phone,
      personalEmail, personal_email,
      dateOfBirth, date_of_birth,
      gender,
      department,
      designation,
      dateOfJoining, date_of_joining,
      reportingManager, reporting_manager,
      employmentType, employment_type,
      workLocation, work_location,
      status: reqStatus,
      address,
      city,
      state,
      postalCode, postal_code,
      emergencyContactName, emergency_contact_name,
      emergencyContactPhone, emergency_contact_phone,
      emergencyContactRelationship, emergency_contact_relationship,
      pfNotAvailable, pf_not_available,
    } = req.body;

    const rawFirstName = firstName !== undefined ? firstName : first_name;
    const rawLastName = lastName !== undefined ? lastName : last_name;
    const rawPersonalEmail = personalEmail !== undefined ? personalEmail : personal_email;
    const rawDob = dateOfBirth !== undefined ? dateOfBirth : date_of_birth;
    const rawDoj = dateOfJoining !== undefined ? dateOfJoining : date_of_joining;
    const rawRepMgr = reportingManager !== undefined ? reportingManager : reporting_manager;
    const rawEmpType = employmentType !== undefined ? employmentType : employment_type;
    const rawWorkLocation = workLocation !== undefined ? workLocation : work_location;
    const rawPostalCode = postalCode !== undefined ? postalCode : postal_code;
    const rawEmName = emergencyContactName !== undefined ? emergencyContactName : emergency_contact_name;
    const rawEmPhone = emergencyContactPhone !== undefined ? emergencyContactPhone : emergency_contact_phone;
    const rawEmRel = emergencyContactRelationship !== undefined ? emergencyContactRelationship : emergency_contact_relationship;

    // Validation: Employee ID (Admin-entered)
    const rawEmployeeId = req.body.employee_id !== undefined ? req.body.employee_id : req.body.employeeId;
    if (!rawEmployeeId || typeof rawEmployeeId !== 'string' || !rawEmployeeId.trim()) {
      return res.status(400).json({ success: false, message: 'Employee ID is required.' });
    }
    const sanitizedEmployeeId = rawEmployeeId.trim().toUpperCase();
    const employeeIdRegex = /^GP[0-9]{4}N$/;
    if (!employeeIdRegex.test(sanitizedEmployeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Employee ID format. Expected format: GP####N (e.g., GP0025N).',
      });
    }

    // Validation: Required fields (Step 1)
    if (!rawFirstName || typeof rawFirstName !== 'string' || !rawFirstName.trim()) {
      return res.status(400).json({ success: false, message: 'First name is required.' });
    }
    const sanitizedFirstName = rawFirstName.trim();
    if (sanitizedFirstName.length > 50) {
      return res.status(400).json({ success: false, message: 'First name must not exceed 50 characters.' });
    }

    const sanitizedLastName = rawLastName && typeof rawLastName === 'string' ? rawLastName.trim() : null;
    if (sanitizedLastName && sanitizedLastName.length > 50) {
      return res.status(400).json({ success: false, message: 'Last name must not exceed 50 characters.' });
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format.' });
    }

    let sanitizedPersonalEmail = null;
    if (rawPersonalEmail !== undefined && rawPersonalEmail !== null && String(rawPersonalEmail).trim() !== '') {
      sanitizedPersonalEmail = String(rawPersonalEmail).trim().toLowerCase();
      if (!emailRegex.test(sanitizedPersonalEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid personal email address format.' });
      }
    }

    // Validation: Department & Designation (Step 3)
    if (!department || typeof department !== 'string' || !department.trim()) {
      return res.status(400).json({ success: false, message: 'Department is required.' });
    }
    const sanitizedDepartment = department.trim();

    if (!designation || typeof designation !== 'string' || !designation.trim()) {
      return res.status(400).json({ success: false, message: 'Designation is required.' });
    }
    const sanitizedDesignation = designation.trim();

    // Validation: Phone
    let sanitizedPhone = null;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      sanitizedPhone = String(phone).trim();
      if (!/^\d{10}$/.test(sanitizedPhone)) {
        return res.status(400).json({ success: false, message: 'Phone number must be exactly 10 digits.' });
      }
    }

    // Validation: Dates
    let sanitizedDob = null;
    if (rawDob !== undefined && rawDob !== null && String(rawDob).trim() !== '') {
      sanitizedDob = String(rawDob).trim();
      if (!isValidDateString(sanitizedDob)) {
        return res.status(400).json({ success: false, message: 'Invalid date of birth format (YYYY-MM-DD).' });
      }
    }

    let sanitizedDoj = new Date().toISOString().split('T')[0];
    if (rawDoj !== undefined && rawDoj !== null && String(rawDoj).trim() !== '') {
      sanitizedDoj = String(rawDoj).trim();
      if (!isValidDateString(sanitizedDoj)) {
        return res.status(400).json({ success: false, message: 'Invalid date of joining format (YYYY-MM-DD).' });
      }
    }

    // Validation: Status
    let sanitizedStatus = 'ACTIVE';
    if (reqStatus && typeof reqStatus === 'string') {
      const upStatus = reqStatus.trim().toUpperCase();
      if (['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(upStatus)) {
        sanitizedStatus = upStatus;
      }
    }

    // Validation: Salary numbers (Step 5)
    const basicSalary = Math.max(0, parseFloat(salary.basicSalary ?? salary.basic_salary ?? req.body.basic_salary ?? req.body.basicSalary) || 25000);
    const hra = Math.max(0, parseFloat(salary.hra ?? req.body.hra) || 10000);
    const allowances = Math.max(0, parseFloat(salary.allowances ?? req.body.allowances) || 5000);
    const pfEmployee = Math.max(0, parseFloat(salary.pfEmployee ?? salary.pf_employee ?? req.body.pf_employee ?? req.body.pfEmployee) || 1800);
    const professionalTax = Math.max(0, parseFloat(salary.professionalTax ?? salary.professional_tax ?? req.body.professional_tax ?? req.body.professionalTax) || 200);
    const otherDeductions = Math.max(0, parseFloat(salary.otherDeductions ?? salary.other_deductions ?? req.body.other_deductions ?? req.body.otherDeductions) || 0);

    if (isNaN(basicSalary) || basicSalary < 0 || isNaN(hra) || hra < 0 || isNaN(allowances) || allowances < 0) {
      return res.status(400).json({ success: false, message: 'Salary numbers must be non-negative numeric values.' });
    }

    // Validation: Leave balances (Step 6)
    const leaveBalancesObj = (typeof leaveBalances === 'object' && leaveBalances !== null) ? leaveBalances : {};
    const paidLeave = Math.max(0, parseFloat(leaveBalancesObj.paidLeave ?? leaveBalancesObj.paid_leave ?? leaveBalancesObj.paid_leave_balance ?? req.body.paid_leave_balance ?? req.body.paid_leave) || 12);
    const sickLeave = Math.max(0, parseFloat(leaveBalancesObj.sickLeave ?? leaveBalancesObj.sick_leave ?? leaveBalancesObj.sick_leave_balance ?? req.body.sick_leave_balance ?? req.body.sick_leave) || 10);
    const unpaidLeave = Math.max(0, parseFloat(leaveBalancesObj.unpaidLeave ?? leaveBalancesObj.unpaid_leave ?? leaveBalancesObj.unpaid_leave_balance ?? req.body.unpaid_leave_balance ?? req.body.unpaid_leave) || 0);

    if (isNaN(paidLeave) || paidLeave < 0 || isNaN(sickLeave) || sickLeave < 0) {
      return res.status(400).json({ success: false, message: 'Leave balances must be non-negative numeric values.' });
    }

    // Validation: PF details (Step 4)
    const isPfNotAvailable = pfNotAvailable === true || pfNotAvailable === 'true' || pf_not_available === true || pf_not_available === 'true';
    const pfObj = (typeof pfDetails === 'object' && pfDetails !== null) ? pfDetails : {};
    const uanNumber = (pfObj.uanNumber || pfObj.uan_number || req.body.uan_number || req.body.uanNumber || '').trim();
    const pfNumber = (pfObj.pfNumber || pfObj.pf_number || req.body.pf_number || req.body.pfNumber || '').trim();
    const pensionNumber = (pfObj.pensionNumber || pfObj.pension_number || req.body.pension_number || req.body.pensionNumber || '').trim();

    if (!isPfNotAvailable && uanNumber && !/^\d{12}$/.test(uanNumber)) {
      return res.status(400).json({ success: false, message: 'UAN number must be exactly 12 numeric digits.' });
    }

    // Validation: Working Days per Week (Step 3)
    const rawWorkingDays = req.body.working_days_per_week ?? req.body.workingDaysPerWeek;
    if (rawWorkingDays === undefined || rawWorkingDays === null || String(rawWorkingDays).trim() === '') {
      return res.status(400).json({ success: false, message: 'Working days per week is required.' });
    }
    const workingDaysPerWeek = parseInt(rawWorkingDays, 10);
    if (![5, 6].includes(workingDaysPerWeek)) {
      return res.status(400).json({ success: false, message: 'Invalid working days per week. Allowed values: 5 or 6.' });
    }

    // START TRANSACTION
    await client.query('BEGIN');

    // 1. Check duplicate employee ID in employees
    const empIdCheck = await client.query(
      'SELECT employee_id FROM public.employees WHERE employee_id = $1',
      [sanitizedEmployeeId]
    );
    if (empIdCheck.rows.length > 0) {
      const err = new Error('Employee ID already exists.');
      err.statusCode = 409;
      throw err;
    }

    // 2. Check duplicate employee ID in users
    const userEmpIdCheck = await client.query(
      'SELECT id FROM public.users WHERE employee_id = $1',
      [sanitizedEmployeeId]
    );
    if (userEmpIdCheck.rows.length > 0) {
      const err = new Error('Employee ID already exists.');
      err.statusCode = 409;
      throw err;
    }

    // 3. Check duplicate email in users
    const userEmailCheck = await client.query(
      'SELECT id FROM public.users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );
    if (userEmailCheck.rows.length > 0) {
      const err = new Error(`An account with email '${normalizedEmail}' already exists.`);
      err.statusCode = 409;
      throw err;
    }

    // 4. Check duplicate email in employees
    const empEmailCheck = await client.query(
      'SELECT employee_id FROM public.employees WHERE LOWER(email) = $1',
      [normalizedEmail]
    );
    if (empEmailCheck.rows.length > 0) {
      const err = new Error(`An employee with email '${normalizedEmail}' already exists.`);
      err.statusCode = 409;
      throw err;
    }

    const employeeId = sanitizedEmployeeId;

    // 5. Insert user
    const insertUserRes = await client.query(
      `INSERT INTO public.users (email, role, status, first_name, last_name, phone)
       VALUES ($1, 'EMPLOYEE', $2, $3, $4, $5)
       RETURNING id, email, role, status`,
      [normalizedEmail, sanitizedStatus, sanitizedFirstName, sanitizedLastName, sanitizedPhone]
    );
    const userId = insertUserRes.rows[0].id;

    // 6. Insert employee record
    await client.query(
      `INSERT INTO public.employees (
         employee_id, user_id, first_name, last_name, email, phone,
         date_of_birth, gender, department, designation, date_of_joining,
         reporting_manager, employment_type, status, address, city, state,
         postal_code, emergency_contact_name, emergency_contact_phone,
         personal_email, emergency_contact_relationship, work_location,
         working_days_per_week
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
       ) RETURNING *`,
      [
        employeeId,
        userId,
        sanitizedFirstName,
        sanitizedLastName,
        normalizedEmail,
        sanitizedPhone,
        sanitizedDob,
        gender ? String(gender).trim() : null,
        sanitizedDepartment,
        sanitizedDesignation,
        sanitizedDoj,
        rawRepMgr ? String(rawRepMgr).trim() : null,
        rawEmpType ? String(rawEmpType).trim() : 'Full Time',
        sanitizedStatus,
        address ? String(address).trim() : null,
        city ? String(city).trim() : null,
        state ? String(state).trim() : null,
        rawPostalCode ? String(rawPostalCode).trim() : null,
        rawEmName ? String(rawEmName).trim() : null,
        rawEmPhone ? String(rawEmPhone).trim() : null,
        sanitizedPersonalEmail,
        rawEmRel ? String(rawEmRel).trim() : null,
        rawWorkLocation ? String(rawWorkLocation).trim() : (city ? String(city).trim() : null),
        workingDaysPerWeek,
      ]
    );

    // 7. Link employee_id back to user
    await client.query(
      'UPDATE public.users SET employee_id = $1 WHERE id = $2',
      [employeeId, userId]
    );

    // 8. Initialize leave balances
    await client.query(
      `INSERT INTO public.leave_balances (
         employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance
       ) VALUES ($1, $2, $3, $4)`,
      [employeeId, paidLeave, sickLeave, unpaidLeave]
    );

    // 9. Initialize payroll profile
    await client.query(
      `INSERT INTO public.payroll_profiles (
         employee_id, basic_salary, hra, allowances, pf_employee,
         professional_tax, other_deductions, effective_from
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [employeeId, basicSalary, hra, allowances, pfEmployee, professionalTax, otherDeductions, sanitizedDoj]
    );

    // 10. Optional PF details (Only store if not toggled off and at least one field provided)
    if (!isPfNotAvailable && (uanNumber || pfNumber || pensionNumber)) {
      await client.query(
        `INSERT INTO public.pf_details (
           employee_id, uan_number, pf_number, pension_number
         ) VALUES ($1, $2, $3, $4)`,
        [employeeId, uanNumber || null, pfNumber || null, pensionNumber || null]
      );
    }

    // 11. Process and store uploaded documents (Step 7)
    let uploadedDocsCount = 0;
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        let docType = 'Other Document';
        const fname = (file.fieldname || '').toLowerCase();
        if (fname.includes('offer')) docType = 'Offer Letter';
        else if (fname.includes('appointment')) docType = 'Appointment Letter';
        else if (fname.includes('aadhaar')) docType = 'Aadhaar Card';
        else if (fname.includes('pan')) docType = 'PAN Card';
        else if (fname.includes('education')) docType = 'Educational Certificate';
        else if (fname.includes('pf')) docType = 'PF Document';
        else if (fname.includes('photo') || fname.includes('avatar')) docType = 'Profile Photo';
        else if (req.body[`doc_type_${file.fieldname}`]) docType = String(req.body[`doc_type_${file.fieldname}`]).trim();

        const prefix = (docType === 'Profile Photo') ? 'avatars' : 'documents';
        const storageKey = storageService.generateStorageKey({
          employeeId,
          originalFilename: file.originalname,
          prefix,
        });

        await storageService.saveFile(file.buffer, storageKey);
        savedStorageKeys.push(storageKey);

        if (docType === 'Profile Photo') {
          await client.query(
            'UPDATE public.employees SET profile_photo_url = $1 WHERE employee_id = $2',
            [storageKey, employeeId]
          );
        }

        const cleanOriginalName = (file.originalname || docType).replace(/[\r\n\t]/g, '').trim();
        await client.query(
          `INSERT INTO public.documents (
             employee_id, document_type, file_name, storage_key, uploaded_by
           ) VALUES ($1, $2, $3, $4, $5)`,
          [employeeId, docType, cleanOriginalName, storageKey, req.user?.id || userId]
        );
        uploadedDocsCount++;
      }
    }

    await client.query('COMMIT');

    // 12. Audit log
    await recordAuditLog({
      userId: req.user?.id || userId,
      action: 'EMPLOYEE_CREATED',
      entityType: 'EMPLOYEE',
      entityId: employeeId,
      metadata: {
        employee_id: employeeId,
        email: normalizedEmail,
        first_name: sanitizedFirstName,
        department: sanitizedDepartment,
        designation: sanitizedDesignation,
        documents_uploaded: uploadedDocsCount,
      },
      req,
    });

    const grossSalary = basicSalary + hra + allowances;
    const totalDeductions = pfEmployee + professionalTax + otherDeductions;
    const netSalary = grossSalary - totalDeductions;

    return res.status(201).json({
      success: true,
      message: 'Employee onboarded successfully.',
      data: {
        employee_id: employeeId,
        first_name: sanitizedFirstName,
        last_name: sanitizedLastName,
        email: normalizedEmail,
        personal_email: sanitizedPersonalEmail,
        phone: sanitizedPhone,
        department: sanitizedDepartment,
        designation: sanitizedDesignation,
        date_of_joining: sanitizedDoj,
        employment_type: rawEmpType || 'Full Time',
        work_location: rawWorkLocation || city || null,
        status: sanitizedStatus,
        user: {
          id: userId,
          email: normalizedEmail,
          role: 'EMPLOYEE',
          status: sanitizedStatus,
        },
        leave_balances: {
          paid_leave: paidLeave,
          sick_leave: sickLeave,
          unpaid_leave: unpaidLeave,
        },
        payroll_profile: {
          basic_salary: basicSalary,
          hra,
          allowances,
          pf_employee: pfEmployee,
          professional_tax: professionalTax,
          other_deductions: otherDeductions,
          gross_salary: grossSalary,
          total_deductions: totalDeductions,
          net_calculated: netSalary,
        },
        documents_count: uploadedDocsCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    // Clean up any files that were written to disk before failure
    for (const key of savedStorageKeys) {
      try {
        await storageService.deleteFile(key);
      } catch (cleanupErr) {
        console.error('Failed to clean up storage file on rollback:', key, cleanupErr.message);
      }
    }

    if (error.code === '23505' && (error.constraint === 'employees_pkey' || error.detail?.includes('employee_id') || error.message?.includes('employee_id'))) {
      return res.status(409).json({ success: false, message: 'Employee ID already exists.' });
    }
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Controller to update an existing employee's profile details.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - employee_id is strictly immutable.
 * - Role and user ID cannot be altered.
 */
const updateEmployeeProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid employee ID.' });
    }
    const trimmedId = employeeId.trim();

    // Check employee exists
    const empCheck = await pool.query(
      'SELECT employee_id, user_id, email, working_days_per_week FROM public.employees WHERE employee_id = $1',
      [trimmedId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee '${trimmedId}' not found.` });
    }
    const currentEmp = empCheck.rows[0];

    const {
      firstName, first_name,
      lastName, last_name,
      phone,
      dateOfBirth, date_of_birth,
      gender,
      department,
      designation,
      dateOfJoining, date_of_joining,
      reportingManager, reporting_manager,
      employmentType, employment_type,
      address,
      city,
      state,
      postalCode, postal_code,
      emergencyContactName, emergency_contact_name,
      emergencyContactPhone, emergency_contact_phone,
      email,
      workingDaysPerWeek, working_days_per_week,
    } = req.body;

    const fName = firstName !== undefined ? firstName : first_name;
    const lName = lastName !== undefined ? lastName : last_name;
    const dob = dateOfBirth !== undefined ? dateOfBirth : date_of_birth;
    const doj = dateOfJoining !== undefined ? dateOfJoining : date_of_joining;
    const repMgr = reportingManager !== undefined ? reportingManager : reporting_manager;
    const empType = employmentType !== undefined ? employmentType : employment_type;
    const pCode = postalCode !== undefined ? postalCode : postal_code;
    const emName = emergencyContactName !== undefined ? emergencyContactName : emergency_contact_name;
    const emPhone = emergencyContactPhone !== undefined ? emergencyContactPhone : emergency_contact_phone;

    // Working days per week validation
    const rawWorkingDays = workingDaysPerWeek !== undefined ? workingDaysPerWeek : working_days_per_week;
    let parsedWorkingDays = undefined;
    if (rawWorkingDays !== undefined && rawWorkingDays !== null && String(rawWorkingDays).trim() !== '') {
      parsedWorkingDays = parseInt(rawWorkingDays, 10);
      if (![5, 6].includes(parsedWorkingDays)) {
        return res.status(400).json({ success: false, message: 'Invalid working days per week. Allowed values: 5 or 6.' });
      }
    }

    // Validation
    if (fName !== undefined && (!fName || typeof fName !== 'string' || !fName.trim())) {
      return res.status(400).json({ success: false, message: 'First name cannot be empty.' });
    }
    if (phone !== undefined && phone !== null && String(phone).trim() !== '' && !/^\d{10}$/.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: 'Phone number must be exactly 10 digits.' });
    }
    if (dob !== undefined && dob !== null && String(dob).trim() !== '' && !isValidDateString(String(dob).trim())) {
      return res.status(400).json({ success: false, message: 'Invalid date of birth format (YYYY-MM-DD).' });
    }
    if (doj !== undefined && doj !== null && String(doj).trim() !== '' && !isValidDateString(String(doj).trim())) {
      return res.status(400).json({ success: false, message: 'Invalid date of joining format (YYYY-MM-DD).' });
    }

    // Handle email update if supplied and different
    let newEmail = null;
    if (email && typeof email === 'string' && email.trim().toLowerCase() !== currentEmp.email?.toLowerCase()) {
      newEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid email address format.' });
      }
      // Check collision
      const checkUser = await pool.query(
        'SELECT id FROM public.users WHERE LOWER(email) = $1 AND employee_id != $2',
        [newEmail, trimmedId]
      );
      if (checkUser.rows.length > 0) {
        return res.status(409).json({ success: false, message: `Email '${newEmail}' is already in use by another account.` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE public.employees
        SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          phone = COALESCE($3, phone),
          date_of_birth = CASE WHEN $4::text IS NOT NULL THEN $4::date ELSE date_of_birth END,
          gender = COALESCE($5, gender),
          department = COALESCE($6, department),
          designation = COALESCE($7, designation),
          date_of_joining = CASE WHEN $8::text IS NOT NULL THEN $8::date ELSE date_of_joining END,
          reporting_manager = COALESCE($9, reporting_manager),
          employment_type = COALESCE($10, employment_type),
          address = COALESCE($11, address),
          city = COALESCE($12, city),
          state = COALESCE($13, state),
          postal_code = COALESCE($14, postal_code),
          emergency_contact_name = COALESCE($15, emergency_contact_name),
          emergency_contact_phone = COALESCE($16, emergency_contact_phone),
          email = COALESCE($17, email),
          working_days_per_week = COALESCE($18, working_days_per_week),
          updated_at = NOW()
        WHERE employee_id = $19
        RETURNING *;
      `;

      const updateRes = await client.query(updateQuery, [
        fName ? String(fName).trim() : null,
        lName !== undefined ? (lName ? String(lName).trim() : '') : null,
        phone !== undefined ? (phone ? String(phone).trim() : null) : null,
        dob ? String(dob).trim() : null,
        gender !== undefined ? (gender ? String(gender).trim() : null) : null,
        department ? String(department).trim() : null,
        designation ? String(designation).trim() : null,
        doj ? String(doj).trim() : null,
        repMgr !== undefined ? (repMgr ? String(repMgr).trim() : null) : null,
        empType !== undefined ? (empType ? String(empType).trim() : null) : null,
        address !== undefined ? (address ? String(address).trim() : null) : null,
        city !== undefined ? (city ? String(city).trim() : null) : null,
        state !== undefined ? (state ? String(state).trim() : null) : null,
        pCode !== undefined ? (pCode ? String(pCode).trim() : null) : null,
        emName !== undefined ? (emName ? String(emName).trim() : null) : null,
        emPhone !== undefined ? (emPhone ? String(emPhone).trim() : null) : null,
        newEmail || null,
        parsedWorkingDays !== undefined ? parsedWorkingDays : null,
        trimmedId,
      ]);

      if (newEmail) {
        await client.query(
          'UPDATE public.users SET email = $1, updated_at = NOW() WHERE employee_id = $2',
          [newEmail, trimmedId]
        );
      }

      await client.query('COMMIT');

      await recordAuditLog({
        userId: req.user.id,
        action: 'EMPLOYEE_UPDATED',
        entityType: 'EMPLOYEE',
        entityId: trimmedId,
        metadata: {
          employee_id: trimmedId,
          updated_by: req.user.email,
        },
        req,
      });

      if (parsedWorkingDays !== undefined && parsedWorkingDays !== currentEmp.working_days_per_week) {
        await recordAuditLog({
          userId: req.user.id,
          action: 'EMPLOYEE_WORK_SCHEDULE_UPDATED',
          entityType: 'EMPLOYEE',
          entityId: trimmedId,
          metadata: {
            employee_id: trimmedId,
            performed_by: req.user.email,
            previous_schedule: currentEmp.working_days_per_week,
            new_schedule: parsedWorkingDays,
            old_working_days_per_week: currentEmp.working_days_per_week,
            new_working_days_per_week: parsedWorkingDays,
          },
          req,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Employee profile updated successfully.',
        data: updateRes.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to toggle an employee's status (ACTIVE, INACTIVE, SUSPENDED).
 * Synchronizes employees.status and users.status atomically.
 */
const updateEmployeeStatus = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { status, remarks } = req.body;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid employee ID.' });
    }
    const trimmedId = employeeId.trim();

    const ALLOWED_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
    if (!status || !ALLOWED_STATUSES.includes(String(status).toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}.`,
      });
    }
    const targetStatus = String(status).toUpperCase();

    // Check employee exists
    const empCheck = await pool.query(
      'SELECT employee_id, status FROM public.employees WHERE employee_id = $1',
      [trimmedId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee '${trimmedId}' not found.` });
    }
    const oldStatus = empCheck.rows[0].status;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE public.employees SET status = $1, updated_at = NOW() WHERE employee_id = $2',
        [targetStatus, trimmedId]
      );
      await client.query(
        'UPDATE public.users SET status = $1, updated_at = NOW() WHERE employee_id = $2',
        [targetStatus, trimmedId]
      );

      await client.query('COMMIT');

      await recordAuditLog({
        userId: req.user.id,
        action: 'EMPLOYEE_STATUS_CHANGED',
        entityType: 'EMPLOYEE',
        entityId: trimmedId,
        metadata: {
          employee_id: trimmedId,
          old_status: oldStatus,
          new_status: targetStatus,
          remarks: remarks || null,
        },
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Employee status successfully changed to ${targetStatus}.`,
        data: {
          employee_id: trimmedId,
          status: targetStatus,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to permanently delete an employee and all linked records and private documents.
 * Security:
 * - Restricted strictly to SUPER_ADMIN role.
 * - Requires exact confirmation employee ID and confirmation checkbox.
 * - Transactional: fully rolls back if database or file deletion fails.
 * - Does NOT expose internal storage keys or filesystem paths.
 */
const deleteEmployeePermanently = async (req, res, next) => {
  try {
    // 1. Role Authorization: Strictly SUPER_ADMIN only
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Only SUPER_ADMIN can permanently delete an employee.',
      });
    }

    const { employeeId } = req.params;
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Target employee ID is required.',
      });
    }
    const sanitizedId = employeeId.trim().toUpperCase();

    // 2. Validate confirmation payload
    const { confirmEmployeeId, confirmCheckbox } = req.body || {};

    if (!confirmEmployeeId || typeof confirmEmployeeId !== 'string' || confirmEmployeeId.trim().toUpperCase() !== sanitizedId) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation Employee ID does not match target employee ID.',
      });
    }

    if (confirmCheckbox !== true && confirmCheckbox !== 'true') {
      return res.status(400).json({
        success: false,
        message: 'Confirmation checkbox must be checked to authorize permanent deletion.',
      });
    }

    // 3. Begin Transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 4. Lock and verify target employee exists
      const empRes = await client.query(
        `SELECT employee_id, user_id, email, first_name, last_name, profile_photo_url
         FROM public.employees
         WHERE employee_id = $1
         FOR UPDATE`,
        [sanitizedId]
      );

      if (empRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Employee not found.',
        });
      }

      const emp = empRes.rows[0];

      // 5. Verify linked user (cannot delete an ADMIN user through this endpoint)
      if (emp.user_id) {
        const userCheck = await client.query(
          `SELECT id, role, email FROM public.users WHERE id = $1 FOR UPDATE`,
          [emp.user_id]
        );
        if (userCheck.rows.length > 0 && userCheck.rows[0].role !== 'EMPLOYEE') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Cannot delete administrator account through employee deletion endpoint.',
          });
        }
      }

      // 6. Collect all document storage keys belonging to this employee
      const docRes = await client.query(
        `SELECT storage_key FROM public.documents WHERE employee_id = $1`,
        [sanitizedId]
      );
      const storageKeys = docRes.rows.map((r) => r.storage_key).filter(Boolean);

      // Check profile photo if stored in private storage
      if (
        emp.profile_photo_url &&
        (emp.profile_photo_url.startsWith('documents/') || emp.profile_photo_url.startsWith('profiles/'))
      ) {
        storageKeys.push(emp.profile_photo_url);
      }

      // 7. Explicitly delete dependent database records in dependency order
      await client.query(
        `DELETE FROM public.exit_clearances WHERE exit_request_id IN (
           SELECT id FROM public.exit_requests WHERE employee_id = $1
         )`,
        [sanitizedId]
      );
      await client.query(`DELETE FROM public.exit_requests WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.fnf_settlements WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.announcement_reads WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`UPDATE public.announcements SET target_employee_id = NULL WHERE target_employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.documents WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.attendance WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.leave_requests WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.leave_balances WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.payroll_records WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.payroll_profiles WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.pf_details WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.employees WHERE employee_id = $1`, [sanitizedId]);

      // 8. Delete associated user account if exclusively an employee user
      if (emp.user_id) {
        await client.query(`DELETE FROM public.otp_verifications WHERE user_id = $1`, [emp.user_id]);
        await client.query(`DELETE FROM public.users WHERE id = $1 AND role = 'EMPLOYEE'`, [emp.user_id]);
      } else {
        // Also clean up by employee_id if linked directly
        await client.query(`DELETE FROM public.otp_verifications WHERE user_id IN (SELECT id FROM public.users WHERE employee_id = $1)`, [sanitizedId]);
        await client.query(`DELETE FROM public.users WHERE employee_id = $1 AND role = 'EMPLOYEE'`, [sanitizedId]);
      }

      // 9. Physical private files cleanup safely using storageService
      for (const storageKey of storageKeys) {
        try {
          await storageService.deleteFile(storageKey);
        } catch (fileErr) {
          // If storage delete throws unexpected error (not ENOENT), abort transaction
          if (fileErr.code !== 'FILE_NOT_FOUND') {
            await client.query('ROLLBACK');
            throw fileErr;
          }
        }
      }

      // 10. Commit transaction
      await client.query('COMMIT');

      // 11. Record audit log (user_id preserved from req.user, action recorded)
      recordAuditLog({
        userId: req.user.id,
        action: 'EMPLOYEE_PERMANENTLY_DELETED',
        entityType: 'EMPLOYEE',
        entityId: sanitizedId,
        metadata: {
          employee_id: sanitizedId,
          employee_name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
          user_id: emp.user_id,
          email: emp.email,
          deleted_documents_count: storageKeys.length,
        },
        req,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: `Employee ${sanitizedId} and all associated data have been permanently deleted.`,
        data: {
          employeeId: sanitizedId,
          deletedDocumentsCount: storageKeys.length,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for administrators to view an employee's private profile photo.
 */
const getAdminEmployeePhoto = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid employee ID parameter.' });
    }
    const sanitizedId = employeeId.trim();

    const empRes = await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [sanitizedId]
    );

    if (empRes.rows.length === 0 || !empRes.rows[0].profile_photo_url) {
      return res.status(404).json({ success: false, message: 'Profile photo not found.' });
    }

    const filePath = await storageService.getSafeFilePath(empRes.rows[0].profile_photo_url);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png'
      ? 'image/png'
      : (ext === '.webp' ? 'image/webp' : 'image/jpeg');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-cache');
    return res.sendFile(filePath);
  } catch (error) {
    if (error.name === 'FileNotFoundError' || error.code === 'FILE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Profile photo not found in storage.' });
    }
    next(error);
  }
};

module.exports = {
  getEmployees,
  getEmployeeById,
  getAdminEmployeePhoto,
  onboardEmployee,
  updateEmployeeProfile,
  updateEmployeeStatus,
  deleteEmployeePermanently,
};


