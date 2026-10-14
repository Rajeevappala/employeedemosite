const express = require('express');
const router = express.Router();

const adminEmployeeController = require('../controllers/adminEmployeeController');
const bankDetailsController = require('../controllers/bankDetailsController');
const documentController = require('../controllers/documentController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadOnboardingFiles } = require('../middleware/uploadMiddleware');

// GET /api/admin/employees
// Strictly protected: requires valid JWT session and role ADMIN.
// Read-only: employee management mutations will be implemented in subsequent phases.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.getEmployees
);

// GET /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.getEmployeeById
);

// GET /api/admin/employees/:employeeId/photo
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/:employeeId/photo',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.getAdminEmployeePhoto
);

// POST /api/admin/employees
// Strictly protected: requires valid JWT session and role ADMIN.
// Atomically onboards an employee, provisions user credentials, sets leave balances & payroll profile, and uploads initial onboarding documents.
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  uploadOnboardingFiles,
  adminEmployeeController.onboardEmployee
);

// PUT /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
// Updates allowed employee profile fields and related tables. employee_id remains strictly immutable.
router.put(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  uploadOnboardingFiles,
  adminEmployeeController.updateEmployeeProfile
);

// POST /api/admin/employees/classify-departments
// Strictly protected: requires ADMIN.
router.post(
  '/classify-departments',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.bulkClassifyDepartments
);

// PUT /api/admin/employees/:employeeId/classify-department
// Strictly protected: requires ADMIN.
router.put(
  '/:employeeId/classify-department',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.classifyEmployeeDepartment
);

// PATCH /api/admin/employees/:employeeId/status
// Strictly protected: requires valid JWT session and role ADMIN.
// Updates employee and user status (ACTIVE, INACTIVE, SUSPENDED).
router.patch(
  '/:employeeId/status',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.updateEmployeeStatus
);

// GET /api/admin/employees/:employeeId/bank-details
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/:employeeId/bank-details',
  authenticateToken,
  requireRole('ADMIN'),
  bankDetailsController.getAdminEmployeeBankDetails
);

// PUT /api/admin/employees/:employeeId/bank-details/verify
// Strictly protected: requires valid JWT session and role ADMIN.
router.put(
  '/:employeeId/bank-details/verify',
  authenticateToken,
  requireRole('ADMIN'),
  bankDetailsController.verifyAdminEmployeeBankDetails
);

// PATCH /api/admin/employees/:employeeId/bank-details/verify
// Strictly protected: requires valid JWT session and role ADMIN.
router.patch(
  '/:employeeId/bank-details/verify',
  authenticateToken,
  requireRole('ADMIN'),
  bankDetailsController.verifyAdminEmployeeBankDetails
);

// GET /api/admin/employees/:employeeId/documents
// Strictly protected: requires valid JWT session and role ADMIN.
// Returns all documents strictly belonging to the specified employee.
router.get(
  '/:employeeId/documents',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.getAdminEmployeeDocuments
);

// GET /api/admin/employees/:employeeId/documents/:documentId/download
router.get(
  '/:employeeId/documents/:documentId/download',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.downloadAdminDocument
);

// GET /api/admin/employees/:employeeId/documents/:documentId/view
router.get(
  '/:employeeId/documents/:documentId/view',
  authenticateToken,
  requireRole('ADMIN'),
  (req, res, next) => {
    req.query.inline = 'true';
    return documentController.downloadAdminDocument(req, res, next);
  }
);

// DELETE /api/admin/employees/:employeeId/documents/:documentId
router.delete(
  '/:employeeId/documents/:documentId',
  authenticateToken,
  requireRole('ADMIN'),
  documentController.deleteAdminDocument
);

// DELETE /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
// Permanently deletes an employee, their associated data across all tables, and their physical files.
router.delete(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  adminEmployeeController.deleteEmployeePermanently
);

module.exports = router;
