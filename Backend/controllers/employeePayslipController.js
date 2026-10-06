const path = require('path');
const { Readable } = require('stream');
const pool = require('../config/database');
const storageService = require('../services/storageService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

/**
 * Normalizes and validates month input (1-12 or month name)
 */
function parseMonthNumber(val) {
  if (val === undefined || val === null || val === '' || val === 'all' || val === 'All') return null;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  if (typeof val === 'string') {
    const idx = MONTH_NAMES.indexOf(val.trim().toLowerCase());
    if (idx !== -1) return idx + 1;
  }
  return null;
}

/**
 * Normalizes and validates 4-digit calendar year
 */
function parseYearNumber(val) {
  if (val === undefined || val === null || val === '' || val === 'all' || val === 'All') return null;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2000 && num <= 2100) return num;
  return null;
}

/**
 * GET /api/employee/payslips
 * Fetches finalized payslips belonging strictly to the authenticated employee (req.user.employee_id).
 *
 * Security:
 * - Employee identity strictly extracted from authenticated JWT.
 * - Any user-supplied employee_id in params/query/body is strictly ignored.
 * - storage_key, filesystem paths, and server secrets are never returned.
 * - Supports optional filtering by year, month, and pagination.
 */
const getEmployeePayslips = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { year, month, page, limit } = req.query;

    const parsedYear = parseYearNumber(year);
    const parsedMonth = parseMonthNumber(month);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    // Build parameterized query
    const whereConditions = [
      `d.employee_id = $1`,
      `LOWER(d.document_type) = 'payslip'`,
    ];
    const queryParams = [employeeId];

    if (parsedYear !== null) {
      queryParams.push(parsedYear);
      whereConditions.push(`d.year = $${queryParams.length}`);
    }

    if (parsedMonth !== null) {
      queryParams.push(parsedMonth);
      whereConditions.push(`d.month = $${queryParams.length}`);
    }

    const whereClause = whereConditions.join(' AND ');

    // 1. Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.documents d
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    // 2. Query items joined with authoritative payroll_records
    const dataQueryParams = [...queryParams, limitNum, offset];
    const limitParamIndex = queryParams.length + 1;
    const offsetParamIndex = queryParams.length + 2;

    const dataQuery = `
      SELECT 
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
      FROM public.documents d
      LEFT JOIN public.payroll_records pr 
        ON pr.employee_id = d.employee_id 
       AND pr.month = d.month 
       AND pr.year = d.year
      WHERE ${whereClause}
      ORDER BY d.year DESC NULLS LAST, d.month DESC NULLS LAST, d.created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `;

    const dataResult = await pool.query(dataQuery, dataQueryParams);

    // 3. Map to safe response format excluding internal storage keys & filesystem paths
    const items = dataResult.rows.map((row) => ({
      id: row.id,
      employee_id: row.employee_id,
      document_type: row.document_type,
      file_name: row.file_name,
      month: row.month,
      year: row.year,
      created_at: row.created_at,
      payroll: row.working_days != null ? {
        working_days: parseFloat(row.working_days) || 0,
        payable_days: parseFloat(row.payable_days) || 0,
        gross_salary: row.gross_salary,
        total_deductions: row.total_deductions,
        net_salary: row.net_salary,
        status: row.payroll_status || 'Processed',
      } : null,
    }));

    const totalPages = Math.ceil(total / limitNum) || 0;

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to stream payslip document
 */
async function streamPayslipFile(req, res, next, isInline = false) {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { documentId } = req.params;

    // Validate UUID format
    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(404).json({
        success: false,
        message: 'Payslip not found',
      });
    }

    // Verify document belongs to authenticated employee AND is a Payslip
    const query = `
      SELECT
        id,
        employee_id,
        document_type,
        file_name,
        storage_key
      FROM public.documents
      WHERE id = $1
        AND employee_id = $2
        AND LOWER(document_type) = 'payslip'
    `;

    const result = await pool.query(query, [documentId, employeeId]);

    // Return 404 on non-existence or cross-employee access to prevent resource enumeration
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payslip not found',
      });
    }

    const doc = result.rows[0];

    // Retrieve file buffer from private storage
    let fileBuffer;
    try {
      fileBuffer = await storageService.getFile(doc.storage_key);
    } catch (storageErr) {
      if (
        storageErr instanceof storageService.FileNotFoundError ||
        storageErr.code === 'FILE_NOT_FOUND' ||
        storageErr.statusCode === 404
      ) {
        return res.status(404).json({
          success: false,
          message: 'Payslip file not found',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve payslip file',
      });
    }

    // Sanitize filename for header
    const rawBaseName = path.basename(doc.file_name || 'payslip.pdf').replace(/["\r\n\t]/g, '').trim();
    const sanitizedFilename = rawBaseName || 'payslip.pdf';
    const disposition = isInline ? 'inline' : 'attachment';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    const stream = Readable.from(fileBuffer);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employee/payslips/:documentId/view
 * Secure PDF viewing endpoint for authenticated employee's payslip
 */
const viewEmployeePayslip = async (req, res, next) => {
  return streamPayslipFile(req, res, next, true);
};

/**
 * GET /api/employee/payslips/:documentId/download
 * Secure PDF download endpoint for authenticated employee's payslip
 */
const downloadEmployeePayslip = async (req, res, next) => {
  return streamPayslipFile(req, res, next, false);
};

module.exports = {
  getEmployeePayslips,
  viewEmployeePayslip,
  downloadEmployeePayslip,
};
