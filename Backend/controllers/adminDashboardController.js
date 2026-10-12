const pool = require('../config/database');
const birthdayService = require('../services/birthdayService');

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

/**
 * Validates and parses month (1-12 or month name)
 */
function parseMonthNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  if (typeof val === 'string') {
    const idx = MONTH_NAMES.indexOf(val.trim().toLowerCase());
    if (idx !== -1) return idx + 1;
  }
  return false; // Explicitly invalid
}

/**
 * Validates and parses 4-digit calendar year
 */
function parseYearNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2000 && num <= 2100) return num;
  return false; // Explicitly invalid
}

/**
 * Validates YYYY-MM-DD calendar date string
 */
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

  if (day < 1 || day > daysInMonth[month - 1]) return false;
  return true;
}

/**
 * GET /api/admin/dashboard
 * Central aggregated metrics endpoint for administrators.
 * Security:
 * - Restricted strictly to ADMIN and SUPER_ADMIN roles via middleware.
 * - Sourced strictly from PostgreSQL tables; no mock data.
 * - Concurrently executes aggregate queries for fast response.
 * - Sanitized responses with zero sensitive tokens, keys, passwords, or filesystem paths.
 */
const getAdminDashboard = async (req, res, next) => {
  try {
    const { month, year, date } = req.query;

    // Validate month if provided
    let monthNum = null;
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      monthNum = parseMonthNumber(month);
      if (monthNum === false) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month parameter. Must be a number between 1 and 12, or a valid month name.',
        });
      }
    }

    // Validate year if provided
    let yearNum = null;
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      yearNum = parseYearNumber(year);
      if (yearNum === false) {
        return res.status(400).json({
          success: false,
          message: 'Invalid year parameter. Must be a 4-digit calendar year between 2000 and 2100.',
        });
      }
    }

    // Validate date if provided
    let effectiveDate = date;
    if (effectiveDate) {
      if (!isValidDateString(effectiveDate)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Expected YYYY-MM-DD.',
        });
      }
    } else {
      effectiveDate = new Date().toISOString().split('T')[0];
    }

    // Default payroll period dynamically to current month/year if not provided
    const now = new Date();
    const payrollMonth = monthNum !== null ? monthNum : (now.getMonth() + 1);
    const payrollYear = yearNum !== null ? yearNum : now.getFullYear();

    // Run aggregate queries concurrently
    const [
      employeeRes,
      attendanceRes,
      leaveRes,
      payrollRes,
      documentRes,
      departmentRes,
      recentLeavesRes,
      recentPayrollRes,
      birthdayData,
    ] = await Promise.all([
      // 1. Employee summary
      pool.query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(CASE WHEN UPPER(status) = 'ACTIVE' THEN 1 END)::int AS active,
          COUNT(CASE WHEN UPPER(status) != 'ACTIVE' OR status IS NULL THEN 1 END)::int AS inactive
        FROM public.employees
      `),

      // 2. Attendance summary for effectiveDate
      pool.query(`
        SELECT 
          COUNT(e.employee_id)::int AS total_workforce,
          COUNT(CASE WHEN a.status = 'Present' THEN 1 END)::int AS present,
          COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)::int AS absent,
          COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int AS half_day,
          COUNT(CASE WHEN a.status = 'Leave' THEN 1 END)::int AS leave,
          COUNT(CASE WHEN a.status = 'Holiday' THEN 1 END)::int AS holiday,
          COUNT(CASE WHEN a.status = 'Work From Home' THEN 1 END)::int AS work_from_home,
          COUNT(CASE WHEN a.id IS NULL THEN 1 END)::int AS not_marked
        FROM public.employees e
        LEFT JOIN public.attendance a
          ON a.employee_id = e.employee_id
         AND a.attendance_date = $1::date
        WHERE UPPER(e.status) = 'ACTIVE'
      `, [effectiveDate]),

      // 3. Leave requests summary
      pool.query(`
        SELECT 
          COUNT(CASE WHEN status = 'Pending' THEN 1 END)::int AS pending,
          COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int AS approved,
          COUNT(CASE WHEN status = 'Rejected' THEN 1 END)::int AS rejected,
          COUNT(CASE WHEN status = 'Cancelled' THEN 1 END)::int AS cancelled,
          COUNT(*)::int AS total
        FROM public.leave_requests
      `),

      // 4. Payroll summary for selected month & year
      pool.query(`
        SELECT 
          COUNT(*)::int AS total_records,
          COUNT(CASE WHEN status = 'Processed' THEN 1 END)::int AS processed,
          COUNT(CASE WHEN status = 'Paid' THEN 1 END)::int AS paid,
          COUNT(CASE WHEN status = 'Pending' THEN 1 END)::int AS pending,
          COALESCE(SUM(gross_salary), 0)::numeric(12,2) AS gross_salary,
          COALESCE(SUM(total_deductions), 0)::numeric(12,2) AS total_deductions,
          COALESCE(SUM(net_salary), 0)::numeric(12,2) AS net_salary
        FROM public.payroll_records
        WHERE month = $1 AND year = $2
      `, [payrollMonth, payrollYear]),

      // 5. Document summary
      pool.query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(CASE WHEN LOWER(document_type) = 'payslip' THEN 1 END)::int AS payslips,
          COUNT(CASE WHEN LOWER(document_type) = 'offer letter' THEN 1 END)::int AS offer_letters,
          COUNT(CASE WHEN LOWER(document_type) NOT IN ('payslip', 'offer letter') THEN 1 END)::int AS other
        FROM public.documents
      `),

      // 6. Department overview
      pool.query(`
        SELECT 
          COALESCE(NULLIF(TRIM(department), ''), 'Not Assigned') AS name,
          COUNT(*)::int AS count
        FROM public.employees
        GROUP BY COALESCE(NULLIF(TRIM(department), ''), 'Not Assigned')
        ORDER BY count DESC, name ASC
      `),

      // 7. Recent leave requests (5 most recent)
      pool.query(`
        SELECT 
          lr.id,
          lr.employee_id,
          TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
          e.department,
          lr.leave_type,
          TO_CHAR(lr.start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(lr.end_date, 'YYYY-MM-DD') AS end_date,
          lr.days,
          lr.status,
          lr.created_at
        FROM public.leave_requests lr
        JOIN public.employees e ON e.employee_id = lr.employee_id
        ORDER BY lr.created_at DESC
        LIMIT 5
      `),

      // 8. Recent payroll activity (5 most recent)
      pool.query(`
        SELECT 
          pr.id,
          pr.employee_id,
          TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
          pr.month,
          pr.year,
          pr.net_salary,
          pr.status,
          COALESCE(pr.processed_at, pr.created_at) AS processed_date
        FROM public.payroll_records pr
        JOIN public.employees e ON e.employee_id = pr.employee_id
        ORDER BY COALESCE(pr.processed_at, pr.created_at) DESC
        LIMIT 5
      `),

      // 9. Active Employee Birthdays this month (Admin view includes employee_id and department)
      birthdayService.getCurrentMonthBirthdays({ forAdmin: true }),
    ]);

    // Format employee stats
    const empRow = employeeRes.rows[0] || {};
    const totalEmployees = parseInt(empRow.total, 10) || 0;
    const employees = {
      total: totalEmployees,
      active: parseInt(empRow.active, 10) || 0,
      inactive: parseInt(empRow.inactive, 10) || 0,
    };

    // Format attendance stats
    const attRow = attendanceRes.rows[0] || {};
    const attendance = {
      date: effectiveDate,
      total_workforce: parseInt(attRow.total_workforce, 10) || 0,
      present: parseInt(attRow.present, 10) || 0,
      absent: parseInt(attRow.absent, 10) || 0,
      half_day: parseInt(attRow.half_day, 10) || 0,
      leave: parseInt(attRow.leave, 10) || 0,
      holiday: parseInt(attRow.holiday, 10) || 0,
      work_from_home: parseInt(attRow.work_from_home, 10) || 0,
      not_marked: parseInt(attRow.not_marked, 10) || 0,
    };

    // Format leave stats
    const leaveRow = leaveRes.rows[0] || {};
    const leaves = {
      pending: parseInt(leaveRow.pending, 10) || 0,
      approved: parseInt(leaveRow.approved, 10) || 0,
      rejected: parseInt(leaveRow.rejected, 10) || 0,
      cancelled: parseInt(leaveRow.cancelled, 10) || 0,
      total: parseInt(leaveRow.total, 10) || 0,
    };

    // Format payroll stats
    const payrollRow = payrollRes.rows[0] || {};
    const payroll = {
      month: payrollMonth,
      year: payrollYear,
      total_records: parseInt(payrollRow.total_records, 10) || 0,
      processed: parseInt(payrollRow.processed, 10) || 0,
      paid: parseInt(payrollRow.paid, 10) || 0,
      pending: parseInt(payrollRow.pending, 10) || 0,
      gross_salary: payrollRow.gross_salary || '0.00',
      total_deductions: payrollRow.total_deductions || '0.00',
      net_salary: payrollRow.net_salary || '0.00',
    };

    // Format document stats
    const docRow = documentRes.rows[0] || {};
    const documents = {
      total: parseInt(docRow.total, 10) || 0,
      payslips: parseInt(docRow.payslips, 10) || 0,
      offer_letters: parseInt(docRow.offer_letters, 10) || 0,
      other: parseInt(docRow.other, 10) || 0,
    };

    // Format department breakdown with percentage
    const deptPalette = ['#2563eb', '#0891b2', '#059669', '#7c3aed', '#ea580c', '#64748b', '#d97706'];
    const departments = departmentRes.rows.map((row, idx) => {
      const count = parseInt(row.count, 10) || 0;
      const percentage = totalEmployees > 0
        ? Math.round((count / totalEmployees) * 1000) / 10
        : 0;
      return {
        name: row.name,
        count,
        percentage,
        color: deptPalette[idx % deptPalette.length],
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        date: effectiveDate,
        employees,
        attendance,
        leaves,
        payroll,
        documents,
        departments,
        recent_leaves: recentLeavesRes.rows,
        recent_payroll: recentPayrollRes.rows,
        birthday_employees: birthdayData.birthdays,
        birthday_month_name: birthdayData.current_month_name,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminDashboard,
};
