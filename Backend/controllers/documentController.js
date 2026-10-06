const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const pool = require('../config/database');
const storageService = require('../services/storageService');
const { ALLOWED_EXTENSIONS } = require('../middleware/uploadMiddleware');
const { recordAuditLog } = require('../services/auditService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Controller to fetch all documents belonging to the currently authenticated employee.
 * Security:
 * - Employee identity is strictly extracted from req.user.employee_id.
 * - URL parameters, query parameters, and request body IDs are completely ignored.
 * - Only safe document metadata is returned (id, document_type, file_name, month, year, created_at).
 * - storage_key, filesystem paths, and storage credentials are never exposed.
 */
const getEmployeeDocuments = async (req, res, next) => {
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
        document_type,
        file_name,
        month,
        year,
        created_at
      FROM documents
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
 * Controller to securely download a document belonging to the currently authenticated employee.
 * Endpoint: GET /api/employee/documents/:documentId/download
 *
 * Security:
 * - Requires EMPLOYEE role and valid JWT.
 * - Enforces employee ownership: SELECT ... WHERE id = $1 AND employee_id = $2.
 * - Returns 404 (never 403) if document does not belong to employee to prevent existence disclosure.
 * - Retrieves file buffer through storageService (enforcing path traversal protection).
 * - Returns 404 "Document file not found" if physical file is missing from storage.
 * - Streams file with safe Content-Type and sanitized Content-Disposition attachment header.
 * - Never returns or leaks internal filesystem path, storage_key, or base64.
 */
const downloadEmployeeDocument = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { documentId } = req.params;

    // Validate UUID format to prevent invalid input syntax database errors
    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // 1. Look up document strictly scoped to authenticated employee
    const query = `
      SELECT
        id,
        employee_id,
        document_type,
        file_name,
        storage_key
      FROM documents
      WHERE id = $1
        AND employee_id = $2
    `;

    const result = await pool.query(query, [documentId, employeeId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = result.rows[0];

    // 2. Retrieve file buffer from private storageService
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
          message: 'Document file not found',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve document file',
      });
    }

    // 3. Determine Content-Type based on safe file extension
    const ext = path.extname(doc.file_name || doc.storage_key || '').toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    }

    // 4. Sanitize original filename for Content-Disposition header
    const rawBaseName = path.basename(doc.file_name || 'document').replace(/["\r\n\t]/g, '').trim();
    const sanitizedFilename = rawBaseName || 'document';

    // 5. Set headers and stream response
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    const stream = Readable.from(fileBuffer);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * Admin Upload Employee Document
 * Endpoint: POST /api/admin/documents
 *
 * Security & Requirements:
 * - Restricted to ADMIN and SUPER_ADMIN.
 * - Validates employee existence in public.employees.
 * - File uploaded into memory and stored safely via storageService (never public).
 * - Original filename is kept in DB metadata only, never used for physical path.
 * - Safe random UUID storage key generated server-side.
 * - If DB insertion fails, stored file is deleted to prevent orphaned files.
 * - Response excludes storage_key and internal filesystem paths.
 */
const uploadDocument = async (req, res, next) => {
  let fileSaved = false;
  let generatedStorageKey = null;

  try {
    const { employee_id, document_type, month, year } = req.body;
    const file = req.file;

    // 1. Validate employee_id
    if (!employee_id || !employee_id.trim()) {
      return res.status(400).json({
        success: false,
        message: 'employee_id is required',
      });
    }

    // 2. Validate document_type
    if (!document_type || !document_type.trim()) {
      return res.status(400).json({
        success: false,
        message: 'document_type is required',
      });
    }

    // 3. Validate file presence
    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'file is required',
      });
    }

    // 4. Validate month (optional)
    let parsedMonth = null;
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      parsedMonth = parseInt(month, 10);
      if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        return res.status(400).json({
          success: false,
          message: 'Invalid month. Month must be an integer between 1 and 12',
        });
      }
    }

    // 5. Validate year (optional)
    let parsedYear = null;
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      parsedYear = parseInt(year, 10);
      if (isNaN(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
        return res.status(400).json({
          success: false,
          message: 'Invalid year. Year must be a valid 4-digit year',
        });
      }
    }

    const cleanEmpId = employee_id.trim();

    // 6. Verify employee exists in public.employees
    const empCheck = await pool.query(
      'SELECT employee_id FROM employees WHERE employee_id = $1',
      [cleanEmpId]
    );

    if (empCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // 7. Derive safe physical extension
    let safeExt = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(safeExt)) {
      if (file.mimetype === 'application/pdf') safeExt = '.pdf';
      else if (file.mimetype === 'image/png') safeExt = '.png';
      else if (file.mimetype === 'image/jpeg') safeExt = '.jpg';
      else safeExt = '.bin';
    }

    // 8. Generate safe, controlled storage key
    const sanitizedEmpId = cleanEmpId.replace(/[^a-zA-Z0-9_-]/g, '');
    const uuid = crypto.randomUUID();

    if (parsedMonth && parsedYear) {
      const monthStr = String(parsedMonth).padStart(2, '0');
      generatedStorageKey = `documents/${sanitizedEmpId}/${parsedYear}/${monthStr}/${uuid}${safeExt}`;
    } else {
      generatedStorageKey = `documents/${sanitizedEmpId}/general/${uuid}${safeExt}`;
    }

    // 9. Save file to private storage
    try {
      await storageService.saveFile(file.buffer, generatedStorageKey);
      fileSaved = true;
    } catch (storageErr) {
      return res.status(500).json({
        success: false,
        message: storageErr.message || 'Failed to save file to private storage',
      });
    }

    // 10. Insert document metadata into PostgreSQL
    try {
      const insertQuery = `
        INSERT INTO documents (
          employee_id,
          document_type,
          file_name,
          storage_key,
          month,
          year,
          uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, employee_id, document_type, file_name, month, year, created_at
      `;

      const originalFileName = path.basename(file.originalname || 'document').replace(/[\r\n\t]/g, '');
      const dbResult = await pool.query(insertQuery, [
        cleanEmpId,
        document_type.trim(),
        originalFileName,
        generatedStorageKey,
        parsedMonth,
        parsedYear,
        req.user.id,
      ]);

      const inserted = dbResult.rows[0];

      // Audit log document creation
      recordAuditLog({
        action: 'DOCUMENT_UPLOAD',
        entityType: 'DOCUMENT',
        entityId: inserted.id,
        metadata: {
          employee_id: inserted.employee_id,
          document_type: inserted.document_type,
          file_name: inserted.file_name,
        },
        req,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: 'Document uploaded successfully',
        data: {
          id: inserted.id,
          employee_id: inserted.employee_id,
          document_type: inserted.document_type,
          file_name: inserted.file_name,
          month: inserted.month,
          year: inserted.year,
          created_at: inserted.created_at,
        },
      });
    } catch (dbErr) {
      // 11. Cleanup orphaned file if DB insertion fails
      if (fileSaved && generatedStorageKey) {
        try {
          await storageService.deleteFile(generatedStorageKey);
        } catch (cleanupErr) {
          console.error('Failed to delete orphaned file after DB failure:', cleanupErr.message);
        }
      }
      return next(dbErr);
    }
  } catch (error) {
    // Catch-all cleanup if unexpected error happens after file is saved
    if (fileSaved && generatedStorageKey) {
      try {
        await storageService.deleteFile(generatedStorageKey);
      } catch (cleanupErr) {
        console.error('Failed to delete orphaned file:', cleanupErr.message);
      }
    }
    next(error);
  }
};

