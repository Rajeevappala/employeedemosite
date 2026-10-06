const pool = require('../config/database');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Validates and parses month (1-12 or month name)
 */
function parseMonthNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  if (typeof val === 'string') {
    const idx = MONTH_NAMES.map(m => m.toLowerCase()).indexOf(val.trim().toLowerCase());
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
 * GET /api/employee/dashboard
 * Aggregated dashboard metrics for the currently authenticated employee.
 *
 * Security:
 * - Restricted strictly to authenticated EMPLOYEE accounts.
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Client parameters cannot spoof or query other employees' records.
 * - Storage keys, filesystem paths, and secrets are never returned.
 */
const getEmployeeDashboard = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

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

    // Determine current/effective date
    const now = new Date();
    let effectiveDate = date;
    if (effectiveDate) {
      if (!isValidDateString(effectiveDate)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Expected YYYY-MM-DD.',
        });
      }
    } else {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      effectiveDate = `${y}-${m}-${d}`;
    }

    const selectedYear = yearNum || now.getFullYear();
    const selectedMonth = monthNum || (now.getMonth() + 1);
    const monthStartDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;

    // Concurrently execute all queries for the authenticated employee
    const [
      profileResult,
      todayAttendanceResult,
      monthAttendanceResult,
      recentAttendanceResult,
      leavesResult,
      latestPayslipResult,
      recentDocsResult,
      docCountResult,
      pfResult,
    ] = await Promise.all([
      // 1. Profile
      pool.query(
        `SELECT 
           employee_id,
           first_name,
           last_name,
           email,
           phone,
           date_of_birth,
           gender,
           designation,
           department,
           TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
           status AS employment_status,
           reporting_manager,
           employment_type,
           address,
           city,
           state,
           postal_code
         FROM employees
         WHERE employee_id = $1`,
        [employeeId]
      ),

      // 2. Today's attendance
      pool.query(
        `SELECT 
           id,
           TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
           status,
           remarks
         FROM attendance
         WHERE employee_id = $1 AND attendance_date = $2::date
         LIMIT 1`,
        [employeeId, effectiveDate]
      ),

      // 3. Current month attendance
      pool.query(
        `SELECT 
           id,
           TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
           status,
           remarks
         FROM attendance
         WHERE employee_id = $1
           AND attendance_date >= $2::date
           AND attendance_date < ($2::date + INTERVAL '1 month')
         ORDER BY attendance_date ASC`,
        [employeeId, monthStartDate]
      ),

      // 4. Recent attendance logs (last 5 records)
      pool.query(
        `SELECT 
           id,
           TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
           status,
           remarks
         FROM attendance
         WHERE employee_id = $1
         ORDER BY attendance_date DESC
         LIMIT 5`,
        [employeeId]
      ),

      // 5. Leave requests
      pool.query(
        `SELECT 
           id,
           leave_type,
           TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
           TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
           days,
           reason,
           status,
           admin_comment,
           created_at
         FROM leave_requests
         WHERE employee_id = $1
         ORDER BY created_at DESC`,
        [employeeId]
      ),

      // 6. Latest payslip joined with payroll_records
      pool.query(
        `SELECT 
           d.id,
           d.employee_id,
           d.document_type,
           d.file_name,
           d.month,
           d.year,
           d.created_at,
           pr.working_days,
           pr.payable_days,
           pr.basic_salary,
           pr.hra,
           pr.allowances,
           pr.gross_salary,
           pr.pf_employee,
           pr.professional_tax,
           pr.other_deductions,
           pr.total_deductions,
           pr.net_salary,
           pr.status AS payroll_status
         FROM documents d
         LEFT JOIN payroll_records pr 
           ON pr.employee_id = d.employee_id 
          AND pr.month = d.month 
          AND pr.year = d.year
         WHERE d.employee_id = $1
           AND LOWER(d.document_type) = 'payslip'
         ORDER BY d.year DESC NULLS LAST, d.month DESC NULLS LAST, d.created_at DESC
         LIMIT 1`,
        [employeeId]
      ),

      // 7. Recent documents (last 5 records)
      pool.query(
        `SELECT 
           id,
           document_type,
           file_name,
           month,
           year,
           created_at
         FROM documents
         WHERE employee_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [employeeId]
      ),

      // 8. Total documents count
      pool.query(
        `SELECT COUNT(*) AS total FROM documents WHERE employee_id = $1`,
        [employeeId]
      ),

      // 9. PF Details
      pool.query(
        `SELECT 
           id,
           employee_id,
           uan_number,
           pf_number,
           pension_number,
           created_at,
           updated_at
         FROM pf_details
         WHERE employee_id = $1
         LIMIT 1`,
        [employeeId]
      ),
    ]);

    // Check if employee profile exists
    if (profileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const empProfile = profileResult.rows[0];
    const dept = empProfile.department || '';

    // Query visible announcements and unread count for this employee
    const [latestAnnouncementsRes, unreadAnnouncementsCountRes] = await Promise.all([
      pool.query(`
        SELECT 
          a.id,
          a.title,
          a.content,
          a.priority,
          a.target_type,
          a.publish_at,
          a.created_at,
          (ar.id IS NOT NULL) AS is_read,
          ar.read_at
        FROM public.announcements a
        LEFT JOIN public.announcement_reads ar 
          ON ar.announcement_id = a.id AND ar.employee_id = $1
        WHERE a.status = 'PUBLISHED'
          AND (a.publish_at IS NULL OR a.publish_at <= NOW())
          AND (a.expires_at IS NULL OR a.expires_at >= NOW())
          AND (
            a.target_type = 'ALL' 
            OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($2))
            OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $1)
          )
        ORDER BY 
          CASE a.priority 
            WHEN 'Urgent' THEN 1 
            WHEN 'High' THEN 2 
            ELSE 3 
          END ASC,
          COALESCE(a.publish_at, a.created_at) DESC
        LIMIT 3
      `, [employeeId, dept]),

      pool.query(`
        SELECT COUNT(*) AS unread_total
        FROM public.announcements a
        LEFT JOIN public.announcement_reads ar 
          ON ar.announcement_id = a.id AND ar.employee_id = $1
        WHERE a.status = 'PUBLISHED'
          AND (a.publish_at IS NULL OR a.publish_at <= NOW())
          AND (a.expires_at IS NULL OR a.expires_at >= NOW())
          AND (
            a.target_type = 'ALL' 
            OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($2))
            OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $1)
          )
          AND ar.id IS NULL
      `, [employeeId, dept])
    ]);

    // Compute monthly attendance summary
    const monthRows = monthAttendanceResult.rows;
    const attendanceSummary = {
      month: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
      month_name: MONTH_NAMES[selectedMonth - 1],
      year: selectedYear,
      present: 0,
      absent: 0,
      half_day: 0,
      leave: 0,
      work_from_home: 0,
      holiday: 0,
      working_days: 0,
      total_records: monthRows.length,
    };

    monthRows.forEach((row) => {
      switch (row.status) {
        case 'Present':
          attendanceSummary.present += 1;
          attendanceSummary.working_days += 1;
          break;
        case 'Absent':
          attendanceSummary.absent += 1;
          attendanceSummary.working_days += 1;
          break;
        case 'Half Day':
          attendanceSummary.half_day += 1;
          attendanceSummary.working_days += 1;
          break;
        case 'Leave':
          attendanceSummary.leave += 1;
          attendanceSummary.working_days += 1;
          break;
        case 'Work From Home':
          attendanceSummary.work_from_home += 1;
          attendanceSummary.working_days += 1;
          break;
        case 'Holiday':
          attendanceSummary.holiday += 1;
          break;
        default:
          break;
      }
    });

    // Today's attendance
    let todayAttendance = {
      date: effectiveDate,
      status: 'Not Marked',
      remarks: null,
      marked: false,
    };

    if (todayAttendanceResult.rows.length > 0) {
      const tr = todayAttendanceResult.rows[0];
      todayAttendance = {
        id: tr.id,
        date: tr.date,
        status: tr.status,
        remarks: tr.remarks,
        marked: true,
      };
    }

    // Leave metrics
    const allLeaves = leavesResult.rows;
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let cancelledCount = 0;
    let approvedDays = 0;
    let pendingDays = 0;

    allLeaves.forEach((lv) => {
      const st = (lv.status || '').toLowerCase();
      const numDays = parseFloat(lv.days) || 0;
      if (st === 'pending') {
        pendingCount += 1;
        pendingDays += numDays;
      } else if (st === 'approved') {
        approvedCount += 1;
        approvedDays += numDays;
      } else if (st === 'rejected') {
        rejectedCount += 1;
      } else if (st === 'cancelled') {
        cancelledCount += 1;
      }
    });

    const leaveSummary = {
      pending_count: pendingCount,
      approved_count: approvedCount,
      rejected_count: rejectedCount,
      cancelled_count: cancelledCount,
      approved_days: approvedDays,
      pending_days: pendingDays,
      total_requests: allLeaves.length,
    };

    // Latest payslip
    let latestPayslip = null;
    if (latestPayslipResult.rows.length > 0) {
      const pr = latestPayslipResult.rows[0];
      latestPayslip = {
        id: pr.id,
        file_name: pr.file_name,
        document_type: pr.document_type,
        month: pr.month,
        month_name: pr.month ? MONTH_NAMES[pr.month - 1] : null,
        year: pr.year,
        working_days: pr.working_days,
        payable_days: pr.payable_days,
        gross_salary: pr.gross_salary,
        total_deductions: pr.total_deductions,
        net_salary: pr.net_salary,
        status: pr.payroll_status || 'Processed',
        created_at: pr.created_at,
      };
    }

    // PF Details
    let pfSummary = null;
    if (pfResult.rows.length > 0) {
      const pf = pfResult.rows[0];
      pfSummary = {
        uan_number: pf.uan_number,
        pf_number: pf.pf_number,
        pension_number: pf.pension_number,
      };
    }

    const totalDocs = parseInt(docCountResult.rows[0]?.total || 0, 10);

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          employee_id: empProfile.employee_id,
          first_name: empProfile.first_name,
          last_name: empProfile.last_name,
          full_name: `${empProfile.first_name || ''} ${empProfile.last_name || ''}`.trim(),
          email: empProfile.email,
          phone: empProfile.phone,
          date_of_birth: empProfile.date_of_birth,
          gender: empProfile.gender,
          designation: empProfile.designation,
          department: empProfile.department,
          date_of_joining: empProfile.date_of_joining,
          employment_status: empProfile.employment_status,
          reporting_manager: empProfile.reporting_manager,
          employment_type: empProfile.employment_type,
          address: empProfile.address,
          city: empProfile.city,
          state: empProfile.state,
          postal_code: empProfile.postal_code,
          work_location: empProfile.city ? `${empProfile.city}, ${empProfile.state || 'India'}` : 'Hyderabad',
        },
        counts: {
          document_count: totalDocs,
          pending_leaves: pendingCount,
          approved_leaves: approvedCount,
          total_leaves: allLeaves.length,
          month_present_days: attendanceSummary.present,
          month_working_days: attendanceSummary.working_days,
        },
        today_attendance: todayAttendance,
        attendance_summary: attendanceSummary,
        recent_attendance: recentAttendanceResult.rows,
        leave_summary: leaveSummary,
        recent_leaves: allLeaves.slice(0, 5),
        latest_payslip: latestPayslip,
        recent_documents: recentDocsResult.rows,
        pf_summary: pfSummary,
        latest_announcements: latestAnnouncementsRes.rows,
        unread_announcements_count: parseInt(unreadAnnouncementsCountRes.rows[0]?.unread_total || 0, 10),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeDashboard,
};
