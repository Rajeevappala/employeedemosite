const express = require('express');
const router = express.Router();

const adminAttendanceController = require('../controllers/adminAttendanceController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/attendance
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminAttendanceController.getAdminAttendance
);

// GET /api/admin/attendance/monthly?month=YYYY-MM
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.get(
  '/monthly',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminAttendanceController.getMonthlyAttendance
);

// POST /api/admin/attendance
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminAttendanceController.markAttendance
);

// POST /api/admin/attendance/mark-all-present
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.post(
  '/mark-all-present',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminAttendanceController.markAllPresent
);

// PUT /api/admin/attendance/:attendanceId
// Strictly protected: requires valid JWT session and role ADMIN or SUPER_ADMIN.
router.put(
  '/:attendanceId',
  authenticateToken,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminAttendanceController.updateAttendance
);

module.exports = router;
