const express = require('express');
const router = express.Router();

const documentController = require('../controllers/documentController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadSingleDocument } = require('../middleware/uploadMiddleware');

// GET /api/admin/documents
// Strictly protected: requires valid JWT session and role ADMIN
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.getAdminDocuments
);

// GET /api/admin/documents/employee/:employeeId
router.get(
  '/employee/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.getAdminEmployeeDocuments
);

// GET /api/admin/documents/:documentId/download
// Strictly protected: requires valid JWT session and role ADMIN
router.get(
  '/:documentId/download',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.downloadAdminDocument
);

// GET /api/admin/documents/:documentId/view
// Strictly protected: requires valid JWT session and role ADMIN
router.get(
  '/:documentId/view',
  authenticateToken,
  requireRole('ADMIN'),
  (req, res, next) => {
    req.query.inline = 'true';
    return documentController.downloadAdminDocument(req, res, next);
  }
);

const { fileUploadLimiter } = require('../middleware/rateLimitMiddleware');

// DELETE /api/admin/documents/:documentId
// Strictly protected: requires valid JWT session and role ADMIN
router.delete(
  '/:documentId',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.deleteAdminDocument
);

// POST /api/admin/documents
// Strictly protected: requires valid JWT session and role ADMIN
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  fileUploadLimiter,
  uploadSingleDocument,
  documentController.uploadDocument
);

module.exports = router;
