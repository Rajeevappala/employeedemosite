const crypto = require('crypto');
const path = require('path');
const pool = require('../config/database');
const fnfService = require('../services/fnfService');
const exitDocumentPdfService = require('../services/exitDocumentPdfService');
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
 * GET /api/admin/exit/requests
 * Lists all employee exit requests with filtering and pagination.
 */
const getExitRequests = async (req, res, next) => {
  try {
    const { status, department, search, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (status && status !== 'All') {
      conditions.push(`er.status = $${paramIndex++}`);
      values.push(status);
    }

    if (department && department !== 'All') {
      conditions.push(`e.department = $${paramIndex++}`);
      values.push(department);
    }

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(e.first_name) LIKE $${paramIndex} OR
        LOWER(e.last_name) LIKE $${paramIndex} OR
        LOWER(er.employee_id) LIKE $${paramIndex} OR
        LOWER(e.email) LIKE $${paramIndex}
      )`);
      values.push(term);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM public.exit_requests er
      JOIN public.employees e ON e.employee_id = er.employee_id
      ${whereClause}
    `;
    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0]?.total || 0;

    // Paginated list
    const dataQuery = `
      SELECT 
        er.id,
        er.employee_id,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
        e.department,
        e.designation,
        e.email,
        e.status AS employee_status,
        er.resignation_date,
        er.requested_relieving_date,
        er.approved_relieving_date,
        er.reason,
        er.status,
        er.admin_remarks,
        er.reviewed_at,
        er.completed_at,
        er.created_at,
        (
          SELECT json_agg(
            json_build_object(
              'id', ec.id,
              'department', ec.department,
              'status', ec.status,
              'remarks', ec.remarks,
              'cleared_at', ec.cleared_at
            ) ORDER BY ec.department ASC
          )
          FROM public.exit_clearances ec
          WHERE ec.exit_request_id = er.id
        ) AS clearances
      FROM public.exit_requests er
      JOIN public.employees e ON e.employee_id = er.employee_id
      ${whereClause}
      ORDER BY er.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    values.push(limitNum, offset);
    const result = await pool.query(dataQuery, values);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/exit/requests/:id/review
 * Reviews an exit request (UNDER_REVIEW, APPROVE/ACCEPT, REJECT/DECLINE).
 */
const reviewExitRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user?.id;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exit request ID.',
      });
    }

    const { action, approved_relieving_date, admin_remarks } = req.body;
    const normalizedAction = typeof action === 'string' ? action.trim().toUpperCase() : '';

    if (!normalizedAction || !['UNDER_REVIEW', 'APPROVE', 'ACCEPT', 'REJECT', 'DECLINE'].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "Action must be one of 'UNDER_REVIEW', 'APPROVE', 'ACCEPT', 'REJECT', or 'DECLINE'.",
      });
    }

    // Look up current record
    const reqRes = await pool.query(
      `SELECT id, employee_id, status, requested_relieving_date
       FROM public.exit_requests WHERE id = $1`,
      [id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    // State machine transitions:
    // SUBMITTED -> UNDER_REVIEW, APPROVED, REJECTED
    // UNDER_REVIEW -> APPROVED, REJECTED
    // Terminal states cannot transition
    if (['COMPLETED', 'REJECTED', 'WITHDRAWN'].includes(exitReq.status)) {
      return res.status(400).json({
        success: false,
        message: `Exit request in terminal state '${exitReq.status}' cannot be modified.`,
      });
    }

    let targetStatus;
    let finalRelievingDate = null;

    if (normalizedAction === 'UNDER_REVIEW') {
      if (exitReq.status !== 'SUBMITTED') {
        return res.status(400).json({
          success: false,
          message: `Cannot transition from '${exitReq.status}' to 'UNDER_REVIEW'.`,
        });
      }
      targetStatus = 'UNDER_REVIEW';
    } else if (normalizedAction === 'APPROVE' || normalizedAction === 'ACCEPT') {
      targetStatus = 'APPROVED';
      const dateToUse = approved_relieving_date || exitReq.requested_relieving_date;
      if (!dateToUse || !isValidDateString(String(dateToUse).trim())) {
        return res.status(400).json({
          success: false,
          message: 'A valid approved_relieving_date (YYYY-MM-DD) is required for approval.',
        });
      }
      finalRelievingDate = String(dateToUse).trim();
    } else if (normalizedAction === 'REJECT' || normalizedAction === 'DECLINE') {
      targetStatus = 'REJECTED';
      if (!admin_remarks || typeof admin_remarks !== 'string' || admin_remarks.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Detailed admin_remarks (at least 5 characters) are required for rejection.',
        });
      }
    }

    const updateQuery = `
      UPDATE public.exit_requests
      SET 
        status = $1,
        approved_relieving_date = COALESCE($2, approved_relieving_date),
        admin_remarks = COALESCE($3, admin_remarks),
        reviewed_by = $4,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $5
      RETURNING id, employee_id, status, TO_CHAR(approved_relieving_date, 'YYYY-MM-DD') AS approved_relieving_date, admin_remarks, reviewed_at
    `;

    const updateRes = await pool.query(updateQuery, [
      targetStatus,
      finalRelievingDate,
      admin_remarks ? admin_remarks.trim() : null,
      adminId,
      id,
    ]);

    const auditAction = (targetStatus === 'APPROVED')
      ? 'RESIGNATION_ACCEPTED'
      : (targetStatus === 'REJECTED')
      ? 'RESIGNATION_DECLINED'
      : 'EXIT_REQUEST_REVIEWED';

    recordAuditLog({
      userId: adminId,
      action: auditAction,
      entityType: 'EXIT_REQUEST',
      entityId: id,
      metadata: {
        employee_id: exitReq.employee_id,
        previous_status: exitReq.status,
        new_status: targetStatus,
        approved_relieving_date: finalRelievingDate,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Exit request ${targetStatus === 'APPROVED' ? 'accepted' : targetStatus === 'REJECTED' ? 'declined' : 'updated to ' + targetStatus}.`,
      data: updateRes.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/exit/clearance/:id
 * Updates status of a department clearance record.
 */
const updateClearance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user?.id;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid clearance ID.',
      });
    }

    const { status, remarks } = req.body;
    const allowedStatuses = ['CLEARED', 'REJECTED', 'WAIVED'];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Clearance status must be one of: ${allowedStatuses.join(', ')}.`,
      });
    }

    if (status === 'REJECTED' && (!remarks || typeof remarks !== 'string' || remarks.trim().length < 5)) {
      return res.status(400).json({
        success: false,
        message: 'Detailed remarks (at least 5 characters) are required when rejecting a clearance.',
      });
    }

    const clearanceRes = await pool.query(
      `SELECT c.id, c.exit_request_id, c.department, er.status AS exit_status
       FROM public.exit_clearances c
       JOIN public.exit_requests er ON er.id = c.exit_request_id
       WHERE c.id = $1`,
      [id]
    );

    const clearance = clearanceRes.rows[0];
    if (!clearance) {
      return res.status(404).json({
        success: false,
        message: 'Clearance record not found.',
      });
    }

    if (clearance.exit_status === 'COMPLETED' || clearance.exit_status === 'WITHDRAWN') {
      return res.status(400).json({
        success: false,
        message: `Clearance cannot be updated for an exit request in '${clearance.exit_status}' status.`,
      });
    }

    const updateRes = await pool.query(
      `UPDATE public.exit_clearances
       SET status = $1,
           remarks = COALESCE($2, remarks),
           cleared_by = $3,
           cleared_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, exit_request_id, department, status, remarks, cleared_at`,
      [status, remarks ? String(remarks).trim() : null, adminId, id]
    );

    recordAuditLog({
      userId: adminId,
      action: 'EXIT_CLEARANCE_UPDATED',
      entityType: 'EXIT_CLEARANCE',
      entityId: id,
      metadata: {
        department: clearance.department,
        new_status: status,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `${clearance.department} clearance status updated to '${status}'.`,
      data: updateRes.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/exit/fnf/calculate
 * Computes read-only F&F settlement preview.
 */
const calculateFnfPreview = async (req, res, next) => {
  try {
    const {
      exit_request_id,
      salary_divisor = 30,
      payable_days,
      encashed_leave_days,
      gratuity_amount = 0,
      bonus_or_incentive = 0,
      notice_recovery = 0,
      other_deductions = 0,
    } = req.body;

    if (!exit_request_id || !UUID_REGEX.test(exit_request_id)) {
      return res.status(400).json({
        success: false,
        message: 'A valid exit_request_id is required.',
      });
    }

    const reqRes = await pool.query(
      `SELECT id, employee_id, requested_relieving_date, approved_relieving_date, status
       FROM public.exit_requests WHERE id = $1`,
      [exit_request_id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    const relievingDate = exitReq.approved_relieving_date || exitReq.requested_relieving_date;

    const breakdown = await fnfService.calculateFnf({
      employeeId: exitReq.employee_id,
      relievingDate: new Date(relievingDate).toISOString().split('T')[0],
      salaryDivisor: salary_divisor,
      payableDays: payable_days,
      encashedLeaveDays: encashed_leave_days,
      gratuityAmount: gratuity_amount,
      bonusOrIncentive: bonus_or_incentive,
      noticePeriodRecovery: notice_recovery,
      otherDeductions: other_deductions,
    });

    recordAuditLog({
      userId: req.user?.id,
      action: 'FNF_PREVIEW_CALCULATED',
      entityType: 'EXIT_REQUEST',
      entityId: exit_request_id,
      metadata: {
        employee_id: exitReq.employee_id,
        net_payable_amount: breakdown.net_payable_amount,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: breakdown,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/exit/fnf/finalize
 * Finalizes offboarding, generates documents, saves to private storage, deactivates account.
 */
const finalizeExit = async (req, res, next) => {
  const client = await pool.connect();
  const createdPhysicalFiles = [];

  try {
    const adminId = req.user?.id;
    const {
      exit_request_id,
      salary_divisor = 30,
      payable_days,
      encashed_leave_days,
      gratuity_amount = 0,
      bonus_or_incentive = 0,
      notice_recovery = 0,
      other_deductions = 0,
    } = req.body;

    if (!exit_request_id || !UUID_REGEX.test(exit_request_id)) {
      return res.status(400).json({
        success: false,
        message: 'A valid exit_request_id is required.',
      });
    }

    await client.query('BEGIN');

    // 1. Lock exit request
    const reqRes = await client.query(
      `SELECT er.id, er.employee_id, er.requested_relieving_date, er.approved_relieving_date,
              er.status, er.resignation_date,
              e.first_name, e.last_name, e.department, e.designation, e.date_of_joining,
              e.status AS employee_status, u.id AS user_id, u.status AS user_status
       FROM public.exit_requests er
       JOIN public.employees e ON e.employee_id = er.employee_id
       LEFT JOIN public.users u ON u.employee_id = er.employee_id
       WHERE er.id = $1
       FOR UPDATE OF er, e`,
      [exit_request_id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    // 2. State verification
    if (exitReq.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Exit request must be in 'APPROVED' status to finalize. Current status is '${exitReq.status}'.`,
      });
    }

    if (exitReq.employee_status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Employee is already in '${exitReq.employee_status}' status.`,
      });
    }

    // 3. Clearances check: all 4 must be CLEARED or WAIVED
    const clrRes = await client.query(
      `SELECT department, status FROM public.exit_clearances
       WHERE exit_request_id = $1`,
      [exit_request_id]
    );

    const pendingClearances = clrRes.rows.filter(
      (c) => c.status !== 'CLEARED' && c.status !== 'WAIVED'
    );

    if (pendingClearances.length > 0) {
      await client.query('ROLLBACK');
      const deptNames = pendingClearances.map((c) => `${c.department} (${c.status})`).join(', ');
      return res.status(400).json({
        success: false,
        message: `Cannot finalize offboarding: pending or rejected clearances exist: ${deptNames}.`,
      });
    }

    // 4. Calculate Final Settlement Values
    const relievingDate = exitReq.approved_relieving_date || exitReq.requested_relieving_date;
    const relievingDateStr = new Date(relievingDate).toISOString().split('T')[0];

    const breakdown = await fnfService.calculateFnf({
      employeeId: exitReq.employee_id,
      relievingDate: relievingDateStr,
      salaryDivisor: salary_divisor,
      payableDays: payable_days,
      encashedLeaveDays: encashed_leave_days,
      gratuityAmount: gratuity_amount,
      bonusOrIncentive: bonus_or_incentive,
      noticePeriodRecovery: notice_recovery,
      otherDeductions: other_deductions,
    });

    const employeeObj = {
      employee_id: exitReq.employee_id,
      first_name: exitReq.first_name,
      last_name: exitReq.last_name,
      department: exitReq.department,
      designation: exitReq.designation,
      date_of_joining: exitReq.date_of_joining,
    };

    // 5. Look up any existing active exit documents that have been manually uploaded by Admin
    // CRITICAL BUSINESS RULE: NO AUTOMATIC PDF GENERATION.
    const uploadedDocs = await client.query(
      `SELECT id, document_type
       FROM public.documents
       WHERE employee_id = $1 AND is_active = TRUE AND (
         exit_request_id = $2 OR document_type IN ('Relieving Letter', 'Experience Certificate', 'FnF Statement', 'Full & Final Settlement Statement')
       )`,
      [exitReq.employee_id, exit_request_id]
    );

    let relievingDocId = null;
    let expDocId = null;
    let fnfDocId = null;

    for (const d of uploadedDocs.rows) {
      if (d.document_type === 'Relieving Letter') relievingDocId = d.id;
      else if (d.document_type === 'Experience Certificate') expDocId = d.id;
      else if (d.document_type === 'FnF Statement' || d.document_type === 'Full & Final Settlement Statement') fnfDocId = d.id;
    }

    const empId = exitReq.employee_id;

    // 6. Upsert fnf_settlements record
    const insertFnfQuery = `
      INSERT INTO public.fnf_settlements (
        exit_request_id, employee_id, working_days, payable_days, prorated_salary,
        encashed_leave_days, leave_encashment_amount, gratuity_amount, bonus_or_incentive,
        notice_period_recovery, other_deductions, total_earnings, total_deductions,
        net_payable_amount, settlement_document_id, relieving_document_id, experience_document_id,
        status, finalized_by, finalized_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'FINALIZED', $18, NOW()
      )
      ON CONFLICT (exit_request_id) DO UPDATE SET
        working_days = EXCLUDED.working_days,
        payable_days = EXCLUDED.payable_days,
        prorated_salary = EXCLUDED.prorated_salary,
        encashed_leave_days = EXCLUDED.encashed_leave_days,
        leave_encashment_amount = EXCLUDED.leave_encashment_amount,
        gratuity_amount = EXCLUDED.gratuity_amount,
        bonus_or_incentive = EXCLUDED.bonus_or_incentive,
        notice_period_recovery = EXCLUDED.notice_period_recovery,
        other_deductions = EXCLUDED.other_deductions,
        total_earnings = EXCLUDED.total_earnings,
        total_deductions = EXCLUDED.total_deductions,
        net_payable_amount = EXCLUDED.net_payable_amount,
        settlement_document_id = COALESCE(EXCLUDED.settlement_document_id, fnf_settlements.settlement_document_id),
        relieving_document_id = COALESCE(EXCLUDED.relieving_document_id, fnf_settlements.relieving_document_id),
        experience_document_id = COALESCE(EXCLUDED.experience_document_id, fnf_settlements.experience_document_id),
        status = 'FINALIZED',
        finalized_by = EXCLUDED.finalized_by,
        finalized_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `;

    const fnfDbRes = await client.query(insertFnfQuery, [
      exit_request_id,
      empId,
      breakdown.working_days,
      breakdown.payable_days,
      breakdown.prorated_salary,
      breakdown.leave_encashment.encashed_leave_days,
      breakdown.leave_encashment.leave_encashment_amount,
      breakdown.gratuity.gratuity_amount,
      breakdown.bonus_or_incentive,
      breakdown.notice_period_recovery,
      breakdown.other_deductions,
      breakdown.total_earnings,
      breakdown.total_deductions,
      breakdown.net_payable_amount,
      fnfDocId,
      relievingDocId,
      expDocId,
      adminId,
    ]);

    // 7. Update exit_request to COMPLETED
    await client.query(
      `UPDATE public.exit_requests
       SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [exit_request_id]
    );

    // 8. Deactivate Employee & User Records
    await client.query(
      `UPDATE public.employees
       SET status = 'INACTIVE', updated_at = NOW()
       WHERE employee_id = $1`,
      [empId]
    );

    if (exitReq.user_id) {
      await client.query(
        `UPDATE public.users
         SET status = 'INACTIVE', updated_at = NOW()
         WHERE id = $1`,
        [exitReq.user_id]
      );

      // 9. Delete all OTP verification records for this user
      await client.query(
        `DELETE FROM public.otp_verifications WHERE user_id = $1`,
        [exitReq.user_id]
      );
    }

    // 10. Cancel future Pending or Approved leaves after approved relieving date
    await client.query(
      `UPDATE public.leave_requests
       SET status = 'Cancelled', admin_comment = 'Auto-cancelled due to employee separation.'
       WHERE employee_id = $1 AND start_date > $2 AND status IN ('Pending', 'Approved')`,
      [empId, relievingDateStr]
    );

    await client.query('COMMIT');

    // 11. Audit log
    recordAuditLog({
      userId: adminId,
      action: 'EMPLOYEE_OFFBOARDING_FINALIZED',
      entityType: 'EMPLOYEE',
      entityId: empId,
      metadata: {
        exit_request_id,
        settlement_id: fnfDbRes.rows[0].id,
        net_payable_amount: breakdown.net_payable_amount,
        relieving_date: relievingDateStr,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Employee ${empId} offboarding finalized successfully. Account deactivated.`,
      data: {
        exit_request_id,
        settlement_id: fnfDbRes.rows[0].id,
        net_payable_amount: breakdown.net_payable_amount,
        relieving_document_id: relievingDocId,
        experience_document_id: expDocId,
        settlement_document_id: fnfDocId,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET /api/admin/exit/:id/documents
 * Lists all active and historical exit documents for an exit request.
 */
const getExitDocuments = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exit request ID.',
      });
    }

    const reqRes = await pool.query(
      `SELECT er.id, er.employee_id, er.resignation_date, er.requested_relieving_date,
              er.approved_relieving_date, er.status,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.department, e.designation
       FROM public.exit_requests er
       JOIN public.employees e ON e.employee_id = er.employee_id
       WHERE er.id = $1`,
      [id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    const docsRes = await pool.query(
      `SELECT d.id, d.employee_id, d.document_type, d.file_name,
              TO_CHAR(d.release_date, 'YYYY-MM-DD') AS release_date,
              d.is_active, d.remarks, d.created_at, d.updated_at,
              u.email AS uploaded_by_email
       FROM public.documents d
       LEFT JOIN public.users u ON u.id = d.uploaded_by
       WHERE d.employee_id = $1 AND (
         d.exit_request_id = $2 OR d.document_type IN ('Relieving Letter', 'Experience Certificate', 'FnF Statement', 'Full & Final Settlement Statement', 'Other Exit Document')
       )
       ORDER BY d.created_at DESC`,
      [exitReq.employee_id, id]
    );

    const todayStr = new Date().toISOString().split('T')[0];

    const allDocs = docsRes.rows;
    const activeDocs = allDocs.filter((d) => d.is_active);
    const history = allDocs.filter((d) => !d.is_active);

    const STANDARD_SLOTS = [
      'Relieving Letter',
      'Experience Certificate',
      'FnF Statement',
      'Other Exit Document',
    ];

    const slots = STANDARD_SLOTS.map((docType) => {
      const match = activeDocs.find((d) => d.document_type === docType);
      if (match) {
        const relStr = match.release_date;
        const isAvail = relStr ? todayStr >= relStr : true;
        return {
          document_type: docType,
          status: isAvail ? 'AVAILABLE' : 'SCHEDULED',
          document_id: match.id,
          file_name: match.file_name,
          release_date: relStr,
          remarks: match.remarks,
          uploaded_at: match.created_at,
          uploaded_by_email: match.uploaded_by_email,
        };
      }
      return {
        document_type: docType,
        status: 'NOT_UPLOADED',
        document_id: null,
        file_name: null,
        release_date: null,
        remarks: null,
        uploaded_at: null,
        uploaded_by_email: null,
      };
    });

    for (const d of activeDocs) {
      if (!STANDARD_SLOTS.includes(d.document_type)) {
        const relStr = d.release_date;
        const isAvail = relStr ? todayStr >= relStr : true;
        slots.push({
          document_type: d.document_type,
          status: isAvail ? 'AVAILABLE' : 'SCHEDULED',
          document_id: d.id,
          file_name: d.file_name,
          release_date: relStr,
          remarks: d.remarks,
          uploaded_at: d.created_at,
          uploaded_by_email: d.uploaded_by_email,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        exitRequest: exitReq,
        slots,
        activeDocuments: activeDocs.map((d) => {
          const relStr = d.release_date;
          return {
            ...d,
            release_date: relStr,
            status: relStr && todayStr < relStr ? 'SCHEDULED' : 'AVAILABLE',
          };
        }),
        history: history.map((d) => ({
          ...d,
          release_date: d.release_date,
          status: 'REPLACED',
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/exit/:id/documents
 * Manually uploads an exit document PDF and schedules its individual release date.
 */
const uploadExitDocument = async (req, res, next) => {
  const client = await pool.connect();
  let savedStorageKey = null;

  try {
    const { id } = req.params;
    const adminId = req.user?.id;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exit request ID.',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file uploaded. Please select a valid PDF file.',
      });
    }

    const { document_type, release_date, remarks } = req.body;

    if (!document_type || typeof document_type !== 'string' || !document_type.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Document type is required.',
      });
    }

    const cleanDocType = document_type.trim();

    if (!release_date || !isValidDateString(String(release_date).trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid document release date (YYYY-MM-DD) is required.',
      });
    }

    const cleanReleaseDate = String(release_date).trim();

    const reqRes = await client.query(
      `SELECT id, employee_id, requested_relieving_date, approved_relieving_date, status
       FROM public.exit_requests WHERE id = $1`,
      [id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    if (['REJECTED', 'WITHDRAWN'].includes(exitReq.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot upload exit documents for an exit request in '${exitReq.status}' status.`,
      });
    }

    // Release date validation against Last Working Day (Part 14)
    const lastWorkingDay = exitReq.approved_relieving_date || exitReq.requested_relieving_date;
    if (lastWorkingDay) {
      const lwdStr = new Date(lastWorkingDay).toISOString().split('T')[0];
      if (cleanReleaseDate < lwdStr) {
        return res.status(400).json({
          success: false,
          message: `Document release date (${cleanReleaseDate}) cannot be earlier than Last Working Day (${lwdStr}).`,
        });
      }
    }

    await client.query('BEGIN');

    const empId = exitReq.employee_id;
    const sanitizedType = cleanDocType.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.pdf';
    const storageKey = `documents/${empId}/exit/${sanitizedType}_${crypto.randomUUID()}${ext}`;

    await storageService.saveFile(req.file.buffer, storageKey);
    savedStorageKey = storageKey;

    const existingRes = await client.query(
      `SELECT id, file_name, release_date
       FROM public.documents
       WHERE employee_id = $1 AND document_type = $2 AND is_active = TRUE`,
      [empId, cleanDocType]
    );

    const isReplacement = existingRes.rows.length > 0;
    const previousDoc = existingRes.rows[0];

    if (isReplacement) {
      await client.query(
        `UPDATE public.documents
         SET is_active = FALSE, updated_at = NOW()
         WHERE employee_id = $1 AND document_type = $2 AND is_active = TRUE`,
        [empId, cleanDocType]
      );
    }

    const exitYear = new Date(cleanReleaseDate).getFullYear();
    const exitMonth = new Date(cleanReleaseDate).getMonth() + 1;

    const insertDocRes = await client.query(
      `INSERT INTO public.documents (
         employee_id, document_type, file_name, storage_key, release_date,
         is_active, exit_request_id, remarks, month, year, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10)
       RETURNING id, employee_id, document_type, file_name, TO_CHAR(release_date, 'YYYY-MM-DD') AS release_date, is_active, remarks, created_at`,
      [
        empId,
        cleanDocType,
        req.file.originalname,
        storageKey,
        cleanReleaseDate,
        id,
        remarks ? String(remarks).trim() : null,
        exitMonth,
        exitYear,
        adminId,
      ]
    );

    const newDoc = insertDocRes.rows[0];

    // Update fnf_settlements if exists
    if (cleanDocType === 'Relieving Letter') {
      await client.query(
        `UPDATE public.fnf_settlements
         SET relieving_document_id = $1, updated_at = NOW()
         WHERE exit_request_id = $2`,
        [newDoc.id, id]
      );
    } else if (cleanDocType === 'Experience Certificate') {
      await client.query(
        `UPDATE public.fnf_settlements
         SET experience_document_id = $1, updated_at = NOW()
         WHERE exit_request_id = $2`,
        [newDoc.id, id]
      );
    } else if (cleanDocType === 'FnF Statement' || cleanDocType === 'Full & Final Settlement Statement') {
      await client.query(
        `UPDATE public.fnf_settlements
         SET settlement_document_id = $1, updated_at = NOW()
         WHERE exit_request_id = $2`,
        [newDoc.id, id]
      );
    }

    await client.query('COMMIT');

    const auditAction = isReplacement ? 'EXIT_DOCUMENT_REPLACED' : 'EXIT_DOCUMENT_UPLOADED';
    recordAuditLog({
      userId: adminId,
      action: auditAction,
      entityType: 'DOCUMENT',
      entityId: newDoc.id,
      metadata: {
        employee_id: empId,
        exit_request_id: id,
        document_type: cleanDocType,
        file_name: req.file.originalname,
        release_date: cleanReleaseDate,
        is_replacement: isReplacement,
        previous_document_id: previousDoc?.id || null,
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: isReplacement
        ? `Exit document '${cleanDocType}' replaced successfully. New release date: ${cleanReleaseDate}.`
        : `Exit document '${cleanDocType}' uploaded successfully. Scheduled for release on: ${cleanReleaseDate}.`,
      data: {
        ...newDoc,
        release_date: cleanReleaseDate,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (savedStorageKey) {
      storageService.deleteFile(savedStorageKey).catch(() => {});
    }
    next(error);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/admin/exit/documents/:documentId/release-date
 * Admin updates the release date for an exit document.
 */
const updateDocumentReleaseDate = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const adminId = req.user?.id;

    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID.',
      });
    }

    const { release_date } = req.body;
    if (!release_date || !isValidDateString(String(release_date).trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid release_date (YYYY-MM-DD) is required.',
      });
    }

    const cleanReleaseDate = String(release_date).trim();

    const docRes = await pool.query(
      `SELECT d.id, d.employee_id, d.document_type, d.release_date, d.exit_request_id,
              er.approved_relieving_date, er.requested_relieving_date
       FROM public.documents d
       LEFT JOIN public.exit_requests er ON er.id = d.exit_request_id
       WHERE d.id = $1`,
      [documentId]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.',
      });
    }

    const lwd = doc.approved_relieving_date || doc.requested_relieving_date;
    if (lwd) {
      const lwdStr = new Date(lwd).toISOString().split('T')[0];
      if (cleanReleaseDate < lwdStr) {
        return res.status(400).json({
          success: false,
          message: `Document release date (${cleanReleaseDate}) cannot be earlier than Last Working Day (${lwdStr}).`,
        });
      }
    }

    const prevDate = doc.release_date ? new Date(doc.release_date).toISOString().split('T')[0] : null;

    const updateRes = await pool.query(
      `UPDATE public.documents
       SET release_date = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, employee_id, document_type, file_name, TO_CHAR(release_date, 'YYYY-MM-DD') AS release_date, is_active, updated_at`,
      [cleanReleaseDate, documentId]
    );

    recordAuditLog({
      userId: adminId,
      action: 'EXIT_DOCUMENT_RELEASE_DATE_CHANGED',
      entityType: 'DOCUMENT',
      entityId: documentId,
      metadata: {
        employee_id: doc.employee_id,
        document_type: doc.document_type,
        previous_release_date: prevDate,
        new_release_date: cleanReleaseDate,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Document release date updated to ${cleanReleaseDate}.`,
      data: {
        ...updateRes.rows[0],
        release_date: cleanReleaseDate,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/exit/documents/:documentId/download
 * Admin downloads an exit document unconditionally.
 */
const adminDownloadExitDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID.',
      });
    }

    const docRes = await pool.query(
      `SELECT id, file_name, storage_key FROM public.documents WHERE id = $1`,
      [documentId]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.',
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
};

/**
 * GET /api/admin/exit/documents/:documentId/view
 * Admin views an exit document inline in browser unconditionally.
 */
const adminViewExitDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID.',
      });
    }

    const docRes = await pool.query(
      `SELECT id, file_name, storage_key FROM public.documents WHERE id = $1`,
      [documentId]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.',
      });
    }

    const fileBuffer = await storageService.getFile(doc.storage_key);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    return res.send(fileBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Helper for admin to stream exit documents by exit request ID.
 */
async function streamAdminExitDocument(req, res, next, documentType) {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exit request ID.',
      });
    }

    const reqRes = await pool.query(
      `SELECT employee_id, status FROM public.exit_requests WHERE id = $1`,
      [id]
    );

    const exitReq = reqRes.rows[0];
    if (!exitReq) {
      return res.status(404).json({
        success: false,
        message: 'Exit request not found.',
      });
    }

    const docRes = await pool.query(
      `SELECT id, file_name, storage_key
       FROM public.documents
       WHERE employee_id = $1 AND document_type = $2 AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
      [exitReq.employee_id, documentType]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: `${documentType} not found for this exit request.`,
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

const adminDownloadRelievingLetter = (req, res, next) =>
  streamAdminExitDocument(req, res, next, 'Relieving Letter');

const adminDownloadExperienceCertificate = (req, res, next) =>
  streamAdminExitDocument(req, res, next, 'Experience Certificate');

const adminDownloadFnfStatement = (req, res, next) =>
  streamAdminExitDocument(req, res, next, 'FnF Statement');

module.exports = {
  getExitRequests,
  reviewExitRequest,
  updateClearance,
  calculateFnfPreview,
  finalizeExit,
  getExitDocuments,
  uploadExitDocument,
  updateDocumentReleaseDate,
  adminDownloadExitDocument,
  adminViewExitDocument,
  adminDownloadRelievingLetter,
  adminDownloadExperienceCertificate,
  adminDownloadFnfStatement,
};
