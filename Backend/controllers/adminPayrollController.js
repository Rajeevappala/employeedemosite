const path = require('path');
const crypto = require('crypto');
const pool = require('../config/database');
const storageService = require('../services/storageService');
const {
  generatePayslipPdf,
  checkAuthorizationAssets,
  MissingPayslipAssetsError,
} = require('../services/payslipPdfService');
const { recordAuditLog } = require('../services/auditService');
const excelPayrollService = require('../services/excelPayrollService');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Normalizes and validates month input into an integer (1 - 12).
 * Supports month numbers (1-12) or full month names ('January' - 'December').
 */
function parseMonthNumber(monthInput) {
  if (monthInput === undefined || monthInput === null || String(monthInput).trim() === '') {
    return null;
  }
  const str = String(monthInput).trim();
  const num = parseInt(str, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return num;
  }
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === str.toLowerCase());
  if (idx !== -1) {
    return idx + 1;
  }
  return null;
}

/**
 * Returns month name string for integer month (1 - 12).
 */
function getMonthName(monthNumber) {
  if (typeof monthNumber === 'number' && monthNumber >= 1 && monthNumber <= 12) {
    return MONTH_NAMES[monthNumber - 1];
  }
  return '';
}

/**
 * Validates a 4-digit calendar year (1900 - 2100).
 */
function parseYearNumber(yearInput) {
  if (yearInput === undefined || yearInput === null || String(yearInput).trim() === '') {
    return null;
  }
  const num = parseInt(String(yearInput).trim(), 10);
  if (!isNaN(num) && num >= 1900 && num <= 2100) {
    return num;
  }
  return null;
}

/**
 * Calculates standard working days in a calendar month (excluding Sundays).
 */
function calculateWorkingDays(year, monthNumber) {
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, monthNumber - 1, day);
    if (d.getDay() !== 0) { // Exclude Sunday
      workingDays++;
    }
  }
  return workingDays;
}

/**
 * GET /api/admin/payroll
 * Returns list of monthly payroll records joined with employee details.
 * Supports filters: month, year, search, department, status, and pagination.
 */
const getAdminPayrollRecords = async (req, res, next) => {
  try {
    const { month, year, search, department, status } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const queryParams = [];

    // Filter: Month
    if (month !== undefined && month !== null && String(month).trim() !== '' && String(month).trim() !== 'All') {
      const monthNum = parseMonthNumber(month);
      if (monthNum === null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month parameter. Provide a number (1-12) or valid month name (e.g. September).',
        });
      }
      queryParams.push(monthNum);
      conditions.push(`pr.month = $${queryParams.length}`);
    }

    // Filter: Year
    if (year !== undefined && year !== null && String(year).trim() !== '' && String(year).trim() !== 'All') {
      const yearNum = parseYearNumber(year);
      if (yearNum === null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid year parameter. Provide a 4-digit calendar year (e.g. 2026).',
        });
      }
      queryParams.push(yearNum);
      conditions.push(`pr.year = $${queryParams.length}`);
    }

    // Filter: Department
    if (department !== undefined && department !== null && String(department).trim() !== '' && String(department).trim() !== 'All' && String(department).trim() !== 'All Departments') {
      queryParams.push(String(department).trim());
      conditions.push(`e.department ILIKE $${queryParams.length}`);
    }

    // Filter: Status
    if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== 'All') {
      queryParams.push(String(status).trim());
      conditions.push(`pr.status ILIKE $${queryParams.length}`);
    }

    // Filter: Search (employee_id, first_name, last_name, designation, department)
    if (search !== undefined && search !== null && String(search).trim() !== '') {
      const trimmedSearch = String(search).trim();
      queryParams.push(`%${trimmedSearch}%`);
      const sIdx = queryParams.length;
      conditions.push(`(
        pr.employee_id ILIKE $${sIdx} OR
        e.first_name ILIKE $${sIdx} OR
        e.last_name ILIKE $${sIdx} OR
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) ILIKE $${sIdx} OR
        e.department ILIKE $${sIdx} OR
        e.designation ILIKE $${sIdx}
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total filtered records
    const countQuery = `
      SELECT COUNT(pr.id) AS total
      FROM public.payroll_records pr
      JOIN public.employees e ON e.employee_id = pr.employee_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    // Fetch paginated records
    const dataQueryParams = [...queryParams, limit, offset];
    const limitIdx = dataQueryParams.length - 1;
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT
        pr.id,
        pr.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.department,
        e.designation,
        pr.month,
        pr.year,
        pr.working_days,
        pr.payable_days,
        COALESCE(pr.basic_salary, 0)::numeric AS basic_salary,
        COALESCE(pr.hra, 0)::numeric AS hra,
        COALESCE(pr.allowances, 0)::numeric AS allowances,
        COALESCE(pr.gross_salary, 0)::numeric AS gross_salary,
        COALESCE(pr.pf_employee, 0)::numeric AS pf_employee,
        COALESCE(pr.professional_tax, 0)::numeric AS professional_tax,
        COALESCE(pr.other_deductions, 0)::numeric AS other_deductions,
        COALESCE(pr.total_deductions, 0)::numeric AS total_deductions,
        COALESCE(pr.net_salary, 0)::numeric AS net_salary,
        COALESCE(pr.status, 'Processed') AS status,
        pr.processed_at,
        pr.processed_by,
        pr.created_at,
        pr.updated_at
      FROM public.payroll_records pr
      JOIN public.employees e ON e.employee_id = pr.employee_id
      ${whereClause}
      ORDER BY pr.year DESC, pr.month DESC, pr.employee_id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const dataResult = await pool.query(dataQuery, dataQueryParams);

    // Map records for clean display and API consistency
    const records = dataResult.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employee_id: row.employee_id,
      name: row.employee_name,
      employee_name: row.employee_name,
      department: row.department || 'General',
      designation: row.designation || '—',
      month: row.month,
      month_name: getMonthName(row.month),
      year: row.year,
      workingDays: row.working_days !== null ? Number(row.working_days) : null,
      payableDays: row.payable_days !== null ? Number(row.payable_days) : null,
      basic: Number(row.basic_salary),
      basic_salary: Number(row.basic_salary),
      hra: Number(row.hra),
      allowances: Number(row.allowances),
      grossSalary: Number(row.gross_salary),
      gross_salary: Number(row.gross_salary),
      pf: Number(row.pf_employee),
      pf_employee: Number(row.pf_employee),
      pt: Number(row.professional_tax),
      professional_tax: Number(row.professional_tax),
      otherDeductions: Number(row.other_deductions),
      other_deductions: Number(row.other_deductions),
      deductions: Number(row.total_deductions),
      total_deductions: Number(row.total_deductions),
      netSalary: Number(row.net_salary),
      net_salary: Number(row.net_salary),
      status: row.status,
      processedAt: row.processed_at,
      processedBy: row.processed_by,
    }));

    // Overall summary across the current filter selection
    const summaryQuery = `
      SELECT
        COUNT(pr.id) AS total_employees,
        COUNT(pr.id) FILTER (WHERE pr.status = 'Processed' OR pr.status = 'Paid') AS processed,
        COUNT(pr.id) FILTER (WHERE pr.status = 'Pending') AS pending,
        COALESCE(SUM(pr.gross_salary), 0)::numeric AS total_gross,
        COALESCE(SUM(pr.total_deductions), 0)::numeric AS total_deductions,
        COALESCE(SUM(pr.net_salary), 0)::numeric AS total_net
      FROM public.payroll_records pr
      JOIN public.employees e ON e.employee_id = pr.employee_id
      ${whereClause}
    `;
    const summaryResult = await pool.query(summaryQuery, queryParams);
    const summaryRow = summaryResult.rows[0] || {};
    const summary = {
      total_employees: parseInt(summaryRow.total_employees, 10) || 0,
      processed: parseInt(summaryRow.processed, 10) || 0,
      pending: parseInt(summaryRow.pending, 10) || 0,
      total_gross: Number(summaryRow.total_gross) || 0,
      total_deductions: Number(summaryRow.total_deductions) || 0,
      total_net: Number(summaryRow.total_net) || 0,
    };

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: records,
      summary,
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
 * GET /api/admin/payroll/history
 * Returns distinct historical payroll periods from payroll_records.
 */
