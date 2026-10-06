const express = require('express');
const router = express.Router();

const leaveController = require('../controllers/leaveController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/employee/leaves
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.get(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  leaveController.getEmployeeLeaves
);

// POST /api/employee/leaves
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.post(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  leaveController.applyLeave
);

// PATCH /api/employee/leaves/:leaveId/cancel
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.patch(
  '/:leaveId/cancel',
  authenticateToken,
  requireRole('EMPLOYEE'),
  leaveController.cancelLeaveRequest
);

// GET /api/admin/leaves
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.get(
  '/admin/leaves',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  leaveController.getAdminLeaves
);

// PATCH /api/admin/leaves/:leaveId/status
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN
router.patch(
  '/admin/leaves/:leaveId/status',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  leaveController.updateLeaveStatus
);

module.exports = router;
