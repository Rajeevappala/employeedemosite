const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { syncApprovedLeaveToAttendance } = require('../services/leaveAttendanceService');
const { recordAuditLog } = require('../services/auditService');

/**
 * Controller to fetch leave requests belonging strictly to the currently authenticated employee.
 * Security:
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Client-supplied URL parameters, query parameters, or request body IDs are completely ignored.
 * - Queries the leave_requests table filtering strictly by employee_id = $1.
 * - Returns HTTP 200 with data: [] if no leave records exist.
 */
const getEmployeeLeaves = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const query = `
      SELECT 
        id,
        employee_id,
        leave_type,
        start_date,
        end_date,
        days,
        days AS number_of_days,
        reason,
        status,
        admin_comment,
        admin_comment AS admin_remarks,
        reviewed_by,
        requested_at,
        reviewed_at,
        created_at,
        updated_at
      FROM leave_requests
      WHERE employee_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [employeeId]);

    return res.status(200).json({
      success: true,
      data: result.rows,
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

const ALLOWED_LEAVE_TYPES = ['PL', 'UPL', 'Sick Leave'];

/**
 * Controller to apply for leave for the currently authenticated employee.
 * Security:
 * - Restricted to EMPLOYEE role only.
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Validates employee existence and ACTIVE status in public.employees.
 * - Enforces allowed leave types: PL, UPL, Sick Leave.
 * - Enforces valid dates and prevents start_date > end_date.
 * - Checks for overlapping Pending or Approved leave requests.
 * - Uses a transaction-safe query execution.
 */
const applyLeave = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { leave_type, start_date, end_date, reason } = req.body;

    // 1. Required fields presence check
    if (!leave_type || typeof leave_type !== 'string' || leave_type.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid leave type',
      });
    }

    if (!start_date || typeof start_date !== 'string' || start_date.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'start_date is required in YYYY-MM-DD format.',
      });
    }

    if (!end_date || typeof end_date !== 'string' || end_date.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'end_date is required in YYYY-MM-DD format.',
      });
    }

    const trimmedLeaveType = leave_type.trim();
    const trimmedStartDate = start_date.trim();
    const trimmedEndDate = end_date.trim();

    // 2. Validate leave type
    const matchedLeaveType = ALLOWED_LEAVE_TYPES.find(
      (type) => type.toLowerCase() === trimmedLeaveType.toLowerCase()
    );

    if (!matchedLeaveType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid leave type',
      });
    }

    // 3. Validate date formats and calendar validity
    if (!isValidDateString(trimmedStartDate) || !isValidDateString(trimmedEndDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. start_date and end_date must be valid calendar dates in YYYY-MM-DD format.',
      });
    }

    if (trimmedStartDate > trimmedEndDate) {
      return res.status(400).json({
        success: false,
        message: 'start_date cannot be after end_date.',
      });
    }

    // Policy check against organization_leave_settings
    const requestedDays = Math.round((new Date(trimmedEndDate) - new Date(trimmedStartDate)) / (1000 * 60 * 60 * 24)) + 1;
    const orgSettingsRes = await client.query(
      'SELECT minimum_leave_notice_days, maximum_continuous_leave_days FROM public.organization_leave_settings WHERE is_singleton = TRUE LIMIT 1'
    );
    if (orgSettingsRes.rows.length > 0) {
      const orgPolicy = orgSettingsRes.rows[0];
      const maxContinuous = Number(orgPolicy.maximum_continuous_leave_days);
      const minNotice = Number(orgPolicy.minimum_leave_notice_days);

      if (maxContinuous > 0 && requestedDays > maxContinuous) {
        return res.status(400).json({
          success: false,
          message: `Requested leave exceeds the maximum continuous limit of ${maxContinuous} days.`,
        });
      }

      if (minNotice > 0 && matchedLeaveType !== 'Sick Leave') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startDateObj = new Date(trimmedStartDate);
        startDateObj.setHours(0, 0, 0, 0);
        const noticeDiffDays = Math.round((startDateObj - today) / (1000 * 60 * 60 * 24));
        if (noticeDiffDays < minNotice) {
          return res.status(400).json({
            success: false,
            message: `Leave must be requested at least ${minNotice} day(s) in advance.`,
          });
        }
      }
    }

    // 4. Validate employee exists in public.employees and is ACTIVE
    const employeeCheck = await client.query(
      'SELECT employee_id, status FROM public.employees WHERE employee_id = $1',
      [employeeId]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    if (employeeCheck.rows[0].status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Employee account is inactive',
      });
    }

    // 5. Sanitize reason
    let sanitizedReason = null;
    if (reason !== undefined && reason !== null) {
      if (typeof reason !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'reason must be a string.',
        });
      }
      const trimmedReason = reason.trim();
      if (trimmedReason.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'reason cannot exceed 500 characters.',
        });
      }
      sanitizedReason = trimmedReason.length > 0 ? trimmedReason : null;
    }

    // 6. Transaction to check overlap and insert safely
    await client.query('BEGIN');

    const overlapQuery = `
      SELECT id 
      FROM public.leave_requests
      WHERE employee_id = $1
        AND status IN ('Pending', 'Approved')
        AND start_date <= $3::date
        AND end_date >= $2::date
      LIMIT 1
      FOR UPDATE;
    `;
    const overlapResult = await client.query(overlapQuery, [
      employeeId,
      trimmedStartDate,
      trimmedEndDate,
    ]);

    if (overlapResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'An overlapping leave request already exists',
      });
    }

    const insertQuery = `
      INSERT INTO public.leave_requests (
        employee_id,
        leave_type,
        start_date,
        end_date,
        days,
        reason,
        status,
        requested_at,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3::date,
        $4::date,
        ($4::date - $3::date + 1),
        $5,
        'Pending',
        NOW(),
        NOW(),
        NOW()
      )
      RETURNING
        id,
        employee_id,
        leave_type,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
        reason,
        status,
        created_at;
    `;

    const insertResult = await client.query(insertQuery, [
      employeeId,
      matchedLeaveType,
      trimmedStartDate,
      trimmedEndDate,
      sanitizedReason,
    ]);

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: insertResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const ALLOWED_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

/**
 * Helper to get the number of days in a month (handles leap years).
 */
function getDaysInMonth(year, month) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonth[month - 1];
}

/**
 * Controller to fetch all leave requests for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Supports optional filters: status, leave_type, employee_id, search, month.
 * - Supports pagination: page, limit.
 * - Orders by created_at DESC.
 */
const getAdminLeaves = async (req, res, next) => {
  try {
    const { status, leave_type, employee_id, search, month, page: pageQuery, limit: limitQuery } = req.query;

    // 1. Pagination validation
    let page = 1;
    if (pageQuery !== undefined) {
      const parsedPage = parseInt(pageQuery, 10);
      if (isNaN(parsedPage) || parsedPage < 1 || String(parsedPage) !== String(pageQuery).trim()) {
        return res.status(400).json({
          success: false,
          message: 'page must be a positive integer.',
        });
      }
      page = parsedPage;
    }

    let limit = 20;
    if (limitQuery !== undefined) {
      const parsedLimit = parseInt(limitQuery, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100 || String(parsedLimit) !== String(limitQuery).trim()) {
        return res.status(400).json({
          success: false,
          message: 'limit must be an integer between 1 and 100.',
        });
      }
      limit = parsedLimit;
    }

    const offset = (page - 1) * limit;

    // 2. Build SQL conditions and parameters
    const conditions = [];
    const queryParams = [];

    // Filter: status
    // Filter: status
    if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== 'All') {
      const trimmedStatus = String(status).trim();
      const matchedStatus = ALLOWED_STATUSES.find(
        (s) => s.toLowerCase() === trimmedStatus.toLowerCase()
      );
      if (!matchedStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}.`,
        });
      }
      queryParams.push(matchedStatus);
      conditions.push(`lr.status = $${queryParams.length}`);
    }

    // Filter: leave_type
    if (leave_type !== undefined && leave_type !== null && String(leave_type).trim() !== '' && String(leave_type).trim() !== 'All') {
      const trimmedType = String(leave_type).trim();
      const matchedType = ALLOWED_LEAVE_TYPES.find(
        (t) => t.toLowerCase() === trimmedType.toLowerCase()
      );
      if (!matchedType) {
        return res.status(400).json({
          success: false,
          message: `Invalid leave_type. Allowed values: ${ALLOWED_LEAVE_TYPES.join(', ')}.`,
        });
      }
      queryParams.push(matchedType);
      conditions.push(`lr.leave_type = $${queryParams.length}`);
    }

    // Filter: employee_id
    if (employee_id !== undefined && employee_id !== null && String(employee_id).trim() !== '' && String(employee_id).trim() !== 'All') {
      const trimmedEmpId = String(employee_id).trim();
      queryParams.push(trimmedEmpId);
      conditions.push(`lr.employee_id = $${queryParams.length}`);
    }

    // Filter: department
    const department = req.query.department;
    if (department !== undefined && department !== null && String(department).trim() !== '' && String(department).trim() !== 'All' && String(department).trim() !== 'All Departments') {
      const trimmedDept = String(department).trim();
      queryParams.push(trimmedDept);
      conditions.push(`e.department ILIKE $${queryParams.length}`);
    }

    // Filter: search (employee_id, first_name, last_name, email)
    if (search !== undefined && search !== null && String(search).trim() !== '') {
      const trimmedSearch = String(search).trim();
      queryParams.push(`%${trimmedSearch}%`);
      const searchIdx = queryParams.length;
      conditions.push(`(
        lr.employee_id ILIKE $${searchIdx} OR
        e.first_name ILIKE $${searchIdx} OR
        e.last_name ILIKE $${searchIdx} OR
        CONCAT(e.first_name, ' ', e.last_name) ILIKE $${searchIdx} OR
        e.email ILIKE $${searchIdx}
      )`);
    }

    // Filter: month (YYYY-MM)
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      const trimmedMonth = String(month).trim();
      const monthRegex = /^(\d{4})-(0[1-9]|1[0-2])$/;
      const match = trimmedMonth.match(monthRegex);
      if (!match) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-10).',
        });
      }

      const year = parseInt(match[1], 10);
      const monthNum = parseInt(match[2], 10);
      const daysCount = getDaysInMonth(year, monthNum);
      const monthStart = `${trimmedMonth}-01`;
      const monthEnd = `${trimmedMonth}-${String(daysCount).padStart(2, '0')}`;

      queryParams.push(monthEnd);
      const endIdx = queryParams.length;
      queryParams.push(monthStart);
      const startIdx = queryParams.length;

      // Overlap condition: start_date <= month_end AND end_date >= month_start
      conditions.push(`lr.start_date <= $${endIdx}::date AND lr.end_date >= $${startIdx}::date`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 3. Count query
    const countQuery = `
      SELECT COUNT(lr.id) AS total
      FROM public.leave_requests lr
      JOIN public.employees e ON e.employee_id = lr.employee_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    // 4. Data query
    const dataQueryParams = [...queryParams, limit, offset];
    const limitIdx = dataQueryParams.length - 1;
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT 
        lr.id,
        lr.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.email,
        e.department,
        lr.leave_type,
        TO_CHAR(lr.start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(lr.end_date, 'YYYY-MM-DD') AS end_date,
        lr.days,
        lr.reason,
        lr.status,
        lr.admin_comment,
        lr.reviewed_by,
        lr.reviewed_at,
        TO_CHAR(lr.created_at, 'YYYY-MM-DD') AS requested_on,
        lr.created_at,
        lr.updated_at
      FROM public.leave_requests lr
      JOIN public.employees e ON e.employee_id = lr.employee_id
      ${whereClause}
      ORDER BY lr.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const dataResult = await pool.query(dataQuery, dataQueryParams);
    const totalPages = Math.ceil(total / limit) || 1;

    // Overall summary metrics across all leave requests
    const summaryQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE lr.status = 'Pending') AS pending,
        COUNT(*) FILTER (WHERE lr.status = 'Approved') AS approved,
        COUNT(*) FILTER (WHERE lr.status = 'Rejected') AS rejected,
        COUNT(*) AS total
      FROM public.leave_requests lr
    `;
    const summaryResult = await pool.query(summaryQuery);
    const summary = {
      pending: parseInt(summaryResult.rows[0]?.pending, 10) || 0,
      approved: parseInt(summaryResult.rows[0]?.approved, 10) || 0,
      rejected: parseInt(summaryResult.rows[0]?.rejected, 10) || 0,
      total: parseInt(summaryResult.rows[0]?.total, 10) || 0,
    };

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
      summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to export leave requests as a professionally formatted Excel (.xlsx) workbook.
 * Security:
 * - Restricted strictly to ADMIN and SUPER_ADMIN roles.
 * - Respects active filter parameters (status, leave_type, employee_id, department, search, month).
 * - Generates a real Excel workbook using ExcelJS with auto-filters, bold frozen header, and formatted cells.
 */
const exportAdminLeavesReport = async (req, res, next) => {
  try {
    const { status, leave_type, employee_id, search, month } = req.query;

    const conditions = [];
    const queryParams = [];

    // Filter: status
    if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== 'All') {
      const trimmedStatus = String(status).trim();
      const matchedStatus = ALLOWED_STATUSES.find(
        (s) => s.toLowerCase() === trimmedStatus.toLowerCase()
      );
      if (!matchedStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}.`,
        });
      }
      queryParams.push(matchedStatus);
      conditions.push(`lr.status = $${queryParams.length}`);
    }

    // Filter: leave_type
    if (leave_type !== undefined && leave_type !== null && String(leave_type).trim() !== '' && String(leave_type).trim() !== 'All') {
      const trimmedType = String(leave_type).trim();
      const matchedType = ALLOWED_LEAVE_TYPES.find(
        (t) => t.toLowerCase() === trimmedType.toLowerCase()
      );
      if (!matchedType) {
        return res.status(400).json({
          success: false,
          message: `Invalid leave_type. Allowed values: ${ALLOWED_LEAVE_TYPES.join(', ')}.`,
        });
      }
      queryParams.push(matchedType);
      conditions.push(`lr.leave_type = $${queryParams.length}`);
    }

    // Filter: employee_id
    if (employee_id !== undefined && employee_id !== null && String(employee_id).trim() !== '' && String(employee_id).trim() !== 'All') {
      const trimmedEmpId = String(employee_id).trim();
      queryParams.push(trimmedEmpId);
      conditions.push(`lr.employee_id = $${queryParams.length}`);
    }

    // Filter: department
    const department = req.query.department;
    if (department !== undefined && department !== null && String(department).trim() !== '' && String(department).trim() !== 'All' && String(department).trim() !== 'All Departments') {
      const trimmedDept = String(department).trim();
      queryParams.push(trimmedDept);
      conditions.push(`e.department ILIKE $${queryParams.length}`);
    }

    // Filter: search (employee_id, first_name, last_name, email)
    if (search !== undefined && search !== null && String(search).trim() !== '') {
      const trimmedSearch = String(search).trim();
      queryParams.push(`%${trimmedSearch}%`);
      const searchIdx = queryParams.length;
      conditions.push(`(
        lr.employee_id ILIKE $${searchIdx} OR
        e.first_name ILIKE $${searchIdx} OR
        e.last_name ILIKE $${searchIdx} OR
        CONCAT(e.first_name, ' ', e.last_name) ILIKE $${searchIdx} OR
        e.email ILIKE $${searchIdx}
      )`);
    }

    // Filter: month (YYYY-MM)
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      const trimmedMonth = String(month).trim();
      const monthRegex = /^(\d{4})-(0[1-9]|1[0-2])$/;
      const match = trimmedMonth.match(monthRegex);
      if (!match) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-10).',
        });
      }

      const year = parseInt(match[1], 10);
      const monthNum = parseInt(match[2], 10);
      const daysCount = getDaysInMonth(year, monthNum);
      const monthStart = `${trimmedMonth}-01`;
      const monthEnd = `${trimmedMonth}-${String(daysCount).padStart(2, '0')}`;

      queryParams.push(monthEnd);
      const endIdx = queryParams.length;
      queryParams.push(monthStart);
      const startIdx = queryParams.length;

      conditions.push(`lr.start_date <= $${endIdx}::date AND lr.end_date >= $${startIdx}::date`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const exportQuery = `
      SELECT 
        lr.id,
        lr.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.email,
        e.department,
        e.designation,
        lr.leave_type,
        TO_CHAR(lr.start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(lr.end_date, 'YYYY-MM-DD') AS end_date,
        lr.days,
        lr.reason,
        lr.status,
        lr.admin_comment,
        lr.reviewed_by,
        COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, '') AS reviewed_by_name,
        TO_CHAR(lr.reviewed_at, 'YYYY-MM-DD HH24:MI:SS') AS reviewed_at,
        TO_CHAR(COALESCE(lr.requested_at, lr.created_at), 'YYYY-MM-DD HH24:MI:SS') AS applied_at,
        lr.created_at
      FROM public.leave_requests lr
      JOIN public.employees e ON e.employee_id = lr.employee_id
      LEFT JOIN public.users u ON u.id = lr.reviewed_by
      ${whereClause}
      ORDER BY lr.created_at DESC
    `;

    const result = await pool.query(exportQuery, queryParams);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GaintPro Software Technologies';
    workbook.lastModifiedBy = 'GaintPro HRM Portal';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Leave Report', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 16 },
      { header: 'Employee Name', key: 'employee_name', width: 24 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Department', key: 'department', width: 16 },
      { header: 'Designation', key: 'designation', width: 22 },
      { header: 'Leave Type', key: 'leave_type', width: 15 },
      { header: 'Start Date', key: 'start_date', width: 14 },
      { header: 'End Date', key: 'end_date', width: 14 },
      { header: 'Total Days', key: 'total_days', width: 13 },
      { header: 'Reason', key: 'reason', width: 32 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Admin Comment', key: 'admin_comment', width: 32 },
      { header: 'Reviewed By', key: 'reviewed_by', width: 24 },
      { header: 'Reviewed At', key: 'reviewed_at', width: 22 },
      { header: 'Applied At', key: 'applied_at', width: 22 },
    ];

    // Format Header Row
    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Enable Filters on Header Row
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 15 },
    };

    if (result.rows.length === 0) {
      const emptyRow = sheet.addRow({
        employee_id: 'No leave records found for the selected filters.',
      });
      sheet.mergeCells(`A${emptyRow.number}:O${emptyRow.number}`);
      const emptyCell = sheet.getCell(`A${emptyRow.number}`);
      emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      emptyCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF64748B' } };
      emptyRow.height = 24;
    } else {
      result.rows.forEach((row) => {
        const addedRow = sheet.addRow({
          employee_id: row.employee_id || '',
          employee_name: row.employee_name || '',
          email: row.email || '',
          department: row.department || '',
          designation: row.designation || '',
          leave_type: row.leave_type || '',
          start_date: row.start_date || '',
          end_date: row.end_date || '',
          total_days: Number(row.days || 0),
          reason: row.reason || '',
          status: row.status || '',
          admin_comment: row.admin_comment || '',
          reviewed_by: row.reviewed_by_name || '',
          reviewed_at: row.reviewed_at || '',
          applied_at: row.applied_at || '',
        });

        addedRow.getCell('reason').alignment = { wrapText: true, vertical: 'top' };
        addedRow.getCell('admin_comment').alignment = { wrapText: true, vertical: 'top' };
        addedRow.getCell('total_days').alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell('status').alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell('start_date').alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell('end_date').alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const todayStr = new Date().toISOString().substring(0, 10);
    const filename = `leave_report_${todayStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller to retrieve single leave request details for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Sourced strictly from public.leave_requests joined with public.employees.
 */
const getAdminLeaveById = async (req, res, next) => {
  try {
    const { leaveId } = req.params;
    if (!leaveId || !UUID_REGEX.test(leaveId)) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
      });
    }

    const query = `
      SELECT 
        lr.id,
        lr.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.email,
        e.department,
        lr.leave_type,
        TO_CHAR(lr.start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(lr.end_date, 'YYYY-MM-DD') AS end_date,
        lr.days,
        lr.reason,
        lr.status,
        lr.admin_comment,
        lr.reviewed_by,
        lr.reviewed_at,
        TO_CHAR(lr.created_at, 'YYYY-MM-DD') AS requested_on,
        lr.created_at,
        lr.updated_at
      FROM public.leave_requests lr
      JOIN public.employees e ON e.employee_id = lr.employee_id
      WHERE lr.id = $1
    `;
    const result = await pool.query(query, [leaveId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
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
 * Controller to retrieve employee leave balances dynamically aggregated from real records.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Sourced strictly from public.employees, public.leave_balances, and public.leave_requests.
 */
const getAdminLeaveBalances = async (req, res, next) => {
  try {
    const query = `
      SELECT 
        e.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.department,
        COALESCE(lb.paid_leave_balance, 0)::numeric AS pl_total,
        COALESCE(SUM(CASE WHEN lr.status = 'Approved' AND (lr.leave_type = 'PL' OR lr.leave_type ILIKE 'paid%') THEN lr.days ELSE 0 END), 0)::numeric AS pl_used,
        COALESCE(lb.sick_leave_balance, 0)::numeric AS sick_total,
        COALESCE(SUM(CASE WHEN lr.status = 'Approved' AND (lr.leave_type = 'Sick Leave' OR lr.leave_type ILIKE 'sick%') THEN lr.days ELSE 0 END), 0)::numeric AS sick_used,
        COALESCE(SUM(CASE WHEN lr.status = 'Approved' AND (lr.leave_type = 'UPL' OR lr.leave_type ILIKE 'unpaid%') THEN lr.days ELSE 0 END), 0)::numeric AS upl_used
      FROM public.employees e
      LEFT JOIN public.leave_balances lb ON lb.employee_id = e.employee_id
      LEFT JOIN public.leave_requests lr ON lr.employee_id = e.employee_id
      WHERE e.status = 'ACTIVE'
      GROUP BY e.employee_id, e.first_name, e.last_name, e.department, lb.paid_leave_balance, lb.sick_leave_balance
      ORDER BY e.employee_id ASC;
    `;
    const result = await pool.query(query);
    const data = result.rows.map((row) => {
      const plTotal = parseFloat(row.pl_total) || 0;
      const plUsed = parseFloat(row.pl_used) || 0;
      const sickTotal = parseFloat(row.sick_total) || 0;
      const sickUsed = parseFloat(row.sick_used) || 0;
      const uplUsed = parseFloat(row.upl_used) || 0;
      return {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        department: row.department,
        pl_total: plTotal,
        pl_used: plUsed,
        pl_remaining: Math.max(0, plTotal - plUsed),
        sick_total: sickTotal,
        sick_used: sickUsed,
        sick_remaining: Math.max(0, sickTotal - sickUsed),
        upl_used: uplUsed,
      };
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to approve or reject a leave request for administrators.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Authenticated admin ID is derived strictly from req.user.id.
 * - Sourced strictly from public.leave_requests table using database columns.
 * - Prevents transitions from non-Pending states (Approved, Rejected, Cancelled).
 * - Enforces overlapping approved leave prevention.
 * - Executes in a transaction with row-level locking (FOR UPDATE).
 */
const updateLeaveStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { leaveId } = req.params;
    const { status } = req.body;
    const admin_remarks =
      req.body.admin_remarks !== undefined
        ? req.body.admin_remarks
        : req.body.admin_comment !== undefined
        ? req.body.admin_comment
        : req.body.reason;
    const adminUserId = req.user?.id;

    // 1. Validate leaveId UUID format
    if (!leaveId || !UUID_REGEX.test(leaveId)) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
      });
    }

    // 2. Validate target status
    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed values are Approved or Rejected.',
      });
    }

    const trimmedStatus = status.trim();
    if (trimmedStatus !== 'Approved' && trimmedStatus !== 'Rejected') {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed values are Approved or Rejected.',
      });
    }

    // 3. Sanitize optional remarks (uses existing admin_comment column)
    let sanitizedRemarks = null;
    if (admin_remarks !== undefined && admin_remarks !== null) {
      if (typeof admin_remarks !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'admin_remarks must be a string.',
        });
      }
      const trimmedRemarks = admin_remarks.trim();
      if (trimmedRemarks.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'admin_remarks cannot exceed 500 characters.',
        });
      }
      sanitizedRemarks = trimmedRemarks.length > 0 ? trimmedRemarks : null;
    }

    // 4. Resolve reviewer ID safely from users table
    let reviewerId = null;
    if (adminUserId) {
      const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [adminUserId]);
      if (userCheck.rows.length > 0) {
        reviewerId = userCheck.rows[0].id;
      }
    }

    // 5. Begin transaction
    await client.query('BEGIN');

    // Retrieve the leave request with lock
    const leaveQuery = `
      SELECT 
        id,
        employee_id,
        leave_type,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
        status,
        admin_comment
      FROM public.leave_requests
      WHERE id = $1
      FOR UPDATE;
    `;
    const leaveResult = await client.query(leaveQuery, [leaveId]);

    if (leaveResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
      });
    }

    const currentLeave = leaveResult.rows[0];

    // Check current status
    if (currentLeave.status === 'Approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Leave request is already approved',
      });
    }

    if (currentLeave.status === 'Rejected') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Leave request is already rejected',
      });
    }

    if (currentLeave.status === 'Cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Cancelled leave request cannot be updated',
      });
    }

    if (currentLeave.status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Leave request in '${currentLeave.status}' status cannot be updated`,
      });
    }

    // 6. If target is Approved, check for overlapping approved leaves for the same employee
    if (trimmedStatus === 'Approved') {
      const overlapQuery = `
        SELECT id
        FROM public.leave_requests
        WHERE employee_id = $1
          AND status = 'Approved'
          AND id != $2
          AND start_date <= $4::date
          AND end_date >= $3::date
        LIMIT 1;
      `;
      const overlapResult = await client.query(overlapQuery, [
        currentLeave.employee_id,
        leaveId,
        currentLeave.start_date,
        currentLeave.end_date,
      ]);

      if (overlapResult.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Employee already has an overlapping approved leave',
        });
      }
    }

    // 7. Update using existing schema columns: status, reviewed_by, reviewed_at, admin_comment, updated_at
    const finalRemarks = sanitizedRemarks !== null ? sanitizedRemarks : currentLeave.admin_comment;

    const updateQuery = `
      UPDATE public.leave_requests
      SET
        status = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        admin_comment = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING
        id,
        employee_id,
        leave_type,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
        status,
        reviewed_by,
        reviewed_at,
        admin_comment;
    `;

    const updateResult = await client.query(updateQuery, [
      trimmedStatus,
      reviewerId,
      finalRemarks,
      leaveId,
    ]);

    const updatedRow = updateResult.rows[0];
    const isApproved = trimmedStatus === 'Approved';

    // Synchronize approved leave dates into attendance table without overwriting existing attendance
    let attendanceSyncedCount = 0;
    if (isApproved) {
      attendanceSyncedCount = await syncApprovedLeaveToAttendance(
        {
          employee_id: updatedRow.employee_id,
          start_date: updatedRow.start_date,
          end_date: updatedRow.end_date,
          approved_by: reviewerId,
        },
        client
      );
    }

    await client.query('COMMIT');

    // Audit log leave decision
    recordAuditLog({
      action: isApproved ? 'LEAVE_APPROVE' : 'LEAVE_REJECT',
      entityType: 'LEAVE',
      entityId: updatedRow.id,
      metadata: {
        employee_id: updatedRow.employee_id,
        leave_type: updatedRow.leave_type,
        status: updatedRow.status,
      },
      req,
    }).catch(() => {});

    const responseData = {
      id: updatedRow.id,
      employee_id: updatedRow.employee_id,
      leave_type: updatedRow.leave_type,
      start_date: updatedRow.start_date,
      end_date: updatedRow.end_date,
      status: updatedRow.status,
      approved_by: updatedRow.reviewed_by,
      approved_at: updatedRow.reviewed_at,
    };

    if (isApproved) {
      responseData.attendance_synced_count = attendanceSyncedCount;
    }

    return res.status(200).json({
      success: true,
      message: isApproved
        ? 'Leave request approved successfully'
        : 'Leave request rejected successfully',
      data: responseData,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Controller to cancel a pending leave request for the authenticated employee.
 * Security:
 * - Restricted to EMPLOYEE role only.
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Queries strictly by id = $1 AND employee_id = $2 to guarantee ownership.
 * - Allows cancellation only when current status is 'Pending'.
 * - Enforces specific 409 error messages for Approved, Rejected, and Cancelled states.
 */
const cancelLeaveRequest = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { leaveId } = req.params;

    // Validate UUID format
    if (!leaveId || !UUID_REGEX.test(leaveId)) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
      });
    }

    // Retrieve the leave request for this specific employee
    const query = `
      SELECT 
        id,
        employee_id,
        leave_type,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
        status
      FROM public.leave_requests
      WHERE id = $1 AND employee_id = $2;
    `;
    const result = await pool.query(query, [leaveId, employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found',
      });
    }

    const currentLeave = result.rows[0];

    // Status transition validation
    if (currentLeave.status === 'Approved') {
      return res.status(409).json({
        success: false,
        message: 'Approved leave cannot be cancelled through this action',
      });
    }

    if (currentLeave.status === 'Rejected') {
      return res.status(409).json({
        success: false,
        message: 'Rejected leave cannot be cancelled',
      });
    }

    if (currentLeave.status === 'Cancelled') {
      return res.status(409).json({
        success: false,
        message: 'Leave request is already cancelled',
      });
    }

    if (currentLeave.status !== 'Pending') {
      return res.status(409).json({
        success: false,
        message: `Leave request in '${currentLeave.status}' status cannot be cancelled`,
      });
    }

    // Update status to 'Cancelled'
    const updateQuery = `
      UPDATE public.leave_requests
      SET 
        status = 'Cancelled',
        updated_at = NOW()
      WHERE id = $1 AND employee_id = $2
      RETURNING
        id,
        employee_id,
        leave_type,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
        status;
    `;

    const updateResult = await pool.query(updateQuery, [leaveId, employeeId]);
    const updatedRecord = updateResult.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Leave request cancelled successfully',
      data: {
        id: updatedRecord.id,
        employee_id: updatedRecord.employee_id,
        leave_type: updatedRecord.leave_type,
        start_date: updatedRecord.start_date,
        end_date: updatedRecord.end_date,
        status: updatedRecord.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeLeaves,
  applyLeave,
  getAdminLeaves,
  getAdminLeaveById,
  getAdminLeaveBalances,
  updateLeaveStatus,
  cancelLeaveRequest,
  exportAdminLeavesReport,
};

