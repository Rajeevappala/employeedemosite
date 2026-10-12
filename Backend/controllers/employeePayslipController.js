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

    // Build parameterized query supporting both finalized documents and processed payroll records
    const whereConditions = [
      `(pr.employee_id = $1 OR d.employee_id = $1)`,
    ];
    const queryParams = [employeeId];

    if (parsedYear !== null) {
      queryParams.push(parsedYear);
      whereConditions.push(`(COALESCE(pr.year, d.year) = $${queryParams.length})`);
    }

    if (parsedMonth !== null) {
      queryParams.push(parsedMonth);
      whereConditions.push(`(COALESCE(pr.month, d.month) = $${queryParams.length})`);
    }

    const whereClause = whereConditions.join(' AND ');

    // 1. Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.payroll_records pr
      FULL OUTER JOIN (
        SELECT * FROM public.documents WHERE LOWER(document_type) = 'payslip'
      ) d ON d.employee_id = pr.employee_id AND d.month = pr.month AND d.year = pr.year
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    // 2. Query items joined with authoritative payroll_records and availability status
    const dataQueryParams = [...queryParams, limitNum, offset];
    const limitParamIndex = queryParams.length + 1;
    const offsetParamIndex = queryParams.length + 2;

    const dataQuery = `
      SELECT 
        d.id AS document_id,
        COALESCE(d.id, pr.id) AS id,
        COALESCE(pr.employee_id, d.employee_id) AS employee_id,
        COALESCE(d.document_type, 'Payslip') AS document_type,
        COALESCE(d.file_name, CONCAT('Payslip_', COALESCE(pr.employee_id, d.employee_id), '_', COALESCE(pr.month, d.month), '_', COALESCE(pr.year, d.year), '.pdf')) AS file_name,
        COALESCE(pr.month, d.month) AS month,
        COALESCE(pr.year, d.year) AS year,
        COALESCE(d.created_at, pr.processed_at, pr.created_at) AS created_at,
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
        pr.status AS payroll_status,
        CASE 
          WHEN d.id IS NOT NULL THEN 'Available'
          ELSE 'Processing'
        END AS availability_status
      FROM public.payroll_records pr
      FULL OUTER JOIN (
        SELECT * FROM public.documents WHERE LOWER(document_type) = 'payslip'
      ) d ON d.employee_id = pr.employee_id AND d.month = pr.month AND d.year = pr.year
      WHERE ${whereClause}
      ORDER BY COALESCE(pr.year, d.year) DESC NULLS LAST, COALESCE(pr.month, d.month) DESC NULLS LAST, COALESCE(d.created_at, pr.created_at) DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `;

    const dataResult = await pool.query(dataQuery, dataQueryParams);

    // 3. Map to safe response format excluding internal storage keys & filesystem paths
    const items = dataResult.rows.map((row) => ({
      id: row.document_id || row.id,
      document_id: row.document_id || null,
      employee_id: row.employee_id,
      document_type: row.document_type,
      file_name: row.file_name,
      month: row.month,
      year: row.year,
      created_at: row.created_at,
      is_available: Boolean(row.document_id),
      availability_status: row.availability_status || (row.document_id ? 'Available' : 'Processing'),
      payroll: (row.working_days != null || row.net_salary != null) ? {
        working_days: row.working_days != null ? (parseFloat(row.working_days) || 0) : null,
        payable_days: row.payable_days != null ? (parseFloat(row.payable_days) || 0) : null,
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
