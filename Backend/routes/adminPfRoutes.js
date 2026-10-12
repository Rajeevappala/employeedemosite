const express = require('express');
const router = express.Router();

const adminPfController = require('../controllers/adminPfController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/pf
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminPfController.getAdminPfList
);

// GET /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  adminPfController.getAdminPfByEmployeeId
);

// PUT /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
router.put(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  adminPfController.updateAdminPf
);

// DELETE /api/admin/pf/:employeeId
// Strictly protected: requires valid JWT session and role ADMIN.
router.delete(
  '/:employeeId',
  authenticateToken,
  requireRole('ADMIN'),
  adminPfController.deleteAdminPf
);

module.exports = router;
