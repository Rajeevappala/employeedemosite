const crypto = require('crypto');
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
 * Reviews an exit request (UNDER_REVIEW, APPROVED, REJECTED).
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

    if (!action || !['UNDER_REVIEW', 'APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Action must be one of 'UNDER_REVIEW', 'APPROVE', or 'REJECT'.",
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

    if (action === 'UNDER_REVIEW') {
      if (exitReq.status !== 'SUBMITTED') {
        return res.status(400).json({
          success: false,
          message: `Cannot transition from '${exitReq.status}' to 'UNDER_REVIEW'.`,
        });
      }
      targetStatus = 'UNDER_REVIEW';
    } else if (action === 'APPROVE') {
      targetStatus = 'APPROVED';
      const dateToUse = approved_relieving_date || exitReq.requested_relieving_date;
      if (!dateToUse || !isValidDateString(String(dateToUse).trim())) {
        return res.status(400).json({
          success: false,
          message: 'A valid approved_relieving_date (YYYY-MM-DD) is required for approval.',
        });
      }
      finalRelievingDate = String(dateToUse).trim();
    } else if (action === 'REJECT') {
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
      RETURNING id, employee_id, status, approved_relieving_date, admin_remarks, reviewed_at
    `;

    const updateRes = await pool.query(updateQuery, [
      targetStatus,
      finalRelievingDate,
      admin_remarks ? admin_remarks.trim() : null,
      adminId,
      id,
    ]);

    recordAuditLog({
      userId: adminId,
      action: 'EXIT_REQUEST_REVIEWED',
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
      message: `Exit request updated to '${targetStatus}'.`,
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

    // 5. Generate PDFs in-memory
    const relievingPdfBuffer = await exitDocumentPdfService.generateRelievingLetterPdf({
      employee: employeeObj,
      exitRequest: exitReq,
    });

    const experiencePdfBuffer = await exitDocumentPdfService.generateExperienceCertificatePdf({
      employee: employeeObj,
      exitRequest: exitReq,
    });

    const fnfPdfBuffer = await exitDocumentPdfService.generateFnfSettlementPdf({
      employee: employeeObj,
      exitRequest: exitReq,
      settlement: breakdown,
    });

    // 6. Write PDFs to private storage
    const empId = exitReq.employee_id;
    const keyRelieving = `documents/${empId}/exit/relieving_letter_${crypto.randomUUID()}.pdf`;
    const keyExperience = `documents/${empId}/exit/experience_certificate_${crypto.randomUUID()}.pdf`;
    const keyFnf = `documents/${empId}/exit/fnf_statement_${crypto.randomUUID()}.pdf`;

    await storageService.saveFile(relievingPdfBuffer, keyRelieving);
    createdPhysicalFiles.push(keyRelieving);

    await storageService.saveFile(experiencePdfBuffer, keyExperience);
    createdPhysicalFiles.push(keyExperience);

    await storageService.saveFile(fnfPdfBuffer, keyFnf);
    createdPhysicalFiles.push(keyFnf);

    // 7. Register documents in public.documents
    const exitYear = new Date(relievingDate).getFullYear();
    const exitMonth = new Date(relievingDate).getMonth() + 1;

    const docRelievingRes = await client.query(
      `INSERT INTO public.documents (employee_id, document_type, file_name, storage_key, month, year, uploaded_by)
       VALUES ($1, 'Relieving Letter', $2, $3, $4, $5, $6)
       RETURNING id`,
      [empId, `Relieving_Letter_${empId}.pdf`, keyRelieving, exitMonth, exitYear, adminId]
    );

    const docExpRes = await client.query(
      `INSERT INTO public.documents (employee_id, document_type, file_name, storage_key, month, year, uploaded_by)
       VALUES ($1, 'Experience Certificate', $2, $3, $4, $5, $6)
       RETURNING id`,
      [empId, `Experience_Certificate_${empId}.pdf`, keyExperience, exitMonth, exitYear, adminId]
    );

    const docFnfRes = await client.query(
      `INSERT INTO public.documents (employee_id, document_type, file_name, storage_key, month, year, uploaded_by)
       VALUES ($1, 'FnF Statement', $2, $3, $4, $5, $6)
       RETURNING id`,
      [empId, `FnF_Settlement_${empId}.pdf`, keyFnf, exitMonth, exitYear, adminId]
    );

    const relievingDocId = docRelievingRes.rows[0].id;
    const expDocId = docExpRes.rows[0].id;
    const fnfDocId = docFnfRes.rows[0].id;

    // 8. Upsert fnf_settlements record
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
        settlement_document_id = EXCLUDED.settlement_document_id,
        relieving_document_id = EXCLUDED.relieving_document_id,
        experience_document_id = EXCLUDED.experience_document_id,
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

    // 9. Update exit_request to COMPLETED
    await client.query(
      `UPDATE public.exit_requests
       SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [exit_request_id]
    );

    // 10. Deactivate Employee & User Records
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

      // 11. Delete all OTP verification records for this user
      await client.query(
        `DELETE FROM public.otp_verifications WHERE user_id = $1`,
        [exitReq.user_id]
      );
    }

    // 12. Cancel future Pending or Approved leaves after approved relieving date
    await client.query(
      `UPDATE public.leave_requests
       SET status = 'Cancelled', admin_comment = 'Auto-cancelled due to employee separation.'
       WHERE employee_id = $1 AND start_date > $2 AND status IN ('Pending', 'Approved')`,
      [empId, relievingDateStr]
    );

    await client.query('COMMIT');

    // 13. Audit log
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

    // Clean up created physical files on failure
    for (const key of createdPhysicalFiles) {
      try {
        await storageService.deleteFile(key);
      } catch {
        // Safe catch on cleanup
      }
    }

    next(error);
  } finally {
    client.release();
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
       WHERE employee_id = $1 AND document_type = $2
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
  adminDownloadRelievingLetter,
  adminDownloadExperienceCertificate,
  adminDownloadFnfStatement,
};
