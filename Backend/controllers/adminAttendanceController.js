const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

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

const VALID_STATUSES = [
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Holiday',
  'Work From Home',
  'Week Off',
  'Not Marked',
];

/**
 * Controller to fetch attendance for all employees on a given date for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Requires a valid ?date=YYYY-MM-DD query parameter (defaults to today's date if omitted).
 * - Uses LEFT JOIN from employees to attendance to show both marked and unmarked employees.
 * - Sourced strictly from active employees in the employees table.
 * - Computes complete daily summary across all active employees for that date.
 * - Default status for Saturdays and Sundays without explicit record is 'Week Off'.
 * - Supports optional case-insensitive search and status filtering.
 * - Read-only: no attendance write operations are exposed.
 */
const getAdminAttendance = async (req, res, next) => {
  try {
    const { date, search, status, employee_id, month, department } = req.query;

    // If month is requested without a specific date, delegate directly to monthly attendance
    if (month && !date) {
      return getMonthlyAttendance(req, res, next);
    }

    // Default to today's date if date is omitted
    let effectiveDate = date;
    if (!effectiveDate) {
      effectiveDate = new Date().toISOString().split('T')[0];
    }

    if (!isValidDateString(effectiveDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Expected a valid calendar date in YYYY-MM-DD format (e.g., 2026-09-30).',
      });
    }

    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedLimit = parseInt(req.query.limit, 10) || 20;
    const limit = Math.min(Math.max(1, requestedLimit), 100);
    const offset = (page - 1) * limit;

    // 1. Calculate overall daily summary for all active workforce on the selected date
    const summaryQuery = `
      SELECT 
        COUNT(e.employee_id)::int AS total_employees,
        COUNT(CASE WHEN a.status = 'Present' THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)::int AS absent,
        COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int AS half_day,
        COUNT(CASE WHEN a.status = 'Leave' THEN 1 END)::int AS leave,
        COUNT(CASE WHEN a.status = 'Holiday' THEN 1 END)::int AS holiday,
        COUNT(CASE WHEN a.status = 'Work From Home' THEN 1 END)::int AS work_from_home,
        COUNT(CASE 
          WHEN a.status = 'Week Off' THEN 1
          WHEN a.id IS NULL AND (
            (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) = 0) OR
            (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) IN (0, 6))
          ) THEN 1
        END)::int AS week_off,
        COUNT(CASE 
          WHEN a.id IS NULL AND NOT (
            (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) = 0) OR
            (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) IN (0, 6))
          ) THEN 1
        END)::int AS not_marked
      FROM employees e
      LEFT JOIN attendance a
        ON a.employee_id = e.employee_id
       AND a.attendance_date = $1::date
      WHERE e.status = 'ACTIVE';
    `;
    const summaryResult = await pool.query(summaryQuery, [effectiveDate]);
    const summaryRow = summaryResult.rows[0] || {};
    const summary = {
      total_employees: parseInt(summaryRow.total_employees, 10) || 0,
      present: parseInt(summaryRow.present, 10) || 0,
      absent: parseInt(summaryRow.absent, 10) || 0,
      half_day: parseInt(summaryRow.half_day, 10) || 0,
      leave: parseInt(summaryRow.leave, 10) || 0,
      holiday: parseInt(summaryRow.holiday, 10) || 0,
      work_from_home: parseInt(summaryRow.work_from_home, 10) || 0,
      week_off: parseInt(summaryRow.week_off, 10) || 0,
      not_marked: parseInt(summaryRow.not_marked, 10) || 0,
    };

    // 2. Build filtered list query
    const queryParams = [effectiveDate];
    const conditions = ["e.status = 'ACTIVE'"];

    // Search filter across employee_id, first_name, last_name, email, department, designation
    if (search && typeof search === 'string' && search.trim() !== '') {
      queryParams.push(`%${search.trim()}%`);
      const searchIdx = queryParams.length;
      conditions.push(`(
        e.employee_id ILIKE $${searchIdx} OR
        e.first_name ILIKE $${searchIdx} OR
        e.last_name ILIKE $${searchIdx} OR
        e.email ILIKE $${searchIdx} OR
        e.department ILIKE $${searchIdx} OR
        e.designation ILIKE $${searchIdx}
      )`);
    }

    // Exact employee_id filter
    if (employee_id && typeof employee_id === 'string' && employee_id.trim() !== '' && employee_id.trim() !== 'All') {
      queryParams.push(employee_id.trim());
      const empIdx = queryParams.length;
      conditions.push(`e.employee_id = $${empIdx}`);
    }

    // Department filter (IT / Non-IT)
    if (department && typeof department === 'string' && department.trim() !== '' && !['all', 'all departments'].includes(department.trim().toLowerCase())) {
      queryParams.push(department.trim());
      const deptIdx = queryParams.length;
      conditions.push(`e.department = $${deptIdx}`);
    }

    // Status filter
    if (status && typeof status === 'string' && status.trim() !== '' && status.trim() !== 'All') {
      const normalizedStatus = status.trim();
      const checkStatus = normalizedStatus.toLowerCase() === 'unmarked' ? 'Not Marked' : normalizedStatus;
      const matched = VALID_STATUSES.find(
        (s) => s.toLowerCase() === checkStatus.toLowerCase()
      );

      if (!matched) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status filter. Allowed values: Present, Absent, Half Day, Leave, Holiday, Work From Home, Week Off, Not Marked, Unmarked.',
        });
      }

      if (matched === 'Week Off') {
        conditions.push(`(
          a.status = 'Week Off' OR (
            a.id IS NULL AND (
              (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) = 0) OR
              (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) IN (0, 6))
            )
          )
        )`);
      } else if (matched === 'Not Marked') {
        conditions.push(`(
          a.id IS NULL AND NOT (
            (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) = 0) OR
            (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) IN (0, 6))
          )
        )`);
      } else {
        queryParams.push(matched);
        const statusIdx = queryParams.length;
        conditions.push(`a.status ILIKE $${statusIdx}`);
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Total filtered count
    const countQuery = `
      SELECT COUNT(e.employee_id) AS total
      FROM employees e
      LEFT JOIN attendance a
        ON a.employee_id = e.employee_id
       AND a.attendance_date = $1::date
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    // Paginated data query
    const dataQueryParams = [...queryParams, limit, offset];
    const limitIdx = dataQueryParams.length - 1;
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT 
        e.employee_id,
        e.first_name,
        e.last_name,
        e.email,
        e.department,
        e.designation,
        COALESCE(e.working_days_per_week, 5)::int AS working_days_per_week,
        a.id AS attendance_id,
        COALESCE(
          a.status,
          CASE 
            WHEN (COALESCE(e.working_days_per_week, 5) = 6 AND EXTRACT(DOW FROM $1::date) = 0) THEN 'Week Off'
            WHEN (COALESCE(e.working_days_per_week, 5) = 5 AND EXTRACT(DOW FROM $1::date) IN (0, 6)) THEN 'Week Off'
            ELSE NULL
          END
        ) AS attendance_status,
        a.remarks,
        a.marked_by,
        a.marked_at,
        a.updated_at
      FROM employees e
      LEFT JOIN attendance a
        ON a.employee_id = e.employee_id
       AND a.attendance_date = $1::date
      ${whereClause}
      ORDER BY e.employee_id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await pool.query(dataQuery, dataQueryParams);
    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      date: effectiveDate,
      data: result.rows,
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

const ALLOWED_MARK_STATUSES = [
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Holiday',
  'Work From Home',
  'Week Off',
];

/**
 * Controller to mark attendance for a single employee on a given date.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Authenticated admin ID is derived strictly from req.user.id.
 * - Validates employee existence in employees table (404 if not found).
 * - Enforces uniqueness (employee_id, attendance_date) (409 on duplicate).
 * - Validates strict YYYY-MM-DD calendar date (400 if invalid).
 * - Validates allowed status values (400 if invalid).
 * - Trims remarks and sets reasonable length limit.
 * - Uses parameterized SQL query.
 */
const markAttendance = async (req, res, next) => {
  try {
    const { employee_id, attendance_date, status, remarks } = req.body;
    const adminUserId = req.user?.id;

    // 1. Required field validations
    if (!employee_id || typeof employee_id !== 'string' || employee_id.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'employee_id is required.',
      });
    }

    if (!attendance_date || typeof attendance_date !== 'string' || attendance_date.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'attendance_date is required in YYYY-MM-DD format.',
      });
    }

    if (!status || typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'status is required.',
      });
    }

    const trimmedEmployeeId = employee_id.trim();
    const trimmedDate = attendance_date.trim();
    const trimmedStatus = status.trim();

    // 2. Date validation (strict calendar date)
    if (!isValidDateString(trimmedDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid attendance_date format. Expected a valid calendar date in YYYY-MM-DD format.',
      });
    }

    // 3. Status validation
    const matchedStatus = ALLOWED_MARK_STATUSES.find(
      (s) => s.toLowerCase() === trimmedStatus.toLowerCase()
    );

    if (!matchedStatus) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${ALLOWED_MARK_STATUSES.join(', ')}.`,
      });
    }

    // 4. Remarks validation (optional, trim, length limit)
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

    // 5. Verify employee existence in employees table
    const empCheckQuery = `
      SELECT employee_id, status 
      FROM employees 
      WHERE employee_id = $1
    `;
    const empCheckResult = await pool.query(empCheckQuery, [trimmedEmployeeId]);

    if (empCheckResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found.',
      });
    }

    // 6. Check for duplicate attendance record
    const dupCheckQuery = `
      SELECT id 
      FROM attendance 
      WHERE employee_id = $1 AND attendance_date = $2::date
    `;
    const dupCheckResult = await pool.query(dupCheckQuery, [trimmedEmployeeId, trimmedDate]);

    if (dupCheckResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Attendance already exists for this employee and date.',
      });
    }

    // Resolve marked_by safely to guarantee foreign key integrity
    let markedBy = null;
    if (adminUserId) {
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [adminUserId]);
      if (userCheck.rows.length > 0) {
        markedBy = userCheck.rows[0].id;
      }
    }

    // 7. Insert attendance record
    const insertQuery = `
      INSERT INTO attendance (
        employee_id,
        attendance_date,
        status,
        remarks,
        marked_by
      ) VALUES ($1, $2::date, $3, $4, $5)
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

    try {
      const insertResult = await pool.query(insertQuery, [
        trimmedEmployeeId,
        trimmedDate,
        matchedStatus,
        sanitizedRemarks,
        markedBy,
      ]);

      recordAuditLog({
        action: 'ATTENDANCE_MARK',
        entityType: 'ATTENDANCE',
        entityId: insertResult.rows[0]?.id,
        metadata: {
          employee_id: trimmedEmployeeId,
          status: matchedStatus,
          attendance_date: trimmedDate,
        },
        req,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: 'Attendance marked successfully.',
        data: insertResult.rows[0],
      });
    } catch (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'Attendance already exists for this employee and date.',
        });
      }
      throw insertError;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to bulk mark Holiday for all active employees on a selected date.
 * Security & Business Rules:
 * - Strictly restricted to ADMIN and SUPER_ADMIN roles.
 * - Authenticated admin ID is derived strictly from req.user.id.
 * - Validates strict YYYY-MM-DD calendar date (400 if invalid).
 * - Sourced strictly from public.employees where status = 'ACTIVE'.
 * - Inactive and suspended employees are NOT affected.
 * - If ALL active employees are already marked 'Holiday', returns idempotent success with 0 changes.
 * - If existing non-Holiday attendance records exist and confirm_overwrite is not true:
 *   returns 409 Conflict with require_confirmation: true and detailed breakdown.
 * - Uses atomic PostgreSQL transaction (BEGIN / COMMIT / ROLLBACK).
 * - Upserts using ON CONFLICT (employee_id, attendance_date) DO UPDATE to respect unique constraint.
 * - Preserves status strictly as 'Holiday'.
 * - Records audit log 'ORGANIZATION_HOLIDAY_MARKED'.
 */
const markHoliday = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { attendance_date, remarks, holiday_name, confirm_overwrite } = req.body;
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
        message: 'Invalid attendance_date format. Expected a valid calendar date in YYYY-MM-DD format (e.g., 2026-10-07).',
      });
    }

    // 3. Sanitize optional remarks / holiday_name
    let sanitizedRemarks = null;
    const rawRemarks = remarks !== undefined && remarks !== null ? remarks : holiday_name;
    if (rawRemarks !== undefined && rawRemarks !== null) {
      if (typeof rawRemarks !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'remarks must be a string.',
        });
      }
      const trimmedRemarks = rawRemarks.trim();
      if (trimmedRemarks.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'remarks cannot exceed 500 characters.',
        });
      }
      sanitizedRemarks = trimmedRemarks.length > 0 ? trimmedRemarks : null;
    }
    const finalRemarks = sanitizedRemarks || 'Organization Holiday';

    // 4. Fetch all ACTIVE employees
    const activeEmployeesResult = await client.query(`
      SELECT employee_id
      FROM public.employees
      WHERE status = 'ACTIVE'
      ORDER BY employee_id ASC
    `);

    const activeEmployees = activeEmployeesResult.rows;
    const totalActive = activeEmployees.length;

    if (totalActive === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active employees found in the organization.',
      });
    }

    // 5. Check existing attendance records for active employees on trimmedDate
    const existingRecordsResult = await client.query(`
      SELECT 
        a.status,
        COUNT(*)::int AS count
      FROM public.attendance a
      JOIN public.employees e ON e.employee_id = a.employee_id
      WHERE e.status = 'ACTIVE'
        AND a.attendance_date = $1::date
      GROUP BY a.status;
    `, [trimmedDate]);

    let totalExisting = 0;
    let holidayCount = 0;
    let nonHolidayCount = 0;
    const breakdown = {};

    existingRecordsResult.rows.forEach((row) => {
      const c = parseInt(row.count, 10) || 0;
      totalExisting += c;
      if (row.status === 'Holiday') {
        holidayCount += c;
      } else {
        nonHolidayCount += c;
        breakdown[row.status] = c;
      }
    });

    // 6. Idempotency check: If all active employees are already marked Holiday
    if (totalExisting === totalActive && holidayCount === totalActive) {
      return res.status(200).json({
        success: true,
        already_marked: true,
        message: `${trimmedDate} is already marked as Holiday for all active employees.`,
        data: {
          attendance_date: trimmedDate,
          status: 'Holiday',
          employees_affected: totalActive,
          created: 0,
          updated: 0,
        },
      });
    }

    // 7. Safety check: If non-Holiday records already exist and confirm_overwrite is not true
    if (nonHolidayCount > 0 && !confirm_overwrite) {
      return res.status(409).json({
        success: false,
        require_confirmation: true,
        message: `Attendance already exists for ${nonHolidayCount} employee${nonHolidayCount === 1 ? '' : 's'}. Changing the date to Holiday will replace their current attendance status.`,
        data: {
          attendance_date: trimmedDate,
          status: 'Holiday',
          total_active: totalActive,
          existing_count: nonHolidayCount,
          breakdown,
        },
      });
    }

    // 8. Resolve marked_by safely
    let markedBy = null;
    if (adminUserId) {
      const userCheck = await client.query('SELECT id FROM public.users WHERE id = $1', [adminUserId]);
      if (userCheck.rows.length > 0) {
        markedBy = userCheck.rows[0].id;
      }
    }

    // 9. Execute within an atomic PostgreSQL transaction
    await client.query('BEGIN');

    const createdCount = totalActive - totalExisting;
    const updatedCount = totalExisting;

    const upsertQuery = `
      INSERT INTO public.attendance (
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
        'Holiday',
        $2,
        $3,
        NOW(),
        NOW()
      FROM public.employees e
      WHERE e.status = 'ACTIVE'
      ON CONFLICT (employee_id, attendance_date)
      DO UPDATE SET
        status = 'Holiday',
        remarks = EXCLUDED.remarks,
        marked_by = EXCLUDED.marked_by,
        updated_at = NOW();
    `;

    await client.query(upsertQuery, [
      trimmedDate,
      finalRemarks,
      markedBy,
    ]);

    await client.query('COMMIT');

    // 10. Record immutable audit log
    await recordAuditLog({
      action: 'ORGANIZATION_HOLIDAY_MARKED',
      entityType: 'ATTENDANCE',
      metadata: {
        attendance_date: trimmedDate,
        status: 'Holiday',
        employees_affected: totalActive,
        created: createdCount,
        updated: updatedCount,
        remarks: finalRemarks,
        admin_email: req.user?.email,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Holiday marked successfully for all active employees.',
      data: {
        attendance_date: trimmedDate,
        status: 'Holiday',
        employees_affected: totalActive,
        created: createdCount,
        updated: updatedCount,
      },
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      // ignore rollback error if already aborted
    }
    next(error);
  } finally {
    client.release();
  }
};

const {
  updateAttendance,
  updateAdminAttendance,
  markAllPresent,
  getMonthlyAttendance,
  getAdminMonthlyAttendance,
} = require('./attendanceController');

module.exports = {
  getAdminAttendance,
  markAttendance,
  markHoliday,
  updateAttendance,
  updateAdminAttendance: updateAttendance,
  markAllPresent,
  getMonthlyAttendance,
  getAdminMonthlyAttendance,
};
