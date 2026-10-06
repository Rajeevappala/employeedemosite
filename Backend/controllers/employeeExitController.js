const pool = require('../config/database');
const storageService = require('../services/storageService');
const { recordAuditLog } = require('../services/auditService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * POST /api/employee/exit/apply
 * Applies for employee resignation.
 */
const applyResignation = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const employeeId = req.user?.employee_id;
    const userId = req.user?.id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile associated with this account.',
      });
    }

    // Verify employee & user are currently ACTIVE
    const userCheck = await client.query(
      `SELECT u.status AS user_status, e.status AS employee_status
       FROM public.users u
       JOIN public.employees e ON e.employee_id = u.employee_id
       WHERE u.employee_id = $1`,
      [employeeId]
    );

    const account = userCheck.rows[0];
    if (!account || account.user_status !== 'ACTIVE' || account.employee_status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Only active employees can submit a resignation request.',
      });
    }

    const { requested_relieving_date, reason } = req.body;

    // Validation
    if (!requested_relieving_date || !isValidDateString(String(requested_relieving_date).trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid requested_relieving_date (YYYY-MM-DD) is required.',
      });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const trimmedDate = String(requested_relieving_date).trim();
    if (trimmedDate < todayStr) {
      return res.status(400).json({
        success: false,
        message: 'Requested relieving date cannot be in the past.',
      });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'A detailed reason of at least 10 characters is required.',
      });
    }

    const trimmedReason = reason.trim();

    await client.query('BEGIN');

    // Check for existing active exit request
    const existingReq = await client.query(
      `SELECT id, status FROM public.exit_requests
       WHERE employee_id = $1 AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED')
       LIMIT 1`,
      [employeeId]
    );

    if (existingReq.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `An active resignation request already exists in '${existingReq.rows[0].status}' status.`,
      });
    }

    // Insert exit request
    const insertRes = await client.query(
      `INSERT INTO public.exit_requests (employee_id, requested_relieving_date, reason, status)
       VALUES ($1, $2, $3, 'SUBMITTED')
       RETURNING id, employee_id, resignation_date, requested_relieving_date, status, reason, created_at`,
      [employeeId, trimmedDate, trimmedReason]
    );

    const exitRequest = insertRes.rows[0];

    // Create 4 standard clearance records
    const departments = ['IT', 'FINANCE', 'HR', 'DEPARTMENT_HEAD'];
    for (const dept of departments) {
      await client.query(
        `INSERT INTO public.exit_clearances (exit_request_id, department, status)
         VALUES ($1, $2, 'PENDING')`,
        [exitRequest.id, dept]
      );
    }

    await client.query('COMMIT');

    // Audit log
    recordAuditLog({
      userId,
      action: 'EXIT_REQUEST_SUBMITTED',
      entityType: 'EXIT_REQUEST',
      entityId: exitRequest.id,
      metadata: {
        employee_id: employeeId,
        requested_relieving_date: trimmedDate,
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Resignation request submitted successfully.',
      data: exitRequest,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET /api/employee/exit/status
 * Fetches current exit status, clearance checklist, and settlement for authenticated employee.
 */
const getExitStatus = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile associated with this account.',
      });
    }

    // Look up latest exit request
    const reqResult = await pool.query(
      `SELECT id, employee_id, resignation_date, requested_relieving_date, approved_relieving_date,
              reason, status, admin_remarks, reviewed_at, completed_at, created_at, updated_at
       FROM public.exit_requests
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId]
    );

    const exitRequest = reqResult.rows[0] || null;

    if (!exitRequest) {
      return res.status(200).json({
        success: true,
        data: {
          exitRequest: null,
          clearances: [],
          settlement: null,
        },
      });
    }

    // Fetch clearances
    const clrResult = await pool.query(
      `SELECT c.id, c.department, c.status, c.remarks, c.cleared_at,
              u.email AS cleared_by_email
       FROM public.exit_clearances c
       LEFT JOIN public.users u ON c.cleared_by = u.id
       WHERE c.exit_request_id = $1
       ORDER BY c.department ASC`,
      [exitRequest.id]
    );

    // Fetch settlement if exists (omitting private internal keys)
    let settlement = null;
    if (exitRequest.status === 'COMPLETED' || exitRequest.status === 'APPROVED') {
      const fnfResult = await pool.query(
        `SELECT id, working_days, payable_days, prorated_salary, encashed_leave_days,
                leave_encashment_amount, gratuity_amount, bonus_or_incentive, notice_period_recovery,
                other_deductions, total_earnings, total_deductions, net_payable_amount,
                status, finalized_at, settlement_document_id, relieving_document_id, experience_document_id
         FROM public.fnf_settlements
         WHERE exit_request_id = $1`,
        [exitRequest.id]
      );
      settlement = fnfResult.rows[0] || null;
    }

    return res.status(200).json({
      success: true,
      data: {
        exitRequest,
        clearances: clrResult.rows,
        settlement,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/employee/exit/withdraw
 * Allows employee to withdraw a SUBMITTED or UNDER_REVIEW exit request.
 */
const withdrawResignation = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    const userId = req.user?.id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile associated with this account.',
      });
    }

    // Find active request
    const checkRes = await pool.query(
      `SELECT id, status FROM public.exit_requests
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId]
    );

    const activeReq = checkRes.rows[0];
    if (!activeReq) {
      return res.status(404).json({
        success: false,
        message: 'No exit request found to withdraw.',
      });
    }

    if (activeReq.status !== 'SUBMITTED' && activeReq.status !== 'UNDER_REVIEW') {
      return res.status(400).json({
        success: false,
        message: `Exit request in '${activeReq.status}' status cannot be withdrawn.`,
      });
    }

    // Update status to WITHDRAWN
    const updateRes = await pool.query(
      `UPDATE public.exit_requests
       SET status = 'WITHDRAWN', updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [activeReq.id]
    );

    recordAuditLog({
      userId,
      action: 'EXIT_REQUEST_WITHDRAWN',
      entityType: 'EXIT_REQUEST',
      entityId: activeReq.id,
      metadata: { employee_id: employeeId },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Resignation request has been withdrawn.',
      data: updateRes.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to stream employee-owned exit document safely.
 */
async function streamEmployeeExitDocument(req, res, next, documentType) {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile associated with this account.',
      });
    }

    // Ensure exit request is completed
    const reqRes = await pool.query(
      `SELECT id, status FROM public.exit_requests
       WHERE employee_id = $1 AND status = 'COMPLETED'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [employeeId]
    );

    if (reqRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No finalized exit records found.',
      });
    }

    // Look up document registered in public.documents
    const docRes = await pool.query(
      `SELECT id, file_name, storage_key
       FROM public.documents
       WHERE employee_id = $1 AND document_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId, documentType]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: `${documentType} not found.`,
      });
    }

    const fileBuffer = await storageService.getFile(doc.storage_key);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    return res.send(fileBuffer);
  } catch (error) {
    next(error);
  }
}

const downloadRelievingLetter = (req, res, next) =>
  streamEmployeeExitDocument(req, res, next, 'Relieving Letter');

const downloadExperienceCertificate = (req, res, next) =>
  streamEmployeeExitDocument(req, res, next, 'Experience Certificate');

const downloadFnfStatement = (req, res, next) =>
  streamEmployeeExitDocument(req, res, next, 'FnF Statement');

module.exports = {
  applyResignation,
  getExitStatus,
  withdrawResignation,
  downloadRelievingLetter,
  downloadExperienceCertificate,
  downloadFnfStatement,
};
