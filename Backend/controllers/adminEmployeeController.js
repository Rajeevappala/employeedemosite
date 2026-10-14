const path = require('path');
const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');
const storageService = require('../services/storageService');
const {
  encryptAccountNumber,
  maskAccountNumber,
  isValidIFSC,
  isValidAccountNumber,
} = require('../services/bankEncryptionService');

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

const ALLOWED_DESIGNATIONS = ['Associate Software Engineer', 'Associate'];

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
      ORDER BY 
        COALESCE(NULLIF(SUBSTRING(employee_id FROM '([0-9]+)'), '')::INTEGER, 999999) ASC,
        employee_id ASC
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

    // Fetch related records in parallel for complete profile management
    const [payrollRes, leavesRes, pfRes, docsRes, bankRes] = await Promise.all([
      pool.query(
        `SELECT basic_salary, hra, allowances, pf_employee, professional_tax, other_deductions,
                TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from
         FROM public.payroll_profiles WHERE employee_id = $1`,
        [sanitizedEmployeeId]
      ),
      pool.query(
        `SELECT paid_leave_balance, sick_leave_balance, unpaid_leave_balance
         FROM public.leave_balances WHERE employee_id = $1`,
        [sanitizedEmployeeId]
      ),
      pool.query(
        `SELECT uan_number, pf_number, pension_number, employee_contribution, employer_contribution
         FROM public.pf_details WHERE employee_id = $1`,
        [sanitizedEmployeeId]
      ),
      pool.query(
        `SELECT id, document_type, file_name, month, year, created_at, storage_key
         FROM public.documents WHERE employee_id = $1 ORDER BY created_at DESC`,
        [sanitizedEmployeeId]
      ),
      pool.query(
        `SELECT id, account_holder_name, bank_name, account_number_last4, ifsc_code,
                branch_name, branch_city, branch_state, account_type, verification_status,
                admin_remarks, created_at, updated_at
         FROM public.employee_bank_details WHERE employee_id = $1`,
        [sanitizedEmployeeId]
      ),
    ]);

    const bankRow = bankRes.rows[0] || null;
    const sanitizedBankDetails = bankRow ? {
      ...bankRow,
      account_number: maskAccountNumber(bankRow.account_number_last4),
    } : null;

    // Check physical file existence in private storage for genuine availability status
    const documentsWithAvailability = await Promise.all(
      (docsRes.rows || []).map(async (doc) => {
        let isAvailable = false;
        try {
          isAvailable = Boolean(doc.storage_key && (await storageService.fileExists(doc.storage_key)));
        } catch (_) {
          isAvailable = false;
        }
        return {
          id: doc.id,
          employee_id: sanitizedEmployeeId,
          document_type: doc.document_type,
          file_name: doc.file_name,
          month: doc.month,
          year: doc.year,
          created_at: doc.created_at,
          is_file_available: isAvailable,
          file_available: isAvailable,
          status: isAvailable ? 'Available' : 'Unavailable',
        };
      })
    );

    const sanitizedData = {
      ...emp,
      has_profile_photo: hasPhoto,
      photo_url: hasPhoto ? `/api/admin/employees/${sanitizedEmployeeId}/photo` : null,
      payroll_profile: payrollRes.rows[0] || null,
      payroll_profiles: payrollRes.rows[0] || null,
      payroll: payrollRes.rows[0] || null,
      leave_balances: leavesRes.rows[0] || null,
      pf_details: pfRes.rows[0] || null,
      pf: pfRes.rows[0] || null,
      documents: documentsWithAvailability,
      bank_details: sanitizedBankDetails,
      bank: sanitizedBankDetails,
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
    let bankDetails = req.body.bankDetails || req.body.bank_details || {};
    if (typeof bankDetails === 'string') {
      try { bankDetails = JSON.parse(bankDetails); } catch { bankDetails = {}; }
    }

    if (req.body.userType === 'Admin') {
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

    // Enforce active department validation (IT / Non-IT)
    const activeDeptRes = await pool.query(
      'SELECT id, name FROM public.organization_departments WHERE is_active = true AND LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [sanitizedDepartment]
    );
    if (activeDeptRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Department '${sanitizedDepartment}' is not an active department. Supported active departments: IT, Non-IT.`,
      });
    }

    if (!designation || typeof designation !== 'string' || !designation.trim()) {
      return res.status(400).json({ success: false, message: 'Designation is required.' });
    }
    const sanitizedDesignation = designation.trim();
    if (!ALLOWED_DESIGNATIONS.includes(sanitizedDesignation)) {
      return res.status(400).json({
        success: false,
        message: `Invalid designation '${sanitizedDesignation}'. Allowed designations: Associate Software Engineer, Associate.`,
      });
    }

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

    const rawEmpContrib = pfObj.employeeContribution ?? pfObj.employee_contribution ?? req.body.employee_contribution ?? req.body.employeeContribution;
    let employeeContribution = null;
    if (rawEmpContrib !== undefined && rawEmpContrib !== null && String(rawEmpContrib).trim() !== '' && String(rawEmpContrib).trim() !== '—') {
      const parsed = parseFloat(rawEmpContrib);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'Employee contribution must be a non-negative number.' });
      }
      employeeContribution = Math.round(parsed * 100) / 100;
    }

    const rawEmprContrib = pfObj.employerContribution ?? pfObj.employer_contribution ?? req.body.employer_contribution ?? req.body.employerContribution;
    let employerContribution = null;
    if (rawEmprContrib !== undefined && rawEmprContrib !== null && String(rawEmprContrib).trim() !== '' && String(rawEmprContrib).trim() !== '—') {
      const parsed = parseFloat(rawEmprContrib);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'Employer contribution must be a non-negative number.' });
      }
      employerContribution = Math.round(parsed * 100) / 100;
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

    // Validation: Bank Details (Step 5)
    const bankNotAvailable = req.body.bankNotAvailable === true || req.body.bankNotAvailable === 'true' ||
      req.body.bank_not_available === true || req.body.bank_not_available === 'true' ||
      bankDetails.bankNotAvailable === true || bankDetails.bankNotAvailable === 'true' ||
      bankDetails.bank_not_available === true || bankDetails.bank_not_available === 'true';

    const rawBankHolder = (bankDetails.account_holder_name || bankDetails.accountHolderName || req.body.bank_account_holder_name || req.body.bankAccountHolderName || '').toString().trim();
    const rawBankName = (bankDetails.bank_name || bankDetails.bankName || req.body.bank_name || req.body.bankName || '').toString().trim();
    const rawBankAccNum = (bankDetails.account_number || bankDetails.accountNumber || req.body.bank_account_number || req.body.bankAccountNumber || '').toString().trim();
    const rawBankConfirmAccNum = (bankDetails.confirm_account_number || bankDetails.confirmAccountNumber || req.body.bank_confirm_account_number || req.body.bankConfirmAccountNumber || '').toString().trim();
    const rawBankIfsc = (bankDetails.ifsc_code || bankDetails.ifscCode || req.body.bank_ifsc_code || req.body.bankIfscCode || '').toString().trim().toUpperCase();
    const rawBankBranch = (bankDetails.branch_name || bankDetails.branchName || req.body.bank_branch_name || req.body.bankBranchName || '').toString().trim();
    const rawBankCity = (bankDetails.branch_city || bankDetails.branchCity || req.body.bank_branch_city || req.body.bankBranchCity || '').toString().trim();
    const rawBankState = (bankDetails.branch_state || bankDetails.branchState || req.body.bank_branch_state || req.body.bankBranchState || '').toString().trim();
    const rawBankAccType = (bankDetails.account_type || bankDetails.accountType || req.body.bank_account_type || req.body.bankAccountType || '').toString().trim();

    const hasBankDetails = !bankNotAvailable && Boolean(rawBankHolder || rawBankAccNum || rawBankIfsc || rawBankBranch || rawBankCity || rawBankState);

    if (hasBankDetails) {
      if (!rawBankHolder) {
        return res.status(400).json({ success: false, message: 'Account holder name is required.' });
      }
      if (!rawBankAccNum) {
        return res.status(400).json({ success: false, message: 'Account number is required.' });
      }
      if (!isValidAccountNumber(rawBankAccNum)) {
        return res.status(400).json({ success: false, message: 'Invalid account number. Account number must contain 9 to 18 digits.' });
      }
      if (!rawBankConfirmAccNum) {
        return res.status(400).json({ success: false, message: 'Please confirm the account number.' });
      }
      if (rawBankConfirmAccNum !== rawBankAccNum) {
        return res.status(400).json({ success: false, message: 'Account numbers do not match. Please verify and re-enter.' });
      }
      if (!rawBankIfsc) {
        return res.status(400).json({ success: false, message: 'IFSC code is required.' });
      }
      if (!isValidIFSC(rawBankIfsc)) {
        return res.status(400).json({ success: false, message: 'Invalid IFSC code format (e.g., IDFB0001234).' });
      }
      if (rawBankAccType && !['Savings', 'Current', 'Salary'].includes(rawBankAccType)) {
        return res.status(400).json({ success: false, message: 'Invalid account type. Allowed: Savings, Current, Salary.' });
      }
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
    if (!isPfNotAvailable && (uanNumber || pfNumber || pensionNumber || employeeContribution !== null || employerContribution !== null)) {
      await client.query(
        `INSERT INTO public.pf_details (
           employee_id, uan_number, pf_number, pension_number, employee_contribution, employer_contribution
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [employeeId, uanNumber || null, pfNumber || null, pensionNumber || null, employeeContribution, employerContribution]
      );
    }

    // 10B. Optional Bank details (Atomically saved within same onboarding transaction)
    let savedBankDetails = null;
    if (hasBankDetails) {
      const encryptedAcc = encryptAccountNumber(rawBankAccNum);
      const last4 = rawBankAccNum.slice(-4);
      const bName = rawBankName || 'IDFC Bank';
      const bType = rawBankAccType || 'Savings';

      await client.query(
        `INSERT INTO public.employee_bank_details (
           employee_id, account_holder_name, bank_name,
           account_number_encrypted, account_number_last4,
           ifsc_code, branch_name, branch_city, branch_state,
           account_type, verification_status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending', $11)`,
        [
          employeeId,
          rawBankHolder,
          bName,
          encryptedAcc,
          last4,
          rawBankIfsc,
          rawBankBranch || null,
          rawBankCity || null,
          rawBankState || null,
          bType,
          req.user?.id || userId,
        ]
      );

      savedBankDetails = {
        account_holder_name: rawBankHolder,
        bank_name: bName,
        account_number: maskAccountNumber(last4),
        account_number_last4: last4,
        ifsc_code: rawBankIfsc,
        branch_name: rawBankBranch || null,
        branch_city: rawBankCity || null,
        branch_state: rawBankState || null,
        account_type: bType,
        verification_status: 'Pending',
      };
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

    if (hasBankDetails && savedBankDetails) {
      await recordAuditLog({
        userId: req.user?.id || userId,
        action: 'EMPLOYEE_BANK_DETAILS_CREATED',
        entityType: 'BANK_DETAILS',
        entityId: employeeId,
        metadata: {
          employee_id: employeeId,
          bank_name: savedBankDetails.bank_name,
          account_holder_name: savedBankDetails.account_holder_name,
          account_number_last4: savedBankDetails.account_number_last4,
          ifsc_code: savedBankDetails.ifsc_code,
          account_type: savedBankDetails.account_type,
        },
        req,
      });
    }

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
        bank_details: savedBankDetails,
        bank: savedBankDetails,
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
  const savedStorageKeys = [];
  try {
    const { employeeId } = req.params;
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid employee ID.' });
    }
    const trimmedId = employeeId.trim();

    // Check employee exists
    const empCheck = await pool.query(
      'SELECT employee_id, user_id, email, department, working_days_per_week, status, profile_photo_url FROM public.employees WHERE employee_id = $1',
      [trimmedId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee '${trimmedId}' not found.` });
    }
    const currentEmp = empCheck.rows[0];

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
      emergencyContactRelationship, emergency_contact_relationship,
      personalEmail, personal_email,
      workLocation, work_location,
      status,
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
    const emRel = emergencyContactRelationship !== undefined ? emergencyContactRelationship : emergency_contact_relationship;
    const persEmail = personalEmail !== undefined ? personalEmail : personal_email;
    const wLoc = workLocation !== undefined ? workLocation : work_location;

    // Working days per week validation
    const rawWorkingDays = workingDaysPerWeek !== undefined ? workingDaysPerWeek : working_days_per_week;
    let parsedWorkingDays = undefined;
    if (rawWorkingDays !== undefined && rawWorkingDays !== null && String(rawWorkingDays).trim() !== '') {
      parsedWorkingDays = parseInt(rawWorkingDays, 10);
      if (![5, 6].includes(parsedWorkingDays)) {
        return res.status(400).json({ success: false, message: 'Invalid working days per week. Allowed values: 5 or 6.' });
      }
    }

    // Status validation
    let targetStatus = undefined;
    if (status !== undefined && status !== null && String(status).trim() !== '') {
      targetStatus = String(status).trim().toUpperCase();
      if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(targetStatus)) {
        return res.status(400).json({ success: false, message: 'Invalid employee status. Allowed values: ACTIVE, INACTIVE, SUSPENDED.' });
      }
    }

    // Validation
    if (fName !== undefined && (!fName || typeof fName !== 'string' || !fName.trim())) {
      return res.status(400).json({ success: false, message: 'First name cannot be empty.' });
    }
    if (phone !== undefined && phone !== null && String(phone).trim() !== '' && !/^\d{10}$/.test(String(phone).trim().replace(/\D/g, ''))) {
      return res.status(400).json({ success: false, message: 'Phone number must be exactly 10 digits.' });
    }
    if (dob !== undefined && dob !== null && String(dob).trim() !== '' && !isValidDateString(String(dob).trim())) {
      return res.status(400).json({ success: false, message: 'Invalid date of birth format (YYYY-MM-DD).' });
    }
    if (doj !== undefined && doj !== null && String(doj).trim() !== '' && !isValidDateString(String(doj).trim())) {
      return res.status(400).json({ success: false, message: 'Invalid date of joining format (YYYY-MM-DD).' });
    }

    // Department validation: allow existing legacy department to remain, but new department assignment must be active (IT / Non-IT)
    if (department !== undefined && department !== null && String(department).trim() !== '') {
      const sanitizedNewDept = String(department).trim();
      if (sanitizedNewDept.toLowerCase() !== (currentEmp.department || '').toLowerCase()) {
        const activeDeptRes = await pool.query(
          'SELECT id, name FROM public.organization_departments WHERE is_active = true AND LOWER(TRIM(name)) = LOWER(TRIM($1))',
          [sanitizedNewDept]
        );
        if (activeDeptRes.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: `Department '${sanitizedNewDept}' is not an active department. Supported active departments: IT, Non-IT.`,
          });
        }
      }
    }

    // Designation validation: accept only Associate Software Engineer or Associate
    if (designation !== undefined) {
      if (!designation || typeof designation !== 'string' || !designation.trim()) {
        return res.status(400).json({ success: false, message: 'Designation cannot be empty.' });
      }
      const sanitizedNewDesig = designation.trim();
      if (!ALLOWED_DESIGNATIONS.includes(sanitizedNewDesig)) {
        return res.status(400).json({
          success: false,
          message: `Invalid designation '${sanitizedNewDesig}'. Allowed designations: Associate Software Engineer, Associate.`,
        });
      }
    }

    // Handle email update if supplied and different
    let newEmail = null;
    if (email && typeof email === 'string' && email.trim().toLowerCase() !== currentEmp.email?.toLowerCase()) {
      newEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid email address format.' });
      }
      // Check collision in users
      const checkUser = await pool.query(
        'SELECT id FROM public.users WHERE LOWER(email) = $1 AND employee_id != $2',
        [newEmail, trimmedId]
      );
      if (checkUser.rows.length > 0) {
        return res.status(409).json({ success: false, message: `Email '${newEmail}' is already in use by another account.` });
      }
      // Check collision in employees
      const checkEmp = await pool.query(
        'SELECT employee_id FROM public.employees WHERE LOWER(email) = $1 AND employee_id != $2',
        [newEmail, trimmedId]
      );
      if (checkEmp.rows.length > 0) {
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
          emergency_contact_relationship = COALESCE($17, emergency_contact_relationship),
          personal_email = COALESCE($18, personal_email),
          work_location = COALESCE($19, work_location),
          status = COALESCE($20, status),
          working_days_per_week = COALESCE($21, working_days_per_week),
          email = COALESCE($22, email),
          updated_at = NOW()
        WHERE employee_id = $23
        RETURNING *;
      `;

      await client.query(updateQuery, [
        fName ? String(fName).trim() : null,
        lName !== undefined ? (lName ? String(lName).trim() : '') : null,
        phone !== undefined ? (phone ? String(phone).trim().replace(/\D/g, '').slice(-10) : null) : null,
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
        emRel !== undefined ? (emRel ? String(emRel).trim() : null) : null,
        persEmail !== undefined ? (persEmail ? String(persEmail).trim().toLowerCase() : null) : null,
        wLoc !== undefined ? (wLoc ? String(wLoc).trim() : null) : null,
        targetStatus || null,
        parsedWorkingDays !== undefined ? parsedWorkingDays : null,
        newEmail || null,
        trimmedId,
      ]);

      // Synchronize users table
      const userUpdates = [];
      const userValues = [];
      let paramIdx = 1;

      if (fName) {
        userUpdates.push(`first_name = $${paramIdx++}`);
        userValues.push(String(fName).trim());
      }
      if (lName !== undefined) {
        userUpdates.push(`last_name = $${paramIdx++}`);
        userValues.push(lName ? String(lName).trim() : '');
      }
      if (newEmail) {
        userUpdates.push(`email = $${paramIdx++}`);
        userValues.push(newEmail);
      }
      if (phone !== undefined) {
        userUpdates.push(`phone = $${paramIdx++}`);
        userValues.push(phone ? String(phone).trim().replace(/\D/g, '').slice(-10) : null);
      }
      if (targetStatus) {
        userUpdates.push(`status = $${paramIdx++}`);
        userValues.push(targetStatus);
      }

      if (userUpdates.length > 0) {
        userValues.push(trimmedId);
        await client.query(
          `UPDATE public.users SET ${userUpdates.join(', ')}, updated_at = NOW() WHERE employee_id = $${paramIdx}`,
          userValues
        );
      }

      // Handle Payroll Profiles (Step 5)
      const rawBasic = req.body.basic_salary ?? req.body.basicSalary ?? salary.basicSalary ?? salary.basic_salary;
      const rawHra = req.body.hra ?? salary.hra;
      const rawAllowances = req.body.allowances ?? salary.allowances;
      const rawPfEmp = req.body.pf_employee ?? req.body.pfEmployee ?? salary.pfEmployee ?? salary.pf_employee;
      const rawPt = req.body.professional_tax ?? req.body.professionalTax ?? salary.professionalTax ?? salary.professional_tax;
      const rawOther = req.body.other_deductions ?? req.body.otherDeductions ?? salary.otherDeductions ?? salary.other_deductions;

      if (rawBasic !== undefined || rawHra !== undefined || rawAllowances !== undefined) {
        const bSalary = Math.max(0, parseFloat(rawBasic) || 0);
        const hraVal = Math.max(0, parseFloat(rawHra) || 0);
        const allowVal = Math.max(0, parseFloat(rawAllowances) || 0);
        const pfEmpVal = Math.max(0, parseFloat(rawPfEmp) || 0);
        const ptVal = Math.max(0, parseFloat(rawPt) || 0);
        const otherVal = Math.max(0, parseFloat(rawOther) || 0);

        await client.query(
          `INSERT INTO public.payroll_profiles (
             employee_id, basic_salary, hra, allowances, pf_employee, professional_tax, other_deductions, effective_from
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (employee_id) DO UPDATE SET
             basic_salary = EXCLUDED.basic_salary,
             hra = EXCLUDED.hra,
             allowances = EXCLUDED.allowances,
             pf_employee = EXCLUDED.pf_employee,
             professional_tax = EXCLUDED.professional_tax,
             other_deductions = EXCLUDED.other_deductions,
             updated_at = NOW()`,
          [trimmedId, bSalary, hraVal, allowVal, pfEmpVal, ptVal, otherVal, doj || currentEmp.date_of_joining || '2026-01-01']
        );
      }

      // Handle Leave Balances (Step 6)
      const rawPL = req.body.paid_leave ?? req.body.paidLeave ?? leaveBalances.paidLeave ?? leaveBalances.paid_leave;
      const rawSL = req.body.sick_leave ?? req.body.sickLeave ?? leaveBalances.sickLeave ?? leaveBalances.sick_leave;
      const rawUPL = req.body.unpaid_leave ?? req.body.unpaidLeave ?? leaveBalances.unpaidLeave ?? leaveBalances.unpaid_leave;

      if (rawPL !== undefined || rawSL !== undefined || rawUPL !== undefined) {
        const plVal = Math.max(0, parseFloat(rawPL) || 0);
        const slVal = Math.max(0, parseFloat(rawSL) || 0);
        const uplVal = Math.max(0, parseFloat(rawUPL) || 0);

        await client.query(
          `INSERT INTO public.leave_balances (
             employee_id, paid_leave_balance, sick_leave_balance, unpaid_leave_balance
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (employee_id) DO UPDATE SET
             paid_leave_balance = EXCLUDED.paid_leave_balance,
             sick_leave_balance = EXCLUDED.sick_leave_balance,
             unpaid_leave_balance = EXCLUDED.unpaid_leave_balance,
             updated_at = NOW()`,
          [trimmedId, plVal, slVal, uplVal]
        );
      }

      // Handle PF Details (Step 4)
      const rawPfNotAvail = req.body.pfNotAvailable ?? req.body.pf_not_available ?? pfDetails.pfNotAvailable;
      const isPfNotAvailable = rawPfNotAvail === 'true' || rawPfNotAvail === true;
      const uanNum = (req.body.uan_number ?? req.body.uanNumber ?? pfDetails.uanNumber ?? pfDetails.uan_number ?? '').toString().trim();
      const pfNum = (req.body.pf_number ?? req.body.pfNumber ?? pfDetails.pfNumber ?? pfDetails.pf_number ?? '').toString().trim();
      const penNum = (req.body.pension_number ?? req.body.pensionNumber ?? pfDetails.pensionNumber ?? pfDetails.pension_number ?? '').toString().trim();

      const rawEmpContrib = req.body.employee_contribution ?? req.body.employeeContribution ?? pfDetails.employeeContribution ?? pfDetails.employee_contribution;
      let empContrib = null;
      if (rawEmpContrib !== undefined && rawEmpContrib !== null && String(rawEmpContrib).trim() !== '' && String(rawEmpContrib).trim() !== '—') {
        const parsed = parseFloat(rawEmpContrib);
        if (isNaN(parsed) || parsed < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Employee contribution must be a non-negative number.' });
        }
        empContrib = Math.round(parsed * 100) / 100;
      }

      const rawEmprContrib = req.body.employer_contribution ?? req.body.employerContribution ?? pfDetails.employerContribution ?? pfDetails.employer_contribution;
      let emprContrib = null;
      if (rawEmprContrib !== undefined && rawEmprContrib !== null && String(rawEmprContrib).trim() !== '' && String(rawEmprContrib).trim() !== '—') {
        const parsed = parseFloat(rawEmprContrib);
        if (isNaN(parsed) || parsed < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Employer contribution must be a non-negative number.' });
        }
        emprContrib = Math.round(parsed * 100) / 100;
      }

      if (isPfNotAvailable) {
        await client.query('DELETE FROM public.pf_details WHERE employee_id = $1', [trimmedId]);
      } else if (uanNum || pfNum || penNum || empContrib !== null || emprContrib !== null) {
        await client.query(
          `INSERT INTO public.pf_details (
             employee_id, uan_number, pf_number, pension_number, employee_contribution, employer_contribution
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (employee_id) DO UPDATE SET
             uan_number = EXCLUDED.uan_number,
             pf_number = EXCLUDED.pf_number,
             pension_number = EXCLUDED.pension_number,
             employee_contribution = EXCLUDED.employee_contribution,
             employer_contribution = EXCLUDED.employer_contribution,
             updated_at = NOW()`,
          [trimmedId, uanNum || null, pfNum || null, penNum || null, empContrib, emprContrib]
        );
      }

      // Handle Bank Details (Step 5)
      let bankDetails = req.body.bankDetails || req.body.bank_details;
      if (typeof bankDetails === 'string') {
        try { bankDetails = JSON.parse(bankDetails); } catch { bankDetails = null; }
      }

      const rawBankNotAvail = req.body.bankNotAvailable ?? req.body.bank_not_available ?? bankDetails?.bankNotAvailable;
      const isBankNotAvailable = rawBankNotAvail === 'true' || rawBankNotAvail === true;

      const hasBankInput = !isBankNotAvailable && ((bankDetails !== undefined && bankDetails !== null) ||
        req.body.bank_account_holder_name !== undefined ||
        req.body.bankAccountHolderName !== undefined ||
        req.body.account_holder_name !== undefined ||
        req.body.bank_name !== undefined ||
        req.body.bankName !== undefined ||
        req.body.bank_account_number !== undefined ||
        req.body.bankAccountNumber !== undefined ||
        req.body.account_number !== undefined ||
        req.body.bank_ifsc_code !== undefined ||
        req.body.bankIfscCode !== undefined ||
        req.body.ifsc_code !== undefined ||
        req.body.bank_branch_name !== undefined ||
        req.body.bankBranchName !== undefined ||
        req.body.branch_name !== undefined ||
        req.body.bank_branch_city !== undefined ||
        req.body.bankBranchCity !== undefined ||
        req.body.branch_city !== undefined ||
        req.body.bank_branch_state !== undefined ||
        req.body.bankBranchState !== undefined ||
        req.body.branch_state !== undefined ||
        req.body.bank_account_type !== undefined ||
        req.body.bankAccountType !== undefined ||
        req.body.account_type !== undefined ||
        req.body.bank_verification_status !== undefined ||
        req.body.bankVerificationStatus !== undefined ||
        req.body.verification_status !== undefined);

      let bankUpdated = false;
      let finalBankRecord = null;

      if (hasBankInput) {
        const existingBankRes = await client.query(
          'SELECT * FROM public.employee_bank_details WHERE employee_id = $1',
          [trimmedId]
        );
        const existingBank = existingBankRes.rows[0] || null;

        const rawBankHolder = bankDetails?.account_holder_name ?? bankDetails?.accountHolderName ?? req.body.bank_account_holder_name ?? req.body.bankAccountHolderName;
        const rawBankName = bankDetails?.bank_name ?? bankDetails?.bankName ?? req.body.bank_name ?? req.body.bankName;
        const rawBankAccNum = bankDetails?.account_number ?? bankDetails?.accountNumber ?? req.body.bank_account_number ?? req.body.bankAccountNumber;
        const rawBankConfirmAccNum = bankDetails?.confirm_account_number ?? bankDetails?.confirmAccountNumber ?? req.body.bank_confirm_account_number ?? req.body.bankConfirmAccountNumber;
        const rawBankIfsc = bankDetails?.ifsc_code ?? bankDetails?.ifscCode ?? req.body.bank_ifsc_code ?? req.body.bankIfscCode;
        const rawBankBranch = bankDetails?.branch_name ?? bankDetails?.branchName ?? req.body.bank_branch_name ?? req.body.bankBranchName;
        const rawBankCity = bankDetails?.branch_city ?? bankDetails?.branchCity ?? req.body.bank_branch_city ?? req.body.bankBranchCity;
        const rawBankState = bankDetails?.branch_state ?? bankDetails?.branchState ?? req.body.bank_branch_state ?? req.body.bankBranchState;
        const rawBankAccType = bankDetails?.account_type ?? bankDetails?.accountType ?? req.body.bank_account_type ?? req.body.bankAccountType;
        const rawBankStatus = bankDetails?.verification_status ?? bankDetails?.verificationStatus ?? req.body.bank_verification_status ?? req.body.bankVerificationStatus;

        // Account Holder Name
        let sanitizedHolder = existingBank ? existingBank.account_holder_name : '';
        if (rawBankHolder !== undefined) {
          if (!rawBankHolder || !String(rawBankHolder).trim()) {
            return res.status(400).json({ success: false, message: 'Account holder name is required.' });
          }
          sanitizedHolder = String(rawBankHolder).trim().substring(0, 255);
        } else if (!existingBank) {
          sanitizedHolder = `${fName || currentEmp.first_name} ${lName !== undefined ? lName : (currentEmp.last_name || '')}`.trim();
        }

        // Bank Name (Never reset existing bank name unless explicitly provided with non-empty string)
        let sanitizedBankName = existingBank ? existingBank.bank_name : 'IDFC Bank';
        if (rawBankName !== undefined && String(rawBankName).trim() !== '') {
          sanitizedBankName = String(rawBankName).trim().substring(0, 100);
        }

        // Account Number
        let sanitizedEncryptedAcc = existingBank ? existingBank.account_number_encrypted : null;
        let sanitizedLast4 = existingBank ? existingBank.account_number_last4 : null;
        let accNumberWasUpdated = false;

        if (rawBankAccNum !== undefined && String(rawBankAccNum).trim() !== '') {
          const rawAcc = String(rawBankAccNum).trim();
          if (rawAcc.includes('•')) {
            // Masked account number passed from UI — retain existing encryption
            if (!existingBank) {
              return res.status(400).json({ success: false, message: 'A valid full account number is required.' });
            }
          } else {
            if (!isValidAccountNumber(rawAcc)) {
              return res.status(400).json({ success: false, message: 'Invalid account number. Account number must contain 9 to 18 digits.' });
            }
            const confirmVal = rawBankConfirmAccNum !== undefined ? String(rawBankConfirmAccNum).trim() : '';
            if (!confirmVal) {
              return res.status(400).json({ success: false, message: 'Please confirm the account number.' });
            }
            if (rawAcc !== confirmVal) {
              return res.status(400).json({ success: false, message: 'Account numbers do not match. Please verify and re-enter.' });
            }
            sanitizedEncryptedAcc = encryptAccountNumber(rawAcc);
            sanitizedLast4 = rawAcc.slice(-4);
            accNumberWasUpdated = true;
          }
        } else if (!existingBank) {
          return res.status(400).json({ success: false, message: 'Account number is required.' });
        }

        // IFSC Code
        let sanitizedIfsc = existingBank ? existingBank.ifsc_code : '';
        if (rawBankIfsc !== undefined && String(rawBankIfsc).trim() !== '') {
          const rawIfsc = String(rawBankIfsc).trim().toUpperCase();
          if (!isValidIFSC(rawIfsc)) {
            return res.status(400).json({ success: false, message: 'Invalid IFSC code format (e.g., IDFB0001234).' });
          }
          sanitizedIfsc = rawIfsc;
        } else if (!existingBank) {
          return res.status(400).json({ success: false, message: 'IFSC code is required.' });
        }

        // Account Type
        let sanitizedAccType = existingBank ? existingBank.account_type : 'Savings';
        if (rawBankAccType !== undefined && String(rawBankAccType).trim() !== '') {
          const t = String(rawBankAccType).trim();
          if (!['Savings', 'Current', 'Salary'].includes(t)) {
            return res.status(400).json({ success: false, message: 'Invalid account type. Allowed: Savings, Current, Salary.' });
          }
          sanitizedAccType = t;
        }

        // Verification Status: Preserve existing unless explicitly provided or account number changed
        let targetVerStatus = existingBank ? existingBank.verification_status : 'Pending';
        if (rawBankStatus && ['Pending', 'Verified', 'Rejected'].includes(String(rawBankStatus).trim())) {
          targetVerStatus = String(rawBankStatus).trim();
        } else if (accNumberWasUpdated) {
          targetVerStatus = 'Pending';
        }

        const bBranch = rawBankBranch !== undefined ? (rawBankBranch ? String(rawBankBranch).trim() : null) : (existingBank ? existingBank.branch_name : null);
        const bCity = rawBankCity !== undefined ? (rawBankCity ? String(rawBankCity).trim() : null) : (existingBank ? existingBank.branch_city : null);
        const bState = rawBankState !== undefined ? (rawBankState ? String(rawBankState).trim() : null) : (existingBank ? existingBank.branch_state : null);

        const upsertRes = await client.query(
          `INSERT INTO public.employee_bank_details (
             employee_id, account_holder_name, bank_name,
             account_number_encrypted, account_number_last4,
             ifsc_code, branch_name, branch_city, branch_state,
             account_type, verification_status, updated_by, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (employee_id) DO UPDATE SET
             account_holder_name = EXCLUDED.account_holder_name,
             bank_name = EXCLUDED.bank_name,
             account_number_encrypted = EXCLUDED.account_number_encrypted,
             account_number_last4 = EXCLUDED.account_number_last4,
             ifsc_code = EXCLUDED.ifsc_code,
             branch_name = EXCLUDED.branch_name,
             branch_city = EXCLUDED.branch_city,
             branch_state = EXCLUDED.branch_state,
             account_type = EXCLUDED.account_type,
             verification_status = EXCLUDED.verification_status,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
           RETURNING *`,
          [
            trimmedId,
            sanitizedHolder,
            sanitizedBankName,
            sanitizedEncryptedAcc,
            sanitizedLast4,
            sanitizedIfsc,
            bBranch,
            bCity,
            bState,
            sanitizedAccType,
            targetVerStatus,
            req.user.id,
          ]
        );

        finalBankRecord = upsertRes.rows[0];
        bankUpdated = true;
      }

      // Handle File Uploads (Profile photo and onboarding documents)
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files) {
          let docType = 'Other Document';
          const fname = (file.fieldname || '').toLowerCase();
          if (fname.includes('offer')) docType = 'Offer Letter';
          else if (fname.includes('appointment')) docType = 'Appointment Letter';
          else if (fname.includes('aadhaar')) docType = 'Aadhaar Card';
          else if (fname.includes('pan')) docType = 'PAN Card';
          else if (fname.includes('education') || fname.includes('degree') || fname.includes('certificate')) docType = 'Educational Certificate';
          else if (fname.includes('pf')) docType = 'PF Document';
          else if (fname.includes('photo') || fname.includes('avatar')) docType = 'Profile Photo';
          else if (req.body[`doc_type_${file.fieldname}`]) docType = String(req.body[`doc_type_${file.fieldname}`]).trim();

          const prefix = (docType === 'Profile Photo') ? 'avatars' : 'documents';
          const storageKey = storageService.generateStorageKey({
            employeeId: trimmedId,
            originalFilename: file.originalname,
            prefix,
          });

          await storageService.saveFile(file.buffer, storageKey);
          savedStorageKeys.push(storageKey);

          if (docType === 'Profile Photo') {
            await client.query(
              'UPDATE public.employees SET profile_photo_url = $1 WHERE employee_id = $2',
              [storageKey, trimmedId]
            );
          } else {
            const cleanOriginalName = (file.originalname || docType).replace(/[\r\n\t]/g, '').trim();
            await client.query(
              `INSERT INTO public.documents (
                 employee_id, document_type, file_name, storage_key, uploaded_by
               ) VALUES ($1, $2, $3, $4, $5)`,
              [trimmedId, docType, cleanOriginalName, storageKey, req.user?.id]
            );
          }
        }
      }

      await client.query('COMMIT');

      // Audit logs
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

      if (bankUpdated && finalBankRecord) {
        await recordAuditLog({
          userId: req.user.id,
          action: 'EMPLOYEE_BANK_DETAILS_UPDATED',
          entityType: 'BANK_DETAILS',
          entityId: trimmedId,
          metadata: {
            employee_id: trimmedId,
            bank_name: finalBankRecord.bank_name,
            account_number_last4: finalBankRecord.account_number_last4,
            account_type: finalBankRecord.account_type,
            updated_by: req.user.email,
          },
          req,
        });
      }

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

      if (department !== undefined && department !== null) {
        const oldDept = currentEmp.department;
        const newDept = String(department).trim();
        if (oldDept && newDept && oldDept.toLowerCase() !== newDept.toLowerCase()) {
          await recordAuditLog({
            userId: req.user.id,
            action: 'EMPLOYEE_DEPARTMENT_CLASSIFIED',
            entityType: 'EMPLOYEE',
            entityId: trimmedId,
            metadata: {
              employee_id: trimmedId,
              employee_name: `${currentEmp.first_name || ''} ${currentEmp.last_name || ''}`.trim(),
              old_department: oldDept,
              new_department: newDept,
              admin_email: req.user.email,
              timestamp: new Date().toISOString(),
            },
            req,
          });
        }
      }

      // Fetch refreshed full record
      const [refreshedEmp, refreshedPayroll, refreshedLeaves, refreshedPf, refreshedDocs, refreshedBank] = await Promise.all([
        pool.query(
          `SELECT employee_id, first_name, last_name, email, phone,
                  TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                  gender, designation, department,
                  TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
                  status, status AS employment_status, reporting_manager,
                  employment_type, address, city, state, postal_code,
                  emergency_contact_name, emergency_contact_phone,
                  emergency_contact_relationship, personal_email, work_location,
                  profile_photo_url, COALESCE(working_days_per_week, 5)::int AS working_days_per_week,
                  created_at, updated_at
           FROM public.employees WHERE employee_id = $1`,
          [trimmedId]
        ),
        pool.query('SELECT * FROM public.payroll_profiles WHERE employee_id = $1', [trimmedId]),
        pool.query('SELECT * FROM public.leave_balances WHERE employee_id = $1', [trimmedId]),
        pool.query('SELECT * FROM public.pf_details WHERE employee_id = $1', [trimmedId]),
        pool.query('SELECT id, document_type, file_name, created_at FROM public.documents WHERE employee_id = $1 ORDER BY created_at DESC', [trimmedId]),
        pool.query(
          `SELECT id, account_holder_name, bank_name, account_number_last4, ifsc_code,
                  branch_name, branch_city, branch_state, account_type, verification_status,
                  admin_remarks, created_at, updated_at
           FROM public.employee_bank_details WHERE employee_id = $1`,
          [trimmedId]
        ),
      ]);

      const updatedRow = refreshedEmp.rows[0];
      const hasPhoto = Boolean(updatedRow.profile_photo_url && String(updatedRow.profile_photo_url).trim());
      const bankRow = refreshedBank?.rows?.[0] || null;
      const sanitizedBankDetails = bankRow ? {
        id: bankRow.id,
        account_holder_name: bankRow.account_holder_name,
        bank_name: bankRow.bank_name,
        account_number: maskAccountNumber(bankRow.account_number_last4),
        account_number_last4: bankRow.account_number_last4,
        ifsc_code: bankRow.ifsc_code,
        branch_name: bankRow.branch_name,
        branch_city: bankRow.branch_city,
        branch_state: bankRow.branch_state,
        account_type: bankRow.account_type,
        verification_status: bankRow.verification_status,
        admin_remarks: bankRow.admin_remarks,
        created_at: bankRow.created_at,
        updated_at: bankRow.updated_at,
      } : null;

      const responseData = {
        ...updatedRow,
        has_profile_photo: hasPhoto,
        photo_url: hasPhoto ? `/api/admin/employees/${trimmedId}/photo` : null,
        payroll_profile: refreshedPayroll.rows[0] || null,
        payroll: refreshedPayroll.rows[0] || null,
        leave_balances: refreshedLeaves.rows[0] || null,
        pf_details: refreshedPf.rows[0] || null,
        pf: refreshedPf.rows[0] || null,
        bank_details: sanitizedBankDetails,
        bank: sanitizedBankDetails,
        documents: refreshedDocs.rows || [],
      };
      delete responseData.profile_photo_url;

      return res.status(200).json({
        success: true,
        message: 'Employee details updated successfully.',
        data: responseData,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      for (const key of savedStorageKeys) {
        await storageService.deleteFile(key).catch(() => {});
      }
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
 * - Restricted to ADMIN role.
 * - Requires exact confirmation employee ID and confirmation checkbox.
 * - Retains legally required statutory payroll records in statutory_payroll_archive (8-year retention policy).
 * - Transactional: fully rolls back if database or file deletion fails.
 * - Does NOT expose internal storage keys or filesystem paths.
 */
const deleteEmployeePermanently = async (req, res, next) => {
  try {
    // 1. Role Authorization: Strictly ADMIN
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Administrator privileges required to permanently delete an employee.',
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

      // Archive statutory payroll records before deletion for 8-year compliance retention
      await client.query(
        `INSERT INTO public.statutory_payroll_archive (
           original_payroll_id, employee_id, month, year,
           basic_salary, hra, allowances, gross_salary,
           pf_employee, professional_tax, other_deductions,
           total_deductions, net_salary, processed_at
         )
         SELECT 
           id, employee_id, CAST(month AS VARCHAR), year,
           basic_salary, hra, allowances, gross_salary,
           pf_employee, professional_tax, other_deductions,
           total_deductions, net_salary, COALESCE(processed_at, created_at)
         FROM public.payroll_records
         WHERE employee_id = $1`,
        [sanitizedId]
      );

      await client.query(`DELETE FROM public.payroll_records WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.payroll_profiles WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.pf_details WHERE employee_id = $1`, [sanitizedId]);
      await client.query(`DELETE FROM public.employee_bank_details WHERE employee_id = $1`, [sanitizedId]);
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

/**
 * PUT /api/admin/employees/:employeeId/classify-department
 * Classifies an employee's department to strictly 'IT' or 'Non-IT'.
 */
const classifyEmployeeDepartment = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const rawDept = req.body.department || req.body.targetDepartment;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid employee ID.' });
    }
    const trimmedId = employeeId.trim();

    if (!rawDept || typeof rawDept !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Department is required and must be either 'IT' or 'Non-IT'.",
      });
    }

    const trimmedDept = rawDept.trim();
    let normalizedDept = null;
    if (trimmedDept.toLowerCase() === 'it') {
      normalizedDept = 'IT';
    } else if (trimmedDept.toLowerCase() === 'non-it') {
      normalizedDept = 'Non-IT';
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid department classification. Allowed values are strictly 'IT' or 'Non-IT'.",
      });
    }

    const empRes = await pool.query(
      'SELECT employee_id, first_name, last_name, department, email FROM public.employees WHERE employee_id = $1',
      [trimmedId]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee with ID '${trimmedId}' not found.` });
    }

    const currentEmp = empRes.rows[0];
    const oldDept = currentEmp.department;

    await pool.query(
      'UPDATE public.employees SET department = $1, updated_at = NOW() WHERE employee_id = $2',
      [normalizedDept, trimmedId]
    );

    // Audit log
    await recordAuditLog({
      userId: req.user.id,
      action: 'EMPLOYEE_DEPARTMENT_CLASSIFIED',
      entityType: 'EMPLOYEE',
      entityId: trimmedId,
      metadata: {
        employee_id: trimmedId,
        employee_name: `${currentEmp.first_name || ''} ${currentEmp.last_name || ''}`.trim(),
        old_department: oldDept,
        new_department: normalizedDept,
        admin_email: req.user.email,
        timestamp: new Date().toISOString(),
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Employee ${trimmedId} department successfully classified as ${normalizedDept}.`,
      data: {
        employee_id: trimmedId,
        department: normalizedDept,
        previous_department: oldDept,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/employees/classify-departments
 * Bulk classifies multiple employees' departments to strictly 'IT' or 'Non-IT'.
 */
const bulkClassifyDepartments = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { classifications } = req.body;
    if (!Array.isArray(classifications) || classifications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'classifications array is required.',
      });
    }

    await client.query('BEGIN');
    const results = [];

    for (const item of classifications) {
      const { employee_id, department } = item;
      if (!employee_id || !department) continue;
      const trimmedId = String(employee_id).trim();
      const trimmedDept = String(department).trim();
      let normalizedDept = null;
      if (trimmedDept.toLowerCase() === 'it') normalizedDept = 'IT';
      else if (trimmedDept.toLowerCase() === 'non-it') normalizedDept = 'Non-IT';
      else continue;

      const empRes = await client.query(
        'SELECT employee_id, first_name, last_name, department FROM public.employees WHERE employee_id = $1',
        [trimmedId]
      );
      if (empRes.rows.length === 0) continue;

      const oldDept = empRes.rows[0].department;
      await client.query(
        'UPDATE public.employees SET department = $1, updated_at = NOW() WHERE employee_id = $2',
        [normalizedDept, trimmedId]
      );

      await recordAuditLog({
        userId: req.user.id,
        action: 'EMPLOYEE_DEPARTMENT_CLASSIFIED',
        entityType: 'EMPLOYEE',
        entityId: trimmedId,
        metadata: {
          employee_id: trimmedId,
          employee_name: `${empRes.rows[0].first_name || ''} ${empRes.rows[0].last_name || ''}`.trim(),
          old_department: oldDept,
          new_department: normalizedDept,
          admin_email: req.user.email,
          timestamp: new Date().toISOString(),
        },
        req,
      });

      results.push({
        employee_id: trimmedId,
        department: normalizedDept,
        previous_department: oldDept,
      });
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: `Successfully classified ${results.length} employee(s).`,
      data: results,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
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
  classifyEmployeeDepartment,
  bulkClassifyDepartments,
};



