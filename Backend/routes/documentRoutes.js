const express = require('express');
const router = express.Router();

const documentController = require('../controllers/documentController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadSingleDocument } = require('../middleware/uploadMiddleware');

// GET /api/employee/documents
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.get(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  documentController.getEmployeeDocuments
);

// GET /api/employee/documents/:documentId/download
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.get(
  '/:documentId/download',
  authenticateToken,
  requireRole('EMPLOYEE'),
  documentController.downloadEmployeeDocument
);

// GET /admin/documents
// Strictly protected: requires valid JWT session and role ADMIN
router.get(
  '/admin/documents',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.getAdminDocuments
);

// GET /admin/documents/:documentId/download
// Strictly protected: requires valid JWT session and role ADMIN
router.get(
  '/admin/documents/:documentId/download',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.downloadAdminDocument
);

// DELETE /admin/documents/:documentId
// Strictly protected: requires valid JWT session and role ADMIN
router.delete(
  '/admin/documents/:documentId',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.deleteAdminDocument
);

// POST /admin/documents
// Strictly protected: requires valid JWT session and role ADMIN
router.post(
  '/admin/documents',
  authenticateToken,
  requireRole('ADMIN'),
  uploadSingleDocument,
  documentController.uploadDocument
);

module.exports = router;