const getAdminPayrollHistory = async (req, res, next) => {
  try {
    const historyQuery = `
      SELECT
        pr.month,
        pr.year,
        COUNT(DISTINCT pr.employee_id)::int AS employees,
        COALESCE(pr.status, 'Processed') AS status,
        MAX(pr.processed_at) AS processed_at,
        COUNT(pr.id)::int AS payslips
      FROM public.payroll_records pr
      GROUP BY pr.month, pr.year, pr.status
      ORDER BY pr.year DESC, pr.month DESC
    `;
    const result = await pool.query(historyQuery);

    const history = result.rows.map((row) => {
      const monthName = getMonthName(row.month);
      const processedDateStr = row.processed_at
        ? new Date(row.processed_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : 'N/A';

      return {
        id: `${row.year}-${row.month}`,
        month: `${monthName} ${row.year}`,
        month_name: monthName,
        month_num: row.month,
        year: row.year,
        employees: row.employees,
        status: row.status,
        processedDate: processedDateStr,
        processed_at: row.processed_at,
        payslips: row.payslips,
      };
    });

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/attendance-summary
 * Dynamically computes monthly attendance statistics for the selected month/year
 * from the live attendance table.
 */
const getAdminAttendanceSummary = async (req, res, next) => {
  try {
    const { month, year } = req.query;

    let monthNum = parseMonthNumber(month);
    let yearNum = parseYearNumber(year);

    // Default to current date if omitted
    const now = new Date();
    if (!monthNum) monthNum = now.getMonth() + 1;
    if (!yearNum) yearNum = now.getFullYear();

    const workingDays = calculateWorkingDays(yearNum, monthNum);

    // Query real attendance metrics for active employees for the selected month/year
    const attQuery = `
      SELECT
        COUNT(CASE WHEN a.status = 'Present' THEN 1 END)::int AS present_count,
        COUNT(CASE WHEN a.status = 'Leave' THEN 1 END)::int AS leave_count,
        COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)::int AS absent_count,
        COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int AS half_day_count
      FROM public.attendance a
      JOIN public.employees e ON e.employee_id = a.employee_id
      WHERE e.status = 'ACTIVE'
        AND EXTRACT(YEAR FROM a.attendance_date) = $1
        AND EXTRACT(MONTH FROM a.attendance_date) = $2
    `;
    const attResult = await pool.query(attQuery, [yearNum, monthNum]);
    const attRow = attResult.rows[0] || {};

    // Total active workforce count
    const activeCountResult = await pool.query(
      "SELECT COUNT(*)::int AS active_count FROM public.employees WHERE status = 'ACTIVE'"
    );
    const activeCount = parseInt(activeCountResult.rows[0]?.active_count, 10) || 0;

    const presentCount = parseInt(attRow.present_count, 10) || 0;
    const leaveCount = parseInt(attRow.leave_count, 10) || 0;
    const absentCount = parseInt(attRow.absent_count, 10) || 0;
    const halfDayCount = parseInt(attRow.half_day_count, 10) || 0;

    const avgPresentDays = activeCount > 0 ? Math.round((presentCount / activeCount) * 10) / 10 : 0;

    return res.status(200).json({
      success: true,
      data: {
        workingDays,
        avgPresentDays,
        paidLeave: leaveCount,
        unpaidLeave: absentCount,
        halfDays: halfDayCount,
        totalActiveEmployees: activeCount,
        month: monthNum,
        month_name: getMonthName(monthNum),
        year: yearNum,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/:employeeId
 * Returns single employee's monthly payroll record or payroll profile.
 */
const getAdminEmployeePayroll = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!employeeId || typeof employeeId !== 'string' || employeeId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'employeeId is required.',
      });
    }

    const trimmedEmpId = employeeId.trim();

    // Check if employee exists
    const empCheck = await pool.query(
      `SELECT employee_id, first_name, last_name, department, designation, email, status
       FROM public.employees
       WHERE employee_id = $1`,
      [trimmedEmpId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Employee with ID '${trimmedEmpId}' not found.`,
      });
    }

    const emp = empCheck.rows[0];
    const monthNum = parseMonthNumber(month);
    const yearNum = parseYearNumber(year);

    // If month and year provided, look up monthly payroll record
    if (monthNum && yearNum) {
      const recordQuery = `
        SELECT
          pr.id,
          pr.employee_id,
          TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
          e.department,
          e.designation,
          pr.month,
          pr.year,
          pr.working_days,
          pr.payable_days,
          COALESCE(pr.basic_salary, 0)::numeric AS basic_salary,
          COALESCE(pr.hra, 0)::numeric AS hra,
          COALESCE(pr.allowances, 0)::numeric AS allowances,
          COALESCE(pr.gross_salary, 0)::numeric AS gross_salary,
          COALESCE(pr.pf_employee, 0)::numeric AS pf_employee,
          COALESCE(pr.professional_tax, 0)::numeric AS professional_tax,
          COALESCE(pr.other_deductions, 0)::numeric AS other_deductions,
          COALESCE(pr.total_deductions, 0)::numeric AS total_deductions,
          COALESCE(pr.net_salary, 0)::numeric AS net_salary,
          COALESCE(pr.status, 'Processed') AS status,
          pr.processed_at,
          pr.processed_by,
          pr.created_at,
          pr.updated_at
        FROM public.payroll_records pr
        JOIN public.employees e ON e.employee_id = pr.employee_id
        WHERE pr.employee_id = $1 AND pr.month = $2 AND pr.year = $3
      `;
      const recordResult = await pool.query(recordQuery, [trimmedEmpId, monthNum, yearNum]);

      if (recordResult.rows.length > 0) {
        const row = recordResult.rows[0];
        return res.status(200).json({
          success: true,
          data: {
            id: row.id,
            employeeId: row.employee_id,
            employee_id: row.employee_id,
            name: row.employee_name,
            employee_name: row.employee_name,
            department: row.department,
            designation: row.designation,
            month: row.month,
            month_name: getMonthName(row.month),
            year: row.year,
            workingDays: row.working_days !== null ? Number(row.working_days) : null,
            payableDays: row.payable_days !== null ? Number(row.payable_days) : null,
            basic: Number(row.basic_salary),
            basic_salary: Number(row.basic_salary),
            hra: Number(row.hra),
            allowances: Number(row.allowances),
            grossSalary: Number(row.gross_salary),
            gross_salary: Number(row.gross_salary),
            pf: Number(row.pf_employee),
            pf_employee: Number(row.pf_employee),
            pt: Number(row.professional_tax),
            professional_tax: Number(row.professional_tax),
            otherDeductions: Number(row.other_deductions),
            other_deductions: Number(row.other_deductions),
            deductions: Number(row.total_deductions),
            total_deductions: Number(row.total_deductions),
            netSalary: Number(row.net_salary),
            net_salary: Number(row.net_salary),
            status: row.status,
            processedAt: row.processed_at,
          },
        });
      }
    }

    // Check if payroll profile exists
    const profileQuery = `
      SELECT
        pp.id,
        pp.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.department,
        e.designation,
        COALESCE(pp.basic_salary, 0)::numeric AS basic_salary,
        COALESCE(pp.hra, 0)::numeric AS hra,
        COALESCE(pp.allowances, 0)::numeric AS allowances,
        COALESCE(pp.pf_employee, 0)::numeric AS pf_employee,
        COALESCE(pp.professional_tax, 0)::numeric AS professional_tax,
        COALESCE(pp.other_deductions, 0)::numeric AS other_deductions,
        pp.effective_from,
        pp.created_at,
        pp.updated_at
      FROM public.payroll_profiles pp
      JOIN public.employees e ON e.employee_id = pp.employee_id
      WHERE pp.employee_id = $1
    `;
    const profileResult = await pool.query(profileQuery, [trimmedEmpId]);

    if (profileResult.rows.length > 0) {
      const row = profileResult.rows[0];
      const basic = Number(row.basic_salary);
      const hra = Number(row.hra);
      const allowances = Number(row.allowances);
      const grossSalary = basic + hra + allowances;
      const pf = Number(row.pf_employee);
      const pt = Number(row.professional_tax);
      const otherDeductions = Number(row.other_deductions);
      const deductions = pf + pt + otherDeductions;
      const netSalary = grossSalary - deductions;

      return res.status(200).json({
        success: true,
        data: {
          id: row.id,
          employeeId: row.employee_id,
          employee_id: row.employee_id,
          name: row.employee_name,
          employee_name: row.employee_name,
          department: row.department,
          designation: row.designation,
          basic,
          basic_salary: basic,
          hra,
          allowances,
          grossSalary,
          gross_salary: grossSalary,
          pf,
          pf_employee: pf,
          pt,
          professional_tax: pt,
          otherDeductions,
          other_deductions: otherDeductions,
          deductions,
          total_deductions: deductions,
          netSalary,
          net_salary: netSalary,
          status: 'Valid',
          is_profile: true,
          has_monthly_record: false,
        },
      });
    }

    // Clean empty state if no record exists for that period
    return res.status(200).json({
      success: true,
      data: null,
      message: 'No payroll record available for this period.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/:employeeId/profile
 * Retrieves payroll profile for a single employee.
 */
const getAdminPayrollProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'employeeId is required.' });
    }

    const empCheck = await pool.query(
      `SELECT employee_id, first_name, last_name, department, designation FROM public.employees WHERE employee_id = $1`,
      [employeeId.trim()]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee '${employeeId}' not found.` });
    }

    const result = await pool.query(
      `SELECT * FROM public.payroll_profiles WHERE employee_id = $1`,
      [employeeId.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Payroll profile is not available.',
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/payroll/:employeeId/profile
 * Upserts a payroll profile for an employee.
 */
const updateAdminPayrollProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const {
      basic_salary,
      hra,
      allowances,
      pf_employee,
      professional_tax,
      other_deductions,
      effective_from,
    } = req.body;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, message: 'employeeId is required.' });
    }

    const trimmedEmpId = employeeId.trim();

    const empCheck = await pool.query(
      `SELECT employee_id FROM public.employees WHERE employee_id = $1`,
      [trimmedEmpId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Employee '${trimmedEmpId}' not found.` });
    }

    const basic = Math.max(0, parseFloat(basic_salary) || 0);
    const hraVal = Math.max(0, parseFloat(hra) || 0);
    const allowVal = Math.max(0, parseFloat(allowances) || 0);
    const pfVal = Math.max(0, parseFloat(pf_employee) || 0);
    const ptVal = Math.max(0, parseFloat(professional_tax) || 0);
    const otherVal = Math.max(0, parseFloat(other_deductions) || 0);
    const effFrom = effective_from || new Date().toISOString().split('T')[0];

    const upsertQuery = `
      INSERT INTO public.payroll_profiles (
        employee_id, basic_salary, hra, allowances,
        pf_employee, professional_tax, other_deductions, effective_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (employee_id)
      DO UPDATE SET
        basic_salary = EXCLUDED.basic_salary,
        hra = EXCLUDED.hra,
        allowances = EXCLUDED.allowances,
        pf_employee = EXCLUDED.pf_employee,
        professional_tax = EXCLUDED.professional_tax,
        other_deductions = EXCLUDED.other_deductions,
        effective_from = EXCLUDED.effective_from,
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await pool.query(upsertQuery, [
      trimmedEmpId, basic, hraVal, allowVal, pfVal, ptVal, otherVal, effFrom
    ]);

    recordAuditLog({
      action: 'PAYROLL_PROFILE_UPDATE',
      entityType: 'PAYROLL_PROFILE',
      entityId: trimmedEmpId,
      metadata: {
        basic_salary: basic,
        hra: hraVal,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Payroll profile updated successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/payroll/process
 * Creates or processes payroll records for active employees for the selected month/year.
 * Uses atomic transaction and protects against duplicate period conflicts.
 */
const processAdminPayroll = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { month, year, records } = req.body;
    const adminUserId = req.user?.id;

    const monthNum = parseMonthNumber(month);
    const yearNum = parseYearNumber(year);

    if (!monthNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing month. Provide a number (1-12) or month name (e.g. September).',
      });
    }

    if (!yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing year. Provide a 4-digit calendar year (e.g. 2026).',
      });
    }

    await client.query('BEGIN');

    const workingDays = calculateWorkingDays(yearNum, monthNum);
    const processedRecords = [];

    // Option A: Specific records array provided (e.g. from validated batch)
    if (Array.isArray(records) && records.length > 0) {
      for (const rec of records) {
        const empId = rec.employeeId || rec.employee_id;
        if (!empId) continue;

        // Verify employee exists in database
        const empCheck = await client.query(
          "SELECT employee_id FROM public.employees WHERE employee_id = $1 AND status = 'ACTIVE'",
          [empId.trim()]
        );
        if (empCheck.rows.length === 0) continue;

        const basic = Math.max(0, parseFloat(rec.basic ?? rec.basic_salary) || 0);
        const hra = Math.max(0, parseFloat(rec.hra) || 0);
        const allowances = Math.max(0, parseFloat(rec.allowances) || 0);
        const grossSalary = basic + hra + allowances;

        const pf = Math.max(0, parseFloat(rec.pf ?? rec.pf_employee) || 0);
        const pt = Math.max(0, parseFloat(rec.pt ?? rec.professional_tax) || 0);
        const otherDeductions = Math.max(0, parseFloat(rec.otherDeductions ?? rec.other_deductions) || 0);
        const totalDeductions = pf + pt + otherDeductions;
        const netSalary = grossSalary - totalDeductions;

        const payableDays = rec.payableDays !== undefined ? Number(rec.payableDays) : workingDays;

        const upsertQuery = `
          INSERT INTO public.payroll_records (
            employee_id, month, year, working_days, payable_days,
            basic_salary, hra, allowances, gross_salary,
            pf_employee, professional_tax, other_deductions, total_deductions, net_salary,
            status, processed_by, processed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (employee_id, month, year)
          DO UPDATE SET
            working_days = EXCLUDED.working_days,
            payable_days = EXCLUDED.payable_days,
            basic_salary = EXCLUDED.basic_salary,
            hra = EXCLUDED.hra,
            allowances = EXCLUDED.allowances,
            gross_salary = EXCLUDED.gross_salary,
            pf_employee = EXCLUDED.pf_employee,
            professional_tax = EXCLUDED.professional_tax,
            other_deductions = EXCLUDED.other_deductions,
            total_deductions = EXCLUDED.total_deductions,
            net_salary = EXCLUDED.net_salary,
            status = 'Processed',
            processed_by = EXCLUDED.processed_by,
            processed_at = NOW(),
            updated_at = NOW()
          RETURNING *;
        `;
        const resUpsert = await client.query(upsertQuery, [
          empId.trim(),
          monthNum,
          yearNum,
          workingDays,
          payableDays,
          basic,
          hra,
          allowances,
          grossSalary,
          pf,
          pt,
          otherDeductions,
          totalDeductions,
          netSalary,
          'Processed',
          adminUserId,
        ]);
        processedRecords.push(resUpsert.rows[0]);
      }
    } else {
      // Option B: Auto-process for all active employees using their payroll profiles
      const activeEmps = await client.query(`
        SELECT 
          e.employee_id,
          pp.basic_salary,
          pp.hra,
          pp.allowances,
          pp.pf_employee,
          pp.professional_tax,
          pp.other_deductions
        FROM public.employees e
        LEFT JOIN public.payroll_profiles pp ON pp.employee_id = e.employee_id
        WHERE e.status = 'ACTIVE'
      `);

      for (const emp of activeEmps.rows) {
        // If employee has a profile in payroll_profiles, process their record
        const basic = Math.max(0, parseFloat(emp.basic_salary) || 25000);
        const hra = Math.max(0, parseFloat(emp.hra) || 10000);
        const allowances = Math.max(0, parseFloat(emp.allowances) || 5000);
        const grossSalary = basic + hra + allowances;

        const pf = Math.max(0, parseFloat(emp.pf_employee) || 1800);
        const pt = Math.max(0, parseFloat(emp.professional_tax) || 200);
        const otherDeductions = Math.max(0, parseFloat(emp.other_deductions) || 500);
        const totalDeductions = pf + pt + otherDeductions;
        const netSalary = grossSalary - totalDeductions;

        const upsertQuery = `
          INSERT INTO public.payroll_records (
            employee_id, month, year, working_days, payable_days,
            basic_salary, hra, allowances, gross_salary,
            pf_employee, professional_tax, other_deductions, total_deductions, net_salary,
            status, processed_by, processed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (employee_id, month, year)
          DO UPDATE SET
            working_days = EXCLUDED.working_days,
            payable_days = EXCLUDED.payable_days,
            basic_salary = EXCLUDED.basic_salary,
            hra = EXCLUDED.hra,
            allowances = EXCLUDED.allowances,
            gross_salary = EXCLUDED.gross_salary,
            pf_employee = EXCLUDED.pf_employee,
            professional_tax = EXCLUDED.professional_tax,
            other_deductions = EXCLUDED.other_deductions,
            total_deductions = EXCLUDED.total_deductions,
            net_salary = EXCLUDED.net_salary,
            status = 'Processed',
            processed_by = EXCLUDED.processed_by,
            processed_at = NOW(),
            updated_at = NOW()
          RETURNING *;
        `;
        const resUpsert = await client.query(upsertQuery, [
          emp.employee_id,
          monthNum,
          yearNum,
          workingDays,
          workingDays,
          basic,
          hra,
          allowances,
          grossSalary,
          pf,
          pt,
          otherDeductions,
          totalDeductions,
          netSalary,
          'Processed',
          adminUserId,
        ]);
        processedRecords.push(resUpsert.rows[0]);
      }
    }

    await client.query('COMMIT');

    recordAuditLog({
      action: 'PAYROLL_PROCESS',
      entityType: 'PAYROLL',
      metadata: {
        month: monthNum,
        year: yearNum,
        count: processedRecords.length,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Payroll for ${getMonthName(monthNum)} ${yearNum} processed successfully.`,
      count: processedRecords.length,
      data: processedRecords,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/payroll/:employeeId/:year/:month/generate-payslip
 * (Also supports :employeeId/generate-payslip with { year, month } in req.body or query)
 * Generates a PDF payslip for a finalized payroll record and securely stores it in private storage and public.documents.
 * Idempotent: If already generated and physical file exists, returns existing document metadata.
 */
const generateAdminPayslip = async (req, res, next) => {
  let fileSaved = false;
  let generatedStorageKey = null;

  try {
    const { employeeId } = req.params;
    const yearParam = req.params.year || req.body?.year || req.query?.year;
    const monthParam = req.params.month || req.body?.month || req.query?.month;
    const adminUserId = req.user?.id;

    if (!employeeId || typeof employeeId !== 'string' || !employeeId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'employeeId is required.',
      });
    }

    const cleanEmpId = employeeId.trim();

    const monthNum = parseMonthNumber(monthParam);
    if (!monthNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing month. Provide a valid month number (1-12) or name (e.g. September).',
      });
    }

    const yearNum = parseYearNumber(yearParam);
    if (!yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing year. Provide a 4-digit calendar year (e.g. 2026).',
      });
    }

    // 1. Verify employee existence in public.employees
    const empCheck = await pool.query(
      `SELECT employee_id, first_name, last_name, department, designation, email, status, date_of_joining, work_location
       FROM public.employees
       WHERE employee_id = $1`,
      [cleanEmpId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Employee with ID '${cleanEmpId}' not found.`,
      });
    }
    const employee = empCheck.rows[0];

    // 2. Fetch authoritative finalized payroll record from public.payroll_records
    const payrollRes = await pool.query(
      `SELECT *
       FROM public.payroll_records
       WHERE employee_id = $1 AND month = $2 AND year = $3`,
      [cleanEmpId, monthNum, yearNum]
    );

    if (payrollRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Payroll record not found for employee '${cleanEmpId}' in ${getMonthName(monthNum)} ${yearNum}.`,
      });
    }

    const payroll = payrollRes.rows[0];

    // 3. Finalized status validation: Only generate payslips for finalized payroll ('Processed' or 'Paid')
    const normalizedStatus = (payroll.status || '').trim().toLowerCase();
    if (normalizedStatus === 'pending' || (normalizedStatus !== 'processed' && normalizedStatus !== 'paid')) {
      return res.status(400).json({
        success: false,
        message: `Payslip is not available for this payroll period. Payroll status is ${payroll.status || 'Pending'}.`,
      });
    }

    // 4. Optional PF details & Bank details
    const pfRes = await pool.query(
      `SELECT uan_number, pf_number FROM public.pf_details WHERE employee_id = $1`,
      [cleanEmpId]
    );
    const pfDetails = pfRes.rows[0] || null;

    const bankRes = await pool.query(
      `SELECT bank_name, account_number_last4, branch_name, ifsc_code, account_type
       FROM public.employee_bank_details
       WHERE employee_id = $1 LIMIT 1`,
      [cleanEmpId]
    );
    const bankDetails = bankRes.rows[0] || null;

    // 5. Idempotent check: Check if a payslip document already exists in public.documents
    const existingDocRes = await pool.query(
      `SELECT id, employee_id, document_type, file_name, storage_key, month, year, created_at
       FROM public.documents
       WHERE employee_id = $1 AND document_type = 'Payslip' AND month = $2 AND year = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanEmpId, monthNum, yearNum]
    );

    if (existingDocRes.rows.length > 0) {
      const existingDoc = existingDocRes.rows[0];
      const isFilePresent = await storageService.fileExists(existingDoc.storage_key);

      if (isFilePresent) {
        return res.status(200).json({
          success: true,
          message: 'Payslip already exists and is ready.',
          data: {
            document_id: existingDoc.id,
            employee_id: existingDoc.employee_id,
            document_type: existingDoc.document_type,
            file_name: existingDoc.file_name,
            month: existingDoc.month,
            year: existingDoc.year,
          },
        });
      }

      // If DB record exists but physical file is missing from storage, regenerate into existing storage key
      const pdfBuffer = await generatePayslipPdf({ employee, payroll, pfDetails, bankDetails });
      await storageService.saveFile(pdfBuffer, existingDoc.storage_key);

      return res.status(200).json({
        success: true,
        message: 'Payslip regenerated successfully.',
        data: {
          document_id: existingDoc.id,
          employee_id: existingDoc.employee_id,
          document_type: existingDoc.document_type,
          file_name: existingDoc.file_name,
          month: existingDoc.month,
          year: existingDoc.year,
        },
      });
    }

    // 6. Generate fresh PDF buffer
    const pdfBuffer = await generatePayslipPdf({ employee, payroll, pfDetails, bankDetails });

    // 7. Save PDF to private storage
    const monthName = getMonthName(monthNum);
    const originalFileName = `Payslip_${cleanEmpId}_${monthName}_${yearNum}.pdf`;

    generatedStorageKey = storageService.generateStorageKey({
      employeeId: cleanEmpId,
      originalFilename: originalFileName,
      prefix: 'documents',
    });

    await storageService.saveFile(pdfBuffer, generatedStorageKey);
    fileSaved = true;

    // 8. Insert metadata into public.documents
    try {
      const insertQuery = `
        INSERT INTO public.documents (
          employee_id,
          document_type,
          file_name,
          storage_key,
          month,
          year,
          uploaded_by
        ) VALUES ($1, 'Payslip', $2, $3, $4, $5, $6)
        RETURNING id, employee_id, document_type, file_name, month, year, created_at;
      `;

      const insertResult = await pool.query(insertQuery, [
        cleanEmpId,
        originalFileName,
        generatedStorageKey,
        monthNum,
        yearNum,
        adminUserId,
      ]);

      const inserted = insertResult.rows[0];

      recordAuditLog({
        action: 'PAYSLIP_GENERATE',
        entityType: 'DOCUMENT',
        entityId: inserted.id,
        metadata: {
          employee_id: inserted.employee_id,
          month: inserted.month,
          year: inserted.year,
        },
        req,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: 'Payslip generated successfully',
        data: {
          document_id: inserted.id,
          employee_id: inserted.employee_id,
          document_type: inserted.document_type,
          file_name: inserted.file_name,
          month: inserted.month,
          year: inserted.year,
        },
      });
    } catch (dbErr) {
      // Clean up orphaned physical file if DB insert fails
      if (fileSaved && generatedStorageKey) {
        try {
          await storageService.deleteFile(generatedStorageKey);
        } catch {
          // ignore cleanup error
        }
      }
      throw dbErr;
    }
  } catch (error) {
    if (fileSaved && generatedStorageKey) {
      try {
        await storageService.deleteFile(generatedStorageKey);
      } catch {
        // ignore cleanup error
      }
    }
    if (error instanceof MissingPayslipAssetsError || error.code === 'MISSING_AUTHORIZATION_ASSETS') {
      return res.status(422).json({
        success: false,
        message: error.message,
        error: 'MISSING_AUTHORIZATION_ASSETS',
        missingAssets: error.missingDetails || [],
      });
    }
    next(error);
  }
};

/**
 * POST /api/admin/payroll/generate-payslips
 * Batch generates payslips for all finalized employees in the specified month/year.
 */
const generateAllAdminPayslips = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const adminUserId = req.user?.id;

    const monthNum = parseMonthNumber(month);
    const yearNum = parseYearNumber(year);

    if (!monthNum || !yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Valid month and year are required.',
      });
    }

    // Find all finalized payroll records for this period
    const recordsRes = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.department, e.designation, e.email
       FROM public.payroll_records pr
       JOIN public.employees e ON e.employee_id = pr.employee_id
       WHERE pr.month = $1 AND pr.year = $2 AND pr.status IN ('Processed', 'Paid')
       ORDER BY pr.employee_id ASC`,
      [monthNum, yearNum]
    );

    if (recordsRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No finalized payroll records found for ${getMonthName(monthNum)} ${yearNum}.`,
      });
    }

    if (process.env.PAYSLIP_REQUIRE_ASSETS === 'true') {
      const assetStatus = checkAuthorizationAssets();
      if (!assetStatus.isComplete) {
        return res.status(422).json({
          success: false,
          message: 'Batch payslip generation aborted: Authorized company signature or office stamp assets are missing or unreadable. Please configure required genuine PNG assets in Backend/assets/company/ before generating official payslips.',
          error: 'MISSING_AUTHORIZATION_ASSETS',
          missingAssets: assetStatus.missing,
        });
      }
    }

    const results = [];
    let generatedCount = 0;
    let alreadyGeneratedCount = 0;
    const failedEmployees = [];

    for (const record of recordsRes.rows) {
      const cleanEmpId = record.employee_id;
      try {
        const employee = {
          employee_id: cleanEmpId,
          first_name: record.first_name,
          last_name: record.last_name,
          department: record.department,
          designation: record.designation,
        };

        // Check existing document
        const existingDocRes = await pool.query(
          `SELECT id, employee_id, document_type, file_name, storage_key, month, year
           FROM public.documents
           WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3
           LIMIT 1`,
          [cleanEmpId, monthNum, yearNum]
        );

        if (existingDocRes.rows.length > 0) {
          const existingDoc = existingDocRes.rows[0];
          const isPresent = await storageService.fileExists(existingDoc.storage_key);
          if (isPresent) {
            alreadyGeneratedCount++;
            results.push({
              document_id: existingDoc.id,
              employee_id: cleanEmpId,
              file_name: existingDoc.file_name,
              status: 'Already Generated',
            });
            continue;
          }
        }

        // Generate & store
        const pfRes = await pool.query(
          `SELECT uan_number, pf_number FROM public.pf_details WHERE employee_id = $1`,
          [cleanEmpId]
        );
        const pfDetails = pfRes.rows[0] || null;

        const pdfBuffer = await generatePayslipPdf({ employee, payroll: record, pfDetails });
        const monthName = getMonthName(monthNum);
        const originalFileName = `Payslip_${cleanEmpId}_${monthName}_${yearNum}.pdf`;

        const generatedStorageKey = storageService.generateStorageKey({
          employeeId: cleanEmpId,
          originalFilename: originalFileName,
          prefix: 'documents',
        });

        await storageService.saveFile(pdfBuffer, generatedStorageKey);

        const insertRes = await pool.query(
          `INSERT INTO public.documents (
             employee_id, document_type, file_name, storage_key, month, year, uploaded_by
           ) VALUES ($1, 'Payslip', $2, $3, $4, $5, $6)
           ON CONFLICT (employee_id, month, year) WHERE LOWER(document_type) = 'payslip'
           DO UPDATE SET
             file_name = EXCLUDED.file_name,
             storage_key = EXCLUDED.storage_key,
             uploaded_by = EXCLUDED.uploaded_by,
             updated_at = NOW()
           RETURNING id, employee_id, file_name, month, year`,
          [cleanEmpId, originalFileName, generatedStorageKey, monthNum, yearNum, adminUserId]
        );

        generatedCount++;
        results.push({
          document_id: insertRes.rows[0].id,
          employee_id: cleanEmpId,
          file_name: insertRes.rows[0].file_name,
          status: 'Generated',
        });
      } catch (indivErr) {
        console.error(`Error generating payslip for ${cleanEmpId}:`, indivErr.message);
        failedEmployees.push({
          employee_id: cleanEmpId,
          error: indivErr.message,
        });
        results.push({
          employee_id: cleanEmpId,
          status: 'Failed',
          error: indivErr.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${results.length} payslips (${generatedCount} generated, ${alreadyGeneratedCount} already valid, ${failedEmployees.length} failed).`,
      count: results.length,
      generatedCount,
      alreadyGeneratedCount,
      failedCount: failedEmployees.length,
      failedEmployees,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/template
 * Generates and downloads the official, styled Excel payroll import template workbook (.xlsx).
 */
const downloadPayrollTemplate = async (req, res, next) => {
  try {
    const workbook = await excelPayrollService.generateTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Payroll_Import_Template.xlsx"'
    );
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/payroll/import/preview
 * Reads and validates an uploaded Excel workbook, verifies employee existence in DB,
 * checks for duplicates and existing records, calculates preview values server-side.
 * Strictly read-only: does not modify database records or create payslips.
 */
const previewPayrollImport = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No Excel file provided. Please choose a valid .xlsx file to upload.',
      });
    }

    const preview = await excelPayrollService.parseAndValidateExcelBuffer(req.file.buffer, pool);
    const adminUserId = req.user?.id;
    const originalFileName = req.file.originalname || 'payroll_import.xlsx';

    const hasErrors = preview.summary.invalidRows > 0 || preview.summary.duplicateRows > 0;
    const batchStatus = hasErrors ? 'Validation Failed' : 'Ready for Confirmation';

    const bYear = preview.summary.year || new Date().getFullYear();
    const bMonth = preview.summary.month || (new Date().getMonth() + 1);
    const batchNumber = `BATCH-${bYear}-${String(bMonth).padStart(2, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    let errorSummary = null;
    if (hasErrors) {
      const errorRows = preview.rows.filter((r) => r.errors && r.errors.length > 0);
      errorSummary = JSON.stringify(
        errorRows.slice(0, 20).map((r) => ({
          row: r.rowNumber,
          employeeId: r.employee_id,
          errors: r.errors,
        }))
      );
    }

    // Persist batch into payroll_batches table
    const batchInsert = await pool.query(
      `INSERT INTO public.payroll_batches (
        batch_number, month, year, status,
        total_records, valid_records, invalid_records, processed_records,
        payslips_generated, payslips_failed,
        total_gross_salary, total_deductions, total_net_salary,
        file_name, error_summary, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING id, batch_number, status, created_at`,
      [
        batchNumber,
        bMonth,
        bYear,
        batchStatus,
        preview.summary.totalRows,
        preview.summary.validRows,
        preview.summary.invalidRows,
        preview.summary.totalGrossSalary,
        preview.summary.totalDeductions,
        preview.summary.totalNetSalary,
        originalFileName,
        errorSummary,
        adminUserId || null,
      ]
    );

    const insertedBatch = batchInsert.rows[0];

    // Associate batch with the active import session
    const session = excelPayrollService.getImportSession(preview.importId);
    if (session) {
      session.batchId = insertedBatch.id;
      session.batchNumber = insertedBatch.batch_number;
      session.fileName = originalFileName;
    }

    recordAuditLog({
      action: 'PAYROLL_EXCEL_PREVIEW',
      entityType: 'PAYROLL',
      metadata: {
        batchId: insertedBatch.id,
        batchNumber: insertedBatch.batch_number,
        totalRows: preview.summary.totalRows,
        validRows: preview.summary.validRows,
        invalidRows: preview.summary.invalidRows,
        existingPayrollRows: preview.summary.existingPayrollRows,
        duplicateRows: preview.summary.duplicateRows,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: hasErrors
        ? `Excel file validated with ${preview.summary.invalidRows} invalid record(s).`
        : 'Excel file validated successfully. Ready for confirmation.',
      data: {
        ...preview,
        batchId: insertedBatch.id,
        batchNumber: insertedBatch.batch_number,
        batchStatus: insertedBatch.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/payroll/import/confirm
 * Commits a validated Excel import session into public.payroll_records inside an atomic transaction,
 * and automatically generates private PDF payslips for all processed records.
 */
const confirmPayrollImport = async (req, res, next) => {
  const { importId, importMode = 'CREATE_ONLY' } = req.body;
  const adminUserId = req.user?.id;

  if (!importId || typeof importId !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'importId is required.',
    });
  }

  const normalizedMode = String(importMode).toUpperCase().trim();
  if (normalizedMode !== 'CREATE_ONLY' && normalizedMode !== 'UPDATE_EXISTING') {
    return res.status(400).json({
      success: false,
      message: "Invalid importMode. Allowed values are 'CREATE_ONLY' or 'UPDATE_EXISTING'.",
    });
  }

  const session = excelPayrollService.getImportSession(importId);
  if (!session) {
    return res.status(400).json({
      success: false,
      message: 'Import session expired or invalid. Please upload and validate the Excel file again.',
    });
  }

  // Enforce zero validation errors in batch
  if (session.summary.invalidRows > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot import payroll batch: file contains ${session.summary.invalidRows} invalid record(s). All rows must be valid.`,
    });
  }

  // Enforce zero internal duplicates
  if (session.summary.duplicateRows > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot import payroll batch: file contains duplicate records for the same employee and period.`,
    });
  }

  // In CREATE_ONLY mode, reject if records already exist
  if (normalizedMode === 'CREATE_ONLY' && session.summary.existingPayrollRows > 0) {
    return res.status(409).json({
      success: false,
      message: `Cannot import in 'Create Only' mode: payroll already exists for ${session.summary.existingPayrollRows} employee(s). Please choose 'Update Existing' mode to update existing records.`,
    });
  }

  const batchId = session.batchId || null;
  const batchNumber = session.batchNumber || null;

  // Mark batch as Processing
  if (batchId) {
    await pool.query(
      "UPDATE public.payroll_batches SET status = 'Processing', updated_at = NOW() WHERE id = $1",
      [batchId]
    ).catch(() => {});
  }

  const client = await pool.connect();
  const processedRecords = [];
  let createdCount = 0;
  let updatedCount = 0;

  try {
    await client.query('BEGIN');

    for (const row of session.rows) {
      if (row.existsInDb && normalizedMode === 'UPDATE_EXISTING') {
        const updateSql = `
          UPDATE public.payroll_records
          SET
            batch_id = $1,
            working_days = $2,
            payable_days = $3,
            basic_salary = $4,
            hra = $5,
            allowances = $6,
            gross_salary = $7,
            pf_employee = $8,
            professional_tax = $9,
            other_deductions = $10,
            total_deductions = $11,
            net_salary = $12,
            status = 'Processed',
            processed_by = $13,
            processed_at = NOW(),
            updated_at = NOW()
          WHERE employee_id = $14 AND month = $15 AND year = $16
          RETURNING *;
        `;
        const resUp = await client.query(updateSql, [
          batchId,
          row.working_days,
          row.payable_days,
          row.basic_salary,
          row.hra,
          row.allowances,
          row.gross_salary,
          row.pf_employee,
          row.professional_tax,
          row.other_deductions,
          row.total_deductions,
          row.net_salary,
          adminUserId,
          row.employee_id,
          row.month,
          row.year,
        ]);
        processedRecords.push(resUp.rows[0]);
        updatedCount++;
      } else {
        const insertSql = `
          INSERT INTO public.payroll_records (
            batch_id,
            employee_id,
            month,
            year,
            working_days,
            payable_days,
            basic_salary,
            hra,
            allowances,
            gross_salary,
            pf_employee,
            professional_tax,
            other_deductions,
            total_deductions,
            net_salary,
            status,
            processed_by,
            processed_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Processed', $16, NOW(), NOW())
          ON CONFLICT (employee_id, month, year)
          DO UPDATE SET
            batch_id = EXCLUDED.batch_id,
            working_days = EXCLUDED.working_days,
            payable_days = EXCLUDED.payable_days,
            basic_salary = EXCLUDED.basic_salary,
            hra = EXCLUDED.hra,
            allowances = EXCLUDED.allowances,
            gross_salary = EXCLUDED.gross_salary,
            pf_employee = EXCLUDED.pf_employee,
            professional_tax = EXCLUDED.professional_tax,
            other_deductions = EXCLUDED.other_deductions,
            total_deductions = EXCLUDED.total_deductions,
            net_salary = EXCLUDED.net_salary,
            status = 'Processed',
            processed_by = EXCLUDED.processed_by,
            processed_at = NOW(),
            updated_at = NOW()
          RETURNING *;
        `;
        const resIn = await client.query(insertSql, [
          batchId,
          row.employee_id,
          row.month,
          row.year,
          row.working_days,
          row.payable_days,
          row.basic_salary,
          row.hra,
          row.allowances,
          row.gross_salary,
          row.pf_employee,
          row.professional_tax,
          row.other_deductions,
          row.total_deductions,
          row.net_salary,
          adminUserId,
        ]);
        processedRecords.push(resIn.rows[0]);
        createdCount++;
      }
    }

    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    if (batchId) {
      await pool.query(
        "UPDATE public.payroll_batches SET status = 'Failed', error_summary = $1, updated_at = NOW() WHERE id = $2",
        [txError.message, batchId]
      ).catch(() => {});
    }
    return next(txError);
  } finally {
    client.release();
  }

  // Automatic Payslip Generation for all processed records (Idempotent and isolated per employee)
  let payslipsGenerated = 0;
  let payslipsFailed = 0;
  let alreadyGeneratedCount = 0;

  for (const record of processedRecords) {
    try {
      const existingDocRes = await pool.query(
        `SELECT id, storage_key FROM public.documents
         WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3 LIMIT 1`,
        [record.employee_id, record.month, record.year]
      );

      let existingDoc = existingDocRes.rows[0];
      let shouldGenerate = true;

      if (existingDoc) {
        const isPresent = await storageService.fileExists(existingDoc.storage_key).catch(() => false);
        if (isPresent && normalizedMode !== 'UPDATE_EXISTING') {
          shouldGenerate = false;
          alreadyGeneratedCount++;
        }
      }

      if (shouldGenerate) {
        const empRes = await pool.query(
          `SELECT * FROM public.employees WHERE employee_id = $1`,
          [record.employee_id]
        );
        const pfRes = await pool.query(
          `SELECT uan_number, pf_number FROM public.pf_details WHERE employee_id = $1`,
          [record.employee_id]
        );
        const employee = empRes.rows[0];
        const pfDetails = pfRes.rows[0] || null;

        if (employee) {
          const pdfBuffer = await generatePayslipPdf({ employee, payroll: record, pfDetails });
          const monthName = getMonthName(record.month);
          const originalFileName = `Payslip_${record.employee_id}_${monthName}_${record.year}.pdf`;

          let storageKey = existingDoc?.storage_key;
          if (!storageKey) {
            storageKey = storageService.generateStorageKey({
              employeeId: record.employee_id,
              originalFilename: originalFileName,
              prefix: 'documents',
            });
          }

          await storageService.saveFile(pdfBuffer, storageKey);

          if (!existingDoc) {
            await pool.query(
              `INSERT INTO public.documents (
                 employee_id, document_type, file_name, storage_key, month, year, uploaded_by
               ) VALUES ($1, 'Payslip', $2, $3, $4, $5, $6)
               ON CONFLICT (employee_id, month, year) WHERE LOWER(document_type) = 'payslip'
               DO UPDATE SET storage_key = EXCLUDED.storage_key, file_name = EXCLUDED.file_name, updated_at = NOW()`,
              [record.employee_id, originalFileName, storageKey, record.month, record.year, adminUserId]
            );
          } else {
            await pool.query(
              `UPDATE public.documents SET storage_key = $1, file_name = $2, updated_at = NOW() WHERE id = $3`,
              [storageKey, originalFileName, existingDoc.id]
            );
          }
          payslipsGenerated++;
        } else {
          payslipsFailed++;
        }
      }
    } catch (slipErr) {
      console.error(`Automatic payslip generation error for ${record.employee_id}:`, slipErr.message);
      payslipsFailed++;
    }
  }

  // Determine final batch status
  let finalBatchStatus = 'Completed';
  if (payslipsFailed > 0) {
    finalBatchStatus = (payslipsGenerated > 0 || alreadyGeneratedCount > 0) ? 'Partially Completed' : 'Failed';
  }

  // Update batch record
  if (batchId) {
    await pool.query(
      `UPDATE public.payroll_batches
       SET status = $1, processed_records = $2, payslips_generated = $3, payslips_failed = $4, updated_at = NOW()
       WHERE id = $5`,
      [finalBatchStatus, processedRecords.length, payslipsGenerated, payslipsFailed, batchId]
    ).catch(() => {});
  }

  // Remove import session once successfully imported
  excelPayrollService.deleteImportSession(importId);

  // Record audit logs
  recordAuditLog({
    action: 'PAYROLL_EXCEL_IMPORT',
    entityType: 'PAYROLL',
    metadata: {
      batchId,
      batchNumber,
      totalRows: session.rows.length,
      createdCount,
      updatedCount,
      importMode: normalizedMode,
      status: finalBatchStatus,
    },
    req,
  }).catch(() => {});

  recordAuditLog({
    action: 'PAYROLL_BULK_PROCESS',
    entityType: 'PAYROLL',
    metadata: { batchId, count: processedRecords.length },
    req,
  }).catch(() => {});

  recordAuditLog({
    action: 'PAYSLIP_BULK_GENERATE',
    entityType: 'DOCUMENT',
    metadata: {
      batchId,
      generatedCount: payslipsGenerated,
      alreadyGeneratedCount,
      failedCount: payslipsFailed,
    },
    req,
  }).catch(() => {});

  return res.status(200).json({
    success: true,
    message: `Payroll import completed successfully. Processed ${processedRecords.length} records (${createdCount} created, ${updatedCount} updated). ${payslipsGenerated} payslip(s) generated${payslipsFailed > 0 ? `, ${payslipsFailed} failed` : ''}.`,
    data: {
      batchId,
      batchNumber,
      batchStatus: finalBatchStatus,
      totalRows: session.rows.length,
      createdCount,
      updatedCount,
      processedRecords: processedRecords.length,
      payslipsGenerated,
      alreadyGeneratedCount,
      payslipsFailed,
      failedCount: payslipsFailed,
    },
  });
};

/**
 * POST /api/admin/payroll/retry-failed-payslips
 * Retries payslip PDF generation for employees with missing or ungenerated payslip documents
 * without recreating or duplicating payroll database records.
 */
const retryFailedPayslips = async (req, res, next) => {
  try {
    const { month, year, batchId } = req.body;
    const adminUserId = req.user?.id;

    let monthNum = parseMonthNumber(month);
    let yearNum = parseYearNumber(year);

    let batchRecord = null;
    if (batchId) {
      const batchRes = await pool.query('SELECT * FROM public.payroll_batches WHERE id = $1', [batchId]);
      if (batchRes.rows.length > 0) {
        batchRecord = batchRes.rows[0];
        if (!monthNum) monthNum = batchRecord.month;
        if (!yearNum) yearNum = batchRecord.year;
      }
    }

    if (!monthNum || !yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Month and year are required to retry payslip generation.',
      });
    }

    // Query processed payroll records for the period
    const payrollRes = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.department, e.designation, e.status AS employee_status
       FROM public.payroll_records pr
       JOIN public.employees e ON e.employee_id = pr.employee_id
       WHERE pr.month = $1 AND pr.year = $2
       ORDER BY pr.employee_id ASC`,
      [monthNum, yearNum]
    );

    if (payrollRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No payroll records found for ${getMonthName(monthNum)} ${yearNum}.`,
      });
    }

    if (process.env.PAYSLIP_REQUIRE_ASSETS === 'true') {
      const assetStatus = checkAuthorizationAssets();
      if (!assetStatus.isComplete) {
        return res.status(422).json({
          success: false,
          message: 'Cannot retry payslips: Official company signature or office stamp assets are missing or unreadable. Please configure required genuine PNG assets in Backend/assets/company/.',
          error: 'MISSING_AUTHORIZATION_ASSETS',
          missingAssets: assetStatus.missing,
        });
      }
    }

    let retriedGenerated = 0;
    let retriedFailed = 0;
    let alreadyValid = 0;

    for (const record of payrollRes.rows) {
      try {
        const docRes = await pool.query(
          `SELECT id, storage_key, file_name FROM public.documents
           WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3 LIMIT 1`,
          [record.employee_id, monthNum, yearNum]
        );

        let doc = docRes.rows[0];
        let fileExistsOnDisk = false;
        if (doc && doc.storage_key) {
          fileExistsOnDisk = await storageService.fileExists(doc.storage_key).catch(() => false);
        }

        if (doc && fileExistsOnDisk) {
          alreadyValid++;
          continue;
        }

        // Generate missing PDF
        const empRes = await pool.query('SELECT * FROM public.employees WHERE employee_id = $1', [record.employee_id]);
        const pfRes = await pool.query('SELECT uan_number, pf_number FROM public.pf_details WHERE employee_id = $1', [record.employee_id]);
        const employee = empRes.rows[0] || record;
        const pfDetails = pfRes.rows[0] || null;

        const pdfBuffer = await generatePayslipPdf({ employee, payroll: record, pfDetails });
        const monthName = getMonthName(record.month);
        const fileName = `Payslip_${record.employee_id}_${monthName}_${record.year}.pdf`;

        let storageKey = doc?.storage_key;
        if (!storageKey) {
          storageKey = storageService.generateStorageKey({
            employeeId: record.employee_id,
            originalFilename: fileName,
            prefix: 'documents',
          });
        }

        await storageService.saveFile(pdfBuffer, storageKey);

        if (doc) {
          await pool.query(
            `UPDATE public.documents SET storage_key = $1, file_name = $2, updated_at = NOW() WHERE id = $3`,
            [storageKey, fileName, doc.id]
          );
        } else {
          await pool.query(
            `INSERT INTO public.documents (
               employee_id, document_type, file_name, storage_key, month, year, uploaded_by
             ) VALUES ($1, 'Payslip', $2, $3, $4, $5, $6)
             ON CONFLICT (employee_id, month, year) WHERE LOWER(document_type) = 'payslip'
             DO UPDATE SET storage_key = EXCLUDED.storage_key, file_name = EXCLUDED.file_name, updated_at = NOW()`,
            [record.employee_id, fileName, storageKey, record.month, record.year, adminUserId]
          );
        }

        retriedGenerated++;
      } catch (retryErr) {
        console.error(`Retry payslip error for ${record.employee_id}:`, retryErr.message);
        retriedFailed++;
      }
    }

    // Update batch record if found
    const batchTarget = batchRecord?.id
      ? batchRecord
      : (await pool.query(
          'SELECT * FROM public.payroll_batches WHERE month = $1 AND year = $2 ORDER BY created_at DESC LIMIT 1',
          [monthNum, yearNum]
        )).rows[0];

    if (batchTarget) {
      const newPayslipsGen = (batchTarget.payslips_generated || 0) + retriedGenerated;
      const newPayslipsFailed = Math.max(0, (batchTarget.payslips_failed || 0) - retriedGenerated + retriedFailed);
      const newStatus = newPayslipsFailed === 0 ? 'Completed' : (newPayslipsGen > 0 ? 'Partially Completed' : 'Failed');

      await pool.query(
        `UPDATE public.payroll_batches
         SET payslips_generated = $1, payslips_failed = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [newPayslipsGen, newPayslipsFailed, newStatus, batchTarget.id]
      ).catch(() => {});
    }

    recordAuditLog({
      action: 'PAYSLIPS_RETRY_GENERATED',
      entityType: 'PAYROLL',
      metadata: {
        month: monthNum,
        year: yearNum,
        retriedGenerated,
        retriedFailed,
        alreadyValid,
        total: payrollRes.rows.length,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Retry completed: ${retriedGenerated} payslip(s) generated, ${retriedFailed} failed, ${alreadyValid} were already valid.`,
      data: {
        retriedGenerated,
        retriedFailed,
        alreadyValid,
        totalRecords: payrollRes.rows.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/report
 * Generates and downloads a comprehensive Excel processing / audit report for a payroll period or batch.
 */
const downloadPayrollReport = async (req, res, next) => {
  try {
    const { batchId, month, year } = req.query;

    let monthNum = parseMonthNumber(month);
    let yearNum = parseYearNumber(year);
    let batch = null;

    if (batchId) {
      const bRes = await pool.query('SELECT * FROM public.payroll_batches WHERE id = $1', [batchId]);
      if (bRes.rows.length > 0) {
        batch = bRes.rows[0];
        if (!monthNum) monthNum = batch.month;
        if (!yearNum) yearNum = batch.year;
      }
    }

    if (!batch && monthNum && yearNum) {
      const bRes = await pool.query(
        'SELECT * FROM public.payroll_batches WHERE month = $1 AND year = $2 ORDER BY created_at DESC LIMIT 1',
        [monthNum, yearNum]
      );
      if (bRes.rows.length > 0) {
        batch = bRes.rows[0];
      }
    }

    const now = new Date();
    if (!monthNum) monthNum = now.getMonth() + 1;
    if (!yearNum) yearNum = now.getFullYear();

    const recordsRes = await pool.query(
      `SELECT
         pr.*,
         TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
         e.department,
         d.id AS document_id,
         d.storage_key
       FROM public.payroll_records pr
       JOIN public.employees e ON e.employee_id = pr.employee_id
       LEFT JOIN public.documents d
         ON d.employee_id = pr.employee_id
        AND LOWER(d.document_type) = 'payslip'
        AND d.month = pr.month
        AND d.year = pr.year
       WHERE pr.month = $1 AND pr.year = $2
       ORDER BY pr.employee_id ASC`,
      [monthNum, yearNum]
    );

    const rows = recordsRes.rows.map((r, idx) => ({
      rowNumber: idx + 2,
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      department: r.department,
      month: r.month,
      year: r.year,
      working_days: r.working_days,
      payable_days: r.payable_days,
      basic_salary: Number(r.basic_salary),
      hra: Number(r.hra),
      allowances: Number(r.allowances),
      gross_salary: Number(r.gross_salary),
      pf_employee: Number(r.pf_employee),
      professional_tax: Number(r.professional_tax),
      other_deductions: Number(r.other_deductions),
      total_deductions: Number(r.total_deductions),
      net_salary: Number(r.net_salary),
      status: 'VALID',
      payslip_status: r.document_id ? 'Generated' : 'Failed / Pending',
      errors: r.document_id ? '-' : 'Payslip PDF not generated',
    }));

    const totalGross = rows.reduce((acc, r) => acc + r.gross_salary, 0);
    const totalDeductions = rows.reduce((acc, r) => acc + r.total_deductions, 0);
    const totalNet = rows.reduce((acc, r) => acc + r.net_salary, 0);
    const payslipsGenerated = rows.filter((r) => r.payslip_status === 'Generated').length;
    const payslipsFailed = rows.length - payslipsGenerated;

    const reportData = {
      batchNumber: batch?.batch_number || `REPORT-${yearNum}-${String(monthNum).padStart(2, '0')}`,
      month: monthNum,
      year: yearNum,
      status: batch?.status || (payslipsFailed > 0 ? 'Partially Completed' : 'Completed'),
      adminName: req.user?.email || 'Authorized Administrator',
      summary: {
        totalRecords: rows.length,
        validRecords: rows.length,
        invalidRecords: 0,
        processedRecords: rows.length,
        payslipsGenerated,
        payslipsFailed,
        totalGrossSalary: totalGross,
        totalDeductions,
        totalNetSalary: totalNet,
      },
      rows,
    };

    const workbook = await excelPayrollService.generateProcessingReportWorkbook(reportData);
    const buffer = await workbook.xlsx.writeBuffer();

    const monthName = getMonthName(monthNum);
    const filename = `Payroll_Processing_Report_${monthName}_${yearNum}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);

    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/batches
 * Returns paginated list of payroll batch executions with their workflow statuses.
 */
const getAdminPayrollBatches = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const queryParams = [];

    if (month !== undefined && month !== null && String(month).trim() !== '' && String(month).trim() !== 'All') {
      const m = parseMonthNumber(month);
      if (m) {
        queryParams.push(m);
        conditions.push(`month = $${queryParams.length}`);
      }
    }

    if (year !== undefined && year !== null && String(year).trim() !== '' && String(year).trim() !== 'All') {
      const y = parseYearNumber(year);
      if (y) {
        queryParams.push(y);
        conditions.push(`year = $${queryParams.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM public.payroll_batches ${whereClause}`,
      queryParams
    );
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataParams = [...queryParams, limit, offset];
    const dataRes = await pool.query(
      `SELECT * FROM public.payroll_batches
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.status(200).json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/monthly-payslips
 * Fetches all employees with their payslip status (Uploaded / Pending) for the selected month and year.
 * Strict RBAC: ADMIN and SUPER_ADMIN only.
 * Strips all internal storage keys and filesystem paths.
 */
const getMonthlyPayslips = async (req, res, next) => {
  try {
    const now = new Date();
    const monthNum = parseMonthNumber(req.query.month) || (now.getMonth() + 1);
    const yearNum = parseYearNumber(req.query.year) || now.getFullYear();

    const query = `
      SELECT 
        e.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        COALESCE(e.department, 'General') AS department,
        e.status AS employee_status,
        d.id AS document_id,
        d.file_name,
        d.storage_key,
        d.created_at AS uploaded_at
      FROM public.employees e
      LEFT JOIN public.documents d 
        ON d.employee_id = e.employee_id 
       AND LOWER(d.document_type) = 'payslip' 
       AND d.month = $1 
       AND d.year = $2
      ORDER BY e.employee_id ASC;
    `;

    const result = await pool.query(query, [monthNum, yearNum]);

    // Check actual physical file existence for each document to ensure real status
    const employees = await Promise.all(
      result.rows.map(async (row) => {
        let isUploaded = false;
        if (row.document_id && row.storage_key) {
          try {
            isUploaded = await storageService.fileExists(row.storage_key);
          } catch {
            isUploaded = false;
          }
        }

        return {
          employee_id: row.employee_id,
          name: row.employee_name,
          department: row.department,
          status: isUploaded ? 'Uploaded' : 'Pending',
          document_id: isUploaded ? row.document_id : null,
          file_name: isUploaded ? row.file_name : null,
          uploaded_at: isUploaded ? row.uploaded_at : null,
        };
      })
    );

    const totalEmployees = employees.length;
    const uploadedCount = employees.filter((e) => e.status === 'Uploaded').length;
    const pendingCount = totalEmployees - uploadedCount;

    return res.status(200).json({
      success: true,
      data: {
        month: monthNum,
        month_name: getMonthName(monthNum),
        year: yearNum,
        summary: {
          total_employees: totalEmployees,
          uploaded: uploadedCount,
          pending: pendingCount,
        },
        employees,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/payroll/monthly-payslips/upload
 * Uploads a PDF payslip for an employee for a specific month and year.
 * Strict RBAC: ADMIN and SUPER_ADMIN only.
 */
const uploadMonthlyPayslip = async (req, res, next) => {
  let fileSaved = false;
  let savedStorageKey = null;

  try {
    const { employee_id, month, year } = req.body;
    const adminUserId = req.user?.id;

    if (!employee_id || typeof employee_id !== 'string' || !employee_id.trim()) {
      return res.status(400).json({
        success: false,
        message: 'employee_id is required.',
      });
    }
    const cleanEmpId = employee_id.trim();

    const monthNum = parseMonthNumber(month);
    if (!monthNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing month. Provide a valid month (1-12 or month name).',
      });
    }

    const yearNum = parseYearNumber(year);
    if (!yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing year. Provide a valid 4-digit year (e.g. 2026).',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'A valid PDF file is required under field name "file".',
      });
    }

    // 1. Verify employee existence
    const empCheck = await pool.query(
      'SELECT employee_id, first_name, last_name FROM public.employees WHERE employee_id = $1',
      [cleanEmpId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Employee with ID '${cleanEmpId}' not found.`,
      });
    }

    // 2. Check if a payslip document already exists
    const existingDoc = await pool.query(
      `SELECT id, file_name, storage_key 
       FROM public.documents 
       WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3 
       LIMIT 1`,
      [cleanEmpId, monthNum, yearNum]
    );

    if (existingDoc.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `A payslip already exists for ${cleanEmpId} for ${getMonthName(monthNum)} ${yearNum}. Use the Replace option to update it.`,
      });
    }

    // 3. Save to private storage
    const originalFileName = path.basename(req.file.originalname || `Payslip_${cleanEmpId}_${getMonthName(monthNum)}_${yearNum}.pdf`).replace(/[\r\n\t]/g, '');
    savedStorageKey = storageService.generateStorageKey({
      employeeId: cleanEmpId,
      originalFilename: originalFileName,
      prefix: 'documents',
    });

    await storageService.saveFile(req.file.buffer, savedStorageKey);
    fileSaved = true;

    // 4. Insert metadata into public.documents
    try {
      const insertQuery = `
        INSERT INTO public.documents (
          employee_id,
          document_type,
          file_name,
          storage_key,
          month,
          year,
          uploaded_by
        ) VALUES ($1, 'Payslip', $2, $3, $4, $5, $6)
        RETURNING id, employee_id, document_type, file_name, month, year, created_at;
      `;

      const insertResult = await pool.query(insertQuery, [
        cleanEmpId,
        originalFileName,
        savedStorageKey,
        monthNum,
        yearNum,
        adminUserId,
      ]);

      const inserted = insertResult.rows[0];

      recordAuditLog({
        action: 'PAYSLIP_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: inserted.id,
        metadata: {
          employee_id: cleanEmpId,
          month: monthNum,
          year: yearNum,
          file_name: originalFileName,
        },
        req,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: 'Payslip uploaded successfully.',
        data: {
          document_id: inserted.id,
          employee_id: inserted.employee_id,
          document_type: inserted.document_type,
          file_name: inserted.file_name,
          month: inserted.month,
          year: inserted.year,
          created_at: inserted.created_at,
        },
      });
    } catch (dbErr) {
      if (fileSaved && savedStorageKey) {
        await storageService.deleteFile(savedStorageKey).catch(() => {});
      }
      return next(dbErr);
    }
  } catch (error) {
    if (fileSaved && savedStorageKey) {
      await storageService.deleteFile(savedStorageKey).catch(() => {});
    }
    next(error);
  }
};

/**
 * POST /api/admin/payroll/monthly-payslips/replace
 * (also PUT /api/admin/payroll/monthly-payslips/:employeeId/replace)
 * Safely replaces an existing payslip for an employee for a specific month and year.
 * Strict RBAC: ADMIN and SUPER_ADMIN only.
 * Safe sequence: new file saved -> DB metadata updated -> old file deleted only on success.
 */
const replaceMonthlyPayslip = async (req, res, next) => {
  let newFileSaved = false;
  let newStorageKey = null;

  try {
    const rawEmpId = req.params.employeeId || req.body.employee_id;
    const { month, year } = req.body;
    const adminUserId = req.user?.id;

    if (!rawEmpId || typeof rawEmpId !== 'string' || !rawEmpId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'employee_id is required.',
      });
    }
    const cleanEmpId = rawEmpId.trim();

    const monthNum = parseMonthNumber(month);
    if (!monthNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing month. Provide a valid month (1-12 or month name).',
      });
    }

    const yearNum = parseYearNumber(year);
    if (!yearNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing year. Provide a valid 4-digit year (e.g. 2026).',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'A valid replacement PDF file is required under field name "file".',
      });
    }

    // 1. Verify employee existence
    const empCheck = await pool.query(
      'SELECT employee_id, first_name, last_name FROM public.employees WHERE employee_id = $1',
      [cleanEmpId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Employee with ID '${cleanEmpId}' not found.`,
      });
    }

    // 2. Look up existing payslip document
    const existingDocRes = await pool.query(
      `SELECT id, file_name, storage_key 
       FROM public.documents 
       WHERE employee_id = $1 AND LOWER(document_type) = 'payslip' AND month = $2 AND year = $3 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [cleanEmpId, monthNum, yearNum]
    );

    if (existingDocRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No existing payslip found to replace for ${cleanEmpId} in ${getMonthName(monthNum)} ${yearNum}. Use upload instead.`,
      });
    }

    const existingDoc = existingDocRes.rows[0];
    const oldStorageKey = existingDoc.storage_key;

    // 3. Save new file to private storage with a unique key
    const originalFileName = path.basename(req.file.originalname || `Payslip_${cleanEmpId}_${getMonthName(monthNum)}_${yearNum}.pdf`).replace(/[\r\n\t]/g, '');
    newStorageKey = storageService.generateStorageKey({
      employeeId: cleanEmpId,
      originalFilename: originalFileName,
      prefix: 'documents',
    });

    await storageService.saveFile(req.file.buffer, newStorageKey);
    newFileSaved = true;

    // 4. Update document metadata in PostgreSQL
    try {
      const updateQuery = `
        UPDATE public.documents
        SET 
          storage_key = $1,
          file_name = $2,
          uploaded_by = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING id, employee_id, document_type, file_name, month, year, updated_at;
      `;

      const updateResult = await pool.query(updateQuery, [
        newStorageKey,
        originalFileName,
        adminUserId,
        existingDoc.id,
      ]);

      const updated = updateResult.rows[0];

      // 5. Delete old physical file now that DB update succeeded
      if (oldStorageKey && oldStorageKey !== newStorageKey) {
        await storageService.deleteFile(oldStorageKey).catch((delErr) => {
          console.error('Non-critical: failed to delete old payslip file after replacement:', delErr.message);
        });
      }

      recordAuditLog({
        action: 'PAYSLIP_REPLACED',
        entityType: 'DOCUMENT',
        entityId: updated.id,
        metadata: {
          employee_id: cleanEmpId,
          month: monthNum,
          year: yearNum,
          file_name: originalFileName,
        },
        req,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: 'Payslip replaced successfully.',
        data: {
          document_id: updated.id,
          employee_id: updated.employee_id,
          document_type: updated.document_type,
          file_name: updated.file_name,
          month: updated.month,
          year: updated.year,
          updated_at: updated.updated_at,
        },
      });
    } catch (dbErr) {
      // If DB update fails, remove new file and preserve old file
      if (newFileSaved && newStorageKey) {
        await storageService.deleteFile(newStorageKey).catch(() => {});
      }
      return next(dbErr);
    }
  } catch (error) {
    if (newFileSaved && newStorageKey) {
      await storageService.deleteFile(newStorageKey).catch(() => {});
    }
    next(error);
  }
};

/**
 * GET /api/admin/payroll/authorization-assets-status
 * Inspects presence and readability of company signature and office stamp.
 */
const getAuthorizationAssetsStatus = async (req, res, next) => {
  try {
    const status = checkAuthorizationAssets();
    return res.status(200).json({
      success: true,
      data: {
        isComplete: status.isComplete,
        requireAssetsEnforced: process.env.PAYSLIP_REQUIRE_ASSETS === 'true',
        signature: {
          configuredPath: process.env.COMPANY_SIGNATURE_PATH || 'assets/company/signatory_signature.png',
          resolvedPath: status.signaturePath,
          valid: status.signatureValid,
          sizeBytes: status.signatureSize,
          recommendedFormat: 'PNG with transparent background, approx 300x120px',
        },
        stamp: {
          configuredPath: process.env.COMPANY_STAMP_PATH || 'assets/company/office_stamp.png',
          resolvedPath: status.stampPath,
          valid: status.stampValid,
          sizeBytes: status.stampSize,
          recommendedFormat: 'PNG with transparent background, approx 200x200px',
        },
        missing: status.missing,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/payroll/preview-payslip-pdf
 * Generates and streams a preview payslip PDF with isPreview: true.
 * Allows visual inspection of Indian Rupee symbol (₹), company stamp, and authorized signatory layout.
 */
const previewPayslipPdf = async (req, res, next) => {
  try {
    const { employee_id, month, year } = req.query;

    let employee = null;
    let payroll = null;
    let pfDetails = null;

    if (employee_id) {
      const empRes = await pool.query(
        `SELECT employee_id, first_name, last_name, designation, department, email FROM public.employees WHERE employee_id = $1`,
        [employee_id]
      );
      employee = empRes.rows[0];

      if (month && year) {
        const payRes = await pool.query(
          `SELECT * FROM public.payroll_records WHERE employee_id = $1 AND month = $2 AND year = $3`,
          [employee_id, parseInt(month, 10), parseInt(year, 10)]
        );
        payroll = payRes.rows[0];
      }
    }

    if (!employee) {
      // Look up any active employee from database
      const empRes = await pool.query(
        `SELECT employee_id, first_name, last_name, designation, department, email FROM public.employees WHERE status = 'Active' LIMIT 1`
      );
      employee = empRes.rows[0] || {
        employee_id: 'GP0001N',
        first_name: 'Rajeev',
        last_name: 'Appala',
        designation: 'Associate Software Engineer',
        department: 'IT',
      };
    }

    if (!payroll) {
      // Look up any recent payroll record or create a realistic preview record
      const payRes = await pool.query(
        `SELECT * FROM public.payroll_records WHERE employee_id = $1 ORDER BY year DESC, month DESC LIMIT 1`,
        [employee.employee_id]
      );
      payroll = payRes.rows[0] || {
        employee_id: employee.employee_id,
        month: month ? parseInt(month, 10) : (new Date().getMonth() + 1),
        year: year ? parseInt(year, 10) : new Date().getFullYear(),
        working_days: 26,
        payable_days: 26,
        basic_salary: 25000.00,
        hra: 15000.00,
        allowances: 5000.00,
        gross_salary: 45000.00,
        pf_employee: 1800.00,
        professional_tax: 200.00,
        other_deductions: 500.00,
        total_deductions: 2500.00,
        net_salary: 42500.00,
        status: 'Processed',
      };
    }

    const pfRes = await pool.query(
      `SELECT uan_number, pf_number FROM public.pf_details WHERE employee_id = $1`,
      [employee.employee_id]
    );
    pfDetails = pfRes.rows[0] || { uan_number: '101234567890', pf_number: 'GAINT/PF/001' };

    const pdfBuffer = await generatePayslipPdf({
      employee,
      payroll,
      pfDetails,
      isPreview: true,
      requireAssets: false,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Payslip_Preview.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminPayrollRecords,
  getAdminPayrollHistory,
  getAdminAttendanceSummary,
  getAdminEmployeePayroll,
  getAdminPayrollProfile,
  updateAdminPayrollProfile,
  processAdminPayroll,
  generateAdminPayslip,
  generateAllAdminPayslips,
  downloadPayrollTemplate,
  previewPayrollImport,
  confirmPayrollImport,
  retryFailedPayslips,
  downloadPayrollReport,
  getAdminPayrollBatches,
  getMonthlyPayslips,
  uploadMonthlyPayslip,
  replaceMonthlyPayslip,
  getAuthorizationAssetsStatus,
  previewPayslipPdf,
};
