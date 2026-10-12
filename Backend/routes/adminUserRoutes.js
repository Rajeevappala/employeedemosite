const express = require('express');
const router = express.Router();
const adminUserController = require('../controllers/adminUserController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/users
// Restricted to ADMIN
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.getUsers
);

// POST /api/admin/users
// All Admins have equal rights to create Admin accounts
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.createUser
);

// PATCH /api/admin/users/:userId/status
// Restricted to ADMIN
router.patch(
  '/:userId/status',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.updateUserStatus
);

// GET /api/admin/users/:userId
// Restricted to ADMIN
router.get(
  '/:userId',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.getUserById
);

// PUT /api/admin/users/:userId
// Update admin details and assign/edit Admin ID Number
router.put(
  '/:userId',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.updateUser
);

// DELETE /api/admin/users/:userId
// Permanently delete an administrator account (with self-deletion & last-admin safeguards)
router.delete(
  '/:userId',
  authenticateToken,
  requireRole('ADMIN'),
  adminUserController.deleteAdminPermanently
);

module.exports = router;

