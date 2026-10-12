const express = require('express');
const router = express.Router();

const adminAttendanceController = require('../controllers/adminAttendanceController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/admin/attendance
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.getAdminAttendance
);

// GET /api/admin/attendance/monthly?month=YYYY-MM
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/monthly',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.getMonthlyAttendance
);

// POST /api/admin/attendance
// Strictly protected: requires valid JWT session and role ADMIN.
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.markAttendance
);

// POST /api/admin/attendance/mark-all-present
// Strictly protected: requires valid JWT session and role ADMIN.
router.post(
  '/mark-all-present',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.markAllPresent
);

// POST /api/admin/attendance/mark-holiday
// Strictly protected: requires valid JWT session and role ADMIN.
router.post(
  '/mark-holiday',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.markHoliday
);

// PUT /api/admin/attendance/:attendanceId
// Strictly protected: requires valid JWT session and role ADMIN.
router.put(
  '/:attendanceId',
  authenticateToken,
  requireRole('ADMIN'),
  adminAttendanceController.updateAttendance
);

module.exports = router;
