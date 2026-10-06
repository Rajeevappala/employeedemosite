const express = require('express');
const router = express.Router();

const adminEmployeeController = require('../controllers/adminEmployeeController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadOnboardingFiles } = require('../middleware/uploadMiddleware');

// GET /api/admin/employees
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
// Read-only: employee management mutations will be implemented in subsequent phases.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminEmployeeController.getEmployees
);

// GET /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminEmployeeController.getEmployeeById
);

// GET /api/admin/employees/:employeeId/photo
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/:employeeId/photo',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminEmployeeController.getAdminEmployeePhoto
);

// POST /api/admin/employees
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
// Atomically onboards an employee, provisions user credentials, sets leave balances & payroll profile, and uploads initial onboarding documents.
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  uploadOnboardingFiles,
  adminEmployeeController.onboardEmployee
);

// PUT /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
// Updates allowed employee profile fields. employee_id remains strictly immutable.
router.put(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminEmployeeController.updateEmployeeProfile
);

// PATCH /api/admin/employees/:employeeId/status
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
// Updates employee and user status (ACTIVE, INACTIVE, SUSPENDED).
router.patch(
  '/:employeeId/status',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminEmployeeController.updateEmployeeStatus
);

// DELETE /api/admin/employees/:employeeId
// Strictly protected: requires valid JWT session and role SUPER_ADMIN only.
// Permanently deletes an employee, their associated data across all tables, and their physical files.
router.delete(
  '/:employeeId',
  authenticateToken,
  requireRole('SUPER_ADMIN'),
  adminEmployeeController.deleteEmployeePermanently
);

module.exports = router;