/**
 * Controller to fetch all documents across all employees for administrators.
 * Endpoint: GET /api/admin/documents
 *
 * Query parameters:
 * - employee_id (exact match)
 * - document_type (exact match)
 * - search (ILIKE across employee_id, first_name, last_name, full_name, email)
 * - month (integer 1-12)
 * - year (integer YYYY)
 * - page (default 1)
 * - limit (default 20, max 100)
 */
const getAdminDocuments = async (req, res, next) => {
  try {
    const {
      employee_id,
      document_type,
      search,
      month,
      year,
      page: pageQuery,
      limit: limitQuery,
    } = req.query;

    // 1. Pagination validation
    let page = 1;
    if (pageQuery !== undefined && pageQuery !== null && String(pageQuery).trim() !== '') {
      const parsedPage = parseInt(pageQuery, 10);
      if (isNaN(parsedPage) || parsedPage < 1) {
        return res.status(400).json({
          success: false,
          message: 'page must be a positive integer',
        });
      }
      page = parsedPage;
    }

    let limit = 20;
    if (limitQuery !== undefined && limitQuery !== null && String(limitQuery).trim() !== '') {
      const parsedLimit = parseInt(limitQuery, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({
          success: false,
          message: 'limit must be a positive integer',
        });
      }
      if (parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: 'limit cannot exceed 100',
        });
      }
      limit = parsedLimit;
    }

    // 2. Build filters
    const conditions = [];
    const queryParams = [];

    // Filter: employee_id
    if (employee_id && String(employee_id).trim()) {
      queryParams.push(String(employee_id).trim());
      conditions.push(`d.employee_id = $${queryParams.length}`);
    }

    // Filter: document_type
    if (document_type && String(document_type).trim()) {
      queryParams.push(String(document_type).trim());
      conditions.push(`d.document_type = $${queryParams.length}`);
    }

    // Filter: search
    if (search && String(search).trim()) {
      const trimmedSearch = String(search).trim();
      queryParams.push(`%${trimmedSearch}%`);
      const sIdx = queryParams.length;
      conditions.push(`(
        d.employee_id ILIKE $${sIdx} OR
        e.first_name ILIKE $${sIdx} OR
        e.last_name ILIKE $${sIdx} OR
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) ILIKE $${sIdx} OR
        e.email ILIKE $${sIdx}
      )`);
    }

    // Filter: month
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      const parsedMonth = parseInt(month, 10);
      if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        return res.status(400).json({
          success: false,
          message: 'month must be an integer between 1 and 12',
        });
      }
      queryParams.push(parsedMonth);
      conditions.push(`d.month = $${queryParams.length}`);
    }

    // Filter: year
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      const parsedYear = parseInt(year, 10);
      if (isNaN(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
        return res.status(400).json({
          success: false,
          message: 'year must be a valid 4-digit year',
        });
      }
      queryParams.push(parsedYear);
      conditions.push(`d.year = $${queryParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 3. Count query
    const countQuery = `
      SELECT COUNT(d.id) AS total
      FROM public.documents d
      LEFT JOIN public.employees e ON e.employee_id = d.employee_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    // 4. Data query
    const offset = (page - 1) * limit;
    const dataQueryParams = [...queryParams];
    dataQueryParams.push(limit);
    const limitIdx = dataQueryParams.length;
    dataQueryParams.push(offset);
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT
        d.id,
        d.employee_id,
        COALESCE(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS employee_name,
        COALESCE(e.email, '') AS email,
        d.document_type,
        d.file_name,
        d.month,
        d.year,
        d.created_at
      FROM public.documents d
      LEFT JOIN public.employees e ON e.employee_id = d.employee_id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const dataResult = await pool.query(dataQuery, dataQueryParams);
    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for administrators to securely download any employee document.
 * Endpoint: GET /api/admin/documents/:documentId/download
 */
const downloadAdminDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // Validate UUID format
    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // 1. Retrieve document metadata
    const query = `
      SELECT
        id,
        employee_id,
        document_type,
        file_name,
        storage_key
      FROM public.documents
      WHERE id = $1
    `;

    const result = await pool.query(query, [documentId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = result.rows[0];

    // 2. Retrieve file buffer from storageService
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
          message: 'Document file not found',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve document file',
      });
    }

    // 3. Determine Content-Type based on safe file extension
    const ext = path.extname(doc.file_name || doc.storage_key || '').toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    }

    // 4. Sanitize original filename for Content-Disposition header
    const rawBaseName = path.basename(doc.file_name || 'document').replace(/["\r\n\t]/g, '').trim();
    const sanitizedFilename = rawBaseName || 'document';

    // 5. Set headers and stream response
    const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    const stream = Readable.from(fileBuffer);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for administrators to safely delete an employee document.
 * Sequence:
 * 1. Find database record.
 * 2. Delete physical file from private storage.
 * 3. Delete database metadata record.
 * Endpoint: DELETE /api/admin/documents/:documentId
 */
const deleteAdminDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // Validate UUID format
    if (!documentId || !UUID_REGEX.test(documentId)) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // 1. Find document metadata
    const findQuery = `
      SELECT id, storage_key, file_name
      FROM public.documents
      WHERE id = $1
    `;
    const findResult = await pool.query(findQuery, [documentId]);

    if (findResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = findResult.rows[0];

    // 2. Delete physical file from storage
    // If the file is already missing on disk, deleteFile cleanly returns false without throwing.
    try {
      await storageService.deleteFile(doc.storage_key);
    } catch (storageErr) {
      console.error('Failed to delete physical file from storage:', storageErr.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete document file from storage',
      });
    }

    // 3. Delete metadata record from PostgreSQL
    await pool.query('DELETE FROM public.documents WHERE id = $1', [documentId]);

    // Audit log document deletion
    recordAuditLog({
      action: 'DOCUMENT_DELETE',
      entityType: 'DOCUMENT',
      entityId: documentId,
      metadata: {
        employee_id: doc.employee_id,
        document_type: doc.document_type,
        file_name: doc.file_name,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeDocuments,
  downloadEmployeeDocument,
  uploadDocument,
  getAdminDocuments,
  downloadAdminDocument,
  deleteAdminDocument,
};
