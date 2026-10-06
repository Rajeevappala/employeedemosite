const express = require('express');
const router = express.Router();

const adminPfController = require('../controllers/adminPfController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/pf
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminPfController.getAdminPfList
);

// GET /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminPfController.getAdminPfByEmployeeId
);

// PUT /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.put(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminPfController.updateAdminPf
);

// DELETE /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.delete(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminPfController.deleteAdminPf
);

module.exports = router;
