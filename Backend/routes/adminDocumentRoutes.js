const express = require('express');
const router = express.Router();

const documentController = require('../controllers/documentController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadSingleDocument } = require('../middleware/uploadMiddleware');

// GET /api/admin/documents
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  documentController.getAdminDocuments
);

// GET /api/admin/documents/:documentId/download
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.get(
  '/:documentId/download',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  documentController.downloadAdminDocument
);

const { fileUploadLimiter } = require('../middleware/rateLimitMiddleware');

// DELETE /api/admin/documents/:documentId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.delete(
  '/:documentId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  documentController.deleteAdminDocument
);

// POST /api/admin/documents
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  fileUploadLimiter,
  uploadSingleDocument,
  documentController.uploadDocument
);

module.exports = router;
