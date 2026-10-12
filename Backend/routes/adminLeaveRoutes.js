const express = require('express');
const router = express.Router();

const leaveController = require('../controllers/leaveController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/leaves
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  leaveController.getAdminLeaves
);

// GET /api/admin/leaves/balances
// Strictly protected: requires valid JWT session and role ADMIN.
// Placed before /:leaveId to prevent route parameter collision.
router.get(
  '/balances',
  authenticateToken,
  requireRole('ADMIN'),
  leaveController.getAdminLeaveBalances
);

// GET /api/admin/leaves/export
// Strictly protected: requires valid JWT session and role ADMIN.
// Placed before /:leaveId to prevent route parameter collision.
router.get(
  '/export',
  authenticateToken,
  requireRole('ADMIN'),
  leaveController.exportAdminLeavesReport
);

// GET /api/admin/leaves/:leaveId
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/:leaveId',
  authenticateToken,
  requireRole('ADMIN'),
  leaveController.getAdminLeaveById
);

// PATCH /api/admin/leaves/:leaveId/status
// Strictly protected: requires valid JWT session and role ADMIN.
router.patch(
  '/:leaveId/status',
  authenticateToken,
  requireRole('ADMIN'),
  leaveController.updateLeaveStatus
);

module.exports = router;

