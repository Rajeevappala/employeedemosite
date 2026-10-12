const express = require('express');
const router = express.Router();

const attendanceController = require('../controllers/attendanceController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/employee/attendance
// Strictly protected: requires valid JWT session and EMPLOYEE role.
// Read-only: Employees cannot mark, edit, or delete attendance records.
router.get(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  attendanceController.getEmployeeAttendance
);

// PUT /api/admin/attendance/:attendanceId
// Strictly protected: requires valid JWT session and role ADMIN.
router.put(
  '/:attendanceId',
  authenticateToken,
  requireRole('ADMIN'),
  attendanceController.updateAttendance
);

// POST /api/admin/attendance/mark-all-present
// Strictly protected: requires valid JWT session and role ADMIN.
router.post(
  '/mark-all-present',
  authenticateToken,
  requireRole('ADMIN'),
  attendanceController.markAllPresent
);

// GET /api/admin/attendance/monthly?month=YYYY-MM
// Strictly protected: requires valid JWT session and role ADMIN.
router.get(
  '/monthly',
  authenticateToken,
  requireRole('ADMIN'),
  attendanceController.getMonthlyAttendance
);

module.exports = router;
