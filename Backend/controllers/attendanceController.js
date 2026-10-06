const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

/**
 * Controller to fetch attendance records for the currently authenticated employee.
 * Security:
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Client-supplied URL parameters, query parameters, or request body IDs are completely ignored.
 * - Supports optional ?month=YYYY-MM query filter (validates with 400 on format mismatch).
 * - Read-only: no modification or creation endpoints are exposed to employees.
 */
const getEmployeeAttendance = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { month } = req.query;

    let query;
    let queryParams;

    if (month) {
      // Validate YYYY-MM format
      const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
      if (typeof month !== 'string' || !monthRegex.test(month)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-09).',
        });
      }

      const startDate = `${month}-01`;
      query = `
        SELECT 
          id,
          employee_id,
          TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
          TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
          status,
          remarks,
          marked_by,
          marked_at,
          updated_at
        FROM attendance
        WHERE employee_id = $1
          AND attendance_date >= $2::date
          AND attendance_date < ($2::date + INTERVAL '1 month')
        ORDER BY attendance_date ASC
      `;
      queryParams = [employeeId, startDate];

      // Fetch employee's configured working schedule (defaults to 5 days)
      const empSchedule = await pool.query(
        'SELECT COALESCE(working_days_per_week, 5)::int AS working_days_per_week FROM public.employees WHERE employee_id = $1',
        [employeeId]
      );
      const workingDaysPerWeek = empSchedule.rows[0]?.working_days_per_week || 5;

      const result = await pool.query(query, queryParams);
      const physicalMap = new Map();
      result.rows.forEach((row) => physicalMap.set(row.date, row));

      const [yearStr, monthNumStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(monthNumStr, 10);
      const daysInMonth = new Date(year, monthNum, 0).getDate();

      const monthRecords = [];
      const summary = {
        working_days: 0,
        present: 0,
        absent: 0,
        paid_leave: 0,
        unpaid_leave: 0,
        work_from_home: 0,
        half_day: 0,
        holidays: 0,
        week_off: 0,
        not_marked: 0,
        total_records: result.rows.length,
      };

      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = String(d).padStart(2, '0');
        const dateStr = `${month}-${dayStr}`;
        const dObj = new Date(`${dateStr}T00:00:00Z`);
        const dayOfWeek = dObj.getUTCDay(); // 0 = Sun, 6 = Sat
        const isWeekOff = workingDaysPerWeek === 6 ? dayOfWeek === 0 : (dayOfWeek === 0 || dayOfWeek === 6);

        const existing = physicalMap.get(dateStr);
        let finalRecord;

        if (existing) {
          finalRecord = existing;
        } else if (isWeekOff) {
          finalRecord = {
            id: null,
            employee_id: employeeId,
            attendance_date: dateStr,
            date: dateStr,
            status: 'Week Off',
            remarks: 'Weekly Off',
            marked_by: null,
            marked_at: null,
            updated_at: null,
            is_derived: true,
          };
        } else {
          finalRecord = {
            id: null,
            employee_id: employeeId,
            attendance_date: dateStr,
            date: dateStr,
            status: 'Not Marked',
            remarks: null,
            marked_by: null,
            marked_at: null,
            updated_at: null,
            is_derived: true,
          };
        }

        monthRecords.push(finalRecord);

        switch (finalRecord.status) {
          case 'Present':
            summary.present += 1;
            summary.working_days += 1;
            break;
          case 'Absent':
            summary.absent += 1;
            summary.working_days += 1;
            break;
          case 'Half Day':
            summary.half_day += 1;
            summary.working_days += 1;
            break;
          case 'Leave':
            summary.paid_leave += 1;
            summary.working_days += 1;
            break;
          case 'Work From Home':
            summary.work_from_home += 1;
            summary.working_days += 1;
            break;
          case 'Holiday':
            summary.holidays += 1;
            break;
          case 'Week Off':
            summary.week_off += 1;
            break;
          default:
            summary.not_marked += 1;
            if (!isWeekOff) {
              summary.working_days += 1;
            }
            break;
        }
      }

      return res.status(200).json({
        success: true,
        data: monthRecords,
        summary,
      });
    } else {
      query = `
        SELECT 
          id,
          employee_id,
          TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
          TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
          status,
          remarks,
          marked_by,
          marked_at,
          updated_at
        FROM attendance
        WHERE employee_id = $1
        ORDER BY attendance_date DESC
      `;
      queryParams = [employeeId];

      const result = await pool.query(query, queryParams);

      const summary = {
        working_days: 0,
        present: 0,
        absent: 0,
        paid_leave: 0,
        unpaid_leave: 0,
        work_from_home: 0,
        half_day: 0,
        holidays: 0,
        week_off: 0,
        not_marked: 0,
        total_records: result.rows.length,
      };

      result.rows.forEach((row) => {
        switch (row.status) {
          case 'Present':
            summary.present += 1;
            summary.working_days += 1;
            break;
          case 'Absent':
            summary.absent += 1;
            summary.working_days += 1;
            break;
          case 'Half Day':
            summary.half_day += 1;
            summary.working_days += 1;
            break;
          case 'Leave':
            summary.paid_leave += 1;
            summary.working_days += 1;
            break;
          case 'Work From Home':
            summary.work_from_home += 1;
            summary.working_days += 1;
            break;
          case 'Holiday':
            summary.holidays += 1;
            break;
          case 'Week Off':
            summary.week_off += 1;
            break;
          default:
            summary.not_marked += 1;
            break;
        }
      });

      return res.status(200).json({
        success: true,
        data: result.rows,
        summary,
      });
    }
  } catch (error) {
    next(error);
  }
};

