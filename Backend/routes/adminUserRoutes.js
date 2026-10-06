const express = require('express');
const router = express.Router();
const adminUserController = require('../controllers/adminUserController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/users
// Restricted to ADMIN and SUPER_ADMIN
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminUserController.getUsers
);

// POST /api/admin/users
// Role checks are strictly enforced in controller:
// SUPER_ADMIN can create ADMIN or EMPLOYEE
// ADMIN cannot create ADMIN (returns 403)
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminUserController.createUser
);

// PATCH /api/admin/users/:userId/status
// Restricted to SUPER_ADMIN
router.patch(
  '/:userId/status',
  authenticateToken,
  requireRole('SUPER_ADMIN'),
  adminUserController.updateUserStatus
);

module.exports = router;
