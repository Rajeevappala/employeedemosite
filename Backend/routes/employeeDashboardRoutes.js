const express = require('express');
const router = express.Router();

const employeeDashboardController = require('../controllers/employeeDashboardController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/employee/dashboard
// Strictly restricted to authenticated accounts with role EMPLOYEE
router.get(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  employeeDashboardController.getEmployeeDashboard
);

module.exports = router;