const ALLOWED_UPDATE_STATUSES = [
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Holiday',
  'Work From Home',
  'Week Off',
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller to update an existing attendance record for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Sourced strictly from PostgreSQL attendance table.
 * - Allows updating only status, remarks, marked_by, and updated_at.
 * - Does not allow modifying employee_id or attendance_date.
 * - marked_by is derived strictly from req.user.id.
 */
const updateAttendance = async (req, res, next) => {
  try {
    const { attendanceId } = req.params;
    const { status, remarks } = req.body;
    const adminUserId = req.user?.id;

    // Validate attendanceId UUID format
    if (!attendanceId || !UUID_REGEX.test(attendanceId)) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    // Validate status
    if (!status || typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid attendance status',
      });
    }

    const trimmedStatus = status.trim();
    const matchedStatus = ALLOWED_UPDATE_STATUSES.find(
      (s) => s.toLowerCase() === trimmedStatus.toLowerCase()
    );

    if (!matchedStatus) {
      return res.status(400).json({
        success: false,
        message: 'Invalid attendance status',
      });
    }

    // Remarks handling
    let sanitizedRemarks = null;
    if (remarks !== undefined && remarks !== null) {
      if (typeof remarks !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'remarks must be a string.',
        });
      }
      const trimmedRemarks = remarks.trim();
      if (trimmedRemarks.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'remarks cannot exceed 500 characters.',
        });
      }
      sanitizedRemarks = trimmedRemarks.length > 0 ? trimmedRemarks : null;
    }

    // Resolve marked_by safely to guarantee foreign key integrity
    let markedBy = null;
    if (adminUserId) {
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [adminUserId]);
      if (userCheck.rows.length > 0) {
        markedBy = userCheck.rows[0].id;
      }
    }

    // Update only status, remarks, marked_by, updated_at
    const updateQuery = `
      UPDATE public.attendance
      SET 
        status = $1,
        remarks = $2,
        marked_by = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING 
        id,
        employee_id,
        TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
        status,
        remarks,
        marked_by,
        marked_at,
        updated_at
    `;

    const result = await pool.query(updateQuery, [
      matchedStatus,
      sanitizedRemarks,
      markedBy,
      attendanceId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    recordAuditLog({
      action: 'ATTENDANCE_UPDATE',
      entityType: 'ATTENDANCE',
      entityId: attendanceId,
      metadata: {
        employee_id: result.rows[0].employee_id,
        status: matchedStatus,
        date: result.rows[0].attendance_date,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Attendance updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Validates a strict YYYY-MM-DD calendar date string.
 * Ensures the date is a valid calendar date (handles month bounds and leap years).
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
 * Controller to mark all unmarked active employees as present for a given date.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Authenticated admin ID is derived strictly from req.user.id.
 * - Sourced strictly from public.employees where status = 'ACTIVE'.
 * - Does NOT overwrite or alter existing attendance records.
 * - Parameterized atomic SQL query.
 */
const markAllPresent = async (req, res, next) => {
  try {
    const { attendance_date } = req.body;
    const adminUserId = req.user?.id;

    // 1. Validate attendance_date presence
    if (!attendance_date || typeof attendance_date !== 'string' || attendance_date.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'attendance_date is required in YYYY-MM-DD format.',
      });
    }

    const trimmedDate = attendance_date.trim();

    // 2. Validate calendar date format
    if (!isValidDateString(trimmedDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid attendance_date format. Expected a valid calendar date in YYYY-MM-DD format (e.g., 2026-09-30).',
      });
    }

    // Weekend safety check: Saturday or Sunday requires explicit confirmation
    const targetDate = new Date(`${trimmedDate}T00:00:00Z`);
    const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday, 6 = Saturday

    if (dayOfWeek === 0) {
      // Sunday is a rest day for ALL employees (both 5-day and 6-day schedules)
      if (!req.body.confirm_weekend && !req.body.allow_weekend) {
        return res.status(400).json({
          success: false,
          message: 'Today is a weekend (Saturday/Sunday). Confirmation is required to mark all employees as Present on a rest day.',
          require_confirmation: true,
        });
      }
    } else if (dayOfWeek === 6) {
      // Saturday is a rest day for 5-day employees, but a regular working day for 6-day employees
      const satWorkingEmployees = await pool.query(`
        SELECT 1
        FROM public.employees e
        WHERE e.status = 'ACTIVE'
          AND COALESCE(e.working_days_per_week, 5) = 6
          AND NOT EXISTS (
            SELECT 1 FROM public.attendance a
            WHERE a.employee_id = e.employee_id
              AND a.attendance_date = $1::date
          )
        LIMIT 1
      `, [trimmedDate]);

      // If there are no 6-day employees unmarked, everyone unmarked is on a rest day
      if (satWorkingEmployees.rows.length === 0 && !req.body.confirm_weekend && !req.body.allow_weekend) {
        return res.status(400).json({
          success: false,
          message: 'Today is a weekend (Saturday/Sunday). Confirmation is required to mark all employees as Present on a rest day.',
          require_confirmation: true,
        });
      }
    }

    // 3. Resolve marked_by safely
    let markedBy = null;
    if (adminUserId) {
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [adminUserId]);
      if (userCheck.rows.length > 0) {
        markedBy = userCheck.rows[0].id;
      }
    }

    // 4. Atomic INSERT ... SELECT query targeting unmarked ACTIVE employees whose schedule says today is a working day
    const insertQuery = `
      INSERT INTO public.attendance
      (
        employee_id,
        attendance_date,
        status,
        remarks,
        marked_by,
        marked_at,
        updated_at
      )
      SELECT
        e.employee_id,
        $1::date,
        'Present',
        'Marked all present',
        $2,
        NOW(),
        NOW()
      FROM public.employees e
      WHERE e.status = 'ACTIVE'
      AND (
        (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) != 0) OR
        (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) NOT IN (0, 6))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.attendance a
        WHERE a.employee_id = e.employee_id
        AND a.attendance_date = $1::date
      );
    `;

    const result = await pool.query(insertQuery, [trimmedDate, markedBy]);
    const markedCount = result.rowCount || 0;

    if (markedCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'No unmarked employees found',
        data: {
          attendance_date: trimmedDate,
          marked_count: 0,
        },
      });
    }

    recordAuditLog({
      action: 'ATTENDANCE_MARK_ALL_PRESENT',
      entityType: 'ATTENDANCE',
      metadata: {
        attendance_date: trimmedDate,
        marked_count: markedCount,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'All unmarked employees marked as present',
      data: {
        attendance_date: trimmedDate,
        marked_count: markedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to get the number of days in a month (handles leap years).
 */
function getDaysInMonth(year, month) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonth[month - 1];
}

/**
 * Controller to fetch monthly attendance table for all active employees for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Requires ?month=YYYY-MM format.
 * - Sourced strictly from active employees in public.employees.
 * - Generates all calendar dates in month; unmarked days have status: null.
 * - Sourced efficiently without N+1 queries.
 */
const getMonthlyAttendance = async (req, res, next) => {
  try {
    const { month } = req.query;

    // 1. Validate month format (YYYY-MM)
    if (!month || typeof month !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'month query parameter is required in YYYY-MM format (e.g., 2026-09).',
      });
    }

    const trimmedMonth = month.trim();
    const monthRegex = /^(\d{4})-(0[1-9]|1[0-2])$/;
    const match = trimmedMonth.match(monthRegex);

    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month format. Expected YYYY-MM format (e.g., 2026-09).',
      });
    }

    const year = parseInt(match[1], 10);
    const monthNum = parseInt(match[2], 10);

    if (year < 1900 || year > 2100) {
      return res.status(400).json({
        success: false,
        message: 'Invalid year. Year must be between 1900 and 2100.',
      });
    }

    // 2. Generate calendar dates for the month
    const totalDays = getDaysInMonth(year, monthNum);
    const monthDates = [];
    const monthStr = String(monthNum).padStart(2, '0');
    for (let day = 1; day <= totalDays; day++) {
      const dayStr = String(day).padStart(2, '0');
      monthDates.push(`${year}-${monthStr}-${dayStr}`);
    }

    const startDate = `${trimmedMonth}-01`;

    // 3. Efficient batch queries:
    // Query A: All active employees
    const empQueryParams = [];
    let empWhere = "WHERE status = 'ACTIVE'";
    if (req.query.employee_id && String(req.query.employee_id).trim() && String(req.query.employee_id).trim() !== 'All') {
      empQueryParams.push(String(req.query.employee_id).trim());
      empWhere += ` AND employee_id = $${empQueryParams.length}`;
    }

    const employeesResult = await pool.query(`
      SELECT 
        employee_id,
        first_name,
        last_name,
        department,
        designation,
        COALESCE(working_days_per_week, 5)::int AS working_days_per_week
      FROM public.employees
      ${empWhere}
      ORDER BY employee_id ASC;
    `, empQueryParams);

    // Query B: All attendance records for the month belonging to active employees
    const attendanceResult = await pool.query(`
      SELECT 
        a.employee_id,
        TO_CHAR(a.attendance_date, 'YYYY-MM-DD') AS attendance_date,
        a.status
      FROM public.attendance a
      JOIN public.employees e ON e.employee_id = a.employee_id
      WHERE e.status = 'ACTIVE'
        AND a.attendance_date >= $1::date
        AND a.attendance_date < ($1::date + INTERVAL '1 month')
      ORDER BY a.attendance_date ASC;
    `, [startDate]);

    // Build fast lookup map: `${employee_id}_${date}` -> status
    const attendanceMap = new Map();
    attendanceResult.rows.forEach((row) => {
      attendanceMap.set(`${row.employee_id}_${row.attendance_date}`, row.status);
    });

    // 4. Compute per-employee attendance and overall summary
    const overall_summary = {
      total_employees: employeesResult.rows.length,
      present: 0,
      absent: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      work_from_home: 0,
      week_off: 0,
      not_marked: 0,
    };

    const employees = employeesResult.rows.map((emp) => {
      const employeeName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.employee_id;
      const empWorkingDays = emp.working_days_per_week === 6 ? 6 : 5;

      const summary = {
        present: 0,
        absent: 0,
        half_day: 0,
        leave: 0,
        holiday: 0,
        work_from_home: 0,
        week_off: 0,
        not_marked: 0,
      };

      const attendance = monthDates.map((date) => {
        const status = attendanceMap.get(`${emp.employee_id}_${date}`) || null;
        let effectiveStatus = status;
        const dObj = new Date(`${date}T00:00:00Z`);
        const dayOfWeek = dObj.getUTCDay(); // 0 = Sun, 6 = Sat
        const isWeekOff = empWorkingDays === 6 ? dayOfWeek === 0 : (dayOfWeek === 0 || dayOfWeek === 6);

        if (!status && isWeekOff) {
          effectiveStatus = 'Week Off';
        }

        switch (effectiveStatus) {
          case 'Present':
            summary.present++;
            overall_summary.present++;
            break;
          case 'Absent':
            summary.absent++;
            overall_summary.absent++;
            break;
          case 'Half Day':
            summary.half_day++;
            overall_summary.half_day++;
            break;
          case 'Leave':
            summary.leave++;
            overall_summary.leave++;
            break;
          case 'Holiday':
            summary.holiday++;
            overall_summary.holiday++;
            break;
          case 'Work From Home':
            summary.work_from_home++;
            overall_summary.work_from_home++;
            break;
          case 'Week Off':
            summary.week_off++;
            overall_summary.week_off++;
            break;
          default:
            summary.not_marked++;
            overall_summary.not_marked++;
            break;
        }

        return {
          date,
          status: effectiveStatus,
        };
      });

      return {
        employee_id: emp.employee_id,
        employee_name: employeeName,
        attendance,
        summary,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        month: trimmedMonth,
        employees,
        overall_summary,
      },
      overall_summary,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeAttendance,
  updateAttendance,
  updateAdminAttendance: updateAttendance,
  markAllPresent,
  getMonthlyAttendance,
  getAdminMonthlyAttendance: getMonthlyAttendance,
};
